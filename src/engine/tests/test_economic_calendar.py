"""Tests for economic calendar filter (Task 3.8)."""

from datetime import datetime, timedelta

import numpy as np
import polars as pl
import pytest

from src.engine.economic_calendar import (
    STATIC_EVENTS,
    generate_event_mask,
    generate_size_reduction,
    get_event_slippage_multipliers,
)


def _make_utc_timestamps_for_date(
    date_str: str,
    et_hours: list[tuple[int, int]],
) -> pl.Series:
    """Create UTC timestamps from ET times on a specific date.

    ET = UTC - 5, so UTC = ET + 5.
    """
    base = datetime.strptime(date_str, "%Y-%m-%d")
    timestamps = []
    for h, m in et_hours:
        et_dt = base.replace(hour=h, minute=m)
        utc_dt = et_dt + timedelta(hours=5)
        timestamps.append(utc_dt)
    return pl.Series("ts_event", timestamps)


class TestStaticCalendar:
    def test_fomc_2024_has_8_dates(self):
        """Static calendar has all 8 FOMC dates for 2024."""
        fomc_dates = [e["date"] for e in STATIC_EVENTS["FOMC"]]
        fomc_2024 = [d for d in fomc_dates if d.startswith("2024")]
        assert len(fomc_2024) == 8

    def test_all_event_types_present(self):
        """All 5 event types are in the static calendar."""
        assert set(STATIC_EVENTS.keys()) == {"FOMC", "CPI", "NFP", "GDP", "PCE"}

    def test_fomc_always_at_2pm(self):
        """All FOMC events are at 2:00 PM ET."""
        for event in STATIC_EVENTS["FOMC"]:
            assert event["time_et"] == "14:00"

    def test_nfp_always_at_830am(self):
        """All NFP events are at 8:30 AM ET."""
        for event in STATIC_EVENTS["NFP"]:
            assert event["time_et"] == "08:30"


class TestEventMask:
    def test_fomc_day_masked(self):
        """FOMC day at 1:45 PM ET → masked (within 30 min of 2 PM)."""
        # FOMC on 2024-01-31 at 2:00 PM ET
        ts = _make_utc_timestamps_for_date("2024-01-31", [(13, 45)])
        policies = [{"event_type": "FOMC", "action": "SIT_OUT", "window_minutes": 30}]
        mask = generate_event_mask(ts, policies)
        assert mask[0] == True, "1:45 PM should be masked (15 min before FOMC)"

    def test_fomc_day_unmasked(self):
        """FOMC day at 11:00 AM ET → not masked (3 hours before)."""
        ts = _make_utc_timestamps_for_date("2024-01-31", [(11, 0)])
        policies = [{"event_type": "FOMC", "action": "SIT_OUT", "window_minutes": 30}]
        mask = generate_event_mask(ts, policies)
        assert mask[0] == False, "11 AM should not be masked (3h before FOMC)"

    def test_nfp_first_friday_masked(self):
        """NFP first Friday 8:15 AM ET → masked (15 min before 8:30)."""
        # NFP on 2024-01-05 at 8:30 AM ET
        ts = _make_utc_timestamps_for_date("2024-01-05", [(8, 15)])
        policies = [{"event_type": "NFP", "action": "SIT_OUT", "window_minutes": 30}]
        mask = generate_event_mask(ts, policies)
        assert mask[0] == True

    def test_no_events_no_mask(self):
        """No policies → no mask (all False)."""
        ts = _make_utc_timestamps_for_date("2024-01-31", [(14, 0)])
        mask = generate_event_mask(ts, [])
        assert mask[0] == False

    def test_ignore_action_not_masked(self):
        """IGNORE action doesn't mask entries."""
        ts = _make_utc_timestamps_for_date("2024-01-31", [(13, 45)])
        policies = [{"event_type": "FOMC", "action": "IGNORE", "window_minutes": 30}]
        mask = generate_event_mask(ts, policies)
        assert mask[0] == False


class TestSizeReduction:
    def test_sit_out_gives_zero(self):
        """SIT_OUT → 0.0 size multiplier."""
        ts = _make_utc_timestamps_for_date("2024-01-31", [(13, 45)])
        policies = [{"event_type": "FOMC", "action": "SIT_OUT", "window_minutes": 30}]
        reduction = generate_size_reduction(ts, policies)
        assert reduction[0] == 0.0

    def test_reduce_gives_half(self):
        """REDUCE → 0.5 size multiplier."""
        ts = _make_utc_timestamps_for_date("2024-01-31", [(13, 45)])
        policies = [{"event_type": "FOMC", "action": "REDUCE", "window_minutes": 30}]
        reduction = generate_size_reduction(ts, policies)
        assert reduction[0] == 0.5

    def test_ignore_gives_full(self):
        """IGNORE → 1.0 size multiplier (no change)."""
        ts = _make_utc_timestamps_for_date("2024-01-31", [(13, 45)])
        policies = [{"event_type": "FOMC", "action": "IGNORE", "window_minutes": 30}]
        reduction = generate_size_reduction(ts, policies)
        assert reduction[0] == 1.0

    def test_outside_window_full_size(self):
        """Outside event window → 1.0 multiplier."""
        ts = _make_utc_timestamps_for_date("2024-01-31", [(11, 0)])
        policies = [{"event_type": "FOMC", "action": "SIT_OUT", "window_minutes": 30}]
        reduction = generate_size_reduction(ts, policies)
        assert reduction[0] == 1.0


class TestEventSlippage:
    def test_event_window_3x_slippage(self):
        """Bars within event window get 3.0x slippage multiplier."""
        ts = _make_utc_timestamps_for_date("2024-01-31", [(13, 45)])
        policies = [{"event_type": "FOMC", "action": "SIT_OUT", "window_minutes": 30}]
        mults = get_event_slippage_multipliers(ts, policies)
        assert mults[0] == 3.0

    def test_outside_event_1x_slippage(self):
        """Bars outside event window get 1.0x slippage."""
        ts = _make_utc_timestamps_for_date("2024-01-31", [(11, 0)])
        policies = [{"event_type": "FOMC", "action": "SIT_OUT", "window_minutes": 30}]
        mults = get_event_slippage_multipliers(ts, policies)
        assert mults[0] == 1.0

    def test_ignore_no_slippage_increase(self):
        """IGNORE action → 1.0x slippage (no increase)."""
        ts = _make_utc_timestamps_for_date("2024-01-31", [(13, 45)])
        policies = [{"event_type": "FOMC", "action": "IGNORE", "window_minutes": 30}]
        mults = get_event_slippage_multipliers(ts, policies)
        assert mults[0] == 1.0
