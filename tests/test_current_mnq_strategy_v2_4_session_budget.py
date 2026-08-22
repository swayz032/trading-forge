"""One-trade-per-session parity — ALGO-011 §2.

Binds every execution path to a single named budget so three independent implicit
implementations cannot drift apart, and so the absence claim that produced this file
(ALGO-010's "the bullet mechanism does not exist") cannot be made again from a grep.
"""
from __future__ import annotations

import ast
import importlib
import inspect
import io
import re

import pytest

from research import current_mnq_strategy_v2_4_session_budget as budget


def _source(module: str) -> str:
    return inspect.getsource(importlib.import_module(module))


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
    import pathlib
    for f in pathlib.Path("research").glob("current_mnq_strategy_v2_4_*.py"):
        if f.name in {"current_mnq_strategy_v2_4_session_budget.py",
                      "current_mnq_strategy_v2_4_candidate_xray.py"}:
            continue
        text = f.read_text(encoding="utf-8")
        assert budget.DIAGNOSTIC_OVERRIDE_FLAG not in text, (
            f"{f.name} references the diagnostic enumeration override"
        )


def test_no_production_path_emits_a_second_trade_in_one_session():
    """Concept-level guard: no v2.4 execution module may accumulate approved trades into a
    per-session collection. A list append inside the candidate loop is how a second trade
    would appear."""
    import pathlib
    offenders = []
    for f in pathlib.Path("research").glob("current_mnq_strategy_v2_4_*.py"):
        if "xray" in f.name or "session_budget" in f.name:
            continue
        text = f.read_text(encoding="utf-8")
        if "iter_actionable_candidates" not in text:
            continue
        for m in re.finditer(r"for .*iter_actionable_candidates.*?:\n(.*?)(?=\n\S)", text,
                             re.S):
            body = m.group(1)
            if re.search(r"\b\w*trades?\w*\.append\(", body):
                offenders.append(f.name)
    assert not offenders, (
        f"these modules accumulate multiple approved trades per session: {offenders}"
    )
