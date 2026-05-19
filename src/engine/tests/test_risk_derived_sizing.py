"""Wave 21 E.2 — compute_risk_derived_contracts tests.

Port of src/server/lib/risk-sizing.test.ts known-answer tests.
Validates identical numeric outputs for the 4 canonical account balances
at ATR=4pts, stop_multiplier=1.5, MES point_value=$5.

Wave 22 note: these tests use firm="mffu" explicitly to preserve Wave 21
known-answer math (MFFU balance-pct branch). The default firm is now "topstep"
(operator primary per directive 2026-05-18). New Topstep tests live in
test_wave22_firm_sizing.py.

Math verification (MFFU branch):
  stopDollars     = 1.5 * 4.0 * 5.0 = $30/contract
  riskDollars@50K = 50000 * 0.02    = $1000
  riskCap@50K     = floor(1000/30)  = 33
  pyramidTier     = 4 + 2*floor(0/3000) = 4 (no accumulated profit)
  finalContracts  = min(4, 33, 100)  = 4  (pyramid is binding)

  riskCap@100K = floor(2000/30) = 66  → min(4,66,100) = 4
  riskCap@150K = floor(3000/30) = 100 → min(4,100,100) = 4
  riskCap@200K = floor(4000/30) = 133 → min(4,133,100) = 4

  All are pyramid-bound at base=4, cumulative_profit=0.
"""

import math
import pytest

from src.engine.sizing import compute_risk_derived_contracts, RiskSizingResult


# ── Standard parameters matching risk-sizing.ts tests ─────────────────────────
ATR_POINTS = 4.0          # 4 MES points
STOP_MULT = 1.5           # CLAUDE.md §4 default floor multiplier
POINT_VALUE = 5.0         # MES = $5/pt
BASE_CONTRACTS = 4
TIER_INCREMENT = 2
TIER_THRESHOLD = 3000.0   # $3K per tier
MAX_RISK_PCT = 0.02       # 2% rule
LIQUIDITY_CAP = 100


def _compute(
    account_balance: float,
    cumulative_profit: float = 0.0,
    atr: float = ATR_POINTS,
    stop_mult: float = STOP_MULT,
    firm_cap: int | None = None,
    topstep_override: int | None = None,
) -> RiskSizingResult:
    # Wave 22: explicitly pass firm="mffu" to preserve Wave 21 MFFU-math known answers.
    # New Topstep-specific tests live in test_wave22_firm_sizing.py.
    return compute_risk_derived_contracts(
        base_contracts=BASE_CONTRACTS,
        tier_increment=TIER_INCREMENT,
        tier_threshold_dollars=TIER_THRESHOLD,
        max_risk_pct_per_trade=MAX_RISK_PCT,
        liquidity_comfort_cap=LIQUIDITY_CAP,
        account_balance=account_balance,
        cumulative_profit=cumulative_profit,
        atr_points=atr,
        stop_multiplier=stop_mult,
        point_dollar_value=POINT_VALUE,
        firm_contract_cap=firm_cap,
        topstep_account_cap_override=topstep_override,
        firm="mffu",  # Wave 22: explicit; default changed to "topstep"
    )


class TestRiskDerivedContractsCanonical:
    """Known-answer tests matching risk-sizing.ts exactly."""

    def test_50k_no_profit_pyramid_binds(self):
        r = _compute(50_000, cumulative_profit=0)
        # stopDollars = 1.5 * 4 * 5 = $30; riskCap = floor(1000/30) = 33
        # pyramid = 4; final = min(4, 33, 100) = 4
        assert r.pyramid_tier == 4
        assert r.risk_derived_cap == 33
        assert r.final_contracts == 4
        assert r.rejection_reason is None

    def test_100k_no_profit_pyramid_binds(self):
        r = _compute(100_000, cumulative_profit=0)
        # riskCap = floor(2000/30) = 66; final = min(4, 66, 100) = 4
        assert r.pyramid_tier == 4
        assert r.risk_derived_cap == 66
        assert r.final_contracts == 4

    def test_150k_no_profit_pyramid_binds(self):
        r = _compute(150_000, cumulative_profit=0)
        # riskCap = floor(3000/30) = 100; final = min(4, 100, 100) = 4
        assert r.risk_derived_cap == 100
        assert r.final_contracts == 4

    def test_200k_no_profit_pyramid_binds(self):
        r = _compute(200_000, cumulative_profit=0)
        # riskCap = floor(4000/30) = 133; final = min(4, 133, 100) = 4
        assert r.risk_derived_cap == 133
        assert r.final_contracts == 4

    def test_profit_tier_1_3k_adds_2_contracts(self):
        # After $3K profit: 1 tier * 2 = +2; pyramidTier = 6; final = min(6, 33, 100) = 6
        r = _compute(50_000, cumulative_profit=3000)
        assert r.pyramid_tier == 6
        assert r.final_contracts == 6

    def test_profit_tier_2_6k_adds_4_contracts(self):
        # 2 tiers: pyramid = 4 + 4 = 8; final = min(8, 33, 100) = 8
        r = _compute(50_000, cumulative_profit=6000)
        assert r.pyramid_tier == 8
        assert r.final_contracts == 8

    def test_negative_profit_no_scaling(self):
        # Negative cumulative: tiers = 0; pyramid = base = 4
        r = _compute(50_000, cumulative_profit=-500)
        assert r.pyramid_tier == 4
        assert r.final_contracts == 4

    def test_risk_cap_binds_when_pyramid_exceeds_it(self):
        # Extreme profit: pyramid would be huge, but risk cap at $50K ATR=4 = 33
        r = _compute(50_000, cumulative_profit=99_000)
        assert r.pyramid_tier > 33  # large profit tier
        assert r.final_contracts == 33  # risk_derived is binding
        assert r.evidence.get("binding_cap") == "risk_derived"

    def test_liquidity_cap_binds(self):
        # At $1M balance, risk cap would be huge; liquidity_cap=100 binds
        r = _compute(1_000_000, cumulative_profit=0)
        assert r.final_contracts == 4  # pyramid still binding at 0 profit
        # Push pyramid high
        r2 = _compute(1_000_000, cumulative_profit=500_000)
        assert r2.final_contracts == 100  # liquidity cap = 100

    def test_firm_cap_overrides(self):
        r = _compute(200_000, cumulative_profit=100_000, firm_cap=10)
        assert r.final_contracts == 10  # firm cap wins
        assert r.firm_cap == 10

    def test_topstep_override_takes_priority(self):
        r = _compute(200_000, cumulative_profit=100_000, firm_cap=30, topstep_override=8)
        assert r.final_contracts == 8  # topstep override wins over firm_cap=30
        assert r.firm_cap == 8


class TestRiskDerivedContractsEdgeCases:
    """Rejection conditions — must match TypeScript behavior exactly."""

    def test_zero_atr_rejected(self):
        r = compute_risk_derived_contracts(
            base_contracts=4, tier_increment=2, tier_threshold_dollars=3000,
            max_risk_pct_per_trade=0.02, liquidity_comfort_cap=100,
            account_balance=50_000, cumulative_profit=0,
            atr_points=0.0, stop_multiplier=1.5, point_dollar_value=5.0,
        )
        assert r.rejection_reason == "zero_atr"
        assert r.final_contracts == 0

    def test_negative_atr_rejected(self):
        r = compute_risk_derived_contracts(
            base_contracts=4, tier_increment=2, tier_threshold_dollars=3000,
            max_risk_pct_per_trade=0.02, liquidity_comfort_cap=100,
            account_balance=50_000, cumulative_profit=0,
            atr_points=-1.0, stop_multiplier=1.5, point_dollar_value=5.0,
        )
        assert r.rejection_reason == "zero_atr"

    def test_zero_balance_rejected(self):
        r = compute_risk_derived_contracts(
            base_contracts=4, tier_increment=2, tier_threshold_dollars=3000,
            max_risk_pct_per_trade=0.02, liquidity_comfort_cap=100,
            account_balance=0.0, cumulative_profit=0,
            atr_points=4.0, stop_multiplier=1.5, point_dollar_value=5.0,
        )
        assert r.rejection_reason == "zero_balance"
        assert r.final_contracts == 0

    def test_negative_balance_rejected(self):
        r = compute_risk_derived_contracts(
            base_contracts=4, tier_increment=2, tier_threshold_dollars=3000,
            max_risk_pct_per_trade=0.02, liquidity_comfort_cap=100,
            account_balance=-1000.0, cumulative_profit=0,
            atr_points=4.0, stop_multiplier=1.5, point_dollar_value=5.0,
        )
        assert r.rejection_reason == "zero_balance"

    def test_extreme_atr_produces_negative_cap(self):
        # ATR=1000 pts: stopDollars = 1.5*1000*5 = $7500/contract
        # risk_dollars@50K = $1000; riskCap = floor(1000/7500) = 0
        r = compute_risk_derived_contracts(
            base_contracts=4, tier_increment=2, tier_threshold_dollars=3000,
            max_risk_pct_per_trade=0.02, liquidity_comfort_cap=100,
            account_balance=50_000, cumulative_profit=0,
            atr_points=1000.0, stop_multiplier=1.5, point_dollar_value=5.0,
        )
        assert r.rejection_reason == "negative_cap"
        assert r.final_contracts == 0

    def test_result_always_non_negative(self):
        r = _compute(1.0, cumulative_profit=-9999)
        assert r.final_contracts >= 0

    def test_evidence_fields_present(self):
        r = _compute(50_000)
        assert "account_balance" in r.evidence
        assert "pyramid_tier" in r.evidence
        assert "risk_derived_cap" in r.evidence
        assert "binding_cap" in r.evidence
        assert "tiers_earned" in r.evidence

    def test_floor_division_exact_boundary(self):
        # At cumulative_profit = 2999: tiers = floor(2999/3000) = 0 → pyramid = 4
        r = _compute(50_000, cumulative_profit=2999.99)
        assert r.pyramid_tier == 4

        # At exactly 3000: tiers = 1 → pyramid = 6
        r2 = _compute(50_000, cumulative_profit=3000.0)
        assert r2.pyramid_tier == 6

    def test_pyramid_math_independent_of_balance(self):
        # Pyramid tier is a function of profit, NOT balance
        r1 = _compute(50_000, cumulative_profit=9000)
        r2 = _compute(200_000, cumulative_profit=9000)
        assert r1.pyramid_tier == r2.pyramid_tier  # both = 4 + 2*3 = 10
