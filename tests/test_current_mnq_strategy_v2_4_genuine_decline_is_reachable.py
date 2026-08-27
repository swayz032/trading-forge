"""F-1 REPAIR, RED-PROOFED. A genuine decline must be REPRESENTABLE, not just claimed fixed.

The arena grade of 2026-08-23 found that `NO_ENTRY_IN_WINDOW` was unreachable: the regrade's
no-decision branch emitted a row with no `budget_faithful` key, so `_bot_window_state` could
never return it. Four published metrics were therefore structurally zero, `AGREEMENT_CLASSES`
degenerated from `{AGREE, BOTH_DECLINED}` to `{AGREE}`, and — worse than a zero — a session in
which the bot genuinely declined **aborted the baseline** with
`REGRADE_ROW_PREDATES_THE_F1_REPAIR`, a message pointing at a stale artifact that did not exist.

The repair emits `budget_faithful` on that branch with `bullet_spent_before_window: False`.

**AND THE REPAIR CHANGES NO PUBLISHED NUMBER, WHICH IS EXACTLY WHY THIS FILE HAS TO EXIST.**
The bot trades in all 14 sessions of the corpus, so the branch never fires and the four metrics
are still 0. They are now MEASUREMENTS THAT CAN MOVE rather than CONSTRUCTIONS THAT CANNOT —
but "can move" is a claim, and a claim with no demonstrated path to red is precisely the defect
that was just found. These tests are that path.
"""
from __future__ import annotations

import ast
import io

import pytest

from research.run_frozen_14_case_baseline import (
    AGREEMENT_CLASSES,
    BUDGET_CONSUMED,
    _bot_window_state,
    _mismatch_class,
)

REGRADE = "research/current_mnq_strategy_v2_4_frozen_replay_regrade.py"


def _declined_row():
    """The row the repaired no-decision branch produces: no entry anywhere, bullet unspent."""
    return {
        "case_id": "SYNTHETIC", "session": "2026-01-01",
        "window_status": "NO_FULL_ENTRY_THROUGH_REPLAY_END",
        "bot_action": "NO_TRADE_THROUGH_WINDOW", "bot_entry_time": None,
        "decision_count_through_end": 0, "decision_count_in_window": 0,
        "decisions_discarded_by_first_only": 0,
        "in_window": None, "in_window_actions": [],
        "budget_faithful": {
            "one_trade_budget": 1,
            "session_first_entry_time": None, "session_first_action": None,
            "bullet_spent_before_window": False,
            "executable_in_window": False,
            "in_window_entries_the_budget_forbids": 0,
            "note": "synthetic",
        },
    }


def test_a_genuine_decline_now_REACHES_the_state_it_could_not_reach():
    """The whole point. Before the repair this row raised instead of classifying."""
    assert _bot_window_state(_declined_row()) == "NO_ENTRY_IN_WINDOW"


def test_the_row_WITHOUT_budget_faithful_still_raises_the_stale_artifact_error():
    """The guard is kept — it is correct for a genuinely stale row, which was never the bug.

    The bug was that a LIVE decline produced that row shape. This proves the guard survives
    for its real purpose, so the repair did not buy reachability by deleting a check.
    """
    stale = _declined_row()
    del stale["budget_faithful"]
    with pytest.raises(RuntimeError, match="REGRADE_ROW_PREDATES_THE_F1_REPAIR"):
        _bot_window_state(stale)


def test_BOTH_DECLINED_is_reachable_so_AGREEMENT_CLASSES_is_not_degenerate():
    """`AGREEMENT_CLASSES` names two classes. Until the repair only one could ever occur."""
    cls = _mismatch_class("NO_TRADE", "NO_ENTRY_IN_WINDOW", False)
    assert cls == "BOTH_DECLINED"
    assert cls in AGREEMENT_CLASSES
    assert len(AGREEMENT_CLASSES) == 2, "both members must be reachable, not just named"


def test_the_other_two_structurally_zero_metrics_are_reachable_too():
    """`censored_bot_declined_count` and the NO_PERMISSION missed-reason."""
    assert _mismatch_class("WAIT", "NO_ENTRY_IN_WINDOW", True) == "CENSORED_BOT_DECLINED"
    assert _mismatch_class("ENTER_LONG", "NO_ENTRY_IN_WINDOW", False) == "MISSED_TRADER_ENTRY"


def test_a_MISSED_ENTRY_can_now_arise_from_something_other_than_a_spent_bullet():
    """Before the repair, MISSED_TRADER_ENTRY could ONLY come from BUDGET_CONSUMED.

    That made the docstring's claim - "on the window join the bot can decline, so both are
    live" - false. A trader entry against a genuinely declining bot is a different failure
    from a trader entry against an absent one, and the artifact must be able to tell them apart.
    """
    from_decline = _mismatch_class("ENTER_LONG", "NO_ENTRY_IN_WINDOW", False)
    from_budget = _mismatch_class("ENTER_LONG", "BUDGET_CONSUMED_BEFORE_WINDOW", False)
    assert from_decline == "MISSED_TRADER_ENTRY"
    assert from_budget == "MISSED_TRADER_ENTRY"
    assert BUDGET_CONSUMED != "NO_ENTRY_IN_WINDOW", (
        "the two causes must remain distinguishable upstream even where the class is shared")


def test_the_no_decision_branch_really_emits_the_key_this_all_depends_on():
    """Structural: the tests above use a hand-built row, so the EMITTER must be checked too.

    A synthetic fixture proving the classifier works is worth nothing if the branch that feeds
    it still omits the key. This is the join between the two.
    """
    tree = ast.parse(io.open(REGRADE, encoding="utf-8").read())
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.FunctionDef) and n.name == "regrade_frozen_case_windows")

    # The no-decision branch is the `if not decisions:` block.
    branch = next(n for n in ast.walk(fn)
                  if isinstance(n, ast.If) and isinstance(n.test, ast.UnaryOp)
                  and isinstance(n.test.op, ast.Not))
    keys = {c.value for c in ast.walk(branch)
            if isinstance(c, ast.Constant) and isinstance(c.value, str)}
    assert "budget_faithful" in keys, (
        "the no-decision branch does not emit `budget_faithful` - a genuine decline is "
        "unrepresentable again and all four metrics are structural zeros")
    assert "bullet_spent_before_window" in keys
