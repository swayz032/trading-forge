"""The state machine must WAIT by default and stop at the EARLIEST unmet requirement.

ALGO-029 item 1. The measured defect this kills is that the bot takes a trade in 14 of 14
sessions and never genuinely declines — an entry decision that is a constant carries no
information. So the tests that matter are: does it refuse, does it refuse for the RIGHT reason,
and can it be walked forward one proven step at a time.
"""
from __future__ import annotations

import ast
import inspect
import io

import pandas as pd
import pytest

from research import current_mnq_strategy_v2_4_breakout_derivation as brk
from research import current_mnq_strategy_v2_4_entry_authority as EA
from research.current_mnq_strategy_v2_4_engine import Params

TZ = "America/New_York"
LO, HI = 100.0, 102.0
BODY, CLOSE_LOC, WICK = 0.62, 0.78, 0.35
#: Read from Params, never typed. The state machine refuses to invent this one, and a test
#: that typed its own copy would quietly stop tracking the frozen value.
RR = float(Params().range_ratio)


def bars(rows):
    idx = pd.date_range("2026-04-09 10:00", periods=len(rows), freq="5min", tz=TZ)
    return pd.DataFrame(
        {"open": [r[0] for r in rows], "high": [r[1] for r in rows],
         "low": [r[2] for r in rows], "close": [r[3] for r in rows]}, index=idx)


# The taught shape (ALGO-033): rejection COMPLETES on bar 2, the trigger follows on bar 3.
CLEAN_LONG = [(112, 113, 111, 112), (111, 112, 103, 104),
              (103.5, 110.0, 100.0, 109.7), (109.7, 111.0, 109.5, 110.5)]
NEVER_TOUCHED = [(120, 121, 119, 120), (119, 120, 118, 119),
                 (118, 119, 117, 118), (117, 118, 116, 117)]
# The conflict is planted on the COMPLETED rejection bar, where the story is read.
CONFLICTED = CLEAN_LONG[:2] + [(105, 110.0, 100.0, 105.2)] + CLEAN_LONG[-1:]


def _decide(rows, *, location=True, force=True, direction="L"):
    return EA.decide(bars(rows), direction, LO, HI,
                     location_authorized=location, force_confirmed=force,
                     body_frac=BODY, close_loc=CLOSE_LOC, reject_wick=WICK)


# --- the machine can be walked forward, one step at a time -------------------------------

def test_everything_proven_GRANTS():
    """POSITIVE WITNESS. Without it every refusal below proves only that it always refuses."""
    a = _decide(CLEAN_LONG)
    assert a.granted is True
    assert a.state == EA.GRANTED
    assert a.route == EA.ROUTE_A_REJECTION
    assert a.force_confirmed is True
    assert "ENTER via" in a.explain()


def test_no_authorized_location_stops_at_step_one():
    a = _decide(CLEAN_LONG, location=False)
    assert a.granted is False
    assert a.state == EA.WAIT_NO_LOCATION
    assert a.story is None, "it must not even look at the story without a location"


def test_no_interaction_stops_before_the_story():
    a = _decide(NEVER_TOUCHED)
    assert a.state == EA.WAIT_NO_INTERACTION
    assert a.granted is False


def test_an_incomplete_story_stops_before_force():
    a = _decide(CONFLICTED)
    assert a.state == EA.WAIT_NO_STORY
    assert a.granted is False
    assert a.reason, "it must name which story rule refused"


def test_force_is_the_last_gate_and_it_can_refuse_a_perfect_story():
    """Everything else proven, force not — still WAIT. This is step 6 of the hard order."""
    a = _decide(CLEAN_LONG, force=False)
    assert a.state == EA.WAIT_NO_FORCE
    assert a.granted is False
    assert a.story.complete is True, "the story WAS complete; force is what refused"


def test_the_machine_stops_at_the_EARLIEST_unmet_requirement():
    """With location AND interaction AND force all missing, it must blame the location.

    A machine that reports the last thing it checked sends the reader to the wrong place.
    """
    a = _decide(NEVER_TOUCHED, location=False, force=False)
    assert a.state == EA.WAIT_NO_LOCATION
    assert EA.blocking_step(a) == 0


def test_blocking_step_increases_as_evidence_accumulates():
    """The whole point of a state machine: progress is visible and ordered."""
    steps = [
        EA.blocking_step(_decide(CLEAN_LONG, location=False)),
        EA.blocking_step(_decide(NEVER_TOUCHED)),
        EA.blocking_step(_decide(CONFLICTED)),
        EA.blocking_step(_decide(CLEAN_LONG, force=False)),
        EA.blocking_step(_decide(CLEAN_LONG)),
    ]
    assert steps == sorted(steps), steps
    assert steps == [0, 1, 2, 3, 4], steps


# --- WAIT is the default ------------------------------------------------------------------

def test_wait_is_the_default_not_the_exception():
    """Four of the five reachable states are WAIT, and only one path reaches GRANTED."""
    assert EA.STATE_ORDER[-1] == EA.GRANTED
    assert sum(1 for s in EA.STATE_ORDER if s.startswith("WAIT")) == 4


def test_every_refusal_is_legible_to_a_non_coder():
    """The operator and GPT read these after the 27th."""
    for rows, kw in ((CLEAN_LONG, {"location": False}), (NEVER_TOUCHED, {}),
                     (CONFLICTED, {}), (CLEAN_LONG, {"force": False})):
        a = _decide(rows, **kw)
        line = a.explain()
        assert line.startswith("WAIT"), line
        assert len(line) > 12, line


# --- the four routes are closed -----------------------------------------------------------

def test_there_are_exactly_four_routes():
    assert len(EA.ROUTES) == 4
    assert len(set(EA.ROUTES)) == 4


def test_a_fifth_route_is_refused_loudly():
    """ALGO-009 section 3. Adding one is a semantic change needing its own ruling."""
    with pytest.raises(ValueError, match="NO_FIFTH_ROUTE"):
        EA.decide(bars(CLEAN_LONG), "L", LO, HI, location_authorized=True,
                  force_confirmed=True, body_frac=BODY, close_loc=CLOSE_LOC,
                  reject_wick=WICK, route="E_SOMETHING_NEW")


# --- each route is judged on ITS OWN evidence ---------------------------------------------
# The previous version of this block fed the REJECTION fixture to all four routes and asserted
# each one granted. It passed only because `decide` ignored `route` and ran the rejection story
# whatever it was asked for - a breakout accepted on rejection evidence. The green was an
# artifact of the defect, so the test is replaced rather than adjusted.

# Resistance at 102: a completed print beyond it (high 104), then a trigger that takes out 104.
ROUTE_B_BARS = [(99, 100, 98, 99.5), (100, 104, 99.8, 103.5), (103.6, 106, 103.5, 105.8)]
# Quiet context, a displacement candle, then a third that still holds control INTO the level.
ROUTE_C_BARS = [(90, 90.5, 89.5, 90), (90, 90.5, 89.5, 90), (90, 90.5, 89.5, 90),
                (90, 99.0, 89.9, 98.5), (98.5, 99.5, 98.0, 99.0), (99.0, 101.8, 98.9, 101.6),
                (101.6, 104, 101.5, 103.8)]
# Broken, ACCEPTED over the required run of completed closes, then retested and attacked.
# The run length is READ FROM THE CODE, not typed: this fixture was written when "durable"
# meant 2 closes and it broke the moment the pre-registered sensitivity rule landed 3. What it
# tests - acceptance, retest, attack - never depended on the number.
ACCEPT_N = inspect.signature(brk.break_retest).parameters["acceptance_bars"].default
ROUTE_D_BARS = ([(100 + i, 104 + i, 99.8 + i, 103.5 + i) for i in range(ACCEPT_N)]
                + [(103.5 + ACCEPT_N, 105 + ACCEPT_N, 101.5, 102.0),
                   (102, 106, 102, 105.5)])

ROUTE_EVIDENCE = {
    EA.ROUTE_A_REJECTION: CLEAN_LONG,
    EA.ROUTE_B_BREAKOUT: ROUTE_B_BARS,
    EA.ROUTE_C_PREBREAK_DISPLACEMENT: ROUTE_C_BARS,
    EA.ROUTE_D_PREBREAK_RETEST: ROUTE_D_BARS,
}


def _route(rows, route, *, location=True, force=True, direction="L", variant=None):
    return EA.decide(bars(rows), direction, LO, HI, location_authorized=location,
                     force_confirmed=force, body_frac=BODY, close_loc=CLOSE_LOC,
                     reject_wick=WICK, route=route, range_ratio=RR, variant=variant)


@pytest.mark.parametrize("route", list(EA.ROUTES))
def test_every_declared_route_is_a_legal_name(route):
    """It must not raise NO_FIFTH_ROUTE for any of the four."""
    assert _route(ROUTE_EVIDENCE[route], route) is not None


@pytest.mark.parametrize("route", list(EA.ROUTES))
def test_each_route_GRANTS_on_its_own_evidence(route):
    """POSITIVE WITNESS per route. Four separate ones, because they are four separate reads."""
    a = _route(ROUTE_EVIDENCE[route], route)
    assert a.granted is True, a
    assert a.route == route
    assert "ENTER via" in a.explain()


#: The ONE off-diagonal grant in the matrix below, and it is not a defect. The Route C fixture
#: displaces up into the zone, closes back INSIDE it, then reclaims - which is a genuine
#: `failed_breakout_back_inside_with_control` rejection as well as a displacement sequence.
#: Real price action can satisfy two routes at once; which one the kernel would rank is a
#: separate question from whether each read is correct. It is pinned so that a SECOND overlap
#: appearing later fails this test instead of passing quietly.
KNOWN_OVERLAPS = frozenset({
    (EA.ROUTE_A_REJECTION, EA.ROUTE_C_PREBREAK_DISPLACEMENT),
})


def _grant_matrix():
    """MEASURED, not typed. route -> evidence -> granted."""
    return {r: {e: _route(rows, r).granted for e, rows in ROUTE_EVIDENCE.items()}
            for r in EA.ROUTES}


def test_the_route_by_evidence_matrix_is_the_diagonal_plus_named_overlaps():
    """The wrong-route class: rejection evidence must not buy a breakout, or the reverse."""
    m = _grant_matrix()
    unexpected = [(r, e) for r in m for e in m[r]
                  if m[r][e] and r != e and (r, e) not in KNOWN_OVERLAPS]
    assert not unexpected, f"routes granted on foreign evidence: {unexpected}"


def test_every_pinned_overlap_is_REAL_and_none_has_gone_stale():
    """A pinned exception that no longer fires is a licence nobody is using - delete it."""
    m = _grant_matrix()
    stale = [(r, e) for (r, e) in KNOWN_OVERLAPS if not m[r][e]]
    assert not stale, f"pinned overlaps that no longer occur: {stale}"


def test_the_three_breakout_routes_refuse_PURE_rejection_evidence():
    """Stated as its own claim, because it is the direction that matters most.

    CLEAN_LONG never breaks the zone at all, so nothing about it can read as a breakout.
    """
    for route in (EA.ROUTE_B_BREAKOUT, EA.ROUTE_C_PREBREAK_DISPLACEMENT,
                  EA.ROUTE_D_PREBREAK_RETEST):
        a = _route(CLEAN_LONG, route)
        assert a.granted is False, f"{route} granted on a pure rejection: {a.explain()}"


def test_route_A_refuses_a_clean_breakout_with_no_rejection():
    a = _route(ROUTE_B_BARS, EA.ROUTE_A_REJECTION)
    assert a.granted is False, a.explain()


def test_a_route_D_refusal_names_BOTH_of_its_forms():
    """Either form satisfies D, so a refusal that names one sends the reader to half of it."""
    a = _route(NEVER_TOUCHED, EA.ROUTE_D_PREBREAK_RETEST)
    assert a.granted is False
    assert EA.NEITHER_D_FORM in a.reason
    assert "accepted_break=" in a.reason and "repeat_test=" in a.reason


def test_the_breakout_routes_carry_a_form_instead_of_a_rejection_story():
    a = _route(ROUTE_B_BARS, EA.ROUTE_B_BREAKOUT)
    assert a.story is None, "there is no rejection story on a breakout"
    assert a.form == "normal_breakout"


# 15m parents: a WEAK completed break beyond 102, a controlled pullback, then forming bar 3.
BRK15_BARS = [(101, 104.5, 100.8, 102.6), (102.6, 103.0, 101.2, 101.5),
              (101.5, 106, 101.4, 105.6)]


def test_the_BRK15_variant_is_reached_through_route_B_and_GRANTS():
    """It is derived now, so it is exercised rather than merely declared unbuilt."""
    a = _route(BRK15_BARS, EA.ROUTE_B_BREAKOUT, variant=EA.VARIANT_BRK15)
    assert a.granted is True, a.explain()
    assert a.route == EA.ROUTE_B_BREAKOUT, "the variant does not get a route of its own"
    assert a.form == EA.VARIANT_BRK15


def test_nothing_is_deferred_any_more_but_the_list_still_EXISTS():
    """An empty list a test still checks beats a list that vanished with what it tracked."""
    assert EA.NOT_DERIVED_HERE == ()
    assert EA.VARIANT_BRK15 not in EA.ROUTES, "it is a variant of B, never a fifth route"
    assert len(EA.ROUTES) == 4, "ALGO-009 section 3: four families and no fifth"


def test_the_variant_cannot_be_smuggled_in_under_another_route():
    """A fifth permission path wearing a variant's name is still a fifth permission path."""
    for route in (EA.ROUTE_A_REJECTION, EA.ROUTE_C_PREBREAK_DISPLACEMENT,
                  EA.ROUTE_D_PREBREAK_RETEST):
        with pytest.raises(ValueError, match="VARIANT_BELONGS_TO_ANOTHER_ROUTE"):
            _route(BRK15_BARS, route, variant=EA.VARIANT_BRK15)


def test_an_unknown_variant_is_refused_outright():
    with pytest.raises(ValueError, match="UNKNOWN_VARIANT"):
        _route(BRK15_BARS, EA.ROUTE_B_BREAKOUT, variant="BRK30_INVENTED_HERE")


def test_route_B_without_the_variant_still_runs_the_NORMAL_breakout():
    """The variant must be opt-in; a weak break must not sneak through the normal route."""
    a = _route(BRK15_BARS, EA.ROUTE_B_BREAKOUT)
    assert a.form != EA.VARIANT_BRK15


@pytest.mark.parametrize("route", list(EA.ROUTES))
def test_force_is_required_on_EVERY_route(route):
    """No route may buy its way past step 6."""
    a = _route(ROUTE_EVIDENCE[route], route, force=False)
    assert a.state == EA.WAIT_NO_FORCE, a
    assert a.granted is False


@pytest.mark.parametrize("route", list(EA.ROUTES))
def test_location_is_required_on_EVERY_route(route):
    a = _route(ROUTE_EVIDENCE[route], route, location=False)
    assert a.state == EA.WAIT_NO_LOCATION, a


# --- it IS the kernel's entry authority, and it re-implements no gate -----------------------

def _imported_modules(mod: str) -> list[str]:
    """Every module token an import mentions — the package AND the names it pulls from it.

    `from research import current_mnq_strategy_v2_4_entry_authority as auth` puts the module
    being imported in `names`, not in `.module`; a walker that reads only `.module` sees the
    string "research" and reports the wiring as absent. That is exactly how this helper first
    went red against a kernel that does import the machine.
    """
    tree = ast.parse(io.open(f"research/{mod}.py", encoding="utf-8").read())
    out: list[str] = []
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom):
            out.append(n.module or "")
            out.extend(f"{n.module or ''}.{a.name}" for a in n.names)
        elif isinstance(n, ast.Import):
            out.extend(a.name for a in n.names)
    return out


def test_the_kernel_asks_this_machine_for_entry_authority():
    """ALGO-047 discharged §9.2 and ORDERED the wiring. This pins that it happened.

    The predecessor of this test asserted the opposite - that the kernel must NOT import the
    machine - and it was correct until the gate opened. It is re-anchored rather than patched:
    the property worth pinning is that the machine is the authority, and the way that regresses
    is silently, by someone restoring the hand-rolled predicates during a merge.
    """
    assert any("entry_authority" in m for m in _imported_modules(
        "current_mnq_strategy_v2_4_kernel")), (
        "the kernel no longer imports the state machine - ALGO-047 ordered it wired in as the "
        "entry authority")


def test_the_kernel_no_longer_carries_its_own_copy_of_the_reads():
    """The old predicates are the laxer second door. Importing them again re-opens it.

    Named individually rather than by prefix: `breakout_failed` and `weak_first_break_print` are
    still legitimately the kernel's (invalidation, and ARMING the pending state - neither is an
    entry grant), so a blanket ban on the module would be wrong and a blanket allow would miss
    the four that matter.
    """
    src = io.open("research/current_mnq_strategy_v2_4_kernel.py", encoding="utf-8").read()
    tree = ast.parse(src)
    imported_names = {a.name for n in ast.walk(tree)
                      if isinstance(n, ast.ImportFrom) for a in n.names}
    for gone in ("reversal_story_v24", "displacement_sequence_prebreak",
                 "repeat_test_momentum_prebreak", "breakout_followthrough_after_first_print"):
        assert gone not in imported_names, (
            f"the kernel imports {gone} again - the state machine is meant to be the single "
            "entry authority, and a second read of the same rule is how they drift apart")


def test_the_diagnostics_still_do_not_leak_into_production():
    """The X-ray mirrors the kernel; it may never become an input to it."""
    for mod in ("current_mnq_strategy_v2_4_kernel", "current_mnq_strategy_v2_4_entries",
                "current_mnq_strategy_v2_4_engine", "current_mnq_strategy_v2_4_signal"):
        for m in _imported_modules(mod):
            assert "candidate_xray" not in m, f"{mod} imports the diagnostic X-ray"


def test_it_does_not_reimplement_the_location_or_force_gates():
    """Re-implementing a gate is how the X-ray came to diverge from the kernel.

    Both arrive as arguments from the already-graded gates instead.
    """
    src = inspect.getsource(EA)
    tree = ast.parse(src)
    called = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Call):
            nm = getattr(n.func, "id", None) or getattr(n.func, "attr", None)
            if nm:
                called.add(nm)
    for banned in ("force_snapshot", "build_entry_locations_v24", "momentum_bar"):
        assert banned not in called, f"it re-implements/calls {banned} instead of taking it in"
    sig = inspect.signature(EA.decide).parameters
    assert "location_authorized" in sig and "force_confirmed" in sig


def test_it_declares_itself_build_only():
    assert "BUILD_ONLY" in EA.DIAGNOSTIC_ONLY and "grade passes" in EA.DIAGNOSTIC_ONLY
