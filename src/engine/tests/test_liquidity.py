"""Tests for time-of-day liquidity profiles (Task 3.7) and volume-based fill probability (Gap 3.9)."""

from datetime import datetime, timedelta

import numpy as np
import polars as pl
import pytest

from src.engine.liquidity import (
    classify_session,
    get_session_multipliers,
    compute_fill_probability_by_volume,
)


def _make_utc_timestamps(et_hours: list[tuple[int, int]], base_date: str = "2024-01-15") -> pl.Series:
    """Create UTC timestamps from ET (hour, minute) pairs.

    Uses a winter date (EST = UTC - 5) by default so UTC = ET + 5.
    """
    base = datetime.strptime(base_date, "%Y-%m-%d")
    timestamps = []
    for h, m in et_hours:
        et_dt = base.replace(hour=h, minute=m)
        utc_dt = et_dt + timedelta(hours=5)  # EST → UTC
        timestamps.append(utc_dt)
    return pl.Series("ts_event", timestamps)


class TestClassifySession:
    def test_overnight_2am(self):
        """2 AM ET → OVERNIGHT_3 session (midnight-6am)."""
        ts = _make_utc_timestamps([(2, 0)])
        labels = classify_session(ts)
        assert labels[0] == "OVERNIGHT_3"

    def test_rth_core_11am(self):
        """11 AM ET → RTH_CORE session."""
        ts = _make_utc_timestamps([(11, 0)])
        labels = classify_session(ts)
        assert labels[0] == "RTH_CORE"

    def test_rth_open_945am(self):
        """9:45 AM ET → RTH_OPEN session."""
        ts = _make_utc_timestamps([(9, 45)])
        labels = classify_session(ts)
        assert labels[0] == "RTH_OPEN"

    def test_rth_close_345pm(self):
        """3:45 PM ET → RTH_CLOSE session."""
        ts = _make_utc_timestamps([(15, 45)])
        labels = classify_session(ts)
        assert labels[0] == "RTH_CLOSE"

    def test_pre_market_7am(self):
        """7 AM ET → PRE_MARKET session."""
        ts = _make_utc_timestamps([(7, 0)])
        labels = classify_session(ts)
        assert labels[0] == "PRE_MARKET"

    def test_overnight_10pm(self):
        """10 PM ET → OVERNIGHT_2 session (6pm-midnight)."""
        ts = _make_utc_timestamps([(22, 0)])
        labels = classify_session(ts)
        assert labels[0] == "OVERNIGHT_2"


class TestSessionMultipliers:
    def test_overnight_3x(self):
        """2 AM ET → 3.0x multiplier (OVERNIGHT_2 = thin book)."""
        ts = _make_utc_timestamps([(2, 0)])
        mults = get_session_multipliers(ts)
        assert mults[0] == 3.0

    def test_rth_core_1x(self):
        """11 AM ET → 1.0x multiplier (best liquidity)."""
        ts = _make_utc_timestamps([(11, 0)])
        mults = get_session_multipliers(ts)
        assert mults[0] == 1.0

    def test_rth_open_08x(self):
        """9:45 AM ET → 0.8x multiplier (RTH_OPEN = highest liquidity)."""
        ts = _make_utc_timestamps([(9, 45)])
        mults = get_session_multipliers(ts)
        assert mults[0] == 0.8

    def test_rth_close_12x(self):
        """3:45 PM ET → 1.2x multiplier."""
        ts = _make_utc_timestamps([(15, 45)])
        mults = get_session_multipliers(ts)
        assert mults[0] == 1.2

    def test_pre_market_2x(self):
        """7 AM ET → 2.0x multiplier (PRE_MARKET = thin, wide spreads)."""
        ts = _make_utc_timestamps([(7, 0)])
        mults = get_session_multipliers(ts)
        assert mults[0] == 2.0

    def test_multiple_bars_vectorized(self):
        """Multiple timestamps processed correctly."""
        ts = _make_utc_timestamps([
            (2, 0),    # OVERNIGHT_3 → 3.0
            (7, 0),    # PRE_MARKET → 2.0
            (9, 45),   # RTH_OPEN → 0.8
            (11, 0),   # RTH_CORE → 1.0
            (15, 45),  # RTH_CLOSE → 1.2
        ])
        mults = get_session_multipliers(ts)
        assert len(mults) == 5
        np.testing.assert_array_equal(mults, [3.0, 2.0, 0.8, 1.0, 1.2])

    def test_midnight_crossing_overnight(self):
        """Midnight (0:00 ET) is still overnight (OVERNIGHT_3)."""
        ts = _make_utc_timestamps([(0, 0)])
        mults = get_session_multipliers(ts)
        assert mults[0] == 3.0

    def test_session_boundary_rth_open_exact(self):
        """9:30 AM ET exactly → RTH_OPEN (inclusive start)."""
        ts = _make_utc_timestamps([(9, 30)])
        labels = classify_session(ts)
        assert labels[0] == "RTH_OPEN"

    def test_session_boundary_rth_core_exact(self):
        """10:00 AM ET exactly → RTH_CORE (exclusive end of RTH_OPEN)."""
        ts = _make_utc_timestamps([(10, 0)])
        labels = classify_session(ts)
        assert labels[0] == "RTH_CORE"


class TestVolumeFillProbability:
    """Gap 3.9 — compute_fill_probability_by_volume unit tests.

    Verifies that fill probability degrades correctly as bar volume falls
    below the rolling median (proxy for the 20th-percentile threshold).
    """

    def test_full_liquidity_at_median(self):
        """Volume equal to median → full fill probability (1.0)."""
        assert compute_fill_probability_by_volume(1000.0, 1000.0) == 1.0

    def test_full_liquidity_above_median(self):
        """Volume above median → still 1.0 (no excess-volume bonus)."""
        assert compute_fill_probability_by_volume(2000.0, 1000.0) == 1.0

    def test_upper_degraded_band(self):
        """volume_ratio = 0.75 → should be in [0.85, 1.0) range."""
        prob = compute_fill_probability_by_volume(750.0, 1000.0)
        assert 0.85 <= prob < 1.0

    def test_lower_degraded_band(self):
        """volume_ratio = 0.35 → should be in [0.60, 0.85) range."""
        prob = compute_fill_probability_by_volume(350.0, 1000.0)
        assert 0.60 <= prob < 0.85

    def test_below_20th_percentile(self):
        """volume_ratio = 0.10 → severe penalty, clamped at 0.30."""
        prob = compute_fill_probability_by_volume(100.0, 1000.0)
        assert prob == pytest.approx(0.30)

    def test_zero_bar_volume_returns_default(self):
        """Bar volume = 0 → conservative default 0.5 (no data)."""
        assert compute_fill_probability_by_volume(0.0, 1000.0) == 0.5

    def test_zero_median_volume_returns_default(self):
        """Median volume = 0 → conservative default 0.5 (division guard)."""
        assert compute_fill_probability_by_volume(500.0, 0.0) == 0.5

    def test_negative_volumes_return_default(self):
        """Negative inputs → conservative default 0.5."""
        assert compute_fill_probability_by_volume(-100.0, 1000.0) == 0.5
        assert compute_fill_probability_by_volume(500.0, -100.0) == 0.5

    def test_exact_boundary_at_50pct(self):
        """volume_ratio = 0.5 exactly → lower bound of upper band = 0.85."""
        prob = compute_fill_probability_by_volume(500.0, 1000.0)
        assert prob == pytest.approx(0.85)

    def test_exact_boundary_at_20pct(self):
        """volume_ratio = 0.2 exactly → lower bound of middle band = 0.60."""
        prob = compute_fill_probability_by_volume(200.0, 1000.0)
        assert prob == pytest.approx(0.60)

    def test_output_range_monotone(self):
        """Fill probability must be non-decreasing as volume_ratio increases."""
        median = 1000.0
        ratios = [0.05, 0.10, 0.20, 0.35, 0.50, 0.75, 1.0, 1.5]
        probs = [compute_fill_probability_by_volume(r * median, median) for r in ratios]
        for i in range(len(probs) - 1):
            assert probs[i] <= probs[i + 1], (
                f"Non-monotone: ratio={ratios[i]} → {probs[i]:.4f} > "
                f"ratio={ratios[i+1]} → {probs[i+1]:.4f}"
            )

    def test_order_size_parameter_ignored_for_size_1(self):
        """order_size_contracts=1 (default) should not affect result."""
        p1 = compute_fill_probability_by_volume(500.0, 1000.0, order_size_contracts=1)
        p_default = compute_fill_probability_by_volume(500.0, 1000.0)
        assert p1 == p_default
