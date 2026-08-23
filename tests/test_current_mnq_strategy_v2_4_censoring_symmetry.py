"""The censoring is asymmetric, the headline does not say so, and neither may drift.

A trader who never rendered a decision is removed from BOTH numerator and denominator — that
is the F-1 repair and it is right. A BOT that never rendered a decision inside the window (its
daily bullet was already spent before the window opened) is left in the denominator and scored
as a disagreement. The same argument that excuses one excuses the other.

Surfaced by the independent grader as "prose selects 8, flags select 6". Measured, it is
**three** sessions, not two.

**THE SYMMETRIC READING FLATTERS THE BOT — 5/5 INSTEAD OF 5/8 — WHICH IS EXACTLY WHY IT IS NOT
ADOPTED HERE.** A party may not pick the reading that favours it, and the standing rule of this
lane is that the stricter reading holds while the textbook is silent. These tests pin BOTH
numbers so that the published headline cannot quietly become the flattering one, and so the
diagnostic cannot quietly disappear either.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

import pytest

SCORECARD = Path("research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json")
BASELINE = Path("research/run_frozen_14_case_baseline.py")


def _agg():
    if not SCORECARD.exists():
        pytest.skip("run `python -m research.run_frozen_14_case_baseline` first")
    return json.load(io.open(SCORECARD, encoding="utf-8"))["aggregates"]


def _diag():
    a = _agg()
    assert "asymmetric_censoring_diagnostic" in a, (
        "the asymmetry must stay VISIBLE - removing the diagnostic makes the choice implicit "
        "again, which is the condition the grader had to discover by hand")
    return a["asymmetric_censoring_diagnostic"]


def test_the_published_headline_is_the_STRICTER_reading():
    """5/8. The bot's unavailable sessions still count against it until ruled otherwise."""
    a = _agg()
    d = _diag()
    assert a["agreement_decided_cases"] == d["headline_as_published_stricter_reading"]
    assert a["uncensored_case_count"] == 8


def test_the_symmetric_reading_is_recorded_but_NOT_adopted():
    d = _diag()
    assert d["STATUS"] == "DIAGNOSTIC_ONLY_NOT_THE_HEADLINE"
    assert d["if_bot_side_were_censored_symmetrically"] != \
        d["headline_as_published_stricter_reading"], (
        "if the two readings agreed there would be nothing to rule on and this would be dead "
        "paperwork - delete it rather than carry it")


def test_the_symmetric_reading_is_the_one_that_FLATTERS_the_bot():
    """Stated as an arithmetic fact, because it is the reason the worker may not adopt it."""
    d = _diag()

    def rate(s):
        n, m = s.split("/")
        return int(n) / int(m)

    assert rate(d["if_bot_side_were_censored_symmetrically"]) > \
        rate(d["headline_as_published_stricter_reading"])
    assert "flatters" in d["why_it_is_not_adopted"]


def test_the_affected_sessions_are_DERIVED_not_typed():
    """The grader's note said two. Measured at the 09:30 window it was THREE.

    A hand-typed list would have inherited the grader's pair and never surfaced 03-23. It
    would ALSO have frozen at three - and the 08:00 window amendment took it to SEVEN. So the
    list is asserted to be derived and self-consistent, never to equal a literal: the count is
    a function of the window, and pinning it to a number pins the wrong thing.
    """
    d = _diag()
    sessions = d["sessions_where_the_bot_had_no_in_window_decision"]
    assert sessions == sorted(set(sessions)), "must be sorted and unique"
    assert sessions, (
        "an empty list would mean the asymmetry vanished - that is a real finding, not a "
        "passing test; delete the diagnostic rather than let it pass empty")
    # It may never exceed the uncensored population it is drawn from.
    assert len(sessions) <= _agg()["uncensored_case_count"]


def test_the_window_amendment_made_the_asymmetry_WORSE_not_better():
    """08:00 gives an over-permissive brain 90 more minutes to spend its one bullet.

    Measured: bot-unavailable sessions went 3 -> 7 and the headline 5/8 -> 1/8. Recorded here
    because the amendment's COST is the thing most likely to be forgotten if it is reverted.
    """
    a = _agg()
    assert a["bot_unavailable_in_window_count"] >= a["bot_entered_in_window_count"], (
        "if the bot is present more often than it is absent, the window cost has been paid "
        "back and this test should be revisited")


def test_every_named_session_really_had_no_in_window_bot_decision():
    """The list must be true of the cases, not merely present in the summary."""
    doc = json.load(io.open(SCORECARD, encoding="utf-8"))
    named = set(_diag()["sessions_where_the_bot_had_no_in_window_decision"])
    for c in doc["cases"]:
        unavailable = (c.get("bot_state_in_window") == "BUDGET_CONSUMED_BEFORE_WINDOW"
                       and not c["trader_label_censored"])
        assert (c["session"] in named) == unavailable, c["session"]


def test_the_bot_still_never_genuinely_declines():
    """The defect this whole phase exists to kill, restated from the artifact.

    Whichever denominator wins, `bot_genuinely_declined_in_window_count` is 0 - the entry
    decision is still a constant, and no censoring convention changes that.
    """
    assert _agg()["bot_genuinely_declined_in_window_count"] == 0


def test_the_diagnostic_says_out_loud_that_it_is_not_a_worker_decision():
    src = io.open(BASELINE, encoding="utf-8").read()
    assert "ALGO question, not a worker decision" in src
    assert "may not be adopted by the party it flatters" in src
