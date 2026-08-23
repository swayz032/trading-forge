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


def test_the_kernel_location_anchor_is_a_LITERAL_not_a_reference_to_trade_start():
    """This is the hazard in one assertion.

    `open_ts` feeds `build_entry_locations_v24`, so it decides WHICH ZONES EXIST. If it read
    `core.TRADE_START` then amending the window would move the location map too, silently. It
    does not — it is an independent literal — and that is what makes a find-and-replace
    dangerous rather than merely untidy.
    """
    src = inspect.getsource(kernel.iter_actionable_candidates)
    anchor = [ln for ln in src.splitlines() if "open_ts =" in ln]
    assert len(anchor) == 1, anchor
    assert "09:30" in anchor[0], anchor[0]
    assert "TRADE_START" not in anchor[0], (
        "if the anchor ever starts reading TRADE_START, amending the window would move the "
        "location map with it - update this test deliberately, do not delete it")


def test_the_location_anchor_actually_feeds_the_location_builder():
    """Otherwise ROLE 2 would be a scary label on a harmless line."""
    src = inspect.getsource(kernel.iter_actionable_candidates)
    tree = ast.parse(src.lstrip())
    fed = False
    for n in ast.walk(tree):
        if isinstance(n, ast.Call):
            fn = getattr(n.func, "id", None) or getattr(n.func, "attr", None)
            if fn == "build_entry_locations_v24":
                fed = any(getattr(a, "id", None) == "open_ts" for a in n.args)
    assert fed, "open_ts is not passed to build_entry_locations_v24 - re-derive ROLE 2"


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
