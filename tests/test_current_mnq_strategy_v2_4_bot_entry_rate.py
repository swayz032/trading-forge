"""The bot's 14-of-14 entry rate, and the tautology it creates, must stay visible.

A metric that cannot be nonzero is not a measurement, and `missed_trader_entries = 0` was
published as if it were one. These tests keep both facts pinned: the entry rate itself, and the
consequence that the "zero missed entries" figure is structural rather than earned.
"""
from __future__ import annotations

import ast
import io
import json

import pytest

from research import current_mnq_strategy_v2_4_bot_entry_rate as B
from research import current_mnq_strategy_v2_4_censoring_uniformity as U


def _fake(tmp_path, pairs):
    """pairs: list of (trader_state, bot_state)."""
    p = tmp_path / "sc.json"
    p.write_text(json.dumps({"cases": [
        {"session": f"2026-01-{i+1:02d}", "trader_state": t, "bot_state_in_window": b}
        for i, (t, b) in enumerate(pairs)]}), encoding="utf-8")
    return p


def test_the_measured_corpus_has_the_bot_entering_every_session():
    m = B.measure()
    assert m["sessions"] == 14
    assert m["bot_entered"] == 14 and m["bot_declined"] == 0
    assert m["distinct_bot_states"] == ["ENTER_LONG", "ENTER_SHORT"], (
        "a third bot state now exists - the tautology finding may no longer hold")


def test_not_one_session_has_both_agents_standing_aside():
    assert B.measure()["cross_tab"]["trader_declined_bot_declined"] == 0


def test_the_trader_declines_on_half_the_same_days():
    m = B.measure()
    assert m["trader_declined"] == 7 and m["trader_entered"] == 7


def test_missed_entries_is_flagged_as_a_tautology_while_the_bot_never_declines():
    m = B.measure()
    assert m["bot_never_declines"] is True
    assert m["missed_trader_entries_is_a_tautology"] is True


def test_the_tautology_flag_CLEARS_when_the_bot_declines_anywhere(tmp_path):
    """POSITIVE WITNESS. Otherwise the flag above proves only that it is always set."""
    p = _fake(tmp_path, [("ENTER_LONG", "ENTER_LONG"), ("ENTER_LONG", "NO_ENTRY_IN_WINDOW")])
    m = B.measure(p)
    assert m["bot_declined"] == 1
    assert m["bot_never_declines"] is False
    assert m["missed_trader_entries_is_a_tautology"] is False
    assert m["cross_tab"]["trader_entered_bot_declined"] == 1


def test_the_cross_tab_partitions_the_corpus(tmp_path):
    """Four cells, no double counting, no case unaccounted for."""
    for scorecard in (None, _fake(tmp_path, [
            ("ENTER_LONG", "ENTER_LONG"), ("WAIT", "ENTER_SHORT"),
            ("NO_TRADE", "NO_ENTRY_IN_WINDOW"), ("ENTER_SHORT", "NO_ENTRY_IN_WINDOW")])):
        m = B.measure(scorecard) if scorecard else B.measure()
        assert sum(m["cross_tab"].values()) == m["sessions"]


def test_it_reads_no_outcome_field():
    """Check what the code DOES, not what the prose SAYS.

    A first version banned the substring "winner" across the whole file and convicted the
    module's own docstring, which promises it reads no winner/loser label. A substring test
    that reads prose convicts the sentence written to make the promise.
    """
    src = io.open(B.__file__, encoding="utf-8").read()
    tree = ast.parse(src)
    ast.get_docstring(tree)  # confirms it parses as a module with a docstring
    subscripts = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Subscript) and isinstance(n.slice, ast.Constant):
            if isinstance(n.slice.value, str):
                subscripts.add(n.slice.value.lower())
    banned = {k for k in subscripts
              if any(w in k for w in ("pnl", "realized", "profit", "winner", "loser",
                                      "r_multiple", "outcome"))}
    assert not banned, f"the entry-rate measure reads outcome fields: {sorted(banned)}"
    assert "trader_state" in subscripts and "bot_state_in_window" in subscripts, (
        "positive witness: it must actually be reading the two decision fields")


# --- censoring uniformity, same packet -------------------------------------------------

def test_the_censoring_criterion_is_applied_uniformly():
    a = U.audit()
    assert a["uniform"] is True, a["disagreements"]
    assert not a["unknown_actions"], a["unknown_actions"]


def test_wait_and_no_trade_are_kept_distinct():
    """WAIT is right-censored; NO_TRADE is a real decision and stays in the denominator.

    Collapsing them would move 2026-04-02 -- a case the bot FAILS -- out of the denominator and
    flatter the headline. That is the exact shape of a manufactured score.
    """
    assert U.UNDECIDED == {"WAIT"}
    assert U.DECLINED == {"NO_TRADE"}
    assert not (U.UNDECIDED & U.DECLINED)
    rows = {r["session"]: r for r in U.rows()}
    r = rows["2026-04-02"]
    assert r["final_action"] == "NO_TRADE"
    assert r["declared_censored"] is False
    assert r["ends_at_window_end"] is True, (
        "it ends at the window end, which is why a naive rule would have censored it out")
    assert r["mismatch_class"] == "BOT_ONLY_ENTRY_UNCENSORED_DECLINE"


def test_the_decomposition_accounts_for_every_case():
    a = U.audit()
    assert a["entered"] + a["declined_positively"] + a["undecided_right_censored"] == a["cases"]
    assert a["declared_censored"] == a["undecided_right_censored"]


@pytest.mark.parametrize("field", ["entered", "declined_positively",
                                   "undecided_right_censored"])
def test_no_bucket_is_empty(field):
    """An empty bucket would mean the partition is not exercised by this corpus."""
    assert U.audit()[field] > 0
