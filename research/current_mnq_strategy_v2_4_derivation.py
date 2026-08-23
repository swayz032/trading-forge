#!/usr/bin/env python3
"""The derivation layer: compute APPROACH and INTERACTION from price, per the frozen spec.

ALGO-029 item 1. **BUILD ONLY — this module is not wired into the kernel and decides no live
trade.** ALGO-029 §2 authorizes the build to start in parallel with the outstanding grade while
keeping ACCEPTANCE fully gated: no candidate produced here is selected or accepted against the
14 cases until the re-dispatched grade passes the repaired evaluator.

WHY IT EXISTS. `reversal_story_v24` returns `approach=True` and `takeover=True` as unconditional
literals (`entries.py:168,174`), so `Story.complete = approach and fight and decision` has one
of its three conjuncts permanently satisfied. Measured consequence: restoring an evidence-derived
approach alone would kill 82 of 128 Route A grants. And `_valid_rejection_side` collapses the
whole interaction question into "the bar reached the zone and closed on an acceptable side".

THE FROZEN SPEC IS THE TEXTBOOK, and it is more specific than that. `spec.zone_gate` names SIX
valid rejection interactions, not one:

    1 touch_and_reject                       4 failed_breakout_back_inside_with_control
    2 penetrate_and_reclaim_with_defense     5 doji_pin_inside_or_shrinking_approach_story
    3 sweep_and_reclaim_with_control         6 prior_momentum_after_rejection

and it draws two lines the current code does not:

    mere_approach_without_touch      -> NO_TRADE (except the two frozen prebreak families)
    touch_without_directional_control -> WAIT_OR_NO_TRADE

So APPROACH is not "always true" and it is not "got near". It is: **price came from outside the
zone and actually REACHED it inside the lookback.** That is computable, and it is computed here.

WHAT THIS MODULE DOES NOT DO. It does not rank, does not gate, does not enter, and is imported
by nothing in the production path. It classifies. Wiring it into `entries.py` is a separate,
gated step; until the grade passes, the only legitimate use of its output is diagnostic
comparison against the frozen exam, clearly labelled as such.

NOTHING HERE IS SELF-ATTESTED. Every field is a function of bars and the location. If a
predicate cannot be computed from price it returns False and says why, rather than defaulting
to True the way the code it replaces does.
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from research.current_mnq_strategy_v2_4_entries import _geom

DIAGNOSTIC_ONLY = (
    "BUILD_ONLY. Not wired into the kernel, decides no trade, gates nothing. Its output may "
    "not select or accept any semantic candidate until the re-dispatched grade passes. "
    "ALGO-029 item 1 and section 2."
)

#: The spec's six, verbatim from `zone_gate.valid_rejection_interactions`.
TOUCH_AND_REJECT = "touch_and_reject"
PENETRATE_AND_RECLAIM = "penetrate_and_reclaim_with_defense"
SWEEP_AND_RECLAIM = "sweep_and_reclaim_with_control"
FAILED_BREAKOUT_BACK_INSIDE = "failed_breakout_back_inside_with_control"
APPROACH_STORY = "doji_pin_inside_or_shrinking_approach_story"
PRIOR_MOMENTUM_AFTER_REJECTION = "prior_momentum_after_rejection"

INTERACTIONS = (
    TOUCH_AND_REJECT, PENETRATE_AND_RECLAIM, SWEEP_AND_RECLAIM,
    FAILED_BREAKOUT_BACK_INSIDE, APPROACH_STORY, PRIOR_MOMENTUM_AFTER_REJECTION,
)

#: Why no interaction was found. A refusal that does not say why teaches nothing.
NO_TOUCH = "MERE_APPROACH_WITHOUT_TOUCH"
NO_CONTROL = "TOUCH_WITHOUT_DIRECTIONAL_CONTROL"
NOT_ENOUGH_BARS = "INSUFFICIENT_PRIOR_BARS"
#: Touched the level and had control, but the price action matches NONE of the six.
#: Distinct from NO_TOUCH on purpose: the first checkpoint reported 5 cases as
#: MERE_APPROACH_WITHOUT_TOUCH while they were in WAIT_STORY_INCOMPLETE - they HAD
#: touched, and the refusal named the wrong reason. A refusal that misdirects the
#: reader is worse than a silent one, and after the 27th the reader is the operator.
NO_RECOGNISED_INTERACTION = "TOUCHED_BUT_NO_RECOGNISED_INTERACTION"


@dataclass(frozen=True)
class Approach:
    """Did price actually come to the level, and from where?"""
    reached: bool
    came_from_outside: bool
    bars_since_outside: int | None
    approached_from: str | None      # "ABOVE" or "BELOW", relative to the zone
    reason: str | None

    @property
    def real(self) -> bool:
        """The spec's line: mere approach without touch is NO_TRADE."""
        return bool(self.reached and self.came_from_outside)


def _touches(row, lo: float, hi: float, pad: float = 0.0) -> bool:
    return bool(float(row.high) >= lo - pad and float(row.low) <= hi + pad)


def _wholly_above(row, hi: float, pad: float = 0.0) -> bool:
    return bool(float(row.low) > hi + pad)


def _wholly_below(row, lo: float, pad: float = 0.0) -> bool:
    return bool(float(row.high) < lo - pad)


def derive_approach(bars: pd.DataFrame, lo: float, hi: float,
                    pad: float = 0.0, lookback: int = 6) -> Approach:
    """APPROACH, computed from price rather than asserted.

    `bars` are the completed bars up to and including the interaction window, oldest first.
    The question the spec asks is not "is price near the zone" but "did it COME to the zone" —
    so a real approach needs a bar that was WHOLLY OUTSIDE the zone, followed by one that
    TOUCHES it. Price that has simply sat inside the band all along has not approached
    anything, and today's code would call that `approach=True` like everything else.
    """
    if bars is None or len(bars) < 2:
        return Approach(False, False, None, None, NOT_ENOUGH_BARS)

    q = bars.tail(lookback)
    rows = [q.iloc[i] for i in range(len(q))]

    touch_idx = None
    for i in range(len(rows) - 1, -1, -1):
        if _touches(rows[i], lo, hi, pad):
            touch_idx = i
            break
    if touch_idx is None:
        return Approach(False, False, None, None, NO_TOUCH)

    # Walk back from the touch for the last bar that was wholly outside, and which side.
    for j in range(touch_idx - 1, -1, -1):
        if _wholly_above(rows[j], hi, pad):
            return Approach(True, True, touch_idx - j, "ABOVE", None)
        if _wholly_below(rows[j], lo, pad):
            return Approach(True, True, touch_idx - j, "BELOW", None)

    return Approach(True, False, None, None, NO_TOUCH)


@dataclass(frozen=True)
class Interaction:
    """Which of the spec's six happened, if any.

    `kind` is the primary label; `all_kinds` is EVERY form the price action matches. The first
    checkpoint over real data named `touch_and_reject` ZERO times out of 68 grants - not
    because it never happens, but because the branch order let the sequence-level forms shadow
    it. A single-label classifier hides that; reporting all of them makes the census truthful
    and the shadowing visible.
    """
    kind: str | None
    approach: Approach
    control: bool
    reason: str | None
    all_kinds: tuple = ()

    @property
    def valid(self) -> bool:
        return bool(self.kind is not None and self.approach.real and self.control)


def _control(row, direction: str, body_frac: float, close_loc: float) -> bool:
    """Directional control geometry. The spec's `touch_without_directional_control` line."""
    g = _geom(row)
    if direction == "L":
        return bool(g.bullish and g.body_frac >= body_frac and g.close_loc >= close_loc)
    return bool(g.bearish and g.body_frac >= body_frac and g.close_loc <= 1.0 - close_loc)


def _rejection_wick(row, direction: str, reject_wick: float) -> bool:
    g = _geom(row)
    return bool(g.lower_frac >= reject_wick if direction == "L"
                else g.upper_frac >= reject_wick)


def classify_interaction(bars: pd.DataFrame, direction: str, lo: float, hi: float,
                         body_frac: float, close_loc: float, reject_wick: float,
                         pad: float = 0.0, lookback: int = 6) -> Interaction:
    """Name WHICH of the six interactions the price action shows.

    Order matters only for reporting: the strongest evidence is named first so a case that
    satisfies several is described by its most specific form. Every branch is a function of
    bars; none defaults to True.
    """
    ap = derive_approach(bars, lo, hi, pad, lookback)
    if not ap.real:
        return Interaction(None, ap, False, ap.reason or NO_TOUCH)

    q = bars.tail(lookback)
    rows = [q.iloc[i] for i in range(len(q))]
    last = rows[-1]
    control = _control(last, direction, body_frac, close_loc)

    # For a long the zone is support: "beyond" means BELOW it. Mirror for a short.
    def beyond(row) -> bool:
        return (float(row.close) < lo) if direction == "L" else (float(row.close) > hi)

    def back_inside(row) -> bool:
        return bool(lo <= float(row.close) <= hi)

    def origin_side(row) -> bool:
        return (float(row.close) > hi) if direction == "L" else (float(row.close) < lo)

    def swept(row) -> bool:
        """A wick took liquidity beyond the zone but the close did not."""
        pierced = (float(row.low) < lo) if direction == "L" else (float(row.high) > hi)
        return bool(pierced and not beyond(row))

    # EVERY form the action matches, not the first one an elif-chain reaches. Order here is
    # reporting priority only - `all_kinds` carries the rest so nothing is silently shadowed.
    matched: list[str] = []
    # 1. this bar touched the level and was pushed away from it
    if _touches(last, lo, hi, pad) and _rejection_wick(last, direction, reject_wick):
        matched.append(TOUCH_AND_REJECT)
    # 4. a COMPLETED close beyond, then a close back inside -> failed breakout
    if any(beyond(r) for r in rows[:-1]) and (back_inside(last) or origin_side(last)):
        matched.append(FAILED_BREAKOUT_BACK_INSIDE)
    # 3. wick beyond, close held -> sweep and reclaim
    if any(swept(r) for r in rows[-3:]):
        matched.append(SWEEP_AND_RECLAIM)
    # 2. closed INTO the band, then reclaimed the origin side
    if any(back_inside(r) for r in rows[:-1]) and origin_side(last):
        matched.append(PENETRATE_AND_RECLAIM)
    # 6. an EARLIER bar rejected AT THE LEVEL, then momentum followed. The wick must belong to
    #    a bar that actually TOUCHED the zone - a wick ten points away is not a rejection OF
    #    THE LEVEL, and scanning every bar let a distant pin outrank the real touch.
    if any(_touches(r, lo, hi, pad) and _rejection_wick(r, direction, reject_wick)
           for r in rows[:-1]) and control:
        matched.append(PRIOR_MOMENTUM_AFTER_REJECTION)
    # 5. the approach itself is the story: doji / pin / inside / shrinking
    if _approach_story(rows):
        matched.append(APPROACH_STORY)

    kinds = tuple(matched)
    kind = matched[0] if matched else None

    if kind is None:
        # It TOUCHED - the approach gate above already proved that. Say so accurately.
        return Interaction(None, ap, control,
                           NO_CONTROL if not control else NO_RECOGNISED_INTERACTION, kinds)
    if not control:
        return Interaction(kind, ap, False, NO_CONTROL, kinds)
    return Interaction(kind, ap, True, None, kinds)


def _approach_story(rows: list) -> bool:
    """Doji / pin / inside / shrinking into the level, over the last three bars."""
    if len(rows) < 3:
        return False
    a, b, c = (_geom(r) for r in rows[-3:])
    shrinking = bool(c.range <= b.range <= a.range)
    doji = bool(c.body_frac <= 0.25)
    pin = bool(max(c.upper_frac, c.lower_frac) >= 0.5)
    inside = bool(float(rows[-1].high) <= float(rows[-2].high)
                  and float(rows[-1].low) >= float(rows[-2].low))
    return bool(shrinking or doji or pin or inside)


__all__ = [
    "APPROACH_STORY", "Approach", "DIAGNOSTIC_ONLY", "FAILED_BREAKOUT_BACK_INSIDE",
    "INTERACTIONS", "Interaction", "NOT_ENOUGH_BARS", "NO_CONTROL", "NO_RECOGNISED_INTERACTION", "NO_TOUCH",
    "PENETRATE_AND_RECLAIM", "PRIOR_MOMENTUM_AFTER_REJECTION", "SWEEP_AND_RECLAIM",
    "TOUCH_AND_REJECT", "classify_interaction", "derive_approach",
]


# ─────────────────────────────────────────────────────────────────────────────────────────
# THE STORY LAYER — APPROACH / FIGHT / DECISION, all three derived.
#
# `spec.candlestick_semantics.story` is literally `[APPROACH, FIGHT, DECISION]`, which is the
# same triple as `core.Story.complete`. The difference is that here NONE of them is a literal.
#
# The spec's negative fixtures are the acceptance criteria, and these are the ones this layer
# is responsible for refusing:
#     doji_or_spinning_top_at_zone_without_directional_takeover
#     mixed_overlap_and_two_sided_wicks
#     counter_bias_reversal_without_completed_control_transfer
#     sweep_reclaim_without_hold_or_directional_defense
#     candlestick_pattern_away_from_authorized_SR_or_FVG
#     mere_approach_that_never_reaches_zone_and_matches_no_prebreak_exception
# Each has a test named after it.
# ─────────────────────────────────────────────────────────────────────────────────────────

#: `mixed_or_indecisive_control -> WAIT_OR_NO_TRADE`. Two-sided wicks with no body is conflict,
#: not a decision, and the spec refuses it by name.
TWO_SIDED_CONFLICT = "MIXED_OVERLAP_AND_TWO_SIDED_WICKS"
NO_TAKEOVER = "INDECISION_AT_ZONE_WITHOUT_DIRECTIONAL_TAKEOVER"
NO_CONTROL_TRANSFER = "COUNTER_BIAS_REVERSAL_WITHOUT_COMPLETED_CONTROL_TRANSFER"
NO_DEFENSE = "SWEEP_RECLAIM_WITHOUT_HOLD_OR_DIRECTIONAL_DEFENSE"


@dataclass(frozen=True)
class DerivedStory:
    """APPROACH / FIGHT / DECISION with every field a function of price.

    `all_kinds` carries EVERY interaction form the action matches, not just the reported
    label. It was added to `Interaction` first and not threaded through here, so the real
    checkpoint reported an empty all-matches census while the unit test - which reads
    `Interaction` directly - passed. The empty census is what caught it.
    """
    approach: bool
    fight: bool
    decision: bool
    interaction: str | None
    two_sided_conflict: bool
    refusal: str | None
    all_kinds: tuple = ()

    @property
    def complete(self) -> bool:
        """All three, and no refusal. The same shape as `core.Story.complete`, none asserted."""
        return bool(self.approach and self.fight and self.decision and self.refusal is None)


def two_sided_wick_conflict(row, min_each: float = 0.30, max_body: float = 0.40) -> bool:
    """Both wicks substantial and the body small: the bar argues with itself.

    `spec.control_features` lists `two_sided_wick_conflict`, and
    `negative_semantic_fixtures` refuses `mixed_overlap_and_two_sided_wicks` outright.
    """
    g = _geom(row)
    return bool(g.upper_frac >= min_each and g.lower_frac >= min_each
                and g.body_frac <= max_body)


def _defended(rows: list, direction: str, lo: float, hi: float) -> bool:
    """A sweep or reclaim must HOLD. The close must not fall back through the level after.

    `sweep_reclaim_without_hold_or_directional_defense` is a named refusal, so a reclaim that
    immediately gives the level back is not a reclaim.
    """
    last = rows[-1]
    return bool(float(last.close) >= lo) if direction == "L" else bool(float(last.close) <= hi)


def derive_story(bars: pd.DataFrame, direction: str, lo: float, hi: float,
                 body_frac: float, close_loc: float, reject_wick: float,
                 pad: float = 0.0, lookback: int = 6) -> DerivedStory:
    """The full story, derived. Refuses by name rather than defaulting to True."""
    it = classify_interaction(bars, direction, lo, hi, body_frac, close_loc,
                              reject_wick, pad, lookback)
    approach = it.approach.real

    if not approach:
        return DerivedStory(False, False, False, it.kind, False,
                            it.reason or NO_TOUCH, it.all_kinds)

    q = bars.tail(lookback)
    rows = [q.iloc[i] for i in range(len(q))]
    last = rows[-1]

    conflict = two_sided_wick_conflict(last)
    if conflict:
        return DerivedStory(True, False, False, it.kind, True, TWO_SIDED_CONFLICT,
                            it.all_kinds)

    # `candlestick_pattern_away_from_authorized_SR_or_FVG` and
    # `mere_approach_that_never_reaches_zone...` are both handled by the approach gate above.
    if it.kind is None:
        return DerivedStory(True, False, False, None, False,
                            it.reason or NO_RECOGNISED_INTERACTION, it.all_kinds)

    # FIGHT = a COMPLETED control transfer at the level. The interaction says a fight
    # happened; control says which side won it.
    if not it.control:
        # An indecision shape at the zone with no takeover is refused by name.
        return DerivedStory(True, False, False, it.kind, False, NO_TAKEOVER, it.all_kinds)

    if it.kind in (SWEEP_AND_RECLAIM, PENETRATE_AND_RECLAIM) and \
            not _defended(rows, direction, lo, hi):
        return DerivedStory(True, False, False, it.kind, False, NO_DEFENSE, it.all_kinds)

    fight = True

    # DECISION = the trigger bar carries the direction FORWARD, not merely sideways.
    prior = rows[-2] if len(rows) >= 2 else None
    if prior is None:
        return DerivedStory(True, fight, False, it.kind, False, NO_CONTROL_TRANSFER,
                            it.all_kinds)
    follow = (float(last.close) > float(prior.close)) if direction == "L" \
        else (float(last.close) < float(prior.close))
    if not follow:
        return DerivedStory(True, fight, False, it.kind, False, NO_CONTROL_TRANSFER,
                            it.all_kinds)

    return DerivedStory(True, True, True, it.kind, False, None, it.all_kinds)


__all__ += [
    "DerivedStory", "NO_CONTROL_TRANSFER", "NO_DEFENSE", "NO_TAKEOVER", "TWO_SIDED_CONFLICT",
    "derive_story", "two_sided_wick_conflict",
]
