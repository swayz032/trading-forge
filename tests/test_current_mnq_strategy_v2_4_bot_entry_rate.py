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
from research.run_frozen_14_case_baseline import AGREEMENT_CLASSES


def _fake(tmp_path, pairs, session_first="ENTER_LONG"):
    """pairs: list of (trader_state, bot_state)."""
    p = tmp_path / "sc.json"
    p.write_text(json.dumps({"cases": [
        {"session": f"2026-01-{i+1:02d}", "trader_state": t, "bot_state_in_window": b,
         "budget_faithful": {"session_first_action": session_first}}
        for i, (t, b) in enumerate(pairs)]}), encoding="utf-8")
    return p


def test_whether_the_bot_trades_every_session_is_MEASURED_not_ASSERTED(tmp_path):
    """RE-ANCHORED, NOT PATCHED — and deliberately not re-pointed at the new number.

    This test used to assert `bot_traded_at_all == 14` and `bot_trades_every_session is True`.
    That was the core ALGO-016 finding and it was true of every kernel measured until ALGO-047
    wired the entry authority in; the re-measurement immediately after the wiring is 13 of 14.

    Asserting `== 13` instead would be a goalpost with a citation: I am the party the new
    number flatters, and a count I pin today is a count that stops being a measurement. What is
    pinned instead is that the FLAG CANNOT LIE — it must equal the comparison it claims to
    report — witnessed in BOTH directions on synthetic data, so it has a path to red whichever
    way the real corpus goes. The corpus size stays pinned because that IS frozen.
    """
    m = B.measure()
    assert m["sessions"] == 14, "the frozen corpus is 14 sessions"
    assert m["bot_trades_every_session"] == (
        m["bot_traded_at_all_in_the_session"] == m["sessions"]), (
        "the flag disagrees with the counts it summarises")

    every = B.measure(_fake(tmp_path, [("WAIT", "ENTER_LONG")], session_first="ENTER_LONG"))
    assert every["bot_trades_every_session"] is True
    not_every = B.measure(_fake(tmp_path, [("WAIT", "WAIT")], session_first="WAIT"))
    assert not_every["bot_trades_every_session"] is False


def test_the_GENUINE_DECLINE_metric_discriminates(tmp_path):
    """The metric that convicted the old kernel must still be able to convict the new one.

    Same re-anchoring as above: the old assertion was `declined == 0`, which was the DEFECT
    being pinned. It is now 1. The property that outlives the number is that a genuine decline
    is DISTINGUISHABLE from an absence — the conflation that once moved the headline 5/8 -> 6/8
    in the bot's favour — and that the summary flag tracks the count rather than a memory of it.
    """
    m = B.measure()
    assert m["bot_never_declines"] == (m["bot_genuinely_declined_in_window"] == 0)

    declines = B.measure(_fake(tmp_path, [("ENTER_LONG", "WAIT")], session_first="ENTER_LONG"))
    assert declines["bot_genuinely_declined_in_window"] == 1
    assert declines["bot_never_declines"] is False

    absent = B.measure(_fake(tmp_path, [("ENTER_LONG", B.UNAVAILABLE)],
                             session_first="ENTER_LONG"))
    assert absent["bot_genuinely_declined_in_window"] == 0, (
        "an absent bot was counted as a declining one - that is the conflation this "
        "three-state partition exists to prevent")
    assert absent["bot_unavailable_in_window"] == 1


def test_unavailable_is_counted_apart_from_declined():
    """BUDGET_CONSUMED is not a decline - the bot traded, before the window.

    Conflating them scores a bot trade as agreement and moved the headline 5/8 -> 6/8 in the
    bot's favour. That mistake was made and caught while writing the F-1 repair.
    """
    m = B.measure()
    # DERIVED, not pinned. The count is a function of the trading window - it was 7 at
    # 09:30 and 13 at 08:00 - so what must hold is the PARTITION, not the number: ABSENT
    # is never folded into DECLINED, which is the conflation that once moved the headline
    # in the bot's favour.
    assert m["bot_unavailable_in_window"] > 0, (
        "if nothing is unavailable the distinction is untested on real data")
    # The `declined == 0` line that stood here pinned the DEFECT, not the partition, and
    # ALGO-047's wiring falsified it (0 -> 1). The partition assertions below are what this
    # test was actually for, and they bite regardless of which way the counts go.
    assert m["bot_genuinely_declined_in_window"] >= 0
    # DERIVED: 7 at the 09:30 window, 1 at 08:00. The claim is that presence is MEASURED
    # and bounded by the corpus, not that it equals any particular number.
    assert 0 <= m["bot_entered_in_window"] <= m["sessions"]
    assert (m["bot_entered_in_window"] + m["bot_genuinely_declined_in_window"]
            + m["bot_unavailable_in_window"]) == m["sessions"]
    assert B.UNAVAILABLE in m["distinct_bot_states"]


def test_the_trader_declines_on_half_the_same_days():
    m = B.measure()
    assert m["trader_declined"] == 7 and m["trader_entered"] == 7


def test_missed_entries_is_NO_LONGER_a_tautology_after_the_F1_repair():
    """It was one only because the refuted join credited forbidden entries. Now it fires."""
    m = B.measure()
    assert m["missed_trader_entries_is_a_tautology"] is False
    assert m["bot_unavailable_in_window"] > 0, (
        "the metric is reachable precisely because the bullet is spent pre-window somewhere")


def test_direction_is_not_the_failure_when_the_bot_is_actually_present():
    """5 of 5. The old 6-of-7 counted 04-09 as an opposite call; budget-faithfully it is a MISS."""
    # DERIVED. "5 of 5" at 09:30, "1 of 1" at 08:00 - the shape that matters is that
    # DIRECTION is not the failure mode wherever the bot is actually present.
    got = B.measure()["direction_agreement_when_both_entered"]
    n, _, d = got.partition(" of ")
    assert d and int(d) > 0, f"no session had both present - the claim is untested: {got}"
    assert int(n) == int(d), (
        f"direction disagreement appeared where both were present: {got}. The failure mode "
        f"has always been ABSENCE, not direction - this changes the diagnosis.")


def test_the_tautology_flag_SETS_when_the_bot_is_never_unavailable(tmp_path):
    """POSITIVE WITNESS in the other direction, so the False above is not a constant."""
    p = _fake(tmp_path, [("ENTER_LONG", "ENTER_LONG"), ("WAIT", "ENTER_SHORT")],
              session_first="ENTER_LONG")
    m = B.measure(p)
    assert m["bot_unavailable_in_window"] == 0
    assert m["missed_trader_entries_is_a_tautology"] is True


def test_the_cross_tab_partitions_the_corpus():
    m = B.measure()
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
    # The BOT-side class here is a measurement and it MOVED with ALGO-047's wiring:
    # TRADER_DECLINED_BOT_TRADED_PRE_WINDOW -> BOT_ONLY_ENTRY_UNCENSORED_DECLINE. The wired
    # brain now takes an in-window trade on a day the trader really declined, which is a
    # WORSE result here, not a better one. Pinning either literal would pin a kernel rather
    # than the property. The property is that this case stays DECIDED and in the denominator:
    # the naive censoring rule would have removed it and flattered the headline.
    assert r["mismatch_class"] not in AGREEMENT_CLASSES, (
        "2026-04-02 is a case the bot FAILS; it must never be scored as an agreement")
    # PREFIX, not substring: the censored classes are the ones NAMED `CENSORED_*`, and a
    # substring test matches `BOT_ONLY_ENTRY_UNCENSORED_DECLINE` — whose name contains the very
    # word that means the opposite. Caught by this test on its first run.
    assert not r["mismatch_class"].startswith("CENSORED"), (
        "it ends at the window end but the trader DECIDED - censoring it out would move a "
        "failing case out of the denominator, which is the shape of a manufactured score")


def test_the_decomposition_accounts_for_every_case():
    a = U.audit()
    assert a["entered"] + a["declined_positively"] + a["undecided_right_censored"] == a["cases"]
    assert a["declared_censored"] == a["undecided_right_censored"]


@pytest.mark.parametrize("field", ["entered", "declined_positively",
                                   "undecided_right_censored"])
def test_no_bucket_is_empty(field):
    """An empty bucket would mean the partition is not exercised by this corpus."""
    assert U.audit()[field] > 0
