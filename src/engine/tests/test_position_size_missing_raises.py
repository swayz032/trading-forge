"""H7 regression: missing position_size or fixed_contracts=1 must fail-closed.

Tests:
  - type='fixed', fixed_contracts=1 without TF_ALLOW_FIXED_1 → raises
  - type='fixed', fixed_contracts=6 → OK
  - type='risk_derived_pyramid' → OK regardless of fixed_contracts
  - TF_ALLOW_FIXED_1=true → suppresses the guard (for unit tests)

These tests use only config.py (no vectorbt import).
"""
from __future__ import annotations

import os

import pytest

# Must set this BEFORE importing config to allow certain tests to use fixed=1
os.environ.setdefault("TF_ALLOW_FIXED_1", "true")


class TestPositionSizeMissingRaises:
    """H7: position_size validation fail-closed on dangerously low contract counts."""

    def test_fixed_1_raises_without_env_var(self, monkeypatch):
        """Without TF_ALLOW_FIXED_1, fixed_contracts=1 must raise ValueError or ValidationError."""
        monkeypatch.setenv("TF_ALLOW_FIXED_1", "false")
        from pydantic import ValidationError

        from src.engine.config import PositionSizeConfig
        with pytest.raises((ValidationError, ValueError)):
            PositionSizeConfig(type="fixed", fixed_contracts=1)

    def test_fixed_1_allowed_with_env_var(self):
        """With TF_ALLOW_FIXED_1=true, fixed_contracts=1 must NOT raise (test environments)."""
        # TF_ALLOW_FIXED_1=true is set at module-top via setdefault
        from src.engine.config import PositionSizeConfig
        cfg = PositionSizeConfig(type="fixed", fixed_contracts=1)
        assert cfg.fixed_contracts == 1

    def test_fixed_6_always_allowed(self):
        """fixed_contracts=6 is always valid (minimum production size for MES)."""
        from src.engine.config import PositionSizeConfig
        cfg = PositionSizeConfig(type="fixed", fixed_contracts=6)
        assert cfg.fixed_contracts == 6

    def test_fixed_10_always_allowed(self):
        """fixed_contracts=10 is always valid."""
        from src.engine.config import PositionSizeConfig
        cfg = PositionSizeConfig(type="fixed", fixed_contracts=10)
        assert cfg.fixed_contracts == 10

    def test_risk_derived_pyramid_not_affected(self):
        """risk_derived_pyramid type is not subject to fixed_contracts=1 guard."""
        from src.engine.config import PositionSizeConfig
        cfg = PositionSizeConfig(
            type="risk_derived_pyramid",
            base_contracts=6,
            max_risk_pct_per_trade=0.02,
        )
        assert cfg.type == "risk_derived_pyramid"
        assert cfg.base_contracts == 6

    def test_fixed_2_allowed_without_env_var(self, monkeypatch):
        """fixed_contracts=2 is above the 1-contract threshold and must be allowed."""
        monkeypatch.setenv("TF_ALLOW_FIXED_1", "false")
        from src.engine.config import PositionSizeConfig
        # Should not raise — 2 > 1
        cfg = PositionSizeConfig(type="fixed", fixed_contracts=2)
        assert cfg.fixed_contracts == 2

    def test_guard_documented_error_message(self, monkeypatch):
        """Error message must clearly explain why and how to fix it."""
        monkeypatch.setenv("TF_ALLOW_FIXED_1", "false")
        from pydantic import ValidationError

        from src.engine.config import PositionSizeConfig
        with pytest.raises((ValidationError, ValueError)) as exc_info:
            PositionSizeConfig(type="fixed", fixed_contracts=1)
        err_str = str(exc_info.value).lower()
        # Error must mention the env var or the fix path
        assert "tf_allow_fixed_1" in err_str or "fixed_contracts" in err_str, \
            f"Error message should reference TF_ALLOW_FIXED_1 or fixed_contracts, got: {err_str}"
