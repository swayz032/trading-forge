"""Guards for the entry-zone census and the R-C re-spec report (ALGO-090).

TWO OF MY OWN ERRORS ARE PINNED HERE, both caught by the artifact contradicting itself:

  1. The census first tagged every non-control decided day "convicted", sweeping in 04-02 - a
     NO_TRADE decline day that was never convicted of anything - into a table about early
     entries.
  2. `defining_rejection` searched ALL history, so it returned candles OLDER than the zone they
     supposedly draw. That produced the impossible row "7 tests since the definer, 1 test since
     birth" on the control. A zone is not drawn by a candle that existed before it did.

The second one mattered: with the definer anchored to birth, `drawable_under_his_rule` flips on
four rows INCLUDING the control, and that is what closes the freshness lane. An unanchored
search would have reported a definer for the control and kept the lane open on a fiction.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

import pandas as pd
import pytest

CENSUS = Path("research/current_mnq_strategy_v2_4_entry_zone_census_2026_08_24.json")
RESPEC = Path("research/current_mnq_strategy_v2_4_rc_respec_report_2026_08_24.json")

CONVICTED = ("2026-03-23", "2026-03-24", "2026-03-31", "2026-04-06", "2026-04-09")


def _load(p):
    if not p.exists():
        pytest.skip(f"{p} not produced yet")
    return json.load(io.open(p, encoding="utf-8"))


@pytest.fixture(scope="module")
def census():
    return _load(CENSUS)


@pytest.fixture(scope="module")
def respec():
    return _load(RESPEC)


# ---- census -----------------------------------------------------------------------------

def test_the_census_proposes_no_predicate_and_scores_no_row(census):
    """ALGO-090 asked for a table, not a cut. If this flips, the artifact changed job."""
    assert census["no_predicate_proposed"] is True
    assert census["no_row_scored"] is True


def test_0402_is_not_tagged_convicted(census):
    """Defect 1. 04-02 is a NO_TRADE decline day."""
    r = next((x for x in census["rows"] if x["session"] == "2026-04-02"
              and x["row_type"] != "his_labelled_zone"), None)
    if r is not None:
        assert r["row_type"] != "convicted_early_zone"


def test_only_the_five_convicted_sessions_carry_the_convicted_tag(census):
    tagged = {r["session"] for r in census["rows"]
              if r["row_type"] == "convicted_early_zone"}
    assert tagged <= set(CONVICTED), tagged


def test_no_defining_rejection_predates_the_zone_it_draws(census):
    """Defect 2, pinned structurally: a definer must be at or after the zone's birth."""
    for r in census["rows"]:
        d = r.get("defining_rejection")
        if d and r.get("birth"):
            assert pd.Timestamp(d["bucket"]) >= pd.Timestamp(r["birth"]), r["session"]


def test_tests_since_definer_never_exceeds_tests_since_birth(census):
    """The arithmetic that exposed the bug: a later anchor cannot count MORE tests."""
    for r in census["rows"]:
        a, b = r.get("completed_tests_since_DEFINING_REJECTION"), r["completed_tests_since_BIRTH"]
        if a is not None and b is not None:
            assert a <= b, (r["session"], a, b)


def test_the_control_row_is_present_and_singular(census):
    ctrl = [r for r in census["rows"] if r["row_type"] == "CONTROL_zone"]
    assert len(ctrl) == 1 and ctrl[0]["session"] == "2026-04-14"


# ---- re-spec ----------------------------------------------------------------------------

def test_the_respec_closes_the_lane_because_the_control_is_undefined(respec):
    """The pre-registered outcome: control survives, or the lane is closed as unexpressible."""
    assert respec["control_has_no_definer"] is True
    assert respec["LANE_VERDICT"] == "CLOSED_AS_UNEXPRESSIBLE"


def test_undefined_is_reported_separately_from_refused(respec):
    """Conflating 'cannot be evaluated' with 'evaluated and passed' would hide the closure."""
    kinds = {r["disposition"] for r in respec["rows"]}
    assert "UNDEFINED_NO_DEFINING_REJECTION" in kinds
    assert respec["counts"]["undefined_no_definer"] >= 1


def test_the_respec_changes_nothing_in_the_target_layer(respec):
    assert respec["no_target_layer_change"] is True


def test_taught_exceptions_are_still_not_narrowed(respec):
    """The honest ceiling depends on these staying as taught."""
    exempt = {r["story"] for r in respec["rows"]
              if r["disposition"] == "EXEMPT_TAUGHT_STORY"}
    assert "ACCEPTED_BREAK_RETEST_THEN_INTRA5_FORCE" in exempt
    assert "PREBREAK_REPEAT_TEST_INTRA5_FORCE" in exempt
