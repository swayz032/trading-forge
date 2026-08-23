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
needs its own ruling, and a test pins the count.
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

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


@dataclass(frozen=True)
class Authority:
    """The verdict, and the evidence that produced it."""
    state: str
    route: str | None
    story: DerivedStory | None
    force_confirmed: bool
    reason: str | None

    @property
    def granted(self) -> bool:
        return bool(self.state == GRANTED and self.route in ROUTES)

    def explain(self) -> str:
        """One plain line. The operator and GPT read these after the 27th."""
        if self.granted:
            return f"ENTER via {self.route}: {self.story.interaction}, force proven"
        return f"WAIT — {self.reason or self.state}"


def decide(bars: pd.DataFrame, direction: str, lo: float, hi: float,
           *, location_authorized: bool, force_confirmed: bool,
           body_frac: float, close_loc: float, reject_wick: float,
           pad: float = 0.0, lookback: int = 6,
           route: str = ROUTE_A_REJECTION) -> Authority:
    """Walk the machine forward. Every step must be PROVEN; the default is WAIT.

    `location_authorized` and `force_confirmed` are supplied by the existing, already-graded
    gates (`build_entry_locations_v24`, `force_snapshot`) rather than re-implemented here —
    re-implementing a gate is how the X-ray came to diverge from the kernel.
    """
    if route not in ROUTES:
        raise ValueError(f"NO_FIFTH_ROUTE: {route!r} is not one of {ROUTES}")

    # Step 3a — an authorized key zone, or nothing to interact with.
    if not location_authorized:
        return Authority(WAIT_NO_LOCATION, None, None, False, WAIT_NO_LOCATION)

    # Steps 3b-5 — a real interaction and a complete control story, all derived.
    story = derive_story(bars, direction, lo, hi, body_frac, close_loc,
                         reject_wick, pad, lookback)
    if not story.approach:
        return Authority(WAIT_NO_INTERACTION, None, story, False,
                         story.refusal or WAIT_NO_INTERACTION)
    if not story.complete:
        return Authority(WAIT_NO_STORY, None, story, False,
                         story.refusal or WAIT_NO_STORY)

    # Step 6 — causal force. Proven by the existing gate, never assumed.
    if not force_confirmed:
        return Authority(WAIT_NO_FORCE, None, story, False, WAIT_NO_FORCE)

    return Authority(GRANTED, route, story, True, None)


def blocking_step(a: Authority) -> int:
    """How far the machine got, as an index into STATE_ORDER. Useful for a census."""
    return STATE_ORDER.index(a.state)


__all__ = [
    "Authority", "DIAGNOSTIC_ONLY", "GRANTED", "ROUTES", "ROUTE_A_REJECTION",
    "ROUTE_B_BREAKOUT", "ROUTE_C_PREBREAK_DISPLACEMENT", "ROUTE_D_PREBREAK_RETEST",
    "STATE_ORDER", "WAIT_NO_FORCE", "WAIT_NO_INTERACTION", "WAIT_NO_LOCATION",
    "WAIT_NO_STORY", "blocking_step", "decide",
]
