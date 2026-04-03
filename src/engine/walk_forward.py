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
from src.engine.backtester import run_backtest, run_class_backtest
from src.engine.strategy_base import BaseStrategy
from src.engine.optimizer import optimize_strategy, _apply_params, _build_search_space
from src.engine.sanity_checks import run_sanity_checks
from src.engine.cross_validation import run_cross_validation
from src.engine.nvtx_markers import range_push, range_pop


# ─── OOS Window Minimums ─────────────────────────────────────────
# Below these thresholds, OOS results are statistically unreliable.
MIN_OOS_TRADES = 30
MIN_OOS_DAYS = 60


def split_walk_forward_windows(
    data: pl.DataFrame,
    n_splits: int = 5,
    is_ratio: float = 0.7,
    embargo_bars: int = 0,
) -> list[tuple[pl.DataFrame, pl.DataFrame]]:
    """Split data into anchored walk-forward windows.

    Anchored approach: the first is_ratio of data is the minimum IS warmup.
    The remaining (1 - is_ratio) is divided into n_splits non-overlapping OOS chunks.
    Each window's IS = all data from start up to that OOS chunk (expanding IS).
    OOS chunks are sequential and non-overlapping, covering the full post-warmup range.

    Example with 10yr data, is_ratio=0.7, n_splits=5:
        Warmup: first 7 years (IS minimum)
        OOS chunks: 5 × ~7.2 months each, covering years 7-10
        W1: IS=yr 0-7.6,  OOS=yr 7.0-7.6
        W2: IS=yr 0-8.2,  OOS=yr 7.6-8.2
        ...expanding IS, non-overlapping OOS

    Args:
        data: Full OHLCV DataFrame
        n_splits: Number of walk-forward windows
        is_ratio: Fraction of total data reserved as minimum IS warmup (default 0.7)
        embargo_bars: Bars to skip between IS and OOS to prevent leakage (default 0)

    Returns:
        List of (is_data, oos_data) tuples
    """
    n = len(data)
    min_is_bars = int(n * is_ratio)
    oos_total = n - min_is_bars
    oos_chunk_size = oos_total // n_splits

    windows = []
    for i in range(n_splits):
        oos_start = min_is_bars + i * oos_chunk_size
        oos_end = min_is_bars + (i + 1) * oos_chunk_size if i < n_splits - 1 else n

        if oos_start + embargo_bars >= n or oos_end <= oos_start + embargo_bars:
            break

        is_end = oos_start  # IS goes up to OOS start
        is_data = data.slice(0, is_end)
        oos_data = data.slice(oos_start + embargo_bars, oos_end - oos_start - embargo_bars)
        windows.append((is_data, oos_data))

    return windows


def run_walk_forward(
    request: BacktestRequest,
    data: Optional[pl.DataFrame] = None,
    n_splits: int = 5,
    is_ratio: float = 0.7,
    optimize: bool = False,
    n_trials: int = 800,
    embargo_bars: int = 20,
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

    windows = split_walk_forward_windows(data, n_splits, is_ratio, embargo_bars=embargo_bars)
    print(f"Walk-forward: {len(windows)} windows, IS ratio={is_ratio}", file=sys.stderr)

    window_results = []
    all_oos_pnls: list[float] = []
    all_oos_pnl_records: list[dict] = []
    all_oos_equity: list[float] = []
    all_oos_trades: list[dict] = []

    for i, (is_data, oos_data) in enumerate(windows):
        range_push(f"forge/wf_window_{i}")
        print(f"  Window {i+1}/{len(windows)}: IS={len(is_data)} bars, OOS={len(oos_data)} bars", file=sys.stderr)

        # Optionally optimize on IS, then apply best params to OOS
        best_config = config
        opt_result = None
        if optimize and len(is_data) > 50:
            opt_result = optimize_strategy(config, is_data, n_trials=n_trials)
            if opt_result["best_params"]:
                space = _build_search_space(config)
                best_config = _apply_params(config, opt_result["best_params"], space)
                print(f"    Optimized: applied {opt_result['best_params']} (IS Sharpe={opt_result['best_score']:.4f})", file=sys.stderr)

        # Run backtest on OOS
        oos_request = BacktestRequest(
            strategy=best_config,
            start_date=request.start_date,
            end_date=request.end_date,
            slippage_ticks=request.slippage_ticks,
            commission_per_side=request.commission_per_side,
            firm_key=request.firm_key,
            max_trades_per_day=request.max_trades_per_day,
            event_calendar=request.event_calendar,
            fill_model=request.fill_model,
        )
        oos_result = run_backtest(oos_request, data=oos_data)

        # OOS window minimum validation
        oos_trade_count = oos_result["total_trades"]
        oos_trading_days = oos_result.get("total_trading_days", 0)

        # Extract date boundaries for persistence (guard against empty slices)
        is_start_dt = str(is_data["ts_event"][0])[:10] if len(is_data) > 0 else ""
        is_end_dt = str(is_data["ts_event"][-1])[:10] if len(is_data) > 0 else ""
        oos_start_dt = str(oos_data["ts_event"][0])[:10] if len(oos_data) > 0 else ""
        oos_end_dt = str(oos_data["ts_event"][-1])[:10] if len(oos_data) > 0 else ""

        window_detail = {
            "window": i + 1,
            "is_bars": len(is_data),
            "oos_bars": len(oos_data),
            "is_start": is_start_dt,
            "is_end": is_end_dt,
            "oos_start": oos_start_dt,
            "oos_end": oos_end_dt,
            "oos_metrics": {
                "total_return": oos_result["total_return"],
                "sharpe_ratio": oos_result["sharpe_ratio"],
                "max_drawdown": oos_result["max_drawdown"],
                "win_rate": oos_result["win_rate"],
                "profit_factor": oos_result["profit_factor"],
                "total_trades": oos_trade_count,
                "total_trading_days": oos_trading_days,
                "avg_trade_pnl": round(oos_result["total_return"] / max(oos_trade_count, 1), 2),
                "avg_daily_pnl": round(float(sum(oos_result.get("daily_pnls", [])) / max(len(oos_result.get("daily_pnls", [])), 1)), 2),
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
                "trials_used": opt_result.get("trials_used", opt_result.get("n_trials", 0)),
            }

        window_results.append(window_detail)
        all_oos_pnls.extend(oos_result.get("daily_pnls", []))
        all_oos_pnl_records.extend(oos_result.get("daily_pnl_records", []))
        all_oos_equity.extend(oos_result.get("equity_curve", []))
        all_oos_trades.extend(oos_result.get("trades", []))
        range_pop()  # forge/wf_window_{i}

    # Aggregate OOS metrics — recompute from ALL trades, never average per-window rates
    total_trades = len(all_oos_trades)
    total_return = float(sum(w["oos_metrics"]["total_return"] for w in window_results))  # Sum dollar P&L

    # Continuous max DD: compute from concatenated OOS daily P&Ls (not per-window max)
    if all_oos_pnls:
        cum_pnl = np.cumsum(all_oos_pnls)
        running_peak = np.maximum.accumulate(cum_pnl)
        max_dd = float(np.max(running_peak - cum_pnl))
    else:
        max_dd = 0.0

    # Win rate: count wins across ALL trades (not averaged per-window)
    if all_oos_trades:
        total_wins = sum(1 for t in all_oos_trades if float(t.get("PnL", t.get("pnl", 0))) > 0)
        agg_win_rate = float(total_wins / len(all_oos_trades))
    else:
        agg_win_rate = 0.0

    # Profit factor: sum(gross wins) / sum(gross losses) across ALL trades
    gross_wins = sum(float(t.get("PnL", t.get("pnl", 0))) for t in all_oos_trades if float(t.get("PnL", t.get("pnl", 0))) > 0)
    gross_losses = sum(abs(float(t.get("PnL", t.get("pnl", 0)))) for t in all_oos_trades if float(t.get("PnL", t.get("pnl", 0))) < 0)
    agg_pf = float(gross_wins / gross_losses) if gross_losses > 0 else 999.99

    # Sharpe: recompute from all daily P&Ls (not averaged per-window)
    if len(all_oos_pnls) > 1:
        pnl_arr = np.array(all_oos_pnls)
        agg_sharpe = float(np.mean(pnl_arr) / np.std(pnl_arr, ddof=1) * np.sqrt(252)) if np.std(pnl_arr, ddof=1) > 0 else 0.0
    else:
        agg_sharpe = 0.0

    # Daily stats from aggregated OOS
    winning_days = sum(1 for p in all_oos_pnls if p > 0)
    total_days = len(all_oos_pnls)
    avg_daily = float(np.mean(all_oos_pnls)) if all_oos_pnls else 0.0

    elapsed_ms = int((time.time() - start_time) * 1000)

    # Overall confidence: LOW if any window is LOW
    low_confidence_windows = [w for w in window_results if w.get("confidence") == "LOW"]
    overall_confidence = "LOW" if low_confidence_windows else "OK"

    # Param stability check across optimization windows
    param_stability = None
    if optimize:
        opt_windows = [w for w in window_results if w.get("optimization")]
        if len(opt_windows) >= 2:
            # Collect param values per window
            all_param_names = set()
            for w in opt_windows:
                all_param_names.update(w["optimization"]["best_params"].keys())

            stability = {}
            fragile = False
            for pname in all_param_names:
                vals = [w["optimization"]["best_params"].get(pname) for w in opt_windows if pname in w["optimization"]["best_params"]]
                if len(vals) >= 2:
                    mean_val = float(np.mean(vals))
                    std_val = float(np.std(vals))
                    cv = std_val / abs(mean_val) if mean_val != 0 else 0
                    stability[pname] = {
                        "mean": round(mean_val, 2),
                        "std": round(std_val, 2),
                        "cv": round(cv, 4),
                        "values": vals,
                    }
                    if cv > 0.30:
                        fragile = True

            param_stability = {
                "params": stability,
                "is_fragile": fragile,
                "warning": "Param variance > 30% across windows — likely overfitting" if fragile else None,
            }
            if fragile:
                overall_confidence = "LOW"
                print(f"  Param stability: FRAGILE — variance > 30% across windows", file=sys.stderr)

    # ─── Prop firm compliance on aggregated OOS results ─────
    prop_compliance = None
    if all_oos_pnl_records and all_oos_trades:
        from src.engine.prop_sim import simulate_all_firms
        symbol = request.strategy.symbol if hasattr(request.strategy, "symbol") else request.strategy.get("symbol", "MES")
        prop_compliance = simulate_all_firms(
            all_oos_pnl_records, all_oos_trades,
            symbol=symbol, account_size=50_000,
            overnight_hold=False,
        )

    return {
        "confidence": overall_confidence,
        "low_confidence_windows": len(low_confidence_windows),
        "oos_metrics": {
            "total_return": round(total_return, 2),
            "sharpe_ratio": round(agg_sharpe, 4),
            "max_drawdown": round(max_dd, 2),
            "win_rate": round(agg_win_rate, 4),
            "profit_factor": round(agg_pf, 4),
            "total_trades": total_trades,
            "avg_trade_pnl": round(total_return / max(total_trades, 1), 2),
            "avg_daily_pnl": round(avg_daily, 2),
            "winning_days": winning_days,
            "total_trading_days": total_days,
        },
        "trades": all_oos_trades,
        "daily_pnls": all_oos_pnls,
        "daily_pnl_records": all_oos_pnl_records,
        "equity_curve": all_oos_equity,
        "windows": window_results,
        "n_splits": len(windows),
        "is_ratio": is_ratio,
        "param_stability": param_stability,
        "prop_compliance": prop_compliance,
        "execution_time_ms": elapsed_ms,
    }


def run_walk_forward_class(
    strategy: BaseStrategy,
    start_date: str,
    end_date: str,
    slippage_ticks: float = 1.0,
    commission_per_side: float = 0.62,
    firm_key: Optional[str] = None,
    n_splits: int = 8,
    is_ratio: float = 0.5,
    embargo_bars: int = 20,
) -> dict:
    """Walk-forward validation for class-based (BaseStrategy) strategies.

    Same windowing logic as run_walk_forward(), but each OOS window calls
    run_class_backtest() instead of run_backtest().
    """
    start_time = time.time()
    symbol = strategy.symbol
    timeframe = strategy.timeframe

    # Load data
    from src.engine.data_loader import load_ohlcv
    data = load_ohlcv(symbol, timeframe, start_date, end_date)

    # Load daily data once for HTF context (shared across all OOS windows)
    daily_data = None
    htf_cache = None
    try:
        daily_data = load_ohlcv(symbol, "daily", start_date, end_date)
        print(f"Walk-forward: loaded {len(daily_data)} daily bars for HTF context", file=sys.stderr)
    except Exception as e:
        print(f"Walk-forward: could not load daily data for HTF gate: {e}", file=sys.stderr)

    if daily_data is not None and len(daily_data) >= 200:
        from src.engine.context.htf_context import compute_htf_context
        htf_cache = {}
        # Use ts_et for day keys to avoid UTC/ET date mismatch at midnight boundary
        _htf_ts_col = "ts_et" if "ts_et" in daily_data.columns else "ts_event"
        for day_idx in range(200, len(daily_data)):
            bar_date = daily_data[_htf_ts_col][day_idx]
            day_key = str(bar_date)[:10]
            htf_cache[day_key] = compute_htf_context(
                daily_df=daily_data.slice(0, day_idx),
                four_h_df=None,
                one_h_df=None,
                current_price=float(daily_data["close"][day_idx - 1]),
                bar_date=bar_date,
            )
        print(f"Walk-forward: built HTF cache with {len(htf_cache)} days", file=sys.stderr)

    # Auto-reduce splits if data too short
    total_bars = len(data)
    oos_fraction = 1.0 - is_ratio
    min_oos_bars = MIN_OOS_DAYS
    required_bars_per_split = int(min_oos_bars / oos_fraction)

    original_splits = n_splits
    while n_splits > 1 and (total_bars // n_splits) < required_bars_per_split:
        n_splits -= 1

    if n_splits < original_splits:
        print(
            f"Walk-forward (class): auto-reduced n_splits from {original_splits} to {n_splits}",
            file=sys.stderr,
        )

    windows = split_walk_forward_windows(data, n_splits, is_ratio, embargo_bars=embargo_bars)
    print(f"Walk-forward (class): {len(windows)} windows, IS ratio={is_ratio}", file=sys.stderr)

    window_results = []
    all_oos_pnls: list[float] = []
    all_oos_pnl_records: list[dict] = []
    all_oos_trades: list[dict] = []

    for i, (is_data, oos_data) in enumerate(windows):
        print(f"  Window {i+1}/{len(windows)}: IS={len(is_data)} bars, OOS={len(oos_data)} bars", file=sys.stderr)

        # Run class-based backtest on OOS data
        # Eligibility gate OFF for backtesting — test the STRATEGY, not the gate.
        # The gate is a live-trading filter (kill zones, bias, sweeps). Applying it
        # in backtests kills 90%+ of signals, producing statistically meaningless
        # results (4-122 trades over 2 years). Gate will be re-enabled when
        # the bias engine and context layer are properly calibrated.
        oos_result = run_class_backtest(
            strategy=strategy,
            start_date=start_date,
            end_date=end_date,
            slippage_ticks=slippage_ticks,
            commission_per_side=commission_per_side,
            firm_key=firm_key,
            data=oos_data,
            htf_cache=htf_cache,
            daily_data=daily_data,
            skip_eligibility_gate=True,
        )

        oos_trade_count = oos_result.get("total_trades", 0)
        oos_trading_days = oos_result.get("total_trading_days", 0)

        # Extract date boundaries for persistence (guard against empty slices)
        is_start_dt = str(is_data["ts_event"][0])[:10] if len(is_data) > 0 else ""
        is_end_dt = str(is_data["ts_event"][-1])[:10] if len(is_data) > 0 else ""
        oos_start_dt = str(oos_data["ts_event"][0])[:10] if len(oos_data) > 0 else ""
        oos_end_dt = str(oos_data["ts_event"][-1])[:10] if len(oos_data) > 0 else ""

        window_detail = {
            "window": i + 1,
            "is_bars": len(is_data),
            "oos_bars": len(oos_data),
            "is_start": is_start_dt,
            "is_end": is_end_dt,
            "oos_start": oos_start_dt,
            "oos_end": oos_end_dt,
            "oos_metrics": {
                "total_return": oos_result.get("total_return", 0),
                "sharpe_ratio": oos_result.get("sharpe_ratio", 0),
                "max_drawdown": oos_result.get("max_drawdown", 0),
                "win_rate": oos_result.get("win_rate", 0),
                "profit_factor": oos_result.get("profit_factor", 0),
                "total_trades": oos_trade_count,
                "total_trading_days": oos_trading_days,
                "avg_trade_pnl": round(oos_result.get("total_return", 0) / max(oos_trade_count, 1), 2),
                "avg_daily_pnl": round(float(sum(oos_result.get("daily_pnls", [])) / max(len(oos_result.get("daily_pnls", [])), 1)), 2),
            },
            "avg_rr": oos_result.get("avg_rr", 0),
            "avg_winner_rr": oos_result.get("avg_winner_rr", 0),
            "avg_loser_rr": oos_result.get("avg_loser_rr", 0),
            "confidence": "OK",
        }

        warnings = []
        if oos_trade_count < MIN_OOS_TRADES:
            warnings.append(f"Only {oos_trade_count} OOS trades (min {MIN_OOS_TRADES})")
            window_detail["confidence"] = "LOW"
        if oos_trading_days < MIN_OOS_DAYS:
            warnings.append(f"Only {oos_trading_days} OOS days (min {MIN_OOS_DAYS})")
            window_detail["confidence"] = "LOW"
        if warnings:
            window_detail["warning"] = "; ".join(warnings)

        window_results.append(window_detail)
        all_oos_pnls.extend(oos_result.get("daily_pnls", []))
        all_oos_pnl_records.extend(oos_result.get("daily_pnl_records", []))
        all_oos_trades.extend(oos_result.get("trades", []))

    # Aggregate OOS metrics — recompute from ALL trades, never average per-window rates
    total_trades = len(all_oos_trades)
    total_return = float(sum(w["oos_metrics"]["total_return"] for w in window_results))  # Sum of dollar P&L across windows

    # Continuous max DD: compute from concatenated OOS daily P&Ls (not per-window max)
    if all_oos_pnls:
        cum_pnl = np.cumsum(all_oos_pnls)
        running_peak = np.maximum.accumulate(cum_pnl)
        max_dd = float(np.max(running_peak - cum_pnl))
    else:
        max_dd = 0.0

    # Win rate: count wins across ALL trades (not averaged per-window)
    if all_oos_trades:
        total_wins = sum(1 for t in all_oos_trades if float(t.get("PnL", t.get("pnl", 0))) > 0)
        agg_win_rate = float(total_wins / len(all_oos_trades))
    else:
        agg_win_rate = 0.0

    # Profit factor: sum(wins) / sum(losses) across ALL trades (not averaged per-window)
    gross_wins = sum(float(t.get("PnL", t.get("pnl", 0))) for t in all_oos_trades if float(t.get("PnL", t.get("pnl", 0))) > 0)
    gross_losses = sum(abs(float(t.get("PnL", t.get("pnl", 0)))) for t in all_oos_trades if float(t.get("PnL", t.get("pnl", 0))) < 0)
    agg_pf = float(gross_wins / gross_losses) if gross_losses > 0 else 999.99

    # Sharpe: recompute from all daily P&Ls (not averaged per-window)
    if len(all_oos_pnls) > 1:
        pnl_arr = np.array(all_oos_pnls)
        agg_sharpe = float(np.mean(pnl_arr) / np.std(pnl_arr, ddof=1) * np.sqrt(252)) if np.std(pnl_arr, ddof=1) > 0 else 0.0
    else:
        agg_sharpe = 0.0

    winning_days = sum(1 for p in all_oos_pnls if p > 0)
    total_days = len(all_oos_pnls)
    avg_daily = float(np.mean(all_oos_pnls)) if all_oos_pnls else 0.0

    elapsed_ms = int((time.time() - start_time) * 1000)

    low_confidence_windows = [w for w in window_results if w.get("confidence") == "LOW"]

    # Run sanity checks and cross-validation on aggregated OOS data
    _oos_aggregate = {
        "total_return": round(total_return, 2),
        "sharpe_ratio": round(agg_sharpe, 4),
        "max_drawdown": round(max_dd, 6),
        "win_rate": round(agg_win_rate, 4),
        "profit_factor": round(agg_pf, 4),
        "total_trades": total_trades,
        "avg_trade_pnl": round(total_return / max(total_trades, 1), 2),
        "avg_daily_pnl": round(avg_daily, 2),
        "winning_days": winning_days,
        "total_trading_days": total_days,
        "daily_pnls": all_oos_pnls,
        "equity_curve": [],
        "trades": all_oos_trades,
    }
    sanity = run_sanity_checks(_oos_aggregate, is_walk_forward_aggregate=True, symbol=symbol, timeframe=strategy.timeframe)

    # Compute average IS Sharpe across optimization windows for WFE
    avg_is_sharpe = None
    if optimize:
        is_sharpes = [w["optimization"]["best_sharpe"] for w in window_results if w.get("optimization")]
        if is_sharpes:
            avg_is_sharpe = float(np.mean(is_sharpes))

    cross_val = run_cross_validation(_oos_aggregate, is_sharpe=avg_is_sharpe)

    # ─── Prop firm compliance on aggregated OOS results ─────
    prop_compliance = None
    if all_oos_pnl_records and all_oos_trades:
        from src.engine.prop_sim import simulate_all_firms
        prop_compliance = simulate_all_firms(
            all_oos_pnl_records, all_oos_trades,
            symbol=symbol, account_size=50_000,
            overnight_hold=False,
        )

    return {
        "confidence": "LOW" if low_confidence_windows else "OK",
        "low_confidence_windows": len(low_confidence_windows),
        "oos_metrics": {
            "total_return": round(total_return, 2),
            "sharpe_ratio": round(agg_sharpe, 4),
            "max_drawdown": round(max_dd, 2),
            "win_rate": round(agg_win_rate, 4),
            "profit_factor": round(agg_pf, 4),
            "total_trades": total_trades,
            "avg_trade_pnl": round(total_return / max(total_trades, 1), 2),
            "avg_daily_pnl": round(avg_daily, 2),
            "winning_days": winning_days,
            "total_trading_days": total_days,
        },
        "daily_pnls": all_oos_pnls,
        "daily_pnl_records": all_oos_pnl_records,
        "trades": all_oos_trades,
        "windows": window_results,
        "n_splits": len(windows),
        "is_ratio": is_ratio,
        "execution_time_ms": elapsed_ms,
        "sanity_checks": sanity,
        "cross_validation": cross_val,
        "prop_compliance": prop_compliance,
    }
