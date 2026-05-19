"""Tests for synthetic order flow signals (Wave F2).

Covers the four functions that approximate footprint signals from OHLCV bars:
- compute_synthetic_cvd
- detect_absorption
- detect_exhaustion
- confirm_sweep_with_delta

Plus integration into compute_bias() — verifies the 5 new DailyBiasState fields
are populated when bars are passed and remain neutral defaults when bars=None
(backward compatibility for callers that haven't been updated).
"""
from __future__ import annotations

import numpy as np
import polars as pl
import pytest

from src.engine.context.bias_engine import (
    DailyBiasState,
    compute_bias,
    compute_synthetic_cvd,
    confirm_sweep_with_delta,
    detect_absorption,
    detect_exhaustion,
)
from src.engine.context.htf_context import HTFContext
from src.engine.context.session_context import SessionContext


# ─── Fixtures ────────────────────────────────────────────────────


def _make_ohlcv(n: int, seed: int = 42) -> pl.DataFrame:
    """Synthetic OHLCV with mild bullish drift, no special features."""
    rng = np.random.default_rng(seed)
    closes = np.cumsum(rng.standard_normal(n)) + 100.0
    opens = closes - rng.standard_normal(n) * 0.5
    highs = np.maximum(opens, closes) + np.abs(rng.standard_normal(n)) * 0.3
    lows = np.minimum(opens, closes) - np.abs(rng.standard_normal(n)) * 0.3
    volumes = rng.integers(1000, 10000, size=n).astype(float)
    return pl.DataFrame({
        "open": opens.astype(float),
        "high": highs.astype(float),
        "low": lows.astype(float),
        "close": closes.astype(float),
        "volume": volumes,
    })


def _bullish_htf() -> HTFContext:
    return HTFContext(
        daily_trend="bullish",
        weekly_trend="bullish",
        four_h_trend="bullish",
        pd_location="discount",
        prev_day_high=105.0,
        prev_day_low=95.0,
        prev_day_close=100.0,
        weekly_high=110.0,
        weekly_low=90.0,
        adr=5.0,
        atr_percentile=50.0,
        adx=30.0,
    )


def _ny_session(swept_pdl: bool = False, swept_pdh: bool = False) -> SessionContext:
    return SessionContext(
        overnight_range=(102.0, 98.0),
        overnight_bias="bullish",
        london_high=104.0,
        london_low=99.0,
        london_swept_pdh=swept_pdh,
        london_swept_pdl=swept_pdl,
        ny_killzone_active=True,
        london_killzone_active=False,
        asian_killzone_active=False,
        current_session="ny_am",
        opening_range=(101.0, 99.5),
        or_broken="above",
        macro_time_active=False,
    )


# ─── compute_synthetic_cvd ───────────────────────────────────────


class TestSyntheticCVD:
    def test_returns_polars_series(self):
        bars = _make_ohlcv(40)
        cvd = compute_synthetic_cvd(bars)
        assert isinstance(cvd, pl.Series)
        assert len(cvd) == 40

    def test_doji_bar_yields_zero_delta(self):
        # Single doji bar (high == low) should produce a zero CVD step
        bars = pl.DataFrame({
            "open": [100.0],
            "high": [100.0],
            "low": [100.0],
            "close": [100.0],
            "volume": [10000.0],
        })
        cvd = compute_synthetic_cvd(bars)
        assert float(cvd[0]) == 0.0

    def test_pure_bull_bar_positive_delta(self):
        # Close at high, low far below → fully bullish bar
        bars = pl.DataFrame({
            "open": [100.0],
            "high": [102.0],
            "low": [99.0],
            "close": [102.0],
            "volume": [10000.0],
        })
        cvd = compute_synthetic_cvd(bars)
        # bull% = (102-99)/3 = 1, bear% = 0, delta = 10000 * 1 = 10000
        assert float(cvd[0]) == pytest.approx(10000.0)

    def test_pure_bear_bar_negative_delta(self):
        # Close at low → fully bearish bar
        bars = pl.DataFrame({
            "open": [102.0],
            "high": [102.0],
            "low": [99.0],
            "close": [99.0],
            "volume": [10000.0],
        })
        cvd = compute_synthetic_cvd(bars)
        assert float(cvd[0]) == pytest.approx(-10000.0)

    def test_cumulative_property(self):
        # Two bull bars in a row → cvd[1] > cvd[0]
        bars = pl.DataFrame({
            "open": [100.0, 100.5],
            "high": [101.0, 101.5],
            "low": [99.0, 100.0],
            "close": [100.8, 101.4],
            "volume": [5000.0, 5000.0],
        })
        cvd = compute_synthetic_cvd(bars)
        assert float(cvd[1]) > float(cvd[0])
        assert float(cvd[0]) > 0


# ─── detect_absorption ───────────────────────────────────────────


class TestAbsorption:
    def test_returns_boolean_series(self):
        bars = _make_ohlcv(40)
        flag = detect_absorption(bars, window=10)
        assert isinstance(flag, pl.Series)
        assert flag.dtype == pl.Boolean
        assert len(flag) == 40

    def test_normal_bars_no_absorption(self):
        # Boring uniform bars — none should fire
        bars = _make_ohlcv(40)
        flag = detect_absorption(bars, window=20)
        # With pure noise, occasional false hit is possible but rare
        assert int(flag.sum()) <= 2

    def test_high_vol_small_range_fires(self):
        # 30 normal bars + one giant-volume tiny-range bar at the end
        bars = _make_ohlcv(30)
        absorption_bar = pl.DataFrame({
            "open": [100.0],
            "high": [100.05],
            "low": [99.95],
            "close": [100.0],
            "volume": [200000.0],  # ~50× the typical 1k–10k volume
        })
        bars_full = pl.concat([bars, absorption_bar], how="vertical")
        flag = detect_absorption(bars_full, window=20)
        assert bool(flag[-1]) is True

    def test_early_bars_within_window_dont_fire(self):
        # First `window` bars cannot have rolling baseline → must be False
        bars = _make_ohlcv(40)
        flag = detect_absorption(bars, window=20)
        for i in range(19):
            assert bool(flag[i]) is False, f"bar {i} fired before window filled"


# ─── detect_exhaustion ───────────────────────────────────────────


class TestExhaustion:
    def test_returns_boolean_series(self):
        bars = _make_ohlcv(40)
        flag = detect_exhaustion(bars, window=10)
        assert isinstance(flag, pl.Series)
        assert flag.dtype == pl.Boolean
        assert len(flag) == 40

    def test_bull_exhaustion_fires(self):
        # 30 normal bars + one big-range bar that closes near low (bull exhaustion)
        bars = _make_ohlcv(30)
        exhaust_bar = pl.DataFrame({
            "open": [100.0],
            "high": [105.0],   # 5-point range = ~10× typical
            "low": [99.0],
            "close": [99.5],   # closed in lower 30% of range
            "volume": [5000.0],
        })
        bars_full = pl.concat([bars, exhaust_bar], how="vertical")
        flag = detect_exhaustion(bars_full, window=20)
        assert bool(flag[-1]) is True

    def test_bear_exhaustion_fires(self):
        # Big-range bar closing near high (bear exhaustion — sellers ran low, buyers reclaimed)
        bars = _make_ohlcv(30)
        exhaust_bar = pl.DataFrame({
            "open": [100.0],
            "high": [101.0],
            "low": [95.0],     # large range to the downside
            "close": [100.7],  # closed in upper 30% (above 95 + 0.7*6 = 99.2)
            "volume": [5000.0],
        })
        bars_full = pl.concat([bars, exhaust_bar], how="vertical")
        flag = detect_exhaustion(bars_full, window=20)
        assert bool(flag[-1]) is True

    def test_normal_bar_does_not_fire(self):
        # Bar with mid-range close — neither exhaustion direction
        bars = _make_ohlcv(30)
        normal_bar = pl.DataFrame({
            "open": [100.0],
            "high": [100.5],
            "low": [99.5],
            "close": [100.0],  # exactly mid-range
            "volume": [5000.0],
        })
        bars_full = pl.concat([bars, normal_bar], how="vertical")
        flag = detect_exhaustion(bars_full, window=20)
        assert bool(flag[-1]) is False


# ─── confirm_sweep_with_delta ────────────────────────────────────


class TestSweepWithDelta:
    def test_no_sweep_returns_false(self):
        cvd = pl.Series("cvd", [float(i) for i in range(50)])
        assert confirm_sweep_with_delta(False, cvd) is False

    def test_insufficient_history_returns_false(self):
        cvd = pl.Series("cvd", [1.0, 2.0, 3.0])
        assert confirm_sweep_with_delta(True, cvd) is False

    def test_sweep_with_one_sigma_shift_confirms(self):
        # 30 small steady deltas + one big spike at the end
        rng = np.random.default_rng(7)
        baseline = np.cumsum(rng.standard_normal(50) * 1.0)
        # Append a final point that is far from baseline trajectory
        spike = baseline[-1] + 50.0  # huge jump
        cvd_arr = np.concatenate([baseline, [spike]])
        cvd = pl.Series("cvd", cvd_arr)
        assert confirm_sweep_with_delta(True, cvd, window=20) is True

    def test_sweep_with_zero_volatility_returns_false(self):
        # Flat CVD (no variance) → can't compute sigma → return False
        cvd = pl.Series("cvd", [100.0] * 50)
        assert confirm_sweep_with_delta(True, cvd) is False


# ─── compute_bias integration ────────────────────────────────────


class TestComputeBiasIntegration:
    def test_no_bars_yields_neutral_order_flow_fields(self):
        """Backward compat: compute_bias() with bars=None → all OF fields neutral."""
        state = compute_bias(_bullish_htf(), _ny_session(), current_price=102.0)
        assert isinstance(state, DailyBiasState)
        assert state.cvd_zscore == 0.0
        assert state.absorption_active is False
        assert state.exhaustion_active is False
        assert state.sweep_delta_confirmed is False
        assert state.order_flow_score == 0

    def test_bars_with_insufficient_history_yields_neutral(self):
        """5-bar dataframe — too short for window=20 features → all neutral."""
        bars = _make_ohlcv(5)
        state = compute_bias(_bullish_htf(), _ny_session(), current_price=102.0, bars=bars)
        assert state.absorption_active is False
        assert state.exhaustion_active is False
        assert state.order_flow_score == 0

    def test_bars_populate_all_five_new_fields(self):
        """All 5 new fields exist on the returned DailyBiasState."""
        bars = _make_ohlcv(40)
        state = compute_bias(_bullish_htf(), _ny_session(), current_price=102.0, bars=bars)
        # Existence checks (regardless of values)
        assert hasattr(state, "cvd_zscore")
        assert hasattr(state, "absorption_active")
        assert hasattr(state, "exhaustion_active")
        assert hasattr(state, "sweep_delta_confirmed")
        assert hasattr(state, "order_flow_score")
        # Type checks
        assert isinstance(state.cvd_zscore, float)
        assert isinstance(state.absorption_active, bool)
        assert isinstance(state.exhaustion_active, bool)
        assert isinstance(state.sweep_delta_confirmed, bool)
        assert isinstance(state.order_flow_score, int)
        # Range checks
        assert 0 <= state.order_flow_score <= 100

    def test_existing_bias_fields_unchanged_when_bars_added(self):
        """Adding bars must not alter the seven existing bias scores or net_bias."""
        htf = _bullish_htf()
        session = _ny_session()
        without_bars = compute_bias(htf, session, current_price=102.0, vwap=101.0)
        with_bars = compute_bias(
            htf, session, current_price=102.0, vwap=101.0, bars=_make_ohlcv(40)
        )
        # Core seven scores must match exactly
        assert without_bars.htf_trend_score == with_bars.htf_trend_score
        assert without_bars.pd_location_score == with_bars.pd_location_score
        assert without_bars.overnight_score == with_bars.overnight_score
        assert without_bars.liquidity_context_score == with_bars.liquidity_context_score
        assert without_bars.vwap_state_score == with_bars.vwap_state_score
        assert without_bars.event_risk_score == with_bars.event_risk_score
        assert without_bars.session_regime_score == with_bars.session_regime_score
        # net_bias is computed from the seven scores → must match
        assert without_bars.net_bias == with_bars.net_bias
        assert without_bars.bias_confidence == with_bars.bias_confidence
        assert without_bars.playbook == with_bars.playbook

    def test_absorption_on_last_bar_is_reported(self):
        """If the last bar is an absorption bar, state.absorption_active = True."""
        bars = _make_ohlcv(30)
        absorption_bar = pl.DataFrame({
            "open": [100.0],
            "high": [100.05],
            "low": [99.95],
            "close": [100.0],
            "volume": [200000.0],
        })
        bars_full = pl.concat([bars, absorption_bar], how="vertical")
        state = compute_bias(_bullish_htf(), _ny_session(), current_price=100.0, bars=bars_full)
        assert state.absorption_active is True
        # Score should include the absorption contribution (25 pts)
        assert state.order_flow_score >= 25
