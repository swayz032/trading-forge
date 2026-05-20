"""W23H.A — Tests for range-bound path in playbook_router.

Verifies that when range_bound_eligible=True and pd_location is discount/premium,
route_playbook() returns MEAN_REVERSION_LONG or MEAN_REVERSION_SHORT (RANGE_BOUND regime).

Run:
    python -m pytest src/engine/tests/test_playbook_router_range_path.py -v
"""

from __future__ import annotations

import pytest

from src.engine.context.bias_engine import DailyBiasState
from src.engine.context.htf_context import HTFContext
from src.engine.context.playbook_router import route_playbook
from src.engine.context.session_context import SessionContext


# ─── Fixtures ─────────────────────────────────────────────────────────────────

def _make_range_bias_state(
    net_bias: int = -5,
    pd_location: str = "discount",
    atr_percentile: float = 50.0,
) -> DailyBiasState:
    """Build a DailyBiasState that represents a range day.

    net_bias near zero + confidence sufficient + no strong trend.
    For MEAN_REVERSION_LONG: pd_location='discount' with weak bearish net_bias.
    For MEAN_REVERSION_SHORT: pd_location='premium' with weak bullish net_bias.
    """
    htf = HTFContext(
        daily_trend="neutral",
        weekly_trend="neutral",
        four_h_trend="neutral",
        adx=15.0,
        pd_location=pd_location,
        prev_day_high=500.0,
        prev_day_low=490.0,
        prev_day_close=495.0,
        weekly_high=510.0,
        weekly_low=480.0,
        adr=10.0,
        atr_percentile=atr_percentile,
    )
    session = SessionContext(
        overnight_range=(500.0, 490.0),
        overnight_bias="neutral",
        london_high=502.0,
        london_low=488.0,
        london_swept_pdh=False,
        london_swept_pdl=False,
        ny_killzone_active=True,
        london_killzone_active=False,
        asian_killzone_active=False,
        current_session="ny_open",
        opening_range=(500.0, 490.0),
        or_broken="none",
        macro_time_active=False,
    )

    # IMPORTANT: no_trade_reasons must be empty for strong bias (abs >= 15) so
    # that route_playbook doesn't short-circuit to NO_TRADE.
    # For weak bias (abs < 15), no_trade_reasons would be populated by compute_bias.
    # Our test cases use net_bias=±25 which is clear enough to NOT trigger no_trade_reasons.
    state = DailyBiasState(
        htf_context=htf,
        session_context=session,
        net_bias=net_bias,
        bias_confidence=0.4,  # > 0.3 but not high conviction (won't hit TREND_CONTINUATION)
        playbook="NO_TRADE",  # old playbook before routing
        no_trade_reasons=[],  # Empty: abs(25) >= 15 so no "no conviction" reason
        range_bound_eligible=True,
    )
    return state


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestPlaybookRouterRangePath:
    """Tests for MEAN_REVERSION routing in route_playbook()."""

    def test_range_discount_routes_mean_reversion_long(self):
        """pd_location=discount + weak net_bias <= -20 → MEAN_REVERSION_LONG."""
        # MEAN_REVERSION_LONG requires: nb <= -20 AND pd_location == 'discount'
        state = _make_range_bias_state(net_bias=-25, pd_location="discount")
        decision = route_playbook(state, daily_loss_cap_near=False, max_trades_hit=False)
        assert decision.playbook == "MEAN_REVERSION_LONG", (
            f"Expected MEAN_REVERSION_LONG for discount location + net_bias=-25, "
            f"got {decision.playbook}"
        )
        assert decision.allowed_strategies, "MEAN_REVERSION_LONG must have allowed_strategies"

    def test_range_premium_routes_mean_reversion_short(self):
        """pd_location=premium + weak net_bias >= 20 → MEAN_REVERSION_SHORT."""
        # MEAN_REVERSION_SHORT requires: nb >= 20 AND pd_location == 'premium'
        state = _make_range_bias_state(net_bias=25, pd_location="premium")
        decision = route_playbook(state, daily_loss_cap_near=False, max_trades_hit=False)
        assert decision.playbook == "MEAN_REVERSION_SHORT", (
            f"Expected MEAN_REVERSION_SHORT for premium location + net_bias=25, "
            f"got {decision.playbook}"
        )
        assert decision.allowed_strategies

    def test_no_trade_overrides_range_when_dll_near(self):
        """daily_loss_cap_near=True → NO_TRADE even if range-bound eligible."""
        state = _make_range_bias_state(net_bias=-25, pd_location="discount")
        decision = route_playbook(state, daily_loss_cap_near=True, max_trades_hit=False)
        assert decision.playbook == "NO_TRADE", (
            f"DLL near should force NO_TRADE regardless of range eligibility, "
            f"got {decision.playbook}"
        )

    def test_no_trade_overrides_range_when_max_trades_hit(self):
        """max_trades_hit=True → NO_TRADE."""
        state = _make_range_bias_state(net_bias=-25, pd_location="discount")
        decision = route_playbook(state, daily_loss_cap_near=False, max_trades_hit=True)
        assert decision.playbook == "NO_TRADE"

    def test_mean_reversion_allowed_strategies_non_empty(self):
        """MEAN_REVERSION paths must return allowed_strategies from MEAN_REV_STRATS."""
        from src.engine.context.playbook_router import MEAN_REV_STRATS
        state = _make_range_bias_state(net_bias=-25, pd_location="discount")
        decision = route_playbook(state, daily_loss_cap_near=False, max_trades_hit=False)
        assert decision.playbook in ("MEAN_REVERSION_LONG", "MEAN_REVERSION_SHORT")
        for strat in decision.allowed_strategies:
            assert strat in MEAN_REV_STRATS, (
                f"Unexpected strategy '{strat}' in MEAN_REVERSION allowed_strategies. "
                f"Expected only {MEAN_REV_STRATS}."
            )

    def test_trend_continuation_not_routed_for_range(self):
        """Weak bias should NOT route to TREND_CONTINUATION (requires conf >= 0.6)."""
        state = _make_range_bias_state(net_bias=-5, pd_location="discount")
        # Weak bias + confidence = 0.4 → not enough for TREND_CONTINUATION (needs >= 0.6)
        decision = route_playbook(state, daily_loss_cap_near=False, max_trades_hit=False)
        assert decision.playbook not in ("TREND_CONTINUATION_LONG", "TREND_CONTINUATION_SHORT"), (
            f"Weak bias ({state.net_bias}) + confidence=0.4 must NOT route to TREND_CONTINUATION "
            f"(requires conf >= 0.6), got {decision.playbook}"
        )

    def test_playbook_decision_has_confidence_modifier(self):
        """MEAN_REVERSION decision must have confidence_modifier (not None)."""
        state = _make_range_bias_state(net_bias=-25, pd_location="discount")
        decision = route_playbook(state, daily_loss_cap_near=False, max_trades_hit=False)
        if decision.playbook in ("MEAN_REVERSION_LONG", "MEAN_REVERSION_SHORT"):
            assert isinstance(decision.confidence_modifier, float)
            assert 0 < decision.confidence_modifier <= 1.0
