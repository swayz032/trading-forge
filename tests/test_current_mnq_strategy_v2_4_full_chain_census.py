"""Guards for the full-chain blocker census.

THE POSITIVE CONTROL CAUGHT TWO REAL DEFECTS IN THIS MODULE BEFORE IT WAS PUBLISHED, and both
would have produced a confident, wrong repair order:

  1. S2 was joined on RENDERED TEXT - the X-ray writes `bucket` with `isoformat()` ("...T09:35")
     while `str(Timestamp)` gives "... 09:35". The comparison matched nothing on every session,
     so S2 read BLOCKED on all eight days including the control. Only the control's "must be
     zero" made that visible; the other seven rows looked entirely plausible.
  2. The zone selector took the band NEAREST his fill price. On 04-06 that is his TARGET, not
     his entry level - he shorted a rejection off resistance 24421.625 and marked his TP at
     24257.25, on the support at 24248.125. Caught by disagreeing with J16's independent
     derivation on 1 of 5.

So the first two tests here pin the CONTROL and the SELECTOR, not the conclusions.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

import pytest

ART = Path("research/current_mnq_strategy_v2_4_full_chain_blocker_census_2026_08_24.json")
TRADED = ("2026-03-23", "2026-03-24", "2026-03-30", "2026-03-31", "2026-04-06", "2026-04-09")


@pytest.fixture(scope="module")
def art():
    if not ART.exists():
        pytest.skip(f"{ART} not produced yet")
    return json.load(io.open(ART, encoding="utf-8"))


def _row(art, s):
    return next(r for r in art["rows"] if r["session"] == s)


def test_the_positive_control_shows_ZERO_blocking_gates(art):
    """If the control blocks anywhere, the census is measuring an artefact of its own joins."""
    assert art["control_blocking_gate_count"] == 0, (
        "04-14 agreed in the exam; any blocker on it is a false positive in this census")
    ctrl = _row(art, "2026-04-14")
    assert ctrl["BLOCKING_GATES"] == []


def test_the_zone_selector_agrees_with_J16_everywhere_J16_covers(art):
    assert art["zone_selector_agrees_everywhere_J16_covers"] is True
    checks = art["zone_selector_positive_control_vs_J16"]
    assert len(checks) == 5, checks
    assert all(c["agree"] for c in checks)


def test_0406_selects_the_RESISTANCE_he_entered_off_not_the_support_he_targeted(art):
    """The exact shape of the selector bug."""
    r = _row(art, "2026-04-06")
    assert r["his_zone_midpoint"] == 24421.625, (
        "the census picked his TARGET zone as his ENTRY zone")


def test_every_gate_is_reported_as_blocked_passed_or_explicitly_not_evaluable(art):
    """Silently reporting a gate that was never run is the defect this module exists to end."""
    for r in art["rows"]:
        for b in r["blockers"]:
            assert b["blocked"] in (True, False, None), (r["session"], b["stage"])
            if b["blocked"] is None:
                assert b["detail"], (r["session"], b["stage"])


def test_no_day_is_blocked_at_only_one_gate_except_0330(art):
    """The census's whole reason for existing: single-gate repair rounds could not have worked."""
    singles = [s for s in TRADED if _row(art, s)["blocking_gate_count"] == 1]
    assert singles == ["2026-03-30"], singles


def test_the_target_policy_blocks_every_traded_day(art):
    assert art["gate_block_frequency"]["S5_TARGET_POLICY"] == len(TRADED)


def test_one_minute_entry_never_blocks(art):
    assert art["gate_block_frequency"]["S3_ONE_MINUTE_ENTRY"] == 0


def test_the_minimal_repair_set_needs_five_of_six_gates(art):
    m = art["repair_set_coverage"]["minimal_set_to_unblock_ALL"]
    assert m is not None
    assert m["size"] == 5, m
    assert "S3_ONE_MINUTE_ENTRY" not in m["repair_set"]


def test_fixing_only_the_most_frequent_gate_unblocks_one_day(art):
    """S5 blocks 6/6 yet repairing it alone reaches a single day - the trap, quantified."""
    smallest = art["repair_set_coverage"]["smallest_set_achieving_each_count"]
    one = next(c for c in smallest if c["count"] == 1)
    assert one["repair_set"] == ["S5_TARGET_POLICY"]
    assert one["days_unblocked"] == ["2026-03-30"]


def test_the_bot_is_early_and_the_control_is_the_discriminator(art):
    """4 of 5 blocked days: same direction, tens of minutes early. Control: 2 minutes LATE."""
    rows = art["bot_is_early_not_wrong_directionally"]["rows"]
    ctrl = next(r for r in rows if r["is_control"])
    assert ctrl["bot_is_early_by_minutes"] < 0, "the control must fire AFTER his entry"
    assert ctrl["s4_blocks"] is False
    same_early = [r for r in rows
                  if not r["is_control"] and r["direction_matches_his"] and r["s4_blocks"]]
    assert len(same_early) == 4, same_early
    assert all(r["bot_is_early_by_minutes"] > 30 for r in same_early)


def test_S4_is_recorded_as_TAUGHT_so_it_cannot_be_repaired(art):
    for s in TRADED:
        b = next(x for x in _row(art, s)["blockers"] if x["stage"] == "S4_BUDGET_BULLET")
        assert b["magnitude_provenance"] == "TAUGHT", s
