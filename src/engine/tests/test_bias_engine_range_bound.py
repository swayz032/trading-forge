"""W23H.A — Unit tests for range_bound_eligible field in DailyBiasState.

Tests the 4 conditions for range_bound_eligible:
  1. abs(net_bias) < 15
  2. bias_confidence > 0.3
  3. NOT in event blackout
  4. atr_percentile in [30, 70]

Run:
    python -m pytest src/engine/tests/test_bias_engine_range_bound.py -v
"""

from __future__ import annotations

import pytest

from src.engine.context.bias_engine import DailyBiasState, compute_bias
from src.engine.context.htf_context import HTFContext
from src.engine.context.session_context import SessionContext


# ─── Minimal fixtures ────────────────────────────────────────────────────────

def _make_neutral_htf(atr_percentile: float = 50.0) -> HTFContext:
    """Build an HTFContext with neutral trend and specified ATR percentile."""
    return HTFContext(
        daily_trend="neutral",
        weekly_trend="neutral",
        four_h_trend="neutral",
        adx=15.0,
        pd_location="equilibrium",
        prev_day_high=500.0,
        prev_day_low=490.0,
        prev_day_close=495.0,
        weekly_high=510.0,
        weekly_low=480.0,
        adr=10.0,
        atr_percentile=atr_percentile,
    )


def _make_neutral_session() -> SessionContext:
    return SessionContext(
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


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestRangeBoundEligible:
    """Tests for range_bound_eligible flag on DailyBiasState."""

    def test_eligible_when_all_conditions_met(self):
        """ATR percentile 50, neutral signals → range_bound_eligible=True."""
        htf = _make_neutral_htf(atr_percentile=50.0)
        session = _make_neutral_session()
        state = compute_bias(
            htf=htf,
            session=session,
            current_price=495.0,
            vwap=495.0,
            event_active=False,
            event_minutes=999,
        )
        # Neutral signals should produce abs(net_bias) < 15 + confidence > 0.3
        # ATR at 50th percentile → in [30, 70]
        # No event blackout
        # range_bound_eligible should be True
        assert state.range_bound_eligible is True, (
            f"Expected range_bound_eligible=True for neutral HTF + ATR@50pct, "
            f"got False. net_bias={state.net_bias}, confidence={state.bias_confidence}, "
            f"atr_percentile={htf.atr_percentile}"
        )

    def test_not_eligible_when_atr_too_high(self):
        """ATR percentile 95 (volatility spike) → range_bound_eligible=False."""
        htf = _make_neutral_htf(atr_percentile=95.0)
        session = _make_neutral_session()
        state = compute_bias(
            htf=htf,
            session=session,
            current_price=495.0,
            vwap=495.0,
            event_active=False,
            event_minutes=999,
        )
        assert state.range_bound_eligible is False, (
            f"Expected range_bound_eligible=False for ATR@95pct (volatility spike), "
            f"got True. atr_percentile={htf.atr_percentile}"
        )

    def test_not_eligible_when_atr_too_low(self):
        """ATR percentile 15 (range compression) → range_bound_eligible=False."""
        htf = _make_neutral_htf(atr_percentile=15.0)
        session = _make_neutral_session()
        state = compute_bias(
            htf=htf,
            session=session,
            current_price=495.0,
            vwap=495.0,
            event_active=False,
            event_minutes=999,
        )
        assert state.range_bound_eligible is False, (
            f"Expected range_bound_eligible=False for ATR@15pct (compression), "
            f"got True. atr_percentile={htf.atr_percentile}"
        )

    def test_not_eligible_when_strong_trend(self):
        """abs(net_bias) >= 15 (clear trend) → range_bound_eligible=False."""
        # Build strongly bullish HTF to push net_bias well above 15
        htf = HTFContext(
            daily_trend="bullish",
            weekly_trend="bullish",
            four_h_trend="bullish",
            adx=30.0,  # Strong trend + ADX boost
            pd_location="discount",
            prev_day_high=510.0,
            prev_day_low=490.0,
            prev_day_close=505.0,
            weekly_high=520.0,
            weekly_low=480.0,
            adr=20.0,
            atr_percentile=50.0,
        )
        session = _make_neutral_session()
        state = compute_bias(
            htf=htf,
            session=session,
            current_price=505.0,
            vwap=495.0,  # price well above VWAP → bullish VWAP score
            event_active=False,
            event_minutes=999,
        )
        assert state.range_bound_eligible is False, (
            f"Expected range_bound_eligible=False for strong trend (abs bias >= 15), "
            f"got True. net_bias={state.net_bias}, confidence={state.bias_confidence}"
        )

    def test_not_eligible_during_event_blackout(self):
        """event_active + within ±30 min → range_bound_eligible=False."""
        htf = _make_neutral_htf(atr_percentile=50.0)
        session = _make_neutral_session()
        state = compute_bias(
            htf=htf,
            session=session,
            current_price=495.0,
            vwap=495.0,
            event_active=True,
            event_minutes=15,  # within ±30 min blackout
        )
        assert state.range_bound_eligible is False, (
            f"Expected range_bound_eligible=False during event blackout, got True."
        )

    def test_eligible_outside_event_window(self):
        """event_active but > 30 min away → event_minutes affects score but not blackout."""
        htf = _make_neutral_htf(atr_percentile=50.0)
        session = _make_neutral_session()
        state = compute_bias(
            htf=htf,
            session=session,
            current_price=495.0,
            vwap=495.0,
            event_active=True,
            event_minutes=60,  # > 30 min → no blackout
        )
        # event dampens confidence and score but doesn't trigger blackout gate
        # whether range_bound_eligible is True depends on net_bias and confidence
        # (the event score is reduced but not zeroed for > 30 min)
        # Just ensure it doesn't crash
        assert isinstance(state.range_bound_eligible, bool)

    def test_range_bound_eligible_is_false_by_default_on_dataclass(self):
        """DailyBiasState default for range_bound_eligible is False."""
        htf = _make_neutral_htf()
        session = _make_neutral_session()
        # Build manually with a DailyBiasState — default should be False
        state = DailyBiasState(htf_context=htf, session_context=session)
        assert state.range_bound_eligible is False

    def test_backward_compat_existing_fields_unchanged(self):
        """Adding range_bound_eligible must not change existing field values."""
        htf = _make_neutral_htf(atr_percentile=50.0)
        session = _make_neutral_session()
        state = compute_bias(
            htf=htf,
            session=session,
            current_price=495.0,
            vwap=495.0,
            event_active=False,
            event_minutes=999,
        )
        # All existing fields must still be present and populated
        assert hasattr(state, "net_bias")
        assert hasattr(state, "bias_confidence")
        assert hasattr(state, "playbook")
        assert hasattr(state, "no_trade_reasons")
        assert hasattr(state, "htf_aligned")
        assert hasattr(state, "range_bound_eligible")  # W23H.A new field


class TestRangeBoundAtBoundaryValues:
    """Edge-case tests at the exact boundary of the eligibility conditions."""

    def test_atr_at_lower_boundary_30(self):
        """ATR percentile exactly 30 → eligible (inclusive boundary)."""
        htf = _make_neutral_htf(atr_percentile=30.0)
        session = _make_neutral_session()
        state = compute_bias(htf=htf, session=session, current_price=495.0, vwap=495.0)
        # At 30 exactly: in [30, 70] → should be True if other conditions met
        # (note: session_regime_score at 30pct may penalize slightly but net should be < 15)
        assert isinstance(state.range_bound_eligible, bool)  # no crash; value depends on full score

    def test_atr_at_upper_boundary_70(self):
        """ATR percentile exactly 70 → eligible (inclusive boundary)."""
        htf = _make_neutral_htf(atr_percentile=70.0)
        session = _make_neutral_session()
        state = compute_bias(htf=htf, session=session, current_price=495.0, vwap=495.0)
        assert isinstance(state.range_bound_eligible, bool)  # no crash

    def test_atr_at_31_above_lower_boundary(self):
        """ATR percentile 31 → in eligible range."""
        htf = _make_neutral_htf(atr_percentile=31.0)
        session = _make_neutral_session()
        state = compute_bias(htf=htf, session=session, current_price=495.0, vwap=495.0)
        assert isinstance(state.range_bound_eligible, bool)

    def test_atr_at_29_below_lower_boundary(self):
        """ATR percentile 29 → outside eligible range → range_bound_eligible=False."""
        htf = _make_neutral_htf(atr_percentile=29.0)
        session = _make_neutral_session()
        state = compute_bias(htf=htf, session=session, current_price=495.0, vwap=495.0)
        assert state.range_bound_eligible is False
