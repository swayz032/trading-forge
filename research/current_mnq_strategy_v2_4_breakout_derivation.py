#!/usr/bin/env python3
"""Routes B, C and D derived from price. BUILD ONLY — wired into nothing.

ALGO-035 §2 item 1. Not imported by kernel, entries, engine or signal; the existing import-ban
test keeps that true. ACCEPTANCE remains gated on the outstanding grade.

THE SPEC IS THE TEXTBOOK. `zone_gate.valid_breakout_interactions` names five forms and
`entry_trigger_semantics` fixes each trigger:

  B  normal breakout    "first completed 5m print beyond S/R or FVG is SETUP ONLY -> the
                         following forming 5m must push beyond the first breakout candle high
                         for long / low for short and prove sustained intra5 force"
  B' weak-break BRK15   "weak first break -> controlled completed pullback -> forming 15m bar3
                         may trigger when sustained intra15 force is proven"   (Route B variant,
                         ALGO-020 §2 - not a fifth route)
  D  break-retest       "genuinely broken AND ACCEPTED, retests as the opposite role, then
                         sustained live force confirms"
  D' prebreak repeat    exception #2: a real prior test/rejection, a meaningful reset, then a
                         true retest/return attack
  C  prebreak displace  exception #1: a true displacement sequence into the level whose THIRD
                         candle still holds directional control

AND THE SPEC'S REFUSALS ARE THE POINT, because §7 plants exactly these:

    §7.6   the first completed breakout candle must NEVER enter automatically - it is setup only
    §7.7   the second 5m must EXTEND BEYOND the first print's extreme
           (`second_5m_momentum_without_first_candle_extreme_extension: WAIT_NO_ENTRY`)
    §7.8   ordinary momentum is NOT displacement - displacement needs range expansion too
    §7.9   a displacement third candle that LOSES directional control kills the sequence
    §7.10  exception #2 needs a real prior test/rejection
    §7.11  exception #2 needs a meaningful reset
    §7.12  exception #2 needs a true retest/return attack
    §7.13  there is NO third pre-break exception
    §7.14  the forming parent's FINAL OHLC may never backdate an earlier entry

§7.14 is structural rather than a predicate: every function here takes COMPLETED bars plus a
trigger, and never the trigger's finished form. Same architecture ALGO-033 ruled for Route A.
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from research.current_mnq_strategy_v2_4_derivation import _geom

DIAGNOSTIC_ONLY = (
    "BUILD_ONLY. Not wired into the kernel, decides no trade, gates nothing. Its output may "
    "not select or accept any semantic candidate until the re-dispatched grade passes. "
    "ALGO-035 section 2 item 1."
)

#: WHAT THE SPEC DOES NOT FIX, stated rather than buried in a default argument.
#:
#: `range_ratio` IS frozen - it is `Params.range_ratio`. This module therefore takes it as a
#: required argument and never carries a default: a default that happens to equal the frozen
#: value today is luck, and luck rots silently the first time the frozen value moves.
#:
#: `acceptance_bars` is NOT frozen. The spec refuses
#: `break_retest_without_prior_durable_acceptance` and calls the property "durable", but names
#: no bar count anywhere. THREE consecutive completed closes beyond is this module's DERIVATION
#: of "durable", not a value read off the spec, and it is recorded here so nobody later quotes
#: it as frozen. Changing it is a semantics question for the advisor, not a tuning knob - and
#: it may never be selected by looking at outcomes.
#:
#: IT WAS 2 UNTIL 2026-08-23 AND IT MOVED MECHANICALLY, NOT BY JUDGEMENT. ALGO-037 ruling 1
#: attached a mandatory exam-time sensitivity run at {1,2,3} to this choice; ALGO-054 first
#: amended the population to what Route D CONSIDERED, because after the ALGO-047 wiring the
#: old population was selected BY the value under test and grants could not rise. On the
#: honest population the run measured 363 / 228 / 186 grants, re-checked the spec's silence,
#: and R3 - silent means the STRICTER reading wins - selected 3. No agreement rate, PnL,
#: realized outcome or winner/loser label participated.
UNFROZEN_CHOICES = {
    "acceptance_bars": (
        "3 consecutive completed closes beyond the level. The spec requires DURABLE acceptance "
        "and names no count; this is a derivation of 'durable', not a frozen value. Landed from "
        "2 on 2026-08-23 by the PRE-REGISTERED rule R3 (silent => stricter wins) over the "
        "measured sensitivity 363/228/186 at {1,2,3}, never by score."),
}

#: The two pre-break exceptions, and there is no third (§7.13).
EXCEPTION_DISPLACEMENT = "true_displacement_sequence_into_level_with_third_candle_momentum"
EXCEPTION_REPEAT_TEST = "repeat_test_momentum_attack"

#: ALGO-020 section 2 ruled BRK15 a VARIANT of Route B, never a fifth route.
VARIANT_BRK15 = "BRK15_WEAK_FIRST_BREAK_CONTINUATION"
PREBREAK_EXCEPTIONS = (EXCEPTION_DISPLACEMENT, EXCEPTION_REPEAT_TEST)

#: The two post-break forms, named. They were bare string literals until the kernel began
#: joining on them: a form the kernel must recognise is a JOIN KEY, and a join key duplicated
#: as a literal in two files drifts the first time one of them is edited.
FORM_NORMAL_BREAKOUT = "normal_breakout"
FORM_BREAK_RETEST = "break_retest"

#: Every form this module can return. Route D has TWO legal forms, so a consumer that maps
#: form -> anything must cover both or it will silently mis-name one of them.
FORMS = (FORM_NORMAL_BREAKOUT, FORM_BREAK_RETEST, EXCEPTION_DISPLACEMENT,
         EXCEPTION_REPEAT_TEST, VARIANT_BRK15)

# Refusals, each named after the spec line or §7 item it enforces.
NO_COMPLETED_BREAK = "NO_COMPLETED_PRINT_BEYOND_THE_ZONE"
FIRST_PRINT_IS_SETUP_ONLY = "FIRST_BREAK_CANDLE_IS_SETUP_ONLY_NOT_AN_ENTRY"
NO_EXTREME_EXTENSION = "SECOND_5M_DID_NOT_EXTEND_BEYOND_THE_FIRST_PRINT_EXTREME"
NOT_THE_FOLLOWING_BAR = "NORMAL_BREAKOUT_TRIGGER_MUST_BE_THE_BAR_FOLLOWING_THE_FIRST_PRINT"
BREAK_WAS_NOT_WEAK = "FIRST_BREAK_HAD_MOMENTUM_THIS_IS_THE_NORMAL_ROUTE_NOT_THE_VARIANT"
NO_CONTROLLED_PULLBACK = "NO_CONTROLLED_COMPLETED_PULLBACK_AFTER_THE_WEAK_BREAK"
PULLBACK_LOST_THE_LEVEL = "PULLBACK_GAVE_THE_LEVEL_BACK_THE_BREAK_FAILED"
NO_15M_CONTINUATION = "THIRD_15M_BAR_DID_NOT_RESUME_BEYOND_THE_FIRST_BREAK_CLOSE"
NOT_ACCEPTED = "BREAK_NOT_ACCEPTED_BEFORE_RETEST"
NO_RETEST = "NO_VALID_RETEST_OF_THE_BROKEN_LEVEL"
NOT_DISPLACEMENT = "ORDINARY_MOMENTUM_IS_NOT_TRUE_DISPLACEMENT"
THIRD_CANDLE_LOST_CONTROL = "DISPLACEMENT_THIRD_CANDLE_REVERSED_CONTROL"
NO_PRIOR_TEST = "REPEAT_TEST_WITHOUT_A_REAL_PRIOR_TEST"
NO_RESET = "REPEAT_TEST_WITHOUT_A_MEANINGFUL_RESET"
NO_RETURN_ATTACK = "REPEAT_TEST_WITHOUT_A_TRUE_RETURN_ATTACK"
NOT_ENOUGH_BARS = "INSUFFICIENT_PRIOR_BARS"


def _beyond(row, lo: float, hi: float, direction: str) -> bool:
    """A COMPLETED CLOSE past the zone. A wick through it is not a break."""
    return bool(float(row.close) > hi) if direction == "L" else bool(float(row.close) < lo)


def _momentum(row, direction: str, body_frac: float, close_loc: float) -> bool:
    g = _geom(row)
    if direction == "L":
        return bool(g.bullish and g.body_frac >= body_frac and g.close_loc >= close_loc)
    return bool(g.bearish and g.body_frac >= body_frac and g.close_loc <= 1.0 - close_loc)


def is_true_displacement(row, direction: str, body_frac: float, close_loc: float,
                         reference_range: float, range_ratio: float) -> bool:
    """§7.8. Momentum PLUS range expansion. Not every strong candle is displacement.

    The spec is explicit that the recognizer's `*_LONG_BODY_DISPLACEMENT` pattern label is a
    taxonomy name only and that executable displacement is momentum plus the frozen
    range-expansion requirement.
    """
    if not _momentum(row, direction, body_frac, close_loc):
        return False
    if not (reference_range and reference_range > 0):
        return False
    return bool(_geom(row).range >= reference_range * range_ratio)


@dataclass(frozen=True)
class BreakoutRead:
    """What the price action supports, and why not when it does not."""
    form: str | None
    refusal: str | None
    first_break_index: int | None = None

    @property
    def valid(self) -> bool:
        return bool(self.form is not None and self.refusal is None)


def normal_breakout(completed: pd.DataFrame, trigger, lo: float, hi: float, direction: str,
                    body_frac: float, close_loc: float) -> BreakoutRead:
    """Route B. First completed print beyond is SETUP; the trigger must extend past its extreme.

    §7.6 and §7.7 both live here: the first candle never enters on its own, and a second
    momentum candle that fails to take out the first print's extreme is
    `WAIT_NO_ENTRY` - not a weaker yes.
    """
    if completed is None or len(completed) < 1:
        return BreakoutRead(None, NOT_ENOUGH_BARS)

    rows = [completed.iloc[i] for i in range(len(completed))]
    first_idx = None
    for i, r in enumerate(rows):
        if _beyond(r, lo, hi, direction):
            first_idx = i
            break
    if first_idx is None:
        return BreakoutRead(None, NO_COMPLETED_BREAK)

    # "the FOLLOWING forming 5m" - the trigger is the bar immediately after the first print.
    # A later continuation is not this route; the weak-break variant is what covers a pullback.
    if first_idx != len(rows) - 1:
        return BreakoutRead(None, NOT_THE_FOLLOWING_BAR, first_idx)

    first = rows[first_idx]
    # §7.7 - the trigger must trade BEYOND the first print's extreme, not merely be strong.
    extended = (float(trigger.high) > float(first.high)) if direction == "L" \
        else (float(trigger.low) < float(first.low))
    if not extended:
        # §7.6 restated: without the extension the first print remains setup only.
        return BreakoutRead(None, NO_EXTREME_EXTENSION, first_idx)
    if not _momentum(trigger, direction, body_frac, close_loc):
        return BreakoutRead(None, FIRST_PRINT_IS_SETUP_ONLY, first_idx)
    return BreakoutRead(FORM_NORMAL_BREAKOUT, None, first_idx)


def break_retest(completed: pd.DataFrame, trigger, lo: float, hi: float, direction: str,
                 body_frac: float, close_loc: float,
                 acceptance_bars: int = 3) -> BreakoutRead:
    """Route D. Genuinely broken AND ACCEPTED, then retested as the opposite role.

    "Accepted" is why a single transient close beyond does not qualify - the spec refuses
    `role_flip_from_single_transient_wick_breach` and
    `break_retest_without_prior_durable_acceptance` by name.
    """
    if completed is None or len(completed) < acceptance_bars + 1:
        return BreakoutRead(None, NOT_ENOUGH_BARS)

    rows = [completed.iloc[i] for i in range(len(completed))]
    beyond_flags = [_beyond(r, lo, hi, direction) for r in rows]
    if not any(beyond_flags):
        return BreakoutRead(None, NO_COMPLETED_BREAK)

    # ACCEPTANCE: at least `acceptance_bars` CONSECUTIVE completed closes beyond.
    accepted_end = None
    run = 0
    for i, flag in enumerate(beyond_flags):
        run = run + 1 if flag else 0
        if run >= acceptance_bars:
            accepted_end = i
    if accepted_end is None:
        return BreakoutRead(None, NOT_ACCEPTED)

    # RETEST: price must come back to the broken level after acceptance.
    after = rows[accepted_end + 1:]
    retested = any(float(r.low) <= hi and float(r.high) >= lo for r in after)
    if not retested:
        return BreakoutRead(None, NO_RETEST, accepted_end)
    if not _momentum(trigger, direction, body_frac, close_loc):
        return BreakoutRead(None, FIRST_PRINT_IS_SETUP_ONLY, accepted_end)
    return BreakoutRead(FORM_BREAK_RETEST, None, accepted_end)


def prebreak_displacement(completed: pd.DataFrame, trigger, lo: float, hi: float,
                          direction: str, body_frac: float, close_loc: float,
                          range_ratio: float) -> BreakoutRead:
    """Exception #1 (Route C). A TRUE displacement sequence whose third candle holds control.

    §7.8 - ordinary momentum is not displacement.
    §7.9 - a third candle that reverses control kills the sequence.
    """
    if completed is None or len(completed) < 4:
        return BreakoutRead(None, NOT_ENOUGH_BARS)

    rows = [completed.iloc[i] for i in range(len(completed))]
    ref = float(pd.Series([_geom(r).range for r in rows[:-3]]).median()) if len(rows) > 3 \
        else 0.0

    seq = rows[-3:]
    if not is_true_displacement(seq[0], direction, body_frac, close_loc, ref, range_ratio):
        return BreakoutRead(None, NOT_DISPLACEMENT)
    # §7.9 - the third candle must still hold the direction.
    if not _momentum(seq[2], direction, body_frac, close_loc):
        return BreakoutRead(None, THIRD_CANDLE_LOST_CONTROL)
    # The sequence must be INTO the level, not away from it.
    if not (float(seq[2].high) >= lo and float(seq[2].low) <= hi):
        return BreakoutRead(None, NO_COMPLETED_BREAK)
    if not _momentum(trigger, direction, body_frac, close_loc):
        return BreakoutRead(None, FIRST_PRINT_IS_SETUP_ONLY)
    return BreakoutRead(EXCEPTION_DISPLACEMENT, None)


def prebreak_repeat_test(completed: pd.DataFrame, trigger, lo: float, hi: float,
                         direction: str, body_frac: float, close_loc: float,
                         reject_wick: float) -> BreakoutRead:
    """Exception #2 (Route D family). Prior test/rejection, a real reset, then a return attack.

    §7.10, §7.11 and §7.12 are three separate requirements and each has its own refusal, so a
    sequence missing one cannot borrow another's evidence.
    """
    if completed is None or len(completed) < 4:
        return BreakoutRead(None, NOT_ENOUGH_BARS)

    rows = [completed.iloc[i] for i in range(len(completed))]

    def touches(r):
        return bool(float(r.high) >= lo and float(r.low) <= hi)

    def rejected(r):
        g = _geom(r)
        return bool(g.upper_frac >= reject_wick) if direction == "L" \
            else bool(g.lower_frac >= reject_wick)

    # §7.10 - a REAL prior test: it reached the level and was pushed back.
    test_idx = None
    for i, r in enumerate(rows[:-1]):
        if touches(r) and rejected(r):
            test_idx = i
            break
    if test_idx is None:
        return BreakoutRead(None, NO_PRIOR_TEST)

    # §7.11 - a MEANINGFUL reset: price left the level after the test.
    after = rows[test_idx + 1:]
    reset = any(not touches(r) for r in after)
    if not reset:
        return BreakoutRead(None, NO_RESET, test_idx)

    # §7.12 - a TRUE return attack: it comes back and the trigger attacks with momentum.
    returned = touches(rows[-1]) or touches(trigger)
    if not returned:
        return BreakoutRead(None, NO_RETURN_ATTACK, test_idx)
    if not _momentum(trigger, direction, body_frac, close_loc):
        return BreakoutRead(None, NO_RETURN_ATTACK, test_idx)
    return BreakoutRead(EXCEPTION_REPEAT_TEST, None, test_idx)


def weak_break_continuation(completed: pd.DataFrame, trigger, lo: float, hi: float,
                            direction: str, body_frac: float,
                            close_loc: float) -> BreakoutRead:
    """Route B's BRK15 variant, on FIFTEEN-minute bars. ALGO-020 section 2: not a fifth route.

    The spec: "weak first break -> controlled completed pullback -> forming 15m bar3 may
    trigger when sustained intra15 directional force is proven".

    WEAK IS A REQUIREMENT, NOT A DESCRIPTION. A first break that already carries momentum
    geometry is the NORMAL breakout, and it must be taken through that route with its
    second-5m extension test - not through a variant whose whole premise is that the first
    break was not convincing. Letting a strong break in here would create a second, laxer door
    to the same trade, which is how a route family quietly becomes five.

    `completed` are the completed 15m parents; `trigger` is the forming bar 3. Same split as
    every other route here.
    """
    if completed is None or len(completed) < 2:
        return BreakoutRead(None, NOT_ENOUGH_BARS)

    bar1, bar2 = completed.iloc[-2], completed.iloc[-1]

    if not _beyond(bar1, lo, hi, direction):
        return BreakoutRead(None, NO_COMPLETED_BREAK)
    if _momentum(bar1, direction, body_frac, close_loc):
        return BreakoutRead(None, BREAK_WAS_NOT_WEAK)

    # A CONTROLLED pullback: it retraces from the break close, and it does not give the level
    # back. Those are two separate failures with two separate names.
    if direction == "L":
        pulled = float(bar2.close) < float(bar1.close)
        held = float(bar2.close) >= lo
        resumed = (_momentum(trigger, direction, body_frac, close_loc)
                   and float(trigger.close) > float(bar1.close))
    else:
        pulled = float(bar2.close) > float(bar1.close)
        held = float(bar2.close) <= hi
        resumed = (_momentum(trigger, direction, body_frac, close_loc)
                   and float(trigger.close) < float(bar1.close))

    if not pulled:
        return BreakoutRead(None, NO_CONTROLLED_PULLBACK)
    if not held:
        return BreakoutRead(None, PULLBACK_LOST_THE_LEVEL)
    if not resumed:
        return BreakoutRead(None, NO_15M_CONTINUATION)
    return BreakoutRead(VARIANT_BRK15, None)


__all__ = [
    "BreakoutRead", "DIAGNOSTIC_ONLY", "EXCEPTION_DISPLACEMENT", "EXCEPTION_REPEAT_TEST",
    "FORMS", "FORM_BREAK_RETEST", "FORM_NORMAL_BREAKOUT",
    "FIRST_PRINT_IS_SETUP_ONLY", "NOT_ACCEPTED", "NOT_DISPLACEMENT", "NOT_ENOUGH_BARS",
    "NO_COMPLETED_BREAK", "NO_EXTREME_EXTENSION", "NO_PRIOR_TEST", "NO_RESET", "NO_RETEST",
    "NO_RETURN_ATTACK", "NOT_THE_FOLLOWING_BAR", "PREBREAK_EXCEPTIONS",
    "UNFROZEN_CHOICES", "VARIANT_BRK15", "BREAK_WAS_NOT_WEAK", "NO_CONTROLLED_PULLBACK",
    "PULLBACK_LOST_THE_LEVEL", "NO_15M_CONTINUATION", "weak_break_continuation",
    "THIRD_CANDLE_LOST_CONTROL", "break_retest",
    "is_true_displacement", "normal_breakout", "prebreak_displacement", "prebreak_repeat_test",
]
