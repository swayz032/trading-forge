"""Wave 22 — Firm-aware risk-derived contract sizing tests.

Tests both Topstep (trailing-DD buffer math) and MFFU (balance-pct math).
Exact Python mirror of src/server/lib/__tests__/risk-sizing.test.ts.

Math reference (ATR=4pt, stop_mult=1.5, MES=$5/pt, stopDollars=$30/contract):

MFFU:
  riskDollars = balance * 0.02
  riskCap@50K = floor(1000/30) = 33

Topstep (trailing-DD buffer):
  trailingFloor = min(HWM - trailingDD, startingFloor)
  buffer = balance - trailingFloor
  riskDollars = buffer * 0.02

  At start (balance=HWM=50K, trailingDD=2K, startingFloor=50K):
    floor = min(48K, 50K) = 48K
    buffer = 50K - 48K = $2,000
    riskCap = floor(40/30) = 1

  After $3K profit (balance=53K, HWM=53K):
    floor = min(51K, 50K) = 50K  [locked]
    buffer = $3,000
    riskCap = floor(60/30) = 2

  At drawdown (balance=49K, HWM=50K):
    floor = 48K; buffer = $1,000
    riskCap = floor(20/30) = 0 → negative_cap
"""

import math
import pytest

from src.engine.sizing import (
    compute_risk_derived_contracts,
    RiskSizingResult,
    _compute_topstep_trailing_floor,
)


# ── Standard parameters ────────────────────────────────────────────────────────

ATR = 4.0
STOP_MULT = 1.5
PV = 5.0     # MES $5/pt
BASE = 4
INC = 2
THRESH = 3000.0
MAX_RISK = 0.02
LIQ_CAP = 100


def _ts(
    balance: float,
    pnl: float = 0.0,
    hwm: float | None = None,
    trailing_dd: float = 2000.0,
    starting_floor: float = 50_000.0,
    firm_cap: int | None = 15,
    topstep_override: int | None = None,
) -> RiskSizingResult:
    """Helper: Topstep call."""
    return compute_risk_derived_contracts(
        base_contracts=BASE,
        tier_increment=INC,
        tier_threshold_dollars=THRESH,
        max_risk_pct_per_trade=MAX_RISK,
        liquidity_comfort_cap=LIQ_CAP,
        account_balance=balance,
        cumulative_profit=pnl,
        atr_points=ATR,
        stop_multiplier=STOP_MULT,
        point_dollar_value=PV,
        firm_contract_cap=firm_cap,
        topstep_account_cap_override=topstep_override,
        firm="topstep",
        trailing_dd=trailing_dd,
        high_water_balance=hwm,   # None → defaults to balance
        account_starting_floor=starting_floor,
    )


def _mffu(
    balance: float,
    pnl: float = 0.0,
    firm_cap: int | None = 15,
) -> RiskSizingResult:
    """Helper: MFFU call."""
    return compute_risk_derived_contracts(
        base_contracts=BASE,
        tier_increment=INC,
        tier_threshold_dollars=THRESH,
        max_risk_pct_per_trade=MAX_RISK,
        liquidity_comfort_cap=LIQ_CAP,
        account_balance=balance,
        cumulative_profit=pnl,
        atr_points=ATR,
        stop_multiplier=STOP_MULT,
        point_dollar_value=PV,
        firm_contract_cap=firm_cap,
        firm="mffu",
    )


# ─────────────────────────────────────────────────────────────────────────────
# Topstep trailing-floor helper
# ─────────────────────────────────────────────────────────────────────────────

class TestTopstepTrailingFloor:

    def test_at_starting_balance_floor_is_48k(self):
        # HWM = starting balance = $50K; floor = min(48K, 50K) = 48K
        f = _compute_topstep_trailing_floor(50_000, 2000, 50_000)
        assert f == 48_000

    def test_floor_trails_hwm_before_lock(self):
        # HWM = $51K; floor = min(49K, 50K) = 49K
        f = _compute_topstep_trailing_floor(51_000, 2000, 50_000)
        assert f == 49_000

    def test_floor_locks_at_starting_once_hwm_reaches_52k(self):
        # HWM = $52K; floor = min(50K, 50K) = 50K (locked)
        f = _compute_topstep_trailing_floor(52_000, 2000, 50_000)
        assert f == 50_000

    def test_floor_stays_locked_above_52k(self):
        # HWM = $70K; floor = min(68K, 50K) = 50K (still locked)
        f = _compute_topstep_trailing_floor(70_000, 2000, 50_000)
        assert f == 50_000

    def test_floor_below_starting_for_sub_50k_hwm(self):
        # HWM = $49K (not yet at starting); floor = min(47K, 50K) = 47K
        f = _compute_topstep_trailing_floor(49_000, 2000, 50_000)
        assert f == 47_000


# ─────────────────────────────────────────────────────────────────────────────
# MFFU branch (unchanged from Wave 21)
# ─────────────────────────────────────────────────────────────────────────────

class TestMffuBranch:

    def test_50k_balance_risk_cap_33(self):
        r = _mffu(50_000)
        assert r.risk_cap_method == "mffu_balance_pct"
        assert r.firm == "mffu"
        assert r.risk_derived_cap == 33
        assert r.pyramid_tier == 4
        assert r.final_contracts == 4
        assert r.rejection_reason is None

    def test_100k_risk_cap_66(self):
        r = _mffu(100_000)
        assert r.risk_derived_cap == 66
        assert r.final_contracts == 4  # pyramid binds

    def test_150k_risk_cap_100(self):
        r = _mffu(150_000)
        assert r.risk_derived_cap == 100
        assert r.final_contracts == 4  # pyramid still binding

    def test_200k_risk_cap_133(self):
        r = _mffu(200_000)
        assert r.risk_derived_cap == 133
        assert r.final_contracts == 4

    def test_mffu_zero_balance_rejected(self):
        r = _mffu(0.0)
        assert r.rejection_reason == "zero_balance"
        assert r.firm == "mffu"

    def test_mffu_evidence_has_firm_field(self):
        r = _mffu(50_000)
        assert r.evidence["firm"] == "mffu"
        assert r.evidence["risk_cap_method"] == "mffu_balance_pct"

    def test_mffu_no_trailing_floor_in_evidence(self):
        # Topstep-specific fields must NOT appear in MFFU evidence
        r = _mffu(50_000)
        assert "trailing_floor" not in r.evidence
        assert "buffer" not in r.evidence


# ─────────────────────────────────────────────────────────────────────────────
# Topstep branch — trailing-DD buffer math (Wave 22)
# ─────────────────────────────────────────────────────────────────────────────

class TestTopstepBranch:

    def test_at_high_water_buffer_2k_risk_cap_1(self):
        # HWM=balance=50K; floor=48K; buffer=2K; riskDollars=40; riskCap=1
        r = _ts(50_000, hwm=50_000)
        assert r.risk_cap_method == "topstep_trailing_dd"
        assert r.firm == "topstep"
        assert r.evidence["trailing_floor"] == 48_000
        assert r.evidence["buffer"] == 2_000
        assert r.risk_derived_cap == 1
        assert r.final_contracts == 1
        assert r.rejection_reason is None

    def test_after_3k_profit_floor_locks(self):
        # balance=53K, HWM=53K; floor=min(51K,50K)=50K; buffer=3K; riskCap=2
        r = _ts(53_000, pnl=3_000, hwm=53_000)
        assert r.evidence["trailing_floor"] == 50_000   # locked
        assert r.evidence["buffer"] == 3_000
        assert r.risk_derived_cap == 2
        assert r.pyramid_tier == 6  # 4 + 2*floor(3000/3000) = 6
        assert r.final_contracts == 2

    def test_70k_balance_large_buffer(self):
        # balance=70K, HWM=70K; floor=min(68K,50K)=50K; buffer=20K
        # riskDollars=400; riskCap=floor(400/30)=13
        # pyramid=4+2*floor(20000/3000)=4+12=16; firmCap=15
        # final=min(16,13,15,100)=13
        r = _ts(70_000, pnl=20_000, hwm=70_000)
        assert r.evidence["trailing_floor"] == 50_000
        assert r.evidence["buffer"] == 20_000
        assert r.risk_derived_cap == 13
        assert r.pyramid_tier == 16
        assert r.final_contracts == 13  # risk_derived binds

    def test_hwm_below_starting_balance(self):
        # HWM=49.5K; floor=min(47.5K,50K)=47.5K; buffer=2K
        r = _ts(49_500, hwm=49_500)
        assert r.evidence["trailing_floor"] == 47_500
        assert r.evidence["buffer"] == 2_000
        assert r.risk_derived_cap == 1

    def test_drawdown_small_buffer_negative_cap(self):
        # balance=49K, HWM=50K; floor=48K; buffer=1K
        # riskDollars=20; riskCap=floor(20/30)=0 → negative_cap
        r = _ts(49_000, hwm=50_000)
        assert r.evidence["buffer"] == 1_000
        assert r.rejection_reason == "negative_cap"
        assert r.final_contracts == 0

    def test_at_trailing_floor_zero_buffer(self):
        # balance=48K exactly at floor → buffer=0 → zero_buffer
        r = _ts(48_000, hwm=50_000)
        assert r.rejection_reason == "zero_buffer"
        assert r.final_contracts == 0

    def test_below_trailing_floor_zero_buffer(self):
        # balance=47K < floor → buffer<0 → zero_buffer
        r = _ts(47_000, hwm=50_000)
        assert r.rejection_reason == "zero_buffer"
        assert r.final_contracts == 0

    def test_zero_atr_rejected(self):
        r = compute_risk_derived_contracts(
            base_contracts=BASE, tier_increment=INC, tier_threshold_dollars=THRESH,
            max_risk_pct_per_trade=MAX_RISK, liquidity_comfort_cap=LIQ_CAP,
            account_balance=50_000, cumulative_profit=0,
            atr_points=0.0, stop_multiplier=STOP_MULT, point_dollar_value=PV,
            firm="topstep", trailing_dd=2000, high_water_balance=50_000,
        )
        assert r.rejection_reason == "zero_atr"
        assert r.firm == "topstep"

    def test_firm_cap_10_binds_when_risk_cap_higher(self):
        # buffer=20K; riskCap=13 > firmCap=10 → firm binds
        r = _ts(70_000, pnl=20_000, hwm=70_000, firm_cap=10)
        assert r.firm_cap == 10
        assert r.final_contracts == 10
        assert r.firm_cap_applied is True

    def test_firm_cap_15_does_not_bind_when_risk_cap_lower(self):
        # riskCap=1 < firmCap=15 → firm cap not binding
        r = _ts(50_000, hwm=50_000, firm_cap=15)
        assert r.final_contracts == 1
        assert r.firm_cap_applied is False

    def test_evidence_contains_topstep_fields(self):
        r = _ts(53_000, hwm=53_000)
        assert "trailing_floor" in r.evidence
        assert "buffer" in r.evidence
        assert "high_water_balance" in r.evidence
        assert "trailing_dd" in r.evidence
        assert "account_starting_floor" in r.evidence
        assert r.evidence["firm"] == "topstep"
        assert r.evidence["risk_cap_method"] == "topstep_trailing_dd"

    def test_zero_buffer_evidence_has_topstep_fields(self):
        r = _ts(48_000, hwm=50_000)
        assert r.rejection_reason == "zero_buffer"
        assert r.evidence.get("trailing_floor") is not None
        assert r.evidence.get("buffer") is not None


# ─────────────────────────────────────────────────────────────────────────────
# Default firm = "topstep" (operator directive 2026-05-18)
# ─────────────────────────────────────────────────────────────────────────────

class TestDefaultFirm:

    def test_default_firm_is_topstep(self):
        # No firm arg → defaults to "topstep"
        r = compute_risk_derived_contracts(
            base_contracts=BASE, tier_increment=INC, tier_threshold_dollars=THRESH,
            max_risk_pct_per_trade=MAX_RISK, liquidity_comfort_cap=LIQ_CAP,
            account_balance=50_000, cumulative_profit=0,
            atr_points=ATR, stop_multiplier=STOP_MULT, point_dollar_value=PV,
            # firm not passed → defaults to "topstep"
        )
        assert r.firm == "topstep"
        assert r.risk_cap_method == "topstep_trailing_dd"

    def test_default_uses_standard_trailing_dd(self):
        # Without trailing state: HWM defaults to balance, trailingDD=2000, floor=50K
        r = compute_risk_derived_contracts(
            base_contracts=BASE, tier_increment=INC, tier_threshold_dollars=THRESH,
            max_risk_pct_per_trade=MAX_RISK, liquidity_comfort_cap=LIQ_CAP,
            account_balance=50_000, cumulative_profit=0,
            atr_points=ATR, stop_multiplier=STOP_MULT, point_dollar_value=PV,
        )
        assert r.evidence.get("trailing_floor") == 48_000
        assert r.evidence.get("buffer") == 2_000


# ─────────────────────────────────────────────────────────────────────────────
# Cross-firm comparison
# ─────────────────────────────────────────────────────────────────────────────

class TestCrossFirmComparison:

    def test_topstep_vs_mffu_different_risk_caps(self):
        ts = _ts(50_000, hwm=50_000)
        mf = _mffu(50_000)
        # Topstep: buffer=2K → riskCap=1; MFFU: balance=50K → riskCap=33
        assert ts.risk_derived_cap == 1
        assert mf.risk_derived_cap == 33
        assert ts.risk_derived_cap < mf.risk_derived_cap

    def test_both_firms_bounded_by_firm_cap(self):
        ts = _ts(70_000, pnl=20_000, hwm=70_000, firm_cap=15)
        mf = _mffu(70_000, pnl=20_000, firm_cap=15)
        assert ts.final_contracts <= 15
        assert mf.final_contracts <= 15

    def test_topstep_more_conservative_at_same_balance(self):
        ts = _ts(70_000, pnl=20_000, hwm=70_000)
        mf = _mffu(70_000, pnl=20_000)
        # Topstep sizing must always be <= MFFU at same balance
        # (because Topstep uses buffer, not full balance)
        assert ts.final_contracts <= mf.final_contracts


# ─────────────────────────────────────────────────────────────────────────────
# Wave 21 backward compatibility — existing tests still pass with new signature
# ─────────────────────────────────────────────────────────────────────────────

class TestBackwardCompat:
    """Wave 21 call sites that don't pass firm= still work identically.

    When firm is not passed, defaults to "topstep" with conservative Topstep
    buffer math. This is intentionally stricter than the old MFFU-first behavior
    (which used balance * 0.02). Existing tests that expected specific numeric
    outputs from the MFFU path now need to pass firm="mffu" explicitly.
    """

    def test_mffu_known_answer_explicit_firm(self):
        # Wave 21 known-answer test: 50K balance, stopDollars=$30, riskCap=33
        r = compute_risk_derived_contracts(
            base_contracts=4, tier_increment=2, tier_threshold_dollars=3000,
            max_risk_pct_per_trade=0.02, liquidity_comfort_cap=100,
            account_balance=50_000, cumulative_profit=0,
            atr_points=4.0, stop_multiplier=1.5, point_dollar_value=5.0,
            firm="mffu",
        )
        assert r.risk_derived_cap == 33
        assert r.final_contracts == 4  # pyramid binding

    def test_topstep_50k_at_start_known_answer(self):
        # Topstep default with no trailing state: buffer=2K, riskCap=1
        r = compute_risk_derived_contracts(
            base_contracts=4, tier_increment=2, tier_threshold_dollars=3000,
            max_risk_pct_per_trade=0.02, liquidity_comfort_cap=100,
            account_balance=50_000, cumulative_profit=0,
            atr_points=4.0, stop_multiplier=1.5, point_dollar_value=5.0,
            firm="topstep",
        )
        assert r.risk_derived_cap == 1
        assert r.final_contracts == 1
