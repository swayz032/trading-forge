"""R1b — ORIGIN polarity governs a break story ONLY for an in-session flip inside the window.

ALGO-072. The scope is the whole point, and both directions have a real case behind them:

  IN-SESSION FLIP, INSIDE THE WINDOW -> ORIGIN governs.
      2026-03-31: break 09:35 -> flip R->S 09:40 -> re-break 09:45 -> his entry 09:49. Keyed on
      the CURRENT role the level had stopped being the resistance he broke, so his LONG break
      story had no location to stand on. ALGO-009's exception 2 is a WITHIN-SESSION sequence.

  OLD FLIP -> CURRENT role governs, for every family.
      2026-04-08: a zone with origin R that flipped days ago is simply SUPPORT now, and its
      short break is a real grant — verified through the ALGO-070 membership clauses. Unscoped
      origin matching would have DELETED it, which is why ALGO-072 scoped the rule.

A test that only proved the first would license exactly that deletion.
"""
from __future__ import annotations

import ast
import io

import pandas as pd
import pytest

from research import current_mnq_strategy_v2_4_kernel as ker

core = ker.core
WINDOW = ker.BREAK_FAMILY_BROKEN_VISIBILITY
TS = pd.Timestamp("2026-03-31 09:45", tz="America/New_York")


class _Zone:
    """Minimal stand-in: `_break_side` reads only `.id` (for origin) and `.side` (current)."""

    def __init__(self, zid, side):
        self.id = zid
        self.side = side


def test_an_IN_SESSION_flip_inside_the_window_is_keyed_on_ORIGIN():
    """2026-03-31's shape: origin R, flipped to S five minutes ago."""
    z = _Zone("R:2026-03-31T09:15:00-04:00:93745", "S")
    flipped = TS - pd.Timedelta(minutes=5)
    assert ker._break_side(z, flipped, TS) == "R", (
        "the break story lost the resistance it was told about")


def test_a_flip_OUTSIDE_the_window_keeps_the_CURRENT_role():
    """The bound must bite, or 'scoped' is decoration."""
    z = _Zone("R:2026-03-31T09:15:00-04:00:93745", "S")
    flipped = TS - WINDOW - pd.Timedelta(minutes=5)
    assert ker._break_side(z, flipped, TS) == "S"


def test_a_flip_exactly_AT_the_window_edge_still_governs():
    z = _Zone("R:2026-03-31T09:15:00-04:00:93745", "S")
    assert ker._break_side(z, TS - WINDOW, TS) == "R"


def test_an_OLD_flip_never_witnessed_this_session_keeps_the_CURRENT_role():
    """2026-04-08's shape: origin R, flipped days ago, no in-session flip recorded.

    `flipped_at` is None for it, and that is the case unscoped origin matching would have
    deleted — the zone is SUPPORT now and its short break is legitimate.
    """
    z = _Zone("R:2026-03-17T20:00:00-04:00:100140", "S")
    assert ker._break_side(z, None, TS) == "S", (
        "a zone that flipped days ago was keyed on a polarity it no longer has")


def test_a_zone_that_never_flipped_is_unaffected_either_way():
    z = _Zone("SWING:S:2026-04-06T03:45:00-04:00:96830", "S")
    assert ker._break_side(z, None, TS) == "S"
    assert ker._break_side(z, TS - pd.Timedelta(minutes=5), TS) == "S", (
        "origin and current agree here, so the scope must not change the answer")


def test_ROUTE_A_never_receives_the_origin_shape():
    """REJECT keys on the CURRENT role in both directions — structural, on the AST.

    A rejection is a statement about what the level IS doing; a break is a statement about what
    it WAS when price went through it.
    """
    src = io.open(ker.__file__, encoding="utf-8").read()
    fn = next(n for n in ast.walk(ast.parse(src))
              if isinstance(n, ast.FunctionDef) and n.name == "iter_actionable_candidates")
    body = ast.unparse(fn)
    # Every append into Route A's list uses the plain shape; the origin shape is break-only.
    for line in body.splitlines():
        if "pre_locs.append" in line:
            assert "_as_break_location" not in line, (
                "Route A is being fed the break family's origin-keyed shape")
    assert "_as_break_location" in body, "the break family lost its own shape"


def test_the_origin_polarity_comes_from_the_zone_id_not_from_a_guess():
    """`origin_side` recovers the IMMUTABLE creation polarity from the deterministic id."""
    from research.current_mnq_strategy_v2_4_zone_lifecycle import origin_side
    assert origin_side(_Zone("R:2026-03-31T09:15:00-04:00:93745", "S")) == "R"
    assert origin_side(_Zone("S:2026-03-30T08:45:00-04:00:93755", "R")) == "S"
    assert origin_side(_Zone("SWING:R:2026-04-14T09:15:00-04:00:102865", "S")) == "R"


def test_the_scope_uses_the_R1_window_and_introduces_no_new_constant():
    """ALGO-068 forbade a new threshold; ALGO-072 reuses the R1 window rather than adding one."""
    src = io.open(ker.__file__, encoding="utf-8").read()
    fn = next(n for n in ast.walk(ast.parse(src))
              if isinstance(n, ast.FunctionDef) and n.name == "_break_side")
    text = ast.unparse(fn)
    assert "BREAK_FAMILY_BROKEN_VISIBILITY" in text, "the scope invented its own window"
    for node in ast.walk(fn):
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            pytest.fail(f"_break_side carries a numeric literal: {node.value}")
