"""Guards for MNQ-SR-CLEANROOM-v2, the frozen runnable build.

EVERY CHECK HERE IS AST-BASED, NEVER SUBSTRING. The module's own docstring names the artifacts it
promises not to read, so a substring search over the file finds them and convicts the docstring
that made the promise. This campaign walked into that trap twice - once on
`except Exception: return 0.5`, once on the v1 cleanroom docstring - and both times the guard was
green or red for a reason that had nothing to do with the code.
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parents[1] / "research" / "mnq_sr_cleanroom_v2.py"


def _code_tree() -> ast.Module:
    """The module with its docstring REMOVED, so prose cannot satisfy or break a check."""
    tree = ast.parse(SRC.read_text(encoding="utf-8"))
    body = list(tree.body)
    if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
            and isinstance(body[0].value.value, str):
        body = body[1:]
    return ast.Module(body=body, type_ignores=[])


def _code_strings() -> list[str]:
    return [n.value for n in ast.walk(_code_tree())
            if isinstance(n, ast.Constant) and isinstance(n.value, str)]


FORBIDDEN = ("replay", "algo1", "labels_frozen", "case_manifest", "scorecard", "trader_zones")


def test_no_replay_artifact_reachable_from_code():
    """The fourteen sessions are out of scope (ALGO-164). Checked on CODE, not on prose."""
    hits = [s for s in _code_strings()
            if any(f in s.lower() for f in FORBIDDEN)]
    assert hits == [], f"code references a held-out artifact: {hits}"


def test_positive_control_the_scan_can_actually_see_code_strings():
    """A zero result must be evidence about the code, not about a broken scan.

    Without this, `test_no_replay_artifact_reachable_from_code` is green when the extractor
    returns nothing at all - the population failure that has been the single most common way a
    guard in this campaign was green for the wrong reason.
    """
    strings = _code_strings()
    assert strings, "the AST string extractor returned NOTHING - the absence check is vacuous"
    assert any(s in ("L", "S", "STOP", "TARGET") for s in strings), \
        f"extractor did not see known code strings; got {strings[:10]}"


def test_imports_cannot_reach_a_replay_artifact():
    mods = set()
    for n in ast.walk(_code_tree()):
        if isinstance(n, ast.Import):
            mods.update(a.name for a in n.names)
        elif isinstance(n, ast.ImportFrom) and n.module:
            mods.add(n.module)
    assert mods == {"__future__", "dataclasses", "pandas", "research.mnq_sr_cleanroom_v1"}, mods


def test_the_reference_R_enters_no_predicate():
    """3.83 is a REPORTING REFERENCE. If it ever reaches a comparison or arithmetic node, the
    target rule has stopped being structural and became a fixed multiple - the exact thing the
    standing order forbids ("his figures go in the report, not in the code")."""
    for node in ast.walk(_code_tree()):
        if isinstance(node, (ast.Compare, ast.BinOp)):
            for sub in ast.walk(node):
                if isinstance(sub, ast.Name) and sub.id == "R_REFERENCE":
                    pytest.fail("R_REFERENCE reached a predicate/arithmetic node")
                if isinstance(sub, ast.Constant) and sub.value == 3.83:
                    pytest.fail("the literal 3.83 reached a predicate/arithmetic node")


def test_no_magnitude_thresholds_crept_into_the_entry_rules():
    """Every trigger must be structural - a comparison against a BAR FIELD or a zone edge, never
    against a tuned float. The only floats allowed in the module are the cited constants."""
    import research.mnq_sr_cleanroom_v2 as V2
    allowed = {17.25, 3.83, 0.0, 1.0}
    floats = {n.value for n in ast.walk(_code_tree())
              if isinstance(n, ast.Constant) and isinstance(n.value, float)}
    assert floats <= allowed, f"uncited magnitude(s) in the module: {floats - allowed}"
    assert V2.STOP_POINTS == 17.25
    assert V2.MAX_TRADES_PER_SESSION == 1


def test_stop_wins_a_same_bar_tie():
    """The declared pessimistic convention must actually be the code's order of evaluation."""
    src = SRC.read_text(encoding="utf-8")
    i_stop, i_tgt = src.index("if hit_stop:"), src.index("if hit_tgt:")
    assert i_stop < i_tgt, "target is checked before stop - the fill model is optimistic"
