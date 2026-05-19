"""Wave 21 E.1 — PositionSizeConfig risk_derived_pyramid field tests.

Pins that:
1. risk_derived_pyramid is a valid type literal.
2. All new fields accept their default values.
3. Validators reject out-of-range inputs.
4. backward-compat: fixed and dynamic_atr still work unchanged.
"""

import pytest
from pydantic import ValidationError

from src.engine.config import PositionSizeConfig


class TestPositionSizeConfigRiskDerivedPyramid:
    """Pydantic schema coverage for the new risk_derived_pyramid type."""

    def test_risk_derived_pyramid_type_accepted(self):
        cfg = PositionSizeConfig(type="risk_derived_pyramid")
        assert cfg.type == "risk_derived_pyramid"

    def test_risk_derived_pyramid_defaults(self):
        cfg = PositionSizeConfig(type="risk_derived_pyramid")
        assert cfg.base_contracts == 4
        assert cfg.tier_increment == 2
        assert cfg.tier_threshold_dollars == 3000.0
        assert cfg.max_risk_pct_per_trade == 0.02
        assert cfg.personal_dll_pct == 0.67
        assert cfg.liquidity_comfort_cap == 100
        assert cfg.topstep_account_cap_override is None
        assert cfg.firm_contract_cap is None

    def test_risk_derived_pyramid_custom_values(self):
        cfg = PositionSizeConfig(
            type="risk_derived_pyramid",
            base_contracts=6,
            tier_increment=3,
            tier_threshold_dollars=5000.0,
            max_risk_pct_per_trade=0.015,
            personal_dll_pct=0.70,
            liquidity_comfort_cap=50,
            topstep_account_cap_override=30,
            firm_contract_cap=20,
        )
        assert cfg.base_contracts == 6
        assert cfg.tier_increment == 3
        assert cfg.tier_threshold_dollars == 5000.0
        assert cfg.max_risk_pct_per_trade == 0.015
        assert cfg.personal_dll_pct == 0.70
        assert cfg.liquidity_comfort_cap == 50
        assert cfg.topstep_account_cap_override == 30
        assert cfg.firm_contract_cap == 20

    # ── Validation constraints ──────────────────────────────────────────────

    def test_base_contracts_must_be_positive(self):
        with pytest.raises(ValidationError, match="base_contracts"):
            PositionSizeConfig(type="risk_derived_pyramid", base_contracts=0)

    def test_base_contracts_negative_rejected(self):
        with pytest.raises(ValidationError):
            PositionSizeConfig(type="risk_derived_pyramid", base_contracts=-1)

    def test_max_risk_pct_zero_rejected(self):
        with pytest.raises(ValidationError, match="max_risk_pct_per_trade"):
            PositionSizeConfig(type="risk_derived_pyramid", max_risk_pct_per_trade=0.0)

    def test_max_risk_pct_too_high_rejected(self):
        # > 5% is forbidden (would size 133+ contracts at $50K — exceeds firm caps)
        with pytest.raises(ValidationError, match="max_risk_pct_per_trade"):
            PositionSizeConfig(type="risk_derived_pyramid", max_risk_pct_per_trade=0.06)

    def test_max_risk_pct_exactly_005_accepted(self):
        cfg = PositionSizeConfig(type="risk_derived_pyramid", max_risk_pct_per_trade=0.05)
        assert cfg.max_risk_pct_per_trade == 0.05

    def test_personal_dll_pct_zero_rejected(self):
        with pytest.raises(ValidationError, match="personal_dll_pct"):
            PositionSizeConfig(type="risk_derived_pyramid", personal_dll_pct=0.0)

    def test_personal_dll_pct_exactly_1_accepted(self):
        cfg = PositionSizeConfig(type="risk_derived_pyramid", personal_dll_pct=1.0)
        assert cfg.personal_dll_pct == 1.0

    def test_personal_dll_pct_greater_than_1_rejected(self):
        with pytest.raises(ValidationError, match="personal_dll_pct"):
            PositionSizeConfig(type="risk_derived_pyramid", personal_dll_pct=1.01)

    # ── Backward compatibility ──────────────────────────────────────────────

    def test_fixed_type_still_works(self):
        cfg = PositionSizeConfig(type="fixed", fixed_contracts=4)
        assert cfg.type == "fixed"
        assert cfg.fixed_contracts == 4

    def test_dynamic_atr_type_still_works(self):
        cfg = PositionSizeConfig(type="dynamic_atr", target_risk_dollars=750.0)
        assert cfg.type == "dynamic_atr"
        assert cfg.target_risk_dollars == 750.0

    def test_invalid_type_rejected(self):
        with pytest.raises(ValidationError):
            PositionSizeConfig(type="kelly_pyramid")
