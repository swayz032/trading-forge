"""mss_native.py — Fresh, ISOLATED Market Structure Shift (MSS / CHoCH+displacement) detector.

Composition Fidelity Experiment (docs/designs/composition-fidelity-experiment-2026-07-05.md),
Step 1. Same purity discipline as fvg_native.py / bias_native.py / sweep_native.py — OHLC arrays
in, boolean signals out, no import beyond numpy + stdlib. Deliberately does NOT import
sweep_native.py or bias_native.py even though the sweep-then-break rule below overlaps
conceptually with sweep_native's rule — each native evaluator in this experiment must stand alone
so no single shared helper module becomes a new hidden collapse point (the very failure mode this
experiment tests for at the condition-binding layer). The trailing-extreme + rejection math is
therefore intentionally duplicated here in miniature, not imported.

WHY THIS IS A NEW EVALUATOR: "MSS" / "change of character" objects (WAIT_STRUCTURE or
WAIT_CONFIRMATION typed, per the real Step-0 gating-diagnostic corpus scan) currently fall through
to the same generic cadence-limited `structure_engine` activity check or the generic
candle-confirmation OR — no dedicated MSS semantics exist anywhere in the executable path.

RULE (ICT market-structure-shift = liquidity sweep followed by a displaced break of the opposite
trailing extreme, causal, no look-ahead):
  1. bullish-side sweep at bar k: low[k] < min(low[k-lookback:k]) and close[k] > that same min
     (sell-side liquidity swept + rejected up) — same definition as sweep_native.py, duplicated.
  2. bearish-side sweep at bar k: high[k] > max(high[k-lookback:k]) and close[k] < that same max.
  3. MSS CONFIRMATION at a later bar i (i - k <= MSS_CONFIRM_WITHIN_BARS): price closes beyond the
     trailing extreme in the OPPOSITE direction of the sweep with a DISPLACEMENT candle
     (|close[i]-open[i]| > MSS_DISPLACEMENT_ATR_MULT * ATR[i]) — a bullish MSS confirms a prior
     bullish-side (low) sweep by closing above the trailing high with a strong candle; bearish is
     the mirror. ATR here is a minimal from-scratch simple-moving-average of true range (NOT an
     import of indicators/core.compute_atr — purity contract: numpy + stdlib only).
  Only bars <= i are ever consulted at bar i.

PERSISTENCE: MSS_ACTIVE_BARS holds the confirmed-shift signal True for a realistic window after
confirmation — same rationale as sweep_native.SWEEP_ACTIVE_BARS (a point event would almost never
land on the same bar as a slower AND-partner condition).

PURITY CONTRACT: `grep -E "import|from" src/engine/indicators/mss_native.py` must show ONLY
numpy + stdlib.

DETERMINISTIC: no wall-clock reads, no randomness, no I/O.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

MSS_LOOKBACK_BARS: int = 10
MSS_ATR_PERIOD: int = 14
MSS_DISPLACEMENT_ATR_MULT: float = 1.5
MSS_CONFIRM_WITHIN_BARS: int = 20
MSS_ACTIVE_BARS: int = 10


@dataclass(frozen=True)
class MSSResult:
    bullish_active: np.ndarray
    bearish_active: np.ndarray
    any_active: np.ndarray


def _true_range(high: np.ndarray, low: np.ndarray, close: np.ndarray) -> np.ndarray:
    n = len(high)
    tr = np.zeros(n)
    if n == 0:
        return tr
    tr[0] = high[0] - low[0]
    for i in range(1, n):
        tr[i] = max(
            high[i] - low[i],
            abs(high[i] - close[i - 1]),
            abs(low[i] - close[i - 1]),
        )
    return tr


def _sma(arr: np.ndarray, period: int) -> np.ndarray:
    n = len(arr)
    out = np.full(n, np.nan)
    if n < period:
        return out
    csum = np.cumsum(arr)
    for i in range(period - 1, n):
        total = csum[i] - (csum[i - period] if i >= period else 0.0)
        out[i] = total / period
    return out


def _persist(event: np.ndarray, active_bars: int, n: int) -> np.ndarray:
    delta = np.zeros(n + 1, dtype=np.int64)
    for i in np.flatnonzero(event):
        end = min(int(i) + active_bars + 1, n)
        delta[i] += 1
        delta[end] -= 1
    cum = np.cumsum(delta[:n])
    return cum > 0


def compute_mss_signal(
    open_: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    lookback: int = MSS_LOOKBACK_BARS,
    atr_period: int = MSS_ATR_PERIOD,
    displacement_atr_mult: float = MSS_DISPLACEMENT_ATR_MULT,
    confirm_within_bars: int = MSS_CONFIRM_WITHIN_BARS,
    active_bars: int = MSS_ACTIVE_BARS,
) -> MSSResult:
    n = len(high)
    if n <= max(lookback, atr_period):
        empty = np.zeros(n, dtype=bool)
        return MSSResult(bullish_active=empty, bearish_active=empty.copy(), any_active=empty.copy())

    tr = _true_range(high, low, close)
    atr = _sma(tr, atr_period)

    bullish_event = np.zeros(n, dtype=bool)
    bearish_event = np.zeros(n, dtype=bool)
    last_bull_sweep_bar = -(10**9)
    last_bear_sweep_bar = -(10**9)

    for i in range(lookback, n):
        prior_low = float(low[i - lookback : i].min())
        prior_high = float(high[i - lookback : i].max())

        if low[i] < prior_low and close[i] > prior_low:
            last_bull_sweep_bar = i
        if high[i] > prior_high and close[i] < prior_high:
            last_bear_sweep_bar = i

        a = atr[i]
        if a is not None and not np.isnan(a) and a > 0:
            candle_range = abs(float(close[i]) - float(open_[i]))
            displaced = candle_range > displacement_atr_mult * float(a)
            if displaced and close[i] > prior_high and (i - last_bull_sweep_bar) <= confirm_within_bars:
                bullish_event[i] = True
            if displaced and close[i] < prior_low and (i - last_bear_sweep_bar) <= confirm_within_bars:
                bearish_event[i] = True

    bullish_active = _persist(bullish_event, active_bars, n)
    bearish_active = _persist(bearish_event, active_bars, n)
    return MSSResult(bullish_active=bullish_active, bearish_active=bearish_active, any_active=bullish_active | bearish_active)
