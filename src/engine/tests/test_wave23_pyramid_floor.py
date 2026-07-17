"""Wave 23 B.1 — Pyramid floor enforcement tests (Python parity with risk-sizing-wave23.test.ts).

Architecture:
  On HEALTHY accounts (balance >= 85% of starting_capital):
    final_contracts = max(base_contracts, min(pyramid_tier, risk_derived_cap, firm_cap, liquidity_cap))
    Pyramid BASE overrides risk-cap to protect Style C 33/33/33 divisibility.
  On DRAWDOWN accounts (balance < 85% of starting_capital):
    final_contracts = min(pyramid_tier, risk_derived_cap, firm_cap, liquidity_cap)
    Risk-cap fully binds to protect firm compliance.

Micro bases (Wave 23 operator-locked):
  MES: base=6 (6 × $5/pt × 14pt ceiling = $420/trade)
  MNQ: base=6 (6 × $2/pt × 40pt ceiling = $480/trade)
  MCL: base=18 (18 × $1/tick × 25-tick ceiling = $450/trade)
  All divisible by 3 → Style C 33/33/33 partials clean.
"""

import pytest

from src.engine.sizing import compute_risk_derived_contracts, RiskSizingResult


# ── Standard test parameters ─────────────────────────────────────────────────

BASE_MES = 6
BASE_MNQ = 6
BASE_MCL = 18
INCREMENT = 3
THRESHOLD = 3000.0
MAX_RISK = 0.02
LIQUIDITY_CAP = 100

ATR_MES = 4.0    # 4 MES points
ATR_MNQ = 4.0    # 4 MNQ points
ATR_MCL = 0.1    # 0.1 CL points (= ~10 ticks)
STOP_MULT = 1.5

PV_MES = 5.0     # $5/pt
PV_MNQ = 2.0     # $2/pt
PV_MCL = 100.0   # $100/pt ($1/tick × 100 ticks/pt)

# Standard Topstep 50K fresh combine
TOPSTEP_PARAMS = dict(
    firm="topstep",
    trailing_dd=2000.0,
    high_water_balance=50_000.0,
    account_starting_floor=50_000.0,
)


def _mes(
    account_balance=50_000.0,
    cumulative_profit=0.0,
    atr=ATR_MES,
    firm_cap=15,
    **kwargs,
) -> RiskSizingResult:
    return compute_risk_derived_contracts(
        base_contracts=BASE_MES,
        tier_increment=INCREMENT,
        tier_threshold_dollars=THRESHOLD,
        max_risk_pct_per_trade=MAX_RISK,
        liquidity_comfort_cap=LIQUIDITY_CAP,
        account_balance=account_balance,
        cumulative_profit=cumulative_profit,
        atr_points=atr,
        stop_multiplier=STOP_MULT,
        point_dollar_value=PV_MES,
        firm_contract_cap=firm_cap,
        **kwargs,
    )


def _mnq(
    account_balance=50_000.0,
    cumulative_profit=0.0,
    atr=ATR_MNQ,
    firm_cap=15,
    **kwargs,
) -> RiskSizingResult:
    return compute_risk_derived_contracts(
        base_contracts=BASE_MNQ,
        tier_increment=INCREMENT,
        tier_threshold_dollars=THRESHOLD,
        max_risk_pct_per_trade=MAX_RISK,
        liquidity_comfort_cap=LIQUIDITY_CAP,
        account_balance=account_balance,
        cumulative_profit=cumulative_profit,
        atr_points=atr,
        stop_multiplier=STOP_MULT,
        point_dollar_value=PV_MNQ,
        firm_contract_cap=firm_cap,
        **kwargs,
    )


def _mcl(
    account_balance=50_000.0,
    cumulative_profit=0.0,
    atr=ATR_MCL,
    firm_cap=None,
    **kwargs,
) -> RiskSizingResult:
    return compute_risk_derived_contracts(
        base_contracts=BASE_MCL,
        tier_increment=INCREMENT,
        tier_threshold_dollars=THRESHOLD,
        max_risk_pct_per_trade=MAX_RISK,
        liquidity_comfort_cap=LIQUIDITY_CAP,
        account_balance=account_balance,
        cumulative_profit=cumulative_profit,
        atr_points=atr,
        stop_multiplier=STOP_MULT,
        point_dollar_value=PV_MCL,
        firm_contract_cap=firm_cap,
        **kwargs,
    )


# ─────────────────────────────────────────────────────────────────────────────
# MES base 6 at $50K Topstep healthy
# ─────────────────────────────────────────────────────────────────────────────

class TestMesBase6TopstepHealthy:
    """MES base=6 at fresh $50K Topstep combine. Pyramid floor must override riskCap."""

    def test_floor_overrides_risk_cap_on_fresh_combine(self):
        """C-05/D9 (2026-07-16): floor override REMOVED — risk math wins, lowest wins.
        Topstep $50K: buffer=$2K, riskCap=1. Final size is now the risk cap (1), NOT base 6."""
        r = _mes(**TOPSTEP_PARAMS)
        assert r.final_contracts == 1, f"Expected 1 (risk cap wins), got {r.final_contracts}"
        assert r.pyramid_floor_applied is False
        assert r.risk_derived_cap == 1  # only 1 contract from buffer math — this now binds
        assert r.account_health_ratio == pytest.approx(1.0, abs=0.01)
        assert r.rejection_reason is None

    def test_tier_ladder_divisible_by_3(self):
        """Tier ladder 6→9→12→15→18→21 all divisible by 3."""
        profit_levels = [0, 3000, 6000, 9000, 12_000, 15_000]
        expected = [6, 9, 12, 15, 18, 21]

        for i, profit in enumerate(profit_levels):
            # Use MFFU to avoid trailing-DD complexity in this ladder test
            r = compute_risk_derived_contracts(
                base_contracts=BASE_MES,
                tier_increment=INCREMENT,
                tier_threshold_dollars=THRESHOLD,
                max_risk_pct_per_trade=MAX_RISK,
                liquidity_comfort_cap=LIQUIDITY_CAP,
                account_balance=200_000.0,
                cumulative_profit=float(profit),
                atr_points=ATR_MES,
                stop_multiplier=STOP_MULT,
                point_dollar_value=PV_MES,
                firm="mffu",
            )
            assert r.pyramid_tier == expected[i], (
                f"At profit={profit}: expected pyramid_tier={expected[i]}, got {r.pyramid_tier}"
            )
            assert r.pyramid_tier % 3 == 0, (
                f"pyramid_tier={r.pyramid_tier} not divisible by 3 at profit={profit}"
            )

    def test_tier_ladder_ceiling_at_33(self):
        """At $81K profit (27 tiers), liquidity_cap=33 binds."""
        r = compute_risk_derived_contracts(
            base_contracts=BASE_MES,
            tier_increment=INCREMENT,
            tier_threshold_dollars=THRESHOLD,
            max_risk_pct_per_trade=MAX_RISK,
            liquidity_comfort_cap=33,  # operator ceiling
            account_balance=200_000.0,
            cumulative_profit=81_000.0,  # 27 tiers → 6+81=87 but cap=33
            atr_points=ATR_MES,
            stop_multiplier=STOP_MULT,
            point_dollar_value=PV_MES,
            firm="mffu",
        )
        # pyramid_tier = 6 + 3*27 = 87, but liquidity_cap=33 binds
        assert r.final_contracts == 33
        assert r.liquidity_cap == 33


# ─────────────────────────────────────────────────────────────────────────────
# MES base 6 at $50K drawdown (risk-cap must bind, floor must NOT apply)
# ─────────────────────────────────────────────────────────────────────────────

class TestMesBase6DrawdownAccount:
    """Account below 85% health — floor must NOT apply."""

    def test_floor_does_not_apply_below_85pct_health(self):
        """At 70% health (large drawdown), risk-cap fully binds, floor does not apply."""
        # High ATR to force riskCap < base
        r = compute_risk_derived_contracts(
            base_contracts=BASE_MES,
            tier_increment=INCREMENT,
            tier_threshold_dollars=THRESHOLD,
            max_risk_pct_per_trade=MAX_RISK,
            liquidity_comfort_cap=LIQUIDITY_CAP,
            account_balance=35_000.0,   # $35K = 70% of $50K → drawdown
            cumulative_profit=-15_000.0,
            atr_points=20.0,            # high ATR → low risk cap
            stop_multiplier=STOP_MULT,
            point_dollar_value=PV_MES,
            firm="mffu",
            account_starting_floor=50_000.0,
        )
        assert r.account_health_ratio == pytest.approx(0.70, abs=0.01)
        assert r.pyramid_floor_applied is False
        # riskDollars = 35K * 0.02 = $700; stopDollars = 1.5*20*5 = $150; riskCap = 4
        assert r.risk_derived_cap == 4
        assert r.final_contracts == 4  # risk-cap binds, pyramid tier (6) is capped

    def test_zero_buffer_overrides_floor_on_topstep_large_drawdown(self):
        """Topstep below trailing floor → zero_buffer, no floor applies."""
        r = _mes(
            account_balance=47_000.0,  # below trailing floor of 48K
            cumulative_profit=-3_000.0,
            firm="topstep",
            trailing_dd=2000.0,
            high_water_balance=50_000.0,
            account_starting_floor=50_000.0,
        )
        assert r.rejection_reason == "zero_buffer"
        assert r.final_contracts == 0
        assert r.pyramid_floor_applied is False

    def test_floor_does_not_apply_at_84pct_health(self):
        """Exactly 84.9% health — just below threshold, floor must NOT apply."""
        r = compute_risk_derived_contracts(
            base_contracts=BASE_MES,
            tier_increment=INCREMENT,
            tier_threshold_dollars=THRESHOLD,
            max_risk_pct_per_trade=MAX_RISK,
            liquidity_comfort_cap=LIQUIDITY_CAP,
            account_balance=42_450.0,   # 84.9% of $50K
            cumulative_profit=-7_550.0,
            atr_points=20.0,
            stop_multiplier=STOP_MULT,
            point_dollar_value=PV_MES,
            firm="mffu",
            account_starting_floor=50_000.0,
        )
        assert r.account_health_ratio == pytest.approx(0.849, abs=0.001)
        assert r.pyramid_floor_applied is False
        # riskCap < base → risk-cap binds (not floor)
        assert r.final_contracts < BASE_MES


# ─────────────────────────────────────────────────────────────────────────────
# MNQ base 6 at $50K Topstep healthy
# ─────────────────────────────────────────────────────────────────────────────

class TestMnqBase6TopstepHealthy:
    """MNQ base=6 at fresh $50K Topstep combine."""

    def test_floor_overrides_risk_cap(self):
        """C-05/D9: floor override REMOVED. MNQ stopDollars=12, buffer=$2K, riskCap=3 < base=6
        → risk cap (3) now binds (lowest wins), not base 6."""
        r = _mnq(**TOPSTEP_PARAMS)
        assert r.final_contracts == 3
        assert r.pyramid_floor_applied is False
        # stopDollars = 1.5 * 4 * 2 = $12; riskDollars = 2000 * 0.02 = $40; riskCap=floor(40/12)=3
        assert r.risk_derived_cap == 3
        assert r.rejection_reason is None

    def test_mnq_dollar_risk_sanity(self):
        """MNQ base 6: 6 × $2/pt × 40pt ceiling = $480/trade."""
        dollar_risk = 6 * 2.0 * 40.0
        assert dollar_risk == 480.0


# ─────────────────────────────────────────────────────────────────────────────
# MCL base 18 at $50K Topstep healthy
# ─────────────────────────────────────────────────────────────────────────────

class TestMclBase18TopstepHealthy:
    """MCL base=18 at fresh $50K Topstep combine."""

    def test_floor_overrides_risk_cap(self):
        """C-05/D9: floor override REMOVED. MCL very low stopDollars → riskCap < 18 → risk cap
        now binds (lowest wins), not base 18. stopDollars=1.5*0.1*100=15, riskDollars=40 → riskCap=2."""
        r = _mcl(**TOPSTEP_PARAMS)
        assert r.risk_derived_cap == 2
        assert r.final_contracts == 2
        assert r.pyramid_floor_applied is False
        assert r.risk_derived_cap < 18
        assert r.rejection_reason is None

    def test_mcl_dollar_risk_sanity(self):
        """MCL base 18: 18 × $1/tick × 25-tick ceiling = $450/trade."""
        # MCL: 1 tick = $1.00; 25-tick ceiling = $25/contract
        dollar_risk = 18 * 1.0 * 25
        assert dollar_risk == 450.0

    def test_mcl_tier_ladder_divisible_by_3(self):
        """MCL tier ladder 18→21→24→27 all divisible by 3."""
        profit_levels = [0, 3000, 6000, 9000]
        expected = [18, 21, 24, 27]

        for i, profit in enumerate(profit_levels):
            r = _mcl(
                account_balance=200_000.0,
                cumulative_profit=float(profit),
                firm="mffu",
            )
            assert r.pyramid_tier == expected[i], (
                f"profit={profit}: expected={expected[i]}, got={r.pyramid_tier}"
            )
            assert r.pyramid_tier % 3 == 0


# ─────────────────────────────────────────────────────────────────────────────
# MES base 6 at $50K MFFU healthy (riskCap=33 >> base=6, no floor needed)
# ─────────────────────────────────────────────────────────────────────────────

class TestMesBase6MffuHealthy:
    """MFFU has large risk cap. Pyramid tier binds normally (not floor)."""

    def test_mffu_pyramid_tier_binds_normally(self):
        """MFFU: riskCap=33 >> base=6 → pyramidTier (6) binds, NO floor applied."""
        r = _mes(firm="mffu", firm_cap=15)
        assert r.final_contracts == 6
        assert r.pyramid_floor_applied is False  # floor NOT needed (risk-cap is large)
        assert r.risk_derived_cap == 33  # MFFU balance-pct gives 33 contracts
        assert r.evidence.get("binding_cap") == "pyramid"


# ─────────────────────────────────────────────────────────────────────────────
# Account health boundary at exactly 85%
# ─────────────────────────────────────────────────────────────────────────────

class TestAccountHealthBoundary:
    """Exact 85% boundary — floor binds AT 85%, not below."""

    def test_exactly_85pct_health_floor_applies(self):
        """C-05/D9: floor override REMOVED — health ratio no longer lifts size to base.
        At exactly 85% ($42,500 / $50K), the risk cap (5) binds regardless of health (lowest wins)."""
        r = compute_risk_derived_contracts(
            base_contracts=BASE_MES,
            tier_increment=INCREMENT,
            tier_threshold_dollars=THRESHOLD,
            max_risk_pct_per_trade=MAX_RISK,
            liquidity_comfort_cap=LIQUIDITY_CAP,
            account_balance=42_500.0,   # exactly 85% of 50K
            cumulative_profit=-7_500.0,
            atr_points=20.0,
            stop_multiplier=STOP_MULT,
            point_dollar_value=PV_MES,
            firm="mffu",
            account_starting_floor=50_000.0,
        )
        assert r.account_health_ratio == pytest.approx(0.85, abs=0.001)
        # riskCap = floor((42500*0.02) / (1.5*20*5)) = floor(850/150) = 5 < 6
        assert r.risk_derived_cap == 5
        assert r.pyramid_floor_applied is False
        assert r.final_contracts == 5  # risk cap binds — no floor override

    def test_just_below_85pct_health_floor_does_not_apply(self):
        """At 84.9% ($42,450 / $50K), floor does NOT apply."""
        r = compute_risk_derived_contracts(
            base_contracts=BASE_MES,
            tier_increment=INCREMENT,
            tier_threshold_dollars=THRESHOLD,
            max_risk_pct_per_trade=MAX_RISK,
            liquidity_comfort_cap=LIQUIDITY_CAP,
            account_balance=42_450.0,
            cumulative_profit=-7_550.0,
            atr_points=20.0,
            stop_multiplier=STOP_MULT,
            point_dollar_value=PV_MES,
            firm="mffu",
            account_starting_floor=50_000.0,
        )
        assert r.account_health_ratio == pytest.approx(0.849, abs=0.001)
        assert r.pyramid_floor_applied is False
        assert r.final_contracts == 5  # risk-cap binds (5 < base 6)


# ─────────────────────────────────────────────────────────────────────────────
# Point value correctness (B.3 sanity)
# ─────────────────────────────────────────────────────────────────────────────

class TestPointValueCorrectness:
    """Ensure micro point values are not confused with mini values."""

    def test_mes_5_vs_mini_es_50(self):
        """MES=$5/pt, mini ES=$50/pt. Using $50 causes 10x risk underestimation."""
        r_correct = _mes(firm="mffu", firm_cap=None)
        r_wrong = compute_risk_derived_contracts(
            base_contracts=BASE_MES,
            tier_increment=INCREMENT,
            tier_threshold_dollars=THRESHOLD,
            max_risk_pct_per_trade=MAX_RISK,
            liquidity_comfort_cap=LIQUIDITY_CAP,
            account_balance=50_000.0,
            cumulative_profit=0.0,
            atr_points=ATR_MES,
            stop_multiplier=STOP_MULT,
            point_dollar_value=50.0,  # WRONG: mini ES
            firm="mffu",
        )
        # correct: riskCap = floor(1000/30) = 33
        assert r_correct.risk_derived_cap == 33
        # wrong: riskCap = floor(1000/300) = 3 (10x under-allocation)
        assert r_wrong.risk_derived_cap == 3

    def test_mnq_2_vs_mini_nq_20(self):
        """MNQ=$2/pt, mini NQ=$20/pt. Using $20 causes 10x risk underestimation."""
        r_correct = _mnq(firm="mffu", firm_cap=None)
        r_wrong = compute_risk_derived_contracts(
            base_contracts=BASE_MNQ,
            tier_increment=INCREMENT,
            tier_threshold_dollars=THRESHOLD,
            max_risk_pct_per_trade=MAX_RISK,
            liquidity_comfort_cap=LIQUIDITY_CAP,
            account_balance=50_000.0,
            cumulative_profit=0.0,
            atr_points=ATR_MNQ,
            stop_multiplier=STOP_MULT,
            point_dollar_value=20.0,  # WRONG: mini NQ
            firm="mffu",
        )
        # correct: stopDollars=12, riskCap=floor(1000/12)=83
        assert r_correct.risk_derived_cap == 83
        # wrong: stopDollars=120, riskCap=floor(1000/120)=8
        assert r_wrong.risk_derived_cap == 8
