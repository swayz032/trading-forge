"""Tests for LATE_CYCLE_OVERHEATING regime detection (Wave 26 Pass G Pass F).

Tests: detector thresholds, playbook routing, 0.5× sizing evidence,
edge cases (DXY bull / non-overheating VIX spike).

Run:
    python -m pytest src/engine/tests/test_late_cycle_overheating.py -v
"""

from __future__ import annotations

import numpy as np
import polars as pl
import pytest

from src.engine.context.bias_engine import (
    REGIME_VALUES,
    DailyBiasState,
    detect_late_cycle_overheating,
)
from src.engine.context.htf_context import HTFContext
from src.engine.context.playbook_router import (
    PLAYBOOK_ROUTING,
    route_playbook,
)

# ─── Fixtures ─────────────────────────────────────────────────────────────────

def _make_htf(atr_percentile: float = 85.0) -> HTFContext:
    """Build HTFContext with configurable ATR percentile."""
    return HTFContext(
        daily_trend="bullish",
        weekly_trend="bullish",
        four_h_trend="bullish",
        adx=40.0,
        pd_location="premium_upper",
        prev_day_high=5100.0,
        prev_day_low=5050.0,
        prev_day_close=5090.0,
        weekly_high=5200.0,
        weekly_low=4900.0,
        adr=50.0,
        atr_percentile=atr_percentile,
    )


def _make_bars(
    n: int = 40,
    last_range_multiplier: float = 3.0,   # last bar ATR vs 30d avg
    volume_multiplier: float = 2.5,        # last bar volume vs 30d avg
    melt_up_pct: float = 0.06,            # 5-session price gain
) -> pl.DataFrame:
    """Build synthetic OHLCV bars with tunable overheating signals."""
    np.random.seed(42)
    base_close = 5000.0
    base_range = 20.0
    base_volume = 100_000.0

    closes = np.full(n, base_close)
    # Apply melt-up over last 5 bars
    for i in range(5):
        closes[n - 5 + i] = base_close * (1 + melt_up_pct * (i + 1) / 5)

    # Build OHLCV with normal ranges for all but last bar
    ranges = np.full(n, base_range)
    ranges[-1] = base_range * last_range_multiplier

    volumes = np.full(n, base_volume, dtype=float)
    volumes[-1] = base_volume * volume_multiplier

    highs = closes + ranges / 2
    lows = closes - ranges / 2
    opens = closes * 0.9995

    return pl.DataFrame({
        "open": opens,
        "high": highs,
        "low": lows,
        "close": closes,
        "volume": volumes,
    })


def _make_bias_state_with_regime(regime: str) -> DailyBiasState:
    """Build a minimal DailyBiasState with a specific institutional_regime.

    DailyBiasState requires htf_context and session_context as positional args;
    all other fields have defaults. We build minimal stub objects.
    """
    from src.engine.context.bias_engine import SessionContext
    from src.engine.context.htf_context import HTFContext

    htf = HTFContext(
        daily_trend="bullish",
        weekly_trend="bullish",
        four_h_trend="bullish",
        adx=30.0,
        pd_location="equilibrium",
        prev_day_high=5100.0,
        prev_day_low=5050.0,
        prev_day_close=5090.0,
        weekly_high=5200.0,
        weekly_low=4900.0,
        adr=50.0,
        atr_percentile=60.0,
    )
    session = SessionContext(
        overnight_range=(5060.0, 5090.0),
        overnight_bias="bullish",
        london_high=5095.0,
        london_low=5060.0,
        london_swept_pdh=False,
        london_swept_pdl=False,
        ny_killzone_active=True,
        london_killzone_active=False,
        asian_killzone_active=False,
        current_session="NY_AM",
        opening_range=(5070.0, 5080.0),
        or_broken=None,
        macro_time_active=False,
    )
    state = DailyBiasState(
        htf_context=htf,
        session_context=session,
        net_bias=50,
        bias_confidence=0.7,
        playbook="FULL_LONG",
        no_trade_reasons=[],
        institutional_regime=regime,
        regime_evidence=None,
        structure_state=None,
        htf_narrative=None,
        range_bound_eligible=False,
        vp_shape_score=0,
        vp_ib_score=0,
        vp_open_class_score=0,
    )
    return state


# ─── Tests: detect_late_cycle_overheating() ───────────────────────────────────

class TestDetectLateCycleOverheating:
    """Unit tests for the pure detector function."""

    def test_all_four_conditions_true_detects_lco(self) -> None:
        """All 4 conditions met → detected=True."""
        htf = _make_htf(atr_percentile=85.0)   # condition 3: >80th pct
        bars = _make_bars(
            last_range_multiplier=3.0,          # condition 1: >2.5×
            volume_multiplier=2.5,              # condition 2: >2×
            melt_up_pct=0.06,                   # condition 4: >5%
        )
        detected, evidence = detect_late_cycle_overheating(htf=htf, bars=bars)
        assert detected is True
        assert evidence["detected"] is True

    def test_below_atr_threshold_no_detection(self) -> None:
        """ATR ratio < 2.5 → condition 1 fails → no detection."""
        htf = _make_htf(atr_percentile=85.0)
        bars = _make_bars(
            last_range_multiplier=2.0,          # below 2.5× threshold
            volume_multiplier=2.5,
            melt_up_pct=0.06,
        )
        detected, evidence = detect_late_cycle_overheating(htf=htf, bars=bars)
        assert detected is False
        assert evidence["condition_atr_ratio"] is False

    def test_below_volume_threshold_no_detection(self) -> None:
        """Volume ratio < 2 → condition 2 fails → no detection."""
        htf = _make_htf(atr_percentile=85.0)
        bars = _make_bars(
            last_range_multiplier=3.0,
            volume_multiplier=1.5,              # below 2× threshold
            melt_up_pct=0.06,
        )
        detected, evidence = detect_late_cycle_overheating(htf=htf, bars=bars)
        assert detected is False
        assert evidence["condition_volume_surge"] is False

    def test_below_vix_proxy_threshold_no_detection(self) -> None:
        """ATR percentile < 80 (VIX proxy) → condition 3 fails → no detection."""
        htf = _make_htf(atr_percentile=70.0)   # below 80th pct
        bars = _make_bars(
            last_range_multiplier=3.0,
            volume_multiplier=2.5,
            melt_up_pct=0.06,
        )
        detected, evidence = detect_late_cycle_overheating(htf=htf, bars=bars)
        assert detected is False
        assert evidence["condition_vix_proxy"] is False

    def test_insufficient_melt_up_no_detection(self) -> None:
        """Multi-day move < 5% → condition 4 fails → no detection."""
        htf = _make_htf(atr_percentile=85.0)
        bars = _make_bars(
            last_range_multiplier=3.0,
            volume_multiplier=2.5,
            melt_up_pct=0.03,                   # below 5% threshold
        )
        detected, evidence = detect_late_cycle_overheating(htf=htf, bars=bars)
        assert detected is False
        assert evidence["condition_melt_up"] is False

    def test_override_params_take_precedence(self) -> None:
        """Pre-computed override params work correctly."""
        htf = _make_htf(atr_percentile=75.0)   # below 80pct
        detected, evidence = detect_late_cycle_overheating(
            htf=htf,
            bars=None,
            atr_ratio_override=3.0,
            volume_ratio_override=2.5,
            vix_percentile_override=85.0,       # overrides htf atr_percentile
            multi_day_melt_up_pct=0.06,
        )
        assert detected is True
        assert evidence["condition_vix_proxy"] is True

    def test_evidence_dict_is_json_serialisable(self) -> None:
        """Evidence dict must contain only JSON-serialisable types."""
        import json
        htf = _make_htf(atr_percentile=85.0)
        bars = _make_bars(last_range_multiplier=3.0, volume_multiplier=2.5, melt_up_pct=0.06)
        _, evidence = detect_late_cycle_overheating(htf=htf, bars=bars)
        try:
            json.dumps(evidence)
        except (TypeError, ValueError) as exc:
            pytest.fail(f"Evidence is not JSON-serialisable: {exc}")

    def test_none_bars_does_not_raise(self) -> None:
        """bars=None with no overrides falls back to defaults without exception."""
        htf = _make_htf(atr_percentile=85.0)
        detected, evidence = detect_late_cycle_overheating(htf=htf, bars=None)
        assert detected is False  # atr_ratio defaults to 1.0, vol_ratio to 1.0


# ─── Tests: LATE_CYCLE_OVERHEATING in REGIME_VALUES ───────────────────────────

class TestRegimeValuesExtended:
    def test_late_cycle_in_regime_values(self) -> None:
        assert "LATE_CYCLE_OVERHEATING" in REGIME_VALUES

    def test_regime_values_still_contains_original_6(self) -> None:
        for regime in ["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND",
                       "EXPANSION", "COMPRESSION", "HIGH_VOL_MACRO", "LOW_LIQ_CHOP"]:
            assert regime in REGIME_VALUES, f"Existing regime {regime} missing"


# ─── Tests: playbook routing for LATE_CYCLE_OVERHEATING ───────────────────────

class TestLateCycleMeanReversionPlaybook:
    def test_playbook_routing_entry_exists(self) -> None:
        assert "LATE_CYCLE_MEAN_REVERSION" in PLAYBOOK_ROUTING

    def test_playbook_routes_mean_reversion_only(self) -> None:
        spec = PLAYBOOK_ROUTING["LATE_CYCLE_MEAN_REVERSION"]
        assert "ny_lunch_reversal" in spec["allowed_strategies"]
        assert "midnight_open" in spec["allowed_strategies"]
        # Continuation strategies must NOT be in this playbook
        assert "ote" not in spec["allowed_strategies"]
        assert "propulsion" not in spec["allowed_strategies"]

    def test_route_playbook_returns_late_cycle_mean_reversion(self) -> None:
        bias = _make_bias_state_with_regime("LATE_CYCLE_OVERHEATING")
        decision = route_playbook(bias)
        assert decision.playbook == "LATE_CYCLE_MEAN_REVERSION"

    def test_route_playbook_confidence_modifier_is_half(self) -> None:
        """0.5× confidence modifier indicates 0.5× contract sizing."""
        bias = _make_bias_state_with_regime("LATE_CYCLE_OVERHEATING")
        decision = route_playbook(bias)
        assert decision.confidence_modifier == 0.5

    def test_continuation_strats_not_allowed_in_late_cycle(self) -> None:
        bias = _make_bias_state_with_regime("LATE_CYCLE_OVERHEATING")
        decision = route_playbook(bias)
        continuation_strats = ["ote", "ict_swing", "propulsion", "power_of_3"]
        for strat in continuation_strats:
            assert strat not in decision.allowed_strategies, (
                f"Continuation strategy {strat} should not be allowed in LATE_CYCLE_OVERHEATING"
            )

    def test_mean_reversion_strats_allowed_in_late_cycle(self) -> None:
        bias = _make_bias_state_with_regime("LATE_CYCLE_OVERHEATING")
        decision = route_playbook(bias)
        mean_rev = ["ny_lunch_reversal", "midnight_open"]
        for strat in mean_rev:
            assert strat in decision.allowed_strategies, (
                f"Mean-reversion strategy {strat} should be allowed in LATE_CYCLE_OVERHEATING"
            )


# ─── Tests: edge cases ─────────────────────────────────────────────────────────

class TestLateCycleEdgeCases:
    def test_vix_spike_without_melt_up_not_late_cycle(self) -> None:
        """VIX spike alone (no melt-up) should NOT trigger LATE_CYCLE_OVERHEATING.
        This is HIGH_VOL_MACRO territory, not LATE_CYCLE."""
        htf = _make_htf(atr_percentile=92.0)   # very high VIX proxy
        bars = _make_bars(
            last_range_multiplier=3.0,
            volume_multiplier=2.5,
            melt_up_pct=0.02,                   # only 2% melt-up — NOT late cycle
        )
        detected, evidence = detect_late_cycle_overheating(htf=htf, bars=bars)
        assert detected is False
        assert evidence["condition_melt_up"] is False

    def test_dxy_bull_scenario_not_late_cycle(self) -> None:
        """DXY bull + low melt-up: risk-off spike is not a late-cycle melt-up.
        Represented as: high ATR + high volume + low melt-up pct."""
        htf = _make_htf(atr_percentile=88.0)
        bars = _make_bars(
            last_range_multiplier=3.5,
            volume_multiplier=3.0,
            melt_up_pct=0.01,                   # only 1% price move (DXY spike, not melt-up)
        )
        detected, _ = detect_late_cycle_overheating(htf=htf, bars=bars)
        assert detected is False

    def test_existing_regimes_unaffected_by_lco_addition(self) -> None:
        """TRENDING_UP route still returns TREND_CONTINUATION_LONG, not LATE_CYCLE."""
        bias = _make_bias_state_with_regime("TRENDING_UP")
        decision = route_playbook(bias)
        assert decision.playbook == "TREND_CONTINUATION_LONG"
