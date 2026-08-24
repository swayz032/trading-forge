"""Guards for the target-layer T/P/G and the 04-06 marking-metadata chase.

TWO PRESCRIBED THINGS TURNED OUT TO BE WRONG IN THIS PACKET, and both are pinned here so a
future edit cannot quietly restore them:

  1. `picked.price` does not exist on `core.Target` - the field is `executable_price`. The first
     run published `target_executable: null` for all four sessions, which made the
     chosen-vs-his-TP distance, the entire point of the row, unmeasurable while looking complete.
  2. ALGO-076 order (d) prescribed "wick extreme within one tick of his line". That test returns
     ZERO on 2026-03-31, whose band the J5 module DOES derive - it fails identically on
     derivable and underivable cases. The J5 penetration predicate is what discriminates.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

import pytest

TL = Path("research/current_mnq_strategy_v2_4_tpg_target_layer_2026_08_23.json")
M6 = Path("research/current_mnq_strategy_v2_4_0406_marking_by_line_2026_08_23.json")


@pytest.fixture(scope="module")
def tl():
    if not TL.exists():
        pytest.skip(f"{TL} not produced yet")
    return json.load(io.open(TL, encoding="utf-8"))


@pytest.fixture(scope="module")
def m6():
    if not M6.exists():
        pytest.skip(f"{M6} not produced yet")
    return json.load(io.open(M6, encoding="utf-8"))


def _row(tl, session):
    return next(r for r in tl["rows"] if r["session"] == session)


# ---- target layer ---------------------------------------------------------------------------

def test_every_chosen_target_carries_a_real_price(tl):
    """Defect 1: a null price here reads as 'measured' and measures nothing."""
    for r in tl["rows"]:
        ch = r["P_chosen"]
        if ch is not None:
            assert isinstance(ch.get("target_executable"), (int, float)), r["session"]


def test_the_400_floor_refuses_nothing_at_his_own_entry(tl):
    """The headline correction to ALGO-075's framing: the floor is not the discriminator."""
    for r in tl["rows"]:
        assert r["how_many_considered_pass_the_400_floor"] == r["P_destination_count"], (
            f"{r['session']}: a destination failed the floor at HIS entry")
        assert r["P_refusal"] is None, r["session"]


def test_0324_is_a_SELECTION_defect_his_tp_is_in_the_map_and_was_passed_over(tl):
    r = _row(tl, "2026-03-24")
    assert r["G_gap_from_his_tp_to_nearest_considered_points"] == 0.0
    assert r["G_his_tp_inside_a_15m_key_zone"], "his TP should be a key zone here"
    assert r["ALGO_067_verdict"] == "PREDICATE_MISSPECIFIED"
    # and the machine chose a NEARER destination than his
    assert r["P_chosen"]["distance_points"] < r["his_marked_tp_distance_points"]


def test_0330_and_0331_are_COVERAGE_defects_not_selection(tl):
    """These need a different repair from 03-24 and must not be collapsed into one story."""
    for s in ("2026-03-30", "2026-03-31"):
        r = _row(tl, s)
        assert r["ALGO_067_verdict"] == "TARGET_NOT_IN_MAP", s
        assert r["G_gap_from_his_tp_to_nearest_considered_points"] > 0.0, s
        assert not r["G_his_tp_inside_a_15m_key_zone"], s


def test_the_control_is_reported_as_having_no_marked_tp_not_invented(tl):
    r = _row(tl, "2026-04-14")
    assert r["is_control"] is True
    assert r["his_marked_tp"] is None
    assert r["ALGO_067_verdict"] == "NO_MARKED_TP_IN_HIS_DIRECTION"
    assert tl["control_has_no_marked_tp_in_his_direction"] is True


def test_the_taught_rule_and_the_machine_rule_are_stated_SEPARATELY(tl):
    """Collapsing them into one field is how a derivation gets quoted as teaching."""
    for r in tl["rows"]:
        assert r["T_taught_rule"] != r["T_machine_rule"]
        assert "NEXT KEY ZONE" in r["T_taught_rule"].upper()


def test_TARGET_NOT_IN_MAP_is_declared_PROPOSED_not_silently_minted(tl):
    assert "PROPOSED" in tl["taxonomy_note"].upper()


# ---- 04-06 marking metadata ------------------------------------------------------------------

def test_the_prescribed_one_tick_test_is_recorded_as_REFUTED(m6):
    assert m6["REFUTED_TEST_wick_extreme_within_one_tick"]["hits_on_0406"] == 0
    assert m6["REFUTED_TEST_wick_extreme_within_one_tick"]["refuted_because"]


def test_the_positive_control_actually_finds_rejections(m6):
    """Without this, 04-06's result is indistinguishable from a broken search."""
    assert m6["positive_control_found_rejections"] > 0, (
        "the search found nothing even on the known-derivable control - it proves nothing")


def test_0406_has_a_derivable_band_but_only_AFTER_his_entry(m6):
    assert m6["verdict"] == "METADATA_WRONG_BAR_AND_THE_ONLY_REJECTION_POSTDATES_HIS_ENTRY"
    assert len(m6["penetration_test_results"]["2026-04-06"]) > 0
    assert m6["rejections_at_or_before_his_entry"] == [], (
        "if a rejection exists at or before 09:52 the verdict is wrong")
