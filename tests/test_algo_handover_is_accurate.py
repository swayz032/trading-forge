"""The handover must be TRUE on the day it is read, not the day it was written.

ALGO-026 section 1(d). After 2026-08-27 nobody can correct it. Every factual claim it makes
about the repository is checked here against the repository, so a claim that goes stale turns
this red instead of misleading GPT months later.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

import pytest

HANDOVER = Path("ALGO-GPT-HANDOVER.md")
RUNBOOK = Path("ALGO-RUNBOOK.md")


def _text():
    """Whitespace-normalised.

    Markdown wraps lines wherever it likes, so a phrase check against the raw text is hostage
    to where a paragraph happened to break - the first version of this file failed on
    "no output
received". The document was fine; the check was brittle.
    """
    assert HANDOVER.exists(), "ALGO-026 section 1(d) deliverable"
    import re
    return re.sub(r"\s+", " ", io.open(HANDOVER, encoding="utf-8").read())


def test_every_path_it_names_actually_exists():
    """A handover that points at files that are not there is worse than none."""
    text = _text()
    for rel in ("research/current_mnq_strategy_v2_4_spec.json",
                "research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json",
                "research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json",
                "scripts/publish_algo_report.sh",
                "ALGO-RUNBOOK.md"):
        assert rel in text, f"the handover should name {rel}"
        assert Path(rel).exists(), f"the handover names {rel} but it does not exist"


def test_the_headline_number_matches_the_scorecard():
    """It says 5/8. If the exam is re-run and that moves, this must be updated."""
    sc = json.load(io.open(
        "research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json",
        encoding="utf-8"))
    agreement = sc["aggregates"]["agreement_decided_cases"]
    assert agreement in _text(), (
        f"the handover's headline does not match the scorecard's {agreement!r}")


def test_the_selectivity_claims_match_the_measurement():
    from research import current_mnq_strategy_v2_4_bot_entry_rate as B
    m = B.measure()
    text = _text()
    assert f"{m['bot_traded_at_all_in_the_session']} of {m['sessions']}" in text.replace(
        "**", ""), "the 14-of-14 claim does not match the measurement"
    assert m["bot_never_declines"] is True, (
        "the handover says the bot never genuinely declines - that is no longer true")
    assert m["direction_agreement_when_both_entered"] in text


def test_it_states_the_channel_rule_that_protects_the_main_campaign():
    text = _text()
    assert "gpt-rulings-algo" in text and "never to" in text
    assert "refuses" in text, "the publish script REFUSES rather than warns - say so"


def test_it_carries_the_three_hard_rails():
    text = _text().lower()
    assert "never" in text and "edit the frozen labels" in text
    assert "not funded, not eval, not broker-paper" in text
    assert "rpnl" in text and "off limits" in text


def test_it_records_the_silent_grader_lesson():
    """The single most expensive wrong call of the campaign."""
    text = _text()
    assert "no output received" in text
    assert "never" in text and "failed" in text


def test_the_frozen_labels_file_it_points_at_is_committed():
    """The handover calls it committed. Prove it, or GPT inherits a file in Downloads."""
    import subprocess
    r = subprocess.run(
        ["git", "ls-files", "research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json"],
        capture_output=True, text=True)
    assert r.stdout.strip(), "the handover says the labels are committed and they are not"


def test_the_runbook_it_delegates_to_exists_and_is_not_empty():
    assert RUNBOOK.exists()
    assert len(io.open(RUNBOOK, encoding="utf-8").read()) > 4000


@pytest.mark.parametrize("lesson", [
    "Check the AST, never the text",
    "green check with no path to red",
    "hand-maintained list certifies only itself",
    "comparison is not an exoneration",
])
def test_the_hard_won_lessons_are_present(lesson):
    """These cost real retractions. Losing them at handover would waste that."""
    assert lesson.lower() in _text().lower(), lesson
