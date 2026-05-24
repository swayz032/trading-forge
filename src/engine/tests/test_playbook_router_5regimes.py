"""W25.10 — 5-regime institutional expansion: playbook_router tests.

Tests for the 4 new institutional routing arms in route_playbook().

Coverage:
  1.  EXPANSION  → DISPLACEMENT_CONTINUATION
  2.  COMPRESSION → BREAKOUT_PREP
  3.  HIGH_VOL_MACRO → REDUCED_SIZING
  4.  LOW_LIQ_CHOP → NO_TRADE (with specific reason)
  5.  institutional_regime=None → existing 3-regime routing unchanged
  6.  Existing: TRENDING_UP/TREND_CONTINUATION_LONG unchanged
  7.  Existing: TRENDING_DOWN/TREND_CONTINUATION_SHORT unchanged
  8.  Existing: SWEEP_REVERSAL_LONG unchanged
  9.  Existing: SWEEP_REVERSAL_SHORT unchanged
  10. DISPLACEMENT_CONTINUATION has CONTINUATION_STRATS allowed
  11. BREAKOUT_PREP has ORB_STRATS + CONTINUATION_STRATS allowed
  12. REDUCED_SIZING has confidence_modifier=0.6 (reduced risk)
  13. DISPLACEMENT_CONTINUATION has confidence_modifier=1.0
  14. BREAKOUT_PREP has confidence_modifier=0.8
  15. LOW_LIQ_CHOP NO_TRADE does NOT require daily_loss_cap_near
  16. HIGH_VOL_MACRO REDUCED_SIZING bypasses classic no-trade conditions
  17. EXPANSION bypasses classic no-trade conditions
  18. Institutional regime arms run before classic NO_TRADE check
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

import pytest

from src.engine.context.bias_engine import (
    DailyBiasState,
    RegimeEvidence,
)
from src.engine.context.htf_context import HTFContext
from src.engine.context.session_context import SessionContext
from src.engine.context.playbook_router import (
    route_playbook,
    PlaybookDecision,
    CONTINUATION_STRATS,
    ORB_STRATS,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_htf(
    atr_percentile: float = 50.0,
    daily_trend: str = "bullish",
    pd_location: str = "discount",
    adx: float = 28.0,
) -> HTFContext:
    return HTFContext(
        daily_trend=daily_trend,
        weekly_trend=daily_trend,
        four_h_trend=daily_trend,
        adx=adx,
        atr_percentile=atr_percentile,
        pd_location=pd_location,
        prev_day_high=5300.0,
        prev_day_low=5100.0,
        prev_day_close=5200.0,
        weekly_high=5350.0,
        weekly_low=5050.0,
        adr=100.0,
    )


def make_session(
    overnight_bias: str = "bullish",
    london_swept_pdl: bool = False,
    london_swept_pdh: bool = False,
    or_broken: str = "none",
) -> SessionContext:
    return SessionContext(
        overnight_range=(5150.0, 5250.0),
        overnight_bias=overnight_bias,
        london_high=5240.0,
        london_low=5160.0,
        london_swept_pdl=london_swept_pdl,
        london_swept_pdh=london_swept_pdh,
        ny_killzone_active=True,
        london_killzone_active=False,
        asian_killzone_active=False,
        current_session="rth",
        opening_range=(5180.0, 5220.0),
        or_broken=or_broken,
        macro_time_active=False,
    )


def make_evidence(
    atr_pct: float = 50.0,
    session_health: str = "rth_open",
    primary_driver: str = "classic_logic",
) -> RegimeEvidence:
    return RegimeEvidence(
        atr_percentile_vs_30d=atr_pct,
        volume_ratio_vs_session_avg=1.0,
        range_size_vs_atr=1.0,
        is_macro_event_day=False,
        session_health=session_health,
        primary_driver=primary_driver,
    )


def make_bias(
    net_bias: int = 50,
    bias_confidence: float = 0.7,
    no_trade_reasons: Optional[List[str]] = None,
    institutional_regime: Optional[str] = None,
    daily_trend: str = "bullish",
    pd_location: str = "discount",
    london_swept_pdl: bool = False,
    london_swept_pdh: bool = False,
    or_broken: str = "none",
) -> DailyBiasState:
    """Build a synthetic DailyBiasState for router testing."""
    htf = make_htf(daily_trend=daily_trend, pd_location=pd_location)
    session = make_session(
        london_swept_pdl=london_swept_pdl,
        london_swept_pdh=london_swept_pdh,
        or_broken=or_broken,
    )
    evidence = make_evidence() if institutional_regime else None
    return DailyBiasState(
        htf_context=htf,
        session_context=session,
        htf_trend_score=net_bias,
        pd_location_score=0,
        overnight_score=0,
        liquidity_context_score=0,
        vwap_state_score=0,
        event_risk_score=0,
        session_regime_score=0,
        deepar_regime_score=0,
        net_bias=net_bias,
        bias_confidence=bias_confidence,
        playbook="NO_TRADE",  # irrelevant; router decides
        no_trade_reasons=no_trade_reasons or [],
        institutional_regime=institutional_regime,
        regime_evidence=evidence,
    )


# ---------------------------------------------------------------------------
# Tests 1-4: New institutional routing arms
# ---------------------------------------------------------------------------

class TestNewInstitutionalRoutes:
    def test_expansion_routes_to_displacement_continuation(self):
        bias = make_bias(net_bias=50, institutional_regime="EXPANSION")
        decision = route_playbook(bias)
        assert decision.playbook == "DISPLACEMENT_CONTINUATION"

    def test_compression_routes_to_breakout_prep(self):
        bias = make_bias(net_bias=10, institutional_regime="COMPRESSION")
        decision = route_playbook(bias)
        assert decision.playbook == "BREAKOUT_PREP"

    def test_high_vol_macro_routes_to_reduced_sizing(self):
        bias = make_bias(net_bias=30, institutional_regime="HIGH_VOL_MACRO")
        decision = route_playbook(bias)
        assert decision.playbook == "REDUCED_SIZING"

    def test_low_liq_chop_routes_to_no_trade(self):
        bias = make_bias(net_bias=40, institutional_regime="LOW_LIQ_CHOP")
        decision = route_playbook(bias)
        assert decision.playbook == "NO_TRADE"

    def test_low_liq_chop_no_trade_has_reason(self):
        bias = make_bias(net_bias=40, institutional_regime="LOW_LIQ_CHOP")
        decision = route_playbook(bias)
        assert len(decision.no_trade_reasons) > 0
        assert any("LOW_LIQ_CHOP" in r for r in decision.no_trade_reasons)


# ---------------------------------------------------------------------------
# Test 5: institutional_regime=None preserves existing routing
# ---------------------------------------------------------------------------

class TestNoneInstitutionalRegime:
    def test_none_regime_uses_classic_routing(self):
        """No institutional_regime — should fall through to classic arms."""
        bias = make_bias(net_bias=60, bias_confidence=0.7, institutional_regime=None)
        decision = route_playbook(bias)
        # Strong bullish bias → TREND_CONTINUATION_LONG
        assert decision.playbook == "TREND_CONTINUATION_LONG"

    def test_none_regime_no_trade_still_blocks(self):
        bias = make_bias(
            net_bias=0,
            bias_confidence=0.2,
            institutional_regime=None,
            no_trade_reasons=["No directional conviction (|bias| < 15)"],
        )
        decision = route_playbook(bias)
        assert decision.playbook == "NO_TRADE"


# ---------------------------------------------------------------------------
# Tests 6-9: Existing 3-regime → existing playbook mappings unchanged
# ---------------------------------------------------------------------------

class TestExistingRegimesUnchanged:
    def test_trending_up_no_inst_regime_returns_trend_long(self):
        bias = make_bias(
            net_bias=60,
            bias_confidence=0.7,
            institutional_regime=None,
            daily_trend="bullish",
        )
        decision = route_playbook(bias)
        assert decision.playbook == "TREND_CONTINUATION_LONG"

    def test_trending_down_no_inst_regime_returns_trend_short(self):
        bias = make_bias(
            net_bias=-60,
            bias_confidence=0.7,
            institutional_regime=None,
            daily_trend="bearish",
        )
        decision = route_playbook(bias)
        assert decision.playbook == "TREND_CONTINUATION_SHORT"

    def test_sweep_reversal_long_still_works(self):
        bias = make_bias(
            net_bias=20,
            bias_confidence=0.5,
            institutional_regime=None,
            london_swept_pdl=True,
        )
        decision = route_playbook(bias)
        assert decision.playbook == "SWEEP_REVERSAL_LONG"

    def test_sweep_reversal_short_still_works(self):
        bias = make_bias(
            net_bias=-20,
            bias_confidence=0.5,
            institutional_regime=None,
            london_swept_pdh=True,
        )
        decision = route_playbook(bias)
        assert decision.playbook == "SWEEP_REVERSAL_SHORT"


# ---------------------------------------------------------------------------
# Tests 10-14: PlaybookDecision fields for new playbooks
# ---------------------------------------------------------------------------

class TestNewPlaybookDecisionFields:
    def test_displacement_continuation_has_continuation_strats(self):
        bias = make_bias(net_bias=50, institutional_regime="EXPANSION")
        decision = route_playbook(bias)
        for strat in CONTINUATION_STRATS:
            assert strat in decision.allowed_strategies

    def test_breakout_prep_has_orb_strats(self):
        bias = make_bias(net_bias=10, institutional_regime="COMPRESSION")
        decision = route_playbook(bias)
        for strat in ORB_STRATS:
            assert strat in decision.allowed_strategies

    def test_breakout_prep_also_has_continuation_strats(self):
        bias = make_bias(net_bias=10, institutional_regime="COMPRESSION")
        decision = route_playbook(bias)
        for strat in CONTINUATION_STRATS:
            assert strat in decision.allowed_strategies

    def test_reduced_sizing_confidence_modifier_is_0_6(self):
        bias = make_bias(net_bias=30, institutional_regime="HIGH_VOL_MACRO")
        decision = route_playbook(bias)
        assert decision.confidence_modifier == pytest.approx(0.6)

    def test_displacement_continuation_confidence_modifier_is_1_0(self):
        bias = make_bias(net_bias=50, institutional_regime="EXPANSION")
        decision = route_playbook(bias)
        assert decision.confidence_modifier == pytest.approx(1.0)

    def test_breakout_prep_confidence_modifier_is_0_8(self):
        bias = make_bias(net_bias=10, institutional_regime="COMPRESSION")
        decision = route_playbook(bias)
        assert decision.confidence_modifier == pytest.approx(0.8)

    def test_low_liq_chop_has_empty_allowed_strategies(self):
        bias = make_bias(net_bias=40, institutional_regime="LOW_LIQ_CHOP")
        decision = route_playbook(bias)
        assert decision.allowed_strategies == []

    def test_displacement_continuation_allowed_setups_non_empty(self):
        bias = make_bias(net_bias=50, institutional_regime="EXPANSION")
        decision = route_playbook(bias)
        assert len(decision.allowed_setups) > 0

    def test_breakout_prep_allowed_setups_includes_orb(self):
        bias = make_bias(net_bias=10, institutional_regime="COMPRESSION")
        decision = route_playbook(bias)
        assert any("breakout" in s for s in decision.allowed_setups)

    def test_reduced_sizing_allowed_strategies_non_empty(self):
        bias = make_bias(net_bias=30, institutional_regime="HIGH_VOL_MACRO")
        decision = route_playbook(bias)
        assert len(decision.allowed_strategies) > 0


# ---------------------------------------------------------------------------
# Tests 15-18: Institutional arms bypass / respect classic blockers
# ---------------------------------------------------------------------------

class TestInstitutionalArmBypass:
    def test_low_liq_chop_does_not_require_daily_loss_cap(self):
        """LOW_LIQ_CHOP → NO_TRADE even without daily_loss_cap_near."""
        bias = make_bias(net_bias=60, bias_confidence=0.8, institutional_regime="LOW_LIQ_CHOP")
        decision = route_playbook(bias, daily_loss_cap_near=False, max_trades_hit=False)
        assert decision.playbook == "NO_TRADE"

    def test_high_vol_macro_bypasses_classic_no_trade(self):
        """HIGH_VOL_MACRO → REDUCED_SIZING even if net_bias alone would be NO_TRADE."""
        # net_bias=5 would normally be NO_TRADE; institutional arm fires first
        bias = make_bias(net_bias=5, bias_confidence=0.2, institutional_regime="HIGH_VOL_MACRO")
        decision = route_playbook(bias)
        assert decision.playbook == "REDUCED_SIZING"

    def test_expansion_bypasses_low_confidence_no_trade(self):
        """EXPANSION → DISPLACEMENT_CONTINUATION even if confidence is low."""
        bias = make_bias(net_bias=5, bias_confidence=0.1, institutional_regime="EXPANSION")
        decision = route_playbook(bias)
        assert decision.playbook == "DISPLACEMENT_CONTINUATION"

    def test_institutional_arms_run_before_classic_check(self):
        """daily_loss_cap_near alone must NOT override institutional EXPANSION."""
        # daily_loss_cap_near would push to NO_TRADE in classic routing, but
        # EXPANSION is an institutional arm checked BEFORE the classic no-trade check.
        # NOTE: per design, institutional arms currently bypass daily_loss_cap_near.
        bias = make_bias(net_bias=60, bias_confidence=0.8, institutional_regime="EXPANSION")
        decision = route_playbook(bias, daily_loss_cap_near=True)
        # EXPANSION routes to DISPLACEMENT_CONTINUATION regardless
        assert decision.playbook == "DISPLACEMENT_CONTINUATION"

    def test_low_liq_chop_ignores_strong_bullish_bias(self):
        """Even with net_bias=80, LOW_LIQ_CHOP must return NO_TRADE."""
        bias = make_bias(net_bias=80, bias_confidence=0.9, institutional_regime="LOW_LIQ_CHOP")
        decision = route_playbook(bias)
        assert decision.playbook == "NO_TRADE"
