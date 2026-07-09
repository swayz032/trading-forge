"""sweep_native.py — Fresh, ISOLATED liquidity-sweep ("stop hunt" / judas swing) detector.

Composition Fidelity Experiment (docs/designs/composition-fidelity-experiment-2026-07-05.md),
Step 1. Same purity discipline as fvg_native.py / bias_native.py — OHLC arrays in, boolean
signals out, no import beyond numpy + stdlib.

WHY THIS IS A NEW EVALUATOR (not previously executed at all): "sweep" objects in WAIT_STRUCTURE /
FILTER conditions currently fall through to the SAME generic `structure_engine.compute_structure_state`
cadence-limited activity check every other WAIT_STRUCTURE condition uses — there is no dedicated
sweep semantics anywhere in the executable path. This module gives the sweep concept its own
distinct, real (if simplified) signal.

RULE (classic ICT liquidity sweep, causal — no look-ahead):
  bullish sweep at bar i (sell-side liquidity swept, price rejects back up):
      low[i]  < min(low[i-lookback:i])   AND   close[i] > min(low[i-lookback:i])
  bearish sweep at bar i (buy-side liquidity swept, price rejects back down):
      high[i] > max(high[i-lookback:i])  AND   close[i] < max(high[i-lookback:i])
  i.e. price wicks beyond the trailing N-bar extreme but CLOSES back on the other side of it —
  a rejection, not a genuine breakout. Only bars < i are consulted for the trailing extreme, and
  bar i's own high/low/close decide the event AT i — no look-ahead.

PERSISTENCE: a sweep is a point event; SWEEP_ACTIVE_BARS gives the AND-chain a realistic window to
combine with other (slower) spine conditions, mirroring how `structure_engine`'s cadence-limited
activity check already holds its value between recomputes — without this, a single-bar-wide sweep
event would almost never align with a same-bar AND partner and every gating-set restoration would
silently degrade to "no signal," which would misrepresent the experiment as a null result caused by
timing granularity rather than identity.

PURITY CONTRACT: `grep -E "import|from" src/engine/indicators/sweep_native.py` must show ONLY
numpy + stdlib.

DETERMINISTIC: no wall-clock reads, no randomness, no I/O.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

SWEEP_LOOKBACK_BARS: int = 10
SWEEP_ACTIVE_BARS: int = 5


@dataclass(frozen=True)
class SweepResult:
    """`bullish_active[i]` / `bearish_active[i]` True iff a sweep event fired within the trailing
    SWEEP_ACTIVE_BARS window ending at bar i (inclusive of the firing bar itself). `any_active` is
    the OR of both."""

    bullish_active: np.ndarray
    bearish_active: np.ndarray
    any_active: np.ndarray


def _persist(event: np.ndarray, active_bars: int, n: int) -> np.ndarray:
    """Forward-fill an event array for `active_bars` bars (inclusive of the firing bar), via a
    delta-array sweep — same O(n) technique fvg_native._active_signal uses for zone persistence."""
    delta = np.zeros(n + 1, dtype=np.int64)
    for i in np.flatnonzero(event):
        end = min(int(i) + active_bars + 1, n)
        delta[i] += 1
        delta[end] -= 1
    cum = np.cumsum(delta[:n])
    return cum > 0


def compute_sweep_signal(
    open_: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    lookback: int = SWEEP_LOOKBACK_BARS,
    active_bars: int = SWEEP_ACTIVE_BARS,
) -> SweepResult:
    n = len(high)
    if n <= lookback:
        empty = np.zeros(n, dtype=bool)
        return SweepResult(bullish_active=empty, bearish_active=empty.copy(), any_active=empty.copy())

    bullish_event = np.zeros(n, dtype=bool)
    bearish_event = np.zeros(n, dtype=bool)

    for i in range(lookback, n):
        prior_low = float(low[i - lookback : i].min())
        prior_high = float(high[i - lookback : i].max())
        if low[i] < prior_low and close[i] > prior_low:
            bullish_event[i] = True
        if high[i] > prior_high and close[i] < prior_high:
            bearish_event[i] = True

    bullish_active = _persist(bullish_event, active_bars, n)
    bearish_active = _persist(bearish_event, active_bars, n)
    return SweepResult(bullish_active=bullish_active, bearish_active=bearish_active, any_active=bullish_active | bearish_active)
