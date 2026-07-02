"""test_style_c_parity_2026_06_29.py — deep-scan #4 cross-language Style C parity.

Runs the SHARED fixtures (tests/fixtures/style_c_parity_fixtures.json) through the
Python style_c_handler.evaluate_exit(). The TS twin
(src/server/lib/__tests__/style-c-exit-evaluator-parity.test.ts) runs the same
fixtures through evaluateStyleCExit(). Both MUST agree on decision + new_stop —
this is the parity gate that must be GREEN before flipping STYLE_C_EXIT_TS_NATIVE=true.

Import-light (no vectorbt) — does not hang on this tower.
"""
import json
import math
import os

import pytest

from src.engine.exits.style_c_handler import StyleCState, evaluate_exit

_FIXTURE_PATH = os.path.join(
    os.path.dirname(__file__), "fixtures", "style_c_parity_fixtures.json"
)
with open(_FIXTURE_PATH, encoding="utf-8") as _fh:
    _FIXTURES = json.load(_fh)["fixtures"]


@pytest.mark.parametrize("fx", _FIXTURES, ids=[f["name"] for f in _FIXTURES])
def test_style_c_python_parity(fx):
    """Python evaluate_exit must match the shared expected decision + new_stop."""
    state = StyleCState(**fx["state"])
    result = evaluate_exit(state)

    assert result.decision == fx["expected_decision"], (
        f"{fx['name']}: decision {result.decision} != {fx['expected_decision']}"
    )
    expected_stop = fx["expected_new_stop"]
    if expected_stop is None:
        assert result.new_stop is None, f"{fx['name']}: expected new_stop None, got {result.new_stop}"
    else:
        assert result.new_stop is not None
        assert math.isclose(result.new_stop, expected_stop, abs_tol=1e-6), (
            f"{fx['name']}: new_stop {result.new_stop} != {expected_stop}"
        )


def test_nan_entry_price_holds():
    """NaN entry_price → HOLD fail-closed (JSON cannot encode NaN — asserted inline)."""
    state = StyleCState(
        direction="long", entry_price=float("nan"), stop_pts=10, current_price=4505,
        current_time_et="10:00", bar_high=4510, bar_low=4502,
    )
    result = evaluate_exit(state)
    assert result.decision == "HOLD"
    assert result.evidence.get("error") == "NaN_or_Inf_in_entry_price"


def test_inf_current_price_holds():
    """Infinity current_price → HOLD fail-closed."""
    state = StyleCState(
        direction="long", entry_price=4500, stop_pts=10, current_price=float("inf"),
        current_time_et="10:00", bar_high=4510, bar_low=4502,
    )
    result = evaluate_exit(state)
    assert result.decision == "HOLD"
    assert result.evidence.get("error") == "NaN_or_Inf_in_current_price"
