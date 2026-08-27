"""One-trade-per-session parity — ALGO-011 §2.

Binds every execution path to a single named budget so three independent implicit
implementations cannot drift apart, and so the absence claim that produced this file
(ALGO-010's "the bullet mechanism does not exist") cannot be made again from a grep.
"""
from __future__ import annotations

import ast
import pathlib
import importlib
import inspect
import io
import re

import pytest

from research import current_mnq_strategy_v2_4_session_budget as budget


def _source(module: str) -> str:
    return inspect.getsource(importlib.import_module(module))


# ---- F-5 REPAIR (ALGO-020 section 1 item 5) ----------------------------------------------
# Both guards below globbed `pathlib.Path("research")`, which is RELATIVE TO THE CWD. Run from
# the parent directory they scanned ZERO FILES and still passed. A guard over an empty
# population is a green check with no path to red. The path is now anchored to this file, and
# every loop asserts it actually enumerated something.
_RESEARCH = pathlib.Path(__file__).resolve().parent.parent / "research"


def _v24_modules():
    mods = sorted(_RESEARCH.glob("current_mnq_strategy_v2_4_*.py"))
    assert mods, f"no v2.4 modules found under {_RESEARCH} - the guard would be vacuous"
    return mods


def _assert_enumerated(n, floor=1):
    assert n >= floor, (
        f"the guard scanned {n} files - it proved nothing. Population empty or misfiltered.")


def _is_diagnostic(text):
    """A module escapes the production guard only by SAYING it is diagnostic."""
    head = text[:2000].upper()
    return "DIAGNOSTIC ONLY" in head or "DIAGNOSTIC_ONLY" in head


def test_the_budget_is_one_and_is_not_a_tunable():
    assert budget.MAX_FULLY_APPROVED_EXECUTED_TRADES_PER_SESSION == 1
    assert budget.budget_for_session() == 1
    src = _source("research.current_mnq_strategy_v2_4_session_budget")
    assert "Not a tunable" in src


def test_every_named_enforcement_site_still_exists():
    """The sites are a claim about the repository. If one is renamed or deleted, the
    invariant may have silently moved and this must go red."""
    for name, site in budget.ENFORCEMENT_SITES.items():
        mod = importlib.import_module(site["module"])
        sym = site["symbol"]
        if "." in sym:
            cls, attr = sym.split(".", 1)
            assert hasattr(mod, cls), f"{name}: {cls} missing from {site['module']}"
            assert hasattr(getattr(mod, cls), attr), f"{name}: {sym} missing"
        else:
            assert hasattr(mod, sym), f"{name}: {sym} missing from {site['module']}"


def test_historical_analysis_returns_inside_the_candidate_loop():
    """The mechanism IS control flow — a `return` inside `for ... iter_actionable_candidates`.
    This is exactly what a vocabulary grep cannot see, which is how I concluded absence."""
    src = _source("research.current_mnq_strategy_v2_4_engine")
    fn = next(n for n in ast.parse(src).body
              if isinstance(n, ast.FunctionDef) and n.name == "_analysis_run_day")
    loops = [n for n in ast.walk(fn) if isinstance(n, ast.For)]
    assert loops, "_analysis_run_day no longer iterates candidates"
    returning = [n for lp in loops for n in ast.walk(lp)
                 if isinstance(n, ast.Return) and n.value is not None]
    assert returning, (
        "_analysis_run_day no longer returns a value from inside the candidate loop - the "
        "implicit one-trade budget on the historical path may have been removed"
    )


def test_shadow_runtime_keeps_its_explicit_budget_guard():
    """The only site where the budget is explicit. It must stay explicit."""
    src = _source("research.current_mnq_strategy_v2_4_shadow_runtime")
    assert "DAILY_BULLET_ALREADY_RESOLVED" in src
    assert "_session_consumed" in src


def test_signal_path_returns_only_the_first_actionable():
    src = _source("research.current_mnq_strategy_v2_4_signal")
    assert "def find_first_actionable_signal" in src


def test_the_retraction_of_the_absence_claim_stays_on_record():
    """A false claim quietly deleted teaches nobody, and this one was published."""
    src = _source("research.current_mnq_strategy_v2_4_session_budget")
    assert "does not exist" in src and "the conclusion was wrong" in src
    assert "RETURN_INSIDE_CANDIDATE_LOOP" in src
    assert "HAS NO NAME TO GREP FOR" in src


def test_the_diagnostic_override_cannot_touch_production():
    """The X-ray may see past the budget. Nothing else may, and it may never be cited as
    evidence the budget is absent."""
    assert budget.is_diagnostic_enumeration() is False
    assert budget.is_diagnostic_enumeration(enumerate_all_candidates=True) is True
    assert "MUST NOT change production behaviour" in budget.DIAGNOSTIC_ONLY

    # No production module may set the override.
    scanned = 0
    for f in _v24_modules():
        if f.name in {"current_mnq_strategy_v2_4_session_budget.py",
                      "current_mnq_strategy_v2_4_candidate_xray.py"}:
            continue
        scanned += 1
        text = f.read_text(encoding="utf-8")
        assert budget.DIAGNOSTIC_OVERRIDE_FLAG not in text, (
            f"{f.name} references the diagnostic enumeration override"
        )
    _assert_enumerated(scanned)


def _appends_inside_the_candidate_loop(text):
    """Every `.append(...)` inside a `for ... in iter_actionable_candidates(...)` body."""
    hits = []
    for node in ast.walk(ast.parse(text)):
        if not isinstance(node, ast.For):
            continue
        it = node.iter
        name = None
        if isinstance(it, ast.Call):
            name = getattr(it.func, "id", None) or getattr(it.func, "attr", None)
        if name != "iter_actionable_candidates":
            continue
        for sub in ast.walk(node):
            if (isinstance(sub, ast.Call) and isinstance(sub.func, ast.Attribute)
                    and sub.func.attr == "append"):
                hits.append(sub.lineno)
    return hits


def test_no_production_path_emits_a_second_trade_in_one_session():
    """Concept-level guard, STRUCTURAL not textual.

    The previous version grepped for a collection whose NAME contained "trade". The grader
    planted two semantically identical second-trade emitters inside the candidate loop:
    `trades.append(cand)` was caught and `approved_entries_for_session.append(cand)` went
    green. The module's own docstring says why that had to happen -
    A RULE IMPLEMENTED AS CONTROL FLOW HAS NO NAME TO GREP FOR - and the guard was grepping
    for a name.

    This walks the AST instead: any `.append(...)` anywhere inside the candidate loop is an
    accumulation, whatever the collection is called.
    """
    offenders, scanned = [], 0
    for f in _v24_modules():
        text = f.read_text(encoding="utf-8")
        if "iter_actionable_candidates" not in text or _is_diagnostic(text):
            continue
        scanned += 1
        offenders += [f"{f.name}:{ln}" for ln in _appends_inside_the_candidate_loop(text)]
    _assert_enumerated(scanned)
    assert not offenders, (
        f"these accumulate multiple approved trades per session: {offenders}")


def test_the_structural_guard_CATCHES_what_the_grep_missed():
    """RED-PROOF on a synthetic module: the exact plant that went green before."""
    src = (
        "from research.current_mnq_strategy_v2_4_kernel import iter_actionable_candidates\n"
        "def go(env, dte, p):\n"
        "    approved_entries_for_session = []\n"
        "    for cand, actionable, plan in iter_actionable_candidates(env, dte, p):\n"
        "        approved_entries_for_session.append(cand)\n"
    )
    assert _appends_inside_the_candidate_loop(src), (
        "the structural guard must catch an append the old regex missed because the "
        "collection is not named 'trades'")
    # NEGATIVE CONTROL: an append OUTSIDE the candidate loop is not an offence.
    outside = (
        "from research.current_mnq_strategy_v2_4_kernel import iter_actionable_candidates\n"
        "def go(xs):\n"
        "    out = []\n"
        "    for x in xs:\n"
        "        out.append(x)\n"
    )
    assert not _appends_inside_the_candidate_loop(outside)


def test_the_diagnostic_exemption_is_narrow_and_declared():
    """A module escapes the guard only by DECLARING itself diagnostic in its docstring."""
    exempt = [f.name for f in _v24_modules()
              if "iter_actionable_candidates" in f.read_text(encoding="utf-8")
              and _is_diagnostic(f.read_text(encoding="utf-8"))]
    assert len(exempt) <= 3, f"the diagnostic exemption is growing: {exempt}"
    for name in exempt:
        assert any(k in name for k in ("xray", "regrade", "ablation")), (
            f"{name} claims a diagnostic exemption but is not a known diagnostic")
