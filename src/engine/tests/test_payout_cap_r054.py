"""R-054 compliance-refresh regression test — get_payout_cap() by-size + DLL model.

Grader (R-054 independent grade) flagged get_payout_cap() had ZERO test coverage
after the by-size restructure, despite being instrument-touching. This locks the
GOVERNING live-page values (operator primary source, 2026-07-19): the voluntary DLL
DOUBLES the base cap and is orthogonal to the Standard/Consistency election. Pure
stdlib, no DB/network.
"""
from __future__ import annotations

import importlib.util
import os
import sys

import pytest

_FC = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "firm_config.py"))
_spec = importlib.util.spec_from_file_location("_r054_firm_config", _FC)
fc = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = fc
_spec.loader.exec_module(fc)

cap = fc.get_payout_cap

# GOVERNING with-DLL caps (operator live page) — Standard / Consistency by size.
WITH_DLL = {
    ("standard", "50k"): 4000, ("standard", "100k"): 6000, ("standard", "150k"): 10000,
    ("consistency", "50k"): 6000, ("consistency", "100k"): 8000, ("consistency", "150k"): 12000,
}
BASE = {
    ("standard", "50k"): 2000, ("standard", "100k"): 3000, ("standard", "150k"): 5000,
    ("consistency", "50k"): 3000, ("consistency", "100k"): 4000, ("consistency", "150k"): 6000,
}


@pytest.mark.parametrize("key,expected", list(WITH_DLL.items()))
def test_with_dll_caps_are_the_governing_values(key, expected):
    path, size = key
    assert cap("topstep_50k", "xfa", path, dll_opted_in=True, account_size=size) == expected


@pytest.mark.parametrize("key,expected", list(BASE.items()))
def test_base_caps_when_dll_not_added(key, expected):
    path, size = key
    assert cap("topstep_50k", "xfa", path, dll_opted_in=False, account_size=size) == expected


@pytest.mark.parametrize("key", list(BASE.keys()))
def test_dll_doubles_the_base_cap_exactly(key):
    # The whole reconciliation rests on with_dll == 2 × base — lock it.
    assert WITH_DLL[key] == 2 * BASE[key]
    path, size = key
    got_base = cap("topstep_50k", "xfa", path, dll_opted_in=False, account_size=size)
    got_dll = cap("topstep_50k", "xfa", path, dll_opted_in=True, account_size=size)
    assert got_dll == 2 * got_base


def test_default_is_conservative_base_cap():
    # dll_opted_in defaults False → base (never assume the doubled cap).
    assert cap("topstep_50k", "xfa", "standard") == 2000  # 50k default


def test_lfa_is_uncapped():
    assert cap("topstep_50k", "xfa", "standard", account_size="50k") is not None
    assert cap("topstep_50k", "lfa", "standard") is None  # None sentinel = uncapped


def test_unknown_account_size_raises():
    with pytest.raises(ValueError):
        cap("topstep_50k", "xfa", "standard", account_size="200k")  # fiction — no 200k
