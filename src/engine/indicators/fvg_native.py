"""fvg_native.py — Fresh, ISOLATED Fair Value Gap (FVG) detector.

FVG Identity Dispatch Experiment (docs/designs/fvg-identity-dispatch-experiment-2026-07-05.md),
Part A. Built FRESH and DELIBERATELY ISOLATED from every existing structural-context module
(structure_engine, location_score, htf_context, bias_engine, any archetype evaluator) — reuse
would contaminate the causal axis under test (the point-8 trap: routing through an existing
generalized primitive is not the same as PRESERVING the object's own identity). This module's
only inputs are raw OHLC arrays; its only outputs are FVG zones + a per-bar boolean presence
signal. No HTF, no regime, no overlay, no session context, no DB, no I/O.

PURITY CONTRACT (verification bar #1 of the locked spec): `grep -E "import|from"
src/engine/indicators/fvg_native.py` must show ONLY numpy + stdlib (`__future__`, `dataclasses`).
Do not add polars, structure_engine, htf_context, bias_engine, or any archetype import to this
file — that would silently reopen the exact contamination this module exists to close.

RULE (classic ICT 3-candle imbalance):
  bullish FVG at bar i:  low[i]  > high[i-2]   (gap between candle i-2's high and candle i's low)
  bearish FVG at bar i:  high[i] < low[i-2]    (gap between candle i-2's low  and candle i's high)
The middle candle (i-1) is the displacement candle that creates the imbalance. Detection at bar i
only ever reads bars i-2, i-1, i — no bar > i is consulted, so there is no look-ahead in zone
formation (backtest-core priority #4).

FILL: a zone is "filled" the first time price re-enters its [lower, upper] band on a LATER bar
(simple forward scan per the locked spec — no partial-fill percentage, no wick-vs-body
distinction, no CE/50%-level nuance; those refinements are explicitly out of scope for this
experiment). Fill detection at bar j only reads bar j — again, no look-ahead: when the caller
evaluates the "is an FVG zone active" signal at bar i, that signal is a pure function of bars
<= i only, computed once per full-window call (the same precompute-then-index style every other
per-bar evaluator in spec_condition_compiler.py already uses — see _eval_wait_structure /
_eval_wait_retest — timing safety against the engine's own bar loop comes from the engine's
existing +1-bar entry shift, not from anything in this module).

DETERMINISTIC: no wall-clock reads, no randomness, no I/O. Same OHLC arrays always produce the
same FVGResult.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

BULLISH = "bullish"
BEARISH = "bearish"


@dataclass(frozen=True)
class FVGZone:
    """One detected imbalance zone.

    start_idx: bar index of the 3rd candle (the bar where the gap is confirmed).
    direction: BULLISH | BEARISH.
    upper / lower: the gap's price band (upper always >= lower).
    filled_at_idx: first bar index (> start_idx) where price re-entered [lower, upper];
                   None if the zone is never filled within the supplied array.
    """

    start_idx: int
    direction: str
    upper: float
    lower: float
    filled_at_idx: int | None


@dataclass(frozen=True)
class FVGResult:
    """Per-bar output. `bullish_active[i]` / `bearish_active[i]` are True iff at least one
    unfilled bullish/bearish zone is active as of bar i (active := formed at or before i, and
    not yet filled as of i). `any_active` is the OR of both — a single generic "an FVG is
    present" signal for callers that don't need directional detail."""

    zones: list[FVGZone]
    bullish_active: np.ndarray
    bearish_active: np.ndarray
    any_active: np.ndarray


def detect_fvg_zones(high: np.ndarray, low: np.ndarray) -> list[FVGZone]:
    """Vectorized 3-candle imbalance scan — O(n). Returns zones in bar order, unfilled
    (`filled_at_idx=None` for every zone; call `_fill_scan` to resolve fills)."""
    n = len(high)
    if n < 3:
        return []

    bullish_mask = low[2:] > high[:-2]
    bearish_mask = high[2:] < low[:-2]

    zones: list[FVGZone] = []
    for offset in np.flatnonzero(bullish_mask):
        i = int(offset) + 2
        zones.append(FVGZone(start_idx=i, direction=BULLISH, upper=float(low[i]), lower=float(high[i - 2]), filled_at_idx=None))
    for offset in np.flatnonzero(bearish_mask):
        i = int(offset) + 2
        zones.append(FVGZone(start_idx=i, direction=BEARISH, upper=float(low[i - 2]), lower=float(high[i]), filled_at_idx=None))

    zones.sort(key=lambda z: z.start_idx)
    return zones


def _fill_scan(zones: list[FVGZone], high: np.ndarray, low: np.ndarray) -> list[FVGZone]:
    """Simple forward scan (per locked spec — no partial-fill nuance): for each zone, find the
    first later bar whose [low, high] range overlaps the zone's [lower, upper] band.

    Implementation note: rather than re-scanning from each zone's start (worst case O(n) per
    zone), this sweeps bars once and tracks the currently-open zone set — cost is bounded by how
    many zones are concurrently unfilled at any bar (typically small; gaps tend to fill quickly
    in real price action), not by the total zone count. Still O(n) look-ahead-free: bar j's fill
    check only reads bar j.
    """
    n = len(high)
    by_start: dict[int, list[int]] = {}
    for idx, z in enumerate(zones):
        by_start.setdefault(z.start_idx, []).append(idx)

    filled_at: list[int | None] = [None] * len(zones)
    open_idx: list[int] = []

    for j in range(n):
        starting = by_start.get(j)
        if starting:
            open_idx.extend(starting)
        if not open_idx:
            continue
        still_open: list[int] = []
        for zi in open_idx:
            z = zones[zi]
            if j > z.start_idx and low[j] <= z.upper and high[j] >= z.lower:
                filled_at[zi] = j
            else:
                still_open.append(zi)
        open_idx = still_open

    return [
        FVGZone(start_idx=z.start_idx, direction=z.direction, upper=z.upper, lower=z.lower, filled_at_idx=filled_at[i])
        for i, z in enumerate(zones)
    ]


def _active_signal(n: int, zones: list[FVGZone], direction: str) -> np.ndarray:
    """Diff-array sweep producing a bool[n] 'at least one unfilled `direction` zone active at
    bar i' signal in O(n + len(zones)) — active from the zone's start_idx up to (but not
    including) its filled_at_idx (or through the end of the array if never filled)."""
    delta = np.zeros(n + 1, dtype=np.int64)
    for z in zones:
        if z.direction != direction or z.start_idx >= n:
            continue
        end = z.filled_at_idx if z.filled_at_idx is not None else n
        delta[z.start_idx] += 1
        delta[min(end, n)] -= 1
    cum = np.cumsum(delta[:n])
    return cum > 0


def compute_fvg_signal(
    open_: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
) -> FVGResult:
    """Public entry point. `open_` / `close` are accepted for call-shape symmetry with the other
    per-bar evaluators in spec_condition_compiler.py (retest_touch_check, candle_confirmation_check
    both take open/high/low/close) but are unused by the classic high/low imbalance rule."""
    n = len(high)
    if n < 3:
        empty = np.zeros(n, dtype=bool)
        return FVGResult(zones=[], bullish_active=empty, bearish_active=empty.copy(), any_active=empty.copy())

    zones = detect_fvg_zones(high, low)
    zones = _fill_scan(zones, high, low)
    bullish_active = _active_signal(n, zones, BULLISH)
    bearish_active = _active_signal(n, zones, BEARISH)
    return FVGResult(
        zones=zones,
        bullish_active=bullish_active,
        bearish_active=bearish_active,
        any_active=bullish_active | bearish_active,
    )
