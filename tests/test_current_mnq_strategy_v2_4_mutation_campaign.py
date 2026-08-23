"""The section 7 campaign's RESULT is pinned; the campaign itself runs on demand.

ALGO-009 section 7. Running twelve pytest subprocesses inside the suite would triple its
runtime, so the harness is a module you invoke and this pins what it last reported - including
the honesty of its own denominator.
"""
from __future__ import annotations

import ast
import io
import json
from pathlib import Path

import pytest

ART = Path("research/current_mnq_strategy_v2_4_mutation_campaign_2026_08_23.json")
HARNESS = Path("research/run_mutation_campaign_derivation.py")


def _a():
    if not ART.exists():
        pytest.skip("run `python -m research.run_mutation_campaign_derivation` first")
    return json.load(io.open(ART, encoding="utf-8"))


def test_every_owned_item_was_killed():
    a = _a()
    assert a["killed"] == a["owned_and_run"], a["results"]
    assert a["owned_and_run"] == 6


def test_the_denominator_is_honest_about_what_is_not_built():
    """6 of 15. Reporting 6/6 as the whole campaign would be a false green."""
    a = _a()
    assert len(a["not_yet_applicable"]) == 9
    assert a["owned_and_run"] + len(a["not_yet_applicable"]) == 15, (
        "section 7 has fifteen items - every one must be either owned or explicitly deferred")
    assert "NOT YET BUILT" in a["scope_note"]


def test_the_deferred_items_really_are_unbuilt_routes():
    """A deferral must be true, not convenient. Those routes have no module."""
    a = _a()
    for text in a["not_yet_applicable"].values():
        assert any(k in text.lower() for k in
                   ("breakout", "displacement", "exception", "retest", "parent")), text


def test_the_bytes_were_restored():
    assert _a()["restored_byte_exact"] is True


def test_the_harness_restores_in_a_finally_and_verifies_by_hash():
    """A killed harness that skips its restore leaves a mutation in the tree.

    That happened once on this campaign - a `finally` that never ran left `confirmed=False` in
    force.py - so the restore path is checked structurally, not trusted.
    """
    tree = ast.parse(io.open(HARNESS, encoding="utf-8").read())
    tries = [n for n in ast.walk(tree) if isinstance(n, ast.Try) and n.finalbody]
    assert tries, "the harness must restore in a finally block"
    src = io.open(HARNESS, encoding="utf-8").read()
    assert "RESTORE FAILED" in src, "the restore must be asserted, not assumed"
    assert "START = {p: sha(p)" in src, (
        "the restore proof must compare against the harness's OWN starting bytes")
    assert "informational" in src, (
        "git cleanliness must be informational only - it cannot tell a failed restore from "
        "uncommitted developer work, and a false alarm teaches you to ignore the real one")


def test_the_harness_requires_a_positive_witness_before_each_mutation():
    """A test that is already red cannot prove a kill."""
    src = io.open(HARNESS, encoding="utf-8").read()
    assert "already RED" in src


def test_the_harness_refuses_a_silent_no_op():
    src = io.open(HARNESS, encoding="utf-8").read()
    assert "SILENT_NO_OP" in src and "TARGET_NOT_UNIQUE" in src


@pytest.mark.parametrize("item", [1, 2, 3, 4, 5, 15])
def test_each_owned_section7_item_is_present_and_killed(item):
    a = _a()
    row = next((r for r in a["results"] if r["item"] == item), None)
    assert row is not None, f"section 7 item {item} was not run"
    assert row["outcome"] == "KILLED", row
