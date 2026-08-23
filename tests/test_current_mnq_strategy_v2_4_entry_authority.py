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

from research import current_mnq_strategy_v2_4_entry_authority as EA

TZ = "America/New_York"
LO, HI = 100.0, 102.0
BODY, CLOSE_LOC, WICK = 0.62, 0.78, 0.35


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


@pytest.mark.parametrize("route", list(EA.ROUTES))
def test_each_declared_route_is_accepted(route):
    r = EA.decide(bars(CLEAN_LONG), "L", LO, HI, location_authorized=True,
                  force_confirmed=True, body_frac=BODY, close_loc=CLOSE_LOC,
                  reject_wick=WICK, route=route)
    assert r.route == route


# --- it is BUILD ONLY, and it re-implements no gate ---------------------------------------

def test_it_is_not_wired_into_production():
    for mod in ("current_mnq_strategy_v2_4_kernel", "current_mnq_strategy_v2_4_entries",
                "current_mnq_strategy_v2_4_engine", "current_mnq_strategy_v2_4_signal"):
        tree = ast.parse(io.open(f"research/{mod}.py", encoding="utf-8").read())
        for n in ast.walk(tree):
            mods = []
            if isinstance(n, ast.ImportFrom):
                mods = [n.module or ""]
            elif isinstance(n, ast.Import):
                mods = [a.name for a in n.names]
            assert not any("entry_authority" in m for m in mods), (
                f"{mod} imports the state machine - acceptance is gated on the grade")


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
