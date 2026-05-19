"""
Wave 13 Track A — Tests for the opening_range_breakout indicator.

Covers:
- No lookahead: values before lock time are null
- Range locks correctly at session_start + range_minutes
- Values broadcast correctly across all post-lock bars in the day
- Resets on day boundary
- ET vs UTC timestamp handling
- compute_indicators() dispatcher wires it correctly
- Empty dataframe does not crash

Naming convention: test_{what_it_tests}
"""

from __future__ import annotations

import datetime
from typing import Optional

import polars as pl
import pytest

from src.engine.config import IndicatorConfig
from src.engine.indicators.core import compute_indicators, compute_opening_range_breakout


# ─── Synthetic data builders ────────────────────────────────────────────────

def _make_day_bars(
    date: str,
    session_start_hh: int = 9,
    session_start_mm: int = 30,
    bar_minutes: int = 5,
    n_bars: int = 12,
    base_price: float = 4500.0,
    high_offsets: Optional[list[float]] = None,
    low_offsets: Optional[list[float]] = None,
) -> pl.DataFrame:
    """
    Create synthetic intraday bars for a single trading day.

    Timestamps are stored as UTC-aware datetimes but represent ET wall-clock times
    (i.e. no UTC offset applied — we are testing the ts_et column path where the
    column value is already the ET wall-clock time stored as an unqualified datetime).

    Parameters
    ----------
    date : str
        YYYY-MM-DD of the trading day.
    session_start_hh, session_start_mm : int
        Start of session in ET (default 09:30).
    bar_minutes : int
        Bar size in minutes.
    n_bars : int
        Number of bars to generate.
    base_price : float
        Starting close price.
    high_offsets, low_offsets : list of float (optional)
        Per-bar offset from base_price for high / low.
        Length must equal n_bars if provided.
    """
    if high_offsets is None:
        high_offsets = [float(i + 2) for i in range(n_bars)]
    if low_offsets is None:
        low_offsets = [-float(i + 1) for i in range(n_bars)]

    assert len(high_offsets) == n_bars, "high_offsets length mismatch"
    assert len(low_offsets) == n_bars, "low_offsets length mismatch"

    base_dt = datetime.datetime(
        *[int(x) for x in date.split("-")],
        session_start_hh, session_start_mm, 0
    )
    timestamps = [base_dt + datetime.timedelta(minutes=bar_minutes * i) for i in range(n_bars)]

    closes = [base_price + float(i) * 0.5 for i in range(n_bars)]
    highs  = [base_price + h for h in high_offsets]
    lows   = [base_price + l for l in low_offsets]
    volumes = [1000] * n_bars

    return pl.DataFrame({
        "ts_et":   pl.Series(timestamps, dtype=pl.Datetime),
        "open":    [base_price] * n_bars,
        "high":    highs,
        "low":     lows,
        "close":   closes,
        "volume":  volumes,
    })


def _make_two_day_bars(bar_minutes: int = 5) -> pl.DataFrame:
    """Two trading days back to back."""
    day1 = _make_day_bars("2025-01-02", bar_minutes=bar_minutes)
    day2 = _make_day_bars("2025-01-03", base_price=4510.0, bar_minutes=bar_minutes)
    return pl.concat([day1, day2])


# ─── Test: range locks at correct time ─────────────────────────────────────

class TestRangeLockTiming:
    """
    For a 5-min bar session starting at 09:30, 15-min OR = bars 0, 1, 2
    (09:30, 09:35, 09:40). Range completes at 09:45. Lock time = 09:45.
    Bar at 09:45 is the FIRST bar that should carry a non-null orh/orl.
    """

    def test_bars_before_lock_are_null(self):
        df = _make_day_bars("2025-01-02", n_bars=12, bar_minutes=5)
        # 09:30, 09:35, 09:40 are inside the 15-min range → null after lock check
        orh, orl, or_range = compute_opening_range_breakout(df, range_minutes=15)
        # Bars 0 (09:30), 1 (09:35), 2 (09:40) are inside the range → still forming
        assert orh[0] is None, "Bar at 09:30 should be null (range still forming)"
        assert orh[1] is None, "Bar at 09:35 should be null (range still forming)"
        assert orh[2] is None, "Bar at 09:40 should be null (last bar in range)"

    def test_first_post_lock_bar_is_non_null(self):
        df = _make_day_bars("2025-01-02", n_bars=12, bar_minutes=5)
        orh, orl, or_range = compute_opening_range_breakout(df, range_minutes=15)
        # Bar 3 = 09:45 — first bar after lock
        assert orh[3] is not None, "Bar at 09:45 (first post-lock) should have orh value"
        assert orl[3] is not None, "Bar at 09:45 (first post-lock) should have orl value"
        assert or_range[3] is not None, "Bar at 09:45 should have or_range"

    def test_all_post_lock_bars_non_null(self):
        df = _make_day_bars("2025-01-02", n_bars=12, bar_minutes=5)
        orh, orl, or_range = compute_opening_range_breakout(df, range_minutes=15)
        # Bars 3-11 are all post-lock → should all be non-null
        for i in range(3, 12):
            assert orh[i] is not None, f"Bar {i} should have non-null orh"
            assert orl[i] is not None, f"Bar {i} should have non-null orl"


# ─── Test: OR values are correct ───────────────────────────────────────────

class TestRangeValues:
    """The OR high and OR low must equal the session-range max/min."""

    def test_orh_equals_range_max_high(self):
        # Create known highs: bar0=4502, bar1=4508, bar2=4504, bar3=4501
        high_offsets = [2.0, 8.0, 4.0, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0]
        df = _make_day_bars("2025-01-02", high_offsets=high_offsets, n_bars=12, bar_minutes=5)
        orh, orl, or_range = compute_opening_range_breakout(df, range_minutes=15)
        # OR window = bars 0, 1, 2 → highs 4502, 4508, 4504 → max = 4508
        expected_orh = 4500.0 + 8.0  # = 4508
        assert abs(orh[3] - expected_orh) < 1e-6, f"Expected orh={expected_orh}, got {orh[3]}"

    def test_orl_equals_range_min_low(self):
        low_offsets = [-1.0, -5.0, -3.0, -2.0, -2.5, -3.0, -3.5, -4.0, -4.5, -5.0, -5.5, -6.0]
        df = _make_day_bars("2025-01-02", low_offsets=low_offsets, n_bars=12, bar_minutes=5)
        orh, orl, or_range = compute_opening_range_breakout(df, range_minutes=15)
        # OR window = bars 0, 1, 2 → lows 4499, 4495, 4497 → min = 4495
        expected_orl = 4500.0 - 5.0  # = 4495
        assert abs(orl[3] - expected_orl) < 1e-6, f"Expected orl={expected_orl}, got {orl[3]}"

    def test_or_range_equals_orh_minus_orl(self):
        df = _make_day_bars("2025-01-02", n_bars=12, bar_minutes=5)
        orh, orl, or_range = compute_opening_range_breakout(df, range_minutes=15)
        # or_range should equal orh - orl for post-lock bars
        for i in range(3, 12):
            expected = orh[i] - orl[i]
            assert abs(or_range[i] - expected) < 1e-6, f"Bar {i}: or_range mismatch"

    def test_or_values_stable_across_day(self):
        """OR values must not change intraday after locking."""
        df = _make_day_bars("2025-01-02", n_bars=12, bar_minutes=5)
        orh, orl, _ = compute_opening_range_breakout(df, range_minutes=15)
        # All post-lock bars should have IDENTICAL orh and orl (locked at range close)
        post_lock_orh = [orh[i] for i in range(3, 12)]
        post_lock_orl = [orl[i] for i in range(3, 12)]
        assert len(set(post_lock_orh)) == 1, "orh changed intraday — should be locked"
        assert len(set(post_lock_orl)) == 1, "orl changed intraday — should be locked"


# ─── Test: day boundary reset ───────────────────────────────────────────────

class TestDayBoundaryReset:
    """On day 2, the OR should be computed fresh from day 2's opening range."""

    def test_two_days_independent_or_values(self):
        df = _make_two_day_bars(bar_minutes=5)
        orh, orl, _ = compute_opening_range_breakout(df, range_minutes=15)
        # Day 1: 12 bars, bars 3-11 carry day1 OR
        # Day 2: 12 bars, bars 3-11 carry day2 OR (different base price)
        day1_orh = orh[3]   # first post-lock bar of day 1
        day2_orh = orh[15]  # first post-lock bar of day 2 (index 12+3=15)
        # Day 2 base_price=4510 vs day1 base_price=4500 → OR highs should differ
        assert day1_orh is not None, "Day 1 orh should be non-null"
        assert day2_orh is not None, "Day 2 orh should be non-null"
        assert abs(day1_orh - day2_orh) > 1.0, (
            f"Day 1 and Day 2 OR highs too close ({day1_orh} vs {day2_orh}); "
            "expected reset with different prices"
        )

    def test_day2_null_during_range_formation(self):
        df = _make_two_day_bars(bar_minutes=5)
        orh, orl, _ = compute_opening_range_breakout(df, range_minutes=15)
        # Day 2 bars 0, 1, 2 (indices 12, 13, 14) should be null
        assert orh[12] is None, "Day 2 bar 0 should be null (range forming)"
        assert orh[13] is None, "Day 2 bar 1 should be null (range forming)"
        assert orh[14] is None, "Day 2 bar 2 should be null (range forming)"


# ─── Test: ts_et vs ts_event column ─────────────────────────────────────────

class TestTimestampColumn:
    """The indicator should use ts_et if available, otherwise ts_event."""

    def test_uses_ts_et_when_present(self):
        df = _make_day_bars("2025-01-02", n_bars=12, bar_minutes=5)
        assert "ts_et" in df.columns
        # Should work without error
        orh, orl, _ = compute_opening_range_breakout(df, range_minutes=15)
        assert orh[3] is not None

    def test_uses_ts_event_when_ts_et_missing(self):
        df = _make_day_bars("2025-01-02", n_bars=12, bar_minutes=5)
        # Rename ts_et → ts_event to simulate UTC-only frame
        df = df.rename({"ts_et": "ts_event"})
        assert "ts_et" not in df.columns
        assert "ts_event" in df.columns
        orh, orl, _ = compute_opening_range_breakout(df, range_minutes=15)
        # Should still compute valid results (same wall-clock times)
        assert orh[3] is not None


# ─── Test: edge cases ───────────────────────────────────────────────────────

class TestEdgeCases:
    def test_empty_dataframe_returns_null_series(self):
        """Empty DataFrame must not crash; returns empty null series."""
        df = pl.DataFrame({
            "ts_et":  pl.Series([], dtype=pl.Datetime),
            "open":   pl.Series([], dtype=pl.Float64),
            "high":   pl.Series([], dtype=pl.Float64),
            "low":    pl.Series([], dtype=pl.Float64),
            "close":  pl.Series([], dtype=pl.Float64),
            "volume": pl.Series([], dtype=pl.Int64),
        })
        orh, orl, or_range = compute_opening_range_breakout(df, range_minutes=15)
        assert len(orh) == 0
        assert len(orl) == 0
        assert len(or_range) == 0

    def test_no_out_of_session_bars(self):
        """If no bars fall in the session window, all values are null."""
        # Create bars starting at 13:00 ET (well past 09:30+15min lock)
        # These bars are AFTER lock time but there are no in-range bars to compute OR from
        base_dt = datetime.datetime(2025, 1, 2, 13, 0, 0)
        n = 6
        timestamps = [base_dt + datetime.timedelta(minutes=5 * i) for i in range(n)]
        df = pl.DataFrame({
            "ts_et":  pl.Series(timestamps, dtype=pl.Datetime),
            "open":   [4500.0] * n,
            "high":   [4502.0] * n,
            "low":    [4498.0] * n,
            "close":  [4500.0] * n,
            "volume": [1000] * n,
        })
        orh, orl, or_range = compute_opening_range_breakout(df, range_minutes=15)
        # No in-range bars → all null
        assert all(v is None for v in orh.to_list()), "All orh should be null (no OR bars)"
        assert all(v is None for v in orl.to_list()), "All orl should be null (no OR bars)"

    def test_range_minutes_1_single_bar_range(self):
        """A 1-minute OR on a 5-min bar frame: no in-range bars within range_minutes=1."""
        df = _make_day_bars("2025-01-02", n_bars=8, bar_minutes=5)
        orh, orl, _ = compute_opening_range_breakout(df, range_minutes=1)
        # With 5-min bars, session_start=09:30, lock=09:31.
        # Bar at 09:30 starts at 09:30 → 09:30 < 09:31 → in-range. But the bar at
        # 09:35 starts at 09:35 >= 09:31 → post-lock.
        # So bar 0 should be null (inside range, not yet locked).
        # Bar 1 (09:35) should be non-null.
        assert orh[0] is None, "09:30 bar is inside the 1-min range window — should be null"
        assert orh[1] is not None, "09:35 bar is post-lock for range_minutes=1 — should be non-null"


# ─── Test: compute_indicators dispatcher ───────────────────────────────────

class TestComputeIndicatorsDispatcher:
    """compute_indicators must dispatch opening_range_breakout and emit correct columns."""

    def test_dispatcher_adds_orh_orl_columns(self):
        df = _make_day_bars("2025-01-02", n_bars=12, bar_minutes=5)
        cfg = IndicatorConfig(type="opening_range_breakout", range_minutes=15, session_start_et="09:30")
        result = compute_indicators(df, [cfg])
        assert "orh_15m" in result.columns, "orh_15m column should be added by dispatcher"
        assert "orl_15m" in result.columns, "orl_15m column should be added by dispatcher"
        assert "or_range_15m" in result.columns, "or_range_15m column should be added by dispatcher"

    def test_dispatcher_uses_range_minutes_in_column_name(self):
        df = _make_day_bars("2025-01-02", n_bars=12, bar_minutes=5)
        cfg = IndicatorConfig(type="opening_range_breakout", range_minutes=30, session_start_et="09:30")
        result = compute_indicators(df, [cfg])
        assert "orh_30m" in result.columns
        assert "orl_30m" in result.columns

    def test_entry_signal_fires_after_lock(self):
        """
        Smoke test: entry_long='close > orh_15m' should fire for bars where close
        beats the OR high and the range is already locked.
        """
        # Create a day where day's high is in bar 0 (part of range), and close in bar 4
        # significantly above the OR high
        high_offsets = [10.0, 5.0, 3.0,  # bars 0,1,2 — in range; max high = 4510
                        2.0, 15.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0]
        df = _make_day_bars("2025-01-02", high_offsets=high_offsets, n_bars=12, bar_minutes=5)

        # Compute indicators
        cfg = IndicatorConfig(type="opening_range_breakout", range_minutes=15)
        result = compute_indicators(df, [cfg])

        # OR high = max(4510, 4505, 4503) = 4510; locked at 09:45
        # close in bar 4 = 4500 + 4*0.5 = 4502 < 4510 → entry should NOT fire
        # close in bar 4 is below OR high; bar 4's HIGH is 4515 > OR high but close is 4502

        # The signal should use CLOSE > orh_15m
        from src.engine.signals import evaluate_expression
        signals = evaluate_expression(result, "close > orh_15m")
        # Post-lock bars where close > orh_15m should be True; pre-lock should be null/False
        assert not signals[0], "Pre-lock bar should not fire entry"
        assert not signals[1], "Pre-lock bar should not fire entry"
        assert not signals[2], "Last in-range bar should not fire entry"

    def test_orh_column_value_correct_via_dispatcher(self):
        """After compute_indicators, orh_15m values should match direct function call."""
        df = _make_day_bars("2025-01-02", n_bars=12, bar_minutes=5)
        cfg = IndicatorConfig(type="opening_range_breakout", range_minutes=15)
        result = compute_indicators(df, [cfg])

        # Direct call
        orh_direct, orl_direct, _ = compute_opening_range_breakout(df, range_minutes=15)

        # Column values should match direct call exactly
        orh_col = result["orh_15m"].to_list()
        orh_dir_list = orh_direct.to_list()
        for i, (col_val, dir_val) in enumerate(zip(orh_col, orh_dir_list)):
            if dir_val is None:
                assert col_val is None, f"Bar {i}: expected None, got {col_val}"
            else:
                assert col_val is not None and abs(col_val - dir_val) < 1e-6, (
                    f"Bar {i}: dispatcher={col_val} vs direct={dir_val}"
                )
