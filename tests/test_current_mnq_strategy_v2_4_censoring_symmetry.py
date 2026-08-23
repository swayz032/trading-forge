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

from research.run_frozen_14_case_baseline import AGREEMENT_CLASSES

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


def _recomputed_headline(doc) -> str:
    """The headline, RE-DERIVED from the case rows. Nothing here reads a summary field.

    F-4/F-5 (arena grade 2026-08-23): every assertion in this file used to read the artifact's
    own summary and check it against ANOTHER summary field. A 14-mutation battery walked
    straight through: inflating the numerator to 7/8 stayed green, claiming a perfect 8/8
    stayed green, and re-classifying one MISSED_TRADER_ENTRY as AGREE — the realistic shape of
    a future generosity bug — stayed green at 6/8. The pattern that closes it was already in
    this file; I had not applied it to the figure that matters.
    """
    unc = [c for c in doc["cases"] if not c["trader_label_censored"]]
    hits = sum(1 for c in unc if c["mismatch_class"] in AGREEMENT_CLASSES)
    return f"{hits}/{len(unc)}"


def test_the_headline_is_RECOMPUTED_from_the_cases_not_read_off_the_summary():
    """The one test the mutation battery could not walk through."""
    doc = json.load(io.open(SCORECARD, encoding="utf-8"))
    assert doc["aggregates"]["agreement_decided_cases"] == _recomputed_headline(doc), (
        "the published headline disagrees with what its own case rows produce")


def test_the_scorecard_ARTIFACT_EXISTS_and_deletion_is_caught_deliberately():
    """F-11 (arena grade): deleting the artifact went red only because ONE test happened to
    open it directly and bypass `_agg()`'s `pytest.skip`. Tidy that inconsistency away and
    deletion becomes a green run of skips. A guard that works by accident is not a guard, so
    the existence check is now its own assertion and does not skip.
    """
    assert SCORECARD.exists(), (
        f"{SCORECARD} is missing - every number in this file is unverifiable. This is a "
        f"FAILURE, not a skip: a deleted artifact must never read as a passing run.")


def test_the_scorecard_ARTIFACT_EXISTS_and_deletion_is_caught_deliberately():
    """F-11 (arena grade): deleting the artifact went red only because ONE test happened to
    open it directly and bypass `_agg()`'s `pytest.skip`. Tidy that inconsistency away and
    deletion becomes a green run of skips. A guard that works by accident is not a guard, so
    the existence check is now its own assertion and does not skip.
    """
    assert SCORECARD.exists(), (
        f"{SCORECARD} is missing - every number in this file is unverifiable. This is a "
        f"FAILURE, not a skip: a deleted artifact must never read as a passing run.")


def test_the_published_headline_is_the_STRICTER_reading():
    """The stricter reading counts bot-unavailable sessions AGAINST the bot.

    The previous version of this test compared two character-identical expressions in the
    emitter — it asserted `X == X` and could only ever catch a hand-edit. It now recomputes
    the strict headline from the cases and checks the diagnostic against THAT.
    """
    doc = json.load(io.open(SCORECARD, encoding="utf-8"))
    d = _diag()
    assert d["headline_as_published_stricter_reading"] == _recomputed_headline(doc)
    assert doc["aggregates"]["uncensored_case_count"] == \
        sum(1 for c in doc["cases"] if not c["trader_label_censored"])


def test_the_symmetric_reading_is_recorded_but_NOT_adopted():
    d = _diag()
    assert d["STATUS"] == "DIAGNOSTIC_ONLY_NOT_THE_HEADLINE"
    assert d["if_bot_side_were_censored_symmetrically"] != \
        d["headline_as_published_stricter_reading"], (
        "if the two readings agreed there would be nothing to rule on and this would be dead "
        "paperwork - delete it rather than carry it")


def test_the_symmetric_reading_is_the_one_that_FLATTERS_the_bot():
    """Stated as an arithmetic fact, because it is the reason the worker may not adopt it.

    The grade showed this could not fail on a genuine re-run: every symmetric-excluded session
    carries BUDGET_CONSUMED_BEFORE_WINDOW, which never maps into AGREEMENT_CLASSES, so the
    numerator is identical in both readings and the ratio was fixed for any numerator >= 1.
    True, but it made the test a restatement of arithmetic rather than a check.

    So the CLASSIFIER PROPERTY underneath it is now asserted directly — that is the thing that
    would actually have to break — and it can go red.
    """
    d = _diag()
    doc = json.load(io.open(SCORECARD, encoding="utf-8"))

    def rate(x):
        n, m = x.split("/")
        return int(n) / int(m)

    assert rate(d["if_bot_side_were_censored_symmetrically"]) > \
        rate(d["headline_as_published_stricter_reading"])
    assert "flatters" in d["why_it_is_not_adopted"]

    # THE PROPERTY: no session excluded by the symmetric reading is an agreement. If one ever
    # were, excluding it would REMOVE a hit and the symmetric reading would stop flattering -
    # which is exactly the condition this test should notice.
    excluded = set(d["sessions_where_the_bot_had_no_in_window_decision"])
    for c in doc["cases"]:
        if c["session"] in excluded:
            assert c["mismatch_class"] not in AGREEMENT_CLASSES, (
                f'{c["session"]} is both bot-unavailable and scored as an agreement - the '
                f'symmetric reading no longer merely flatters, it changes the numerator')


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

    UNTIL THE F-1 REPAIR THIS WAS UNFALSIFIABLE. The state it counts was unreachable, so the
    zero was a construction and this test pinned a number that could not move. The regrade now
    emits `budget_faithful` on the no-decision branch, so a genuinely declining session would
    make this go red. The claim is unchanged; it is now actually tested.
    """
    assert _agg()["bot_genuinely_declined_in_window_count"] == 0


def test_the_diagnostic_says_out_loud_that_it_is_not_a_worker_decision():
    src = io.open(BASELINE, encoding="utf-8").read()
    assert "ALGO question, not a worker decision" in src
    assert "may not be adopted by the party it flatters" in src
