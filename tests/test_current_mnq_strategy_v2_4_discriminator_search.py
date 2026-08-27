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
    # bot_state_in_window must be an ENTRY or the budget-faithful filter drops the case.
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

def test_the_real_corpus_is_NOT_TESTABLE_and_says_so():
    """The verdict must not claim "no discriminator" from ZERO tests.

    Under the refuted window join this was 7-vs-7 and the numeric test ran. Budget-faithfully
    it is 5-vs-2, the smaller group is below MIN_GROUP, and nothing is testable. Those are
    different claims and the artifact must make the difference visible.
    """
    s = D.search()
    # DERIVED. 5-vs-2 at the 09:30 window, 1-vs-0 at 08:00. What must hold is that the
    # population is too small to test and the artifact SAYS SO - not any particular size.
    assert s["wanted_entries"] + s["unwanted_entries"] < 14, (
        "the budget-faithful join must shrink the corpus; if it did not, the join is wrong")
    assert min(s["wanted_entries"], s["unwanted_entries"]) < 3, (
        "the smaller group must be below the minimum testable size, or this artifact should "
        "be issuing a verdict instead of refusing")
    # DERIVED: 7 at 09:30, 13 at 08:00. What must hold is that exclusions plus the two
    # groups account for the whole corpus and that something WAS excluded.
    assert s["sessions_excluded_bullet_spent_pre_window"] > 0
    assert (s["sessions_excluded_bullet_spent_pre_window"]
            + s["wanted_entries"] + s["unwanted_entries"]) <= 14
    assert s["numeric_fields_tested"] == 0
    assert s["testable"] is False
    assert "NOT TESTABLE" in s["verdict"]
    assert "NO DISCRIMINATOR AVAILABLE" not in s["verdict"], (
        "a no-discriminator verdict from zero tests is a green check with no path to red")


def test_the_strength_limit_states_the_shrunken_population():
    s = D.search()
    # DERIVED from the artifact's own counts rather than quoted.
    assert f'{s["wanted_entries"]} wanted vs {s["unwanted_entries"]} unwanted' \
        in s["strength_limit"], s["strength_limit"]
    assert "CANNOT ANSWER THIS QUESTION" in s["strength_limit"]


def test_a_big_enough_population_becomes_TESTABLE_again(tmp_path):
    """POSITIVE WITNESS. NOT_TESTABLE must be a property of the data, not of the code."""
    cases = ([_case(f"2026-01-0{i}", "ENTER_LONG", 0.5 + i / 100) for i in range(1, 5)]
             + [_case(f"2026-02-0{i}", "WAIT", 0.5 + i / 100) for i in range(1, 5)])
    s = D.search(_sc(tmp_path, cases))
    assert s["testable"] is True
    assert s["numeric_fields_tested"] > 0
    assert "NOT TESTABLE" not in s["verdict"]


def test_min_group_is_enforced_on_BOTH_sides(tmp_path):
    """One large group cannot rescue a group of two."""
    cases = ([_case(f"2026-01-{i:02d}", "ENTER_LONG", 0.5) for i in range(1, 9)]
             + [_case(f"2026-02-0{i}", "WAIT", 0.9) for i in range(1, 3)])
    s = D.search(_sc(tmp_path, cases))
    assert s["unwanted_entries"] == 2 and s["testable"] is False


def test_the_route_distributions_are_reported_even_when_not_testable():
    """Categorical shape is still worth seeing; it just cannot carry a verdict at this size."""
    c = D.search()["categorical"]
    # An EMPTY group is a real outcome, not a broken artifact: the 08:00 window leaves
    # zero unwanted entries, which is itself the finding. What must hold is that the census
    # is PRESENT for both groups and honest about being empty - a missing key would hide it.
    for group in ("wanted", "unwanted"):
        assert group in c, group
        for field in ("route", "story", "location_source"):
            assert field in c[group], f"{group}.{field} census is missing entirely"
    assert c["wanted"]["route"] or c["unwanted"]["route"], (
        "BOTH groups empty means nothing was measured at all")
