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


def test_the_affected_sessions_are_DERIVED_and_there_are_three_of_them():
    """The grader's note said two. Measured against the artifact it is three.

    A hand-typed list would have inherited the two, and the third would never have surfaced.
    """
    d = _diag()
    sessions = d["sessions_where_the_bot_had_no_in_window_decision"]
    assert sessions == ["2026-03-23", "2026-04-02", "2026-04-09"], sessions


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
