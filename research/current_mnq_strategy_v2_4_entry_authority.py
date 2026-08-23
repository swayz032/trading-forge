#!/usr/bin/env python3
"""Entry authority as an evidence state machine. WAIT by default. Four routes, no fifth.

ALGO-029 item 1, third piece. **BUILD ONLY** — not imported by the kernel, the entry path, the
engine or the signal path, and a test enforces all four. ALGO-029 §2 authorizes the build in
parallel with the outstanding grade; ACCEPTANCE stays gated until it passes.

ALGO-025 §2.3 names this as the thing that makes a standalone bot NOT a retail indicator bot:

    "Entry authority is an evidence state machine, WAIT by default: authorized key zone ->
     real interaction -> candle STORY -> causal force -> entry, four route families only. A
     retail bot asks 'did the indicator cross'; this bot asks 'did price EARN permission at my
     level'."

And `spec.hard_entry_order` fixes the sequence. Steps 3-6 are what this module implements:

    3  PRICE_REACHES_AUTHORIZED_SR_OR_FVG_OR_MATCHES_ONE_OF_TWO_FROZEN_PREBREAK_EXCEPTIONS
    4  CLASSIFY_REJECTION_RECLAIM_BREAK_RETEST_OR_CONTINUATION_STORY
    5  READ_5M_CANDLESTICK_GEOMETRY_AND_MULTI_CANDLE_CONTROL_STORY
    6  REQUIRE_SUSTAINED_INTRA_CANDLE_DIRECTIONAL_FORCE_FROM_CAUSAL_1M_RECONSTRUCTION

WHY A STATE MACHINE AND NOT A BOOLEAN. The measured defect this exists to kill is that the bot
**takes a trade in 14 of 14 sessions and never once genuinely declines** — its entry decision is
a constant, so it carries no information. A machine whose DEFAULT is WAIT, and which must be
walked forward one proven step at a time, cannot have that shape: every grant names the evidence
that produced it and every refusal names the step it stopped at.

THE FOUR ROUTES ARE CLOSED. ALGO-009 §3 says four families and no fifth; ALGO-020 §2 ruled
BRK15 a VARIANT of Route B rather than a fifth route. Adding a fifth is a semantic change that
needs its own ruling, and a test pins the count. BRK15 is reached as `route=B, variant=BRK15`
and is refused under any other route, so the variant cannot become a fifth permission path
wearing a different name.
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from research import current_mnq_strategy_v2_4_breakout_derivation as brk
from research.current_mnq_strategy_v2_4_derivation import (
    DerivedStory,
    derive_story,
)

DIAGNOSTIC_ONLY = (
    "BUILD_ONLY. Not wired into the kernel, decides no trade, gates nothing. Its output may "
    "not select or accept any semantic candidate until the re-dispatched grade passes. "
    "ALGO-029 item 1 and section 2."
)

# The four families. ALGO-009 section 3: there is no fifth.
ROUTE_A_REJECTION = "A_NORMAL_REJECTION"
ROUTE_B_BREAKOUT = "B_NORMAL_BREAKOUT"
ROUTE_C_PREBREAK_DISPLACEMENT = "C_PREBREAK_DISPLACEMENT"
ROUTE_D_PREBREAK_RETEST = "D_PREBREAK_RETEST_BREAKOUT"
ROUTES = (ROUTE_A_REJECTION, ROUTE_B_BREAKOUT,
          ROUTE_C_PREBREAK_DISPLACEMENT, ROUTE_D_PREBREAK_RETEST)

# The states. WAIT is the default and the machine must be walked forward out of it.
WAIT_NO_LOCATION = "WAIT_NO_AUTHORIZED_LOCATION"
WAIT_NO_INTERACTION = "WAIT_PRICE_HAS_NOT_EARNED_THE_LEVEL"
WAIT_NO_STORY = "WAIT_STORY_INCOMPLETE"
WAIT_NO_FORCE = "WAIT_FORCE_NOT_PROVEN"
GRANTED = "GRANTED"

#: Ordered, so a refusal always names the EARLIEST unmet requirement rather than the last one
#: checked. A machine that reports the wrong blocking step sends the reader to the wrong place.
STATE_ORDER = (WAIT_NO_LOCATION, WAIT_NO_INTERACTION, WAIT_NO_STORY, WAIT_NO_FORCE, GRANTED)

# ALGO-020 section 2: BRK15 is a VARIANT of Route B, not a fifth route. It is now derived, so
# the deferral list is EMPTY rather than deleted - an empty list a test still checks is worth
# more than a list that quietly disappeared along with the thing it was tracking.
VARIANT_BRK15 = brk.VARIANT_BRK15
VARIANTS = (VARIANT_BRK15,)
NOT_DERIVED_HERE: tuple[str, ...] = ()

#: Route D has two legal forms and either one satisfies it, so a refusal must name BOTH.
NEITHER_D_FORM = "NEITHER_ACCEPTED_BREAK_RETEST_NOR_PREBREAK_REPEAT_TEST_QUALIFIED"

#: Which WAIT step a breakout refusal belongs to. Derived once, in one place, so the mapping
#: cannot drift between routes - "price never earned the level" is a different failure from
#: "it earned it and the sequence is incomplete", and the reader is sent to a different place.
_INTERACTION_REFUSALS = frozenset({
    brk.NO_COMPLETED_BREAK, brk.NOT_ENOUGH_BARS, brk.NO_PRIOR_TEST, brk.NOT_DISPLACEMENT,
})


@dataclass(frozen=True)
class Authority:
    """The verdict, and the evidence that produced it."""
    state: str
    route: str | None
    story: DerivedStory | None
    force_confirmed: bool
    reason: str | None
    #: For routes B/C/D there is no rejection story; the breakout form is the evidence.
    form: str | None = None

    @property
    def granted(self) -> bool:
        return bool(self.state == GRANTED and self.route in ROUTES)

    def explain(self) -> str:
        """One plain line. The operator and GPT read these after the 27th."""
        if self.granted:
            what = self.story.interaction if self.story is not None else self.form
            return f"ENTER via {self.route}: {what}, force proven"
        return f"WAIT — {self.reason or self.state}"


def _breakout_read(bars: pd.DataFrame, route: str, direction: str, lo: float, hi: float,
                   body_frac: float, close_loc: float, reject_wick: float,
                   range_ratio: float, acceptance_bars: int,
                   variant: str | None) -> brk.BreakoutRead:
    """Route B/C/D evidence, on COMPLETED bars plus the live trigger.

    Same split ALGO-033 ruled for Route A: the story is read on what the market has finished
    saying, and the still-forming bar carries force and follow-through only. That is also what
    makes section 7 item 14 - backdating an entry from the parent's final OHLC - unreachable.
    """
    completed, trigger = bars.iloc[:-1], bars.iloc[-1]

    if route == ROUTE_B_BREAKOUT:
        if variant == VARIANT_BRK15:
            # The caller supplies FIFTEEN-minute parents here, not 5m. The variant's whole
            # premise is a weak first break, so it refuses one that already had momentum.
            return brk.weak_break_continuation(completed, trigger, lo, hi, direction,
                                               body_frac, close_loc)
        return brk.normal_breakout(completed, trigger, lo, hi, direction,
                                   body_frac, close_loc)
    if route == ROUTE_C_PREBREAK_DISPLACEMENT:
        return brk.prebreak_displacement(completed, trigger, lo, hi, direction,
                                         body_frac, close_loc, range_ratio)

    # Route D has TWO legal forms and either satisfies it. A refusal must therefore name why
    # BOTH failed - reporting one of them would send the reader to half the evidence.
    accepted = brk.break_retest(completed, trigger, lo, hi, direction, body_frac, close_loc,
                                acceptance_bars)
    if accepted.valid:
        return accepted
    repeat = brk.prebreak_repeat_test(completed, trigger, lo, hi, direction,
                                      body_frac, close_loc, reject_wick)
    if repeat.valid:
        return repeat
    return brk.BreakoutRead(
        None,
        f"{NEITHER_D_FORM}: accepted_break={accepted.refusal}; repeat_test={repeat.refusal}")


def decide(bars: pd.DataFrame, direction: str, lo: float, hi: float,
           *, location_authorized: bool, force_confirmed: bool,
           body_frac: float, close_loc: float, reject_wick: float,
           pad: float = 0.0, lookback: int = 6,
           route: str = ROUTE_A_REJECTION,
           range_ratio: float | None = None,
           acceptance_bars: int = 3,
           variant: str | None = None) -> Authority:
    """Walk the machine forward. Every step must be PROVEN; the default is WAIT.

    `location_authorized` and `force_confirmed` are supplied by the existing, already-graded
    gates (`build_entry_locations_v24`, `force_snapshot`) rather than re-implemented here —
    re-implementing a gate is how the X-ray came to diverge from the kernel. `range_ratio` is
    supplied the same way and for the same reason: it is FROZEN as `Params.range_ratio`, so
    route C refuses rather than inventing one. See `breakout_derivation.UNFROZEN_CHOICES` for
    the one value the spec genuinely does not fix.
    """
    if route not in ROUTES:
        raise ValueError(f"NO_FIFTH_ROUTE: {route!r} is not one of {ROUTES}")

    # `range_ratio` is FROZEN as `Params.range_ratio`. This module must not carry a default for
    # it: a default that happens to match the frozen value is luck, and it rots silently the
    # first time the frozen value moves. Route C is the only route that reads it, so only
    # route C is refused without it.
    # A variant belongs to exactly one route. Accepting BRK15 under route C or D would be a
    # fifth permission path wearing a variant's name.
    if variant is not None:
        if variant not in VARIANTS:
            raise ValueError(f"UNKNOWN_VARIANT: {variant!r} is not one of {VARIANTS}")
        if variant == VARIANT_BRK15 and route != ROUTE_B_BREAKOUT:
            raise ValueError(
                f"VARIANT_BELONGS_TO_ANOTHER_ROUTE: {VARIANT_BRK15} is a variant of "
                f"{ROUTE_B_BREAKOUT}, not {route}")

    if route == ROUTE_C_PREBREAK_DISPLACEMENT and range_ratio is None:
        raise ValueError(
            "RANGE_RATIO_NOT_SUPPLIED: the frozen range-expansion requirement lives in "
            "Params.range_ratio and must be passed in; this module may not invent one")

    # Step 3a — an authorized key zone, or nothing to interact with.
    if not location_authorized:
        return Authority(WAIT_NO_LOCATION, None, None, False, WAIT_NO_LOCATION)

    # Steps 3b-5 — a real interaction and a complete story, DERIVED BY THE ROUTE ASKED FOR.
    # Running the rejection story for every route would accept a breakout on rejection
    # evidence, which is the wrong-route class this machine exists to refuse.
    story: DerivedStory | None = None
    form: str | None = None
    if route == ROUTE_A_REJECTION:
        story = derive_story(bars, direction, lo, hi, body_frac, close_loc,
                             reject_wick, pad, lookback)
        if not story.approach:
            return Authority(WAIT_NO_INTERACTION, None, story, False,
                             story.refusal or WAIT_NO_INTERACTION)
        if not story.complete:
            return Authority(WAIT_NO_STORY, None, story, False,
                             story.refusal or WAIT_NO_STORY)
    else:
        read = _breakout_read(bars, route, direction, lo, hi,
                              body_frac, close_loc, reject_wick, range_ratio,
                              acceptance_bars, variant)
        if not read.valid:
            state = (WAIT_NO_INTERACTION if read.refusal in _INTERACTION_REFUSALS
                     else WAIT_NO_STORY)
            return Authority(state, None, None, False, read.refusal)
        form = read.form

    # Step 6 — causal force. Proven by the existing gate, never assumed.
    if not force_confirmed:
        return Authority(WAIT_NO_FORCE, None, story, False, WAIT_NO_FORCE, form)

    return Authority(GRANTED, route, story, True, None, form)


def blocking_step(a: Authority) -> int:
    """How far the machine got, as an index into STATE_ORDER. Useful for a census."""
    return STATE_ORDER.index(a.state)


__all__ = [
    "Authority", "DIAGNOSTIC_ONLY", "GRANTED", "ROUTES", "ROUTE_A_REJECTION",
    "ROUTE_B_BREAKOUT", "ROUTE_C_PREBREAK_DISPLACEMENT", "ROUTE_D_PREBREAK_RETEST",
    "STATE_ORDER", "VARIANT_BRK15", "VARIANTS", "NEITHER_D_FORM", "NOT_DERIVED_HERE",
    "WAIT_NO_FORCE", "WAIT_NO_INTERACTION", "WAIT_NO_LOCATION",
    "WAIT_NO_STORY", "blocking_step", "decide",
]
