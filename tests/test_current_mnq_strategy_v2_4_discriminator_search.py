"""The discriminator search must be able to FIND one, or "found none" means nothing.

This is the whole risk with a negative result: a search that never fires reports zero every
time and reads exactly like a finding. The positive witness below is the load-bearing test.
"""
from __future__ import annotations

import json

import pytest

from research import current_mnq_strategy_v2_4_discriminator_search as D


def _sc(tmp_path, cases):
    p = tmp_path / "sc.json"
    p.write_text(json.dumps({"cases": cases}), encoding="utf-8")
    return p


def _case(session, trader, value, extra=0.0):
    return {
        "session": session, "trader_state": trader, "bot_state_in_window": "ENTER_LONG",
        "entry_family_receipt": "REV", "story_receipt": "S",
        "interaction_geometry": {"location_source": "WICK_ZONE"},
        "force_receipt": {"path_efficiency": value, "confirmed": True},
        "decisions_in_window": extra,
    }


def test_the_search_FINDS_a_planted_discriminator(tmp_path):
    """POSITIVE WITNESS. A field that separates cleanly must be reported."""
    cases = ([_case(f"2026-01-0{i}", "ENTER_LONG", 0.1 + i / 100) for i in range(1, 5)]
             + [_case(f"2026-02-0{i}", "WAIT", 0.9 + i / 100) for i in range(1, 5)])
    s = D.search(_sc(tmp_path, cases))
    assert s["numeric_fields_completely_separating"] >= 1, s
    assert any(r["field"] == "force_receipt.path_efficiency"
               for r in s["separating_fields"]), s["separating_fields"]
    assert "investigate" in s["verdict"]


def test_the_search_reports_none_when_the_groups_overlap(tmp_path):
    """The other half of the discrimination proof: it must NOT fire on overlapping data."""
    cases = ([_case(f"2026-01-0{i}", "ENTER_LONG", 0.5 + i / 100) for i in range(1, 5)]
             + [_case(f"2026-02-0{i}", "WAIT", 0.5 + i / 100) for i in range(1, 5)])
    s = D.search(_sc(tmp_path, cases))
    assert s["numeric_fields_completely_separating"] == 0
    assert "NO DISCRIMINATOR AVAILABLE" in s["verdict"]


def test_constant_fields_are_named(tmp_path):
    cases = ([_case(f"2026-01-0{i}", "ENTER_LONG", 0.5) for i in range(1, 5)]
             + [_case(f"2026-02-0{i}", "WAIT", 0.5) for i in range(1, 5)])
    s = D.search(_sc(tmp_path, cases))
    fields = {c["field"] for c in s["constant_across_the_whole_corpus"]}
    assert "force_receipt.confirmed" in fields
    assert "force_receipt.path_efficiency" in fields


def test_the_circular_field_is_excluded(tmp_path):
    """`trader_label_censored` is derived from the trader's label - using it would be circular."""
    assert "trader_label_censored" in D.CIRCULAR
    cases = ([dict(_case(f"2026-01-0{i}", "ENTER_LONG", 0.5), trader_label_censored=False)
              for i in range(1, 5)]
             + [dict(_case(f"2026-02-0{i}", "WAIT", 0.5), trader_label_censored=True)
                for i in range(1, 5)])
    s = D.search(_sc(tmp_path, cases))
    assert not any(r["field"] == "trader_label_censored" for r in s["separating_fields"]), (
        "a field derived from the trader's own label separates the groups by construction and "
        "must never be reported as a discriminator")


# --- the measured corpus ---------------------------------------------------------------

def test_no_recorded_field_separates_the_real_corpus():
    s = D.search()
    assert s["wanted_entries"] == 7 and s["unwanted_entries"] == 7
    assert s["numeric_fields_completely_separating"] == 0, s["separating_fields"]
    assert "NO DISCRIMINATOR AVAILABLE" in s["verdict"]


def test_the_route_distribution_is_identical_between_the_groups():
    s = D.search()
    assert s["categorical_distributions_are_indistinguishable"] is True, (
        s["categorical"])


@pytest.mark.parametrize("field", [
    "force_receipt.confirmed",
    "force_receipt.latest_close_at_directional_extreme",
    "force_receipt.partial_momentum_geometry",
])
def test_these_force_receipt_fields_are_constant_and_therefore_carry_no_information(field):
    """A receipt field with one value across the corpus cannot explain any decision."""
    constants = {c["field"] for c in D.search()["constant_across_the_whole_corpus"]}
    assert field in constants, (
        f"{field} is no longer constant - it may now carry information and the finding is stale")


def test_the_strength_limit_is_stated():
    """A negative result that hides its sample size overstates itself."""
    s = D.search()
    assert "n=7" in s["strength_limit"] or "7 per group" in s["strength_limit"]
    assert "not proof" in s["strength_limit"]
