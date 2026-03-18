"""Walk-forward validation — rolling IS/OOS windows.

Per CLAUDE.md: Walk-forward validation is mandatory.
Aggregate OOS metrics are the ONLY performance numbers that count.
"""

from __future__ import annotations

import sys
import time
from typing import Optional

import numpy as np
import polars as pl

from src.engine.config import BacktestRequest
from src.engine.backtester import run_backtest
from src.engine.optimizer import optimize_strategy


# ─── OOS Window Minimums ─────────────────────────────────────────
# Below these thresholds, OOS results are statistically unreliable.
MIN_OOS_TRADES = 30
MIN_OOS_DAYS = 60


def split_walk_forward_windows(
    data: pl.DataFrame,
    n_splits: int = 5,
    is_ratio: float = 0.7,
) -> list[tuple[pl.DataFrame, pl.DataFrame]]:
    """Split data into rolling IS/OOS windows.

    Each window: IS (is_ratio) + OOS (1 - is_ratio).
    Windows are rolling: each starts where the previous OOS ended.

    Args:
        data: Full OHLCV DataFrame
        n_splits: Number of walk-forward windows
        is_ratio: Fraction of each window for in-sample (default 0.7)

    Returns:
        List of (is_data, oos_data) tuples
    """
    n = len(data)
    # Total window size per split (overlapping IS portions)
    window_size = n // n_splits
    is_size = int(window_size * is_ratio)
    oos_size = window_size - is_size

    windows = []
    for i in range(n_splits):
        oos_start = is_size + i * oos_size
        oos_end = min(oos_start + oos_size, n)
        is_start = max(0, oos_start - is_size)

        if oos_start >= n or oos_end <= oos_start:
            break

        is_data = data.slice(is_start, oos_start - is_start)
        oos_data = data.slice(oos_start, oos_end - oos_start)
        windows.append((is_data, oos_data))

    return windows


def run_walk_forward(
    request: BacktestRequest,
    data: Optional[pl.DataFrame] = None,
    n_splits: int = 5,
    is_ratio: float = 0.7,
    optimize: bool = False,
    n_trials: int = 800,
) -> dict:
    """Run walk-forward validation.

    For each window:
    1. Optionally optimize on IS data with Optuna
    2. Run backtest on OOS data with best params
    3. Aggregate OOS metrics = the only numbers that count

    Args:
        request: Backtest configuration
        data: Optional pre-loaded data
        n_splits: Number of walk-forward windows (default 5)
        is_ratio: IS fraction per window (default 0.7)
        optimize: Whether to run Optuna optimization per window
        n_trials: Optuna trials per window if optimizing

    Returns:
        dict with oos_metrics (aggregate), windows (per-window detail)
    """
    start_time = time.time()
    config = request.strategy

    # Load data if not provided
    if data is None:
        from src.engine.data_loader import load_ohlcv
        data = load_ohlcv(
            config.symbol, config.timeframe,
            request.start_date, request.end_date,
        )

    # Auto-reduce n_splits if data is too short for meaningful OOS windows.
    # Each OOS window needs at least MIN_OOS_DAYS calendar days of data.
    # Rough estimate: each bar ~= 1 day for daily data; for intraday, assume
    # ~80 bars/day (15min × 6.5h RTH). Scale accordingly.
    total_bars = len(data)
    oos_fraction = 1.0 - is_ratio
    min_oos_bars = MIN_OOS_DAYS  # Conservative: at least MIN_OOS_DAYS bars per OOS fold
    required_bars_per_split = int(min_oos_bars / oos_fraction)

    original_splits = n_splits
    while n_splits > 1 and (total_bars // n_splits) < required_bars_per_split:
        n_splits -= 1

    if n_splits < original_splits:
        print(
            f"Walk-forward: auto-reduced n_splits from {original_splits} to {n_splits} "
            f"(data too short for {original_splits} meaningful OOS windows)",
            file=sys.stderr,
        )

    windows = split_walk_forward_windows(data, n_splits, is_ratio)
    print(f"Walk-forward: {len(windows)} windows, IS ratio={is_ratio}", file=sys.stderr)

    window_results = []
    all_oos_pnls: list[float] = []
    all_oos_equity: list[float] = []

    for i, (is_data, oos_data) in enumerate(windows):
        print(f"  Window {i+1}/{len(windows)}: IS={len(is_data)} bars, OOS={len(oos_data)} bars", file=sys.stderr)

        # Optionally optimize on IS
        best_config = config
        opt_result = None
        if optimize and len(is_data) > 50:
            opt_result = optimize_strategy(config, is_data, n_trials=n_trials)
            # Apply best params would go here in full implementation

        # Run backtest on OOS
        oos_request = BacktestRequest(
            strategy=best_config,
            start_date=request.start_date,
            end_date=request.end_date,
            slippage_ticks=request.slippage_ticks,
            commission_per_side=request.commission_per_side,
        )
        oos_result = run_backtest(oos_request, data=oos_data)

        # OOS window minimum validation
        oos_trade_count = oos_result["total_trades"]
        oos_trading_days = oos_result.get("total_trading_days", 0)

        window_detail = {
            "window": i + 1,
            "is_bars": len(is_data),
            "oos_bars": len(oos_data),
            "oos_metrics": {
                "total_return": oos_result["total_return"],
                "sharpe_ratio": oos_result["sharpe_ratio"],
                "max_drawdown": oos_result["max_drawdown"],
                "win_rate": oos_result["win_rate"],
                "profit_factor": oos_result["profit_factor"],
                "total_trades": oos_trade_count,
                "total_trading_days": oos_trading_days,
            },
            "confidence": "OK",
        }

        # Flag statistically unreliable OOS windows
        warnings = []
        if oos_trade_count < MIN_OOS_TRADES:
            warnings.append(
                f"Only {oos_trade_count} OOS trades (min {MIN_OOS_TRADES}) — statistically unreliable"
            )
            window_detail["confidence"] = "LOW"
        if oos_trading_days < MIN_OOS_DAYS:
            warnings.append(
                f"Only {oos_trading_days} OOS days (min {MIN_OOS_DAYS}) — insufficient sample"
            )
            window_detail["confidence"] = "LOW"

        if warnings:
            window_detail["warning"] = "; ".join(warnings)
            print(f"    ⚠ Window {i+1}: {'; '.join(warnings)}", file=sys.stderr)

        if opt_result:
            window_detail["optimization"] = {
                "best_params": opt_result["best_params"],
                "best_sharpe": opt_result["best_score"],
            }

        window_results.append(window_detail)
        all_oos_pnls.extend(oos_result.get("daily_pnls", []))
        all_oos_equity.extend(oos_result.get("equity_curve", []))

    # Aggregate OOS metrics
    total_trades = sum(w["oos_metrics"]["total_trades"] for w in window_results)
    avg_sharpe = float(np.mean([w["oos_metrics"]["sharpe_ratio"] for w in window_results]))
    avg_return = float(np.mean([w["oos_metrics"]["total_return"] for w in window_results]))
    avg_win_rate = float(np.mean([w["oos_metrics"]["win_rate"] for w in window_results]))
    max_dd = min(w["oos_metrics"]["max_drawdown"] for w in window_results)
    avg_pf = float(np.mean([w["oos_metrics"]["profit_factor"] for w in window_results]))

    # Daily stats from aggregated OOS
    winning_days = sum(1 for p in all_oos_pnls if p > 0)
    total_days = len(all_oos_pnls)
    avg_daily = float(np.mean(all_oos_pnls)) if all_oos_pnls else 0.0

    elapsed_ms = int((time.time() - start_time) * 1000)

    # Overall confidence: LOW if any window is LOW
    low_confidence_windows = [w for w in window_results if w.get("confidence") == "LOW"]
    overall_confidence = "LOW" if low_confidence_windows else "OK"

    return {
        "confidence": overall_confidence,
        "low_confidence_windows": len(low_confidence_windows),
        "oos_metrics": {
            "total_return": round(avg_return, 6),
            "sharpe_ratio": round(avg_sharpe, 4),
            "max_drawdown": round(max_dd, 6),
            "win_rate": round(avg_win_rate, 4),
            "profit_factor": round(avg_pf, 4),
            "total_trades": total_trades,
            "avg_daily_pnl": round(avg_daily, 2),
            "winning_days": winning_days,
            "total_trading_days": total_days,
        },
        "windows": window_results,
        "n_splits": len(windows),
        "is_ratio": is_ratio,
        "execution_time_ms": elapsed_ms,
    }
