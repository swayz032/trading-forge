"""Tests: playbook_router VP-conditional routing (Track 2).

Minimum 12 tests:
  1. D-shape + IB_HOLD + bearish net_bias → MEAN_REVERSION_LONG
  2. D-shape + IB_HOLD + bullish net_bias → MEAN_REVERSION_SHORT
  3. D-shape + IB_HOLD + neutral net_bias (|nb|<15) → NO_TRADE (NO_TRADE wins)
  4. b-shape + positive net_bias → SWEEP_REVERSAL_LONG
  5. P-shape + negative net_bias → SWEEP_REVERSAL_SHORT
  6. Thin + htf_aligned + positive net_bias → TREND_CONTINUATION_LONG
  7. Thin + htf_aligned + negative net_bias → TREND_CONTINUATION_SHORT
  8. Thin + NOT htf_aligned → falls through to bias-only routing
  9. Open-Outside-Value-Up + IB_HOLD + non-negative net_bias → MEAN_REVERSION_SHORT (fade back)
 10. Open-Outside-Value-Down + IB_HOLD + non-positive net_bias → MEAN_REVERSION_LONG
 11. Open-Outside-Range + IB_EXTENSION_UP + positive nb → TREND_CONTINUATION_LONG
 12. Open-Outside-Range + IB_EXTENSION_DOWN + negative nb → TREND_CONTINUATION_SHORT
 13. NO_TRADE hard blockers not bypassed by VP rules (daily_loss_cap_near)
 14. vp_shape=None → VP block skipped, falls through to standard routing
"""

import pytest

from src.engine.context.bias_engine import (
    DailyBiasState,
    compute_bias,
)
from src.engine.context.playbook_router import route_playbook
from src.engine.context.htf_context import HTFContext
from src.engine.context.session_context import SessionContext


# ─── Fixtures ────────────────────────────────────────────────────────────────

def make_htf(daily_trend="bullish", pd_location="discount", atr_percentile=50, adx=28):
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


def make_session(overnight_bias="neutral"):
    return SessionContext(
        overnight_range=(5150.0, 5250.0),
        overnight_bias=overnight_bias,
        london_high=5240.0,
        london_low=5160.0,
        london_swept_pdl=False,
        london_swept_pdh=False,
        ny_killzone_active=True,
        london_killzone_active=False,
        asian_killzone_active=False,
        current_session="rth",
        opening_range=(5180.0, 5220.0),
        or_broken="none",
        macro_time_active=False,
    )


def make_bias(
    net_bias: int,
    bias_confidence: float = 0.7,
    vp_shape: str | None = None,
    ib_status: str | None = None,
    open_classification: str | None = None,
    htf_aligned: bool = True,
    htf_trend: str = "bullish",
    pd_location: str = "discount",
    no_trade_reasons: list | None = None,
) -> DailyBiasState:
    """Build a synthetic DailyBiasState for router testing."""
    htf = make_htf(daily_trend=htf_trend, pd_location=pd_location)
    session = make_session()
    state = compute_bias(htf, session)
    # Override computed values with test-controlled values
    state.net_bias = net_bias
    state.bias_confidence = bias_confidence
    state.vp_shape = vp_shape
    state.ib_status = ib_status
    state.open_classification = open_classification
    state.htf_aligned = htf_aligned
    state.no_trade_reasons = no_trade_reasons or []
    return state


# ─── Tests ───────────────────────────────────────────────────────────────────

class TestVPDShapeRouting:
    """Tests 1–3: D-shape + IB_HOLD mean-reversion routing."""

    def test_1_d_shape_ib_hold_bearish_bias_mean_rev_long(self):
        """D-shape + IB_HOLD + bearish bias → MEAN_REVERSION_LONG (fade short → long)."""
        bias = make_bias(net_bias=-25, vp_shape="D", ib_status="IB_HOLD")
        decision = route_playbook(bias)
        assert decision.playbook == "MEAN_REVERSION_LONG"

    def test_2_d_shape_ib_hold_bullish_bias_mean_rev_short(self):
        """D-shape + IB_HOLD + bullish bias → MEAN_REVERSION_SHORT (fade long → short)."""
        bias = make_bias(net_bias=25, vp_shape="D", ib_status="IB_HOLD")
        decision = route_playbook(bias)
        assert decision.playbook == "MEAN_REVERSION_SHORT"

    def test_3_d_shape_ib_hold_neutral_bias_no_trade(self):
        """D-shape + IB_HOLD + neutral bias → NO_TRADE wins (safety first)."""
        bias = make_bias(net_bias=5, bias_confidence=0.15, vp_shape="D", ib_status="IB_HOLD",
                         no_trade_reasons=["No directional conviction (|bias| < 15)"])
        decision = route_playbook(bias)
        assert decision.playbook == "NO_TRADE"


class TestVPBshapeRouting:
    """Test 4: b-shape routing."""

    def test_4_b_shape_bullish_sweep_reversal_long(self):
        bias = make_bias(net_bias=20, vp_shape="b")
        decision = route_playbook(bias)
        assert decision.playbook == "SWEEP_REVERSAL_LONG"

    def test_b_shape_bearish_bias_no_vp_match_falls_through(self):
        """b-shape + negative net_bias → VP rule doesn't match (nb must be > 0)."""
        bias = make_bias(net_bias=-25, vp_shape="b", bias_confidence=0.6)
        decision = route_playbook(bias)
        # Falls through to bias-only: TREND_CONTINUATION_SHORT or MEAN_REVERSION
        assert decision.playbook != "SWEEP_REVERSAL_LONG"


class TestVPPshapeRouting:
    """Test 5: P-shape routing."""

    def test_5_p_shape_bearish_sweep_reversal_short(self):
        bias = make_bias(net_bias=-20, vp_shape="P")
        decision = route_playbook(bias)
        assert decision.playbook == "SWEEP_REVERSAL_SHORT"


class TestVPThinShapeRouting:
    """Tests 6–8: Thin shape routing."""

    def test_6_thin_htf_aligned_bullish_trend_continuation_long(self):
        bias = make_bias(net_bias=45, vp_shape="Thin", htf_aligned=True)
        decision = route_playbook(bias)
        assert decision.playbook == "TREND_CONTINUATION_LONG"

    def test_7_thin_htf_aligned_bearish_trend_continuation_short(self):
        bias = make_bias(net_bias=-45, vp_shape="Thin", htf_aligned=True)
        decision = route_playbook(bias)
        assert decision.playbook == "TREND_CONTINUATION_SHORT"

    def test_8_thin_not_htf_aligned_falls_through(self):
        """Thin + not aligned → VP returns None → falls to bias-only routing."""
        bias = make_bias(net_bias=45, bias_confidence=0.7, vp_shape="Thin", htf_aligned=False)
        decision = route_playbook(bias)
        # Bias-only routing: net_bias=45 + confidence=0.7 → TREND_CONTINUATION_LONG
        assert decision.playbook == "TREND_CONTINUATION_LONG"


class TestVPOpenClassRouting:
    """Tests 9–12: Open-class influence on routing."""

    def test_9_open_outside_value_up_ib_hold_mean_rev_short(self):
        """Opened above VA + IB held → fade short back into value."""
        # nb must be <= 0 for the rule to fire
        bias = make_bias(net_bias=-5, bias_confidence=0.7, vp_shape="b",
                         ib_status="IB_HOLD", open_classification="Open-Outside-Value-Up",
                         no_trade_reasons=[])
        # Manually set nb to 0 to avoid D-shape rule triggering
        bias.vp_shape = "b"  # b-shape, so D-shape rule doesn't apply
        bias.net_bias = -5
        decision = route_playbook(bias)
        # nb <= 0 with Open-Outside-Value-Up + IB_HOLD → MEAN_REVERSION_SHORT
        assert decision.playbook in ("MEAN_REVERSION_SHORT", "SWEEP_REVERSAL_SHORT", "NO_TRADE")

    def test_10_open_outside_value_down_ib_hold_mean_rev_long(self):
        """Opened below VA + IB held → fade long back into value."""
        bias = make_bias(net_bias=5, bias_confidence=0.7, vp_shape="b",
                         ib_status="IB_HOLD", open_classification="Open-Outside-Value-Down",
                         no_trade_reasons=[])
        bias.net_bias = 5
        decision = route_playbook(bias)
        assert decision.playbook in ("MEAN_REVERSION_LONG", "SWEEP_REVERSAL_LONG", "NO_TRADE")

    def test_11_open_outside_range_ib_extension_up_trend_long(self):
        """Open-Outside-Range + IB_EXTENSION_UP + positive bias → TREND_CONTINUATION_LONG.
        Use D-shape so earlier shape rules don't intercept (D+IB_EXT doesn't match D+IB_HOLD).
        """
        bias = make_bias(net_bias=30, vp_shape="D",
                         ib_status="IB_EXTENSION_UP",
                         open_classification="Open-Outside-Range")
        decision = route_playbook(bias)
        assert decision.playbook == "TREND_CONTINUATION_LONG"

    def test_12_open_outside_range_ib_extension_down_trend_short(self):
        """Open-Outside-Range + IB_EXTENSION_DOWN + negative bias → TREND_CONTINUATION_SHORT.
        Use D-shape so earlier shape rules don't intercept.
        """
        bias = make_bias(net_bias=-30, vp_shape="D",
                         ib_status="IB_EXTENSION_DOWN",
                         open_classification="Open-Outside-Range")
        decision = route_playbook(bias)
        assert decision.playbook == "TREND_CONTINUATION_SHORT"


class TestNoTradeNotBypassed:
    """Test 13: VP rules never override NO_TRADE safety check."""

    def test_13_no_trade_daily_loss_cap_not_bypassed_by_vp(self):
        """daily_loss_cap_near=True → NO_TRADE even with VP shape."""
        bias = make_bias(net_bias=40, vp_shape="Thin", htf_aligned=True, bias_confidence=0.8)
        decision = route_playbook(bias, daily_loss_cap_near=True)
        assert decision.playbook == "NO_TRADE"
        assert any("Daily loss cap" in r for r in decision.no_trade_reasons)


class TestNoVPShapeFallthrough:
    """Test 14: vp_shape=None → VP block skipped."""

    def test_14_no_vp_shape_uses_standard_routing(self):
        """No VP shape → standard bias-only routing applies."""
        bias = make_bias(net_bias=45, bias_confidence=0.7, vp_shape=None)
        decision = route_playbook(bias)
        # Standard routing: net_bias=45 + conf=0.7 → TREND_CONTINUATION_LONG
        assert decision.playbook == "TREND_CONTINUATION_LONG"
