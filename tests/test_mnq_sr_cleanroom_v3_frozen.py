"""Guards for CLEANROOM-v3. AST-based, for the same reason as v2: the module docstring names the
things it promises not to contain, so a substring check convicts the promise.

The load-bearing one is `test_no_width_constant_anywhere`. ALGO-167 authorized v3 on the condition
that it fixes the width by CHANGING THE LINKAGE, not by capping anything. A width constant appearing
later - added in good faith by anyone, including me - would silently convert a definitional repair
back into the threshold search the whole build exists to avoid, and the result would still look
like a pass.
"""
from __future__ import annotations

import ast
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "research" / "mnq_sr_cleanroom_v3.py"


def _code_tree() -> ast.Module:
    tree = ast.parse(SRC.read_text(encoding="utf-8"))
    body = list(tree.body)
    if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
            and isinstance(body[0].value.value, str):
        body = body[1:]
    return ast.Module(body=body, type_ignores=[])


def test_no_width_constant_anywhere():
    """v3's entire authorization is that it introduces NO width or tolerance constant.

    Checked two ways, because the naive "no floats" version is both too strict and too loose. It
    flagged `(lo + hi) / 2.0` in `mid` - an arithmetic divisor, not a threshold - and widening the
    allowlist to silence that would have been the exact move that lets a real constant in later.

      (a) MODULE-LEVEL float constants must be exactly {MIN_WICK}. That is where a tolerance would
          be declared.
      (b) NO float may appear inside a COMPARISON anywhere. That is what a threshold IS - a value
          something is tested against. A divisor in an expression is not, and is allowed.
    """
    tree = _code_tree()

    module_floats = {
        t.value for node in tree.body if isinstance(node, ast.Assign)
        for t in [node.value] if isinstance(t, ast.Constant) and isinstance(t.value, float)}
    assert module_floats == {0.20}, f"module-level magnitudes changed: {module_floats}"

    in_compare = {sub.value for node in ast.walk(tree) if isinstance(node, ast.Compare)
                  for sub in ast.walk(node)
                  if isinstance(sub, ast.Constant) and isinstance(sub.value, float)}
    assert not in_compare, f"a float is being compared against - that is a threshold: {in_compare}"


def test_positive_control_the_float_scan_sees_floats():
    """A zero must be evidence about the code, not about a dead extractor."""
    consts = [n.value for n in ast.walk(_code_tree())
              if isinstance(n, ast.Constant) and isinstance(n.value, (int, float))]
    assert consts, "the constant extractor returned NOTHING - the guard above is vacuous"
    assert 0.20 in consts, f"extractor did not see MIN_WICK; saw {consts[:12]}"


def test_clustering_intersects_and_never_unions():
    """The one change. v1 grew a cluster by UNION (min/max) which is what chained; v3 must
    INTERSECT (max/min) so a cluster can only shrink as members are added."""
    src = SRC.read_text(encoding="utf-8")
    assert "max(lo_, blo), min(hi_, bhi)" in src, "v3 is not intersecting - the one change is absent"
    assert "min(lo_, blo), max(hi_, bhi)" not in src, "v3 still unions bands like v1 did"


def test_membership_requires_overlap_with_every_member():
    """Complete linkage, not single linkage: `all(...)` over existing members, never `any(...)`."""
    for node in ast.walk(_code_tree()):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "all":
            return
    raise AssertionError("no all()-quantified membership test found - v3 is still single linkage")


def test_the_inherited_wick_floor_did_not_move():
    import research.mnq_sr_cleanroom_v3 as V3
    assert V3.MIN_WICK == 0.20
    assert V3.TOP_PER_SESSION == 3
