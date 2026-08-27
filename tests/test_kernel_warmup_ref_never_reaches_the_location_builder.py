"""ALGO-175 proof obligation: `warmup_ref` never reaches the location builder.

The ALGO-174 repair left ONE 09:30 stamp alive in `iter_actionable_candidates`, renamed
`warmup_ref`. The claim attached to it — *"it asks whether enough HISTORY exists to score the day
at all; it never reaches the location set"* — is a MECHANISM CLAIM, and a mechanism claim asserted
in prose is exactly what this campaign keeps getting wrong. This file discharges it by AST, so the
claim is checked on every run rather than believed once.

WHAT IS PROVEN, and it is deliberately stronger than "the name does not appear in the call":
  1. `warmup_ref` is not an argument of any `build_entry_locations_v24` call, directly or nested
     inside an argument expression.
  2. `warmup_ref` does not FLOW there through an alias — nothing assigned from `warmup_ref`
     (transitively) reaches such an argument either.
  3. The anchor that IS passed is the loop variable `ts`, not a literal and not a module constant.

The taint set is computed to a fixed point, so `x = warmup_ref; y = x; f(y)` is caught.
"""
from __future__ import annotations

import ast
import inspect
from pathlib import Path

import pytest

from research import current_mnq_strategy_v2_4_kernel as kernel

BUILDER = "build_entry_locations_v24"


def _fn_tree(src: str | None = None) -> ast.AST:
    src = src if src is not None else inspect.getsource(kernel.iter_actionable_candidates)
    return ast.parse(src.lstrip())


def _tainted_names(tree: ast.AST, seed: str) -> set[str]:
    """Every name that `seed` can flow into, to a fixed point."""
    tainted = {seed}
    changed = True
    while changed:
        changed = False
        for node in ast.walk(tree):
            if not isinstance(node, ast.Assign):
                continue
            rhs = {n.id for n in ast.walk(node.value) if isinstance(n, ast.Name)}
            if rhs & tainted:
                for tgt in node.targets:
                    for n in ast.walk(tgt):
                        if isinstance(n, ast.Name) and n.id not in tainted:
                            tainted.add(n.id)
                            changed = True
    return tainted


def _builder_arg_names(tree: ast.AST) -> list[set[str]]:
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            fn = getattr(node.func, "id", None) or getattr(node.func, "attr", None)
            if fn == BUILDER:
                names = set()
                for a in list(node.args) + [k.value for k in node.keywords]:
                    names |= {n.id for n in ast.walk(a) if isinstance(n, ast.Name)}
                out.append(names)
    return out


def test_the_builder_is_actually_called_here():
    """Positive control for the two proofs below. Without it they are vacuously true."""
    calls = _builder_arg_names(_fn_tree())
    assert calls, f"{BUILDER} is not called in iter_actionable_candidates - the proofs are vacuous"


def test_warmup_ref_does_not_reach_the_location_builder():
    tree = _fn_tree()
    tainted = _tainted_names(tree, "warmup_ref")
    for names in _builder_arg_names(tree):
        leaked = names & tainted
        assert not leaked, (
            f"warmup_ref reaches {BUILDER} via {sorted(leaked)} - the comment on that line is "
            f"false and the 09:30 stamp is back in the decision path")


def test_the_builder_is_anchored_on_the_loop_variable():
    """The repaired property, guarded positively rather than only by an absence."""
    calls = _builder_arg_names(_fn_tree())
    assert all("ts" in names for names in calls), (
        f"a {BUILDER} call is not anchored on the per-decision loop variable `ts`: {calls}")


def test_no_clock_literal_survives_in_the_decision_path():
    """No `HH:MM` string may sit inside a builder-call argument expression."""
    tree = _fn_tree()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            fn = getattr(node.func, "id", None) or getattr(node.func, "attr", None)
            if fn != BUILDER:
                continue
            for a in list(node.args) + [k.value for k in node.keywords]:
                for n in ast.walk(a):
                    if isinstance(n, ast.Constant) and isinstance(n.value, str) and ":" in n.value:
                        pytest.fail(f"a clock literal {n.value!r} is inside a {BUILDER} argument")


def test_the_taint_tracker_actually_tracks(tmp_path):
    """POSITIVE CONTROL ON THE INSTRUMENT ITSELF.

    A taint analysis that silently returns `{seed}` would make every proof above pass. Plant an
    alias chain and require the tracker to follow it - the mutator is a place a guard goes blind,
    and this campaign has already been fooled by a mutation that changed nothing.
    """
    src = (
        "def f():\n"
        "    warmup_ref = 1\n"
        "    a = warmup_ref\n"
        "    b = a\n"
        "    build_entry_locations_v24(env, dte, b, p)\n"
    )
    tree = _fn_tree(src)
    tainted = _tainted_names(tree, "warmup_ref")
    assert {"a", "b"} <= tainted, f"the taint tracker did not follow an alias chain: {tainted}"
    assert any(names & tainted for names in _builder_arg_names(tree)), (
        "the planted leak was not detected - the proofs above are not trustworthy")
