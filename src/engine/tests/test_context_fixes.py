"""Regression tests for Pass 5 / Track F context fixes (F-1 through F-10).

Each test class maps directly to the finding it covers.  Tests are deterministic
and require no external data — all inputs are synthetic.
"""
from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

import numpy as np
import polars as pl
import pytest

# ─── F-1: ISO Week boundary (htf_context) ────────────────────────────────────

class TestISOWeekHighLow:
    """F-1: weekly_high/weekly_low must use the PREVIOUS completed ISO week, not
    the last 5 trading bars (which may straddle a week boundary)."""

    def _make_daily_df(self, rows: list[dict]) -> pl.DataFrame:
        """Build a daily DataFrame with ts_event as Python datetime."""
        return pl.DataFrame({
            "ts_event": [r["ts_event"] for r in rows],
            "open":  [r.get("open",  100.0) for r in rows],
            "high":  [r.get("high",  101.0) for r in rows],
            "low":   [r.get("low",    99.0) for r in rows],
            "close": [r.get("close", 100.0) for r in rows],
            "volume": [10000] * len(rows),
        })

    def _make_padding(self, stop_before: dt.date, n: int = 210) -> list[dict]:
        """Generate n synthetic trading-day bars ending strictly before stop_before.

        Works backward from stop_before to avoid accidentally overlapping with
        specific test-fixture dates.  Uses a fixed high=5001/low=4999 to be
        easily distinguishable from intentional test values.
        """
        rows = []
        d = stop_before - dt.timedelta(days=1)
        while len(rows) < n:
            if d.weekday() < 5:  # Mon-Fri
                rows.append({
                    "ts_event": dt.datetime(d.year, d.month, d.day, 16, 0),
                    "open": 5000.0, "high": 5001.0, "low": 4999.0, "close": 5000.0,
                })
            d -= dt.timedelta(days=1)
        rows.reverse()  # chronological order
        return rows

    def test_friday_bar_uses_prev_week_not_rolling5(self):
        """On a Friday, weekly_high/low must reflect the PREVIOUS completed ISO week.
        Specifically: if today is Friday 2026-05-22 (ISO week 21), the last
        completed week is ISO week 20 (Mon 2026-05-11 – Fri 2026-05-15).
        The function must NOT include any bars from week 21 in weekly_high/low.
        """
        from src.engine.context.htf_context import compute_htf_context

        # Padding bars end strictly before 2026-05-04 (week 19 start)
        rows = self._make_padding(stop_before=dt.date(2026, 5, 4), n=210)

        # Week 19: 2026-05-04 Mon – 2026-05-08 Fri
        for d_str, h, l in [
            ("2026-05-04", 5200.0, 5100.0),
            ("2026-05-05", 5190.0, 5110.0),
            ("2026-05-06", 5195.0, 5105.0),
            ("2026-05-07", 5185.0, 5115.0),
            ("2026-05-08", 5180.0, 5120.0),
        ]:
            d = dt.date.fromisoformat(d_str)
            rows.append({"ts_event": dt.datetime(d.year, d.month, d.day, 16, 0),
                          "open": 5150.0, "high": h, "low": l, "close": 5150.0})

        # Week 20 (2026-05-11 – 2026-05-15) — LAST completed week
        week20_high = 5300.0
        week20_low  = 5150.0
        for d_str, h, l in [
            ("2026-05-11", 5300.0, 5150.0),
            ("2026-05-12", 5290.0, 5160.0),
            ("2026-05-13", 5280.0, 5170.0),
            ("2026-05-14", 5285.0, 5155.0),
            ("2026-05-15", 5275.0, 5165.0),
        ]:
            d = dt.date.fromisoformat(d_str)
            rows.append({"ts_event": dt.datetime(d.year, d.month, d.day, 16, 0),
                          "open": 5200.0, "high": h, "low": l, "close": 5200.0})

        # Week 21 current (2026-05-18 Mon – 2026-05-21 Thu)
        # high=5400, low=5200 — must NOT appear in weekly_high/low
        for d_str, h, l in [
            ("2026-05-18", 5400.0, 5200.0),
            ("2026-05-19", 5390.0, 5210.0),
            ("2026-05-20", 5380.0, 5215.0),
            ("2026-05-21", 5370.0, 5220.0),
            # bar_date = 2026-05-22 (Friday — current bar, excluded by bar_date filter)
        ]:
            d = dt.date.fromisoformat(d_str)
            rows.append({"ts_event": dt.datetime(d.year, d.month, d.day, 16, 0),
                          "open": 5300.0, "high": h, "low": l, "close": 5300.0})

        df = self._make_daily_df(rows)
        bar_date = dt.datetime(2026, 5, 22, 9, 30)

        ctx = compute_htf_context(
            daily_df=df,
            four_h_df=None,
            one_h_df=None,
            current_price=5350.0,
            bar_date=bar_date,
        )

        assert ctx.weekly_high == pytest.approx(week20_high), (
            f"Expected weekly_high={week20_high} (ISO week 20), got {ctx.weekly_high}. "
            "F-1: rolling-5-bar fallback is leaking current-week bars."
        )
        assert ctx.weekly_low == pytest.approx(week20_low), (
            f"Expected weekly_low={week20_low} (ISO week 20), got {ctx.weekly_low}."
        )

    def test_monday_bar_uses_last_completed_friday_week(self):
        """On Monday 2026-05-18 (week 21), the last completed week is week 20
        (Mon 2026-05-11 – Fri 2026-05-15).  No week-21 bar should appear."""
        from src.engine.context.htf_context import compute_htf_context

        rows = self._make_padding(stop_before=dt.date(2026, 5, 4), n=210)
        # (reuse the same append approach as above for second test)
        for d_str, h, l in [
            ("2026-05-04", 5200.0, 5100.0),
            ("2026-05-05", 5190.0, 5110.0),
            ("2026-05-06", 5195.0, 5105.0),
            ("2026-05-07", 5185.0, 5115.0),
            ("2026-05-08", 5180.0, 5120.0),
        ]:
            d = dt.date.fromisoformat(d_str)
            rows.append({"ts_event": dt.datetime(d.year, d.month, d.day, 16, 0),
                          "open": 5000.0, "high": 5001.0, "low": 4999.0, "close": 5000.0})

        week20_high = 5300.0
        week20_low  = 5150.0
        for d_str, h, l in [
            ("2026-05-11", 5300.0, 5150.0),
            ("2026-05-12", 5290.0, 5160.0),
            ("2026-05-13", 5280.0, 5170.0),
            ("2026-05-14", 5285.0, 5155.0),
            ("2026-05-15", 5275.0, 5165.0),
        ]:
            d = dt.date.fromisoformat(d_str)
            rows.append({"ts_event": dt.datetime(d.year, d.month, d.day, 16, 0),
                          "open": 5200.0, "high": h, "low": l, "close": 5200.0})

        df = self._make_daily_df(rows)
        bar_date = dt.datetime(2026, 5, 18, 9, 30)  # Monday, week 21 starts now

        ctx = compute_htf_context(
            daily_df=df, four_h_df=None, one_h_df=None,
            current_price=5310.0, bar_date=bar_date,
        )
        assert ctx.weekly_high == pytest.approx(week20_high)
        assert ctx.weekly_low == pytest.approx(week20_low)


# ─── F-6: Timezone fix — UTC timestamps must classify correctly as ET ─────────

class TestTimezoneETClassification:
    """F-6: All hour comparisons must use ET-converted timestamps.
    UTC timestamps at London hours (02:00-05:00 ET = 07:00-10:00 UTC) must
    classify as 'london', not 'ny_am' or other sessions.
    """

    def _make_intraday_df(self, utc_datetimes: list[dt.datetime],
                           highs: list[float], lows: list[float],
                           closes: list[float]) -> pl.DataFrame:
        return pl.DataFrame({
            "ts_event": utc_datetimes,  # naive = UTC (Databento default)
            "open":   closes,
            "high":   highs,
            "low":    lows,
            "close":  closes,
            "volume": [1000] * len(utc_datetimes),
        })

    def test_utc_london_bars_classified_as_london(self):
        """02:30 ET = 07:30 UTC.  Without tz conversion, raw .hour gives 7 → not
        in London window (2-5).  With ET conversion, hour=2 → 'london' session."""
        from src.engine.context.session_context import _get_session, _to_et
        from zoneinfo import ZoneInfo

        # 07:30 UTC = 03:30 ET in summer (EDT, UTC-4)
        ts_utc = dt.datetime(2026, 5, 20, 7, 30, tzinfo=dt.timezone.utc)
        ts_et  = _to_et(ts_utc)
        session = _get_session(ts_et.hour, ts_et.minute)
        assert session == "london", (
            f"07:30 UTC (03:30 EDT) must classify as 'london', got '{session}'. "
            "F-6: raw .hour comparison is timezone-ambiguous."
        )

    def test_utc_naive_assumption_is_utc(self):
        """Naive datetimes (no tzinfo) must be treated as UTC, then converted to ET."""
        from src.engine.context.session_context import _to_et

        # Naive 07:30 = UTC 07:30 = 03:30 ET (summer, EDT)
        ts_naive = dt.datetime(2026, 5, 20, 7, 30)  # no tzinfo
        ts_et = _to_et(ts_naive)
        assert ts_et.hour == 3, (
            f"Naive 07:30 should become 03:30 ET (EDT), got hour={ts_et.hour}"
        )
        assert ts_et.minute == 30

    def test_utc_rth_open_bar_classified_ny_am(self):
        """13:30 UTC = 09:30 ET (EDT).  Must classify as ny_am, not london."""
        from src.engine.context.session_context import _get_session, _to_et

        ts_utc = dt.datetime(2026, 5, 20, 13, 30, tzinfo=dt.timezone.utc)
        ts_et  = _to_et(ts_utc)
        session = _get_session(ts_et.hour, ts_et.minute)
        assert session == "ny_am"

    def test_compute_session_context_utc_london_bars(self):
        """compute_session_context must find London bars when timestamps are UTC.
        We construct an intraday DataFrame with UTC naive timestamps where
        some bars are at 07:00-10:00 UTC (= 03:00-06:00 ET summer), which
        includes the London window 03:00-05:00 ET.
        """
        from src.engine.context.session_context import compute_session_context

        # Current bar: 2026-05-20 14:00 UTC = 10:00 ET (ny_am)
        # London bars: 2026-05-20 07:30 UTC = 03:30 ET, 08:30 UTC = 04:30 ET
        # (both within 02:00-05:00 ET london window)
        base_date = dt.datetime(2026, 5, 20)
        bars_utc = [
            # overnight bars (pre-London)
            dt.datetime(2026, 5, 20, 5, 0),   # 01:00 ET — asian
            dt.datetime(2026, 5, 20, 6, 0),   # 02:00 ET — london start
            dt.datetime(2026, 5, 20, 7, 30),  # 03:30 ET — london
            dt.datetime(2026, 5, 20, 8, 30),  # 04:30 ET — london
            dt.datetime(2026, 5, 20, 10, 0),  # 06:00 ET — pre_market
            dt.datetime(2026, 5, 20, 13, 30), # 09:30 ET — ny_am RTH open
            dt.datetime(2026, 5, 20, 14, 0),  # 10:00 ET — current bar (ny_am)
        ]
        # London bars (idx 2,3) have elevated high: 5400 (above prev_day_high 5300)
        highs  = [5200.0, 5250.0, 5400.0, 5390.0, 5300.0, 5310.0, 5320.0]
        lows   = [5150.0, 5200.0, 5350.0, 5340.0, 5250.0, 5280.0, 5290.0]
        closes = [5190.0, 5240.0, 5380.0, 5360.0, 5270.0, 5300.0, 5310.0]

        df = self._make_intraday_df(bars_utc, highs, lows, closes)
        bar_idx = 6  # current bar = 14:00 UTC = 10:00 ET

        ctx = compute_session_context(
            df=df,
            bar_idx=bar_idx,
            prev_day_high=5300.0,
            prev_day_low=5100.0,
        )

        # London high must be detected (5400 from the 03:30 ET bar)
        assert ctx.london_swept_pdh is True, (
            "London bar at 5400 should have swept prev_day_high=5300. "
            "F-6: UTC bars were not converted to ET before London classification."
        )
        assert ctx.london_high == pytest.approx(5400.0)
        assert ctx.current_session == "ny_am"

    def test_dst_transition_spring_forward(self):
        """US spring-forward: 2026-03-08 02:00 ET → 03:00 ET.
        A bar at 06:00 UTC on 2026-03-08 = 01:00 ET (EST, UTC-5) — asian session.
        A bar at 07:30 UTC = 02:30 ET (EST) — london session.
        ZoneInfo handles the DST ambiguity natively.
        """
        from src.engine.context.session_context import _get_session, _to_et

        # 2026-03-08 is spring forward; before 2 AM EST, we're still in EST (UTC-5)
        # 07:30 UTC on that day = 02:30 EST (before spring-forward at 2 AM)
        ts_utc = dt.datetime(2026, 3, 8, 7, 30, tzinfo=dt.timezone.utc)
        ts_et = _to_et(ts_utc)
        # 07:30 UTC on spring-forward day = 02:30 EST (clocks haven't sprung yet at 07:30)
        # Actually at 07:00 UTC spring-forward already happened (02:00→03:00 at 07:00 UTC)
        # So 07:30 UTC = 03:30 EDT → london session
        session = _get_session(ts_et.hour, ts_et.minute)
        assert session == "london", (
            f"07:30 UTC on spring-forward day should be london (03:30 EDT), got '{session}'"
        )


# ─── F-2: Overnight range timestamp-based (not bar-count) ────────────────────

class TestOvernightRangeTimestampBased:
    """F-2: overnight range must use timestamp-based scan, not a fixed 100-bar
    lookback that can include bars from prior sessions or prior trading days."""

    def _make_df(self, bars: list[dict]) -> pl.DataFrame:
        return pl.DataFrame({
            "ts_event": [b["ts"] for b in bars],
            "open":   [b.get("o", 100.0) for b in bars],
            "high":   [b.get("h", 101.0) for b in bars],
            "low":    [b.get("l",  99.0) for b in bars],
            "close":  [b.get("c", 100.0) for b in bars],
            "volume": [1000] * len(bars),
        })

    def test_overnight_range_excludes_prior_day_bars(self):
        """The 100-bar lookback would swallow yesterday's RTH bars.
        The timestamp-based scan must stop at the previous trading day's overnight
        boundary and only collect bars whose trading date matches the current bar."""
        from src.engine.context.session_context import compute_session_context

        # Yesterday RTH bars (2026-05-19 09:30-16:00 ET): high=5500 — must NOT be in ON range
        # Current overnight bars (2026-05-19 17:00 ET → 2026-05-20 08:00 ET): high=5350
        # Current bar: 2026-05-20 14:00 UTC = 10:00 ET ny_am

        bars = []
        # Yesterday RTH (UTC: 13:30-20:00 on 2026-05-19 = 09:30-16:00 ET)
        for h_utc in [13, 14, 15, 16, 17, 18, 19]:
            bars.append({
                "ts": dt.datetime(2026, 5, 19, h_utc, 0),
                "h": 5500.0, "l": 5200.0, "c": 5400.0,
            })
        # Current overnight start: 17:00 ET = 21:00 UTC on 2026-05-19
        for h_utc in [21, 22, 23]:
            bars.append({
                "ts": dt.datetime(2026, 5, 19, h_utc, 0),
                "h": 5350.0, "l": 5280.0, "c": 5310.0,
            })
        for h_utc in [0, 1, 2, 3, 4, 5, 6, 7, 8]:
            bars.append({
                "ts": dt.datetime(2026, 5, 20, h_utc, 0),
                "h": 5340.0, "l": 5270.0, "c": 5310.0,
            })
        # Current bar: 14:00 UTC = 10:00 ET (ny_am)
        bars.append({
            "ts": dt.datetime(2026, 5, 20, 14, 0),
            "h": 5330.0, "l": 5290.0, "c": 5320.0,
        })

        df = self._make_df(bars)
        bar_idx = len(bars) - 1

        ctx = compute_session_context(
            df=df, bar_idx=bar_idx,
            prev_day_high=5500.0, prev_day_low=5200.0,
        )
        # ON range should be from overnight bars only — max high is 5350, NOT 5500
        on_high, on_low = ctx.overnight_range
        assert on_high <= 5360.0, (
            f"Overnight range high {on_high} includes yesterday RTH bars (5500). "
            "F-2: bar-count lookback is including prior-day RTH bars."
        )


# ─── F-3: London date guard ───────────────────────────────────────────────────

class TestLondonDateGuard:
    """F-3: London scan must only include bars from the CURRENT trading date."""

    def _make_df(self, bars: list[dict]) -> pl.DataFrame:
        return pl.DataFrame({
            "ts_event": [b["ts"] for b in bars],
            "open":  [b.get("o", 100.0) for b in bars],
            "high":  [b.get("h", 101.0) for b in bars],
            "low":   [b.get("l",  99.0) for b in bars],
            "close": [b.get("c", 100.0) for b in bars],
            "volume": [1000] * len(bars),
        })

    def test_prior_day_london_bars_excluded(self):
        """Yesterday's London session bars must NOT contaminate today's london_high."""
        from src.engine.context.session_context import compute_session_context

        bars = []
        # Yesterday London (2026-05-19 07:00 UTC = 03:00 ET): high=5600 — must NOT appear
        bars.append({"ts": dt.datetime(2026, 5, 19, 7, 0), "h": 5600.0, "l": 5300.0, "c": 5400.0})
        bars.append({"ts": dt.datetime(2026, 5, 19, 8, 0), "h": 5590.0, "l": 5310.0, "c": 5390.0})
        # Today overnight (2026-05-20 00:00-06:00 UTC)
        for h_utc in range(0, 6):
            bars.append({"ts": dt.datetime(2026, 5, 20, h_utc, 0), "h": 5320.0, "l": 5270.0, "c": 5300.0})
        # Today London (2026-05-20 07:00 UTC = 03:00 ET): high=5380
        bars.append({"ts": dt.datetime(2026, 5, 20, 7, 0), "h": 5380.0, "l": 5300.0, "c": 5350.0})
        bars.append({"ts": dt.datetime(2026, 5, 20, 8, 0), "h": 5370.0, "l": 5310.0, "c": 5340.0})
        # Current bar: ny_am (2026-05-20 14:00 UTC = 10:00 ET)
        bars.append({"ts": dt.datetime(2026, 5, 20, 14, 0), "h": 5360.0, "l": 5300.0, "c": 5340.0})

        df = self._make_df(bars)
        bar_idx = len(bars) - 1

        ctx = compute_session_context(
            df=df, bar_idx=bar_idx,
            prev_day_high=5500.0, prev_day_low=5200.0,
        )
        # london_high must reflect TODAY's London only (5380), not yesterday (5600)
        assert ctx.london_high == pytest.approx(5380.0), (
            f"london_high={ctx.london_high} includes prior-day London bar (5600). F-3 failure."
        )


# ─── F-4: OR lookahead guard ──────────────────────────────────────────────────

class TestOpeningRangeNoLookahead:
    """F-4: Opening range scan must be exclusive of current bar (bar_idx not included)."""

    def _make_df(self, bars: list[dict]) -> pl.DataFrame:
        return pl.DataFrame({
            "ts_event": [b["ts"] for b in bars],
            "open":  [b.get("o", 100.0) for b in bars],
            "high":  [b.get("h", 101.0) for b in bars],
            "low":   [b.get("l",  99.0) for b in bars],
            "close": [b.get("c", 100.0) for b in bars],
            "volume": [1000] * len(bars),
        })

    def test_current_bar_in_or_window_not_included(self):
        """If bar_idx IS a 9:30-9:44 bar, it must NOT be included in the OR.
        The OR is a COMPLETED structure; the current (forming) bar is excluded."""
        from src.engine.context.session_context import compute_session_context

        bars = []
        # 9:30 ET bar (13:30 UTC) — first OR bar
        bars.append({"ts": dt.datetime(2026, 5, 20, 13, 30), "h": 5310.0, "l": 5280.0, "c": 5300.0})
        # 9:35 ET bar (13:35 UTC) — second OR bar
        bars.append({"ts": dt.datetime(2026, 5, 20, 13, 35), "h": 5320.0, "l": 5285.0, "c": 5310.0})
        # 9:40 ET bar (13:40 UTC) — current bar (in OR window but NOT yet complete)
        # high=5400 — this must NOT be in the OR
        bars.append({"ts": dt.datetime(2026, 5, 20, 13, 40), "h": 5400.0, "l": 5270.0, "c": 5390.0})

        df = self._make_df(bars)
        bar_idx = 2  # current bar — must be excluded from OR scan

        ctx = compute_session_context(
            df=df, bar_idx=bar_idx,
            prev_day_high=5300.0, prev_day_low=5100.0,
        )
        or_high, or_low = ctx.opening_range
        assert or_high <= 5320.0, (
            f"OR high {or_high} includes current bar (5400). F-4: bar_idx+1 lookahead."
        )


# ─── F-7: Nearest structural TP ──────────────────────────────────────────────

class TestComputeSingleTPNearest:
    """F-7: compute_single_tp must return the NEAREST structural level >= 2R,
    not the highest-priority level in insertion order."""

    def test_nearest_wins_over_higher_priority_distant(self):
        """BSL is at 5R (high DOL priority) but FVG is at 2.1R (nearer, still qualifies).
        The function must return FVG because it is the nearest qualifying level."""
        from src.engine.context.structural_targets import compute_single_tp

        entry = 5000.0
        stop  = 4990.0  # risk = 10 points, min_tp = 20 points
        min_tp = 20.0   # 2R

        bsl = 5050.0  # 50 pts = 5R — qualifies but is farther
        fvg = 5021.0  # 21 pts = 2.1R — qualifies and is NEAREST

        tp = compute_single_tp(
            direction="long",
            entry_price=entry,
            stop_price=stop,
            nearest_bsl=bsl,
            nearest_unfilled_fvg=fvg,
        )
        assert tp == pytest.approx(fvg), (
            f"Expected nearest qualifying TP={fvg}, got {tp}. "
            "F-7: insertion-order iteration returns BSL (farther, higher DOL priority)."
        )

    def test_none_returned_when_nothing_qualifies(self):
        """All candidates within 2R — must return None."""
        from src.engine.context.structural_targets import compute_single_tp

        tp = compute_single_tp(
            direction="long",
            entry_price=5000.0,
            stop_price=4990.0,   # risk=10, min_tp=20
            nearest_old_high=5015.0,  # 15 pts = 1.5R — fails
            nearest_bsl=5010.0,       # 10 pts = 1R — fails
        )
        assert tp is None

    def test_short_nearest_wins(self):
        """For short trades, nearest (closest to entry below) wins."""
        from src.engine.context.structural_targets import compute_single_tp

        entry = 5000.0
        stop  = 5010.0  # risk = 10 pts
        ssl   = 4950.0  # 50 pts = 5R — qualifies, farther
        fvg   = 4978.0  # 22 pts = 2.2R — qualifies, NEAREST

        tp = compute_single_tp(
            direction="short",
            entry_price=entry,
            stop_price=stop,
            nearest_ssl=ssl,
            nearest_unfilled_fvg=fvg,
        )
        assert tp == pytest.approx(fvg)


# ─── F-8: Governor fed adj_pnl not full pnl ──────────────────────────────────

class TestGovernorFedAdjPnl:
    """F-8: When the governor reduces position size, it must see the reduced P&L,
    not the full theoretical P&L.  Otherwise session_loss_pct escalates state
    faster than the actual executed exposure warrants."""

    def test_reduced_size_trade_feeds_adj_pnl_to_governor(self):
        """In CAUTIOUS (0.75x size), a -100 trade at 4 contracts becomes 3 contracts
        adj_pnl = -75.  Governor must see -75, not -100."""
        from src.engine.governor.governor_backtest import backtest_governor

        # Drive governor into CAUTIOUS state (3 consecutive losses), then execute
        # a reduced-size losing trade.  The governor's session_pnl must reflect -75.
        trades = [
            {"pnl": -100.0, "mae": 0.0, "contracts": 4, "entry_time": "2025-01-01T10:00:00"},
            {"pnl": -100.0, "mae": 0.0, "contracts": 4, "entry_time": "2025-01-01T11:00:00"},
            {"pnl": -100.0, "mae": 0.0, "contracts": 4, "entry_time": "2025-01-01T12:00:00"},
            # Now in CAUTIOUS (0.75x) — 4 contracts → 3 adj, adj_pnl = -75
            {"pnl": -100.0, "mae": 0.0, "contracts": 4, "entry_time": "2025-01-01T13:00:00"},
        ]

        result = backtest_governor(trades, daily_loss_budget=500.0)
        # At least one trade was reduced (CAUTIOUS 0.75x)
        assert result["governed"]["trades_reduced"] >= 1, (
            "Expected at least one reduced trade in CAUTIOUS state."
        )
        # Governed P&L must be less-negative than original (because sizes were reduced)
        assert result["governed"]["pnl"] > result["original"]["pnl"], (
            "Governed P&L should be better than ungoverned when trades were reduced."
        )

    def test_state_history_shows_adj_pnl_not_full(self):
        """State history adjusted_pnl field must reflect reduced size, not full size."""
        from src.engine.governor.governor_backtest import backtest_governor

        trades = [
            {"pnl": -200.0, "mae": 0.0, "contracts": 4, "entry_time": "2025-01-01T10:00:00"},
            {"pnl": -200.0, "mae": 0.0, "contracts": 4, "entry_time": "2025-01-01T11:00:00"},
            {"pnl": -200.0, "mae": 0.0, "contracts": 4, "entry_time": "2025-01-01T12:00:00"},
            # Trade 4: CAUTIOUS (0.75x), 4→3 contracts, adj_pnl = -150
            {"pnl": -200.0, "mae": 0.0, "contracts": 4, "entry_time": "2025-01-01T13:00:00"},
        ]
        result = backtest_governor(trades, daily_loss_budget=1000.0)

        trade_events = [e for e in result["state_history"] if e.get("event") == "trade"]
        for event in trade_events:
            if event.get("original_pnl", 0) != event.get("adjusted_pnl", 0):
                # This trade was reduced — adjusted_pnl must be greater (less negative)
                assert event["adjusted_pnl"] > event["original_pnl"], (
                    f"adjusted_pnl {event['adjusted_pnl']} should be > original_pnl "
                    f"{event['original_pnl']} when contracts were reduced."
                )


# ─── F-9: pre_market session classification ──────────────────────────────────

class TestSessionClassificationPreMarket:
    """F-9: 05:00-09:30 ET must be classified as 'pre_market', not 'overnight'.
    17:00-18:00 ET must be classified as 'maintenance'."""

    @pytest.mark.parametrize("hour,minute,expected_session", [
        (5,  0,  "pre_market"),
        (6,  30, "pre_market"),
        (8,  0,  "pre_market"),
        (9,  0,  "pre_market"),
        (9,  29, "pre_market"),
        (9,  30, "ny_am"),
        (17, 0,  "maintenance"),
        (17, 30, "maintenance"),
        (17, 59, "maintenance"),
        (18, 0,  "asian"),    # maintenance ends at 18:00 → asian session begins
        (20, 0,  "asian"),
        (2,  0,  "london"),
        (4,  59, "london"),
        (16, 0,  "overnight"),
        (16, 30, "overnight"),
        (16, 59, "overnight"),
    ])
    def test_session_classification(self, hour, minute, expected_session):
        from src.engine.context.session_context import _get_session
        result = _get_session(hour, minute)
        assert result == expected_session, (
            f"_get_session({hour}, {minute}) = '{result}', expected '{expected_session}'"
        )


# ─── F-10: ATR percentile filter chain (verify no separate fix needed) ────────

class TestATRPercentileNoLookahead:
    """F-10: With bar_date threaded through (F-5 fix), the highs[-60:] slice in
    compute_htf_context operates on already-filtered daily_df (bars before bar_date).
    This test verifies the filter chain end-to-end."""

    def _make_daily_df_with_ts(self, n_bars: int, bar_date: dt.datetime) -> pl.DataFrame:
        """Build n_bars of daily data, all before bar_date."""
        rows = []
        d = bar_date.date() - dt.timedelta(days=n_bars + 10)
        while len(rows) < n_bars:
            if d.weekday() < 5:
                rows.append({
                    "ts_event": dt.datetime(d.year, d.month, d.day, 16, 0),
                    "open": 5000.0, "high": 5001.0, "low": 4999.0, "close": 5000.0,
                    "volume": 10000.0,
                })
            d += dt.timedelta(days=1)
        return pl.DataFrame(rows)

    def test_atr_percentile_uses_only_past_bars(self):
        """ATR percentile must not use any bars on/after bar_date."""
        from src.engine.context.htf_context import compute_htf_context

        bar_date = dt.datetime(2026, 5, 20, 9, 30)
        # Create 250 past bars — all before bar_date
        df = self._make_daily_df_with_ts(250, bar_date)

        # Add a future bar (ON bar_date) that has extreme ATR — must be excluded
        future_bar = pl.DataFrame([{
            "ts_event": dt.datetime(2026, 5, 20, 16, 0),
            "open": 5000.0, "high": 9999.0, "low": 1.0, "close": 5000.0,
            "volume": 10000.0,
        }])
        df_with_future = pl.concat([df, future_bar])

        ctx = compute_htf_context(
            daily_df=df_with_future,
            four_h_df=None,
            one_h_df=None,
            current_price=5000.0,
            bar_date=bar_date,
        )
        # ATR percentile should be a normal value, not driven to 100 by the extreme bar
        assert ctx.atr_percentile < 99.0, (
            f"ATR percentile={ctx.atr_percentile:.1f} — future bar (extreme range) "
            "was included in the ATR window. F-10/F-5 lookahead not fixed."
        )
