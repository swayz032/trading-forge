"""W25.5e — Unit tests for resample_daily_to_weekly() in data_loader.py.

Tests:
- Mon–Fri aggregation correctness (OHLCV contract)
- Partial week handling
- Gap days (weekends excluded from daily data)
- Missing ts_event column raises ValueError

Run:
    python -m pytest src/engine/tests/test_resample_daily_to_weekly.py -v
"""
from __future__ import annotations

from datetime import datetime, timezone

import polars as pl
import pytest

from src.engine.data_loader import resample_daily_to_weekly


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _ts_utc(dt_str: str) -> datetime:
    return datetime.fromisoformat(dt_str).replace(tzinfo=timezone.utc)


def _make_daily(rows: list[tuple[str, float, float, float, float, float]]) -> pl.DataFrame:
    """Build daily OHLCV from (date_str, open, high, low, close, volume) tuples."""
    ts_list, opens, highs, lows, closes, vols = [], [], [], [], [], []
    for (ds, op, hi, lo, cl, vol) in rows:
        ts_list.append(_ts_utc(f"{ds} 00:00:00"))
        opens.append(op)
        highs.append(hi)
        lows.append(lo)
        closes.append(cl)
        vols.append(vol)
    return pl.DataFrame({
        "ts_event": ts_list,
        "open": opens,
        "high": highs,
        "low": lows,
        "close": closes,
        "volume": vols,
    }).with_columns(pl.col("ts_event").cast(pl.Datetime("us", "UTC")))


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestResampleDailyToWeekly:

    def test_missing_ts_event_raises(self):
        """DataFrame without ts_event raises ValueError."""
        df = pl.DataFrame({"close": [100.0, 101.0]})
        with pytest.raises(ValueError, match="ts_event"):
            resample_daily_to_weekly(df)

    def test_full_week_aggregation(self):
        """A complete Mon–Fri week collapses to one row with correct OHLCV."""
        # Week of 2024-01-15 (Mon) → 2024-01-19 (Fri)
        daily = _make_daily([
            ("2024-01-15", 100.0, 105.0, 99.0, 103.0, 1000.0),   # Mon
            ("2024-01-16", 103.0, 107.0, 102.0, 106.0, 1100.0),  # Tue
            ("2024-01-17", 106.0, 108.0, 104.0, 105.0, 900.0),   # Wed
            ("2024-01-18", 105.0, 109.0, 103.0, 107.0, 1200.0),  # Thu
            ("2024-01-19", 107.0, 110.0, 106.0, 108.0, 950.0),   # Fri
        ])
        result = resample_daily_to_weekly(daily)

        # Should produce exactly 1 weekly bar
        assert len(result) == 1

        # open = first bar's open (Mon)
        assert result["open"][0] == 100.0
        # high = max across all bars = 110
        assert result["high"][0] == 110.0
        # low = min across all bars = 99
        assert result["low"][0] == 99.0
        # close = last bar's close (Fri)
        assert result["close"][0] == 108.0
        # volume = sum
        assert abs(result["volume"][0] - 5150.0) < 0.01

    def test_two_full_weeks_produce_two_rows(self):
        """Two separate complete weeks → two weekly bars."""
        daily = _make_daily([
            # Week 1: 2024-01-15
            ("2024-01-15", 100.0, 105.0, 99.0, 103.0, 1000.0),
            ("2024-01-16", 103.0, 107.0, 102.0, 106.0, 1100.0),
            ("2024-01-17", 106.0, 108.0, 104.0, 105.0, 900.0),
            ("2024-01-18", 105.0, 109.0, 103.0, 107.0, 1200.0),
            ("2024-01-19", 107.0, 110.0, 106.0, 108.0, 950.0),
            # Week 2: 2024-01-22
            ("2024-01-22", 108.0, 115.0, 107.0, 113.0, 1300.0),
            ("2024-01-23", 113.0, 116.0, 112.0, 114.0, 1150.0),
            ("2024-01-24", 114.0, 117.0, 113.0, 115.0, 1000.0),
            ("2024-01-25", 115.0, 118.0, 114.0, 116.0, 1050.0),
            ("2024-01-26", 116.0, 119.0, 115.0, 117.0, 1100.0),
        ])
        result = resample_daily_to_weekly(daily).sort("ts_event")

        assert len(result) == 2

        # Week 1 OHLCV
        assert result["open"][0] == 100.0
        assert result["high"][0] == 110.0
        assert result["low"][0] == 99.0
        assert result["close"][0] == 108.0

        # Week 2 OHLCV
        assert result["open"][1] == 108.0
        assert result["high"][1] == 119.0
        assert result["low"][1] == 107.0
        assert result["close"][1] == 117.0

    def test_partial_week_single_bar(self):
        """A single bar in a week still produces one weekly row."""
        daily = _make_daily([
            ("2024-01-19", 107.0, 110.0, 106.0, 108.0, 950.0),  # Only Fri
        ])
        result = resample_daily_to_weekly(daily)
        assert len(result) == 1
        assert result["open"][0] == 107.0
        assert result["high"][0] == 110.0
        assert result["low"][0] == 106.0
        assert result["close"][0] == 108.0

    def test_partial_week_missing_monday(self):
        """Week with Mon missing (holiday) still aggregates remaining 4 days."""
        daily = _make_daily([
            # No Monday (holiday)
            ("2024-01-16", 103.0, 107.0, 102.0, 106.0, 1100.0),  # Tue
            ("2024-01-17", 106.0, 108.0, 104.0, 105.0, 900.0),   # Wed
            ("2024-01-18", 105.0, 109.0, 103.0, 107.0, 1200.0),  # Thu
            ("2024-01-19", 107.0, 110.0, 106.0, 108.0, 950.0),   # Fri
        ])
        result = resample_daily_to_weekly(daily)
        assert len(result) == 1
        # open = first available bar's open (Tue)
        assert result["open"][0] == 103.0
        assert result["high"][0] == 110.0

    def test_gap_between_weeks(self):
        """A week gap (no data for a week) still produces correct output for surrounding weeks."""
        daily = _make_daily([
            ("2024-01-15", 100.0, 105.0, 99.0, 103.0, 1000.0),  # Week 1 Mon
            ("2024-01-19", 107.0, 110.0, 106.0, 108.0, 950.0),  # Week 1 Fri
            # Week 2 (Jan 22–26) completely missing — gap
            ("2024-01-29", 120.0, 125.0, 119.0, 123.0, 1400.0),  # Week 3 Mon
            ("2024-01-30", 123.0, 126.0, 122.0, 125.0, 1300.0),  # Week 3 Tue
        ])
        result = resample_daily_to_weekly(daily).sort("ts_event")
        # 2 weeks of data (week 2 has no bars, so Polars group_by_dynamic won't create an empty row)
        assert len(result) == 2

    def test_output_has_required_columns(self):
        """Output DataFrame has all 6 OHLCV columns including ts_event."""
        daily = _make_daily([
            ("2024-01-15", 100.0, 105.0, 99.0, 103.0, 1000.0),
        ])
        result = resample_daily_to_weekly(daily)
        for col in ("ts_event", "open", "high", "low", "close", "volume"):
            assert col in result.columns, f"Missing column: {col}"

    def test_original_df_unchanged(self):
        """resample_daily_to_weekly must not mutate the input DataFrame."""
        daily = _make_daily([
            ("2024-01-15", 100.0, 105.0, 99.0, 103.0, 1000.0),
            ("2024-01-16", 103.0, 107.0, 102.0, 106.0, 1100.0),
        ])
        original_rows = len(daily)
        original_cols = list(daily.columns)
        _ = resample_daily_to_weekly(daily)
        # Input unchanged
        assert len(daily) == original_rows
        assert list(daily.columns) == original_cols

    def test_empty_df_returns_empty(self):
        """Empty daily DataFrame with ts_event column → empty weekly DataFrame."""
        daily = pl.DataFrame({
            "ts_event": pl.Series([], dtype=pl.Datetime("us", "UTC")),
            "open": pl.Series([], dtype=pl.Float64),
            "high": pl.Series([], dtype=pl.Float64),
            "low": pl.Series([], dtype=pl.Float64),
            "close": pl.Series([], dtype=pl.Float64),
            "volume": pl.Series([], dtype=pl.Float64),
        })
        result = resample_daily_to_weekly(daily)
        assert len(result) == 0
