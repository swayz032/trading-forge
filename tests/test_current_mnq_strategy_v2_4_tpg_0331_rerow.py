"""Guards for the 03-31 T/P/G re-row.

THE FIRST VERSION OF THIS MODULE SELECTED THE WRONG ZONE. It filtered on "has refusals", which
matched every record in the session, then took `sorted(bands)[0]` - the LOWEST band, 478 points
below his line. Every number downstream changed silently and the sensitivity row inverted: it
reported NO_VALID_RETEST at all three acceptance values instead of the real answer. Nothing was
red, because nothing asserted WHICH object had been measured.

So the first two tests here are about the OBJECT, not the conclusion. `covers_his_line` is the
property the selector must have; `is_not_merely_the_lowest_band` attacks the specific shape of
the bug, and would have failed against the broken version while `covers_his_line` alone might
not have if his line had happened to sit low in the session.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

import pytest

ART = Path("research/current_mnq_strategy_v2_4_tpg_0331_rerow_2026_08_23.json")


@pytest.fixture(scope="module")
def art():
    if not ART.exists():
        pytest.skip(f"{ART} not produced yet")
    return json.load(io.open(ART, encoding="utf-8"))


HIS_LINE = 23436.625


def test_the_selected_band_COVERS_his_line(art):
    lo, hi = art["band_used_by_the_matching_candidates"]
    assert lo <= HIS_LINE <= hi, (
        f"the row was written about a band that does not contain his line: {lo}-{hi}")


def test_the_selected_band_is_not_merely_the_LOWEST_band_in_the_session(art):
    """The exact shape of the bug: sorted(bands)[0] on a session-wide collection."""
    lo, _ = art["band_used_by_the_matching_candidates"]
    assert lo > 23000, (
        "the band looks like the session's lowest, not the one carrying his line - this is the "
        "sorted()[0] selector bug returning")


def test_exactly_the_three_matching_candidates_were_measured(art):
    assert art["matching_candidate_count"] == 3, (
        "R1b made 3 candidates reachable; a different count means the selector widened again")


def test_the_taught_accepted_break_retest_is_REACHED_and_refuses_on_acceptance_bars(art):
    row = next(r for r in art["T_and_P_by_taught_form"]
               if r["taught_form"] == "ROUTE_D_break_retest")
    assert row["valid"] is False
    assert row["refusal"] == "BREAK_NOT_ACCEPTED_BEFORE_RETEST"
    assert row["that_quantity_is_TAUGHT"] is False, (
        "the whole verdict turns on this quantity being UNFROZEN; if it is taught, the verdict "
        "is MACHINE_CORRECT and the repair question never arises")


def test_the_sensitivity_shows_acceptance_bars_is_the_SOLE_blocker(art):
    """1 and 2 admit the taught form; 3 refuses it. Anything else and the diagnosis is wrong."""
    sens = {r["acceptance_bars"]: r["valid"] for r in
            art["acceptance_bars_sensitivity_at_his_trigger"]}
    assert sens == {1: True, 2: True, 3: False}, f"sensitivity changed shape: {sens}"


def test_route_B_refuses_on_a_TAUGHT_structure_not_a_magnitude(art):
    row = next(r for r in art["T_and_P_by_taught_form"]
               if r["taught_form"] == "ROUTE_B_normal_breakout")
    assert row["refusal"] == "NORMAL_BREAKOUT_TRIGGER_MUST_BE_THE_BAR_FOLLOWING_THE_FIRST_PRINT"
    assert row["that_quantity_is_TAUGHT"] is True


def test_every_refusal_emitted_has_a_PROVENANCE_entry(art):
    """An `unmapped` refusal is a silent hole: the verdict counts it as neither taught nor not."""
    unmapped = [r["taught_form"] for r in art["T_and_P_by_taught_form"]
                if r["refusal"] and r["that_quantity_is_TAUGHT"] is None]
    assert not unmapped, f"refusals with no provenance: {unmapped}"


def test_BOTH_readings_are_published_not_just_the_convenient_one(art):
    """The literal rule and the per-form rule disagree here, and hiding either would be a lie."""
    assert art["verdict_under_the_LITERAL_ALGO_067_rule"] == "MACHINE_CORRECT_PER_TEACHING"
    assert art["verdict_PER_FORM"] == "PREDICATE_MISSPECIFIED"
    assert art["why_the_two_readings_differ"]


def test_the_module_does_not_land_the_repair(art):
    assert "will\nnot move it" in art["repair_is_NOT_landed_here"] or \
           "not move it" in art["repair_is_NOT_landed_here"]


def test_the_convicted_REV_path_is_absent_from_the_module():
    src = io.open("research/run_tpg_0331_rerow.py", encoding="utf-8").read()
    body = src.split('"""', 2)[-1]        # skip the docstring, which NAMES it to forbid it
    assert "ZONE_REJECTION_STORY_THEN_INTRA5_FORCE" not in body, (
        "the convicted rejection path reappeared in executable code")
