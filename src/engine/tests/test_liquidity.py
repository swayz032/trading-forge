"""Tests for time-of-day liquidity profiles (Task 3.7)."""

from datetime import datetime, timedelta

import numpy as np
import polars as pl
import pytest

from src.engine.liquidity import classify_session, get_session_multipliers


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
        """2 AM ET → OVERNIGHT_2 session."""
        ts = _make_utc_timestamps([(2, 0)])
        labels = classify_session(ts)
        assert labels[0] == "OVERNIGHT_2"

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
        """10 PM ET → OVERNIGHT session."""
        ts = _make_utc_timestamps([(22, 0)])
        labels = classify_session(ts)
        assert labels[0] == "OVERNIGHT"


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
            (2, 0),    # OVERNIGHT_2 → 3.0
            (7, 0),    # PRE_MARKET → 2.0
            (9, 45),   # RTH_OPEN → 0.8
            (11, 0),   # RTH_CORE → 1.0
            (15, 45),  # RTH_CLOSE → 1.2
        ])
        mults = get_session_multipliers(ts)
        assert len(mults) == 5
        np.testing.assert_array_equal(mults, [3.0, 2.0, 0.8, 1.0, 1.2])

    def test_midnight_crossing_overnight(self):
        """Midnight (0:00 ET) is still overnight (OVERNIGHT_2)."""
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
