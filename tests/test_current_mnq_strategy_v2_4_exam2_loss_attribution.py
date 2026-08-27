"""Guards for the re-exam #2 loss attribution.

TWO REAL DEFECTS SIT BEHIND THESE TESTS, both of the same class - measuring the neighbouring
object - and both caught only because something downstream disagreed.

  1. I reported "R1 recovered 03-30 to GRANTED". True of the entry-authority story at candidate
     ranking; the exam counts FULLY-APPROVED entries, two gates further on. The exam's 1/8 is
     what convicted the claim.
  2. The first run of the attribution module omitted the arm's `trading_window` context and
     produced five APPROVED entries for 03-24 at 08:17-08:34 - candidates the 09:30 arm cannot
     see at all.

So the tests pin the PIPELINE SHAPE and the ARM, not the conclusion.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

import pytest

ART = Path("research/current_mnq_strategy_v2_4_exam2_loss_attribution_2026_08_23.json")
LOST = ("2026-03-24", "2026-03-30", "2026-03-31", "2026-04-06")
CONTROL = "2026-04-14"


@pytest.fixture(scope="module")
def art():
    if not ART.exists():
        pytest.skip(f"{ART} not produced yet")
    return json.load(io.open(ART, encoding="utf-8"))


def _row(art, arm, session):
    return next(r for r in art["rows"] if r["arm"] == arm and r["session"] == session)


def test_BOTH_arms_are_traced_not_just_one(art):
    """A single-arm trace would have hidden that 3 of 4 losses differ BETWEEN arms."""
    assert set(art["arms_traced"]) == {"baseline_0930", "taught_0800"}
    for arm in art["arms_traced"]:
        assert len([r for r in art["rows"] if r["arm"] == arm]) == 5


def test_the_positive_control_reaches_approval_in_EVERY_arm(art):
    """Without this, 'everything dies upstream' cannot be told from 'the trace is broken'."""
    assert art["positive_control_reached_approval_in_every_arm"] is True
    for arm in art["arms_traced"]:
        r = _row(art, arm, CONTROL)
        assert r["attribution"] == "APPROVED_IN_WINDOW"
        assert r["fully_approved_entries"] >= 1


def test_no_lost_session_is_attributed_to_the_entry_authority_stage(art):
    """THE HEADLINE FINDING. R1/R1b act on stage 1; if any loss were attributed there, the
    claim that entry-authority repair cannot move the exam would be false."""
    bad = []
    for arm in art["arms_traced"]:
        for s in LOST:
            a = _row(art, arm, s)["attribution"]
            if a.startswith("1_ENTRY_AUTHORITY"):
                bad.append((arm, s, a))
    assert not bad, f"a loss IS attributed to entry authority, which changes the diagnosis: {bad}"


def test_0330_dies_at_the_target_gate_in_BOTH_arms(art):
    for arm in art["arms_traced"]:
        r = _row(art, arm, "2026-03-30")
        assert r["attribution"] == "3_TARGET_POLICY_build_and_classify"
        refusals = r["killed_by_stage"]["3_TARGET_POLICY_build_and_classify"]
        assert any("TP1_REFERENCE_REWARD_UNDER_400" in x for x in refusals), refusals


def test_the_0930_arm_starves_three_of_the_four_of_candidates(art):
    """The narrow arm and the taught arm fail for DIFFERENT reasons; both are published."""
    starved = [s for s in LOST
               if _row(art, "baseline_0930", s)["attribution"] == "NO_ACTIONABLE_CANDIDATE"]
    assert sorted(starved) == ["2026-03-24", "2026-03-31", "2026-04-06"], starved


def test_the_0800_arm_loses_three_of_the_four_to_the_ONE_BULLET_BUDGET(art):
    spent = [s for s in LOST
             if _row(art, "taught_0800", s)["attribution"] == "BULLET_SPENT_BEFORE_WINDOW"]
    assert sorted(spent) == ["2026-03-24", "2026-03-31", "2026-04-06"], spent


def test_every_bullet_spent_row_names_the_approval_that_spent_it(art):
    """'Bullet spent' with no entry time is an assertion; with one it is a receipt."""
    for arm in art["arms_traced"]:
        for s in LOST + (CONTROL,):
            r = _row(art, arm, s)
            if r["attribution"] == "BULLET_SPENT_BEFORE_WINDOW":
                assert r["first_approved_entry_time"], f"{arm}/{s} claims spent with no time"
                assert r["first_approved_entry_time"] < r["replay_window"][0]


def test_the_arm_context_is_actually_applied_not_merely_named(art):
    """The exact shape of defect 2: without the context both arms return identical candidates.

    03-24 is the discriminator - 0 candidates at 09:30, 6 at 08:00. If a future edit drops the
    `trading_window` context, these collapse to the same number and this goes red.
    """
    a = _row(art, "baseline_0930", "2026-03-24")["actionable_candidates_through_window_end"]
    b = _row(art, "taught_0800", "2026-03-24")["actionable_candidates_through_window_end"]
    assert a != b, (
        "both arms produced the same candidate count for 03-24 - the trading_window context "
        "is not being applied and the trace describes a pipeline the exam never ran")
    assert a == 0 and b == 6, (a, b)
