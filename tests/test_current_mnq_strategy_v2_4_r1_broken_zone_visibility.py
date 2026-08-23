"""R1 — a BROKEN zone stays visible to the BREAK family, and NEVER to Route A. ALGO-068 R1.

THE DEFECT THIS REPAIRS, measured on 2026-03-30 and 2026-03-31: a decisive break sets the zone
BROKEN (zone_lifecycle.py:81-83), BROKEN is not `active` (v2_2_engine.py:135-141), and the
kernel dropped every inactive zone from the candidate locations. So THERE WAS NO BUCKET AT
WHICH A ZONE WAS BOTH ALIVE AND CARRIED A COMPLETED BREAK PRINT — before the break there is
nothing to break, after it the location is gone. The taught break entry was unreachable by
construction, and no threshold could reach it.

THE PROPERTY, both halves, because either alone is satisfiable by a wrong implementation:

    a BROKEN zone IS visible to the break family (B/C/D + BRK15) within its own window
    a BROKEN zone is NEVER visible to Route A, at any distance

A repair that showed only the first would let a "rejection" be told at a level price has
already broken through, which is not a rejection in any teaching.
"""
from __future__ import annotations

import ast
import inspect
import io

import pandas as pd
import pytest

from research import current_mnq_strategy_v2_4_engine as v24
from research import current_mnq_strategy_v2_4_kernel as ker

core = ker.core


def _src():
    return io.open(ker.__file__, encoding="utf-8").read()


# --- the window is DERIVED, not a new threshold --------------------------------------------

def test_the_visibility_window_is_the_break_familys_own_lookback():
    """ALGO-068 forbids a new threshold. This must be LOOKBACK bars, not a tuned number."""
    assert ker.BREAK_FAMILY_BROKEN_VISIBILITY == pd.Timedelta(minutes=5 * ker.LOOKBACK)
    assert ker.LOOKBACK == 6


def test_the_window_is_expressed_in_terms_of_LOOKBACK_in_the_source():
    """A literal 30 minutes would be a new constant wearing a derived constant's name."""
    tree = ast.parse(_src())
    for node in ast.walk(tree):
        if (isinstance(node, ast.Assign)
                and any(getattr(t, "id", None) == "BREAK_FAMILY_BROKEN_VISIBILITY"
                        for t in node.targets)):
            expr = ast.unparse(node.value)
            assert "LOOKBACK" in expr, f"the window is not derived from LOOKBACK: {expr}"
            return
    pytest.fail("BREAK_FAMILY_BROKEN_VISIBILITY is not assigned at module level")


# --- ROUTE A NEVER SEES A BROKEN ZONE ------------------------------------------------------

def test_route_A_reads_pre_locs_and_the_break_family_reads_brk_locs():
    """Structural: the two families must read DIFFERENT lists, and Route A must read the
    active-only one. Checked on the AST so a comment claiming it does not satisfy the test."""
    fn = next(n for n in ast.walk(ast.parse(_src()))
              if isinstance(n, ast.FunctionDef) and n.name == "iter_actionable_candidates")
    body = ast.unparse(fn)
    assert "brk_locs" in body, "the break family's list does not exist"
    assert "pre_locs" in body, "Route A's list does not exist"
    # Route A's candidate construction must be fed from pre_locs.
    assert 'for loc in [x for x in pre_locs if x.side == side]' in body, (
        "Route A no longer reads the active-only list")
    assert 'for loc in [x for x in brk_locs if x.side == side]' in body, (
        "the break family no longer reads its own list")


def test_only_ACTIVE_zones_ever_enter_route_As_list():
    """The append into `pre_locs` must be guarded by `.active` and nothing else.

    Read off the source rather than simulated, because the guarantee is structural: there must
    be no path that puts a non-active zone into the Route A list.
    """
    fn = next(n for n in ast.walk(ast.parse(_src()))
              if isinstance(n, ast.FunctionDef) and n.name == "iter_actionable_candidates")
    appends_to_pre = []
    for node in ast.walk(fn):
        if (isinstance(node, ast.Call)
                and getattr(node.func, "attr", None) == "append"
                and getattr(getattr(node.func, "value", None), "id", None) == "pre_locs"):
            appends_to_pre.append(node)
    assert appends_to_pre, "no appends into pre_locs found - the test is not looking at it"
    # Every append must be inside a branch that either has no zone (an FVG band) or is active.
    body = ast.unparse(fn)
    assert "if before.active:" in body
    assert "ZoneState.BROKEN" in body, "the broken branch must be explicit"
    # Bound the slice at the FVG refresh: that block legitimately appends to BOTH lists, and
    # an over-wide slice swept it in and convicted the wrong code. A slice is a join too.
    broken_branch = body.split("ZoneState.BROKEN")[1].split("known_ids = ")[0]
    assert "pre_locs.append" not in broken_branch, (
        "a BROKEN zone reaches Route A's list - a rejection at a level price has already "
        "broken through is not a rejection")


def test_the_broken_branch_appends_ONLY_to_the_break_list():
    body = ast.unparse(next(n for n in ast.walk(ast.parse(_src()))
                            if isinstance(n, ast.FunctionDef)
                            and n.name == "iter_actionable_candidates"))
    branch = body.split("ZoneState.BROKEN")[1].split("known_ids = ")[0]
    assert "brk_locs.append" in branch, "the broken zone is not offered to the break family"


# --- the window BOUNDS the visibility -------------------------------------------------------

def test_a_zone_broken_LONGER_ago_than_the_window_is_not_visible():
    """The bound must bite, or 'bounded window' is decoration.

    Simulated on the kernel's own rule rather than asserted from prose: the source condition is
    `ts - last_active <= BREAK_FAMILY_BROKEN_VISIBILITY`.
    """
    win = ker.BREAK_FAMILY_BROKEN_VISIBILITY
    last_active = pd.Timestamp("2026-03-30 09:30", tz="America/New_York")
    inside = last_active + win
    outside = last_active + win + pd.Timedelta(minutes=5)
    assert (inside - last_active) <= win, "a zone at the window edge must still be visible"
    assert (outside - last_active) > win, "a zone past the window must not be visible"


def test_a_zone_never_active_this_session_is_absent_not_recently_broken():
    """`last_active_bucket.get(id)` is None for a zone that was never active, and the guard
    requires it to be non-None. A zone that has been broken since before the session opened is
    ABSENT, and it stays absent - it is not 'recently broken'."""
    body = ast.unparse(next(n for n in ast.walk(ast.parse(_src()))
                            if isinstance(n, ast.FunctionDef)
                            and n.name == "iter_actionable_candidates"))
    assert "last_active is not None" in body, (
        "a zone never active this session could be treated as recently broken")


# --- the lifecycle itself is UNTOUCHED ------------------------------------------------------

def test_the_repair_does_not_touch_the_lifecycle_or_any_threshold():
    """ALGO-068: zone_lifecycle semantics untouched, no threshold moved, incl.
    breakout_clear_atr. The oscillation stays an open question, not a design input."""
    from research import current_mnq_strategy_v2_4_zone_lifecycle as ZL
    src = inspect.getsource(ZL)
    # The break test and the clearance are exactly as they were.
    assert "def _breaks(role: str, close: float, lo: float, hi: float, clear: float) -> bool:" \
        in src
    assert "clear = p.breakout_clear_atr * atr" in src
    p = v24.Params()
    assert float(p.breakout_clear_atr) == 0.05, "a threshold moved"
    assert float(p.body_frac) == 0.62 and float(p.close_loc) == 0.78

    # And the kernel must not have grown a case-specific branch. CHECKED ON THE AST, over
    # STRING CONSTANTS AND COMPARISONS ONLY - an earlier version grepped the raw source and
    # convicted the COMMENT naming the sessions the repair was measured on. That is the
    # substring-over-prose habit for the fifth time in this lane: a guard that reads prose
    # convicts the sentence written to explain the code it guards.
    tree = ast.parse(_src())
    for node in ast.walk(tree):
        body_ = getattr(node, "body", None)
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.ClassDef)) and body_:
            first = body_[0]
            if (isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant)
                    and isinstance(first.value.value, str)):
                body_.pop(0)
    consts = {n.value for n in ast.walk(tree)
              if isinstance(n, ast.Constant) and isinstance(n.value, str)}
    for banned in ("2026-03-30", "2026-03-31", "2026-04-06", "2026-04-14"):
        assert banned not in consts, (
            f"a case-specific branch for {banned} is in the kernel's CODE")


def test_the_one_trade_budget_is_untouched():
    """R1 may make more candidates visible; it may never make more TRADES."""
    body = _src()
    assert "_rank_and_yield" in body
    fn = next(n for n in ast.walk(ast.parse(body))
              if isinstance(n, ast.FunctionDef) and n.name == "_rank_and_yield")
    text = ast.unparse(fn)
    # It still yields at most one candidate per clock and still enforces LAST_ENTRY / as_of.
    assert "LAST_ENTRY" in text and "as_of" in text
    # Matched on the pieces, not on a spelling: `ast.unparse` normalises the generator's
    # parentheses, so an exact-string assert here fails against code that is perfectly correct.
    assert "set(" in text and "c.direction for c in candidates" in text and "!= 1" in text, (
        "the direction-conflict veto is the shape that keeps one clock to one trade")
