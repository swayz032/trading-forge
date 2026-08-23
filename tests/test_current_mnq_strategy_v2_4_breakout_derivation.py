"""Routes B/C/D. Every one of §7's items 6-14 has a test named after the defect it plants.

The refusals are the deliverable here, not the grants. The spec says the first completed
breakout candle is SETUP ONLY, that a second 5m without the first candle's extreme extension is
`WAIT_NO_ENTRY`, and that ordinary momentum is not true displacement. Each of those is a
mutation §7 asks us to kill, so each gets a test that fails if the refusal disappears - and each
route also gets a POSITIVE WITNESS, because a function that always refuses passes every
refusal test.
"""
from __future__ import annotations

import ast
import inspect
import io
import json

import pandas as pd
import pytest

from research import current_mnq_strategy_v2_4_breakout_derivation as B

TZ = "America/New_York"
LO, HI = 100.0, 102.0
BODY, CLOSE_LOC, WICK, RR = 0.62, 0.78, 0.35, 1.25


def bars(rows):
    idx = pd.date_range("2026-04-09 10:00", periods=len(rows), freq="5min", tz=TZ)
    return pd.DataFrame(
        {"open": [r[0] for r in rows], "high": [r[1] for r in rows],
         "low": [r[2] for r in rows], "close": [r[3] for r in rows]}, index=idx)


def row(o, h, lo_, c):
    return bars([(o, h, lo_, c)]).iloc[0]


# ── ROUTE B: normal breakout ────────────────────────────────────────────────────────────
# Resistance at 102. Bar 2 closes beyond it with a 104 high; the trigger must take out 104.
BREAK = [(99, 100, 98, 99.5), (100, 104, 99.8, 103.5)]


def test_the_first_completed_break_candle_NEVER_enters_on_its_own():
    """§7.6. It is setup only: a trigger that fails to extend past it gets nothing."""
    r = B.normal_breakout(bars(BREAK), row(103.5, 103.9, 103.0, 103.8),
                          LO, HI, "L", BODY, CLOSE_LOC)
    assert r.valid is False
    assert r.refusal == B.NO_EXTREME_EXTENSION


def test_second_5m_momentum_without_extreme_extension_is_WAIT():
    """§7.7 - and the spec names this exact case `WAIT_NO_ENTRY`.

    The trigger below is a textbook momentum candle (strong body, close at its high) and is
    still refused, because it never traded above the first print's extreme.
    """
    strong_but_short = row(103.0, 103.95, 102.9, 103.9)
    r = B.normal_breakout(bars(BREAK), strong_but_short, LO, HI, "L", BODY, CLOSE_LOC)
    assert r.refusal == B.NO_EXTREME_EXTENSION, r


def test_extension_without_momentum_is_still_refused():
    """Extension alone is not the trigger - sustained intra5 force is also required."""
    limp = row(103.6, 106.0, 103.5, 103.7)      # takes out 104, then gives it all back
    r = B.normal_breakout(bars(BREAK), limp, LO, HI, "L", BODY, CLOSE_LOC)
    assert r.refusal == B.FIRST_PRINT_IS_SETUP_ONLY, r


def test_a_trigger_that_extends_past_the_first_extreme_with_momentum_GRANTS():
    """POSITIVE WITNESS. Without it, the refusals above prove only that it always refuses."""
    r = B.normal_breakout(bars(BREAK), row(103.6, 106.0, 103.5, 105.8),
                          LO, HI, "L", BODY, CLOSE_LOC)
    assert r.valid is True and r.form == "normal_breakout", r


def test_the_trigger_must_be_the_bar_FOLLOWING_the_first_print():
    """The spec says "the following forming 5m". A later continuation is a different route."""
    later = BREAK + [(103.5, 105, 103.4, 104.8)]
    r = B.normal_breakout(bars(later), row(104.8, 107, 104.7, 106.8),
                          LO, HI, "L", BODY, CLOSE_LOC)
    assert r.refusal == B.NOT_THE_FOLLOWING_BAR, r


def test_no_completed_print_beyond_the_zone_is_no_breakout():
    inside = [(99, 100, 98, 99.5), (99.5, 101.5, 99, 101)]
    r = B.normal_breakout(bars(inside), row(101, 106, 101, 105), LO, HI, "L", BODY, CLOSE_LOC)
    assert r.refusal == B.NO_COMPLETED_BREAK


def test_a_wick_through_the_zone_is_not_a_break():
    """`_beyond` requires a completed CLOSE past the level. A wick through it is not a break."""
    wick_only = [(99, 100, 98, 99.5), (99.5, 104.0, 99.4, 101.0)]
    r = B.normal_breakout(bars(wick_only), row(101, 106, 101, 105),
                          LO, HI, "L", BODY, CLOSE_LOC)
    assert r.refusal == B.NO_COMPLETED_BREAK


def test_short_side_mirrors_the_long_side():
    """Direction is a mirror, never a second implementation."""
    down = [(103, 104, 102.5, 103), (102, 102.2, 98.0, 98.5)]      # closes below 100, low 98
    assert B.normal_breakout(bars(down), row(98.5, 98.8, 98.1, 98.2),
                             LO, HI, "S", BODY, CLOSE_LOC).refusal == B.NO_EXTREME_EXTENSION
    good = B.normal_breakout(bars(down), row(98.4, 98.5, 96.0, 96.2),
                             LO, HI, "S", BODY, CLOSE_LOC)
    assert good.valid is True, good


# ── ROUTE D: break, acceptance, retest ──────────────────────────────────────────────────

ACCEPTED = [(100, 104, 99.8, 103.5),        # closes beyond
            (103.5, 105, 103, 104.5),       # closes beyond again -> ACCEPTED
            (104.5, 105, 101.5, 102.0)]     # returns to the level -> the retest


def test_a_single_transient_close_beyond_is_not_ACCEPTANCE():
    """The spec refuses `break_retest_without_prior_durable_acceptance` by name."""
    one_close = [(100, 104, 99.8, 103.5), (103.5, 104, 101.0, 101.5),
                 (101.5, 102, 100.5, 101.0)]
    r = B.break_retest(bars(one_close), row(102, 106, 102, 105), LO, HI, "L", BODY, CLOSE_LOC)
    assert r.refusal == B.NOT_ACCEPTED, r


def test_acceptance_without_a_retest_is_refused():
    never_back = [(100, 104, 99.8, 103.5), (103.5, 105, 103, 104.5),
                  (104.5, 106, 104.4, 105.5)]
    r = B.break_retest(bars(never_back), row(105, 108, 105, 107.5), LO, HI, "L",
                       BODY, CLOSE_LOC)
    assert r.refusal == B.NO_RETEST, r


def test_a_retest_without_live_force_is_refused():
    r = B.break_retest(bars(ACCEPTED), row(102, 102.4, 101.6, 101.8), LO, HI, "L",
                       BODY, CLOSE_LOC)
    assert r.refusal == B.FIRST_PRINT_IS_SETUP_ONLY, r


def test_accepted_then_retested_with_momentum_GRANTS():
    r = B.break_retest(bars(ACCEPTED), row(102, 106, 102, 105.5), LO, HI, "L",
                       BODY, CLOSE_LOC)
    assert r.valid is True and r.form == "break_retest", r


# ── ROUTE C: exception #1, true displacement into the level ─────────────────────────────

def _seq(third):
    """Three quiet reference bars, then a displacement sequence whose third bar we vary."""
    return [(90, 90.5, 89.5, 90), (90, 90.5, 89.5, 90), (90, 90.5, 89.5, 90),
            (90, 99.0, 89.9, 98.5),          # displacement: momentum AND range expansion
            (98.5, 99.5, 98.0, 99.0),
            third]


def test_ordinary_momentum_is_NOT_displacement():
    """§7.8. A strong candle with no range expansion must not satisfy exception #1."""
    ordinary = [(90, 90.5, 89.5, 90), (90, 90.5, 89.5, 90), (90, 90.5, 89.5, 90),
                (90, 90.6, 89.9, 90.5),      # momentum-shaped, but no expansion
                (90.5, 91, 90.4, 90.9), (91, 101.5, 91, 101.2)]
    r = B.prebreak_displacement(bars(ordinary), row(101, 103, 101, 102.8),
                                LO, HI, "L", BODY, CLOSE_LOC, RR)
    assert r.refusal == B.NOT_DISPLACEMENT, r


def test_a_third_candle_that_reverses_control_kills_the_sequence():
    """§7.9."""
    reversed_third = _seq((99.0, 99.2, 96.0, 96.5))       # bearish: control lost
    r = B.prebreak_displacement(bars(reversed_third), row(96, 103, 96, 102.5),
                                LO, HI, "L", BODY, CLOSE_LOC, RR)
    assert r.refusal == B.THIRD_CANDLE_LOST_CONTROL, r


def test_a_true_displacement_into_the_level_with_a_live_third_candle_GRANTS():
    """POSITIVE WITNESS for exception #1."""
    good = _seq((99.0, 101.8, 98.9, 101.6))
    r = B.prebreak_displacement(bars(good), row(101.6, 104, 101.5, 103.8),
                                LO, HI, "L", BODY, CLOSE_LOC, RR)
    assert r.valid is True and r.form == B.EXCEPTION_DISPLACEMENT, r


def test_is_true_displacement_requires_BOTH_momentum_and_expansion():
    """Each arm of the conjunction is failed on its own, so neither can carry the other."""
    both = row(90, 99.0, 89.9, 98.5)
    assert B.is_true_displacement(both, "L", BODY, CLOSE_LOC, 1.0, RR) is True

    # MOMENTUM, NO EXPANSION - the shape is right, the size is ordinary. This is §7.8.
    momentum_only = row(90, 90.6, 89.9, 90.5)
    assert B.is_true_displacement(momentum_only, "L", BODY, CLOSE_LOC, 1.0, RR) is False
    # ...and it is only the reference range that refuses it: shrink the context and it passes.
    assert B.is_true_displacement(momentum_only, "L", BODY, CLOSE_LOC, 0.2, RR) is True

    # EXPANSION, NO MOMENTUM - a huge range that closes back near its open decides nothing.
    expansion_only = row(90, 99.0, 89.9, 90.4)
    assert B.is_true_displacement(expansion_only, "L", BODY, CLOSE_LOC, 1.0, RR) is False

    # And the same candle against a much larger context is no longer an expansion at all.
    assert B.is_true_displacement(both, "L", BODY, CLOSE_LOC, 50.0, RR) is False


def test_displacement_needs_a_reference_range_and_refuses_without_one():
    """No context = no claim. A zero or missing reference must refuse, never default to yes."""
    both = row(90, 99.0, 89.9, 98.5)
    assert B.is_true_displacement(both, "L", BODY, CLOSE_LOC, 0.0, RR) is False


# ── exception #2: repeat test ───────────────────────────────────────────────────────────
# For a pre-break LONG the level overhead is resistance, so a real prior test is a failed push
# up - an UPPER wick. That is the mirror of the at-support rejection geometry, not a slip.

REPEAT = [(99, 103.0, 98.8, 99.2),       # reaches the level and is pushed back: the TEST
          (99, 99.5, 98.0, 98.5),        # leaves it: the RESET
          (98.5, 99.0, 98.0, 98.8),
          (98.8, 101.5, 98.7, 101.0)]    # comes back: the RETURN


def test_repeat_test_without_a_real_prior_test_is_refused():
    """§7.10."""
    no_test = [(90, 91, 89, 90)] * 3 + [(90, 101.5, 90, 101)]
    r = B.prebreak_repeat_test(bars(no_test), row(101, 104, 101, 103.5),
                               LO, HI, "L", BODY, CLOSE_LOC, WICK)
    assert r.refusal == B.NO_PRIOR_TEST, r


def test_repeat_test_without_a_meaningful_reset_is_refused():
    """§7.11. It tested, and then simply never left the level."""
    no_reset = [(99, 103.0, 98.8, 99.2), (99, 102.5, 99, 100.5),
                (100.5, 102.2, 100, 101.5), (101.5, 102.4, 101, 101.9)]
    # The trigger is a FULL attack, so the missing reset is the only thing refusing. With a
    # limp trigger this test would also pass with the reset requirement deleted.
    r = B.prebreak_repeat_test(bars(no_reset), row(102, 105, 101.9, 104.7),
                               LO, HI, "L", BODY, CLOSE_LOC, WICK)
    assert r.refusal == B.NO_RESET, r


def test_repeat_test_without_a_true_return_attack_is_refused():
    """§7.12. It tested and reset, but the trigger is not an attack."""
    r = B.prebreak_repeat_test(bars(REPEAT), row(101, 101.2, 100.8, 100.9),
                               LO, HI, "L", BODY, CLOSE_LOC, WICK)
    assert r.refusal == B.NO_RETURN_ATTACK, r


def test_a_complete_repeat_test_sequence_GRANTS():
    """POSITIVE WITNESS for exception #2."""
    r = B.prebreak_repeat_test(bars(REPEAT), row(101, 105, 100.9, 104.6),
                               LO, HI, "L", BODY, CLOSE_LOC, WICK)
    assert r.valid is True and r.form == B.EXCEPTION_REPEAT_TEST, r


def test_the_three_repeat_test_requirements_have_SEPARATE_refusals():
    """§7.10-12 are three requirements; one must not borrow another's evidence."""
    assert len({B.NO_PRIOR_TEST, B.NO_RESET, B.NO_RETURN_ATTACK}) == 3


# ── §7.13: there is no third pre-break exception ────────────────────────────────────────

def test_there_are_exactly_two_prebreak_exceptions():
    assert len(B.PREBREAK_EXCEPTIONS) == 2
    assert set(B.PREBREAK_EXCEPTIONS) == {B.EXCEPTION_DISPLACEMENT, B.EXCEPTION_REPEAT_TEST}


def test_the_two_exceptions_match_the_frozen_spec_VERBATIM():
    """Typed constants drift. This joins them to the frozen spec so they cannot."""
    spec = json.load(io.open("research/current_mnq_strategy_v2_4_spec.json", encoding="utf-8"))
    frozen = spec["entry_trigger_semantics"]["prebreak_early_entry_exceptions_only"]
    assert sorted(frozen) == sorted(B.PREBREAK_EXCEPTIONS), (
        f"spec says {sorted(frozen)}, module says {sorted(B.PREBREAK_EXCEPTIONS)}")


# ── §7.14 and BUILD-ONLY ────────────────────────────────────────────────────────────────

def _route_readers():
    """DERIVED from the source: every public function annotated to return a BreakoutRead.

    Hand-typing this list is how a new route slips past the guard - it was four functions
    yesterday and is five today. The population comes from the AST so adding a route without
    the split fails instead of going unchecked.
    """
    tree = ast.parse(io.open(
        "research/current_mnq_strategy_v2_4_breakout_derivation.py", encoding="utf-8").read())
    return [n.name for n in tree.body
            if isinstance(n, ast.FunctionDef) and not n.name.startswith("_")
            and isinstance(n.returns, ast.Name) and n.returns.id == "BreakoutRead"]


def test_the_derived_population_is_not_empty_and_covers_every_route():
    """A derived population that silently comes back empty passes every test over it."""
    names = _route_readers()
    assert len(names) >= 5, names
    for expected in ("normal_breakout", "break_retest", "prebreak_displacement",
                     "prebreak_repeat_test", "weak_break_continuation"):
        assert expected in names, f"{expected} is not in the derived population: {names}"


def test_no_function_can_see_the_triggers_finished_form():
    """§7.14, structurally: every route takes COMPLETED bars plus a separate live trigger.

    A function that never receives the parent's final OHLC cannot backdate an entry with it.
    """
    for name in _route_readers():
        params = list(inspect.signature(getattr(B, name)).parameters)
        assert params[0] == "completed" and params[1] == "trigger", (name, params)


# ── ROUTE B's BRK15 VARIANT: weak break, controlled pullback, 15m bar 3 ─────────────────
# 15m parents. bar1 closes beyond 102 but is WEAK (no momentum geometry); bar2 pulls back
# without giving the level up; the trigger is the forming bar 3.

WEAK_BREAK = [(101, 104.5, 100.8, 102.6), (102.6, 103.0, 101.2, 101.5)]


def test_the_BRK15_variant_GRANTS_on_a_weak_break_pullback_and_resumption():
    """POSITIVE WITNESS for the variant."""
    r = B.weak_break_continuation(bars(WEAK_BREAK), row(101.5, 106, 101.4, 105.6),
                                  LO, HI, "L", BODY, CLOSE_LOC)
    assert r.valid is True and r.form == B.VARIANT_BRK15, r


def test_a_STRONG_first_break_is_refused_by_the_variant():
    """The premise of the variant is that the first break was NOT convincing.

    Letting a momentum break in here would open a second, laxer door to the same trade -
    which is how a closed family of four routes quietly becomes five.
    """
    strong = [(101, 104.5, 100.8, 104.3), (104.3, 104.5, 102.5, 102.8)]
    r = B.weak_break_continuation(bars(strong), row(102.8, 108, 102.7, 107.6),
                                  LO, HI, "L", BODY, CLOSE_LOC)
    assert r.refusal == B.BREAK_WAS_NOT_WEAK, r


def test_no_pullback_means_no_continuation_setup():
    no_pull = [(101, 104.5, 100.8, 102.6), (102.6, 104.0, 102.5, 103.2)]
    r = B.weak_break_continuation(bars(no_pull), row(103.2, 106, 103.1, 105.6),
                                  LO, HI, "L", BODY, CLOSE_LOC)
    assert r.refusal == B.NO_CONTROLLED_PULLBACK, r


def test_a_pullback_that_gives_the_level_back_is_a_FAILED_break_not_a_setup():
    lost = [(101, 104.5, 100.8, 102.6), (102.6, 103.0, 98.0, 98.5)]
    r = B.weak_break_continuation(bars(lost), row(98.5, 106, 98.4, 105.6),
                                  LO, HI, "L", BODY, CLOSE_LOC)
    assert r.refusal == B.PULLBACK_LOST_THE_LEVEL, r


def test_bar3_must_resume_BEYOND_the_first_break_close():
    """Momentum alone is not resumption - it must take out where the break closed."""
    short_of_it = row(101.5, 102.5, 101.4, 102.4)      # strong, but never exceeds 102.6
    r = B.weak_break_continuation(bars(WEAK_BREAK), short_of_it, LO, HI, "L", BODY, CLOSE_LOC)
    assert r.refusal == B.NO_15M_CONTINUATION, r


def test_bar3_without_momentum_is_refused_even_if_it_exceeds_the_break_close():
    limp = row(101.5, 106.0, 101.4, 102.7)             # exceeds 102.6, but gives it all back
    r = B.weak_break_continuation(bars(WEAK_BREAK), limp, LO, HI, "L", BODY, CLOSE_LOC)
    assert r.refusal == B.NO_15M_CONTINUATION, r


def test_the_variant_mirrors_on_the_short_side():
    down = [(99, 99.2, 95.5, 97.4), (97.4, 98.8, 97.0, 98.5)]
    r = B.weak_break_continuation(bars(down), row(98.5, 98.6, 94.0, 94.4),
                                  LO, HI, "S", BODY, CLOSE_LOC)
    assert r.valid is True and r.form == B.VARIANT_BRK15, r


def test_the_variant_is_not_a_fifth_prebreak_exception():
    assert B.VARIANT_BRK15 not in B.PREBREAK_EXCEPTIONS


def test_it_is_not_wired_into_production():
    for mod in ("current_mnq_strategy_v2_4_kernel", "current_mnq_strategy_v2_4_entries",
                "current_mnq_strategy_v2_4_engine", "current_mnq_strategy_v2_4_signal"):
        tree = ast.parse(io.open(f"research/{mod}.py", encoding="utf-8").read())
        for n in ast.walk(tree):
            names = []
            if isinstance(n, ast.ImportFrom):
                names = [n.module or ""]
            elif isinstance(n, ast.Import):
                names = [a.name for a in n.names]
            assert not any("breakout_derivation" in m for m in names), mod


def test_it_declares_itself_build_only():
    assert "BUILD_ONLY" in B.DIAGNOSTIC_ONLY


@pytest.mark.parametrize("refusal", [
    B.NO_COMPLETED_BREAK, B.NO_EXTREME_EXTENSION, B.NOT_THE_FOLLOWING_BAR, B.NOT_ACCEPTED,
    B.NO_RETEST, B.NOT_DISPLACEMENT, B.THIRD_CANDLE_LOST_CONTROL, B.NO_PRIOR_TEST,
    B.NO_RESET, B.NO_RETURN_ATTACK, B.FIRST_PRINT_IS_SETUP_ONLY, B.NOT_ENOUGH_BARS,
])
def test_every_refusal_names_itself(refusal):
    assert isinstance(refusal, str) and refusal.isupper() and len(refusal) > 10


# -- frozen vs derived, kept separate ---------------------------------------------------

def test_the_frozen_range_ratio_is_never_invented_by_this_module():
    """It lives in Params. A default here that matches it today is luck, and luck rots."""
    import research.current_mnq_strategy_v2_4_entry_authority as EA
    for fn in (B.is_true_displacement, B.prebreak_displacement):
        sig = inspect.signature(fn).parameters["range_ratio"]
        assert sig.default is inspect.Parameter.empty, f"{fn.__name__} defaults range_ratio"
    with pytest.raises(ValueError, match="RANGE_RATIO_NOT_SUPPLIED"):
        EA.decide(bars(_seq((99.0, 101.8, 98.9, 101.6)) + [(101.6, 104, 101.5, 103.8)]),
                  "L", LO, HI, location_authorized=True, force_confirmed=True,
                  body_frac=BODY, close_loc=CLOSE_LOC, reject_wick=WICK,
                  route=EA.ROUTE_C_PREBREAK_DISPLACEMENT)


def test_the_unfrozen_choice_is_declared_rather_than_buried_in_a_default():
    """`acceptance_bars` is this module's reading of 'durable', not a value from the spec."""
    assert "acceptance_bars" in B.UNFROZEN_CHOICES
    assert "not a frozen value" in B.UNFROZEN_CHOICES["acceptance_bars"]
    default = inspect.signature(B.break_retest).parameters["acceptance_bars"].default
    assert default == 2, "the declared choice and the actual default must be the same number"


def test_the_spec_really_does_not_fix_an_acceptance_bar_COUNT():
    """The declaration above must be TRUE, not merely convenient."""
    raw = io.open("research/current_mnq_strategy_v2_4_spec.json", encoding="utf-8").read()
    assert "durable" in raw, "the spec does require durability"
    assert "acceptance_bars" not in raw, "if the spec ever fixes a count, stop deriving one"
