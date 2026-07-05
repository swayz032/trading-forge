"""bias_native.py — Fresh, ISOLATED directional-bias detector.

Composition Fidelity Experiment (docs/designs/composition-fidelity-experiment-2026-07-05.md),
Step 1. Built FRESH and DELIBERATELY ISOLATED from every existing structural-context module
(structure_engine, bias_engine, htf_context, location_score, any archetype evaluator) — same
purity discipline as `fvg_native.py` (see that module's docstring for the point-8 rationale this
one shares verbatim). Only inputs are raw OHLC arrays; only outputs are a per-bar directional-lean
boolean signal.

WHY THIS REPLACES THE EXISTING WAIT_BIAS/CONFIRM_DIRECTION APPROXIMATION: today every WAIT_BIAS
and CONFIRM_DIRECTION condition in a spec — regardless of its own object text ("bullish bias" vs
"bearish bias" vs "range continuation bias" vs anything else) — shares ONE cached EMA-fast>EMA-slow
boolean array computed with `want_bearish=False` HARD-CODED
(`spec_condition_compiler.SpecConditionStrategy._eval_wait_bias`). A condition whose object
literally says "bearish" still gets the *bullish*-lean check. This module restores a REAL
structural signal (swing-sequence higher-high/higher-low vs lower-high/lower-low, the textbook
ICT/Dow-theory definition of trend bias) with genuine bullish/bearish/neutral discrimination, so a
condition whose object clearly names a direction can bind to the matching sub-signal instead of a
mislabeled shared array.

PURITY CONTRACT (same verification bar as fvg_native.py): `grep -E "import|from"
src/engine/indicators/bias_native.py` must show ONLY numpy + stdlib (`__future__`, `dataclasses`).

RULE (swing-sequence bias, causal — no look-ahead):
  1. A bar p is a confirmed swing high iff high[p] is the unique max over the window
     [p-lookback, p+lookback]; confirmation happens at bar p+lookback (the earliest bar at which
     this is knowable without seeing the future) — same causal-confirmation-delay convention every
     other swing detector in this codebase uses (see src/engine/indicators/market_structure.py's
     `half_window`), reimplemented fresh here rather than imported (purity contract).
  2. Trend state updates only when a NEW confirmed swing extreme prints: a higher swing high or
     higher swing low sets bias=bullish; a lower swing high or lower swing low sets bias=bearish.
     Between confirmations, trend HOLDS (persistent state, not edge-only) — mirrors
     `market_structure.detect_choch`'s trend-tracking loop in spirit, again reimplemented fresh.
  3. `bullish_active[i]` / `bearish_active[i]` reflect the trend state AS OF bar i (using only
     swings confirmed at or before i) — no bar > i is ever consulted.

DETERMINISTIC: no wall-clock reads, no randomness, no I/O. Same OHLC arrays always produce the
same BiasResult.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

BULLISH = "bullish"
BEARISH = "bearish"

SWING_LOOKBACK_BARS: int = 3
"""Bars on each side required to confirm a pivot. Small and fixed (not tunable per-spec) —
keeps this evaluator a single, deterministic instrument, same discipline as
fvg_native.py's fixed 3-candle rule."""


@dataclass(frozen=True)
class BiasResult:
    """Per-bar directional-lean signal. `bullish_active[i]` / `bearish_active[i]` are True iff
    the swing-sequence trend state is bullish/bearish as of bar i (mutually exclusive — a bar is
    never both). `any_active` is the OR of both (True whenever a lean exists at all, i.e. NOT
    neutral/undetermined) — the generic fallback signal for callers whose condition object text
    does not name a specific direction."""

    bullish_active: np.ndarray
    bearish_active: np.ndarray
    any_active: np.ndarray


def _find_swings(high: np.ndarray, low: np.ndarray, lookback: int) -> tuple[np.ndarray, np.ndarray]:
    """Returns (swing_high_confirmed, swing_low_confirmed), each shape (n,) float arrays holding
    the pivot PRICE at its CONFIRMATION index (bar p+lookback), NaN elsewhere. A bar p is a pivot
    iff it holds the unique max/min within [p-lookback, p+lookback] (argmax/argmin tie-break to
    the first occurrence, so at most one pivot designation per window)."""
    n = len(high)
    sh = np.full(n, np.nan)
    sl = np.full(n, np.nan)
    if n < 2 * lookback + 1:
        return sh, sl
    for p in range(lookback, n - lookback):
        window_h = high[p - lookback : p + lookback + 1]
        if int(np.argmax(window_h)) == lookback:
            sh[p + lookback] = high[p]
        window_l = low[p - lookback : p + lookback + 1]
        if int(np.argmin(window_l)) == lookback:
            sl[p + lookback] = low[p]
    return sh, sl


def compute_bias_signal(
    open_: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    lookback: int = SWING_LOOKBACK_BARS,
) -> BiasResult:
    """Public entry point. `open_` / `close` accepted for call-shape symmetry with the other
    per-bar evaluators in spec_condition_compiler.py (unused by the swing-sequence rule itself,
    which only needs high/low)."""
    n = len(high)
    if n < 2 * lookback + 1:
        empty = np.zeros(n, dtype=bool)
        return BiasResult(bullish_active=empty, bearish_active=empty.copy(), any_active=empty.copy())

    sh_val, sl_val = _find_swings(high, low, lookback)

    bullish = np.zeros(n, dtype=bool)
    bearish = np.zeros(n, dtype=bool)
    last_sh: float | None = None
    last_sl: float | None = None
    trend: str | None = None

    for i in range(n):
        if not np.isnan(sh_val[i]):
            new_sh = float(sh_val[i])
            if last_sh is not None:
                if new_sh > last_sh:
                    trend = BULLISH
                elif new_sh < last_sh:
                    trend = BEARISH
            last_sh = new_sh
        if not np.isnan(sl_val[i]):
            new_sl = float(sl_val[i])
            if last_sl is not None:
                if new_sl > last_sl:
                    trend = BULLISH
                elif new_sl < last_sl:
                    trend = BEARISH
            last_sl = new_sl
        bullish[i] = trend == BULLISH
        bearish[i] = trend == BEARISH

    return BiasResult(bullish_active=bullish, bearish_active=bearish, any_active=bullish | bearish)
