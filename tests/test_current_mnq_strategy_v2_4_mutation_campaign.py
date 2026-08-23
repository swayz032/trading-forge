"""The section 7 campaign's RESULT is pinned; the campaign itself runs on demand.

ALGO-009 section 7. Running sixteen pytest subprocesses inside the suite would triple its
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


def test_every_mutation_was_killed():
    a = _a()
    assert a["killed"] == a["mutations_run"], a["results"]


def test_all_fifteen_section7_items_are_now_owned():
    """Items 6-14 became runnable when routes B/C/D were built on 2026-08-23.

    Until then they were deferred BY NAME. The denominator was never quietly shrunk, and this
    asserts the arithmetic still closes now that it has grown.
    """
    a = _a()
    assert a["owned_and_run"] == 15
    assert len(a["not_yet_applicable"]) == 0
    assert a["owned_and_run"] + len(a["not_yet_applicable"]) == 15, (
        "section 7 has fifteen items - every one must be either owned or explicitly deferred")


def test_there_are_MORE_mutations_than_items_and_that_is_deliberate():
    """An item with two doors needs two kills, or the repair closed only the shown instance."""
    a = _a()
    assert a["mutations_run"] > a["owned_and_run"]
    assert a["items_with_two_doors"], (
        "at least one item must be attacked through more than one door")


def test_item_14_carries_its_caveat_because_its_guard_is_ARCHITECTURAL():
    """A kill whose scope is overstated is a false green.

    14's defence is that no function ever receives the forming parent's finished OHLC. The
    mutation proves that split is load-bearing - not that some other layer refuses a backdated
    entry clock. The artifact must say so.
    """
    a = _a()
    assert "14" in a["caveats"]
    assert "structurally" in a["caveats"]["14"]


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


@pytest.mark.parametrize("item", list(range(1, 16)))
def test_each_section7_item_is_present_and_every_door_killed(item):
    """Enumerated over all fifteen, so a vanished item fails instead of going unnoticed."""
    a = _a()
    rows = [r for r in a["results"] if r["item"] == item]
    assert rows, f"section 7 item {item} was not run"
    for row in rows:
        assert row["outcome"] == "KILLED", row
