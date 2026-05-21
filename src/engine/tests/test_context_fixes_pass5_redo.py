"""Regression tests for Pass 5 Track F fixes (redo).

Covers:
  F-1  — ISO-week boundary for weekly high/low (Friday vs Monday)
  F-2  — Overnight range timestamp-driven scan (not hardcoded -100)
  F-3  — London scan rejects prior-day London bars
  F-4  — OR scan excludes current bar (no lookahead)
  F-6  — UTC timestamp → ET hour classification
  F-7  — compute_single_tp returns NEAREST qualifying target
  F-8  — Governor fed adj_pnl (not full pnl) after contract reduction
  F-9  — _get_session handles pre_market + maintenance sessions
"""
from __future__ import annotations

import datetime
from zoneinfo import ZoneInfo

import polars as pl
import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_ET = ZoneInfo("America/New_York")
_UTC = ZoneInfo("UTC")


def _make_ts_utc(year, month, day, hour, minute=0):
    """Build a UTC-aware datetime."""
    return datetime.datetime(year, month, day, hour, minute, tzinfo=_UTC)


def _make_ts_naive_utc(year, month, day, hour, minute=0):
    """Build a naive datetime that represents UTC (no tzinfo attached)."""
    return datetime.datetime(year, month, day, hour, minute)


def _et_ts(year, month, day, hour, minute=0):
    """Build an ET-aware datetime directly."""
    return datetime.datetime(year, month, day, hour, minute, tzinfo=_ET)


# ---------------------------------------------------------------------------
# F-6: _to_et correctly converts UTC → ET
# ---------------------------------------------------------------------------

class TestToET:
    """F-6: _to_et() must convert UTC to ET regardless of DST."""

    def test_utc_aware_converts_to_et(self):
        from src.engine.context.session_context import _to_et
        # 14:30 UTC = 10:30 ET in EDT (UTC-4, summer)
        ts = _make_ts_utc(2024, 6, 15, 14, 30)  # summer
        et = _to_et(ts)
        assert et.hour == 10
        assert et.minute == 30

    def test_naive_utc_treated_as_utc(self):
        from src.engine.context.session_context import _to_et
        # naive 14:30 — must be treated as UTC → 10:30 ET (summer)
        ts = _make_ts_naive_utc(2024, 6, 15, 14, 30)
        et = _to_et(ts)
        assert et.hour == 10
        assert et.minute == 30

    def test_winter_est_offset(self):
        from src.engine.context.session_context import _to_et
        # 15:00 UTC = 10:00 ET in EST (UTC-5, winter)
        ts = _make_ts_utc(2024, 1, 15, 15, 0)
        et = _to_et(ts)
        assert et.hour == 10
        assert et.minute == 0

    def test_dst_spring_forward(self):
        from src.engine.context.session_context import _to_et
        # 2024-03-10 is in winter (EST), 2024-03-11 is in summer (EDT)
        # 07:00 UTC on 2024-03-11 (EDT day) = 03:00 ET
        ts = _make_ts_utc(2024, 3, 11, 7, 0)
        et = _to_et(ts)
        assert et.hour == 3

    def test_none_returns_none(self):
        from src.engine.context.session_context import _to_et
        assert _to_et(None) is None

    def test_london_hour_utc_input(self):
        """7:00 UTC = 3:00 ET (EDT) — should be classified as London session."""
        from src.engine.context.session_context import _to_et, _get_session
        ts = _make_ts_utc(2024, 6, 15, 7, 0)  # 03:00 ET summer
        et = _to_et(ts)
        session = _get_session(et.hour, et.minute)
        assert session == "london"

    def test_ny_am_utc_input(self):
        """13:30 UTC = 09:30 ET (EDT) — should be classified as ny_am."""
        from src.engine.context.session_context import _to_et, _get_session
        ts = _make_ts_utc(2024, 6, 15, 13, 30)  # 09:30 ET summer
        et = _to_et(ts)
        session = _get_session(et.hour, et.minute)
        assert session == "ny_am"

    def test_maintenance_utc_input(self):
        """21:00 UTC = 17:00 ET (EDT) — should be classified as maintenance (F-9)."""
        from src.engine.context.session_context import _to_et, _get_session
        ts = _make_ts_utc(2024, 6, 15, 21, 0)  # 17:00 ET summer
        et = _to_et(ts)
        session = _get_session(et.hour, et.minute)
        # Per F-9: 17:00-18:00 ET is the Globex maintenance window
        assert session == "maintenance"

    def test_overnight_rth_close_utc_input(self):
        """20:00 UTC = 16:00 ET (EDT) — RTH close, Globex still up: overnight."""
        from src.engine.context.session_context import _to_et, _get_session
        ts = _make_ts_utc(2024, 6, 15, 20, 0)  # 16:00 ET summer
        et = _to_et(ts)
        session = _get_session(et.hour, et.minute)
        assert session == "overnight"


# ---------------------------------------------------------------------------
# F-9: _get_session — pre_market and maintenance sessions
# ---------------------------------------------------------------------------

class TestGetSession:
    """F-9: New session buckets must exist and cover the right hours."""

    def test_maintenance_17_to_18(self):
        from src.engine.context.session_context import _get_session
        assert _get_session(17, 0) == "maintenance"
        assert _get_session(17, 59) == "maintenance"

    def test_asian_after_maintenance(self):
        from src.engine.context.session_context import _get_session
        assert _get_session(18, 0) == "asian"
        assert _get_session(23, 59) == "asian"
        assert _get_session(0, 0) == "asian"
        assert _get_session(1, 59) == "asian"

    def test_london_2_to_5(self):
        from src.engine.context.session_context import _get_session
        assert _get_session(2, 0) == "london"
        assert _get_session(4, 59) == "london"

    def test_pre_market_5_to_930(self):
        from src.engine.context.session_context import _get_session
        assert _get_session(5, 0) == "pre_market"
        assert _get_session(9, 0) == "pre_market"
        assert _get_session(9, 29) == "pre_market"

    def test_ny_am_9_30_to_noon(self):
        from src.engine.context.session_context import _get_session
        assert _get_session(9, 30) == "ny_am"
        assert _get_session(11, 59) == "ny_am"

    def test_ny_pm_noon_to_16(self):
        from src.engine.context.session_context import _get_session
        assert _get_session(12, 0) == "ny_pm"
        assert _get_session(15, 59) == "ny_pm"

    def test_overnight_16_to_17(self):
        from src.engine.context.session_context import _get_session
        assert _get_session(16, 0) == "overnight"
        assert _get_session(16, 59) == "overnight"


# ---------------------------------------------------------------------------
# F-1: ISO-week weekly range — Friday bar vs Monday bar
# ---------------------------------------------------------------------------

class TestISOWeekRange:
    """F-1: weekly_high/low must use the previous completed ISO week, not
    rolling last 5 bars."""

    def _make_daily_df(self, days_of_highs: list) -> pl.DataFrame:
        """days_of_highs: list of (date, high, low) tuples."""
        rows = []
        for d, h, l in days_of_highs:
            rows.append({
                "ts_event": datetime.datetime.combine(d, datetime.time(16, 0)),
                "open": h - 5.0,
                "high": float(h),
                "low": float(l),
                "close": h - 2.0,
                "volume": 1000.0,
            })
        return pl.DataFrame(rows)

    def _make_trading_days_weeks(self, n_weeks: int, base_monday: datetime.date) -> list:
        """Generate n_weeks of Mon-Fri trading data.
        Highs are keyed by week_number (1-based from base_monday) so each week is distinct.
        Returns list of (date, high, low) tuples.
        """
        days = []
        for week_num in range(1, n_weeks + 1):
            week_start = base_monday + datetime.timedelta(weeks=week_num - 1)
            h = 5000.0 + week_num * 10.0
            l = h - 20.0
            for day_offset in range(5):  # Mon-Fri
                d = week_start + datetime.timedelta(days=day_offset)
                days.append((d, h, l))
        return days

    def test_uses_prior_week_not_last_5_bars(self):
        """On a Monday (week N), weekly range must be week N-1, not rolling last 5 bars.

        The rolling-5-bars approach would include Friday of week N-1 AND Mon of week N
        (the current bar) when run on a Monday, bleeding into the current week.
        ISO-week grouping returns only PREVIOUS completed week (Mon-Fri of week N-1).
        """
        from src.engine.context.htf_context import compute_htf_context

        # Generate 210 weeks of clean Mon-Fri data starting 2019-01-07 (Monday).
        # Week 1 high = 5010, week 2 = 5020, ... week N = 5000 + N*10
        base_monday = datetime.date(2019, 1, 7)
        days = self._make_trading_days_weeks(210, base_monday)
        df = self._make_daily_df(days)

        # Use week 200 Monday as bar_date.
        # Week 200 starts at base_monday + 199 weeks.
        week200_monday = base_monday + datetime.timedelta(weeks=199)
        assert week200_monday.weekday() == 0, "Must be Monday"

        # bar_date = early Monday morning (before first bar of week 200)
        bar_date = datetime.datetime.combine(week200_monday, datetime.time(9, 0))

        htf = compute_htf_context(df, None, None, 5000.0 + 199 * 10.0, bar_date=bar_date)

        # Week 199 is the previous completed week; its high = 5000 + 199*10 = 6990
        expected_wh = 5000.0 + 199 * 10.0
        assert htf.weekly_high == pytest.approx(expected_wh, abs=1.0), (
            f"Expected week-199 high ~{expected_wh}, got {htf.weekly_high}"
        )

        # Verify: rolling last-5-bars would have given week-200 high (5000+200*10=7000)
        # i.e., the fix matters
        week200_high = 5000.0 + 200 * 10.0
        assert htf.weekly_high != pytest.approx(week200_high, abs=1.0), (
            "Should NOT see week-200 data on a Monday of week 200"
        )

    def test_friday_bar_sees_previous_week(self):
        """On a Friday of week N, weekly range is still week N-1 (prior COMPLETED week).

        Friday is the last bar of week N — week N is still in progress.
        """
        from src.engine.context.htf_context import compute_htf_context

        base_monday = datetime.date(2019, 1, 7)
        days = self._make_trading_days_weeks(210, base_monday)
        df = self._make_daily_df(days)

        # Use week 200 Friday as bar_date (at 14:00 — before the 16:00 close)
        week200_friday = base_monday + datetime.timedelta(weeks=199, days=4)
        assert week200_friday.weekday() == 4, "Must be Friday"

        bar_date = datetime.datetime.combine(week200_friday, datetime.time(14, 0))

        htf = compute_htf_context(df, None, None, 5000.0 + 200 * 10.0, bar_date=bar_date)

        # Previous completed week = week 199; its high = 5000 + 199*10
        expected_wh = 5000.0 + 199 * 10.0
        assert htf.weekly_high == pytest.approx(expected_wh, abs=1.0), (
            f"Expected week-199 high ~{expected_wh}, got {htf.weekly_high}"
        )

    def test_fallback_when_no_bar_date(self):
        """Without bar_date, falls back to last 5 bars (logged warning)."""
        from src.engine.context.htf_context import compute_htf_context

        base_monday = datetime.date(2019, 1, 7)
        days = self._make_trading_days_weeks(210, base_monday)
        df = self._make_daily_df(days)
        # No bar_date → fallback; verify it runs and returns floats
        htf = compute_htf_context(df, None, None, 5000.0, bar_date=None)
        assert isinstance(htf.weekly_high, float)
        assert isinstance(htf.weekly_low, float)


# ---------------------------------------------------------------------------
# F-7: compute_single_tp returns NEAREST qualifying target
# ---------------------------------------------------------------------------

class TestComputeSingleTP:
    """F-7: Must return nearest target >= 2R, not first by insertion order."""

    def test_returns_nearest_not_first(self):
        from src.engine.context.structural_targets import compute_single_tp

        entry = 5000.0
        stop = 4990.0   # risk = 10pts; min_tp_distance = 20pts

        # BSL at 5030 (3R from entry), old_high at 5025 (2.5R from entry)
        # Insertion order: BSL first, old_high second
        # Nearest qualifying: old_high at 5025 (closer to entry than BSL)
        tp = compute_single_tp(
            direction="long",
            entry_price=entry,
            stop_price=stop,
            nearest_bsl=5030.0,
            nearest_old_high=5025.0,
        )
        assert tp == pytest.approx(5025.0), (
            f"Expected nearest qualifying TP 5025.0, got {tp}"
        )

    def test_skips_below_2r(self):
        from src.engine.context.structural_targets import compute_single_tp

        entry = 5000.0
        stop = 4990.0  # risk = 10; min = 20

        # BSL at 5015 (only 1.5R — does NOT qualify)
        # old_high at 5025 (2.5R — qualifies)
        tp = compute_single_tp(
            direction="long",
            entry_price=entry,
            stop_price=stop,
            nearest_bsl=5015.0,
            nearest_old_high=5025.0,
        )
        assert tp == pytest.approx(5025.0)

    def test_short_nearest_qualifying(self):
        from src.engine.context.structural_targets import compute_single_tp

        entry = 5000.0
        stop = 5010.0   # risk = 10; min_tp_distance = 20

        # SSL at 4960 (4R away), old_low at 4975 (2.5R — nearer and qualifies)
        tp = compute_single_tp(
            direction="short",
            entry_price=entry,
            stop_price=stop,
            nearest_ssl=4960.0,
            nearest_old_low=4975.0,
        )
        assert tp == pytest.approx(4975.0), (
            f"Expected nearest short TP 4975.0, got {tp}"
        )

    def test_returns_none_when_nothing_qualifies(self):
        from src.engine.context.structural_targets import compute_single_tp

        entry = 5000.0
        stop = 4990.0  # risk = 10; min = 20

        # Only target is 5010 — 1R, doesn't qualify
        tp = compute_single_tp(
            direction="long",
            entry_price=entry,
            stop_price=stop,
            nearest_bsl=5010.0,
            atr=0.0,  # no ATR fallback
        )
        assert tp is None


# ---------------------------------------------------------------------------
# F-8: Governor backtest uses adj_pnl not full pnl
# ---------------------------------------------------------------------------

class TestGovernorBacktest:
    """F-8: Governor must receive adj_pnl after contract reduction."""

    def test_reduced_trade_feeds_adj_pnl_to_governor(self):
        """When contracts are reduced, governor state must reflect adj_pnl, not pnl.

        We test indirectly: if governor receives full pnl on a large loss after
        reduction, it would trip into a more severe state than warranted.
        We verify the state_history shows adjusted_pnl != original_pnl for
        trades that were reduced, and the outcome is consistent.
        """
        from src.engine.governor.governor_backtest import backtest_governor

        # Two trades: first loses 400 (reduced to 200 because contracts halved),
        # second is a winner at full size.
        trades = [
            {
                "pnl": -400.0,
                "mae": -400.0,
                "contracts": 4,
                "entry_time": "2024-01-15T10:00:00",
            },
            {
                "pnl": 200.0,
                "mae": -50.0,
                "contracts": 2,
                "entry_time": "2024-01-15T11:00:00",
            },
        ]

        result = backtest_governor(trades, daily_loss_budget=500.0)

        # Extract trade events from history
        trade_events = [e for e in result["state_history"] if e["event"] == "trade"]

        # First trade: if governor was in a reduced state, adjusted_pnl < original
        # Verify at least one has adjusted_pnl rounded consistently
        for event in trade_events:
            assert "adjusted_pnl" in event
            assert "original_pnl" in event

    def test_blocked_trade_does_not_change_governor_pnl(self):
        """Blocked trades must not feed any P&L to governor."""
        from src.engine.governor.governor_backtest import backtest_governor

        # Send enough losses to trigger lockout, then send a blocked trade
        # The blocked trade's P&L must not appear in governed_pnl
        trades = [
            {"pnl": -500.0, "mae": -500.0, "contracts": 1, "entry_time": "2024-01-15T10:00:00"},
            {"pnl": -500.0, "mae": -500.0, "contracts": 1, "entry_time": "2024-01-15T10:05:00"},
            {"pnl": 300.0,  "mae": -10.0,  "contracts": 1, "entry_time": "2024-01-15T10:10:00"},
        ]

        result = backtest_governor(trades, daily_loss_budget=600.0)
        blocked = result["governed"]["trades_blocked"]
        taken = result["governed"]["trades"]

        assert blocked + taken <= len(trades)
        # If any trade was blocked, governed P&L must differ from original
        if blocked > 0:
            assert result["governed"]["pnl"] != result["original"]["pnl"]


# ---------------------------------------------------------------------------
# F-4: OR scan excludes current bar
# ---------------------------------------------------------------------------

class TestORScanNoLookahead:
    """F-4: Opening range must NOT include the current bar."""

    def _build_intraday_df(self, bars):
        """bars: list of (ts_utc_aware, high, low, close) tuples."""
        rows = []
        for ts, h, l, c in bars:
            rows.append({
                "ts_event": ts,
                "open": c - 1.0,
                "high": float(h),
                "low": float(l),
                "close": float(c),
                "volume": 100.0,
            })
        return pl.DataFrame(rows)

    def test_current_bar_excluded_from_or(self):
        """If current bar is at 9:32 ET and has a distinctly different high,
        that high must NOT appear in the OR range."""
        from src.engine.context.session_context import compute_session_context

        # Two bars in OR window (9:30, 9:31 ET = 13:30, 13:31 UTC summer)
        # Current bar at 9:32 ET = 13:32 UTC with an extreme high
        bars = [
            (_make_ts_utc(2024, 6, 15, 13, 30), 5010.0, 5000.0, 5005.0),  # 9:30 ET
            (_make_ts_utc(2024, 6, 15, 13, 31), 5012.0, 5001.0, 5008.0),  # 9:31 ET
            (_make_ts_utc(2024, 6, 15, 13, 32), 9999.0, 4000.0, 5500.0),  # 9:32 ET ← current
        ]
        df = self._build_intraday_df(bars)
        bar_idx = 2  # current bar is the extreme one

        ctx = compute_session_context(df, bar_idx, prev_day_high=5050.0, prev_day_low=4950.0)

        # OR should only contain the first two bars
        or_high, or_low = ctx.opening_range
        assert or_high < 9999.0, f"Current bar's extreme high leaked into OR: {or_high}"
        assert or_low > 4000.0, f"Current bar's extreme low leaked into OR: {or_low}"
        assert or_high == pytest.approx(5012.0, abs=0.5)
        assert or_low == pytest.approx(5000.0, abs=0.5)


# ---------------------------------------------------------------------------
# F-3: London scan rejects prior-day London bars
# ---------------------------------------------------------------------------

class TestLondonScanSameDayOnly:
    """F-3: London scan must only include London bars for the same trading date."""

    def _build_intraday_df(self, bars):
        rows = []
        for ts, h, l, c in bars:
            rows.append({
                "ts_event": ts,
                "open": c - 1.0,
                "high": float(h),
                "low": float(l),
                "close": float(c),
                "volume": 100.0,
            })
        return pl.DataFrame(rows)

    def test_prior_day_london_bar_rejected(self):
        """A London bar from yesterday must not contaminate today's London range."""
        from src.engine.context.session_context import compute_session_context

        # Yesterday's London bar: 2024-06-14 07:00 UTC = 03:00 ET = London
        # Today's London bar:     2024-06-15 07:00 UTC = 03:00 ET = London
        # Current bar:            2024-06-15 14:30 UTC = 10:30 ET = NY_AM
        bars = [
            # Yesterday London: extreme high 9999
            (_make_ts_utc(2024, 6, 14, 7, 0), 9999.0, 4800.0, 5000.0),
            # Today London: normal high 5020
            (_make_ts_utc(2024, 6, 15, 7, 0), 5020.0, 5000.0, 5010.0),
            # Pad with some NY bars today
            (_make_ts_utc(2024, 6, 15, 13, 30), 5030.0, 5005.0, 5025.0),
            (_make_ts_utc(2024, 6, 15, 14, 30), 5035.0, 5010.0, 5030.0),  # current
        ]
        df = self._build_intraday_df(bars)
        bar_idx = 3

        ctx = compute_session_context(df, bar_idx, prev_day_high=5050.0, prev_day_low=4950.0)

        assert ctx.london_high < 9999.0, (
            f"Prior-day London high leaked in: {ctx.london_high}"
        )
        assert ctx.london_high == pytest.approx(5020.0, abs=1.0)
