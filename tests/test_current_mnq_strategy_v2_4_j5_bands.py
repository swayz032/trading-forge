"""Guards for the five J5 bands.

THE FIRST VERSION OF THIS DERIVATION WAS WRONG AND SHIPPED A PLAUSIBLE ANSWER. Keying the
rejection wick off the role at his ENTRY produced five bands, none of which covered his line,
three whose role-implied wick was smaller than the opposite one, and a zero-width band on 04-06.
It looked like a working derivation. What convicted it was publishing BOTH wicks instead of only
the one the role implied - so the first test here pins that both are still measured.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

import pytest

ART = Path("research/current_mnq_strategy_v2_4_j5_bands_five_sessions_2026_08_23.json")


@pytest.fixture(scope="module")
def art():
    if not ART.exists():
        pytest.skip(f"{ART} not produced yet")
    return json.load(io.open(ART, encoding="utf-8"))


def _ok(art):
    return [r for r in art["rows"] if "band_lo" in r]


def test_both_wicks_are_published_for_every_derived_band(art):
    """Publishing only the chosen wick is what let the wrong rule look right."""
    for r in _ok(art):
        assert "rejection_wick_points" in r and "opposite_wick_points" in r, r["session"]


def test_the_band_straddles_the_level_for_every_derived_row(art):
    for r in _ok(art):
        assert r["band_lo"] <= float(r["his_line"]) <= r["band_hi"], r["session"]


def test_coverage_is_declared_TAUTOLOGICAL_and_not_used_as_evidence(art):
    """It is true by construction, so the artifact must carry the disclaimer field.

    Checked STRUCTURALLY - the field's presence and non-emptiness - not by grepping a word out
    of its prose. The first version of this test asserted "TAUTOLOGICAL" appeared in the VALUE
    when it only appears in the KEY, which is the same read-the-sentence-not-the-fact mistake
    this lane has already converted 5 guards away from.
    """
    assert art.get("coverage_is_TAUTOLOGICAL_under_this_rule", "").strip()
    # and the property it disclaims must actually hold, or the disclaimer is about nothing
    assert all(r["band_covers_his_line"] for r in _ok(art))


def test_a_candle_that_never_reaches_the_level_ERRORS_instead_of_returning_a_band(art):
    """04-06's marked 15m candle tops out BELOW his line, so no rejection wick exists.

    Returning a band anyway - as the role-keyed version did, at zero width - would have
    manufactured a location out of a candle that never touched the level.
    """
    r = next(x for x in art["rows"] if x["session"] == "2026-04-06")
    assert "ERROR" in r, "04-06 silently produced a band from a candle that never reached it"
    assert r["high_above_level"] is False and r["close_above_level"] is False


def test_the_wick_is_chosen_by_PENETRATION_not_by_the_entry_role(art):
    """At least one row must disagree with its entry-time role, or the fix is inert.

    03-31 is the case: role at entry RESISTANCE, but at 09:35 the level was acting as SUPPORT.
    """
    flipped = [r for r in _ok(art) if r["marking_role_differs_from_entry_role"]]
    assert flipped, "no row distinguishes marking role from entry role - the fix does nothing"
    assert any(r["session"] == "2026-03-31" for r in flipped)


def test_widths_are_reported_against_the_held_teaching_span_not_silently(art):
    assert art["widths_sit_ABOVE_the_held_teaching_span"]
    lo, hi = art["width_range_points"]
    assert hi > 75, "if widths now fit the taught span, the caveat text is stale"


def test_the_bands_were_published_before_the_0324_coverage_rerun(art):
    assert art["published_BEFORE_the_0324_coverage_rerun"] is True


def test_every_band_states_COMPLETED_or_FORMING_at_marked_time(art):
    """ALGO-076 requirement. A band from a bar that had not closed uses data that did not exist."""
    for r in _ok(art):
        assert r["rejection_candle_state_at_marked_time"] in ("COMPLETED", "FORMING"), r["session"]
        assert r["is_H_CONFIRM_case"] is (
            r["rejection_candle_state_at_marked_time"] == "FORMING"), r["session"]


def test_the_H_CONFIRM_sessions_are_listed_not_buried_in_the_rows(art):
    """ALL FOUR derived bands are FORMING - the ruling anticipated only 03-24. That has to be
    visible at the top of the artifact, not reconstructable by reading every row."""
    forming = art["H_CONFIRM_sessions_marked_candle_still_FORMING"]
    assert sorted(forming) == ["2026-03-24", "2026-03-30", "2026-03-31", "2026-04-14"], forming
    assert art["why_FORMING_matters"]
