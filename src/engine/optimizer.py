"""Optuna TPE parameter optimizer for strategy robustness testing.

Per CLAUDE.md: Bayesian search (TPE) to map stable plateaus,
not find "best" params. ~800 trials vs 100K+ grid search.
Max 5 tunable params enforced.
"""

from __future__ import annotations

import json
import os
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
    """Update column references in expression when periods change.

    Uses two-pass placeholder approach to prevent collisions when
    indicator names overlap (e.g., ema_10→ema_15, ema_15→ema_20).
    """
    result = expr
    # Pass 1: replace old names with unique placeholders
    for i, (old_ind, new_ind) in enumerate(zip(old_indicators, new_indicators)):
        if old_ind.period != new_ind.period:
            old_name = f"{old_ind.type}_{old_ind.period}"
            result = result.replace(old_name, f"__IND_PLACEHOLDER_{i}__")
    # Pass 2: replace placeholders with new names
    for i, (old_ind, new_ind) in enumerate(zip(old_indicators, new_indicators)):
        if old_ind.period != new_ind.period:
            new_name = f"{new_ind.type}_{new_ind.period}"
            result = result.replace(f"__IND_PLACEHOLDER_{i}__", new_name)
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
            return float("inf")  # Worst possible for minimization — never selected as best

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
    from src.engine.backtester import run_backtest
    from src.engine.robustness import (
        analyze_optuna_study,
        compute_param_importance,
        extract_robust_range,
    )

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
            return float("inf")  # Worst possible for minimization — never selected as best

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


# ─── CLI entrypoint (M6 Wave 27.5 Pass D.3) ─────────────────────────────────
#
# Invoked by robustness-service.ts via:
#   python -m src.engine.optimizer --config <tmpfile> --mode robustness [--dry-run]
#
# --dry-run:
#   When set, the optimizer STILL computes the full result (Optuna study runs)
#   but:
#     - Does NOT write any cache/temp artifacts to ~/.trading-forge/optimizer_cache/
#     - Does NOT write DB rows (handled by robustness-service.ts caller guard)
#     - DOES emit the result JSON to stdout normally
#   This matches the dryRun=true path in robustness-service.ts where audit_log
#   writes are suppressed TS-side.
#
# BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD env var applies to any
# run_backtest() calls inside the Optuna objective (see data_loader.py M1 guard).

def _get_optimizer_cache_dir() -> "os.PathLike[str]":
    """Return the optimizer cache directory path (not created here)."""
    import pathlib
    return pathlib.Path.home() / ".trading-forge" / "optimizer_cache"


def _write_optimizer_cache(cache_key: str, result: dict, dry_run: bool) -> None:
    """Write optimizer result to disk cache.

    Skipped when dry_run=True so dryRun backtest replays don't pollute
    the cache with ephemeral intermediate results.
    """
    if dry_run:
        print(
            f"[optimizer] --dry-run: skipping cache write for key {cache_key}",
            file=sys.stderr,
        )
        return
    try:
        import pathlib
        cache_dir = pathlib.Path(_get_optimizer_cache_dir())
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_file = cache_dir / f"{cache_key}.json"
        with open(cache_file, "w") as f:
            json.dump(result, f)
        print(f"[optimizer] cache written: {cache_file}", file=sys.stderr)
    except Exception as cache_err:
        # Cache write failure is non-blocking — result is still emitted to stdout
        print(f"WARNING: optimizer cache write failed: {cache_err}", file=sys.stderr)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Optimizer — Optuna TPE parameter robustness testing"
    )
    parser.add_argument(
        "--config",
        type=str,
        required=True,
        help="Path to JSON config file (written by robustness-service.ts via python-runner)",
    )
    parser.add_argument(
        "--mode",
        type=str,
        default="robustness",
        choices=["robustness", "optimize"],
        help="Operation mode: 'robustness' (default) runs full robustness analysis; "
             "'optimize' runs parameter optimization only",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        dest="dry_run",
        help=(
            "Dry-run mode: compute result but skip all disk and DB writes. "
            "Result is still emitted to stdout as normal JSON. "
            "Used by robustness-service.ts when dryRun=true to suppress "
            "cache artifacts during replay-grading runs."
        ),
    )
    args = parser.parse_args()

    if args.dry_run:
        print("[optimizer] --dry-run: cache writes suppressed, result computed normally", file=sys.stderr)

    # Load config from file path (python-runner writes a temp JSON file)
    try:
        with open(args.config, "r") as f:
            config_data = json.load(f)
    except Exception as config_err:
        print(json.dumps({"error": f"Failed to load config from {args.config}: {config_err}"}))
        sys.exit(1)

    try:
        from src.engine.config import StrategyConfig
        strategy_config = StrategyConfig(**config_data.get("strategy", config_data))
    except Exception as parse_err:
        print(json.dumps({"error": f"Failed to parse StrategyConfig: {parse_err}"}))
        sys.exit(1)

    # Load data for optimization — uses local_path from config if provided
    try:
        from src.engine.data_loader import load_ohlcv
        data_params = config_data.get("data", {})
        data = load_ohlcv(
            symbol=data_params.get("symbol", strategy_config.symbol),
            timeframe=data_params.get("timeframe", strategy_config.timeframe),
            start=data_params.get("start", "2023-01-01"),
            end=data_params.get("end", "2023-12-31"),
            local_path=data_params.get("local_path"),
        )
    except Exception as data_err:
        print(json.dumps({"error": f"Failed to load data: {data_err}"}))
        sys.exit(1)

    n_trials = config_data.get("n_trials", 800)

    try:
        if args.mode == "robustness":
            result = run_robustness_test(strategy_config, data, n_trials=n_trials)
        else:
            result = optimize_strategy(strategy_config, data, n_trials=n_trials)
    except Exception as run_err:
        print(json.dumps({"error": f"Optimizer run failed: {run_err}"}))
        sys.exit(1)

    # Cache write (skipped in dry-run mode)
    import hashlib as _hashlib
    cache_key = _hashlib.sha256(
        f"{strategy_config.name}:{strategy_config.symbol}:{n_trials}:{args.mode}".encode()
    ).hexdigest()[:16]
    _write_optimizer_cache(cache_key, result, dry_run=args.dry_run)

    print(json.dumps(result))
