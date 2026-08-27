"""The arsenal inventory must be true, must author nothing, and must not run gated tools.

ALGO-029 item 5: "No new arsenal is authored; reuse and document." The load-bearing tests here
are the ones that prove this module DOESN'T do things.
"""
from __future__ import annotations

import ast
import io
from pathlib import Path

import pytest

from research import current_mnq_strategy_v2_4_validation_arsenal as V


def test_every_module_it_inventories_exists():
    """An invocation guide pointing at absent modules is worse than none."""
    a = V.assess()
    assert a["missing_modules"] == [], a["missing_modules"]
    assert a["tools"] >= 5


def test_it_authors_no_arsenal():
    """It must compute no metric. No numpy, no pandas, no statistics - it is an inventory."""
    tree = ast.parse(io.open(V.__file__, encoding="utf-8").read())
    imported = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            imported.update(x.name.split(".")[0] for x in n.names)
        elif isinstance(n, ast.ImportFrom):
            imported.add((n.module or "").split(".")[0])
    for banned in ("numpy", "pandas", "statistics", "scipy"):
        assert banned not in imported, f"an inventory does not need {banned}"


def test_it_does_not_INVOKE_any_outcome_reading_tool():
    """THE RAIL. It documents `run_sealed` and `build_edge_certificate`; it must not call them.

    They read realized results, clean edge comes after FREEZE, and no PnL may pick a rule.
    Checked on the AST because the module names them in prose deliberately.
    """
    tree = ast.parse(io.open(V.__file__, encoding="utf-8").read())
    called, imported = set(), set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Call):
            nm = getattr(n.func, "id", None) or getattr(n.func, "attr", None)
            if nm:
                called.add(nm)
        elif isinstance(n, ast.ImportFrom):
            imported.add(n.module or "")
            imported.update(x.name for x in n.names)
        elif isinstance(n, ast.Import):
            imported.update(x.name for x in n.names)
    for banned in ("run_sealed", "build_edge_certificate", "ledger_mae",
                   "mae_aware_drawdown", "load_edge_spec"):
        assert banned not in called, f"it CALLS the gated tool {banned}"
        assert banned not in imported, f"it IMPORTS the gated tool {banned}"
    for stem in V.READS_OUTCOMES:
        assert not any(stem in m for m in imported), f"it imports {stem}"


def test_every_outcome_reading_tool_is_marked_gated():
    """A tool that reads results must never be listed as runnable today."""
    for r in V.assess()["rows"]:
        if r["reads_realized_outcomes"]:
            assert r["runnable_today"] is False, r["module"]
            assert r["why_not"], f"{r['module']} is gated with no reason given"


def test_every_gated_tool_says_why():
    for r in V.assess()["rows"]:
        if not r["runnable_today"]:
            assert r["why_not"], r["module"]


def test_the_runnable_ones_really_have_no_outcome_dependency():
    for r in V.assess()["rows"]:
        if r["runnable_today"]:
            assert r["reads_realized_outcomes"] is False, r["module"]


def test_the_entry_point_finding_matches_the_repository():
    """It claims the family is libraries. Verify against the files, not the claim."""
    a = V.assess()
    assert a["with_an_entry_point"] <= 2, (
        "the finding says the arsenal has essentially no entry points - recheck it")
    assert "LIBRARIES, not commands" in a["FINDING_no_entry_points"]


def test_the_public_function_lists_are_derived_from_source():
    """Not typed. A typed list drifts the moment a function is renamed."""
    a = V.assess()
    row = next(r for r in a["rows"] if r["module"] == "current_mnq_strategy_v2_3_topstep_risk")
    assert "survival_safe_qty" in row["public_functions"]
    src = io.open(Path("research/current_mnq_strategy_v2_3_topstep_risk.py"),
                  encoding="utf-8").read()
    assert "def survival_safe_qty" in src


@pytest.mark.parametrize("rung", list(V.LADDER))
def test_every_rung_named_by_a_tool_is_a_real_rung(rung):
    assert rung in V.LADDER


def test_no_tool_claims_a_rung_outside_the_ladder():
    for r in V.assess()["rows"]:
        assert r["rung"] in V.LADDER, r
