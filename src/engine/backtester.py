"""Trading Forge — Core Backtest Engine.

Orchestrates: data loading → indicators → signals → vectorbt portfolio.
CLI: python backtester.py --config <json> --backtest-id <uuid> --mode single|walkforward
Output: JSON to stdout, progress/errors to stderr (matches databento.ts bridge pattern).
"""

from __future__ import annotations

import json
import sys
import time
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
from src.engine.data_loader import load_ohlcv, flag_rollover_days
from src.engine.firm_config import get_commission_per_side, get_contract_cap, FIRM_CONTRACT_CAPS
from src.engine.indicators.core import compute_indicators, compute_atr
from src.engine.liquidity import get_session_multipliers
from src.engine.signals import generate_signals
from src.engine.sizing import compute_position_sizes
from src.engine.slippage import compute_slippage
from src.engine.analytics import compute_full_analytics
from src.engine.prop_sim import simulate_all_firms
from src.engine.strategy_base import BaseStrategy


# ─── Signal Fill Convention ──────────────────────────────────────────
# This system uses CONVENTION 1: "same-bar fill."
#
# How it works:
#   - generate_signals() evaluates entry/exit expressions against bar[i] data.
#   - The resulting boolean arrays are passed directly to vbt.Portfolio.from_signals()
#     WITHOUT any signal_shift parameter (default signal_shift=0).
#   - vectorbt therefore fills the signal on the SAME bar it was generated.
#
# What this means:
#   - For crosses_above/crosses_below: The crossover condition compares bar[i]
#     vs bar[i-1] (shift(1)), so the signal requires bar[i]'s close to confirm
#     the cross AND fills at bar[i]'s close. This is a valid end-of-bar system
#     — you observe the close, decide, and execute at that close price.
#   - For direct comparisons (e.g. "close > sma_20"): The condition uses bar[i]'s
#     close and fills at bar[i]'s close. Same interpretation: end-of-bar decision
#     with same-bar execution.
#   - This is NOT look-ahead because the signal uses data available at bar close
#     and assumes execution at that same close. It models a trader who watches
#     the bar close, decides, and gets filled at (approximately) that price.
#   - Slippage is applied separately to account for execution reality.
#
# If you need "next-bar fill" (convention 2), pass signal_shift=1 to
# vbt.Portfolio.from_signals(). Do NOT change the signal generation logic.
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
    entry_signals, exit_signals, df, direction, symbol, firm_key=None
):
    """Apply eligibility gate to filter signals.

    Currently a stub that passes through all signals.
    Full implementation requires multi-TF data loading (HTF context, session context, etc.)
    which will be wired in Wave 2.8 full integration.

    Args:
        entry_signals: numpy array of entry booleans
        exit_signals: numpy array of exit booleans
        df: Polars DataFrame with indicator data
        direction: "long" or "short"
        symbol: Contract symbol (e.g. "ES")
        firm_key: Optional firm identifier for firm-specific gating

    Returns:
        Tuple of (filtered_entries, filtered_exits)
    """
    # TODO(Wave 2.8): Full 7-layer gate implementation
    # 1. Load HTF data (daily, weekly) and compute HTF context
    # 2. Apply shift_higher_tf_columns() to prevent look-ahead bias on HTF data
    # 3. Compute session context (overnight bias, London sweeps, etc.)
    # 4. Run bias engine to get DailyBiasState
    # 5. Route through playbook router
    # 6. Compute location score, structural stops, structural targets
    # 7. For each entry signal, call evaluate_signal()
    # 8. Filter: TAKE = keep, REDUCE = keep with size adjustment, SKIP = remove
    # For now, return signals unchanged — gate integration point exists
    return entry_signals, exit_signals


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
    if index is None or not hasattr(index[0], "date"):
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
            return {"trades": 0, "win_rate": 0, "pnl": 0, "avg_winner": 0, "avg_loser": 0, "profit_factor": 0}
        pnls = [float(t.get("PnL", t.get("pnl", 0))) for t in trades]
        winners = [p for p in pnls if p > 0]
        losers = [p for p in pnls if p < 0]
        return {
            "trades": len(trades),
            "win_rate": round(len(winners) / len(trades), 4),
            "pnl": round(sum(pnls), 2),
            "avg_winner": round(sum(winners) / len(winners), 2) if winners else 0,
            "avg_loser": round(sum(losers) / len(losers), 2) if losers else 0,
            "profit_factor": round(sum(winners) / abs(sum(losers)), 4) if losers and sum(losers) != 0 else 999.99,
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


def run_backtest(
    request: BacktestRequest,
    data: Optional[pl.DataFrame] = None,
    fill_rate: float = 1.0,
    use_eligibility_gate: bool = False,
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

    # ─── Firm-specific commission (Task 3.11) ─────────────────
    commission = request.commission_per_side
    if request.firm_key:
        commission = get_commission_per_side(request.firm_key, config.symbol)

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
    over_risk_count = int(np.sum(over_risk))
    if over_risk_count > 0:
        print(
            f"WARNING: {over_risk_count} bars have ATR-implied risk > target "
            f"for 1 contract (over_risk). Trading 1 contract anyway.",
            file=sys.stderr,
        )

    # ─── Session liquidity multipliers (Task 3.7) ─────────────
    session_mult = None
    if "ts_event" in df.columns:
        session_mult = get_session_multipliers(df["ts_event"])

    # Combine session + event slippage multipliers
    combined_slippage_mult = session_mult
    if event_slippage_mult is not None:
        if combined_slippage_mult is not None:
            combined_slippage_mult = combined_slippage_mult * event_slippage_mult
        else:
            combined_slippage_mult = event_slippage_mult

    # ─── Slippage ─────────────────────────────────────────────
    slippage_arr = compute_slippage(
        df, spec, request.slippage_ticks, atr_period,
        session_multipliers=combined_slippage_mult,
    )

    # ─── Eligibility gate (Wave 2.8 integration point) ─────────
    entries_np = df["entry_long"].to_numpy()
    exits_np = df["exit_long"].to_numpy()
    if use_eligibility_gate:
        entries_np, exits_np = apply_eligibility_gate(
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
            short_entries_np, short_exits_np = apply_eligibility_gate(
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
    if request.fill_model and request.fill_model.order_type == "limit":
        from src.engine.fill_model import compute_fill_probabilities, apply_fill_model
        fill_config = request.fill_model.model_dump()
        fill_probs = compute_fill_probabilities(df, fill_config, entries_np)
        entries_np, sizes = apply_fill_model(entries_np, fill_probs, sizes, seed=42)

    # ─── Convert to Pandas at vectorbt boundary (CLAUDE.md rule) ─
    # Use ts_event as index so equity curve has proper datetime indices
    ts_index = df["ts_event"].to_pandas() if "ts_event" in df.columns else None
    close_pd = df["close"].to_pandas()
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
        if request.fill_model and request.fill_model.order_type == "limit":
            from src.engine.fill_model import compute_fill_probabilities, apply_fill_model
            fill_config = request.fill_model.model_dump()
            short_fill_probs = compute_fill_probabilities(df, fill_config, short_entries_np)
            short_entries_np, _ = apply_fill_model(short_entries_np, short_fill_probs, sizes.copy(), seed=43)
        short_entries_pd = pl.Series("entry_short", short_entries_np).to_pandas()
    else:
        short_entries_pd = pd.Series(False, index=close_pd.index)
    short_exits_pd = df["exit_short"].to_pandas() if "exit_short" in df.columns else pd.Series(False, index=close_pd.index)
    if ts_index is not None:
        short_entries_pd.index = ts_index
        short_exits_pd.index = ts_index

    # Clean NaN values
    sizes_clean = np.nan_to_num(sizes, nan=1.0)
    slippage_clean = np.nan_to_num(slippage_arr, nan=0.0)

    # ─── Run vectorbt Portfolio (long + short) ────────────────
    # vectorbt handles SIGNAL TIMING only — no slippage/fees.
    # We compute all P&L ourselves with correct futures math:
    #   dollar_pnl = price_diff × contracts × point_value - slippage - commission
    # This prevents: (1) equity ignoring slippage, (2) commission × point_value bug,
    # (3) fixed_fees treating per-contract fee as per-order.
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
    STARTING_CAPITAL = 100_000.0

    total_trades = int(pf.trades.count())
    trades_records = pf.trades.records_readable if total_trades > 0 else None

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
            trades_list.append(trade)

        trade_pnls_arr = np.array(trade_pnls_list)
        winners = trade_pnls_arr[trade_pnls_arr > 0]
        losers = trade_pnls_arr[trade_pnls_arr < 0]

        win_rate = float(len(winners) / total_trades)
        avg_winner = float(np.mean(winners)) if len(winners) > 0 else 0.0
        avg_loser = float(np.mean(np.abs(losers))) if len(losers) > 0 else 1.0
        gross_profit = float(np.sum(winners))
        gross_loss = float(np.abs(np.sum(losers)))
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf")
        avg_trade_pnl = float(np.mean(trade_pnls_arr))
        winner_loser_ratio = avg_winner / avg_loser if avg_loser > 0 else float("inf")

    # ─── Build equity curve with friction ─────────────────────
    # Bar-level mark-to-market for intra-trade drawdown tracking,
    # with friction costs deducted on entry/exit bars.
    close_arr = close_pd.values
    close_diffs = np.diff(close_arr, prepend=close_arr[0])
    assets = pf.assets().values  # +N=long, -N=short, 0=flat
    prev_assets = np.roll(assets, 1)
    prev_assets[0] = 0

    # Gross bar P&L (mark-to-market, no friction)
    bar_dollar_pnls = prev_assets * close_diffs * spec.point_value

    # Deduct friction on EVERY position change (including reversals).
    # Reversal (e.g., +15 → -15) = exit old + enter new = friction on BOTH.
    for i in range(len(bar_dollar_pnls)):
        old_pos = prev_assets[i]
        new_pos = assets[i]
        if old_pos == new_pos:
            continue
        bar_slip = float(slippage_clean[i]) if not np.isnan(slippage_clean[i]) else 0.0
        bar_friction = bar_slip + commission  # one side
        # Contracts closed (exited or reduced)
        if old_pos != 0:
            if np.sign(new_pos) != np.sign(old_pos):
                # Full exit (or reversal) — friction on all old contracts
                bar_dollar_pnls[i] -= bar_friction * abs(old_pos)
            elif abs(new_pos) < abs(old_pos):
                # Partial close — friction on closed contracts
                bar_dollar_pnls[i] -= bar_friction * (abs(old_pos) - abs(new_pos))
        # Contracts opened (new entry, reversal, or scaling into position)
        if new_pos != 0:
            if np.sign(new_pos) != np.sign(old_pos):
                # New direction entry or reversal — friction on all new contracts
                bar_dollar_pnls[i] -= bar_friction * abs(new_pos)
            elif abs(new_pos) > abs(old_pos):
                # Scaling into existing position — friction on added contracts
                bar_dollar_pnls[i] -= bar_friction * (abs(new_pos) - abs(old_pos))

    equity = STARTING_CAPITAL + np.cumsum(bar_dollar_pnls)
    equity_index = close_pd.index

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
    total_return = total_pnl_dollars / STARTING_CAPITAL
    peak = np.maximum.accumulate(equity)
    drawdown = (equity - peak) / peak
    max_dd = float(np.min(drawdown)) if len(drawdown) > 0 else 0.0

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

    tier = _compute_tier(avg_daily_pnl, winning_days, total_trading_days,
                         max_dd, profit_factor, sharpe)
    forge_score = _compute_forge_score(sharpe, max_dd, profit_factor, win_rate, avg_daily_pnl)

    # ─── Prop firm simulation (all 8 firms) ─────────────────
    prop_compliance = simulate_all_firms(
        daily_pnl_records, trades_list,
        symbol=config.symbol, account_size=50_000,
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
        sharpe_se = sharpe / (total_trading_days ** 0.5)
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
        "equity_curve": _aggregate_equity_daily(equity, equity_index),
        "monthly_returns": _compute_monthly_returns(equity, equity_index),
        "trades": trades_list,
        "daily_pnls": daily_pnl_values,
        "daily_pnl_records": daily_pnl_records,
        "execution_time_ms": elapsed_ms,
        "gap_adjusted_drawdown": gap_adjusted_dd,
        "tier": tier,
        "forge_score": forge_score,
        "recency_analysis": compute_recency_weighted_score(
            daily_pnl_records, sharpe, max_dd, profit_factor, win_rate, avg_daily_pnl,
        ),
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
    }


def _compute_tier(avg_daily_pnl: float, winning_days: int, total_trading_days: int,
                   max_dd: float, profit_factor: float, sharpe: float) -> str:
    """Classify strategy into TIER_1, TIER_2, TIER_3, or REJECTED per CLAUDE.md gates."""
    # max_dd from vectorbt is a NEGATIVE ratio (e.g. -0.02 = 2% drawdown). Convert to positive dollars on $100K.
    max_dd_dollars = abs(max_dd) * 100_000
    win_days_per_20 = (winning_days / max(total_trading_days, 1)) * 20

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

    # Max DD: 100 at 0%, 0 at 5%+ (ratio)
    dd_score = min(100, max(0, (1 - max_dd / 0.05) * 100))

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
    }


def _empty_result(error: str, elapsed: float) -> dict:
    """Return an empty result dict on failure."""
    return {
        "total_return": 0.0,
        "sharpe_ratio": 0.0,
        "max_drawdown": 0.0,
        "win_rate": 0.0,
        "profit_factor": 0.0,
        "total_trades": 0,
        "avg_trade_pnl": 0.0,
        "avg_daily_pnl": 0.0,
        "winning_days": 0,
        "total_trading_days": 0,
        "max_consecutive_losing_days": 0,
        "expectancy_per_trade": 0.0,
        "avg_winner_to_loser_ratio": 0.0,
        "equity_curve": [],
        "trades": [],
        "daily_pnls": [],
        "execution_time_ms": int(elapsed * 1000),
        "error": error,
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

    # ─── Validate bar count ──────────────────────────────────
    _validate_bar_count(data, timeframe, start_date, end_date)

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

    # ─── Firm-specific commission ──────────────────────────────
    commission = commission_per_side
    if firm_key:
        commission = get_commission_per_side(firm_key, symbol)

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
    over_risk_count = int(np.sum(over_risk))
    if over_risk_count > 0:
        print(
            f"WARNING: {over_risk_count} bars have ATR-implied risk > target "
            f"for 1 contract (over_risk). Trading 1 contract anyway.",
            file=sys.stderr,
        )

    # ─── Session liquidity multipliers ─────────────────────────
    session_mult = None
    if "ts_event" in df.columns:
        session_mult = get_session_multipliers(df["ts_event"])

    # ─── Slippage ──────────────────────────────────────────────
    slippage_arr = compute_slippage(
        df, spec, slippage_ticks, 14,
        session_multipliers=session_mult,
    )

    # ─── Convert to Pandas at vectorbt boundary ────────────────
    ts_index = df["ts_event"].to_pandas() if "ts_event" in df.columns else None
    close_pd = df["close"].to_pandas()
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

    sizes_clean = np.nan_to_num(sizes, nan=1.0)
    slippage_clean = np.nan_to_num(slippage_arr, nan=0.0)

    # ─── Run vectorbt Portfolio (long + short) ────────────────
    # vectorbt handles SIGNAL TIMING only — no slippage/fees.
    # We compute all P&L ourselves with correct futures math.
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
    STARTING_CAPITAL = 100_000.0

    total_trades = int(pf.trades.count())
    trades_records = pf.trades.records_readable if total_trades > 0 else None

    win_rate = 0.0
    profit_factor = 0.0
    avg_trade_pnl = 0.0
    winner_loser_ratio = 0.0
    trades_list: list[dict] = []
    trade_pnls_arr = np.array([])

    if trades_records is not None:
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
            trades_list.append(trade)

        trade_pnls_arr = np.array(trade_pnls_list)
        winners = trade_pnls_arr[trade_pnls_arr > 0]
        losers = trade_pnls_arr[trade_pnls_arr < 0]

        win_rate = float(len(winners) / total_trades)
        avg_winner = float(np.mean(winners)) if len(winners) > 0 else 0.0
        avg_loser = float(np.mean(np.abs(losers))) if len(losers) > 0 else 1.0
        gross_profit = float(np.sum(winners))
        gross_loss = float(np.abs(np.sum(losers)))
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf")
        avg_trade_pnl = float(np.mean(trade_pnls_arr))
        winner_loser_ratio = avg_winner / avg_loser if avg_loser > 0 else float("inf")

    # ─── Build equity curve with friction ─────────────────────
    close_arr = close_pd.values
    close_diffs = np.diff(close_arr, prepend=close_arr[0])
    assets = pf.assets().values
    prev_assets = np.roll(assets, 1)
    prev_assets[0] = 0

    bar_dollar_pnls = prev_assets * close_diffs * spec.point_value

    # Deduct friction on EVERY position change (including reversals).
    # Reversal (e.g., +15 → -15) = exit old + enter new = friction on BOTH.
    for i in range(len(bar_dollar_pnls)):
        old_pos = prev_assets[i]
        new_pos = assets[i]
        if old_pos == new_pos:
            continue
        bar_slip = float(slippage_clean[i]) if not np.isnan(slippage_clean[i]) else 0.0
        bar_friction = bar_slip + commission  # one side
        # Contracts closed (exited or reduced)
        if old_pos != 0:
            if np.sign(new_pos) != np.sign(old_pos):
                # Full exit (or reversal) — friction on all old contracts
                bar_dollar_pnls[i] -= bar_friction * abs(old_pos)
            elif abs(new_pos) < abs(old_pos):
                # Partial close — friction on closed contracts
                bar_dollar_pnls[i] -= bar_friction * (abs(old_pos) - abs(new_pos))
        # Contracts opened (new entry, reversal, or scaling into position)
        if new_pos != 0:
            if np.sign(new_pos) != np.sign(old_pos):
                # New direction entry or reversal — friction on all new contracts
                bar_dollar_pnls[i] -= bar_friction * abs(new_pos)
            elif abs(new_pos) > abs(old_pos):
                # Scaling into existing position — friction on added contracts
                bar_dollar_pnls[i] -= bar_friction * (abs(new_pos) - abs(old_pos))

    equity = STARTING_CAPITAL + np.cumsum(bar_dollar_pnls)
    equity_index = close_pd.index

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
    total_return = total_pnl_dollars / STARTING_CAPITAL
    peak = np.maximum.accumulate(equity)
    drawdown = (equity - peak) / peak
    max_dd = float(np.min(drawdown)) if len(drawdown) > 0 else 0.0

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
        except Exception:
            pass  # gap_risk module may not be fully wired yet

    elapsed_ms = int((time.time() - start_time) * 1000)

    tier = _compute_tier(avg_daily_pnl, winning_days, total_trading_days,
                         max_dd, profit_factor, sharpe)
    forge_score = _compute_forge_score(sharpe, max_dd, profit_factor, win_rate, avg_daily_pnl)

    # ─── Prop firm simulation (all 8 firms) ─────────────────
    prop_compliance = simulate_all_firms(
        daily_pnl_records, trades_list,
        symbol=symbol, account_size=50_000,
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
        sharpe_se = sharpe / (total_trading_days ** 0.5)
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
        "equity_curve": _aggregate_equity_daily(equity, equity_index),
        "monthly_returns": _compute_monthly_returns(equity, equity_index),
        "trades": trades_list,
        "daily_pnls": daily_pnl_values,
        "daily_pnl_records": daily_pnl_records,
        "execution_time_ms": elapsed_ms,
        "gap_adjusted_drawdown": gap_adjusted_dd,
        "tier": tier,
        "forge_score": forge_score,
        "recency_analysis": compute_recency_weighted_score(
            daily_pnl_records, sharpe, max_dd, profit_factor, win_rate, avg_daily_pnl,
        ),
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

        result = run_class_backtest(
            strategy=strategy,
            start_date=config.get("start_date", "2010-01-01"),
            end_date=config.get("end_date", "2030-12-31"),
            slippage_ticks=config.get("slippage_ticks", 1.0),
            commission_per_side=config.get("commission_per_side", 4.50),
            firm_key=config.get("firm_key"),
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
            result = run_walk_forward(request)
        else:
            result = run_backtest(request)

    if backtest_id:
        result["backtest_id"] = backtest_id

    print(json.dumps(result))


if __name__ == "__main__":
    main()
