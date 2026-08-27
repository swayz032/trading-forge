"""The 09:30 bound wears four different hats. Pin that, because the amendment is coming.

ALGO-025 section 3 registered the operator's teaching that his window is now 8:00-12:00. The
amendment is queued behind the grade. The hazard this file guards is that someone implements it
with a find-and-replace and silently moves the LOCATION-MAP ANCHOR along with the trading-window
start, changing which S/R zones exist and invalidating every number in the campaign.
"""
from __future__ import annotations

import ast
import inspect
import io

import pytest

from research import current_mnq_strategy_v2_4_kernel as kernel
from research import current_mnq_strategy_v2_4_window_bound_census as W


def _c():
    return W.census()


def test_the_census_is_not_empty():
    """A census over an empty population certifies nothing."""
    c = _c()
    assert c["total_code_sites"] >= 20, c["total_code_sites"]


def test_it_does_not_count_itself():
    """A census that counts its own regexes inflates its own finding. It did, on the first run."""
    assert not any(s["file"] == "current_mnq_strategy_v2_4_window_bound_census.py"
                   for s in _c()["sites"])


def test_the_two_load_bearing_roles_are_both_populated():
    roles = _c()["roles"]
    assert roles.get(W.ROLE_TRADING_WINDOW, 0) >= 1
    assert roles.get(W.ROLE_LOCATION_ANCHOR, 0) >= 1


def test_the_amendment_targets_the_trading_window_and_nothing_else():
    assert W.ROLE_THE_AMENDMENT_TARGETS == W.ROLE_TRADING_WINDOW


def test_the_kernel_location_anchor_is_NOT_a_literal_it_is_the_decision_clock():
    """UPDATED DELIBERATELY 2026-08-27 under ALGO-176 §4. NOT deleted.

    The previous version of this test asserted the anchor WAS a hardcoded `09:30` literal, and its
    own failure message said *"update this test deliberately, do not delete it."* The author
    anticipated exactly this case and left instructions.

    WHAT CHANGED, AND WHY THE OLD ASSERTION WAS GUARDING A DEFECT. The single `09:30` anchor built
    the location map ONCE and handed it to every decision from 08:00 onward. ALGO-173 enumerated
    the consequence and ALGO-171 confirmed it at source: decisions traded levels absent from the
    map derivable at their own timestamp — two of them entering at `08:05` on levels whose
    identifiers contain `08:45`.

    THE HAZARD THE ORIGINAL GUARDED IS STILL REAL AND IS STILL GUARDED, just inverted: the anchor
    must not silently follow the trading-window constant either. It is now neither a literal nor
    `TRADE_START` — it is the decision's own bucket clock, which is the only value that cannot be
    wrong by construction.
    """
    src = inspect.getsource(kernel.iter_actionable_candidates)
    tree = ast.parse(src.lstrip())
    anchors = []
    for n in ast.walk(tree):
        if isinstance(n, ast.Call):
            fn = getattr(n.func, "id", None) or getattr(n.func, "attr", None)
            if fn == "build_entry_locations_v24":
                anchors.append([ast.unparse(a) for a in n.args])
    assert anchors, "build_entry_locations_v24 is not called - this test is vacuous"
    for args in anchors:
        assert "ts" in args, f"the location anchor is not the decision clock `ts`: {args}"
        assert not any("09:30" in a for a in args), (
            f"a 09:30 literal is back in the location anchor: {args}")
        assert not any("TRADE_START" in a for a in args), (
            f"the anchor now follows TRADE_START; amending the window would move the location "
            f"map with it - the original hazard, in its other direction: {args}")


def test_the_location_anchor_actually_feeds_the_location_builder():
    """Otherwise ROLE 2 would be a scary label on a harmless line.

    UPDATED 2026-08-27 (ALGO-176 §4): the PROPERTY is unchanged — the anchor must genuinely reach
    the builder — and only the expected VALUE moved from `open_ts` to the loop variable `ts`.
    """
    src = inspect.getsource(kernel.iter_actionable_candidates)
    tree = ast.parse(src.lstrip())
    fed = False
    for n in ast.walk(tree):
        if isinstance(n, ast.Call):
            fn = getattr(n.func, "id", None) or getattr(n.func, "attr", None)
            if fn == "build_entry_locations_v24":
                fed = any(getattr(a, "id", None) == "ts" for a in n.args)
    assert fed, "ts is not passed to build_entry_locations_v24 - re-derive ROLE 2"


def test_the_trading_window_gate_reads_the_constant():
    """ROLE 1 genuinely goes through `core.TRADE_START`, so amending it is a one-place change."""
    src = inspect.getsource(kernel.iter_actionable_candidates)
    assert "core.TRADE_START" in src


def test_runtime_starts_do_not_read_the_kernel_constant():
    """ROLE 3: independent literals that would silently disagree with an amended kernel."""
    for mod in ("current_mnq_strategy_v2_4_automation_runtime",
                "current_mnq_strategy_v2_4_shadow_runtime"):
        src = io.open(f"research/{mod}.py", encoding="utf-8").read()
        assert "time(9, 30)" in src, mod
        head = src.split("def ")[0]
        assert "TRADE_START" not in head, (
            f"{mod} now reads TRADE_START - good, but this test documented that it did not")


@pytest.mark.parametrize("role", [
    W.ROLE_TRADING_WINDOW, W.ROLE_LOCATION_ANCHOR, W.ROLE_RUNTIME_START, W.ROLE_DATA_FILTER,
])
def test_every_declared_role_is_distinct(role):
    assert role != W.ROLE_UNCLASSIFIED
    assert isinstance(role, str) and role


def test_the_hazard_is_stated_in_the_output_not_only_the_docstring():
    """A warning that lives only in prose does not travel with the data."""
    h = _c()["hazard"]
    assert "NOT one constant" in h
    assert "find-and-replace" in h


def test_it_proposes_no_amendment_and_edits_nothing():
    src = io.open(W.__file__, encoding="utf-8").read()
    tree = ast.parse(src)
    called = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Call):
            nm = getattr(n.func, "id", None) or getattr(n.func, "attr", None)
            if nm:
                called.add(nm)
    for banned in ("write", "write_text", "replace", "rename", "unlink"):
        assert banned not in called, f"the census calls {banned}() - it must only read"
    assert "read" in called or "open" in called
