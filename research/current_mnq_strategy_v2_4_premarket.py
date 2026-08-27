#!/usr/bin/env python3
"""Conditional premarket-plan equation for Current MNQ v2.4.

Direct trader fidelity correction (2026-08-20): this strategy does NOT use
PDH/PDL/PWH/PWL. The inherited v2.2 premarket scorer is therefore called with
empty prior-day/week/previous-close maps so those legacy references cannot affect
direction, location state, confluence, or authorization. What remains is causal
premarket price-action structure/control only.

Premarket direction is a prior, never a standalone signal. Aligned/neutral setups
may continue through the remaining gates. A counter-plan setup may continue only
when the market produces strong contradictory evidence at a major authorized
support/resistance or FVG interaction location. The kernel proves the candle and
force equations before this function can authorize anything.
"""
from __future__ import annotations

from pathlib import Path
import json

import pandas as pd

from research import current_mnq_strategy_v2_3_engine as prod

core = prod.core
SPEC_PATH = Path(__file__).with_name("current_mnq_strategy_v2_4_premarket_semantics.json")


def load_premarket_spec(path: str | Path = SPEC_PATH) -> dict:
    return json.loads(Path(path).read_text())


def build_premarket_plan_v24(full5, dte, as_of):
    """Build the v2.4 structural prior with legacy D/W references disabled.

    Passing empty maps is deliberate and fail-closed: PDH/PDL/PWH/PWL and prior
    close/gap fields cannot contribute to score or location state in this strategy.
    The inherited routine still computes premarket net movement, candle control,
    and higher/lower premarket structure causally from bars already known.

    ── ALGO-181: `as_of` IS REQUIRED AND HAS NO DEFAULT, ON PURPOSE. ──
    This function used to take no anchor at all, which meant THERE WAS NOWHERE FOR A CALLER TO BE
    CAUSAL EVEN IF IT WANTED TO BE — the absence of the parameter WAS the defect. It was built once
    per session and consumed per decision, so a decision at 09:00 read a plan computed from bars up
    to `PRE_END = 09:29`: six bars that had not printed.

    MEASURED before the repair, 14 sessions x 4 anchors all before PRE_END:
      `plan.primary`      differed at 10 of 56  — gates DIRECTION on every setup family via
                                                  `plan_allows_v24` (kernel:355/392/406)
      `plan.pm_structure` differed at  2 of 56  — gates `_range_room_authorization`

    A DEFAULT OF `None` WOULD HAVE SILENTLY RESTORED THE DEFECT for the next caller who forgot, and
    this campaign has already watched a `09:30` literal survive its own deletion by moving to
    another file. So the parameter is positional and required: a caller must WRITE something, and a
    non-causal use is greppable rather than invisible.

    `as_of=None` is still permitted and means "the whole premarket session, NOT FOR DECISION USE" —
    for diagnostics and for tests that pass sentinels. Decision-path callers pass the decision clock.

    `PRE_END = 09:29` is untouched. It is the DEFINITION of the premarket session, not a parameter
    being retuned, and no constant is chosen here. Truncation is BY COMPLETION (`index + 5m <= as_of`)
    because a 5m bar stamped 09:25 has not printed at 09:29. The inherited routine then applies its
    own `PRE_END` window on top, so the effective bound is exactly `min(as_of, PRE_END)` — and the
    same-day half of the OVERNIGHT range at `v2_2_engine.py:651` is bounded by the same truncation,
    which a call-site patch would have left for the next enumeration.
    """
    if as_of is not None:
        cutoff = pd.Timestamp(as_of)
        full5 = full5[full5.index + pd.Timedelta(minutes=5) <= cutoff]
    plan = core.premarket_plan(full5, dte, {}, {}, {})
    # The inherited object defaults to the audit label INSIDE_PRIOR_RANGE when no
    # daily map is supplied. That label would falsely imply prior-day-range use.
    # Keep the score untouched, but make the non-decision audit field truthful.
    if hasattr(plan, "location_state"):
        plan.location_state = "STRUCTURE_ONLY_NO_NAMED_REFERENCE"
    return plan


def major_location(loc: core.Location, p: core.Params) -> bool:
    return bool(
        float(loc.quality) >= float(p.high_zone_quality)
        or int(loc.confluence) >= 2
    )


def plan_allows_v24(plan, direction: str, setup: str, story,
                    loc: core.Location, p: core.Params) -> bool:
    if direction not in {"L", "S"}:
        raise ValueError("direction must be L or S")
    if setup not in {"REV", "BRK5", "BRK15"}:
        raise ValueError("setup must be REV, BRK5 or BRK15")

    primary = str(getattr(plan, "primary", "NEUTRAL"))
    if primary == "NEUTRAL":
        return True
    aligned = (primary == "BULL" and direction == "L") or (primary == "BEAR" and direction == "S")
    if aligned:
        return True

    # Counter-plan evidence must occur at a major location. No extra numeric
    # threshold is introduced; high_zone_quality is already frozen in Params.
    if not major_location(loc, p):
        return False
    if setup == "REV":
        return bool(story is not None and getattr(story, "complete", False))

    # BRK5 and BRK15 are allowed here only because the shared kernel separately
    # requires their stronger confirmation equations before asking this question.
    return True
