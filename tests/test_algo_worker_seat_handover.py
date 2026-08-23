"""The worker handover must be true and must not duplicate the GPT one.

ALGO-026 section 1(e). Two handovers exist for two different readers; each must point at the
other rather than half-answering for both.
"""
from __future__ import annotations

import io
import re
from pathlib import Path

import pytest

WORKER = Path("ALGO-WORKER-SEAT-HANDOVER.md")
GPT = Path("ALGO-GPT-HANDOVER.md")
RUNBOOK = Path("ALGO-RUNBOOK.md")


def _text(p=WORKER):
    assert p.exists(), f"{p} is an ALGO-026 section 1 deliverable"
    return re.sub(r"\s+", " ", io.open(p, encoding="utf-8").read())


def test_all_three_documents_exist():
    for p in (WORKER, GPT, RUNBOOK):
        assert p.exists(), p


def test_it_sends_gpt_to_the_other_document():
    """Two readers, two documents. Neither should half-answer for the other."""
    assert "ALGO-GPT-HANDOVER.md" in _text()


def test_every_module_it_names_exists():
    text = _text()
    for stem in ("current_mnq_strategy_v2_4_derivation",
                 "current_mnq_strategy_v2_4_entry_authority",
                 "run_derivation_checkpoint",
                 "run_mutation_campaign_derivation"):
        assert stem in text, f"the handover should name {stem}"
        assert Path(f"research/{stem}.py").exists(), f"names {stem} but it does not exist"


def test_the_build_only_claim_is_still_true():
    """It tells the next seat these are not wired. If that changes, this must too."""
    import ast
    for mod in ("current_mnq_strategy_v2_4_kernel", "current_mnq_strategy_v2_4_entries"):
        tree = ast.parse(io.open(f"research/{mod}.py", encoding="utf-8").read())
        for n in ast.walk(tree):
            mods = []
            if isinstance(n, ast.ImportFrom):
                mods = [n.module or ""]
            elif isinstance(n, ast.Import):
                mods = [a.name for a in n.names]
            for m in mods:
                assert "v2_4_derivation" not in m and "entry_authority" not in m, (
                    f"{mod} now imports the new layers - the handover says they are BUILD ONLY")


def test_the_selectivity_numbers_match_the_measurement():
    from research import current_mnq_strategy_v2_4_bot_entry_rate as B
    m = B.measure()
    text = _text().replace("**", "")
    assert f"{m['bot_traded_at_all_in_the_session']} of {m['sessions']}" in text
    assert m["direction_agreement_when_both_entered"] in text


def test_the_headline_matches_the_scorecard():
    import json
    sc = json.load(io.open(
        "research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json",
        encoding="utf-8"))
    assert sc["aggregates"]["agreement_decided_cases"] in _text()


def test_the_window_hazard_is_carried_with_its_line_number():
    """The single most dangerous thing the next seat could get wrong."""
    text = _text()
    assert "kernel.py:132" in text
    assert "ROLE 1 only" in text.replace("**", "")
    assert "find-and-replace" in text


def test_it_states_why_the_new_layers_are_not_wired():
    text = _text()
    assert "ALGO-029" in text and "accepted" in text.lower()
    assert "grade" in text.lower()


@pytest.mark.parametrize("rail", [
    "DRAFT / DO NOT MERGE",
    "Never edit",
    "not funded, not eval, not broker-paper",
    "refuses rather than warns",
])
def test_the_rails_are_present(rail):
    assert rail.lower() in _text().lower(), rail


@pytest.mark.parametrize("lesson", [
    "Check the AST, never the text",
    "green check with no path to red",
    "hand-maintained list certifies only itself",
    "no output received",
    "Enumerate before you commit",
    "no exempt category",
])
def test_the_convictions_survive_the_seat(lesson):
    assert lesson.lower() in _text().lower(), lesson


def test_it_names_the_expected_failure_count():
    assert "7 failures" in _text()
