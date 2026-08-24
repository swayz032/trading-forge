"""Guards for the four ALGO-078 diagnosis lanes.

THE SHARPEST THING IN THIS PACKET IS A NEGATIVE RESULT, and it is pinned first: L1's H-A tally
came back 5/5, which under the pre-registered rule NAMES the repair lane - and it is NOT
evidence. The machine builds 53-69 locations per session and he marks two, so only 1.5-4.4% of
its locations overlap one of his zones. Under that base rate the probability that all five early
trades miss his zones by chance is ~89%. The tally is very nearly guaranteed by construction.

The informative observation is the one on the other side: the single AGREEING day is the day the
bot fired AT a zone he marked. So `test_the_tally_is_declared_non_evidence` is the guard that
matters most here - if a future edit quietly drops that caveat, a base-rate artefact gets
promoted to a finding.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

import pytest

L1 = Path("research/current_mnq_strategy_v2_4_l1_timing_classification_2026_08_24.json")
L2 = Path("research/current_mnq_strategy_v2_4_l2_spent_zone_separation_2026_08_24.json")
L3 = Path("research/current_mnq_strategy_v2_4_l3_tp_provenance_2026_08_24.json")
L4 = Path("research/current_mnq_strategy_v2_4_l4_uniform_band_rederivation_2026_08_24.json")


def _load(p):
    if not p.exists():
        pytest.skip(f"{p} not produced yet")
    return json.load(io.open(p, encoding="utf-8"))


@pytest.fixture(scope="module")
def l1():
    return _load(L1)


@pytest.fixture(scope="module")
def l2():
    return _load(L2)


@pytest.fixture(scope="module")
def l3():
    return _load(L3)


@pytest.fixture(scope="module")
def l4():
    return _load(L4)


# ---- L1 ---------------------------------------------------------------------------------

def test_the_tally_is_declared_non_evidence(l1):
    """The load-bearing guard. A 5/5 tally under an ~89% null is not a finding."""
    cav = l1["BASE_RATE_CAVEAT"]
    assert cav["tally_is_evidence"] is False
    assert cav["probability_all_five_miss_by_chance_pct"] > 50, (
        "if the null probability is low the caveat text is stale and must be re-derived")


def test_the_base_rate_is_measured_per_session_not_asserted(l1):
    for r in l1["rows"]:
        assert r["locations_the_machine_built"] > 0, r["session"]
        assert r["base_rate_pct"] is not None, r["session"]


def test_the_control_is_the_day_the_bot_fired_at_a_marked_zone(l1):
    ctrl = next(r for r in l1["rows"] if r["is_control"])
    assert ctrl["fired_level_matches_a_marked_zone"] is True
    assert ctrl["bot_is_early_by_minutes"] < 0, "the control must fire AFTER his entry"
    for r in l1["rows"]:
        if not r["is_control"]:
            assert r["fired_level_matches_a_marked_zone"] is False, r["session"]


# ---- L2 ---------------------------------------------------------------------------------

def test_the_spent_predicate_is_structural_and_reads_no_reward(l2):
    """A reward-shaped skip criterion is exactly what ALGO-078 forbade."""
    txt = l2["predicate_under_test"].lower()
    assert "structural" in txt
    for banned in ("reward", "distance", "pnl", "outcome"):
        assert f"no {banned}" in txt or banned not in txt.split("structural only")[-1], txt


def test_the_predicate_separates_on_every_testable_session(l2):
    assert l2["VERDICT"] == "SPENT_PREDICATE_SEPARATES_ON_ALL_TESTABLE_SESSIONS"
    assert l2["sessions_where_it_separates"] == l2["testable_sessions"]
    assert len(l2["testable_sessions"]) == 3


def test_on_the_agreeing_day_the_chosen_target_is_NOT_spent(l2):
    """The control points the right way, or the separation is a coincidence."""
    ctrl = next(r for r in l2["rows"] if r["is_control"])
    assert ctrl["machine_winner"]["SPENT"] is False
    assert ctrl["PREDICATE_SEPARATES"] is None
    assert l2["control_limitation"]


def test_the_synthetic_tp_band_is_labelled_where_it_was_used(l2):
    """On 03-30/03-31 his TP is in no destination, so 'fresh' rests on a one-tick window."""
    for r in l2["rows"]:
        h = r["his_tp_zone"]
        if h and "one tick" in h["band_source"]:
            assert r["session"] in ("2026-03-30", "2026-03-31"), r["session"]


# ---- L3 ---------------------------------------------------------------------------------

def test_the_provenance_control_finds_its_own_tp(l3):
    """Without this, silence about 03-31 could just be a broken search."""
    assert l3["control_is_meaningful"] is True
    ctrl = next(r for r in l3["rows"] if r["is_control"])
    assert ctrl["VERDICT"] != "TP_PROVENANCE_UNKNOWN_FROM_HELD"


def test_tolerances_were_fixed_before_the_search(l3):
    for r in l3["rows"]:
        assert r["tolerances_fixed_before_the_search"] is True
        assert r["exact_tolerance_points"] == 0.25
        assert r["band_tolerance_points"] == 2.0


def test_0330_is_located_and_0331_is_honestly_unknown(l3):
    v = l3["verdicts"]
    assert v["2026-03-30"] == "TP_INSIDE_AN_HTF_REJECTION_BAND"
    assert v["2026-03-31"] == "TP_PROVENANCE_UNKNOWN_FROM_HELD", (
        "if 03-31 acquires a source, the coverage repair changes shape - do not soften this")


# ---- L4 ---------------------------------------------------------------------------------

def test_both_controls_re_derive_under_the_law(l4):
    assert l4["controls_all_derived"] is True


def test_completed_by_construction_is_declared_not_evidence(l4):
    assert "NOT evidence" in l4["completed_by_construction_note"]


def test_every_new_source_candle_closes_at_or_before_his_entry(l4):
    """The whole point of the law. A band from a bar that had not printed is not his band."""
    import pandas as pd
    for r in l4["rows"]:
        if r["NEW_source_closes_at"]:
            assert pd.Timestamp(r["NEW_source_closes_at"]) <= pd.Timestamp(r["his_entry_clock"]), \
                r["session"]


def test_0324_and_0406_have_no_completed_penetration(l4):
    """Both were derivable only from bars that postdate his entry - which is the finding."""
    assert sorted(l4["sessions_with_no_completed_penetration"]) == [
        "2026-03-24", "2026-04-06"]
