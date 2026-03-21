"""Trading Forge — Core Backtest Engine.

Orchestrates: data loading → indicators → signals → vectorbt portfolio.
CLI: python backtester.py --config <json> --backtest-id <uuid> --mode single|walkforward
Output: JSON to stdout, progress/errors to stderr (matches databento.ts bridge pattern).
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Optional

import click
import numpy as np
import pandas as pd
import polars as pl
import vectorbt as vbt

from src.engine.config import (
    BacktestRequest,
    CONTRACT_SPECS,
    IndicatorConfig,
    StrategyConfig,
)
from src.engine.data_loader import load_ohlcv, flag_rollover_days, compute_dataset_hash
from src.engine.firm_config import get_commission_per_side, get_contract_cap, FIRM_CONTRACT_CAPS
from src.engine.indicators.core import compute_indicators, compute_atr
from src.engine.liquidity import get_session_multipliers
from src.engine.signals import generate_signals
from src.engine.sizing import compute_position_sizes
from src.engine.slippage import compute_slippage
from src.engine.analytics import compute_full_analytics
from src.engine.prop_sim import simulate_all_firms
from src.engine.strategy_base import BaseStrategy
from src.engine.decay.half_life import fit_decay
from src.engine.decay.sub_signals import composite_decay_score
from src.engine.sanity_checks import run_sanity_checks
from src.engine.cross_validation import run_cross_validation


# ─── Signal Fill Convention ──────────────────────────────────────────
# PRODUCTION STANDARD: "next-bar fill" — signal on bar N, fill on bar N+1.
#
# How it works:
#   - generate_signals() / strategy.compute() produce entry signals on bar N.
#   - Before passing to vectorbt, we shift all entry signals forward by 1 bar
#     using np.roll(). This means the signal generated from bar N's data is
#     filled at bar N+1's close price.
#   - This eliminates lookahead bias: you observe bar N, decide to enter, and
#     your fill occurs at the next available bar (N+1).
#   - Exit signals are NOT shifted — exits are managed by _apply_trade_management()
#     bar-by-bar for class-based strategies, or by vectorbt for DSL strategies.
#
# Why this matters:
#   - Same-bar fills assume you can observe a bar's close AND get filled at that
#     same close. In practice, by the time you see the close, the next bar has
#     already started. NautilusTrader, QuantConnect, Zipline, and Backtrader all
#     default to next-bar fills.
#   - Every result produced with same-bar fills is inflated by lookahead.
# ─────────────────────────────────────────────────────────────────────

# ─── Multi-TF Look-Ahead Prevention Convention ─────────────────────
# When using higher-timeframe (daily/4H/1H) indicators to filter
# lower-timeframe signals (e.g., 15min entries), you MUST use the
# PREVIOUS completed bar's value — never the current incomplete bar.
#
#   daily_sma = daily_df["sma_20"].shift(1)    # previous completed daily bar
#   h4_atr    = h4_df["atr_14"].shift(1)       # previous completed 4H bar
#
# Rationale: At 10:30 AM on an intraday bar, today's daily SMA is
# still forming. Using it is look-ahead bias. shift(1) ensures only
# fully settled higher-TF values are used for filtering.
#
# Any function that merges higher-TF data into lower-TF DataFrames
# must apply shift(1) to the higher-TF columns BEFORE the merge/join.


def apply_eligibility_gate(
    entry_signals,
    exit_signals,
    df,
    direction,
    symbol,
    firm_key=None,
    htf_cache=None,
    spec=None,
    strategy_name: str = "",
):
    """Apply 7-layer eligibility gate to filter signals (A+ only).

    Per-bar loop: for each True entry signal, compute session context, bias,
    playbook, location score, structural stop, targets, then call evaluate_signal().
    TAKE = keep, REDUCE = keep, SKIP = remove.

    Graceful fallback: if htf_cache is None, return signals unchanged (backward compatible).

    Returns:
        Tuple of (filtered_entries, filtered_exits, gate_stats)
    """
    from src.engine.context.htf_context import HTFContext
    from src.engine.context.session_context import compute_session_context
    from src.engine.context.bias_engine import compute_bias
    from src.engine.context.playbook_router import route_playbook
    from src.engine.context.location_score import compute_location_score
    from src.engine.context.structural_stops import compute_structural_stop
    from src.engine.context.structural_targets import compute_targets
    from src.engine.context.eligibility_gate import evaluate_signal

    gate_stats = {"total": 0, "take": 0, "reduce": 0, "skip": 0, "skip_reasons": {}}

    # Backward compatible: no HTF cache → passthrough
    if htf_cache is None or len(htf_cache) == 0:
        return entry_signals, exit_signals, gate_stats

    # Unregistered strategy bypass: if strategy_name doesn't appear in ANY
    # playbook's allowed_strategies, skip the gate entirely. This prevents
    # new/unregistered strategies from being silently killed during backtesting.
    from src.engine.context.playbook_router import ALL_STRATS
    strat_normalized = strategy_name.lower().replace("strategy", "").strip().replace("_", "")
    all_normalized = [s.lower().replace("_", "") for s in ALL_STRATS]
    if strat_normalized and strat_normalized not in all_normalized:
        return entry_signals, exit_signals, gate_stats

    filtered = entry_signals.copy()
    signal_indices = np.where(entry_signals)[0]
    gate_stats["total"] = len(signal_indices)

    if len(signal_indices) == 0:
        return filtered, exit_signals, gate_stats

    # Pre-extract numpy arrays for speed
    close_np = df["close"].to_numpy()
    high_np = df["high"].to_numpy() if "high" in df.columns else close_np
    low_np = df["low"].to_numpy() if "low" in df.columns else close_np
    ts_col = "ts_event"
    has_ts = ts_col in df.columns

    # Structural columns (may not exist for non-ICT strategies)
    has_ob = "at_order_block" in df.columns
    has_fvg = "at_fvg" in df.columns
    has_sweep = "after_sweep" in df.columns

    # VWAP (pass 0 if not available — location score gives neutral 8/15)
    has_vwap = "vwap" in df.columns

    # ATR for stop/target computation
    atr_np = df["atr_14"].to_numpy() if "atr_14" in df.columns else np.full(len(df), 0.0)

    point_value = spec.point_value if spec else 5.0
    tick_size = spec.tick_size if spec else 0.25

    for idx in signal_indices:
        entry_price = float(close_np[idx])

        # Get day key for HTF cache lookup (use ET to match HTF cache keys)
        _gate_ts_col = "ts_et" if "ts_et" in df.columns else ts_col
        if has_ts:
            bar_ts = df[_gate_ts_col][int(idx)]
            day_key = str(bar_ts)[:10]
        else:
            day_key = None

        # Look up HTF context from pre-computed cache
        htf = htf_cache.get(day_key) if day_key else None
        if htf is None:
            # No HTF data for this day — keep signal (can't evaluate without context)
            # but count it as a passthrough so stats are honest
            gate_stats["take"] += 1
            gate_stats["skip_reasons"]["no_htf_passthrough"] = gate_stats["skip_reasons"].get("no_htf_passthrough", 0) + 1
            continue

        try:
            # Session context
            session = compute_session_context(df, idx, htf.prev_day_high, htf.prev_day_low)

            # Bias engine
            vwap_val = float(df["vwap"][int(idx)]) if has_vwap else 0.0
            bias_state = compute_bias(htf, session, current_price=entry_price, vwap=vwap_val)

            # Playbook router
            playbook = route_playbook(bias_state)

            # Location score
            location = compute_location_score(
                entry_price=entry_price,
                direction=direction,
                htf=htf,
                session=session,
                vwap=vwap_val,
                at_order_block=bool(df["at_order_block"][int(idx)]) if has_ob else False,
                at_fvg=bool(df["at_fvg"][int(idx)]) if has_fvg else False,
                after_sweep=bool(df["after_sweep"][int(idx)]) if has_sweep else False,
                in_killzone=session.ny_killzone_active or session.london_killzone_active,
            )

            # Structural stop (with 6pt cap)
            atr_val = float(atr_np[idx]) if not np.isnan(atr_np[idx]) else 1.0
            stop_plan = compute_structural_stop(
                direction=direction,
                entry_price=entry_price,
                point_value=point_value,
                atr=atr_val,
                tick_size=tick_size,
                max_stop_points=6.0,
            )

            # Structural targets
            target_plan = compute_targets(
                direction=direction,
                entry_price=entry_price,
                stop_price=stop_plan.stop_price,
                nearest_bsl=htf.weekly_high if direction == "long" else None,
                nearest_ssl=htf.weekly_low if direction == "short" else None,
                nearest_old_high=htf.prev_day_high if direction == "long" else None,
                nearest_old_low=htf.prev_day_low if direction == "short" else None,
                vwap=vwap_val,
            )

            # Evaluate through eligibility gate
            signal_dict = {
                "direction": direction,
                "strategy_name": strategy_name or symbol,
                "entry_price": entry_price,
            }
            decision = evaluate_signal(
                signal=signal_dict,
                bias_state=bias_state,
                playbook=playbook,
                location=location,
                stop_plan=stop_plan,
                target_plan=target_plan,
                session=session,
            )

            if decision.action == "SKIP":
                filtered[idx] = False
                gate_stats["skip"] += 1
                reason = decision.reasoning[0] if decision.reasoning else "unknown"
                gate_stats["skip_reasons"][reason] = gate_stats["skip_reasons"].get(reason, 0) + 1
            elif decision.action == "REDUCE":
                gate_stats["reduce"] += 1
                # Keep signal but note it was reduced
            else:
                gate_stats["take"] += 1

        except Exception as e:
            # Context computation failed for this bar — skip conservatively
            filtered[idx] = False
            gate_stats["skip"] += 1
            gate_stats["skip_reasons"]["context_error"] = gate_stats["skip_reasons"].get("context_error", 0) + 1

    return filtered, exit_signals, gate_stats


def _apply_trade_management(
    trades_records,
    high_np: np.ndarray,
    low_np: np.ndarray,
    close_np: np.ndarray,
    atr_np: np.ndarray,
    spec,
    htf_cache: Optional[dict],
    df,
) -> list[dict]:
    """Bar-by-bar trade management: 6pt max SL, structural TP, trailing stop.

    Rules:
    - Stop loss: max 6 points from entry
    - Take profit: single structural TP via DOL hierarchy (>= 2R or skip)
    - After 1R profit: move stop to breakeven
    - After 2R profit: trail 1R behind price, min 2pt breathing room
    - Exit priority per bar: TP hit > trailing stop hit > original exit
    - Safety cap: MAX_HOLD_BARS (200) — ~16h on 5m, forces exit if nothing else triggers

    Returns list of managed trade dicts with updated exit_price, exit_idx, exit_reason.
    """
    from src.engine.context.structural_targets import compute_single_tp

    managed_trades = []
    ts_col = "ts_event"
    has_ts = ts_col in df.columns

    for _, row in trades_records.iterrows():
        entry_p = float(row["Avg Entry Price"])
        original_exit_p = float(row["Avg Exit Price"])
        size = float(row["Size"])
        direction_str = str(row["Direction"])
        entry_idx = int(row["Entry Idx"]) if "Entry Idx" in row.index else 0
        original_exit_idx = int(row["Exit Idx"]) if "Exit Idx" in row.index else min(entry_idx + 1, len(high_np) - 1)
        # Safety cap: no trade held longer than MAX_HOLD_BARS (~16h on 5m)
        MAX_HOLD_BARS = 200
        if original_exit_idx - entry_idx > MAX_HOLD_BARS:
            original_exit_idx = entry_idx + MAX_HOLD_BARS
        is_short = "Short" in direction_str

        atr_at_entry = float(atr_np[entry_idx]) if entry_idx < len(atr_np) and not np.isnan(atr_np[entry_idx]) else 1.0
        risk_points = min(6.0, atr_at_entry * 2.0)
        # Min breathing room: 2pt for MES/ES (tick_size=0.25), scaled for other instruments
        tick = spec.tick_size if spec else 0.25
        min_trail = max(2.0, tick * 8)  # 8 ticks minimum breathing room

        if is_short:
            initial_stop = entry_p + risk_points
        else:
            initial_stop = entry_p - risk_points

        # Compute structural TP via DOL hierarchy
        # Get HTF data for weekly high/low as BSL/SSL
        htf = None
        if htf_cache and has_ts:
            day_key = str(df[ts_col][entry_idx])[:10]
            htf = htf_cache.get(day_key)

        tp_price = compute_single_tp(
            direction="short" if is_short else "long",
            entry_price=entry_p,
            stop_price=initial_stop,
            nearest_bsl=htf.weekly_high if htf and not is_short else None,
            nearest_ssl=htf.weekly_low if htf and is_short else None,
            nearest_old_high=htf.prev_day_high if htf and not is_short else None,
            nearest_old_low=htf.prev_day_low if htf and is_short else None,
            atr=atr_at_entry,
        )

        # Build managed trade record
        managed = {
            "entry_idx": entry_idx,
            "entry_price": entry_p,
            "original_exit_idx": original_exit_idx,
            "original_exit_price": original_exit_p,
            "size": size,
            "direction": direction_str,
            "risk_points": round(risk_points, 2),
        }

        # If no structural TP gives >= 2R, use original exit (no TP enforcement
        # during backtest — the gate already filtered for quality, and not all
        # strategies have structural data for DOL targets)
        if tp_price is None:
            tp_price = float("inf") if not is_short else float("-inf")
            managed["tp_source"] = "none"
        else:
            managed["tp_source"] = "structural"

        trail_stop = initial_stop
        exit_price = original_exit_p
        exit_idx = original_exit_idx
        exit_reason = "signal"

        # Bar-by-bar simulation
        for bar in range(entry_idx + 1, original_exit_idx + 1):
            if bar >= len(high_np):
                break

            bar_high = float(high_np[bar])
            bar_low = float(low_np[bar])

            # Conservative intra-bar ordering: check stop BEFORE advancing trail.
            # We cannot know if the high or low came first within a bar, so we
            # check stops against the CURRENT trail (not an advanced one).

            # 1. Check trailing/initial stop hit first (conservative)
            if not is_short and bar_low <= trail_stop:
                exit_price = trail_stop
                exit_reason = "trailing_stop" if trail_stop > initial_stop else "stop_loss"
                exit_idx = bar
                break
            elif is_short and bar_high >= trail_stop:
                exit_price = trail_stop
                exit_reason = "trailing_stop" if trail_stop < initial_stop else "stop_loss"
                exit_idx = bar
                break

            # 2. Check TP hit (full exit)
            if not is_short and bar_high >= tp_price:
                exit_price = tp_price
                exit_reason = "take_profit"
                exit_idx = bar
                break
            elif is_short and bar_low <= tp_price:
                exit_price = tp_price
                exit_reason = "take_profit"
                exit_idx = bar
                break

            # 3. Advance trailing stop for NEXT bar (only after confirming
            #    no stop was hit on this bar)
            if not is_short:
                pnl_points = bar_high - entry_p
            else:
                pnl_points = entry_p - bar_low

            # After 1R: move to breakeven
            if pnl_points >= risk_points:
                be_stop = entry_p
                if not is_short:
                    trail_stop = max(trail_stop, be_stop)
                else:
                    trail_stop = min(trail_stop, be_stop)

            # After 2R: trail 1R behind, min breathing room
            if pnl_points >= risk_points * 2:
                if not is_short:
                    new_stop = bar_high - max(risk_points, min_trail)
                    trail_stop = max(trail_stop, new_stop)
                else:
                    new_stop = bar_low + max(risk_points, min_trail)
                    trail_stop = min(trail_stop, new_stop)

        managed["exit_price"] = exit_price
        managed["exit_idx"] = exit_idx
        managed["exit_reason"] = exit_reason
        managed["trail_stop_final"] = round(trail_stop, 4)
        managed_trades.append(managed)

    return managed_trades


def shift_higher_tf_columns(
    df: pl.DataFrame,
    higher_tf_columns: list[str],
) -> pl.DataFrame:
    """Apply shift(1) to higher-TF indicator columns to prevent look-ahead bias.

    When higher-TF indicators (daily SMA, 4H ATR, etc.) are merged into a
    lower-TF DataFrame for signal filtering, those columns must reflect the
    PREVIOUS completed higher-TF bar, not the current incomplete one.

    Args:
        df: DataFrame containing merged higher-TF columns
        higher_tf_columns: List of column names from the higher timeframe

    Returns:
        DataFrame with specified columns shifted forward by 1 row
    """
    shift_exprs = [
        pl.col(col).shift(1).alias(col) for col in higher_tf_columns
        if col in df.columns
    ]
    if shift_exprs:
        df = df.with_columns(shift_exprs)
    return df

# ─── Timeframe → pandas freq mapping ────────────────────────────────
# vectorbt uses freq to annualize Sharpe. Hardcoding "1D" deflates
# Sharpe ~5x for intraday data because it assumes 1 bar = 1 day.
FREQ_MAP = {
    "1min": "1min",
    "5min": "5min",
    "15min": "15min",
    "30min": "30min",
    "1hour": "1h",
    "1h": "1h",
    "4hour": "4h",
    "4h": "4h",
    "daily": "1D",
    "1D": "1D",
}


def _resolve_freq(timeframe: str) -> str:
    """Resolve strategy timeframe to pandas freq alias for vectorbt."""
    return FREQ_MAP.get(timeframe, "1D")


def _extract_atr_period(config: StrategyConfig) -> int:
    """Find ATR period from strategy indicators, default 14."""
    for ind in config.indicators:
        if ind.type == "atr":
            return ind.period
    return 14


def _compute_daily_pnls(equity: np.ndarray, index=None) -> list[dict]:
    """Compute daily P&L from equity curve, aggregated by calendar day.

    For intraday data (e.g. 15min), multiple bars share the same calendar
    date. We take the last equity value per day and diff between consecutive
    days to get true daily P&L.

    Returns:
        list of {"date": "YYYY-MM-DD", "pnl": float} dicts
    """
    if len(equity) < 2:
        return []

    # If no datetime index, fall back to per-bar diff (daily data)
    if index is None or len(index) == 0 or not hasattr(index[0], "date"):
        pnls = np.diff(equity)
        return [{"date": None, "pnl": round(float(p), 2)} for p in pnls]

    # Group equity by calendar date — take last value per day
    daily: dict[str, float] = {}
    for i, v in enumerate(equity):
        day_str = str(index[i].date()) if hasattr(index[i], "date") else str(index[i])
        daily[day_str] = float(v)

    sorted_days = sorted(daily.items())
    if len(sorted_days) < 2:
        return []

    pnls = []
    for i in range(1, len(sorted_days)):
        date_str = sorted_days[i][0]
        pnl = sorted_days[i][1] - sorted_days[i - 1][1]
        pnls.append({"date": date_str, "pnl": round(pnl, 2)})
    return pnls


def _compute_monthly_returns(equity: np.ndarray, index) -> list[dict]:
    """Compute monthly P&L from equity curve for heatmap chart.

    Returns list of {year, month, pnl} entries.
    """
    if len(equity) < 2:
        return []

    # Group equity by (year, month), take first and last value per month
    monthly: dict[tuple[int, int], list[float]] = {}
    for i, v in enumerate(equity):
        if hasattr(index[i], "year"):
            key = (index[i].year, index[i].month - 1)  # 0-indexed month
        else:
            continue
        if key not in monthly:
            monthly[key] = [float(v), float(v)]
        else:
            monthly[key][1] = float(v)  # keep updating last value

    results = []
    for (year, month), (first, last) in sorted(monthly.items()):
        pnl = last - first
        results.append({"year": year, "month": month, "pnl": round(pnl, 2)})
    return results


def _aggregate_equity_daily(equity: np.ndarray, index) -> list[dict]:
    """Aggregate intraday equity to one point per calendar day (last value).

    For 15-min data, multiple bars share the same date. Lightweight-charts
    requires unique, ascending time values. Take the last (closing) value
    per calendar day.
    """
    if len(equity) == 0:
        return []

    daily: dict[str, float] = {}
    for i, v in enumerate(equity):
        if hasattr(index[i], "date"):
            day_str = str(index[i].date())
        else:
            day_str = str(index[i])
        daily[day_str] = round(float(v), 2)  # last value wins

    return [{"time": k, "value": v} for k, v in daily.items()]


MINIMUM_TRADES = 500
MINIMUM_TRADES_PER_SIDE = 100


def _wilson_ci(wins: int, total: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score confidence interval for a proportion (no scipy needed)."""
    if total == 0:
        return (0.0, 0.0)
    p = wins / total
    denom = 1 + z ** 2 / total
    center = (p + z ** 2 / (2 * total)) / denom
    margin = z * ((p * (1 - p) / total + z ** 2 / (4 * total ** 2)) ** 0.5) / denom
    return (round(max(0.0, center - margin), 4), round(min(1.0, center + margin), 4))


def _compute_long_short_split(trades_list: list[dict]) -> dict:
    """Split metrics by direction -- catches bull-market bias."""
    longs = [t for t in trades_list if str(t.get("Direction", t.get("direction", ""))).lower().startswith("long")]
    shorts = [t for t in trades_list if str(t.get("Direction", t.get("direction", ""))).lower().startswith("short")]

    def _side_metrics(trades: list[dict]) -> dict:
        if not trades:
            return {"trades": 0, "win_rate": 0, "pnl": 0, "avg_winner": 0, "avg_loser": 0, "profit_factor": 0, "sharpe": 0}
        pnls = [float(t.get("PnL", t.get("pnl", 0))) for t in trades]
        winners = [p for p in pnls if p > 0]
        losers = [p for p in pnls if p < 0]
        pnl_arr = np.array(pnls)
        side_sharpe = float(np.mean(pnl_arr) / np.std(pnl_arr, ddof=1) * np.sqrt(252)) if len(pnl_arr) > 1 and np.std(pnl_arr, ddof=1) > 0 else 0.0
        return {
            "trades": len(trades),
            "win_rate": round(len(winners) / len(trades), 4),
            "pnl": round(sum(pnls), 2),
            "avg_winner": round(sum(winners) / len(winners), 2) if winners else 0,
            "avg_loser": round(sum(losers) / len(losers), 2) if losers else 0,
            "profit_factor": round(sum(winners) / abs(sum(losers)), 4) if losers and sum(losers) != 0 else 999.99,
            "sharpe": round(side_sharpe, 4),
        }

    long_metrics = _side_metrics(longs)
    short_metrics = _side_metrics(shorts)

    warnings: list[str] = []
    if short_metrics["trades"] > 20 and short_metrics["win_rate"] < 0.40:
        warnings.append("Long-biased strategy — short side win rate < 40%. May fail in bear markets.")
    if long_metrics["trades"] > 20 and short_metrics["trades"] > 20:
        if long_metrics["pnl"] > 0 and short_metrics["pnl"] < 0:
            warnings.append("Short side is net negative. Long side carrying the strategy.")

    return {
        "long": long_metrics,
        "short": short_metrics,
        "warnings": warnings,
    }


# ─── Bar Count Validation ─────────────────────────────────────────
BARS_PER_DAY = {
    "1min": 390, "5min": 78, "15min": 26, "30min": 13,
    "1hour": 7, "1h": 7, "4hour": 2, "4h": 2,
    "daily": 1, "1D": 1,
}


def _validate_bar_count(
    df: pl.DataFrame,
    timeframe: str,
    start_date: str,
    end_date: str,
) -> None:
    """Warn if bar count deviates >10% from expected for date range + timeframe.

    Uses business-day estimate: calendar_days * 252/365.
    Issues warnings.warn (not raise) so backtests continue but anomalies are flagged.
    """
    import warnings
    from datetime import datetime as _dt

    if timeframe not in BARS_PER_DAY:
        return

    _start_dt = _dt.strptime(start_date, "%Y-%m-%d") if isinstance(start_date, str) else start_date
    _end_dt = _dt.strptime(end_date, "%Y-%m-%d") if isinstance(end_date, str) else end_date
    _calendar_days = (_end_dt - _start_dt).days
    _trading_days = int(_calendar_days * 252 / 365)
    expected = _trading_days * BARS_PER_DAY[timeframe]
    actual = len(df)

    if expected > 0 and abs(actual - expected) / expected > 0.10:
        warnings.warn(
            f"Bar count mismatch: expected ~{expected}, got {actual}. "
            f"Wrong timeframe data? (timeframe={timeframe})"
        )


def _build_run_receipt(config: "StrategyConfig", dataset_hash: str = "") -> dict:
    """Build a run receipt for reproducibility tracking."""
    import hashlib
    import subprocess

    # Git commit
    try:
        git_commit = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception as exc:
        print(f"WARNING: Failed to get git commit: {exc}", file=sys.stderr)
        git_commit = "unknown"

    # Config hash
    if hasattr(config, "model_dump_json"):
        config_hash = hashlib.sha256(config.model_dump_json().encode()).hexdigest()
    else:
        config_hash = hashlib.sha256(json.dumps(config, sort_keys=True, default=str).encode()).hexdigest()

    # Engine version
    engine_version = "unknown"
    try:
        from importlib.metadata import version as pkg_version
        engine_version = pkg_version("trading-forge")
    except Exception as exc:
        print(f"WARNING: Failed to get engine version: {exc}", file=sys.stderr)

    # Code hash: hash the backtester source for reproducibility
    try:
        source_path = Path(__file__).resolve()
        code_hash = hashlib.sha256(source_path.read_bytes()).hexdigest()[:12]
    except Exception as exc:
        print(f"WARNING: Failed to compute code hash: {exc}", file=sys.stderr)
        code_hash = "unknown"

    return {
        "engine_version": "2.0",
        "git_commit": git_commit,
        "code_hash": code_hash,
        "config_hash": config_hash,
        "dataset_hash": dataset_hash[:12] if len(dataset_hash) > 12 else dataset_hash,
        "random_seed": 42,
        "numpy_version": np.__version__,
        "polars_version": pl.__version__,
        "python_version": sys.version.split()[0],
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "determinism_verified": False,  # Set True after determinism test passes
    }


def run_backtest(
    request: BacktestRequest,
    data: Optional[pl.DataFrame] = None,
    fill_rate: float = 1.0,
    use_eligibility_gate: bool = False,
    spread_multiplier: float = 1.0,
) -> dict:
    """Run a single backtest and return metrics dict.

    Args:
        request: Backtest configuration
        data: Optional pre-loaded data (for testing). If None, loads from S3.
        fill_rate: Fraction of entry signals to keep (0.0-1.0). Used for
            crisis stress testing to simulate reduced fill rates.
        use_eligibility_gate: When True, apply the eligibility gate post-filter
            to entry/exit signals. Default False to preserve existing behavior.

    Returns:
        dict with metrics, equity_curve, trades, daily_pnls, execution_time_ms
    """
    start_time = time.time()
    config = request.strategy
    spec = CONTRACT_SPECS[config.symbol]
    atr_period = _extract_atr_period(config)

    # ─── Load data ─────────────────────────────────────────────
    if data is None:
        print(f"Loading {config.symbol} {config.timeframe} data...", file=sys.stderr)
        data = load_ohlcv(
            config.symbol, config.timeframe,
            request.start_date, request.end_date,
        )

    # ─── Validate bar count ──────────────────────────────────
    _validate_bar_count(data, config.timeframe, request.start_date, request.end_date)

    # ─── Flag rollover days (Task 7.1) ───────────────────────
    data = flag_rollover_days(data, config.symbol)

    # ─── Compute indicators ───────────────────────────────────
    # Ensure ATR is included for sizing/slippage
    indicator_configs = list(config.indicators)
    if not any(ind.type == "atr" for ind in indicator_configs):
        indicator_configs.append(IndicatorConfig(type="atr", period=atr_period))

    df = compute_indicators(data, indicator_configs)

    # ─── Economic event mask (Task 3.8) ─────────────────────
    event_mask = None
    event_slippage_mult = None
    if request.event_calendar and request.event_calendar.policies and "ts_event" in df.columns:
        from src.engine.economic_calendar import (
            generate_event_mask,
            get_event_slippage_multipliers,
        )
        policies = [p.model_dump() for p in request.event_calendar.policies]
        event_mask = generate_event_mask(df["ts_event"], policies)
        event_slippage_mult = get_event_slippage_multipliers(df["ts_event"], policies)

    # ─── Generate signals ─────────────────────────────────────
    df = generate_signals(df, config, fill_rate=fill_rate, event_mask=event_mask)

    # ─── Suppress entries on rollover days (Task 7.1) ─────────
    if "is_rollover_day" in df.columns:
        rollover_mask = df["is_rollover_day"]
        suppressed = int(
            (df.filter(rollover_mask)["entry_long"].sum() or 0)
            + (df.filter(rollover_mask).get_column("entry_short").sum() or 0)
            if "entry_short" in df.columns
            else (df.filter(rollover_mask)["entry_long"].sum() or 0)
        )
        if suppressed > 0:
            print(
                f"Suppressing {suppressed} entry signals on rollover days",
                file=sys.stderr,
            )
        df = df.with_columns([
            pl.when(pl.col("is_rollover_day")).then(False).otherwise(pl.col("entry_long")).alias("entry_long"),
            pl.when(pl.col("is_rollover_day")).then(False).otherwise(
                pl.col("entry_short") if "entry_short" in df.columns else pl.lit(False)
            ).alias("entry_short"),
        ])

    # ─── Commission: firm override → request value → contract spec default ──
    commission = request.commission_per_side
    if request.firm_key:
        commission = get_commission_per_side(request.firm_key, config.symbol)
    elif commission == 0.62:  # default unchanged — use contract spec
        commission = spec.default_commission

    # ─── Firm contract cap (Task 3.12) ────────────────────────
    max_contracts = None
    if request.firm_key and request.firm_key in FIRM_CONTRACT_CAPS:
        from src.engine.firm_config import get_contract_cap
        max_contracts = get_contract_cap(request.firm_key, config.symbol)

    # ─── Position sizing ──────────────────────────────────────
    sizes, over_risk = compute_position_sizes(
        df, config.position_size, spec, atr_period,
        max_contracts=max_contracts,
    )
    # Defense-in-depth: replace any inf/nan sizes with 1 contract
    sizes = np.where(np.isfinite(sizes), sizes, 1.0)
    over_risk_count = int(np.sum(over_risk))
    if over_risk_count > 0:
        print(
            f"WARNING: {over_risk_count} bars have ATR-implied risk > target "
            f"for 1 contract (over_risk). Trading 1 contract anyway.",
            file=sys.stderr,
        )

    # ─── Session liquidity multipliers (Task 3.7) ─────────────
    # Prefer ts_et (Eastern Time) for session filtering — all session logic
    # must use ET, not UTC. ts_et is added by data_loader at load time.
    session_mult = None
    _ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
    if _ts_col in df.columns:
        session_mult = get_session_multipliers(df[_ts_col])

    # Combine session + event slippage multipliers
    combined_slippage_mult = session_mult
    if event_slippage_mult is not None:
        if combined_slippage_mult is not None:
            combined_slippage_mult = combined_slippage_mult * event_slippage_mult
        else:
            combined_slippage_mult = event_slippage_mult

    # ─── Slippage ─────────────────────────────────────────────
    _order_type = request.fill_model.order_type if request.fill_model else "market"
    slippage_arr = compute_slippage(
        df, spec, request.slippage_ticks, atr_period,
        session_multipliers=combined_slippage_mult,
        order_type=_order_type,
    )

    # ─── Eligibility gate (Wave 2.8 integration point) ─────────
    entries_np = df["entry_long"].to_numpy()
    exits_np = df["exit_long"].to_numpy()
    if use_eligibility_gate:
        entries_np, exits_np, _ = apply_eligibility_gate(
            entries_np, exits_np, df,
            direction="long", symbol=config.symbol,
            firm_key=request.firm_key,
        )
        # Update DataFrame with filtered signals
        df = df.with_columns([
            pl.Series("entry_long", entries_np),
            pl.Series("exit_long", exits_np),
        ])
        # Apply gate to short side if present
        if "entry_short" in df.columns:
            short_entries_np = df["entry_short"].to_numpy()
            short_exits_np = df["exit_short"].to_numpy()
            short_entries_np, short_exits_np, _ = apply_eligibility_gate(
                short_entries_np, short_exits_np, df,
                direction="short", symbol=config.symbol,
                firm_key=request.firm_key,
            )
            df = df.with_columns([
                pl.Series("entry_short", short_entries_np),
                pl.Series("exit_short", short_exits_np),
            ])

    # ─── Fill probability model (Task 3.10) ───────────────────
    entries_np = df["entry_long"].to_numpy()
    if request.fill_model:
        from src.engine.fill_model import compute_fill_probabilities_v2, apply_fill_model
        fill_config = request.fill_model.model_dump()
        fill_probs = compute_fill_probabilities_v2(
            df, fill_config, entries_np,
            order_type=request.fill_model.order_type,
            symbol=config.symbol,
            spread_multiplier=spread_multiplier,
        )
        entries_np, sizes = apply_fill_model(entries_np, fill_probs, sizes, seed=42)

    # ─── Shift entry signals by 1 bar (next-bar fill) ──────────
    # Signal on bar N → fill on bar N+1. Eliminates lookahead bias.
    entries_np = np.roll(entries_np, 1); entries_np[0] = False

    # ─── Convert to Pandas at vectorbt boundary (CLAUDE.md rule) ─
    # Use ts_event as index so equity curve has proper datetime indices
    ts_index = df["ts_event"].to_pandas() if "ts_event" in df.columns else None
    close_pd = df["close"].to_pandas()
    # High/Low arrays for per-trade MAE/MFE computation
    high_np = df["high"].to_numpy() if "high" in df.columns else close_pd.to_numpy()
    low_np = df["low"].to_numpy() if "low" in df.columns else close_pd.to_numpy()
    if ts_index is not None:
        close_pd.index = ts_index
    entries_pd = pl.Series("entry_long", entries_np).to_pandas()
    if ts_index is not None:
        entries_pd.index = ts_index
    exits_pd = df["exit_long"].to_pandas()
    if ts_index is not None:
        exits_pd.index = ts_index

    # Short side signals (use proper boolean Series, not int * False)
    if "entry_short" in df.columns:
        short_entries_np = df["entry_short"].to_numpy()
        # Apply fill model to short entries too
        if request.fill_model:
            from src.engine.fill_model import compute_fill_probabilities_v2, apply_fill_model
            fill_config = request.fill_model.model_dump()
            short_fill_probs = compute_fill_probabilities_v2(
                df, fill_config, short_entries_np,
                order_type=request.fill_model.order_type,
                symbol=config.symbol,
                spread_multiplier=spread_multiplier,
            )
            short_entries_np, short_adjusted_sizes = apply_fill_model(short_entries_np, short_fill_probs, sizes.copy(), seed=43)
            # Merge short partial fill adjustments into main sizes array
            # (safe: same bar can't have both long and short entry)
            short_fill_mask = short_entries_np.astype(bool)
            sizes[short_fill_mask] = short_adjusted_sizes[short_fill_mask]
        # Shift short entries by 1 bar (next-bar fill)
        short_entries_np = np.roll(short_entries_np, 1); short_entries_np[0] = False
        short_entries_pd = pl.Series("entry_short", short_entries_np).to_pandas()
    else:
        short_entries_pd = pd.Series(False, index=close_pd.index)
    short_exits_pd = df["exit_short"].to_pandas() if "exit_short" in df.columns else pd.Series(False, index=close_pd.index)
    if ts_index is not None:
        short_entries_pd.index = ts_index
        short_exits_pd.index = ts_index

    # NaN sizes = position sizer couldn't compute → suppress those entries
    nan_mask = np.isnan(sizes)
    entries_np[nan_mask] = False
    if "entry_short" in df.columns:
        short_entries_np[nan_mask] = False
    # Clean NaN values (safety — no NaNs remain after mask)
    sizes_clean = np.nan_to_num(sizes, nan=1.0)
    slippage_clean = np.nan_to_num(slippage_arr, nan=0.0)

    # ─── Run vectorbt Portfolio (long + short) ────────────────
    # vectorbt handles SIGNAL TIMING only — no slippage/fees.
    # We compute all P&L ourselves with correct futures math:
    #   dollar_pnl = price_diff × contracts × point_value - slippage - commission
    # This prevents: (1) equity ignoring slippage, (2) commission × point_value bug,
    # (3) fixed_fees treating per-contract fee as per-order.
    #
    # SAME-BAR STOP + SIGNAL EXIT CONVENTION (Task 5.8):
    #   Stops are encoded as exit signals in the signal arrays (exits_pd / short_exits_pd).
    #   When both a stop loss AND a signal-based exit trigger on the same bar, the exit
    #   signal is already True — vectorbt exits at the bar's close price. Because stops
    #   are evaluated first in generate_signals() and the stop price is always worse than
    #   or equal to the signal exit price, this is conservative by construction.
    #   The bar's close price used by vectorbt represents the WORST-CASE exit (the stop),
    #   not the better signal exit. This matches real trading: an intraday stop fires
    #   before an end-of-bar signal exit would.
    #   NOTE: We do NOT use vectorbt's sl_stop/tp_stop parameters. All stop logic is
    #   pre-computed in the signal arrays for full control over priority and pricing.
    try:
        pf = vbt.Portfolio.from_signals(
            close=close_pd,
            entries=entries_pd,
            exits=exits_pd,
            short_entries=short_entries_pd,
            short_exits=short_exits_pd,
            size=sizes_clean,
            freq=_resolve_freq(config.timeframe),
            init_cash=float("inf"),
        )
    except Exception as e:
        print(f"vectorbt error: {e}", file=sys.stderr)
        return _empty_result(str(e), time.time() - start_time)

    # ─── Extract metrics (futures P&L computed independently) ─
    STARTING_CAPITAL = 50_000.0

    total_trades = int(pf.trades.count())
    trades_records = pf.trades.records_readable if total_trades > 0 else None

    # ─── Add Entry/Exit Idx columns (VBT v2 uses timestamps, not indices) ──
    if trades_records is not None and "Entry Idx" not in trades_records.columns:
        ts_to_idx = {ts: i for i, ts in enumerate(close_pd.index)}
        if "Entry Timestamp" in trades_records.columns:
            trades_records = trades_records.copy()
            entry_idx_mapped = trades_records["Entry Timestamp"].map(ts_to_idx)
            exit_idx_mapped = trades_records["Exit Timestamp"].map(ts_to_idx)
            unmapped = int(entry_idx_mapped.isna().sum() + exit_idx_mapped.isna().sum())
            if unmapped > 0:
                raise ValueError(
                    f"CRITICAL: {unmapped} trade timestamps unmapped to bar indices. "
                    f"Data integrity compromised — timestamp mismatch between "
                    f"trades and price data."
                )
            trades_records["Entry Idx"] = entry_idx_mapped.astype(int)
            trades_records["Exit Idx"] = exit_idx_mapped.astype(int)

    win_rate = 0.0
    profit_factor = 0.0
    avg_trade_pnl = 0.0
    winner_loser_ratio = 0.0
    trades_list: list[dict] = []
    trade_pnls_arr = np.array([])

    if trades_records is not None:
        # Compute correct dollar P&L per trade:
        #   gross = (exit - entry) × size × point_value  (long)
        #   gross = (entry - exit) × size × point_value  (short)
        #   slippage = per-bar slippage at entry/exit × size  (both sides)
        #   commission = commission_per_side × size × 2  (roundtrip)
        #   net_pnl = gross - slippage - commission
        trade_pnls_list = []

        for _, row in trades_records.iterrows():
            entry_p = float(row["Avg Entry Price"])
            exit_p = float(row["Avg Exit Price"])
            size = float(row["Size"])
            direction = str(row["Direction"])
            entry_idx = int(row["Entry Idx"]) if "Entry Idx" in row.index else 0
            exit_idx = int(row["Exit Idx"]) if "Exit Idx" in row.index else min(entry_idx + 1, len(slippage_clean) - 1)

            if "Short" in direction:
                gross = (entry_p - exit_p) * size * spec.point_value
            else:
                gross = (exit_p - entry_p) * size * spec.point_value

            # Per-trade friction: per-bar slippage at entry + exit bars
            entry_slip = float(slippage_clean[entry_idx]) if entry_idx < len(slippage_clean) else 0.0
            exit_slip = float(slippage_clean[exit_idx]) if exit_idx < len(slippage_clean) else 0.0
            slip_cost = (entry_slip + exit_slip) * size
            comm_cost = commission * size * 2
            net_pnl = gross - slip_cost - comm_cost

            trade_pnls_list.append(net_pnl)

            trade: dict = {}
            for col in trades_records.columns:
                val = row[col]
                if hasattr(val, "isoformat"):
                    trade[col] = val.isoformat()
                elif isinstance(val, (np.integer, np.floating)):
                    trade[col] = round(float(val), 4)
                else:
                    trade[col] = val
            trade["PnL"] = round(net_pnl, 2)
            trade["GrossPnL"] = round(gross, 2)
            trade["SlippageCost"] = round(slip_cost, 2)
            trade["CommissionCost"] = round(comm_cost, 2)

            # ─── Per-trade R:R (reward / risk) ─────────────────────
            # Risk = ATR at entry × atr_sl_mult × point_value (1R stop in $)
            atr_col_name = "atr_14"
            atr_at_entry = float(df[atr_col_name][entry_idx]) if atr_col_name in df.columns and entry_idx < len(df) else 0.0
            sl_mult = 2.0  # default ATR stop multiplier
            risk_points = min(atr_at_entry * sl_mult, 6.0)  # 6pt max cap
            risk_dollars = risk_points * spec.point_value
            if risk_dollars > 0 and size > 0:
                reward_dollars = net_pnl / size
                trade["rr"] = round(reward_dollars / risk_dollars, 2)
            else:
                trade["rr"] = 0.0

            # ─── Per-trade MAE/MFE ($ excursion from entry) ───────
            # MAE = max adverse move in $ (always positive = how far against you)
            # MFE = max favorable move in $ (always positive = how far in your favor)
            try:
                ei = max(0, entry_idx)
                xi = min(exit_idx + 1, len(high_np))
                if xi > ei:
                    bar_highs = high_np[ei:xi]
                    bar_lows = low_np[ei:xi]
                    if "Short" in direction:
                        trade_mae = round((float(np.max(bar_highs)) - entry_p) * size * spec.point_value, 2)
                        trade_mfe = round((entry_p - float(np.min(bar_lows))) * size * spec.point_value, 2)
                    else:
                        trade_mae = round((entry_p - float(np.min(bar_lows))) * size * spec.point_value, 2)
                        trade_mfe = round((float(np.max(bar_highs)) - entry_p) * size * spec.point_value, 2)
                    trade["mae"] = max(0.0, trade_mae)
                    trade["mfe"] = max(0.0, trade_mfe)
                else:
                    trade["mae"] = 0.0
                    trade["mfe"] = 0.0
            except Exception:
                trade["mae"] = None
                trade["mfe"] = None

            trades_list.append(trade)

        trade_pnls_arr = np.array(trade_pnls_list)
        winners = trade_pnls_arr[trade_pnls_arr > 0]
        losers = trade_pnls_arr[trade_pnls_arr < 0]

        win_rate = float(len(winners) / total_trades)
        avg_winner = float(np.mean(winners)) if len(winners) > 0 else 0.0
        avg_loser = float(np.mean(np.abs(losers))) if len(losers) > 0 else 0.0
        gross_profit = float(np.sum(winners))
        gross_loss = float(np.abs(np.sum(losers)))
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf")
        avg_trade_pnl = float(np.mean(trade_pnls_arr))
        winner_loser_ratio = avg_winner / avg_loser if avg_loser > 0 else float("inf")

    # ─── Build equity curve from per-trade data ─────────────────
    # Uses per-trade entry/exit data so equity matches per-trade P&L exactly.
    # Same approach as run_class_backtest(): mark-to-market bar-by-bar per
    # trade with friction deducted once on entry/exit bars.
    close_arr = close_pd.values
    n_bars = len(close_arr)
    bar_dollar_pnls = np.zeros(n_bars)

    if trades_list:
        for trade in trades_list:
            t_entry_idx = int(trade.get("Entry Idx", 0))
            t_exit_idx = int(trade.get("Exit Idx", t_entry_idx + 1))
            t_entry_p = float(trade.get("Avg Entry Price", 0))
            t_exit_p = float(trade.get("Avg Exit Price", 0))
            t_size = float(trade.get("Size", 1))
            t_dir = str(trade.get("Direction", "Long"))
            is_short = "Short" in t_dir
            sign = -1.0 if is_short else 1.0

            # Entry bar mark-to-market: entry_price → bar close
            if t_entry_idx < n_bars:
                bar_close = float(close_arr[t_entry_idx])
                bar_dollar_pnls[t_entry_idx] += sign * (bar_close - t_entry_p) * t_size * spec.point_value

            # Intermediate bars: close-to-close mark-to-market
            prev_price = float(close_arr[t_entry_idx]) if t_entry_idx < n_bars else t_entry_p
            for bar in range(t_entry_idx + 1, min(t_exit_idx, n_bars)):
                bar_close = float(close_arr[bar])
                bar_dollar_pnls[bar] += sign * (bar_close - prev_price) * t_size * spec.point_value
                prev_price = bar_close

            # Exit bar: prev close → exit price
            if t_exit_idx < n_bars:
                bar_dollar_pnls[t_exit_idx] += sign * (t_exit_p - prev_price) * t_size * spec.point_value

            # Friction: deducted once per trade (entry + exit)
            friction = float(trade.get("SlippageCost", 0)) + float(trade.get("CommissionCost", 0))
            bar_dollar_pnls[t_entry_idx] -= friction

    equity = STARTING_CAPITAL + np.cumsum(bar_dollar_pnls)
    equity_index = close_pd.index

    # Reconciliation: equity total must match sum of per-trade P&Ls (Golden Rule)
    if len(trade_pnls_arr) > 0:
        equity_total = float(equity[-1] - STARTING_CAPITAL)
        trades_total = float(np.sum(trade_pnls_arr))
        reconciliation_error = abs(equity_total - trades_total)
        if reconciliation_error > 1.0:
            raise ValueError(
                f"RECONCILIATION FAILED: equity={equity_total:.2f}, "
                f"trades={trades_total:.2f}, diff={reconciliation_error:.2f}. "
                f"Results are untrustworthy."
            )

    daily_pnl_records = _compute_daily_pnls(equity, equity_index)
    daily_pnl_values = [d["pnl"] for d in daily_pnl_records]

    winning_days = sum(1 for p in daily_pnl_values if p > 0)
    total_trading_days = len(daily_pnl_values)
    avg_daily_pnl = float(np.mean(daily_pnl_values)) if daily_pnl_values else 0.0

    max_consec_losers = 0
    streak = 0
    for p in daily_pnl_values:
        if p < 0:
            streak += 1
            max_consec_losers = max(max_consec_losers, streak)
        else:
            streak = 0

    total_pnl_dollars = float(equity[-1] - STARTING_CAPITAL)
    total_return = total_pnl_dollars  # Dollar P&L — futures are margin instruments, % is misleading
    peak = np.maximum.accumulate(equity)
    drawdown_dollars = peak - equity  # Dollar drawdown (positive = how much lost from peak)
    max_dd = float(np.max(drawdown_dollars)) if len(drawdown_dollars) > 0 else 0.0  # Max $ lost from peak

    if len(daily_pnl_values) > 1:
        daily_arr = np.array(daily_pnl_values)
        sharpe = float(np.mean(daily_arr) / np.std(daily_arr, ddof=1) * np.sqrt(252)) if np.std(daily_arr, ddof=1) > 0 else 0.0
    else:
        sharpe = 0.0

    # Cap infinite values for JSON
    if profit_factor == float("inf"):
        profit_factor = 999.99
    if winner_loser_ratio == float("inf"):
        winner_loser_ratio = 999.99

    # ─── Overnight gap risk (Task 3.9) ───────────────────────
    gap_adjusted_dd = None
    if config.overnight_hold and "ts_event" in df.columns and trades_list:
        from src.engine.gap_risk import (
            compute_overnight_gaps,
            tag_trades_overnight,
            compute_gap_adjusted_mae,
            compute_gap_adjusted_drawdown,
        )
        gaps = compute_overnight_gaps(df)
        trades_list = tag_trades_overnight(trades_list, df["ts_event"])
        trades_list = compute_gap_adjusted_mae(
            trades_list, gaps, symbol=config.symbol, seed=42,
        )
        gap_adjusted_dd = compute_gap_adjusted_drawdown(
            [round(float(v), 2) for v in equity],
            trades_list, gaps,
            symbol=config.symbol,
            point_value=spec.point_value,
            seed=42,
        )

    elapsed_ms = int((time.time() - start_time) * 1000)

    # Avg R:R on winning trades (must be >= 2.0 to pass any tier)
    winner_rrs = [t["rr"] for t in trades_list if t.get("rr") is not None and t["rr"] > 0]
    avg_winner_rr = float(np.mean(winner_rrs)) if winner_rrs else 0.0

    tier = _compute_tier(avg_daily_pnl, winning_days, total_trading_days,
                         max_dd, profit_factor, sharpe, avg_rr=avg_winner_rr)
    forge_score = _compute_forge_score(sharpe, max_dd, profit_factor, win_rate, avg_daily_pnl)

    # ─── Sanity checks + cross-validation ─────────────────────
    _prelim = {
        "total_return": round(total_return, 6), "sharpe_ratio": round(sharpe, 4),
        "max_drawdown": round(max_dd, 6), "win_rate": round(win_rate, 4),
        "profit_factor": round(profit_factor, 4), "total_trades": total_trades,
        "avg_trade_pnl": round(avg_trade_pnl, 2), "total_trading_days": total_trading_days,
        "trades": trades_list, "daily_pnls": daily_pnl_values,
        "equity_curve": _aggregate_equity_daily(equity, equity_index),
    }
    sanity = run_sanity_checks(_prelim, symbol=config.symbol, timeframe=config.timeframe)
    cross_val = run_cross_validation(_prelim)

    # ─── Prop firm simulation (all 8 firms) ─────────────────
    prop_compliance = simulate_all_firms(
        daily_pnl_records, trades_list,
        symbol=config.symbol, account_size=50_000,
        overnight_hold=config.overnight_hold,
    )

    # ─── Advanced analytics (calendar, session, MAE/MFE) ──
    analytics = compute_full_analytics(daily_pnl_records, trades_list)

    # ─── Task 3.5: Win rate per-trade AND per-day ────────────
    win_rate_per_trade = len([t for t in trades_list if float(t.get("PnL", t.get("pnl", 0))) > 0]) / max(total_trades, 1)
    win_rate_per_day = winning_days / max(total_trading_days, 1)

    # ─── Task 3.6: Long/short split metrics ──────────────────
    long_short_split = _compute_long_short_split(trades_list)

    # ─── Task 3.7: Minimum sample size & confidence intervals ─
    statistical_warnings: list[str] = []
    if total_trades < MINIMUM_TRADES:
        statistical_warnings.append(f"Only {total_trades} trades — statistically unreliable (need {MINIMUM_TRADES}+)")
    if long_short_split["long"]["trades"] < MINIMUM_TRADES_PER_SIDE and long_short_split["long"]["trades"] > 0:
        statistical_warnings.append(f"Only {long_short_split['long']['trades']} long trades — need {MINIMUM_TRADES_PER_SIDE}+ per side")
    if long_short_split["short"]["trades"] < MINIMUM_TRADES_PER_SIDE and long_short_split["short"]["trades"] > 0:
        statistical_warnings.append(f"Only {long_short_split['short']['trades']} short trades — need {MINIMUM_TRADES_PER_SIDE}+ per side")

    # Wilson score CI for win rate (no scipy)
    win_rate_ci = _wilson_ci(winning_days, total_trading_days)

    # Sharpe CI (approximate)
    if total_trading_days > 1:
        # Lo (2002) formula: SE(Sharpe) = sqrt((1 + sharpe^2/2) / n)
        sharpe_se = ((1 + sharpe ** 2 / 2) / total_trading_days) ** 0.5
        sharpe_ci = (round(sharpe - 1.96 * sharpe_se, 4), round(sharpe + 1.96 * sharpe_se, 4))
    else:
        sharpe_ci = (0.0, 0.0)

    sample_confidence = "HIGH" if total_trades >= 500 else "MEDIUM" if total_trades >= 200 else "LOW"

    return {
        "total_return": round(total_return, 6),
        "sharpe_ratio": round(sharpe, 4),
        "max_drawdown": round(max_dd, 6),
        "win_rate": round(win_rate, 4),
        "win_rate_per_trade": round(win_rate_per_trade, 4),
        "win_rate_per_day": round(win_rate_per_day, 4),
        "profit_factor": round(profit_factor, 4),
        "total_trades": total_trades,
        "avg_trade_pnl": round(avg_trade_pnl, 2),
        "avg_daily_pnl": round(avg_daily_pnl, 2),
        "winning_days": winning_days,
        "total_trading_days": total_trading_days,
        "max_consecutive_losing_days": max_consec_losers,
        "expectancy_per_trade": round(avg_trade_pnl, 2),
        "avg_winner_to_loser_ratio": round(winner_loser_ratio, 4),
        "avg_rr": round(float(np.mean([t["rr"] for t in trades_list if t.get("rr") is not None])), 2) if trades_list else 0.0,
        "avg_winner_rr": round(float(np.mean([t["rr"] for t in trades_list if t.get("rr") is not None and t["rr"] > 0])), 2) if any(t.get("rr", 0) > 0 for t in trades_list) else 0.0,
        "avg_loser_rr": round(float(np.mean([t["rr"] for t in trades_list if t.get("rr") is not None and t["rr"] < 0])), 2) if any(t.get("rr", 0) < 0 for t in trades_list) else 0.0,
        "equity_curve": _aggregate_equity_daily(equity, equity_index),
        "monthly_returns": _compute_monthly_returns(equity, equity_index),
        "trades": trades_list,
        "daily_pnls": daily_pnl_values,
        "daily_pnl_records": daily_pnl_records,
        "execution_time_ms": elapsed_ms,
        "gap_adjusted_drawdown": gap_adjusted_dd,
        "tier": tier,
        "forge_score": forge_score,
        "sanity_checks": sanity,
        "cross_validation": cross_val,
        "sortino_ratio": cross_val.get("sortino_ratio", 0.0),
        "bootstrap_ci_95": cross_val.get("bootstrap_ci_95", [0, 0]),
        "deflated_sharpe": cross_val.get("deflated_sharpe", {}),
        "recency_analysis": compute_recency_weighted_score(
            daily_pnl_records, sharpe, max_dd, profit_factor, win_rate, avg_daily_pnl,
        ),
        "decay_analysis": _compute_decay_analysis(daily_pnl_values, trades_list),
        "over_risk_bars": over_risk_count,
        "over_risk_pct": round(over_risk_count / max(len(df), 1) * 100, 2),
        "prop_compliance": prop_compliance,
        "analytics": analytics,
        "long_short_split": long_short_split,
        "confidence_intervals": {
            "win_rate_95ci": win_rate_ci,
            "sharpe_95ci": sharpe_ci,
        },
        "statistical_warnings": statistical_warnings,
        "sample_confidence": sample_confidence,
        "run_receipt": _build_run_receipt(config, dataset_hash=compute_dataset_hash(df)),
    }


def _compute_tier(avg_daily_pnl: float, winning_days: int, total_trading_days: int,
                   max_dd: float, profit_factor: float, sharpe: float,
                   avg_rr: float = 0.0) -> str:
    """Classify strategy into TIER_1, TIER_2, TIER_3, or REJECTED per CLAUDE.md gates."""
    # max_dd is now in positive dollars (e.g. 1500 = $1500 max drawdown from peak)
    max_dd_dollars = abs(max_dd)
    win_days_per_20 = (winning_days / max(total_trading_days, 1)) * 20

    # Hard gate: minimum 1:2 R:R on winning trades
    if avg_rr < 2.0:
        return "REJECTED"

    if (avg_daily_pnl >= 500 and win_days_per_20 >= 14 and max_dd_dollars < 1500
            and profit_factor >= 2.5 and sharpe >= 2.0):
        return "TIER_1"
    if (avg_daily_pnl >= 350 and win_days_per_20 >= 13 and max_dd_dollars < 2000
            and profit_factor >= 2.0 and sharpe >= 1.75):
        return "TIER_2"
    if (avg_daily_pnl >= 250 and win_days_per_20 >= 12 and max_dd_dollars < 2500
            and profit_factor >= 1.75 and sharpe >= 1.5):
        return "TIER_3"
    return "REJECTED"


def _compute_forge_score(sharpe: float, max_dd: float, profit_factor: float,
                          win_rate: float, avg_daily_pnl: float) -> float:
    """Compute 0-100 Forge Score composite.

    Weights: Sharpe (30%), Drawdown (25%), Profit Factor (20%), Win Rate (15%), Avg Daily (10%)
    Each component scored 0-100 then weighted.
    """
    # Sharpe: 0 at 0, 100 at 3.0+
    sharpe_score = min(100, max(0, (sharpe / 3.0) * 100))

    # Max DD: 100 at $0, 0 at $2500+ (dollar drawdown on $50K account)
    dd_score = min(100, max(0, (1 - abs(max_dd) / 2500) * 100))

    # Profit Factor: 0 at 1.0, 100 at 4.0+
    pf_score = min(100, max(0, ((profit_factor - 1.0) / 3.0) * 100))

    # Win Rate: 0 at 40%, 100 at 80%+
    wr_score = min(100, max(0, ((win_rate - 0.4) / 0.4) * 100))

    # Avg Daily PnL: 0 at $0, 100 at $1000+
    daily_score = min(100, max(0, (avg_daily_pnl / 1000) * 100))

    score = (sharpe_score * 0.30 + dd_score * 0.25 + pf_score * 0.20
             + wr_score * 0.15 + daily_score * 0.10)
    return round(score, 1)


def compute_recency_weighted_score(
    daily_pnl_records: list[dict],
    sharpe: float,
    max_dd: float,
    profit_factor: float,
    win_rate: float,
    avg_daily_pnl: float,
) -> dict:
    """Compute Forge Score with recency weighting.

    Splits daily P&L records into time buckets:
      - Recent 2 years: 50% weight
      - Previous 3 years: 30% weight
      - Older than 5 years: 20% weight

    Also computes a "recent_score" (last 2 years only) to flag strategies
    that only worked historically but fail recently.
    """
    from datetime import datetime, timedelta

    full_score = _compute_forge_score(sharpe, max_dd, profit_factor, win_rate, avg_daily_pnl)

    # Split records by recency
    now = datetime.now()
    cutoff_2y = (now - timedelta(days=730)).strftime("%Y-%m-%d")
    cutoff_5y = (now - timedelta(days=1825)).strftime("%Y-%m-%d")

    recent = [r for r in daily_pnl_records if r.get("date") and r["date"] >= cutoff_2y]
    mid = [r for r in daily_pnl_records if r.get("date") and cutoff_5y <= r["date"] < cutoff_2y]
    old = [r for r in daily_pnl_records if r.get("date") and r["date"] < cutoff_5y]

    def _bucket_avg(records: list[dict]) -> float:
        if not records:
            return 0.0
        return sum(r["pnl"] for r in records) / len(records)

    recent_avg = _bucket_avg(recent)
    mid_avg = _bucket_avg(mid)
    old_avg = _bucket_avg(old)

    # Weighted average daily P&L
    total_weight = 0.0
    weighted_pnl = 0.0
    if recent:
        weighted_pnl += recent_avg * 0.50
        total_weight += 0.50
    if mid:
        weighted_pnl += mid_avg * 0.30
        total_weight += 0.30
    if old:
        weighted_pnl += old_avg * 0.20
        total_weight += 0.20

    if total_weight > 0:
        weighted_pnl /= total_weight

    # Recent-only score
    recent_win_rate = sum(1 for r in recent if r["pnl"] > 0) / len(recent) if recent else 0
    recent_score = _compute_forge_score(sharpe, max_dd, profit_factor, recent_win_rate, recent_avg)

    # Flag: strategy decaying if recent score < 60% of full score
    decaying = recent_score < (full_score * 0.60) if full_score > 0 else False
    decay_warning = "Edge may be decaying" if decaying else None

    return {
        "full_score": full_score,
        "recent_score": recent_score,
        "weighted_avg_daily_pnl": round(weighted_pnl, 2),
        "recent_avg_daily_pnl": round(recent_avg, 2),
        "mid_avg_daily_pnl": round(mid_avg, 2),
        "old_avg_daily_pnl": round(old_avg, 2),
        "recent_days": len(recent),
        "mid_days": len(mid),
        "old_days": len(old),
        "decaying": decaying,
        "warning": decay_warning,
    }


def _empty_result(error: str, elapsed: float) -> dict:
    """Return an empty result dict on failure."""
    return {
        "total_return": 0.0,
        "sharpe_ratio": 0.0,
        "max_drawdown": 0.0,
        "win_rate": 0.0,
        "win_rate_per_trade": 0.0,
        "win_rate_per_day": 0.0,
        "profit_factor": 0.0,
        "total_trades": 0,
        "avg_trade_pnl": 0.0,
        "avg_daily_pnl": 0.0,
        "winning_days": 0,
        "total_trading_days": 0,
        "max_consecutive_losing_days": 0,
        "expectancy_per_trade": 0.0,
        "avg_winner_to_loser_ratio": 0.0,
        "avg_rr": 0.0,
        "avg_winner_rr": 0.0,
        "avg_loser_rr": 0.0,
        "equity_curve": [],
        "trades": [],
        "daily_pnls": [],
        "daily_pnl_records": [],
        "execution_time_ms": int(elapsed * 1000),
        "error": error,
        "gate_stats": {"total_signals": 0, "total_taken": 0, "total_skipped": 0, "total_reduced": 0, "filter_rate": 0.0},
    }


def run_class_backtest(
    strategy: BaseStrategy,
    start_date: str,
    end_date: str,
    slippage_ticks: float = 1.0,
    commission_per_side: float = 4.50,
    firm_key: Optional[str] = None,
    data: Optional[pl.DataFrame] = None,
    fixed_contracts: Optional[int] = None,
    htf_cache: Optional[dict] = None,
    daily_data: Optional[pl.DataFrame] = None,
    skip_eligibility_gate: bool = False,
) -> dict:
    """Run a backtest using a BaseStrategy class instance.

    This is the bridge for class-based strategies (ICT strategies in src/engine/strategies/).
    The strategy's compute() method produces entry/exit signals, then we feed those
    into the same vectorbt pipeline as the DSL backtester.
    """
    start_time = time.time()
    symbol = strategy.symbol
    timeframe = strategy.timeframe
    spec = CONTRACT_SPECS[symbol]

    # ─── Load data ─────────────────────────────────────────────
    if data is None:
        print(f"Loading {symbol} {timeframe} data...", file=sys.stderr)
        data = load_ohlcv(symbol, timeframe, start_date, end_date)

    # ─── Load daily data for HTF context (needed by eligibility gate) ──
    if htf_cache is None and daily_data is None:
        try:
            daily_data = load_ohlcv(symbol, "daily", start_date, end_date)
            print(f"Loaded {len(daily_data)} daily bars for HTF context", file=sys.stderr)
        except Exception as e:
            print(f"WARNING: Could not load daily data for HTF gate: {e}", file=sys.stderr)
            daily_data = None

    if htf_cache is None and daily_data is not None and len(daily_data) >= 200:
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
        print(f"Built HTF cache: {len(htf_cache)} days", file=sys.stderr)

    # ─── Validate bar count ──────────────────────────────────
    _validate_bar_count(data, timeframe, start_date, end_date)

    # ─── Strategy validation gate (static) ───────────────────
    from src.engine.validation import validate_static, load_spec, STRATEGY_CONCEPT_MAP
    concept = STRATEGY_CONCEPT_MAP.get(strategy.name)
    validation_warnings = []
    if concept:
        try:
            val_spec = load_spec(concept)
            import inspect
            source_file = inspect.getfile(strategy.__class__)
            static_result = validate_static(source_file, val_spec)
            if not static_result.passed:
                print(f"WARNING: Static validation failed for {strategy.name}: {static_result.errors}", file=sys.stderr)
            validation_warnings.extend(static_result.warnings)
        except Exception as e:
            print(f"WARNING: Could not validate {strategy.name}: {e}", file=sys.stderr)

    # ─── Run strategy compute (produces entry/exit signal columns) ──
    print(f"Running {strategy.name} compute()...", file=sys.stderr)
    df = strategy.compute(data)

    # Verify required signal columns exist
    for col in ("entry_long", "entry_short", "exit_long", "exit_short"):
        if col not in df.columns:
            return _empty_result(
                f"Strategy {strategy.name} compute() missing column: {col}",
                time.time() - start_time,
            )

    # Ensure ATR column exists for sizing/slippage
    if "atr_14" not in df.columns:
        atr = compute_atr(df, 14)
        df = df.with_columns(atr.alias("atr_14"))

    # ─── Commission: firm override → explicit value → contract spec default ──
    commission = commission_per_side
    if firm_key:
        commission = get_commission_per_side(firm_key, symbol)
    elif commission == 0.62:  # default unchanged — use contract spec
        commission = spec.default_commission

    # ─── Firm contract cap ─────────────────────────────────────
    max_contracts = None
    if firm_key and firm_key in FIRM_CONTRACT_CAPS:
        max_contracts = get_contract_cap(firm_key, symbol)

    # ─── Position sizing ────────────────────────────────────────
    from src.engine.config import PositionSizeConfig
    if fixed_contracts is not None:
        size_config = PositionSizeConfig(type="fixed", fixed_contracts=fixed_contracts)
    else:
        size_config = PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500.0)
    sizes, over_risk = compute_position_sizes(df, size_config, spec, 14, max_contracts=max_contracts)
    # Defense-in-depth: replace any inf/nan sizes with 1 contract
    sizes = np.where(np.isfinite(sizes), sizes, 1.0)
    over_risk_count = int(np.sum(over_risk))
    if over_risk_count > 0:
        print(
            f"WARNING: {over_risk_count} bars have ATR-implied risk > target "
            f"for 1 contract (over_risk). Trading 1 contract anyway.",
            file=sys.stderr,
        )

    # ─── Session liquidity multipliers ─────────────────────────
    # Prefer ts_et (Eastern Time) for session filtering — all session logic
    # must use ET, not UTC. ts_et is added by data_loader at load time.
    session_mult = None
    _ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
    if _ts_col in df.columns:
        session_mult = get_session_multipliers(df[_ts_col])

    # ─── Slippage ──────────────────────────────────────────────
    slippage_arr = compute_slippage(
        df, spec, slippage_ticks, 14,
        session_multipliers=session_mult,
    )

    # ─── Eligibility gate (A+ setup filter) ─────────────────────
    # In backtest mode, skip the gate to see raw strategy performance.
    # Gate is for live/paper A+ filtering, not for backtesting signal quality.
    long_entries_np = df["entry_long"].to_numpy()
    short_entries_np = df["entry_short"].to_numpy()
    long_exits_np = df["exit_long"].to_numpy()
    short_exits_np = df["exit_short"].to_numpy()

    # ─── Strategy validation gate (runtime) ──────────────────
    if concept:
        try:
            from src.engine.validation import validate_runtime
            rt_result = validate_runtime(df, val_spec)
            if not rt_result.passed:
                print(f"WARNING: Runtime validation failed for {strategy.name}: {rt_result.errors}", file=sys.stderr)
            validation_warnings.extend(rt_result.warnings)
        except Exception as e:
            print(f"WARNING: Runtime validation error for {strategy.name}: {e}", file=sys.stderr)

    # ─── Signal pipeline diagnostics ─────────────────────────
    diag_raw_long = int(np.sum(long_entries_np))
    diag_raw_short = int(np.sum(short_entries_np))
    diag_raw_exit_long = int(np.sum(long_exits_np))
    diag_raw_exit_short = int(np.sum(short_exits_np))

    # Count same-bar collisions (entry + exit both True on same bar)
    diag_collision_long = int(np.sum(long_entries_np & long_exits_np))
    diag_collision_short = int(np.sum(short_entries_np & short_exits_np))

    if skip_eligibility_gate:
        empty_stats = {"total": 0, "take": 0, "reduce": 0, "skip": 0, "skip_reasons": {}}
        long_gate_stats = empty_stats
        short_gate_stats = empty_stats.copy()
    else:
        long_entries_np, _, long_gate_stats = apply_eligibility_gate(
            long_entries_np, long_exits_np, df, "long", symbol,
            firm_key=firm_key, htf_cache=htf_cache, spec=spec,
            strategy_name=strategy.name,
        )
        short_entries_np, _, short_gate_stats = apply_eligibility_gate(
            short_entries_np, short_exits_np, df, "short", symbol,
            firm_key=firm_key, htf_cache=htf_cache, spec=spec,
            strategy_name=strategy.name,
        )

    # Merge gate stats
    gate_stats = {
        "long": long_gate_stats,
        "short": short_gate_stats,
        "total_signals": long_gate_stats["total"] + short_gate_stats["total"],
        "total_taken": long_gate_stats["take"] + short_gate_stats["take"],
        "total_reduced": long_gate_stats["reduce"] + short_gate_stats["reduce"],
        "total_skipped": long_gate_stats["skip"] + short_gate_stats["skip"],
    }
    total_sigs = gate_stats["total_signals"]
    if total_sigs > 0:
        gate_stats["filter_rate"] = round(gate_stats["total_skipped"] / total_sigs * 100, 1)
        print(
            f"Gate: {gate_stats['total_taken']} TAKE, {gate_stats['total_reduced']} REDUCE, "
            f"{gate_stats['total_skipped']} SKIP out of {total_sigs} signals "
            f"({gate_stats['filter_rate']}% filtered)",
            file=sys.stderr,
        )
    else:
        gate_stats["filter_rate"] = 0.0

    diag_post_gate_long = int(np.sum(long_entries_np))
    diag_post_gate_short = int(np.sum(short_entries_np))

    # ─── Shift entry signals by 1 bar (next-bar fill) ──────────
    # Signal on bar N → fill on bar N+1. Eliminates lookahead bias.
    long_entries_np = np.roll(long_entries_np, 1); long_entries_np[0] = False
    short_entries_np = np.roll(short_entries_np, 1); short_entries_np[0] = False

    # Replace signal columns with filtered+shifted versions
    df = df.with_columns([
        pl.Series("entry_long", long_entries_np),
        pl.Series("entry_short", short_entries_np),
    ])

    # ─── Convert to Pandas at vectorbt boundary ────────────────
    ts_index = df["ts_event"].to_pandas() if "ts_event" in df.columns else None
    close_pd = df["close"].to_pandas()
    # High/Low arrays for per-trade MAE/MFE computation
    high_np = df["high"].to_numpy() if "high" in df.columns else close_pd.to_numpy()
    low_np = df["low"].to_numpy() if "low" in df.columns else close_pd.to_numpy()
    entries_pd = df["entry_long"].to_pandas()
    exits_pd = df["exit_long"].to_pandas()
    short_entries_pd = df["entry_short"].to_pandas()
    short_exits_pd = df["exit_short"].to_pandas()
    if ts_index is not None:
        close_pd.index = ts_index
        entries_pd.index = ts_index
        exits_pd.index = ts_index
        short_entries_pd.index = ts_index
        short_exits_pd.index = ts_index

    # ─── Suppress entries on rollover days ────────────────────────
    if "is_rollover_day" not in df.columns:
        df = flag_rollover_days(df, symbol)
    if "is_rollover_day" in df.columns:
        rollover_mask = df["is_rollover_day"].to_numpy()
        suppressed = int(np.sum(entries_pd.values[rollover_mask]) + np.sum(short_entries_pd.values[rollover_mask]))
        if suppressed > 0:
            print(f"Suppressing {suppressed} entry signals on rollover days", file=sys.stderr)
            entries_pd[rollover_mask] = False
            short_entries_pd[rollover_mask] = False

    diag_post_rollover_long = int(np.sum(entries_pd.values))
    diag_post_rollover_short = int(np.sum(short_entries_pd.values))

    # ─── Signal pipeline diagnostic (stderr) ─────────────────
    print(
        f"Signal pipeline: raw={diag_raw_long+diag_raw_short} "
        f"(L:{diag_raw_long} S:{diag_raw_short}) "
        f"→ gate={diag_post_gate_long+diag_post_gate_short} "
        f"→ rollover={diag_post_rollover_long+diag_post_rollover_short} "
        f"| collisions: L={diag_collision_long} S={diag_collision_short} "
        f"| exits: L={diag_raw_exit_long} S={diag_raw_exit_short}",
        file=sys.stderr,
    )

    sizes_clean = np.nan_to_num(sizes, nan=1.0)
    slippage_clean = np.nan_to_num(slippage_arr, nan=0.0)

    # ─── Run vectorbt Portfolio (long + short) ────────────────
    # vectorbt handles SIGNAL TIMING only — no slippage/fees.
    # We compute all P&L ourselves with correct futures math.
    # Same-bar stop+signal exit convention applies here too — see run_backtest comment.
    try:
        pf = vbt.Portfolio.from_signals(
            close=close_pd,
            entries=entries_pd,
            exits=exits_pd,
            short_entries=short_entries_pd,
            short_exits=short_exits_pd,
            size=sizes_clean,
            freq=_resolve_freq(timeframe),
            init_cash=float("inf"),
        )
    except Exception as e:
        print(f"vectorbt error: {e}", file=sys.stderr)
        return _empty_result(str(e), time.time() - start_time)

    # ─── Extract metrics (futures P&L computed independently) ─
    STARTING_CAPITAL = 50_000.0

    total_trades = int(pf.trades.count())
    trades_records = pf.trades.records_readable if total_trades > 0 else None
    print(
        f"Signal pipeline → trades={total_trades} "
        f"(vectorbt drop: {100 - (total_trades / max(diag_post_rollover_long + diag_post_rollover_short, 1)) * 100:.0f}%)",
        file=sys.stderr,
    )

    # ─── Add Entry/Exit Idx columns (VBT v2 uses timestamps, not indices) ──
    if trades_records is not None and "Entry Idx" not in trades_records.columns:
        ts_to_idx = {ts: i for i, ts in enumerate(close_pd.index)}
        if "Entry Timestamp" in trades_records.columns:
            trades_records = trades_records.copy()
            entry_idx_mapped = trades_records["Entry Timestamp"].map(ts_to_idx)
            exit_idx_mapped = trades_records["Exit Timestamp"].map(ts_to_idx)
            unmapped = int(entry_idx_mapped.isna().sum() + exit_idx_mapped.isna().sum())
            if unmapped > 0:
                raise ValueError(
                    f"CRITICAL: {unmapped} trade timestamps unmapped to bar indices. "
                    f"Data integrity compromised — timestamp mismatch between "
                    f"trades and price data."
                )
            trades_records["Entry Idx"] = entry_idx_mapped.astype(int)
            trades_records["Exit Idx"] = exit_idx_mapped.astype(int)

    # ─── Trade management: SL/TP/trailing applied bar-by-bar ──
    close_np = df["close"].to_numpy()
    atr_np = df["atr_14"].to_numpy() if "atr_14" in df.columns else np.full(len(df), 1.0)
    managed_trades = []
    if trades_records is not None:
        managed_trades = _apply_trade_management(
            trades_records, high_np, low_np, close_np, atr_np,
            spec, htf_cache, df,
        )
        mgmt_exits = {m["exit_reason"] for m in managed_trades}
        tp_count = sum(1 for m in managed_trades if m["exit_reason"] == "take_profit")
        sl_count = sum(1 for m in managed_trades if m["exit_reason"] == "stop_loss")
        trail_count = sum(1 for m in managed_trades if m["exit_reason"] == "trailing_stop")
        print(
            f"Trade mgmt: {tp_count} TP, {sl_count} SL, {trail_count} trail, "
            f"{len(managed_trades) - tp_count - sl_count - trail_count} signal exits",
            file=sys.stderr,
        )

    win_rate = 0.0
    profit_factor = 0.0
    avg_trade_pnl = 0.0
    winner_loser_ratio = 0.0
    trades_list: list[dict] = []
    trade_pnls_arr = np.array([])

    if trades_records is not None:
        trade_pnls_list = []

        for trade_i, (_, row) in enumerate(trades_records.iterrows()):
            entry_p = float(row["Avg Entry Price"])
            size = float(row["Size"])
            direction = str(row["Direction"])
            entry_idx = int(row["Entry Idx"]) if "Entry Idx" in row.index else 0

            # Use managed exit if available, otherwise original
            if trade_i < len(managed_trades):
                mgmt = managed_trades[trade_i]
                exit_p = mgmt["exit_price"]
                exit_idx = mgmt["exit_idx"]
                exit_reason = mgmt["exit_reason"]
                risk_pts = mgmt["risk_points"]
            else:
                exit_p = float(row["Avg Exit Price"])
                exit_idx = int(row["Exit Idx"]) if "Exit Idx" in row.index else min(entry_idx + 1, len(slippage_clean) - 1)
                exit_reason = "signal"
                risk_pts = min(float(atr_np[entry_idx]) * 2.0, 6.0) if entry_idx < len(atr_np) else 6.0

            if "Short" in direction:
                gross = (entry_p - exit_p) * size * spec.point_value
            else:
                gross = (exit_p - entry_p) * size * spec.point_value

            # Per-trade friction: per-bar slippage at entry + exit bars
            entry_slip = float(slippage_clean[entry_idx]) if entry_idx < len(slippage_clean) else 0.0
            exit_slip = float(slippage_clean[exit_idx]) if exit_idx < len(slippage_clean) else 0.0
            slip_cost = (entry_slip + exit_slip) * size
            comm_cost = commission * size * 2
            net_pnl = gross - slip_cost - comm_cost

            trade_pnls_list.append(net_pnl)

            trade: dict = {}
            for col in trades_records.columns:
                val = row[col]
                if hasattr(val, "isoformat"):
                    trade[col] = val.isoformat()
                elif isinstance(val, (np.integer, np.floating)):
                    trade[col] = round(float(val), 4)
                else:
                    trade[col] = val

            # Override with managed exit data
            trade["Avg Exit Price"] = round(exit_p, 4)
            trade["Exit Idx"] = exit_idx
            trade["exit_reason"] = exit_reason
            trade["PnL"] = round(net_pnl, 2)
            trade["GrossPnL"] = round(gross, 2)
            trade["SlippageCost"] = round(slip_cost, 2)
            trade["CommissionCost"] = round(comm_cost, 2)

            # ─── Per-trade R:R (using 6pt capped risk) ───────────────
            risk_dollars = risk_pts * spec.point_value
            if risk_dollars > 0 and size > 0:
                reward_dollars = net_pnl / size
                trade["rr"] = round(reward_dollars / risk_dollars, 2)
            else:
                trade["rr"] = 0.0
            trade["risk_points"] = round(risk_pts, 2)

            # ─── Per-trade MAE/MFE ($ excursion from entry) ───────
            try:
                ei = max(0, entry_idx)
                xi = min(exit_idx + 1, len(high_np))
                if xi > ei:
                    bar_highs = high_np[ei:xi]
                    bar_lows = low_np[ei:xi]
                    if "Short" in direction:
                        trade_mae = round((float(np.max(bar_highs)) - entry_p) * size * spec.point_value, 2)
                        trade_mfe = round((entry_p - float(np.min(bar_lows))) * size * spec.point_value, 2)
                    else:
                        trade_mae = round((entry_p - float(np.min(bar_lows))) * size * spec.point_value, 2)
                        trade_mfe = round((float(np.max(bar_highs)) - entry_p) * size * spec.point_value, 2)
                    trade["mae"] = max(0.0, trade_mae)
                    trade["mfe"] = max(0.0, trade_mfe)
                else:
                    trade["mae"] = 0.0
                    trade["mfe"] = 0.0
            except Exception:
                trade["mae"] = None
                trade["mfe"] = None

            trades_list.append(trade)

        trade_pnls_arr = np.array(trade_pnls_list)
        winners = trade_pnls_arr[trade_pnls_arr > 0]
        losers = trade_pnls_arr[trade_pnls_arr < 0]

        win_rate = float(len(winners) / total_trades)
        avg_winner = float(np.mean(winners)) if len(winners) > 0 else 0.0
        avg_loser = float(np.mean(np.abs(losers))) if len(losers) > 0 else 0.0
        gross_profit = float(np.sum(winners))
        gross_loss = float(np.abs(np.sum(losers)))
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf")
        avg_trade_pnl = float(np.mean(trade_pnls_arr))
        winner_loser_ratio = avg_winner / avg_loser if avg_loser > 0 else float("inf")

    # ─── Build equity curve from managed trades ─────────────────
    # Uses managed entry/exit data so equity matches per-trade P&L exactly.
    # Each trade contributes mark-to-market P&L bar-by-bar, with the managed
    # exit price used on the exit bar instead of close.
    close_arr = close_pd.values
    n_bars = len(close_arr)
    bar_dollar_pnls = np.zeros(n_bars)

    if trades_list:
        for trade in trades_list:
            t_entry_idx = int(trade.get("Entry Idx", 0))
            t_exit_idx = int(trade.get("Exit Idx", t_entry_idx + 1))
            t_entry_p = float(trade.get("Avg Entry Price", 0))
            t_exit_p = float(trade.get("Avg Exit Price", 0))
            t_size = float(trade.get("Size", 1))
            t_dir = str(trade.get("Direction", "Long"))
            is_short = "Short" in t_dir
            sign = -1.0 if is_short else 1.0

            # Entry bar mark-to-market: entry_price → bar close
            if t_entry_idx < n_bars:
                bar_close = float(close_arr[t_entry_idx])
                bar_dollar_pnls[t_entry_idx] += sign * (bar_close - t_entry_p) * t_size * spec.point_value

            # Intermediate bars: close-to-close mark-to-market
            prev_price = float(close_arr[t_entry_idx]) if t_entry_idx < n_bars else t_entry_p
            for bar in range(t_entry_idx + 1, min(t_exit_idx, n_bars)):
                bar_close = float(close_arr[bar])
                bar_dollar_pnls[bar] += sign * (bar_close - prev_price) * t_size * spec.point_value
                prev_price = bar_close

            # Exit bar: prev close → managed exit price
            if t_exit_idx < n_bars:
                bar_dollar_pnls[t_exit_idx] += sign * (t_exit_p - prev_price) * t_size * spec.point_value

            # Friction: deducted once per trade (entry + exit)
            friction = float(trade.get("SlippageCost", 0)) + float(trade.get("CommissionCost", 0))
            bar_dollar_pnls[t_entry_idx] -= friction

    equity = STARTING_CAPITAL + np.cumsum(bar_dollar_pnls)
    equity_index = close_pd.index

    # Reconciliation: managed equity total must match sum of per-trade P&Ls
    if len(trade_pnls_arr) > 0:
        equity_total = float(equity[-1] - STARTING_CAPITAL)
        trades_total = float(np.sum(trade_pnls_arr))
        reconciliation_error = abs(equity_total - trades_total)
        if reconciliation_error > 1.0:  # $1 tolerance for floating point
            raise ValueError(
                f"RECONCILIATION FAILED: equity={equity_total:.2f}, "
                f"trades={trades_total:.2f}, diff={reconciliation_error:.2f}. "
                f"Results are untrustworthy."
            )

    daily_pnl_records = _compute_daily_pnls(equity, equity_index)
    daily_pnl_values = [d["pnl"] for d in daily_pnl_records]

    winning_days = sum(1 for p in daily_pnl_values if p > 0)
    total_trading_days = len(daily_pnl_values)
    avg_daily_pnl = float(np.mean(daily_pnl_values)) if daily_pnl_values else 0.0

    max_consec_losers = 0
    streak = 0
    for p in daily_pnl_values:
        if p < 0:
            streak += 1
            max_consec_losers = max(max_consec_losers, streak)
        else:
            streak = 0

    # Compute return/drawdown/sharpe from the constructed equity curve
    total_pnl_dollars = float(equity[-1] - STARTING_CAPITAL)
    total_return = total_pnl_dollars  # Dollar P&L — futures are margin instruments, % is misleading
    peak = np.maximum.accumulate(equity)
    drawdown_dollars = peak - equity  # Dollar drawdown (positive = how much lost from peak)
    max_dd = float(np.max(drawdown_dollars)) if len(drawdown_dollars) > 0 else 0.0  # Max $ lost from peak

    # Sharpe from daily P&L (annualized)
    if len(daily_pnl_values) > 1:
        daily_arr = np.array(daily_pnl_values)
        sharpe = float(np.mean(daily_arr) / np.std(daily_arr, ddof=1) * np.sqrt(252)) if np.std(daily_arr, ddof=1) > 0 else 0.0
    else:
        sharpe = 0.0

    if profit_factor == float("inf"):
        profit_factor = 999.99
    if winner_loser_ratio == float("inf"):
        winner_loser_ratio = 999.99

    # ─── Overnight gap risk ───────────────────────────────────
    gap_adjusted_dd = None
    if "ts_event" in df.columns and trades_list:
        try:
            from src.engine.gap_risk import (
                compute_overnight_gaps,
                tag_trades_overnight,
                compute_gap_adjusted_mae,
                compute_gap_adjusted_drawdown,
            )
            gaps = compute_overnight_gaps(df)
            trades_list = tag_trades_overnight(trades_list, df["ts_event"])
            trades_list = compute_gap_adjusted_mae(
                trades_list, gaps, symbol=symbol, seed=42,
            )
            gap_adjusted_dd = compute_gap_adjusted_drawdown(
                [round(float(v), 2) for v in equity],
                trades_list, gaps,
                symbol=symbol,
                point_value=spec.point_value,
                seed=42,
            )
        except Exception as exc:
            print(f"WARNING: gap_risk computation failed: {exc}", file=sys.stderr)

    elapsed_ms = int((time.time() - start_time) * 1000)

    # Avg R:R on winning trades (must be >= 2.0 to pass any tier)
    winner_rrs = [t["rr"] for t in trades_list if t.get("rr") is not None and t["rr"] > 0]
    avg_winner_rr = float(np.mean(winner_rrs)) if winner_rrs else 0.0

    tier = _compute_tier(avg_daily_pnl, winning_days, total_trading_days,
                         max_dd, profit_factor, sharpe, avg_rr=avg_winner_rr)
    forge_score = _compute_forge_score(sharpe, max_dd, profit_factor, win_rate, avg_daily_pnl)

    # ─── Prop firm simulation (all 8 firms) ─────────────────
    # ─── Sanity checks + cross-validation ─────────────────────
    _prelim_class = {
        "total_return": round(total_return, 6), "sharpe_ratio": round(sharpe, 4),
        "max_drawdown": round(max_dd, 6), "win_rate": round(win_rate, 4),
        "profit_factor": round(profit_factor, 4), "total_trades": total_trades,
        "avg_trade_pnl": round(avg_trade_pnl, 2), "total_trading_days": total_trading_days,
        "trades": trades_list, "daily_pnls": daily_pnl_values,
        "equity_curve": _aggregate_equity_daily(equity, equity_index),
    }
    sanity = run_sanity_checks(_prelim_class, symbol=symbol, timeframe=timeframe)
    cross_val = run_cross_validation(_prelim_class)

    prop_compliance = simulate_all_firms(
        daily_pnl_records, trades_list,
        symbol=symbol, account_size=50_000,
        overnight_hold=getattr(strategy, "overnight_hold", False),
    )

    # ─── Advanced analytics (calendar, session, MAE/MFE) ──
    analytics = compute_full_analytics(daily_pnl_records, trades_list)

    # ─── Task 3.5: Win rate per-trade AND per-day ────────────
    win_rate_per_trade = len([t for t in trades_list if float(t.get("PnL", t.get("pnl", 0))) > 0]) / max(total_trades, 1)
    win_rate_per_day = winning_days / max(total_trading_days, 1)

    # ─── Task 3.6: Long/short split metrics ──────────────────
    long_short_split = _compute_long_short_split(trades_list)

    # ─── Task 3.7: Minimum sample size & confidence intervals ─
    statistical_warnings: list[str] = []
    if total_trades < MINIMUM_TRADES:
        statistical_warnings.append(f"Only {total_trades} trades — statistically unreliable (need {MINIMUM_TRADES}+)")
    if long_short_split["long"]["trades"] < MINIMUM_TRADES_PER_SIDE and long_short_split["long"]["trades"] > 0:
        statistical_warnings.append(f"Only {long_short_split['long']['trades']} long trades — need {MINIMUM_TRADES_PER_SIDE}+ per side")
    if long_short_split["short"]["trades"] < MINIMUM_TRADES_PER_SIDE and long_short_split["short"]["trades"] > 0:
        statistical_warnings.append(f"Only {long_short_split['short']['trades']} short trades — need {MINIMUM_TRADES_PER_SIDE}+ per side")

    win_rate_ci = _wilson_ci(winning_days, total_trading_days)

    if total_trading_days > 1:
        # Lo (2002) formula: SE(Sharpe) = sqrt((1 + sharpe^2/2) / n)
        sharpe_se = ((1 + sharpe ** 2 / 2) / total_trading_days) ** 0.5
        sharpe_ci = (round(sharpe - 1.96 * sharpe_se, 4), round(sharpe + 1.96 * sharpe_se, 4))
    else:
        sharpe_ci = (0.0, 0.0)

    sample_confidence = "HIGH" if total_trades >= 500 else "MEDIUM" if total_trades >= 200 else "LOW"

    return {
        "total_return": round(total_return, 6),
        "sharpe_ratio": round(sharpe, 4),
        "max_drawdown": round(max_dd, 6),
        "win_rate": round(win_rate, 4),
        "win_rate_per_trade": round(win_rate_per_trade, 4),
        "win_rate_per_day": round(win_rate_per_day, 4),
        "profit_factor": round(profit_factor, 4),
        "total_trades": total_trades,
        "avg_trade_pnl": round(avg_trade_pnl, 2),
        "avg_daily_pnl": round(avg_daily_pnl, 2),
        "winning_days": winning_days,
        "total_trading_days": total_trading_days,
        "max_consecutive_losing_days": max_consec_losers,
        "expectancy_per_trade": round(avg_trade_pnl, 2),
        "avg_winner_to_loser_ratio": round(winner_loser_ratio, 4),
        "avg_rr": round(float(np.mean([t["rr"] for t in trades_list if t.get("rr") is not None])), 2) if trades_list else 0.0,
        "avg_winner_rr": round(float(np.mean([t["rr"] for t in trades_list if t.get("rr") is not None and t["rr"] > 0])), 2) if any(t.get("rr", 0) > 0 for t in trades_list) else 0.0,
        "avg_loser_rr": round(float(np.mean([t["rr"] for t in trades_list if t.get("rr") is not None and t["rr"] < 0])), 2) if any(t.get("rr", 0) < 0 for t in trades_list) else 0.0,
        "equity_curve": _aggregate_equity_daily(equity, equity_index),
        "monthly_returns": _compute_monthly_returns(equity, equity_index),
        "trades": trades_list,
        "daily_pnls": daily_pnl_values,
        "daily_pnl_records": daily_pnl_records,
        "execution_time_ms": elapsed_ms,
        "gap_adjusted_drawdown": gap_adjusted_dd,
        "tier": tier,
        "forge_score": forge_score,
        "sanity_checks": sanity,
        "cross_validation": cross_val,
        "sortino_ratio": cross_val.get("sortino_ratio", 0.0),
        "bootstrap_ci_95": cross_val.get("bootstrap_ci_95", [0, 0]),
        "deflated_sharpe": cross_val.get("deflated_sharpe", {}),
        "recency_analysis": compute_recency_weighted_score(
            daily_pnl_records, sharpe, max_dd, profit_factor, win_rate, avg_daily_pnl,
        ),
        "decay_analysis": _compute_decay_analysis(daily_pnl_values, trades_list),
        "over_risk_bars": over_risk_count,
        "over_risk_pct": round(over_risk_count / max(len(df), 1) * 100, 2),
        "prop_compliance": prop_compliance,
        "analytics": analytics,
        "long_short_split": long_short_split,
        "confidence_intervals": {
            "win_rate_95ci": win_rate_ci,
            "sharpe_95ci": sharpe_ci,
        },
        "statistical_warnings": statistical_warnings,
        "sample_confidence": sample_confidence,
        "gate_stats": gate_stats,
        "signal_diagnostics": {
            "raw_long": diag_raw_long,
            "raw_short": diag_raw_short,
            "raw_total": diag_raw_long + diag_raw_short,
            "post_gate_long": diag_post_gate_long,
            "post_gate_short": diag_post_gate_short,
            "post_rollover_long": diag_post_rollover_long,
            "post_rollover_short": diag_post_rollover_short,
            "actual_trades": total_trades,
            "collision_long": diag_collision_long,
            "collision_short": diag_collision_short,
            "exit_long_count": diag_raw_exit_long,
            "exit_short_count": diag_raw_exit_short,
        },
        "run_receipt": _build_run_receipt(strategy._config if hasattr(strategy, '_config') else StrategyConfig(
            name=strategy.name, symbol=strategy.symbol, timeframe=strategy.timeframe,
            indicators=[], entry_long="", entry_short="", exit="",
            stop_loss={"type": "atr"}, position_size={"type": "fixed"},
        ), dataset_hash=compute_dataset_hash(df)),
    }


def _compute_decay_analysis(daily_pnls: list[float], trades_list: list[dict]) -> dict:
    """Compute combined decay analysis from half-life fit + 6 sub-signals."""
    try:
        half_life_result = fit_decay(daily_pnls)
        composite_result = composite_decay_score(daily_pnls, trades_list)
        return {
            "half_life_days": half_life_result.get("half_life_days"),
            "decay_detected": half_life_result.get("decay_detected", False),
            "trend": half_life_result.get("trend", "stable"),
            "composite_score": composite_result.get("composite_score", 0.0),
            "decaying": composite_result.get("composite_score", 0.0) > 60,
            "signals": composite_result.get("signals", {}),
        }
    except Exception:
        return {
            "half_life_days": None,
            "decay_detected": False,
            "trend": "stable",
            "composite_score": 0.0,
            "decaying": False,
            "signals": {},
        }


def _load_strategy_class(class_path: str) -> BaseStrategy:
    """Import and instantiate a strategy class from dotted module path.

    Example: 'src.engine.strategies.breaker.BreakerStrategy'
    """
    module_path, class_name = class_path.rsplit(".", 1)
    import importlib
    module = importlib.import_module(module_path)
    cls = getattr(module, class_name)
    return cls()


# ─── CLI Entry Point ──────────────────────────────────────────────

@click.command()
@click.option("--config", "config_json", required=True, help="JSON config string")
@click.option("--backtest-id", default=None, help="UUID for this backtest run")
@click.option("--mode", default="single", type=click.Choice(["single", "walkforward"]))
@click.option("--strategy-class", default=None, help="Dotted path to BaseStrategy subclass (e.g. src.engine.strategies.breaker.BreakerStrategy)")
def main(config_json: str, backtest_id: Optional[str], mode: str, strategy_class: Optional[str]):
    """Run backtest engine. Outputs JSON to stdout, errors to stderr."""
    try:
        config = json.loads(config_json)
    except Exception as e:
        print(json.dumps({"error": f"Invalid JSON: {e}"}))
        sys.exit(1)

    if strategy_class:
        # Class-based strategy path
        try:
            strategy = _load_strategy_class(strategy_class)
        except Exception as e:
            print(json.dumps({"error": f"Failed to load strategy class '{strategy_class}': {e}"}))
            sys.exit(1)

        if mode == "walkforward":
            # Walk-forward for class-based strategies: run run_class_backtest per OOS window
            from src.engine.walk_forward import run_walk_forward_class
            result = run_walk_forward_class(
                strategy=strategy,
                start_date=config.get("start_date", "2010-01-01"),
                end_date=config.get("end_date", "2030-12-31"),
                slippage_ticks=config.get("slippage_ticks", 1.0),
                commission_per_side=config.get("commission_per_side", 0.62),
                firm_key=config.get("firm_key"),
                embargo_bars=config.get("embargo_bars", 0),
            )
            # Compute tier from OOS metrics (walk-forward doesn't do this itself)
            oos = result.get("oos_metrics", {})
            # Collect avg winner R:R across OOS windows
            wf_winner_rrs = [w.get("avg_winner_rr", 0) for w in result.get("windows", []) if w.get("avg_winner_rr")]
            wf_avg_winner_rr = float(np.mean(wf_winner_rrs)) if wf_winner_rrs else 0.0
            result["avg_winner_rr"] = round(wf_avg_winner_rr, 2)
            result["tier"] = _compute_tier(
                oos.get("avg_daily_pnl", 0),
                oos.get("winning_days", 0),
                max(oos.get("total_trading_days", 1), 1),
                abs(oos.get("max_drawdown", 0)),
                oos.get("profit_factor", 0),
                oos.get("sharpe_ratio", 0),
                avg_rr=wf_avg_winner_rr,
            )
            result["forge_score"] = _compute_forge_score(
                oos.get("sharpe_ratio", 0),
                abs(oos.get("max_drawdown", 0)),
                oos.get("profit_factor", 0),
                oos.get("win_rate", 0),
                oos.get("avg_daily_pnl", 0),
            )
            print(f"Walk-forward OOS: tier={result['tier']}, forge_score={result['forge_score']:.1f}", file=sys.stderr)
            # Attach run receipt for walk-forward (single backtests attach it themselves)
            from src.engine.data_loader import compute_dataset_hash
            result["run_receipt"] = _build_run_receipt(config, dataset_hash="wf-aggregate")
        else:
            result = run_class_backtest(
                strategy=strategy,
                start_date=config.get("start_date", "2010-01-01"),
                end_date=config.get("end_date", "2030-12-31"),
                slippage_ticks=config.get("slippage_ticks", 1.0),
                commission_per_side=config.get("commission_per_side", 0.62),
                firm_key=config.get("firm_key"),
                skip_eligibility_gate=True,
            )
    else:
        # DSL expression-based strategy path (original)
        try:
            request = BacktestRequest.model_validate_json(config_json)
        except Exception as e:
            print(json.dumps({"error": f"Invalid config: {e}"}))
            sys.exit(1)

        if mode == "walkforward":
            from src.engine.walk_forward import run_walk_forward
            result = run_walk_forward(request, embargo_bars=request.embargo_bars)
        else:
            result = run_backtest(request)

    # ─── Chain stress testing after walk-forward ─────────────────
    if mode == "walkforward" and "error" not in result:
        try:
            from src.engine.stress_test import run_stress_test
            from src.engine.config import StressTestRequest, StrategyConfig
            strategy_cfg = config.get("strategy", {})
            if strategy_class and hasattr(strategy, 'symbol'):
                # Class-based: build minimal StrategyConfig from the strategy instance
                strategy_cfg = {
                    "name": strategy.name,
                    "symbol": strategy.symbol,
                    "timeframe": strategy.timeframe,
                    "indicators": [],
                    "entry_long": "", "entry_short": "", "exit": "",
                    "stop_loss": {"type": "atr", "multiplier": 2.0},
                    "position_size": {"type": "dynamic_atr", "target_risk_dollars": 500},
                }
            stress_req = StressTestRequest(
                backtest_id=backtest_id or "cli",
                strategy=StrategyConfig(**strategy_cfg) if isinstance(strategy_cfg, dict) else strategy_cfg,
                prop_firm_max_dd=config.get("prop_firm_max_dd", 2000.0),
            )
            crisis = run_stress_test(stress_req)
            result["crisis_results"] = crisis
            # Recalculate Forge Score with crisis bonus using full formula
            from src.engine.performance_gate import compute_forge_score as full_forge_score
            oos = result.get("oos_metrics", result)
            mc = result.get("mc_results") or result.get("monte_carlo")
            result["forge_score"] = full_forge_score(
                {
                    "avg_daily_pnl": oos.get("avg_daily_pnl", 0),
                    "winning_days": oos.get("winning_days", 0),
                    "total_trading_days": max(oos.get("total_trading_days", 1), 1),
                    "max_drawdown": abs(oos.get("max_drawdown", 0)),  # Already in dollars
                    "sharpe_ratio": oos.get("sharpe_ratio", 0),
                    "profit_factor": oos.get("profit_factor", 0),
                },
                mc_results=mc,
                crisis_results=crisis,
            )
            print(f"Stress test: {len(crisis.get('scenarios', []))} scenarios, "
                  f"passed={crisis.get('passed', False)}, "
                  f"forge_score={result['forge_score']}", file=sys.stderr)
        except Exception as e:
            print(f"Stress test skipped: {e}", file=sys.stderr)
            result["crisis_results"] = None

    if backtest_id:
        result["backtest_id"] = backtest_id

    print(json.dumps(result))


if __name__ == "__main__":
    # ─── Context module integration test ────────────────────────
    # Verify all 7 context layers are importable and callable.
    # Run with: python -m src.engine.backtester --help
    try:
        from src.engine.context.htf_context import compute_htf_context
        from src.engine.context.session_context import compute_session_context
        from src.engine.context.bias_engine import compute_bias
        from src.engine.context.playbook_router import route_playbook
        from src.engine.context.location_score import compute_location_score
        from src.engine.context.structural_stops import compute_structural_stop
        from src.engine.context.structural_targets import compute_targets
        from src.engine.context.eligibility_gate import evaluate_signal

        assert callable(compute_htf_context), "compute_htf_context not callable"
        assert callable(compute_session_context), "compute_session_context not callable"
        assert callable(compute_bias), "compute_bias not callable"
        assert callable(route_playbook), "route_playbook not callable"
        assert callable(compute_location_score), "compute_location_score not callable"
        assert callable(compute_structural_stop), "compute_structural_stop not callable"
        assert callable(compute_targets), "compute_targets not callable"
        assert callable(evaluate_signal), "evaluate_signal not callable"
        print("All 7 context layers imported and callable.", file=sys.stderr)
    except ImportError as e:
        print(f"Context module import check failed: {e}", file=sys.stderr)

    main()
