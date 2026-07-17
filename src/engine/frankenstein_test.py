"""Trading Forge — Frankenstein Test (A4, W10 Team C).

Detects path-dependent backtester bugs (lookahead, future-data leak).

If a strategy shows edge on shuffled or synthetic GBM data, the backtester has
a bug — because no real edge can survive data whose temporal structure has been
destroyed. THIS IS THE GATE'S DESIGN INTENT, NOT ITS CURRENT REALITY — see the
"KNOWN LIMITATION" block below before trusting this docstring's claims.

Design (locked from plan):
  Primary:   100 shuffles via full_shuffle
  Secondary:  50 runs via synthetic_gbm (different distributional bug class)
  Pass:  95th percentile of |Sharpe| < 0.3  AND  median PF in [0.85, 1.15]
  Run at:
    (1) Every new archetype during dev (via pytest)
    (2) TESTING → PAPER lifecycle gate (frankenstein-service.ts)

Shuffle modes:
  full_shuffle         — bars shuffled uniformly (destroys all temporal structure)
  benchmark_relative   — excess returns above benchmark shuffled (long-only strategies)
  calendar_preserving  — shuffle within day-of-week buckets (calendar-effect strategies)
  synthetic_gbm        — replace bars with GBM random walk at matched mean/vol

═══════════════════════════════════════════════════════════════════════════
KNOWN LIMITATION — CRIT (capital-safety-compliance-gates wave, 2026-07-17)
═══════════════════════════════════════════════════════════════════════════
This module's docstring above (and its historical CLAUDE.md §12 billing as
"the single highest-leverage bug-detection test in the system") describes what
this A4 hard promotion gate is SUPPOSED to test: does the REAL backtester
(src/engine/backtester.py — real fill-order, real stop/TP1/TP2/BE+1, real
adaptive/structural exits, real partial fills) leak future information when
run on REAL market bars.

THAT IS NOT WHAT THIS MODULE CURRENTLY DOES:

  1. `_simulate_shuffled()` below is a hand-rolled, structurally-simplistic
     reimplementation: flat position-flip entries/exits on a raw signal array,
     NO stops, NO TP1/TP2, NO BE+1, NO adaptive/structural exits, NO partial
     fills. It does not call `backtester.py::run_backtest()` or
     `generate_signals()`, and it never will merely by reading this file —
     `_apply_static_styleC_management()` / `_apply_trade_management()` /
     the DSL evaluation path in backtester.py are NEVER INVOKED by this test.
  2. The bars this reimplementation runs on are NOT real market bars. The
     caller (frankenstein-service.ts::fetchBarsFromTrades) synthesizes them
     by linearly interpolating between each trade's OWN entry/exit price —
     i.e. the "data" is derived FROM the very trades whose fill logic is
     supposedly being probed, not independent market data.

CONSEQUENCE: a real lookahead / future-data-leak bug living in backtester.py's
fill-order or `_apply_trade_management` logic CANNOT be detected by this gate,
because that code path is structurally never exercised. The gate can still
catch bugs in `_build_signal()` itself (the DSL-crossover proxies below) and
in gross distributional anomalies, but it is NOT currently the "real
backtester on real bars" lookahead detector its own docstring and CLAUDE.md
billing claim. `run_frankenstein_test()` below fires a `logger.warning()` on
every invocation, and the JSON result carries `"engine_fidelity":
"synthetic_reimplementation_not_real_backtester"` (see `FrankensteinResult`)
so this limitation is loud in every log line and every audit trail —
frankenstein-service.ts logs it at `logger.warn()` on every completed run —
rather than continuing to silently claim confidence the gate does not have.

NAMED FOLLOW-UP DESIGN (not built this wave — scope too large for a bundled
fix-wave item per the wave's own instructions; ratify-packet required since
this is instrument/gate code):
  A. Bars: frankenstein-service.ts must fetch REAL OHLCV bars for the
     backtest's symbol/timeframe/date-range (the same S3-backed loader path
     `backtest-service.ts` already uses via the Python data_loader — see
     CLAUDE.md §15 "Data Providers: Databento"), not synthesize them from
     trade entry/exit prices. `fetchBarsFromTrades` should be renamed/
     replaced by a real-bars fetch once this lands.
  B. Signal + management: `_simulate_shuffled()` should drive the REAL DSL
     evaluation path (`generate_signals()` in backtester.py) for entries, and
     the REAL Style C / adaptive management (`_apply_static_styleC_management`
     / `_apply_trade_management`) for exits — either by invoking
     `run_backtest()` directly per shuffle (accepting the wall-clock cost;
     the WALL_CLOCK_CEILING_S=30 budget and n_shuffles=100 would need
     re-tuning, likely via a cheaper vectorized-shuffle harness rather than
     100 full `run_backtest()` subprocess-equivalent calls), or by factoring
     the fill/management logic into a directly-callable pure function the
     shuffle loop can call in-process without the full walk-forward/gate
     machinery `run_backtest()` also runs.
  C. Given (B)'s cost, a phased approach is recommended: land (A) first
     (real bars, still hand-rolled signal/management) as a strictly-more-
     honest intermediate state, then (B) as its own ratified instrument
     change once the performance envelope is measured.
This block is the tracked, concrete owner-pointer for that follow-up — do not
let it silently rot; the next agent picking up A4 hardening should start here.
═══════════════════════════════════════════════════════════════════════════
"""

from __future__ import annotations

import json
import logging
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from concurrent.futures import TimeoutError as FuturesTimeout
from dataclasses import dataclass
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

# ─── Constants ────────────────────────────────────────────────────────────────

# Pass criteria (locked from plan)
PASS_P95_SHARPE_THRESHOLD = 0.3   # 95th pct of |Sharpe| across shuffles must be < 0.3
PASS_MEDIAN_PF_LOW = 0.85          # median PF must be within [0.85, 1.15]
PASS_MEDIAN_PF_HIGH = 1.15

# Parallelism: 10 workers for 100 shuffles ≈ 5 min wall clock on fixture strategy
DEFAULT_N_WORKERS = 10

# 30s wall-clock cost ceiling (matches Tier 3.4 Grover pattern)
WALL_CLOCK_CEILING_S = 30.0

# ─── Data Structures ─────────────────────────────────────────────────────────


@dataclass
class FrankensteinResult:
    test_mode: str
    n_shuffles: int
    p95_sharpe: float          # 95th pct of |Sharpe| — gate criterion #1
    median_pf: float           # median profit factor — gate criterion #2
    passed: bool               # True iff both criteria met
    sharpe_distribution: list[float]
    pf_distribution: list[float]
    failure_examples: list[dict[str, Any]]  # runs with anomalously high |Sharpe|
    wall_clock_ms: int
    status: str                # "completed" | "failed"
    error_message: str | None
    # CRIT LOUD-signal fix (capital-safety-compliance-gates wave, 2026-07-17):
    # additive field (default so no existing positional/keyword construction
    # site breaks) that makes the module-docstring "KNOWN LIMITATION" visible
    # in every JSON result and every audit row a caller derives from it —
    # this gate currently runs a hand-rolled reimplementation on
    # trade-interpolated synthetic bars, NOT the real backtester.py fill/
    # management logic on real market bars. See the module docstring for the
    # full explanation and the named follow-up design.
    engine_fidelity: str = "synthetic_reimplementation_not_real_backtester"


# ─── Shuffle / Synthetic Data Generators ─────────────────────────────────────


def _shuffle_bars(
    bars: np.ndarray,
    mode: str,
    rng: np.random.Generator,
) -> np.ndarray:
    """Shuffle bars according to the requested mode.

    Args:
        bars: shape (N, 4) — columns: open, high, low, close (or any OHLC-like ndarray).
        mode: one of full_shuffle | benchmark_relative | calendar_preserving
        rng: seeded numpy random generator for reproducibility

    Returns:
        Shuffled bars array, same shape as input.
    """
    n = len(bars)
    if n < 2:
        return bars.copy()

    result = bars.copy()

    if mode == "full_shuffle":
        # Shuffle entire bar rows uniformly — destroys ALL temporal structure.
        # If strategy still shows edge, it has lookahead into the future.
        idx = rng.permutation(n)
        result = bars[idx]

    elif mode == "benchmark_relative":
        # Shuffle the bar-to-bar log returns (excess above mean return).
        # Preserves distributional properties but destroys temporal ordering.
        # Suitable for long-only strategies where we subtract benchmark trend.
        close = bars[:, 3].astype(float)
        log_returns = np.diff(np.log(close + 1e-9))
        mean_return = np.mean(log_returns)
        excess = log_returns - mean_return
        shuffled_excess = rng.permutation(excess)
        # Reconstruct close prices from shuffled excess returns
        new_log_close = np.zeros(n)
        new_log_close[0] = np.log(close[0] + 1e-9)
        for i in range(1, n):
            new_log_close[i] = new_log_close[i - 1] + mean_return + shuffled_excess[i - 1]
        new_close = np.exp(new_log_close)
        # Scale O/H/L proportionally
        scale = new_close / (close + 1e-9)
        result[:, 0] = bars[:, 0] * scale   # open
        result[:, 1] = bars[:, 1] * scale   # high
        result[:, 2] = bars[:, 2] * scale   # low
        result[:, 3] = new_close            # close

    elif mode == "calendar_preserving":
        # Shuffle bars within day-of-week buckets (0=Mon, ..., 4=Fri).
        # Preserves within-day temporal structure but destroys cross-week ordering.
        # Appropriate for calendar-effect strategies (e.g., Monday effect).
        n_bars = len(bars)
        # Assign each bar to a day-of-week bucket based on its position
        # (assumes regular bar spacing, 5 days/week)
        dow = np.arange(n_bars) % 5
        for day in range(5):
            mask = dow == day
            indices = np.where(mask)[0]
            if len(indices) > 1:
                shuffled_indices = rng.permutation(indices)
                result[indices] = bars[shuffled_indices]
    else:
        raise ValueError(f"Unknown shuffle mode: {mode!r}")

    return result


def _synthetic_gbm(
    bars: np.ndarray,
    rng: np.random.Generator,
) -> np.ndarray:
    """Replace bar data with a geometric Brownian motion random walk.

    Matches the mean log-return and volatility of the original data so the
    distributional properties are realistic — but ALL temporal structure is
    destroyed. This detects a different class of bugs than shuffling:
    bugs that depend on the distributional shape of returns, not just order.

    Args:
        bars: shape (N, 4) — original OHLC bars
        rng: seeded numpy generator

    Returns:
        Synthetic OHLC bars with GBM-generated prices, same shape as input.
    """
    n = len(bars)
    if n < 2:
        return bars.copy()

    close = bars[:, 3].astype(float)
    log_returns = np.diff(np.log(close + 1e-9))

    mu = float(np.mean(log_returns))
    sigma = float(np.std(log_returns))
    if sigma < 1e-9:
        sigma = 1e-9  # prevent degenerate flat series

    # GBM: log(S_t / S_{t-1}) ~ N(mu - 0.5*sigma^2, sigma^2)
    drift = mu - 0.5 * sigma ** 2
    noise = rng.normal(loc=drift, scale=sigma, size=n - 1)

    new_log_close = np.zeros(n)
    new_log_close[0] = np.log(close[0] + 1e-9)
    for i in range(1, n):
        new_log_close[i] = new_log_close[i - 1] + noise[i - 1]

    new_close = np.exp(new_log_close)

    # Synthesize O/H/L relative to close using the original spread ratios
    # (preserves intrabar structure while destroying cross-bar structure)
    orig_high_ratio = bars[:, 1] / (close + 1e-9)
    orig_low_ratio = bars[:, 2] / (close + 1e-9)
    orig_open_ratio = bars[:, 0] / (close + 1e-9)

    result = np.zeros_like(bars, dtype=float)
    result[:, 3] = new_close
    result[:, 0] = new_close * orig_open_ratio
    result[:, 1] = new_close * orig_high_ratio
    result[:, 2] = new_close * orig_low_ratio

    # Ensure high >= close >= low (GBM won't violate this but ratios might)
    result[:, 1] = np.maximum(result[:, 1], new_close)
    result[:, 2] = np.minimum(result[:, 2], new_close)

    return result


# ─── Strategy Simulation on Shuffled Data ────────────────────────────────────

# Supported entry_indicator dispatch map (option b fix — 2026-05-20).
# Key: entry_indicator DSL string.  Value: callable(close, high, low, params) → signal array.
# Signal array: 1 = long, -1 = short, 0 = flat; same length as close input.
#
# Adding a new indicator: implement _signal_<name>(close, high, low, params) and register it
# in _INDICATOR_DISPATCH below.  Fallback SMA 50/200 fires when entry_indicator is
# not in _INDICATOR_DISPATCH and emits a WARNING — this is intentional: an unrecognised
# indicator should be loud, not silent.


def _signal_ema_crossover(
    close: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    params: dict[str, Any],
) -> np.ndarray:
    """EMA fast/slow crossover signal. Params: fast (int), slow (int)."""
    fast_p = int(params.get("fast", params.get("fast_period", 9)))
    slow_p = int(params.get("slow", params.get("slow_period", 21)))
    n = len(close)

    # Compute EMA via recursive formula (alpha = 2/(period+1))
    def _ema(arr: np.ndarray, period: int) -> np.ndarray:
        alpha = 2.0 / (period + 1)
        result = np.empty(len(arr))
        result[0] = arr[0]
        for i in range(1, len(arr)):
            result[i] = alpha * arr[i] + (1.0 - alpha) * result[i - 1]
        return result

    if n < slow_p + 1:
        return np.zeros(n)

    ema_fast = _ema(close, fast_p)
    ema_slow = _ema(close, slow_p)
    return np.sign(ema_fast - ema_slow)


def _signal_atr_breakout(
    close: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    params: dict[str, Any],
) -> np.ndarray:
    """ATR channel breakout signal. Params: period (int), multiplier (float)."""
    period = int(params.get("period", params.get("atr_period", 14)))
    mult = float(params.get("multiplier", params.get("atr_multiplier", 1.5)))
    n = len(close)

    if n < period + 2:
        return np.zeros(n)

    # True range
    tr = np.maximum(high - low, np.maximum(
        np.abs(high - np.roll(close, 1)),
        np.abs(low - np.roll(close, 1)),
    ))
    tr[0] = high[0] - low[0]

    # ATR via EMA
    alpha = 2.0 / (period + 1)
    atr = np.empty(n)
    atr[0] = tr[0]
    for i in range(1, n):
        atr[i] = alpha * tr[i] + (1.0 - alpha) * atr[i - 1]

    # Breakout: close > prev_close + mult*ATR → long; close < prev_close - mult*ATR → short
    signal = np.zeros(n)
    for i in range(1, n):
        upper = close[i - 1] + mult * atr[i - 1]
        lower = close[i - 1] - mult * atr[i - 1]
        if close[i] > upper:
            signal[i] = 1.0
        elif close[i] < lower:
            signal[i] = -1.0

    return signal


def _signal_bb_breakout(
    close: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    params: dict[str, Any],
) -> np.ndarray:
    """Bollinger Band breakout signal. Params: period (int), std_dev (float)."""
    period = int(params.get("period", params.get("bb_period", 20)))
    std_dev = float(params.get("std_dev", params.get("bb_std", 2.0)))
    n = len(close)

    if n < period + 1:
        return np.zeros(n)

    signal = np.zeros(n)
    for i in range(period, n):
        window = close[i - period:i]
        mid = np.mean(window)
        band = std_dev * np.std(window)
        upper = mid + band
        lower = mid - band
        if close[i] > upper:
            signal[i] = 1.0
        elif close[i] < lower:
            signal[i] = -1.0

    return signal


def _signal_orb(
    close: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    params: dict[str, Any],
) -> np.ndarray:
    """Opening Range Breakout signal.

    On shuffled bars the session concept is meaningless, but we still need a
    deterministic probe.  Approximation: use rolling n-bar high/low breakout
    (equivalent to ORB with the "opening range" being the first n bars of each
    rolling window).  Params: range_bars (int, default 4 = first 15 min of 5-min bars).
    """
    range_bars = int(params.get("range_bars", params.get("orb_bars", 4)))
    n = len(close)

    if n < range_bars + 2:
        return np.zeros(n)

    signal = np.zeros(n)
    for i in range(range_bars, n):
        orh = np.max(high[i - range_bars:i])
        orl = np.min(low[i - range_bars:i])
        if close[i] > orh:
            signal[i] = 1.0
        elif close[i] < orl:
            signal[i] = -1.0

    return signal


def _signal_sma_crossover_fallback(
    close: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    params: dict[str, Any],
) -> np.ndarray:
    """SMA 50/200 fallback — fires when entry_indicator is not in dispatch map.

    WARNING: this probe tests the backtester's structural correctness, NOT the
    strategy's actual edge.  If a new entry_indicator type is added to the scout
    pipeline but not registered in _INDICATOR_DISPATCH, this fallback fires and
    the Frankenstein gate will be weaker for that strategy type.  Register new
    indicators in _INDICATOR_DISPATCH to fix this.
    """
    fast_p = int(params.get("fast", 50))
    slow_p = int(params.get("slow", 200))
    n = len(close)

    if n < slow_p:
        return np.zeros(n)

    sma_fast = np.convolve(close, np.ones(fast_p) / fast_p, mode="valid")
    sma_slow = np.convolve(close, np.ones(slow_p) / slow_p, mode="valid")
    min_len = min(len(sma_fast), len(sma_slow))
    sma_fast = sma_fast[-min_len:]
    sma_slow = sma_slow[-min_len:]

    # Pad head with zeros so output length matches close
    pad = n - min_len
    return np.concatenate([np.zeros(pad), np.sign(sma_fast - sma_slow)])


# Registry: entry_indicator DSL name → signal function
_INDICATOR_DISPATCH: dict[str, Any] = {
    "ema_crossover": _signal_ema_crossover,
    "ema_cross": _signal_ema_crossover,
    "atr_breakout": _signal_atr_breakout,
    "atr_channel_breakout": _signal_atr_breakout,
    "bb_breakout": _signal_bb_breakout,
    "bollinger_breakout": _signal_bb_breakout,
    "opening_range_breakout": _signal_orb,
    "session_open_breakout": _signal_orb,
    "orb": _signal_orb,
}


def _build_signal(
    close: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    strategy_config: dict[str, Any],
) -> np.ndarray:
    """Dispatch to the appropriate signal function based on strategy entry_indicator.

    Falls back to SMA 50/200 with a WARNING if the indicator is not registered.
    """
    entry_indicator = strategy_config.get("entry_indicator", "")
    # Also check indicators[0].type (compiler-internal name layer — W23F)
    if not entry_indicator:
        indicators = strategy_config.get("indicators", [])
        if indicators and isinstance(indicators[0], dict):
            entry_indicator = indicators[0].get("type", "")

    entry_indicator = (entry_indicator or "").lower().strip()

    # Extract indicator parameters from the first matching indicators entry
    params: dict[str, Any] = {}
    for ind in strategy_config.get("indicators", []):
        if isinstance(ind, dict):
            ind_type = (ind.get("type") or ind.get("name") or "").lower().strip()
            if ind_type == entry_indicator or ind_type.replace("_", "") == entry_indicator.replace("_", ""):
                params = ind.get("params", ind.get("parameters", {})) or {}
                break

    if entry_indicator in _INDICATOR_DISPATCH:
        fn = _INDICATOR_DISPATCH[entry_indicator]
        return fn(close, high, low, params)

    # Unrecognised indicator — warn loudly, use SMA fallback
    logger.warning(
        "frankenstein_test: entry_indicator %r not in dispatch map — "
        "falling back to SMA 50/200 proxy.  Add this indicator to "
        "_INDICATOR_DISPATCH in frankenstein_test.py to fix.",
        entry_indicator or "(not set)",
    )
    return _signal_sma_crossover_fallback(close, high, low, params)


def _simulate_shuffled(
    strategy_config: dict[str, Any],
    shuffled_bars: np.ndarray,
    contracts: int = 1,
    tick_value: float = 5.0,  # MES default
    commission_per_side: float = 0.62,
) -> dict[str, float]:
    """Run the strategy on shuffled bars and return metrics.

    We use a simplified entry/exit simulation for the shuffle test — we only
    need Sharpe and profit factor, not full walk-forward analysis. The goal is
    to detect HUGE anomalies (lookahead gives |Sharpe| > 2), not micro-edge.

    Signal generation dispatches to the strategy's ACTUAL entry_indicator
    (ema_crossover, atr_breakout, bb_breakout, orb) via _build_signal().
    Previously used a hardcoded SMA 50/200 proxy regardless of strategy type,
    which meant the gate only tested backtester structural lookahead (not
    strategy-specific lookahead).  Both are now covered.

    Returns dict with keys: sharpe, profit_factor, total_trades, total_pnl
    """
    close = shuffled_bars[:, 3].astype(float)
    high = shuffled_bars[:, 1].astype(float)
    low = shuffled_bars[:, 2].astype(float)
    n = len(close)

    if n < 60:
        return {"sharpe": 0.0, "profit_factor": 1.0, "total_trades": 0, "total_pnl": 0.0}

    # Dispatch to strategy's actual indicator
    raw_signal = _build_signal(close, high, low, strategy_config)

    # Align signal to close array length (some signal functions return shorter arrays)
    if len(raw_signal) < n:
        pad = n - len(raw_signal)
        signal = np.concatenate([np.zeros(pad), raw_signal])
    else:
        signal = raw_signal[-n:]

    # signal is pre-aligned to close (length == n); no price_offset needed.

    # Trade P&L: position changes
    trade_pnls: list[float] = []
    pos = 0.0
    entry_price = 0.0

    for i in range(1, n):
        prev_sig = signal[i - 1]
        curr_sig = signal[i]
        curr_close = close[i]

        if prev_sig != curr_sig and prev_sig != 0:
            # Close position
            if pos != 0:
                pnl = pos * (curr_close - entry_price) * contracts * tick_value
                pnl -= 2 * commission_per_side * contracts  # round-trip commission
                trade_pnls.append(pnl)
                pos = 0.0

        if curr_sig != 0 and pos == 0:
            # Open position
            pos = curr_sig
            entry_price = curr_close

    # Close any open position at last bar
    if pos != 0 and n > 0:
        final_price = close[n - 1]
        pnl = pos * (final_price - entry_price) * contracts * tick_value
        pnl -= 2 * commission_per_side * contracts
        trade_pnls.append(pnl)

    if len(trade_pnls) < 3:
        # Too few trades — insufficient for meaningful Sharpe
        return {"sharpe": 0.0, "profit_factor": 1.0, "total_trades": len(trade_pnls), "total_pnl": 0.0}

    pnls = np.array(trade_pnls)
    mean_pnl = float(np.mean(pnls))
    std_pnl = float(np.std(pnls))

    if std_pnl < 1e-9:
        sharpe = 0.0
    else:
        # Annualize: assume ~250 trading days, scale by sqrt(n_trades/250)
        n_trades = len(pnls)
        sharpe = float((mean_pnl / std_pnl) * np.sqrt(max(n_trades, 1)))

    # Profit factor
    winners = pnls[pnls > 0]
    losers = pnls[pnls < 0]
    gross_profit = float(np.sum(winners)) if len(winners) > 0 else 0.0
    gross_loss = float(np.abs(np.sum(losers))) if len(losers) > 0 else 0.0

    if gross_loss < 1e-9:
        pf = 2.0 if gross_profit > 0 else 1.0
    else:
        pf = gross_profit / gross_loss

    return {
        "sharpe": sharpe,
        "profit_factor": pf,
        "total_trades": len(pnls),
        "total_pnl": float(np.sum(pnls)),
    }


# ─── Core Test Runner ─────────────────────────────────────────────────────────


def run_frankenstein_test(
    strategy_config: dict[str, Any],
    bars: np.ndarray,
    test_mode: str = "full_shuffle",
    n_shuffles: int = 100,
    n_workers: int = DEFAULT_N_WORKERS,
    seed: int = 42,
    tick_value: float = 5.0,
    commission_per_side: float = 0.62,
) -> FrankensteinResult:
    """Run the Frankenstein randomization detection test.

    Args:
        strategy_config: DSL config dict (used to extract symbol/contracts params)
        bars: numpy array of shape (N, 4) — OHLC bars for the strategy's symbol
        test_mode: full_shuffle | benchmark_relative | calendar_preserving | synthetic_gbm
        n_shuffles: number of shuffles to run (100 for full_shuffle, 50 for GBM)
        n_workers: thread pool workers for parallelism (default 10)
        seed: base RNG seed for reproducibility (each shuffle uses seed + i)
        tick_value: dollar value per tick (MES=5.0, MNQ=2.0, MCL=10.0)
        commission_per_side: commission per contract per side in dollars

    Returns:
        FrankensteinResult with passed=True iff p95_sharpe < 0.3 AND
        median_pf in [0.85, 1.15]
    """
    # CRIT LOUD-signal fix (capital-safety-compliance-gates wave, 2026-07-17):
    # fire on every invocation — see the module docstring "KNOWN LIMITATION"
    # block. This gate currently drives a hand-rolled reimplementation
    # (_simulate_shuffled -> _build_signal, no real stops/TP1/TP2/BE+1/
    # adaptive exits) on bars synthesized by interpolating each trade's own
    # entry/exit price (frankenstein-service.ts::fetchBarsFromTrades) — NOT
    # the real backtester.py fill/management logic on real market bars.
    logger.warning(
        "frankenstein_test: A4 gate is running with engine_fidelity="
        "'synthetic_reimplementation_not_real_backtester' — this test cannot "
        "detect lookahead/future-data-leak bugs living in backtester.py's "
        "fill-order or _apply_trade_management logic, because that code path "
        "is never invoked. See the module docstring KNOWN LIMITATION block "
        "for the named follow-up design. This run's result still gates real "
        "TESTING->PAPER promotion (frankenstein-service.ts) — it is a real "
        "signal against the hand-rolled proxy + synthetic bars, just not the "
        "full-fidelity check its own historical docstring claimed.",
    )
    start_time = time.monotonic()

    contracts = int(strategy_config.get("max_contracts", 1) or 1)

    sharpe_vals: list[float] = []
    pf_vals: list[float] = []
    failure_examples: list[dict[str, Any]] = []

    def _run_one(shuffle_idx: int) -> tuple[float, float, dict[str, Any]]:
        """Run one shuffle. Returns (sharpe, pf, metadata)."""
        rng = np.random.default_rng(seed + shuffle_idx)

        if test_mode == "synthetic_gbm":
            shuffled = _synthetic_gbm(bars, rng)
        else:
            shuffled = _shuffle_bars(bars, test_mode, rng)

        metrics = _simulate_shuffled(
            strategy_config,
            shuffled,
            contracts=contracts,
            tick_value=tick_value,
            commission_per_side=commission_per_side,
        )

        elapsed = time.monotonic() - start_time
        meta = {
            "shuffle_idx": shuffle_idx,
            "sharpe": metrics["sharpe"],
            "profit_factor": metrics["profit_factor"],
            "total_trades": metrics["total_trades"],
            "total_pnl": metrics["total_pnl"],
            "elapsed_s": round(elapsed, 2),
        }
        return metrics["sharpe"], metrics["profit_factor"], meta

    # fixwave-fastfollow (2026-07-17): do NOT use `with ThreadPoolExecutor(...) as
    # executor:` here. Executor.__exit__ calls shutdown(wait=True) unconditionally on
    # block exit -- including on the FuturesTimeout path below, which logs "using
    # partial results" and falls through -- so this HARD A4 promotion-gate check would
    # still BLOCK the caller until every one of the n_shuffles worker threads finished
    # on its own, defeating WALL_CLOCK_CEILING_S exactly the way the sibling
    # quantum_adversarial_stress.py bug did (fixed same day, same wave:
    # quantum-stack-honesty, 2026-07-17). Explicit non-blocking shutdown(wait=False)
    # bounds CALLER-RETURN latency; orphaned worker threads finish independently.
    executor = ThreadPoolExecutor(max_workers=n_workers)
    try:
        futures = {executor.submit(_run_one, i): i for i in range(n_shuffles)}
        try:
            for fut in as_completed(
                futures,
                timeout=WALL_CLOCK_CEILING_S,
            ):
                sharpe, pf, meta = fut.result()
                sharpe_vals.append(sharpe)
                pf_vals.append(pf)
                # Collect failure examples: runs with anomalously high |Sharpe|
                if abs(sharpe) > PASS_P95_SHARPE_THRESHOLD * 2:
                    failure_examples.append(meta)
        except FuturesTimeout:
            logger.warning(
                "frankenstein_test: wall-clock ceiling %.1fs reached after %d/%d shuffles — using partial results",
                WALL_CLOCK_CEILING_S,
                len(sharpe_vals),
                n_shuffles,
            )
        executor.shutdown(wait=False)
    except Exception as exc:
        executor.shutdown(wait=False)
        wall_ms = int((time.monotonic() - start_time) * 1000)
        return FrankensteinResult(
            test_mode=test_mode,
            n_shuffles=n_shuffles,
            p95_sharpe=float("nan"),
            median_pf=float("nan"),
            passed=False,
            sharpe_distribution=[],
            pf_distribution=[],
            failure_examples=[],
            wall_clock_ms=wall_ms,
            status="failed",
            error_message=str(exc),
        )

    if not sharpe_vals:
        wall_ms = int((time.monotonic() - start_time) * 1000)
        return FrankensteinResult(
            test_mode=test_mode,
            n_shuffles=n_shuffles,
            p95_sharpe=float("nan"),
            median_pf=float("nan"),
            passed=False,
            sharpe_distribution=[],
            pf_distribution=[],
            failure_examples=[],
            wall_clock_ms=wall_ms,
            status="failed",
            error_message="No shuffle results produced",
        )

    abs_sharpes = [abs(s) for s in sharpe_vals]
    p95_sharpe = float(np.percentile(abs_sharpes, 95))
    median_pf = float(np.median(pf_vals))

    # Pass criteria (locked from plan)
    passed = (
        p95_sharpe < PASS_P95_SHARPE_THRESHOLD
        and PASS_MEDIAN_PF_LOW <= median_pf <= PASS_MEDIAN_PF_HIGH
    )

    wall_ms = int((time.monotonic() - start_time) * 1000)

    return FrankensteinResult(
        test_mode=test_mode,
        n_shuffles=len(sharpe_vals),
        p95_sharpe=p95_sharpe,
        median_pf=median_pf,
        passed=passed,
        sharpe_distribution=sharpe_vals,
        pf_distribution=pf_vals,
        failure_examples=failure_examples[:10],  # cap at 10 examples
        wall_clock_ms=wall_ms,
        status="completed",
        error_message=None,
    )


# ─── CLI Entry Point ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    """CLI entry point for frankenstein-service.ts subprocess calls.

    Reads JSON config from stdin or argv[1] file path.
    Outputs FrankensteinResult as JSON to stdout.

    Config shape:
    {
        "strategy_config": {...},  // StrategyDSL dict
        "bars": [[o, h, l, c], ...],  // list of OHLC bars
        "test_mode": "full_shuffle",
        "n_shuffles": 100,
        "n_workers": 10,
        "seed": 42,
        "tick_value": 5.0,
        "commission_per_side": 0.62
    }
    """
    # Enable determinism before any numpy ops
    try:
        from src.engine.determinism import enable_determinism
        enable_determinism()
    except ImportError:
        pass

    try:
        if len(sys.argv) > 1:
            config_path = sys.argv[1]
            with open(config_path) as f:
                config = json.load(f)
        else:
            config = json.load(sys.stdin)

        bars_list = config.get("bars", [])
        if not bars_list:
            raise ValueError("config.bars is empty or missing")

        bars = np.array(bars_list, dtype=float)
        if bars.ndim != 2 or bars.shape[1] != 4:
            raise ValueError(f"bars must be shape (N, 4), got {bars.shape}")

        result = run_frankenstein_test(
            strategy_config=config.get("strategy_config", {}),
            bars=bars,
            test_mode=config.get("test_mode", "full_shuffle"),
            n_shuffles=config.get("n_shuffles", 100),
            n_workers=config.get("n_workers", DEFAULT_N_WORKERS),
            seed=config.get("seed", 42),
            tick_value=config.get("tick_value", 5.0),
            commission_per_side=config.get("commission_per_side", 0.62),
        )

        output = {
            "test_mode": result.test_mode,
            "n_shuffles": result.n_shuffles,
            "p95_sharpe": result.p95_sharpe,
            "median_pf": result.median_pf,
            "passed": result.passed,
            "sharpe_distribution": result.sharpe_distribution,
            "pf_distribution": result.pf_distribution,
            "failure_examples": result.failure_examples,
            "wall_clock_ms": result.wall_clock_ms,
            "status": result.status,
            "error_message": result.error_message,
            # CRIT LOUD-signal fix (capital-safety-compliance-gates wave,
            # 2026-07-17) — additive field, see module docstring.
            "engine_fidelity": result.engine_fidelity,
        }
        print(json.dumps(output))

    except Exception as exc:
        error_output = {
            "test_mode": "unknown",
            "n_shuffles": 0,
            "p95_sharpe": None,
            "median_pf": None,
            "passed": False,
            "sharpe_distribution": [],
            "pf_distribution": [],
            "failure_examples": [],
            "wall_clock_ms": 0,
            "status": "failed",
            "error_message": str(exc),
            "engine_fidelity": "synthetic_reimplementation_not_real_backtester",
        }
        print(json.dumps(error_output))
        sys.exit(1)
