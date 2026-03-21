"""Optuna TPE parameter optimizer for strategy robustness testing.

Per CLAUDE.md: Bayesian search (TPE) to map stable plateaus,
not find "best" params. ~800 trials vs 100K+ grid search.
Max 5 tunable params enforced.
"""

from __future__ import annotations

import sys
from copy import deepcopy

import optuna
import polars as pl

from src.engine.config import (
    BacktestRequest,
    IndicatorConfig,
    StrategyConfig,
)


def _build_search_space(config: StrategyConfig) -> list[dict]:
    """Extract tunable parameters from indicator configs."""
    space = []
    for i, ind in enumerate(config.indicators):
        if ind.type in ("sma", "ema"):
            space.append({
                "name": f"ind_{i}_period",
                "type": "int",
                "low": max(3, ind.period - 15),
                "high": ind.period + 15,
                "index": i,
                "field": "period",
            })
        elif ind.type == "rsi":
            space.append({
                "name": f"ind_{i}_period",
                "type": "int",
                "low": 7,
                "high": 21,
                "index": i,
                "field": "period",
            })
        elif ind.type == "atr":
            space.append({
                "name": f"ind_{i}_period",
                "type": "int",
                "low": 7,
                "high": 21,
                "index": i,
                "field": "period",
            })

    # Enforce max 5 tunable params
    return space[:5]


def _apply_params(config: StrategyConfig, params: dict, space: list[dict]) -> StrategyConfig:
    """Create a new config with optimized parameters applied."""
    new_config = deepcopy(config)
    indicators = list(new_config.indicators)

    for param_def in space:
        name = param_def["name"]
        if name in params:
            idx = param_def["index"]
            field = param_def["field"]
            ind = indicators[idx]
            # Create new indicator with updated period
            ind_dict = ind.model_dump()
            ind_dict[field] = params[name]
            indicators[idx] = IndicatorConfig(**ind_dict)

    # Update entry/exit expressions with new period values
    new_config = StrategyConfig(
        name=new_config.name,
        symbol=new_config.symbol,
        timeframe=new_config.timeframe,
        indicators=indicators,
        entry_long=_update_expression(config.entry_long, config.indicators, indicators),
        entry_short=_update_expression(config.entry_short, config.indicators, indicators),
        exit=_update_expression(config.exit, config.indicators, indicators),
        stop_loss=new_config.stop_loss,
        take_profit=new_config.take_profit,
        position_size=new_config.position_size,
    )
    return new_config


def _update_expression(expr: str, old_indicators: list, new_indicators: list) -> str:
    """Update column references in expression when periods change."""
    result = expr
    for old_ind, new_ind in zip(old_indicators, new_indicators):
        if old_ind.period != new_ind.period:
            old_name = f"{old_ind.type}_{old_ind.period}"
            new_name = f"{new_ind.type}_{new_ind.period}"
            result = result.replace(old_name, new_name)
    return result


def optimize_strategy(
    config: StrategyConfig,
    data: pl.DataFrame,
    n_trials: int = 800,
) -> dict:
    """Optimize strategy parameters using Optuna TPE sampler.

    Args:
        config: Base strategy configuration
        data: OHLCV data for in-sample optimization
        n_trials: Number of Optuna trials (default 800)

    Returns:
        dict with best_params, best_score, n_trials, param_importance
    """
    from src.engine.backtester import run_backtest

    space = _build_search_space(config)

    if not space:
        return {
            "best_params": {},
            "best_score": 0.0,
            "n_trials": 0,
            "param_importance": {},
        }

    # Suppress Optuna logging
    optuna.logging.set_verbosity(optuna.logging.WARNING)

    def objective(trial: optuna.Trial) -> float:
        params = {}
        for p in space:
            params[p["name"]] = trial.suggest_int(p["name"], p["low"], p["high"])

        new_config = _apply_params(config, params, space)
        request = BacktestRequest(
            strategy=new_config,
            start_date="2023-01-01",
            end_date="2023-12-31",
        )

        try:
            result = run_backtest(request, data=data)
            sharpe = result.get("sharpe_ratio", 0.0)
            return -sharpe  # Minimize negative Sharpe
        except Exception as exc:
            print(f"    Optuna trial {trial.number} failed: {exc}", file=sys.stderr)
            return 0.0  # Neutral on error

    sampler = optuna.samplers.TPESampler(seed=42)
    study = optuna.create_study(sampler=sampler, direction="minimize")
    study.optimize(objective, n_trials=n_trials, show_progress_bar=False)

    best_params = study.best_params

    # Param importance
    try:
        importance = optuna.importance.get_param_importances(study)
    except Exception:
        importance = {}

    return {
        "best_params": best_params,
        "best_score": -study.best_value,  # Convert back to positive Sharpe
        "n_trials": len(study.trials),
        "trials_used": len(study.trials),
        "param_importance": dict(importance),
    }


def run_robustness_test(
    config: StrategyConfig,
    data: pl.DataFrame,
    n_trials: int = 800,
) -> dict:
    """Run Optuna study + robustness analysis.

    Combines optimization with robustness checks. Returns both the
    best parameters and analysis of how robust they are.

    Args:
        config: Strategy configuration
        data: OHLCV data for optimization
        n_trials: Number of Optuna trials

    Returns:
        dict with: best_params, best_score, n_trials, param_importance,
                   robustness (is_robust, plateau_variance, etc.),
                   robust_ranges (per-param min/max)
    """
    from src.engine.robustness import (
        analyze_optuna_study,
        compute_param_importance,
        extract_robust_range,
    )
    from src.engine.backtester import run_backtest

    space = _build_search_space(config)

    if not space:
        return {
            "best_params": {},
            "best_score": 0.0,
            "n_trials": 0,
            "param_importance": {},
            "robustness": {"is_robust": False, "plateau_variance": 0.0},
            "robust_ranges": {},
        }

    optuna.logging.set_verbosity(optuna.logging.WARNING)

    def objective(trial: optuna.Trial) -> float:
        params = {}
        for p in space:
            params[p["name"]] = trial.suggest_int(p["name"], p["low"], p["high"])

        new_config = _apply_params(config, params, space)
        request = BacktestRequest(
            strategy=new_config,
            start_date="2023-01-01",
            end_date="2023-12-31",
        )

        try:
            result = run_backtest(request, data=data)
            sharpe = result.get("sharpe_ratio", 0.0)
            return -sharpe
        except Exception as exc:
            print(f"    Optuna trial {trial.number} failed: {exc}", file=sys.stderr)
            return 0.0

    sampler = optuna.samplers.TPESampler(seed=42)
    study = optuna.create_study(sampler=sampler, direction="minimize")
    study.optimize(objective, n_trials=n_trials, show_progress_bar=False)

    # Robustness analysis
    robustness = analyze_optuna_study(study)
    importance = compute_param_importance(study)
    robust_ranges = extract_robust_range(study)

    return {
        "best_params": study.best_params,
        "best_score": -study.best_value,
        "n_trials": len(study.trials),
        "param_importance": importance,
        "robustness": robustness,
        "robust_ranges": {k: list(v) for k, v in robust_ranges.items()},
    }
