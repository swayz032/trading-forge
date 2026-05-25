"""Wave 27.5 Pass B — HIGH #1: WFE floor threshold tests.

Tests for compute_wfe() with institutional 2026 floor thresholds.
Covers:
  - WFE hard floor (default 0.70) → "pass" status
  - WFE warn floor (default 0.50) → "warn" status
  - WFE below warn → "fail" status
  - IS Sharpe <= 0 edge cases
  - Env-var override of floors
  - backward compat: "wfe" and "interpretation" keys still present
"""

from __future__ import annotations

import os

import pytest

from src.engine.cross_validation import (
    compute_wfe,
    get_wfe_hard_floor,
    get_wfe_warn_floor,
)


class TestWFEStatusWithDefaultFloors:
    """WFE status against default institutional floors (0.70 hard / 0.50 warn)."""

    def test_wfe_above_hard_floor_is_pass(self):
        """OOS Sharpe = IS Sharpe → WFE = 1.0, well above 0.70 → pass."""
        result = compute_wfe(is_sharpe=1.5, oos_sharpe=1.5)
        assert result["status"] == "pass"
        assert result["wfe"] == pytest.approx(1.0)

    def test_wfe_at_hard_floor_is_pass(self):
        """OOS Sharpe = 0.70 * IS Sharpe → WFE = 0.70 exactly → pass."""
        result = compute_wfe(is_sharpe=2.0, oos_sharpe=1.4)  # 1.4/2.0 = 0.70
        assert result["status"] == "pass"
        assert result["wfe"] == pytest.approx(0.70, abs=0.001)

    def test_wfe_between_warn_and_hard_floor_is_warn(self):
        """WFE = 0.60 → between warn floor 0.50 and hard floor 0.70 → warn."""
        result = compute_wfe(is_sharpe=2.0, oos_sharpe=1.2)  # 1.2/2.0 = 0.60
        assert result["status"] == "warn"

    def test_wfe_at_warn_floor_is_warn(self):
        """WFE = 0.50 exactly → status == 'warn' (>= warn_floor but < hard_floor)."""
        result = compute_wfe(is_sharpe=2.0, oos_sharpe=1.0)  # 1.0/2.0 = 0.50
        assert result["status"] == "warn"

    def test_wfe_below_warn_floor_is_fail(self):
        """WFE = 0.20 → below warn floor 0.50 → fail (red flag)."""
        result = compute_wfe(is_sharpe=2.0, oos_sharpe=0.4)  # 0.4/2.0 = 0.20
        assert result["status"] == "fail"

    def test_wfe_zero_is_fail(self):
        """Negative OOS Sharpe → WFE <= 0 → fail."""
        result = compute_wfe(is_sharpe=1.5, oos_sharpe=-0.5)
        assert result["status"] == "fail"


class TestWFEEdgeCases:
    """Edge cases and IS Sharpe guard conditions."""

    def test_is_sharpe_zero_returns_fail(self):
        """IS Sharpe = 0 → cannot compute WFE → status fail."""
        result = compute_wfe(is_sharpe=0.0, oos_sharpe=1.0)
        assert result["status"] == "fail"
        assert result["wfe"] == 0.0

    def test_is_sharpe_negative_returns_fail(self):
        """IS Sharpe < 0 → cannot compute WFE meaningfully."""
        result = compute_wfe(is_sharpe=-1.0, oos_sharpe=0.5)
        assert result["status"] == "fail"

    def test_floor_keys_present_in_output(self):
        """Result dict must always include hard_floor and warn_floor keys."""
        result = compute_wfe(is_sharpe=1.5, oos_sharpe=1.0)
        assert "hard_floor" in result
        assert "warn_floor" in result
        assert "status" in result

    def test_backward_compat_wfe_key_present(self):
        """Legacy 'wfe' and 'interpretation' keys must still be present."""
        result = compute_wfe(is_sharpe=1.5, oos_sharpe=1.5)
        assert "wfe" in result
        assert "interpretation" in result


class TestWFEEnvVarOverride:
    """WFE floors are configurable via env vars."""

    def test_custom_hard_floor_via_env(self):
        """Set WFE_HARD_FLOOR=0.80 → WFE=0.75 should now be 'warn' not 'pass'."""
        original = os.environ.get("WFE_HARD_FLOOR")
        try:
            os.environ["WFE_HARD_FLOOR"] = "0.80"
            result = compute_wfe(is_sharpe=2.0, oos_sharpe=1.5)  # WFE=0.75
            # 0.75 < 0.80 hard floor → warn (assuming warn floor < 0.75)
            assert result["status"] in ("warn", "fail")
        finally:
            if original is None:
                os.environ.pop("WFE_HARD_FLOOR", None)
            else:
                os.environ["WFE_HARD_FLOOR"] = original

    def test_get_wfe_hard_floor_default(self):
        """get_wfe_hard_floor() returns 0.70 when env var not set."""
        original = os.environ.pop("WFE_HARD_FLOOR", None)
        try:
            floor = get_wfe_hard_floor()
            assert floor == pytest.approx(0.70)
        finally:
            if original is not None:
                os.environ["WFE_HARD_FLOOR"] = original

    def test_get_wfe_warn_floor_default(self):
        """get_wfe_warn_floor() returns 0.50 when env var not set."""
        original = os.environ.pop("WFE_WARN_FLOOR", None)
        try:
            floor = get_wfe_warn_floor()
            assert floor == pytest.approx(0.50)
        finally:
            if original is not None:
                os.environ["WFE_WARN_FLOOR"] = original
