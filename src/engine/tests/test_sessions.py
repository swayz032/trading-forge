"""Tests for ICT Session and Time indicators."""

from datetime import datetime, timedelta

import polars as pl
import pytest

from src.engine.indicators.sessions import (
    is_asia_killzone,
    is_london_killzone,
    is_nyam_killzone,
    is_ny_lunch,
    is_nypm_killzone,
    is_macro_time,
    day_of_week_profile,
    quarterly_theory,
    true_day_open,
    midnight_open,
)


def _make_timestamps(start_hour, count, interval_minutes=60):
    """Generate timestamps starting at a specific hour."""
    base = datetime(2023, 6, 15, start_hour, 0)  # A Thursday
    return pl.Series("ts_event", [base + timedelta(minutes=i * interval_minutes) for i in range(count)])


def _make_df_with_times(start_hour, count, interval_minutes=60):
    """Generate OHLCV DataFrame with specific timestamps."""
    ts = _make_timestamps(start_hour, count, interval_minutes)
    return pl.DataFrame({
        "ts_event": ts,
        "open": [100.0 + i for i in range(count)],
        "high": [101.0 + i for i in range(count)],
        "low": [99.0 + i for i in range(count)],
        "close": [100.5 + i for i in range(count)],
        "volume": [10000] * count,
    })


class TestAsiaKillzone:
    def test_true_during_asia(self):
        ts = _make_timestamps(20, 4)  # 8 PM, 9 PM, 10 PM, 11 PM
        result = is_asia_killzone(ts)
        assert all(result.to_list()), "All bars at 8-11 PM should be in Asia killzone"

    def test_false_during_ny(self):
        ts = _make_timestamps(9, 3)  # 9 AM, 10 AM, 11 AM
        result = is_asia_killzone(ts)
        assert not any(result.to_list()), "NY AM bars should NOT be in Asia killzone"


class TestLondonKillzone:
    def test_true_during_london(self):
        ts = _make_timestamps(2, 3)  # 2 AM, 3 AM, 4 AM
        result = is_london_killzone(ts)
        assert all(result.to_list()), "2-4 AM should be in London killzone"

    def test_false_outside(self):
        ts = _make_timestamps(10, 3)  # 10 AM, 11 AM, 12 PM
        result = is_london_killzone(ts)
        assert not any(result.to_list())


class TestNYAMKillzone:
    def test_true_during_nyam(self):
        ts = _make_timestamps(8, 3)  # 8 AM, 9 AM, 10 AM
        result = is_nyam_killzone(ts)
        assert all(result.to_list()), "8-10 AM should be in NY AM killzone"

    def test_false_during_lunch(self):
        ts = _make_timestamps(12, 2)  # 12 PM, 1 PM
        result = is_nyam_killzone(ts)
        assert not any(result.to_list())


class TestNYLunch:
    def test_true_during_lunch(self):
        ts = _make_timestamps(12, 1)  # 12 PM
        result = is_ny_lunch(ts)
        assert result[0], "12 PM should be in NY lunch"

    def test_false_during_am(self):
        ts = _make_timestamps(9, 2)  # 9 AM, 10 AM
        result = is_ny_lunch(ts)
        assert not any(result.to_list())


class TestNYPMKillzone:
    def test_true_during_pm(self):
        ts = pl.Series("ts_event", [
            datetime(2023, 6, 15, 14, 0),  # 2 PM
            datetime(2023, 6, 15, 15, 0),  # 3 PM
        ])
        result = is_nypm_killzone(ts)
        assert all(result.to_list()), "2-3 PM should be in NY PM killzone"

    def test_false_during_morning(self):
        ts = _make_timestamps(9, 2)
        result = is_nypm_killzone(ts)
        assert not any(result.to_list())


class TestMacroTime:
    def test_true_during_macro(self):
        # 8:50 AM - 9:10 AM is a macro window
        ts = pl.Series("ts_event", [
            datetime(2023, 6, 15, 8, 55),
            datetime(2023, 6, 15, 9, 5),
        ])
        result = is_macro_time(ts)
        assert all(result.to_list()), "8:55 and 9:05 should be in macro time"

    def test_false_outside_macro(self):
        ts = pl.Series("ts_event", [
            datetime(2023, 6, 15, 7, 0),
            datetime(2023, 6, 15, 11, 30),
        ])
        result = is_macro_time(ts)
        assert not any(result.to_list())


class TestDayOfWeekProfile:
    def test_returns_day_names(self):
        ts = pl.Series("ts_event", [
            datetime(2023, 6, 12),  # Monday
            datetime(2023, 6, 13),  # Tuesday
            datetime(2023, 6, 14),  # Wednesday
            datetime(2023, 6, 15),  # Thursday
            datetime(2023, 6, 16),  # Friday
        ])
        result = day_of_week_profile(ts)
        assert result.to_list() == ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]


class TestQuarterlyTheory:
    def test_four_quarters_in_hour(self):
        ts = pl.Series("ts_event", [
            datetime(2023, 6, 15, 9, 0),   # Q1
            datetime(2023, 6, 15, 9, 15),  # Q2
            datetime(2023, 6, 15, 9, 30),  # Q3
            datetime(2023, 6, 15, 9, 45),  # Q4
        ])
        result = quarterly_theory(ts, "1h")
        assert result.to_list() == ["Q1", "Q2", "Q3", "Q4"]


class TestTrueDayOpen:
    def test_returns_first_open(self):
        df = _make_df_with_times(8, 5)  # 5 bars starting 8 AM
        result = true_day_open(df)
        assert isinstance(result, pl.Series)
        assert len(result) == 5
        # All bars same day -> all should have same TDO
        vals = result.to_list()
        assert all(v == vals[0] for v in vals if v is not None)

    def test_different_days(self):
        ts = pl.Series("ts_event", [
            datetime(2023, 6, 15, 9, 0),
            datetime(2023, 6, 15, 10, 0),
            datetime(2023, 6, 16, 9, 0),
            datetime(2023, 6, 16, 10, 0),
        ])
        df = pl.DataFrame({
            "ts_event": ts,
            "open": [100.0, 101.0, 105.0, 106.0],
            "high": [102.0, 103.0, 107.0, 108.0],
            "low": [99.0, 100.0, 104.0, 105.0],
            "close": [101.0, 102.0, 106.0, 107.0],
            "volume": [10000] * 4,
        })
        result = true_day_open(df)
        assert result[0] == pytest.approx(100.0)  # Day 1 TDO
        assert result[1] == pytest.approx(100.0)  # Same day
        assert result[2] == pytest.approx(105.0)  # Day 2 TDO
        assert result[3] == pytest.approx(105.0)  # Same day


class TestMidnightOpen:
    def test_returns_series(self):
        df = _make_df_with_times(0, 5)
        result = midnight_open(df)
        assert isinstance(result, pl.Series)
        assert len(result) == 5
