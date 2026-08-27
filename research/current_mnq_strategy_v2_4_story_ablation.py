#!/usr/bin/env python3
"""Conjunct ablation of the v2.4 rejection story — DIAGNOSTIC ONLY. Mutates no semantics.

WHY THIS EXISTS.  `core.Story.complete` is `approach AND fight AND decision`.  In the v2.2
engine all three conjuncts are DERIVED FROM PRICE (`reversal_story`, v2_2_engine.py:668-697).
In v2.4 `reversal_story_v24` returns `approach=True` and `takeover=True` as UNCONDITIONAL
LITERALS (entries.py:168,174) and rebuilds `fight` and `decision` from weaker material.  Every
requirement v2.4 dropped is restored here ONE AT A TIME, against the frozen 14-session corpus,
so the question "which loss is load-bearing?" is answered by a count and not by an argument.

WHAT AN ABLATION VERDICT MEANS.  A verdict is computed ONLY for candidates that the CURRENT
kernel already grants (`reversal_story_v24(...).complete is True`).  `False` means: restoring
this one v2.2 requirement would have KILLED this grant.  The counts are therefore a direct
measure of how much permission each dropped requirement was holding back.

WHAT IT IS NOT.  v2.2 is the PRIOR IMPLEMENTATION, not the teacher.  A requirement v2.2 had is
not thereby proven correct, and this module makes no claim that restoring any of them is right.
It measures the SIZE of each change.  Which of them the trader actually means is a separate
question that only the source evidence can answer.  ALGO-011 §10 authorizes A/B of the semantic
model against frozen evidence; this is that A/B and nothing more.

POSITIVE CONTROL.  The runner does NOT re-walk the kernel loop -- it hooks
`xray_session(on_rejection_candidate=...)` and evaluates only what the kernel's own
`_rank_and_yield` left standing as a grant.  An earlier version of the runner did re-walk it,
and its control caught the X-RAY'S own ranking bug within one session.

A LIMITATION I HAVE NOT FIXED, STATED PLAINLY BECAUSE IT IS THE SAME DEFECT CLASS I SPENT TODAY
REPAIRING.  `ablation_verdicts` DUPLICATES the event-selection scan out of `reversal_story_v24`
-- same window, same predicate, same backward range -- so that a verdict is about the bar the
production gate actually used.  A duplicated rule can silently diverge.  The proper fix is at
source: extract the scan into one function both call, or have the story return the event it
chose.  `entries.py` is a STRATEGY-SEMANTIC file and ALGO-011 section 9 gates semantic edits on
an independent grade that has not landed, so that fix is not available yet.  What is in place
instead is a TEXTUAL CORRESPONDENCE PIN in the tests: edit the scan in `entries.py` and the pin
goes red, rather than these numbers going quietly wrong.  It is a stopgap, not a solution, and
it should be replaced by the shared function the moment semantics unlock.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from research import current_mnq_strategy_v2_3_engine as prod
from research.current_mnq_strategy_v2_4_entries import (
    _geom,
    _reaches,
    _shrinking_into_zone,
    _valid_rejection_side,
    displacement_bar,
    momentum_bar,
    reversal_story_v24,
)
from research.current_mnq_strategy_v2_4_candles import classify_patterns

core = prod.core

DIAGNOSTIC_ONLY = (
    "DIAGNOSTIC_ONLY. Restores v2.2 requirements hypothetically to size each v2.4 loosening. "
    "Changes no production behaviour and asserts no requirement is correct. ALGO-011 §10."
)

# Each entry: the v2.2 requirement, and where v2.4 dropped or weakened it.
ABLATIONS = {
    "R1_APPROACH_TRAVEL": (
        "v2.2 `approach` = over the 5 prior 5m bars price NET TRAVELLED INTO the level "
        "(close[-1] < open[0] for a long). v2.4 returns the literal True — entries.py:168."),
    "R2_RECLAIM_AT_ZONE_MID": (
        "v2.2 `reclaim` required close beyond the zone MIDPOINT. v2.4 `reclaimed` requires only "
        "close beyond the zone EDGE (loc.lo / loc.hi), so the whole near half of the zone "
        "became acceptable."),
    "R3_RECLAIM_IS_A_TURN": (
        "v2.2 `reclaim` also required `close > prev.close` (a long) — an actual turn against the "
        "prior bar. v2.4 dropped it."),
    "R4_WICK_REJECTION_REQUIRED": (
        "v2.2 `fight` REQUIRED a rejection wick. v2.4 demoted it to one of four alternatives "
        "(wick OR pattern_story OR shrink OR first_momentum), so a momentum bar alone suffices."),
    "R5_FOLLOW_ANCHORED_AT_MID": (
        "v2.2 `follow` required close beyond the zone MIDPOINT. v2.4 anchors it to the EVENT "
        "BAR's close instead, which can sit far from the level."),
    "R6_DISPLACEMENT_REQUIRED": (
        "v2.2 `decision` = takeover AND displacement AND follow. v2.4 `decision` = follow alone; "
        "`displacement` is computed and then not required, and `takeover` is the literal True "
        "and is read by nothing — entries.py:174."),
}


def _loc_mid(loc) -> float:
    m = getattr(loc, "mid", None)
    if m is not None and np.isfinite(float(m)):
        return float(m)
    return (float(loc.lo) + float(loc.hi)) / 2.0


def ablation_verdicts(full5: pd.DataFrame, ts: pd.Timestamp, row, direction: str,
                      loc, p, pad: float) -> dict | None:
    """Verdicts for ONE granted candidate. None when the kernel does not grant it.

    Mirrors `reversal_story_v24`'s event selection exactly — same window, same predicate,
    same backward scan — so a verdict is about the bar the production gate actually used.
    """
    story = reversal_story_v24(full5, ts, row, direction, loc, p, pad)
    if not story.complete:
        return None

    prior = full5[full5.index < ts].tail(5)
    q = pd.concat([prior, pd.DataFrame([row], index=[ts])])

    start = max(0, len(q) - 4)
    event_pos = None
    for j in range(len(q) - 2, start - 1, -1):
        if _valid_rejection_side(q.iloc[j], loc, direction, pad):
            event_pos = j
            break
    if event_pos is None:                       # unreachable: complete implies an event exists
        raise RuntimeError("ABLATION_LOST_THE_EVENT_BAR_THE_KERNEL_FOUND")

    event = q.iloc[event_pos]
    eg = _geom(event)
    mid = _loc_mid(loc)
    ref_ranges = [_geom(r).range for _, r in prior.tail(3).iterrows()]
    ref = float(np.median(ref_ranges)) if ref_ranges else None

    if direction == "L":
        approach = bool(float(prior.close.iloc[-1]) < float(prior.open.iloc[0])) \
            if len(prior) >= 2 else False
        reclaim_mid = bool(float(event.close) >= mid)
        follow_mid = bool(float(row.close) >= mid)
        wick = bool(eg.lower_frac >= float(p.reject_wick))
    else:
        approach = bool(float(prior.close.iloc[-1]) > float(prior.open.iloc[0])) \
            if len(prior) >= 2 else False
        reclaim_mid = bool(float(event.close) <= mid)
        follow_mid = bool(float(row.close) <= mid)
        wick = bool(eg.upper_frac >= float(p.reject_wick))

    if event_pos >= 1:
        prev = q.iloc[event_pos - 1]
        turn = bool(float(event.close) > float(prev.close)) if direction == "L" \
            else bool(float(event.close) < float(prev.close))
    else:
        turn = False

    v = {
        "R1_APPROACH_TRAVEL": approach,
        "R2_RECLAIM_AT_ZONE_MID": reclaim_mid,
        "R3_RECLAIM_IS_A_TURN": turn,
        "R4_WICK_REJECTION_REQUIRED": wick,
        "R5_FOLLOW_ANCHORED_AT_MID": follow_mid,
        "R6_DISPLACEMENT_REQUIRED": bool(displacement_bar(row, direction, p, ref)),
    }
    v["ALL_SIX_RESTORED"] = all(v[k] for k in ABLATIONS)
    return v


__all__ = ["ABLATIONS", "DIAGNOSTIC_ONLY", "ablation_verdicts"]
