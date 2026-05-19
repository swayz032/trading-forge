"""Diff harness — runs same fixture through vectorbt and backtrader, then
compares trade lists, total PnL, and Sharpe within defined tolerances.

Tolerance (per plan A3):
  - Total PnL within 0.1%
  - Trade count within ±1
  - Sharpe within 0.05

Design:
- Same synthetic OHLCV data is fed to both engines.
- Same slippage array and commission are applied to both engines.
- P&L is computed with futures math (never delegated to vectorbt/backtrader).
- Sharpe is annualised from per-trade P&L using a simple ratio estimator
  (avoids the vectorbt freq-annualisation quirks; both engines use the same
  estimator so the comparison is apples-to-apples).
- Divergences are documented with a trade-by-trade dump — they are NOT
  treated as failures silently. The caller decides severity.

This module does NOT import from backtester.py to avoid pulling in the full
production dependency tree into the parity test. The vectorbt run here is a
minimal re-implementation of the EMA crossover / ATR breakout signal logic.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

import numpy as np
import pandas as pd
import polars as pl

from src.engine.parity_engine.backtrader_adapter import BTTrade, run_backtrader


# ─── Result types ─────────────────────────────────────────────────────

@dataclass
class VBTTrade:
    """Minimal trade record from the vectorbt-side computation."""
    entry_bar: int
    exit_bar: int
    entry_price: float
    exit_price: float
    direction: str      # "Long" | "Short"
    contracts: int
    net_pnl: float
    exit_reason: str


@dataclass
class ParityResult:
    fixture_name: str
    vbt_trade_count: int
    bt_trade_count: int
    vbt_total_pnl: float
    bt_total_pnl: float
    pnl_diff_pct: float         # abs((vbt - bt) / vbt) * 100
    vbt_sharpe: float
    bt_sharpe: float
    sharpe_diff: float          # abs(vbt - bt)
    passed: bool
    failure_reasons: list[str]
    vbt_trades: list[VBTTrade]
    bt_trades: list[BTTrade]


# ─── Tolerances ───────────────────────────────────────────────────────

PNL_TOLERANCE_PCT = 0.10        # 0.1%
TRADE_COUNT_TOLERANCE = 1       # ±1 trade
SHARPE_TOLERANCE = 0.05


# ─── Vectorbt-side signal engine (minimal, self-contained) ───────────

def _compute_ema(series: np.ndarray, period: int) -> np.ndarray:
    """EWM EMA — matches Polars ewm_mean(span=period) numerically."""
    alpha = 2.0 / (period + 1)
    out = np.full_like(series, np.nan, dtype=float)
    # Find first non-NaN
    start = 0
    while start < len(series) and math.isnan(series[start]):
        start += 1
    if start >= len(series):
        return out
    out[start] = series[start]
    for i in range(start + 1, len(series)):
        if math.isnan(series[i]):
            out[i] = out[i - 1]
        else:
            out[i] = alpha * series[i] + (1 - alpha) * out[i - 1]
    return out


def _compute_atr_ewm(df: pd.DataFrame, period: int) -> np.ndarray:
    """ATR via EWM — matches core.compute_atr() (Polars ewm_mean alpha=1/period)."""
    hi = df["high"].to_numpy(dtype=float)
    lo = df["low"].to_numpy(dtype=float)
    cl = df["close"].to_numpy(dtype=float)
    prev_cl = np.roll(cl, 1)
    prev_cl[0] = cl[0]

    tr1 = hi - lo
    tr2 = np.abs(hi - prev_cl)
    tr3 = np.abs(lo - prev_cl)
    tr = np.maximum(tr1, np.maximum(tr2, tr3))

    alpha = 1.0 / period
    atr = np.full(len(tr), np.nan, dtype=float)
    atr[0] = tr[0]
    for i in range(1, len(tr)):
        atr[i] = alpha * tr[i] + (1 - alpha) * atr[i - 1]
    return atr


def _sharpe_from_pnls(pnls: list[float]) -> float:
    """Annualised Sharpe from per-trade PnL list (252-day scale).

    Uses simple trade-level Sharpe (mean / std) scaled by sqrt(252).
    Both engines use this same estimator so the comparison is consistent.
    Returns 0.0 when < 2 trades.
    """
    if len(pnls) < 2:
        return 0.0
    arr = np.array(pnls, dtype=float)
    std = float(np.std(arr, ddof=1))
    if std < 1e-10:
        return 0.0
    return float(np.mean(arr) / std * math.sqrt(252))


# ─── Vectorbt-side run (EMA crossover) ───────────────────────────────

def _run_vbt_ema_crossover(
    df: pd.DataFrame,
    dsl: dict,
    slippage_arr: np.ndarray,
    commission_per_side: float,
    point_value: float,
    contracts: int,
) -> list[VBTTrade]:
    """Minimal vectorbt-equivalent EMA crossover run.

    Parity with backtrader EMACrossoverStrategy:
    - Warmup guard: no signals before bar max(fast_period, slow_period) + confirmation_bars.
      Backtrader indicators do not emit values until fully warmed up.
    - Signal on bar N (crossover detected) → fill on bar N + confirmation_bars + 1 (next-bar).
    - Stop/target exits checked bar-by-bar.
    - P&L computed with futures math.
    """
    ep = dsl.get("entry_params", {})
    fast = int(ep.get("fast_period", 9))
    slow = int(ep.get("slow_period", 21))
    conf_bars = int(ep.get("confirmation_bars", 2))
    stop_mult = float(dsl.get("stop_loss_atr_multiple", 1.8))
    tp_mult = float(dsl.get("take_profit_atr_multiple") or 0.0)

    # Warmup: backtrader EMA indicator returns NaN for the first (period - 1) bars,
    # then starts producing values. A crossover cannot be detected until BOTH EMAs
    # have warmed up (slow_period bars), plus one more bar for the prior-value comparison.
    # This guard must match backtrader's minimum period behavior exactly.
    warmup_bars = slow  # slow EMA dominates warmup; +1 implicit for crossover prev-bar check

    close = df["close"].to_numpy(dtype=float)
    high = df["high"].to_numpy(dtype=float)
    low = df["low"].to_numpy(dtype=float)
    opens = df["open"].to_numpy(dtype=float)
    n = len(close)

    ema_fast = _compute_ema(close, fast)
    ema_slow = _compute_ema(close, slow)
    atr = _compute_atr_ewm(df, 14)

    direction = dsl.get("direction", "both")
    sides = ["long", "short"] if direction == "both" else [direction]

    trades: list[VBTTrade] = []

    for side in sides:
        # Crossover signals: fast crosses slow (only after warmup)
        cross_above = np.zeros(n, dtype=bool)
        cross_below = np.zeros(n, dtype=bool)
        for i in range(warmup_bars, n):
            # Both EMAs and their previous values must be valid (not NaN)
            if (not math.isnan(ema_fast[i]) and not math.isnan(ema_slow[i])
                    and not math.isnan(ema_fast[i - 1]) and not math.isnan(ema_slow[i - 1])):
                if ema_fast[i] > ema_slow[i] and ema_fast[i - 1] <= ema_slow[i - 1]:
                    cross_above[i] = True
                if ema_fast[i] < ema_slow[i] and ema_fast[i - 1] >= ema_slow[i - 1]:
                    cross_below[i] = True

        if side == "long":
            raw_signal = cross_above
        else:
            raw_signal = cross_below

        # Apply confirmation delay.
        # Backtrader behavior:
        #   - Crossover at bar N → _bars_since_cross starts counting from 1
        #   - Check is `_bars_since_cross > conf_bars` (strictly greater)
        #   - After conf_bars iterations (bars N+1..N+conf_bars), fires at bar N+conf_bars
        #   - Fill uses open[0] at the bar where the condition fires = open[N + conf_bars]
        # So fill_bar = signal_bar + conf_bars.
        entry_signals = np.zeros(n, dtype=bool)
        for i in range(n):
            if raw_signal[i]:
                fill_bar = i + conf_bars
                if fill_bar < n:
                    entry_signals[fill_bar] = True

        # Bar-by-bar trade simulation
        in_trade = False
        entry_bar = -1
        entry_price = 0.0
        stop_price = 0.0
        tp_price = float("inf") if side == "long" else float("-inf")

        for i in range(n):
            if in_trade:
                hi = high[i]
                lo = low[i]
                exited = False
                exit_price = 0.0
                exit_reason = "signal"

                if side == "long":
                    if lo <= stop_price:
                        exit_price = stop_price
                        exit_reason = "stop"
                        exited = True
                    elif hi >= tp_price:
                        exit_price = tp_price
                        exit_reason = "target"
                        exited = True
                else:
                    if hi >= stop_price:
                        exit_price = stop_price
                        exit_reason = "stop"
                        exited = True
                    elif lo <= tp_price:
                        exit_price = tp_price
                        exit_reason = "target"
                        exited = True

                if exited:
                    slip_e = float(slippage_arr[entry_bar]) if entry_bar < len(slippage_arr) else 0.0
                    slip_x = float(slippage_arr[i]) if i < len(slippage_arr) else 0.0
                    slip_e = 0.0 if math.isnan(slip_e) else slip_e
                    slip_x = 0.0 if math.isnan(slip_x) else slip_x
                    if side == "long":
                        gross = (exit_price - entry_price) * contracts * point_value
                    else:
                        gross = (entry_price - exit_price) * contracts * point_value
                    net = gross - (slip_e + slip_x) * contracts - commission_per_side * contracts * 2
                    trades.append(VBTTrade(
                        entry_bar=entry_bar,
                        exit_bar=i,
                        entry_price=entry_price,
                        exit_price=exit_price,
                        direction="Long" if side == "long" else "Short",
                        contracts=contracts,
                        net_pnl=round(net, 2),
                        exit_reason=exit_reason,
                    ))
                    in_trade = False

            if not in_trade and entry_signals[i]:
                entry_price = opens[i]
                atr_val = atr[i] if not math.isnan(atr[i]) else 1.0
                entry_bar = i
                in_trade = True
                if side == "long":
                    stop_price = entry_price - atr_val * stop_mult
                    tp_price = (entry_price + atr_val * tp_mult) if tp_mult > 0 else float("inf")
                else:
                    stop_price = entry_price + atr_val * stop_mult
                    tp_price = (entry_price - atr_val * tp_mult) if tp_mult > 0 else float("-inf")

        # Close open trade at end
        if in_trade:
            exit_price = close[-1]
            slip_e = float(slippage_arr[entry_bar]) if entry_bar < len(slippage_arr) else 0.0
            slip_x = float(slippage_arr[n - 1]) if n - 1 < len(slippage_arr) else 0.0
            slip_e = 0.0 if math.isnan(slip_e) else slip_e
            slip_x = 0.0 if math.isnan(slip_x) else slip_x
            if side == "long":
                gross = (exit_price - entry_price) * contracts * point_value
            else:
                gross = (entry_price - exit_price) * contracts * point_value
            net = gross - (slip_e + slip_x) * contracts - commission_per_side * contracts * 2
            trades.append(VBTTrade(
                entry_bar=entry_bar,
                exit_bar=n - 1,
                entry_price=entry_price,
                exit_price=exit_price,
                direction="Long" if side == "long" else "Short",
                contracts=contracts,
                net_pnl=round(net, 2),
                exit_reason="eod",
            ))

    return trades


# ─── Vectorbt-side run (ATR breakout) ────────────────────────────────

def _run_vbt_atr_breakout(
    df: pd.DataFrame,
    dsl: dict,
    slippage_arr: np.ndarray,
    commission_per_side: float,
    point_value: float,
    contracts: int,
) -> list[VBTTrade]:
    """Minimal vectorbt-equivalent ATR breakout run.

    Parity with backtrader ATRBreakoutStrategy:
    - Warmup guard: no signals before bar atr_period (ATR and rolling high/low need warmup).
    - Signal on bar N (breakout detected on close) → fill on bar N+1 open.
      Implemented via a pending_signal flag, same as backtrader's _signal_pending.
    - Stop/target exits checked before pending entry on same bar.
    - P&L computed with futures math.
    """
    ep = dsl.get("entry_params", {})
    atr_period = int(ep.get("period", 14))
    atr_mult = float(ep.get("multiplier", 1.5))
    stop_mult = float(dsl.get("stop_loss_atr_multiple", 1.2))
    tp_mult = float(dsl.get("take_profit_atr_multiple") or 0.0)

    close = df["close"].to_numpy(dtype=float)
    high = df["high"].to_numpy(dtype=float)
    low = df["low"].to_numpy(dtype=float)
    opens = df["open"].to_numpy(dtype=float)
    n = len(close)

    atr = _compute_atr_ewm(df, atr_period)

    # Rolling period high/low — use PRIOR bars (shift by 1 to avoid lookahead).
    # period_high[i] = max(high[i-atr_period : i])  (exclusive of bar i itself)
    period_high = np.full(n, np.nan)
    period_low = np.full(n, np.nan)
    for i in range(atr_period, n):
        period_high[i] = float(np.max(high[i - atr_period:i]))
        period_low[i] = float(np.min(low[i - atr_period:i]))

    direction = dsl.get("direction", "both")
    sides = ["long", "short"] if direction == "both" else [direction]

    trades: list[VBTTrade] = []

    for side in sides:
        in_trade = False
        entry_bar = -1
        entry_price = 0.0
        stop_price = 0.0
        tp_price = float("inf") if side == "long" else float("-inf")
        pending_entry_atr = 0.0     # ATR captured at signal bar for stop/TP calculation
        signal_pending = False      # Next-bar fill flag (mirrors backtrader _signal_pending)

        def _close_trade(exit_bar: int, exit_price: float, exit_reason: str) -> None:
            nonlocal in_trade, entry_bar
            slip_e = float(slippage_arr[entry_bar]) if entry_bar < len(slippage_arr) else 0.0
            slip_x = float(slippage_arr[exit_bar]) if exit_bar < len(slippage_arr) else 0.0
            slip_e = 0.0 if math.isnan(slip_e) else slip_e
            slip_x = 0.0 if math.isnan(slip_x) else slip_x
            if side == "long":
                gross = (exit_price - entry_price) * contracts * point_value
            else:
                gross = (entry_price - exit_price) * contracts * point_value
            net = gross - (slip_e + slip_x) * contracts - commission_per_side * contracts * 2
            trades.append(VBTTrade(
                entry_bar=entry_bar,
                exit_bar=exit_bar,
                entry_price=entry_price,
                exit_price=exit_price,
                direction="Long" if side == "long" else "Short",
                contracts=contracts,
                net_pnl=round(net, 2),
                exit_reason=exit_reason,
            ))
            in_trade = False

        for i in range(1, n):
            atr_val = atr[i] if not math.isnan(atr[i]) else 1.0
            hi = high[i]
            lo = low[i]

            # 1. Check stops/targets on active trade
            if in_trade:
                exited = False
                exit_price = 0.0
                exit_reason = "signal"

                if side == "long":
                    if lo <= stop_price:
                        exit_price = stop_price
                        exit_reason = "stop"
                        exited = True
                    elif hi >= tp_price:
                        exit_price = tp_price
                        exit_reason = "target"
                        exited = True
                else:
                    if hi >= stop_price:
                        exit_price = stop_price
                        exit_reason = "stop"
                        exited = True
                    elif lo <= tp_price:
                        exit_price = tp_price
                        exit_reason = "target"
                        exited = True

                if exited:
                    _close_trade(i, exit_price, exit_reason)
                    signal_pending = False  # cancel any pending entry
                    continue

            # 2. Execute pending next-bar fill (signal was set on prior bar)
            if signal_pending and not in_trade:
                entry_price = opens[i]
                entry_bar = i
                in_trade = True
                if side == "long":
                    stop_price = entry_price - pending_entry_atr * stop_mult
                    tp_price = (entry_price + pending_entry_atr * tp_mult) if tp_mult > 0 else float("inf")
                else:
                    stop_price = entry_price + pending_entry_atr * stop_mult
                    tp_price = (entry_price - pending_entry_atr * tp_mult) if tp_mult > 0 else float("-inf")
                signal_pending = False
                continue

            # 3. Detect breakout signal on this bar's close (after warmup)
            if i < atr_period:
                continue
            ph = period_high[i] if not math.isnan(period_high[i]) else close[i]
            pl_ = period_low[i] if not math.isnan(period_low[i]) else close[i]
            channel = atr_val * atr_mult

            if not in_trade and not signal_pending:
                if side == "long" and close[i] > ph + channel:
                    signal_pending = True
                    pending_entry_atr = atr_val
                elif side == "short" and close[i] < pl_ - channel:
                    signal_pending = True
                    pending_entry_atr = atr_val

        # Close any open trade at end of series
        if in_trade:
            _close_trade(n - 1, close[n - 1], "eod")

    return trades


# ─── Main diff function ───────────────────────────────────────────────

def run_parity_diff(
    fixture_name: str,
    dsl: dict,
    df_pd: pd.DataFrame,
    slippage_arr: Optional[np.ndarray] = None,
    commission_per_side: float = 0.62,
    point_value: float = 5.0,
    contracts: int = 1,
) -> ParityResult:
    """Run both engines on the same data and return a ParityResult.

    Args:
        fixture_name: human-readable name (e.g. "trend_mnq").
        dsl: parsed DSL dict (from JSON fixture file).
        df_pd: OHLCV DataFrame, DatetimeIndex, cols [open, high, low, close, volume].
        slippage_arr: per-bar dollar slippage; zeros if None.
        commission_per_side: dollars per side per contract.
        point_value: futures multiplier.
        contracts: fixed size for parity test.

    Returns:
        ParityResult with all comparison metrics.
    """
    if slippage_arr is None:
        slippage_arr = np.zeros(len(df_pd), dtype=float)

    ind = dsl.get("entry_indicator", "")

    # ── VBT side ──────────────────────────────────────────────────────
    if ind == "ema_crossover":
        vbt_trades = _run_vbt_ema_crossover(
            df_pd, dsl, slippage_arr, commission_per_side, point_value, contracts
        )
    elif ind == "atr_breakout":
        vbt_trades = _run_vbt_atr_breakout(
            df_pd, dsl, slippage_arr, commission_per_side, point_value, contracts
        )
    else:
        raise NotImplementedError(f"No vectorbt runner for indicator '{ind}'")

    # ── Backtrader side ───────────────────────────────────────────────
    bt_trades = run_backtrader(
        dsl=dsl,
        df_pd=df_pd,
        slippage_arr=slippage_arr,
        commission_per_side=commission_per_side,
        point_value=point_value,
        contracts=contracts,
    )

    # ── Aggregate metrics ─────────────────────────────────────────────
    vbt_pnls = [t.net_pnl for t in vbt_trades]
    bt_pnls = [t.net_pnl for t in bt_trades]

    vbt_total = sum(vbt_pnls)
    bt_total = sum(bt_pnls)

    # PnL % difference (relative to vbt; use absolute reference to avoid sign flip)
    denominator = abs(vbt_total) if abs(vbt_total) > 1e-10 else 1.0
    pnl_diff_pct = abs(vbt_total - bt_total) / denominator * 100.0

    vbt_sharpe = _sharpe_from_pnls(vbt_pnls)
    bt_sharpe = _sharpe_from_pnls(bt_pnls)
    sharpe_diff = abs(vbt_sharpe - bt_sharpe)

    # ── Tolerance checks ──────────────────────────────────────────────
    failures: list[str] = []

    trade_diff = abs(len(vbt_trades) - len(bt_trades))
    if trade_diff > TRADE_COUNT_TOLERANCE:
        failures.append(
            f"Trade count divergence: vbt={len(vbt_trades)} bt={len(bt_trades)} "
            f"diff={trade_diff} > tolerance={TRADE_COUNT_TOLERANCE}"
        )

    if pnl_diff_pct > PNL_TOLERANCE_PCT:
        failures.append(
            f"PnL divergence: vbt={vbt_total:.2f} bt={bt_total:.2f} "
            f"diff={pnl_diff_pct:.4f}% > tolerance={PNL_TOLERANCE_PCT}%"
        )

    if sharpe_diff > SHARPE_TOLERANCE:
        failures.append(
            f"Sharpe divergence: vbt={vbt_sharpe:.4f} bt={bt_sharpe:.4f} "
            f"diff={sharpe_diff:.4f} > tolerance={SHARPE_TOLERANCE}"
        )

    passed = len(failures) == 0

    return ParityResult(
        fixture_name=fixture_name,
        vbt_trade_count=len(vbt_trades),
        bt_trade_count=len(bt_trades),
        vbt_total_pnl=round(vbt_total, 2),
        bt_total_pnl=round(bt_total, 2),
        pnl_diff_pct=round(pnl_diff_pct, 4),
        vbt_sharpe=round(vbt_sharpe, 4),
        bt_sharpe=round(bt_sharpe, 4),
        sharpe_diff=round(sharpe_diff, 4),
        passed=passed,
        failure_reasons=failures,
        vbt_trades=vbt_trades,
        bt_trades=bt_trades,
    )
