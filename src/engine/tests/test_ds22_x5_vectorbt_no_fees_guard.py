"""Deep-scan #22 Track X5 — failure-injection sweep, Control #3 (vectorbt
must never receive fees/slippage for futures — CLAUDE.md §13, project mandate:
"Never pass slippage/fees to vectorbt for futures — compute P&L yourself").

This module implements and exercises a static-analysis guard
(`_scan_for_forbidden_vbt_kwargs`) via Python's `ast` module — no vectorbt
import required (mirrors the project's documented pattern for vectorbt-JIT
avoidance: "mock sys.modules or use AST parse for signature tests").

Covers:
  1. Clean path: both real `vbt.Portfolio.from_signals(...)` call sites in
     `src/engine/backtester.py` carry ZERO forbidden kwargs today.
  2. Fault injection: a synthetic source string with `fees=` (and separately
     `slippage=`) injected into a `from_signals(...)` call IS caught by the
     scanner — RED-proving the guard actually inspects kwargs rather than
     vacuously passing on any input.
  3. The guard is call-specific: a `fees=` kwarg on an unrelated function call
     (not `from_signals`) must NOT false-positive.
  4. Full-repo sweep: no `from_signals(` call anywhere under `src/engine/`
     carries a forbidden kwarg (guards against a future third call site being
     added without the same discipline).
"""

from __future__ import annotations

import ast
from pathlib import Path

_ENGINE_ROOT = Path(__file__).resolve().parents[1]  # src/engine
_BACKTESTER_PATH = _ENGINE_ROOT / "backtester.py"

# vectorbt's actual anti-pattern kwarg names for from_signals — passing any of
# these means vectorbt (not our own P&L math) is computing cost/slippage.
_FORBIDDEN_KWARGS = {
    "fees", "fixed_fees", "slippage",
}


def _scan_for_forbidden_vbt_kwargs(source: str) -> list[dict]:
    """AST-scan `source` for calls whose callee attribute chain ends in
    `from_signals` and flag any forbidden kwarg present on that call.

    Returns a list of violation dicts: {"lineno": int, "kwarg": str}.
    Pure source-text analysis — never imports vectorbt.
    """
    tree = ast.parse(source)
    violations: list[dict] = []

    class _Visitor(ast.NodeVisitor):
        def visit_Call(self, node: ast.Call) -> None:
            func = node.func
            callee_name = None
            if isinstance(func, ast.Attribute):
                callee_name = func.attr
            elif isinstance(func, ast.Name):
                callee_name = func.id

            if callee_name == "from_signals":
                for kw in node.keywords:
                    if kw.arg in _FORBIDDEN_KWARGS:
                        violations.append({"lineno": node.lineno, "kwarg": kw.arg})

            self.generic_visit(node)

    _Visitor().visit(tree)
    return violations


class TestCleanPathRealBacktesterHasZeroViolations:
    def test_backtester_from_signals_call_sites_are_clean(self):
        source = _BACKTESTER_PATH.read_text(encoding="utf-8")
        violations = _scan_for_forbidden_vbt_kwargs(source)
        assert violations == [], (
            f"backtester.py passes forbidden fee/slippage kwargs to "
            f"vbt.Portfolio.from_signals(): {violations}. CLAUDE.md §13 mandate: "
            "compute futures P&L yourself, never delegate cost modeling to vectorbt."
        )

    def test_backtester_has_at_least_two_from_signals_call_sites(self):
        """Sanity: the scanner must actually be looking at real call sites, not
        vacuously passing on an empty match set (DSL path + class path)."""
        source = _BACKTESTER_PATH.read_text(encoding="utf-8")
        tree = ast.parse(source)
        count = sum(
            1 for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and (
                (isinstance(node.func, ast.Attribute) and node.func.attr == "from_signals")
                or (isinstance(node.func, ast.Name) and node.func.id == "from_signals")
            )
        )
        assert count >= 2, (
            f"Expected >= 2 from_signals() call sites in backtester.py (DSL + class "
            f"paths); found {count}. If this legitimately dropped to <2, the guard "
            "above may not be scanning the paths it claims to."
        )


class TestFaultInjectionCatchesForbiddenKwargs:
    """RED-proof: inject the anti-pattern into a synthetic source string and
    confirm the scanner actually flags it."""

    def test_fees_kwarg_is_caught(self):
        fixture_source = """
import vectorbt as vbt

def run():
    pf = vbt.Portfolio.from_signals(
        close=close_pd,
        entries=entries_pd,
        exits=exits_pd,
        size=sizes_clean,
        fees=0.001,
        freq="5min",
    )
    return pf
"""
        violations = _scan_for_forbidden_vbt_kwargs(fixture_source)
        assert len(violations) == 1
        assert violations[0]["kwarg"] == "fees"

    def test_slippage_kwarg_is_caught(self):
        fixture_source = """
import vectorbt as vbt

def run():
    pf = vbt.Portfolio.from_signals(
        close=close_pd, entries=entries_pd, exits=exits_pd,
        slippage=0.0005,
    )
    return pf
"""
        violations = _scan_for_forbidden_vbt_kwargs(fixture_source)
        assert len(violations) == 1
        assert violations[0]["kwarg"] == "slippage"

    def test_both_fees_and_slippage_caught_in_same_call(self):
        fixture_source = """
import vectorbt as vbt

pf = vbt.Portfolio.from_signals(
    close=c, entries=e, exits=x, fees=0.001, slippage=0.0005,
)
"""
        violations = _scan_for_forbidden_vbt_kwargs(fixture_source)
        kwargs_found = {v["kwarg"] for v in violations}
        assert kwargs_found == {"fees", "slippage"}

    def test_fees_on_unrelated_call_is_not_a_false_positive(self):
        """A `fees=` kwarg on some OTHER function (not from_signals) must not
        be flagged — the guard is call-specific, not a blind grep."""
        fixture_source = """
def compute_commission(fees=0.62):
    return fees * 2

def unrelated_call():
    return compute_commission(fees=1.24)
"""
        violations = _scan_for_forbidden_vbt_kwargs(fixture_source)
        assert violations == [], (
            f"False positive: guard flagged a non-from_signals call: {violations}"
        )


class TestFullRepoSweep:
    """Guard against a THIRD from_signals() call site being added anywhere
    under src/engine/ without the same fees/slippage discipline."""

    def test_no_forbidden_kwargs_anywhere_under_src_engine(self):
        offenders: list[str] = []
        for py_file in _ENGINE_ROOT.rglob("*.py"):
            if "tests" in py_file.parts:
                continue
            try:
                source = py_file.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            if "from_signals" not in source:
                continue
            violations = _scan_for_forbidden_vbt_kwargs(source)
            if violations:
                offenders.append(f"{py_file.relative_to(_ENGINE_ROOT)}: {violations}")

        assert offenders == [], (
            f"Forbidden vectorbt fee/slippage kwargs found outside backtester.py: "
            f"{offenders}"
        )
