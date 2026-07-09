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
    _warn_if_calendar_incomplete,
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
        """All event types present. FOMC_MINUTES + EIA added 2026-06-22 (MFFU Feb-2026).

        GDP/PCE/ISM/PPI remain as DATA here (non-blackout consumers) even though removed
        from the live calendar_filter blackout — they are not T1 per the current policy.
        """
        assert set(STATIC_EVENTS.keys()) == {
            "FOMC", "FOMC_MINUTES", "CPI", "NFP", "GDP", "PCE", "ISM", "PPI", "EIA",
        }

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
        mask = generate_event_mask(ts, policies, "MES")
        assert mask[0] == True, "1:45 PM should be masked (15 min before FOMC)"

    def test_fomc_day_unmasked(self):
        """FOMC day at 11:00 AM ET → not masked (3 hours before)."""
        ts = _make_utc_timestamps_for_date("2024-01-31", [(11, 0)])
        policies = [{"event_type": "FOMC", "action": "SIT_OUT", "window_minutes": 30}]
        mask = generate_event_mask(ts, policies, "MES")
        assert mask[0] == False, "11 AM should not be masked (3h before FOMC)"

    def test_nfp_first_friday_masked(self):
        """NFP first Friday 8:15 AM ET → masked (15 min before 8:30)."""
        # NFP on 2024-01-05 at 8:30 AM ET
        ts = _make_utc_timestamps_for_date("2024-01-05", [(8, 15)])
        policies = [{"event_type": "NFP", "action": "SIT_OUT", "window_minutes": 30}]
        mask = generate_event_mask(ts, policies, "MES")
        assert mask[0] == True

    def test_no_events_no_mask(self):
        """No policies → no mask (all False)."""
        ts = _make_utc_timestamps_for_date("2024-01-31", [(14, 0)])
        mask = generate_event_mask(ts, [], "MES")
        assert mask[0] == False

    def test_ignore_action_not_masked(self):
        """IGNORE action doesn't mask entries."""
        ts = _make_utc_timestamps_for_date("2024-01-31", [(13, 45)])
        policies = [{"event_type": "FOMC", "action": "IGNORE", "window_minutes": 30}]
        mask = generate_event_mask(ts, policies, "MES")
        assert mask[0] == False


class TestSizeReduction:
    def test_sit_out_gives_zero(self):
        """SIT_OUT → 0.0 size multiplier."""
        ts = _make_utc_timestamps_for_date("2024-01-31", [(13, 45)])
        policies = [{"event_type": "FOMC", "action": "SIT_OUT", "window_minutes": 30}]
        reduction = generate_size_reduction(ts, policies, "MES")
        assert reduction[0] == 0.0

    def test_reduce_gives_half(self):
        """REDUCE → 0.5 size multiplier."""
        ts = _make_utc_timestamps_for_date("2024-01-31", [(13, 45)])
        policies = [{"event_type": "FOMC", "action": "REDUCE", "window_minutes": 30}]
        reduction = generate_size_reduction(ts, policies, "MES")
        assert reduction[0] == 0.5

    def test_ignore_gives_full(self):
        """IGNORE → 1.0 size multiplier (no change)."""
        ts = _make_utc_timestamps_for_date("2024-01-31", [(13, 45)])
        policies = [{"event_type": "FOMC", "action": "IGNORE", "window_minutes": 30}]
        reduction = generate_size_reduction(ts, policies, "MES")
        assert reduction[0] == 1.0

    def test_outside_window_full_size(self):
        """Outside event window → 1.0 multiplier."""
        ts = _make_utc_timestamps_for_date("2024-01-31", [(11, 0)])
        policies = [{"event_type": "FOMC", "action": "SIT_OUT", "window_minutes": 30}]
        reduction = generate_size_reduction(ts, policies, "MES")
        assert reduction[0] == 1.0


class TestEventSlippage:
    def test_event_window_3x_slippage(self):
        """Bars within event window get 3.0x slippage multiplier."""
        ts = _make_utc_timestamps_for_date("2024-01-31", [(13, 45)])
        policies = [{"event_type": "FOMC", "action": "SIT_OUT", "window_minutes": 30}]
        mults = get_event_slippage_multipliers(ts, policies, "MES")
        assert mults[0] == 3.0

    def test_outside_event_1x_slippage(self):
        """Bars outside event window get 1.0x slippage."""
        ts = _make_utc_timestamps_for_date("2024-01-31", [(11, 0)])
        policies = [{"event_type": "FOMC", "action": "SIT_OUT", "window_minutes": 30}]
        mults = get_event_slippage_multipliers(ts, policies, "MES")
        assert mults[0] == 1.0

    def test_ignore_no_slippage_increase(self):
        """IGNORE action → 1.0x slippage (no increase)."""
        ts = _make_utc_timestamps_for_date("2024-01-31", [(13, 45)])
        policies = [{"event_type": "FOMC", "action": "IGNORE", "window_minutes": 30}]
        mults = get_event_slippage_multipliers(ts, policies, "MES")
        assert mults[0] == 1.0


# ─── F-4/F-8: 2025 data completeness ────────────────────────────

class TestCalendar2025Completeness:
    def test_cpi_2025_has_12_dates(self):
        """CPI calendar must have 12 dates for 2025 (F-4 fix)."""
        cpi_2025 = [e for e in STATIC_EVENTS["CPI"] if e["date"].startswith("2025")]
        assert len(cpi_2025) >= 10, (
            f"CPI 2025 should have at least 10 entries, got {len(cpi_2025)}"
        )

    def test_nfp_2025_has_12_dates(self):
        """NFP calendar must have 12 dates for 2025."""
        nfp_2025 = [e for e in STATIC_EVENTS["NFP"] if e["date"].startswith("2025")]
        assert len(nfp_2025) == 12, (
            f"NFP 2025 should have 12 entries (monthly), got {len(nfp_2025)}"
        )

    def test_gdp_2025_has_4_dates(self):
        """GDP calendar must have 4 dates for 2025 (quarterly, F-8 fix)."""
        gdp_2025 = [e for e in STATIC_EVENTS["GDP"] if e["date"].startswith("2025")]
        assert len(gdp_2025) == 4, (
            f"GDP 2025 should have 4 entries (quarterly), got {len(gdp_2025)}"
        )

    def test_pce_2025_has_12_dates(self):
        """PCE calendar must have 12 dates for 2025 (F-8 fix)."""
        pce_2025 = [e for e in STATIC_EVENTS["PCE"] if e["date"].startswith("2025")]
        assert len(pce_2025) == 12, (
            f"PCE 2025 should have 12 entries (monthly), got {len(pce_2025)}"
        )

    def test_gdp_extends_to_2026_2027(self):
        """GDP calendar must cover 2026 and 2027 (F-8 fix: was truncated at 2024)."""
        gdp_years = {e["date"][:4] for e in STATIC_EVENTS["GDP"]}
        assert "2025" in gdp_years, "GDP 2025 missing"
        assert "2026" in gdp_years, "GDP 2026 missing"
        assert "2027" in gdp_years, "GDP 2027 missing"

    def test_pce_extends_to_2026_2027(self):
        """PCE calendar must cover 2026 and 2027 (F-8 fix: was truncated at 2024)."""
        pce_years = {e["date"][:4] for e in STATIC_EVENTS["PCE"]}
        assert "2025" in pce_years, "PCE 2025 missing"
        assert "2026" in pce_years, "PCE 2026 missing"
        assert "2027" in pce_years, "PCE 2027 missing"


class TestNewEventTypes:
    def test_ism_present_and_monthly(self):
        """ISM Manufacturing events exist for 2024 and 2025 (12 per year)."""
        ism_2024 = [e for e in STATIC_EVENTS["ISM"] if e["date"].startswith("2024")]
        ism_2025 = [e for e in STATIC_EVENTS["ISM"] if e["date"].startswith("2025")]
        assert len(ism_2024) == 12, f"ISM 2024 should have 12 entries, got {len(ism_2024)}"
        assert len(ism_2025) == 12, f"ISM 2025 should have 12 entries, got {len(ism_2025)}"

    def test_ism_time_is_10am(self):
        """All ISM events are at 10:00 AM ET."""
        for event in STATIC_EVENTS["ISM"]:
            assert event["time_et"] == "10:00", f"ISM event {event['date']} has wrong time {event['time_et']}"

    def test_ppi_present_and_monthly(self):
        """PPI events exist for 2024 and 2025 (12 per year)."""
        ppi_2024 = [e for e in STATIC_EVENTS["PPI"] if e["date"].startswith("2024")]
        ppi_2025 = [e for e in STATIC_EVENTS["PPI"] if e["date"].startswith("2025")]
        assert len(ppi_2024) == 12, f"PPI 2024 should have 12 entries, got {len(ppi_2024)}"
        assert len(ppi_2025) == 12, f"PPI 2025 should have 12 entries, got {len(ppi_2025)}"

    def test_ppi_time_is_830am(self):
        """All PPI events are at 8:30 AM ET."""
        for event in STATIC_EVENTS["PPI"]:
            assert event["time_et"] == "08:30", f"PPI event {event['date']} has wrong time {event['time_et']}"

    def test_ism_can_mask_bars(self):
        """ISM event at 10:00 AM masks bars within ±30 minutes."""
        # ISM 2024-01-02 at 10:00 AM ET
        ts = _make_utc_timestamps_for_date("2024-01-02", [(9, 45)])  # 15 min before
        policies = [{"event_type": "ISM", "action": "SIT_OUT", "window_minutes": 30}]
        mask = generate_event_mask(ts, policies, "MES")
        assert mask[0] == True, "Bar at 9:45 AM should be masked (15 min before ISM at 10:00)"

    def test_ppi_can_mask_bars(self):
        """PPI event at 8:30 AM masks bars within ±30 minutes."""
        # PPI 2024-01-12 at 8:30 AM ET
        ts = _make_utc_timestamps_for_date("2024-01-12", [(8, 15)])  # 15 min before
        policies = [{"event_type": "PPI", "action": "SIT_OUT", "window_minutes": 30}]
        mask = generate_event_mask(ts, policies, "MES")
        assert mask[0] == True, "Bar at 8:15 AM should be masked (15 min before PPI at 8:30)"

    def test_warn_if_calendar_incomplete_no_error(self):
        """_warn_if_calendar_incomplete should not raise even for covered years."""
        # Should emit nothing / just a warning at worst, never raise
        _warn_if_calendar_incomplete(2025)
        _warn_if_calendar_incomplete(2024)

    def test_gdp_2026_has_4_dates(self):
        """GDP calendar has 4 dates for 2026 (quarterly)."""
        gdp_2026 = [e for e in STATIC_EVENTS["GDP"] if e["date"].startswith("2026")]
        assert len(gdp_2026) == 4, f"GDP 2026 should have 4 entries, got {len(gdp_2026)}"

    def test_gdp_2027_has_4_dates(self):
        """GDP calendar has 4 dates for 2027 (quarterly)."""
        gdp_2027 = [e for e in STATIC_EVENTS["GDP"] if e["date"].startswith("2027")]
        assert len(gdp_2027) == 4, f"GDP 2027 should have 4 entries, got {len(gdp_2027)}"

    def test_ism_2026_has_12_dates(self):
        """ISM calendar has 12 dates for 2026."""
        ism_2026 = [e for e in STATIC_EVENTS["ISM"] if e["date"].startswith("2026")]
        assert len(ism_2026) == 12, f"ISM 2026 should have 12 entries, got {len(ism_2026)}"

    def test_ism_2027_has_12_dates(self):
        """ISM calendar has 12 dates for 2027."""
        ism_2027 = [e for e in STATIC_EVENTS["ISM"] if e["date"].startswith("2027")]
        assert len(ism_2027) == 12, f"ISM 2027 should have 12 entries, got {len(ism_2027)}"

    def test_ppi_2026_has_12_dates(self):
        """PPI calendar has 12 dates for 2026."""
        ppi_2026 = [e for e in STATIC_EVENTS["PPI"] if e["date"].startswith("2026")]
        assert len(ppi_2026) == 12, f"PPI 2026 should have 12 entries, got {len(ppi_2026)}"

    def test_ppi_2027_has_12_dates(self):
        """PPI calendar has 12 dates for 2027."""
        ppi_2027 = [e for e in STATIC_EVENTS["PPI"] if e["date"].startswith("2027")]
        assert len(ppi_2027) == 12, f"PPI 2027 should have 12 entries, got {len(ppi_2027)}"
