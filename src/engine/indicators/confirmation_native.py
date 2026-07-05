"""confirmation_native.py — Fresh, ISOLATED directional candle-confirmation detector.

Composition Fidelity Experiment (docs/designs/composition-fidelity-experiment-2026-07-05.md),
Step 1. Same purity discipline as `fvg_native.py` / `bias_native.py` — OHLC arrays in, boolean
signals out, no import beyond numpy + stdlib, no reuse of structure_engine/context/archetype
modules.

WHY THIS REPLACES THE EXISTING WAIT_CONFIRMATION APPROXIMATION: today every WAIT_CONFIRMATION
condition in a spec shares ONE cached array —
`spec_condition_compiler.candle_confirmation_check()`'s `bullish_confirm | bearish_confirm`
OR'd together — regardless of whether the condition's object text says "bullish engulfing",
"bearish pin bar", or something else. A short-side confirmation condition is satisfied by a
BULLISH rejection candle just as readily as a bearish one; direction is thrown away. This module
restores directional discrimination: `bullish_active` / `bearish_active` are reported SEPARATELY
so a condition whose object names a direction can bind to the matching sub-signal instead of the
undifferentiated OR.

PATTERNS DETECTED (both causal, single/two-bar, no look-ahead):
  1. Rejection wick — same math as `spec_condition_compiler.candle_confirmation_check` (kept
     identical so this module's directional split is a strict refinement, not a different rule):
     a candle whose lower wick >= CANDLE_WICK_RATIO_THRESHOLD * range and closes in the upper half
     is a bullish rejection; the mirror (upper wick, closes in lower half) is bearish.
  2. Engulfing — bar i's real body fully engulfs bar i-1's real body AND closes beyond it: bullish
     engulfing (close[i] > open[i], open[i-1] > close[i-1], close[i] > open[i-1], open[i] <
     close[i-1]); bearish is the mirror.
  A bar can satisfy either pattern independently; `bullish_active[i]` is the OR of both bullish
  patterns at bar i (same for bearish).

PURITY CONTRACT: `grep -E "import|from" src/engine/indicators/confirmation_native.py` must show
ONLY numpy + stdlib.

DETERMINISTIC: no wall-clock reads, no randomness, no I/O.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

CANDLE_WICK_RATIO_THRESHOLD: float = 0.4
"""Kept identical to spec_condition_compiler.CANDLE_WICK_RATIO_THRESHOLD so the rejection-wick
leg of this evaluator is a strict directional refinement of the existing generic rule, not a
different threshold that would confound the comparison."""


@dataclass(frozen=True)
class ConfirmationResult:
    """Per-bar directional confirmation signal. `bullish_active[i]` / `bearish_active[i]` reflect
    whether a bullish/bearish rejection-wick OR engulfing pattern completed AT bar i (point event,
    not persistent — matches the generic candle_confirmation_check's own per-bar semantics).
    `any_active` is the OR of both, for callers whose object text names no direction."""

    bullish_active: np.ndarray
    bearish_active: np.ndarray
    any_active: np.ndarray


def compute_confirmation_signal(
    open_: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
) -> ConfirmationResult:
    n = len(close)
    bullish = np.zeros(n, dtype=bool)
    bearish = np.zeros(n, dtype=bool)

    for i in range(n):
        o, h, lo, c = open_[i], high[i], low[i], close[i]
        rng = h - lo
        if rng > 0:
            lower_wick = min(o, c) - lo
            upper_wick = h - max(o, c)
            if lower_wick >= CANDLE_WICK_RATIO_THRESHOLD * rng and c >= (lo + rng * 0.5):
                bullish[i] = True
            if upper_wick >= CANDLE_WICK_RATIO_THRESHOLD * rng and c <= (h - rng * 0.5):
                bearish[i] = True

        if i > 0:
            po, pc = open_[i - 1], close[i - 1]
            if c > o and po > pc and c > po and o < pc:
                bullish[i] = True
            if c < o and pc > po and c < po and o > pc:
                bearish[i] = True

    return ConfirmationResult(bullish_active=bullish, bearish_active=bearish, any_active=bullish | bearish)
