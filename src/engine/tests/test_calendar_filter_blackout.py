"""Tests for calendar_filter.py MFFU §5 macro-blackout extension.

Wave hardening 2026-06-22 — GDP/ISM/PPI added to live blackout.

Verifies:
  1. check_economic_event() blocks inside GDP (08:30), ISM (10:00), PPI (08:30).
  2. check_economic_event() does NOT block outside those windows.
  3. The _ECONOMIC_EVENTS list now contains GDP/ISM/PPI entries for 2026-2027.
  4. Parity between calendar_filter._ECONOMIC_EVENTS and
     economic_calendar.STATIC_EVENTS for the 3 new event types.

Note: bare import of the full backtester (vectorbt) HANGS pytest collection
on the tower.  This module only imports calendar_filter and economic_calendar —
both are pure datetime / dict logic with no vectorbt dependency.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

# Import ONLY the pure-datetime modules — no vectorbt path.
from src.engine.skip_engine.calendar_filter import (
    _ECONOMIC_EVENTS,
    check_economic_event,
    EVENT_BLACKOUT_MINUTES,
)
from src.engine.economic_calendar import STATIC_EVENTS


# ─── Helper: build a UTC datetime from an ET time string ─────────────────────

def _et_to_utc(date_str: str, time_et_str: str, dst: bool) -> datetime:
    """Build UTC-aware datetime from date + ET wall-clock time.

    dst=True → EDT (UTC-4), dst=False → EST (UTC-5).
    """
    h, m = map(int, time_et_str.split(":"))
    offset_hours = 4 if dst else 5
    base = datetime.strptime(date_str, "%Y-%m-%d")
    et_dt = base.replace(hour=h, minute=m)
    return (et_dt + timedelta(hours=offset_hours)).replace(tzinfo=timezone.utc)


# ─── GDP blackout (08:30 ET, quarterly) ──────────────────────────────────────

class TestGDPBlackout:
    """GDP 2026-01-29 at 08:30 ET (winter = EST = UTC-5)."""

    GDP_DATE = "2026-01-29"
    GDP_ET   = "08:30"
    DST      = False  # January = EST

    def _bar_at_et(self, h: int, m: int) -> datetime:
        base = datetime.strptime(self.GDP_DATE, "%Y-%m-%d")
        et_dt = base.replace(hour=h, minute=m)
        return (et_dt + timedelta(hours=5)).replace(tzinfo=timezone.utc)

    def test_inside_window_at_event_time(self):
        """Bar at 08:30 ET (exactly at GDP) → blocked (distance=0 ≤ 30)."""
        bar = self._bar_at_et(8, 30)
        blocked, name, window = check_economic_event(bar)
        assert blocked is True, f"GDP event window should block at t=0, got blocked={blocked}"
        assert name == "GDP"
        assert window == EVENT_BLACKOUT_MINUTES

    def test_inside_window_before(self):
        """Bar at 08:10 ET (20 min before GDP 08:30) → blocked."""
        bar = self._bar_at_et(8, 10)
        blocked, name, _ = check_economic_event(bar)
        assert blocked is True, "20 min before GDP should be inside ±30 min window"
        assert name == "GDP"

    def test_inside_window_after(self):
        """Bar at 08:55 ET (25 min after GDP 08:30) → blocked."""
        bar = self._bar_at_et(8, 55)
        blocked, name, _ = check_economic_event(bar)
        assert blocked is True, "25 min after GDP should be inside ±30 min window"
        assert name == "GDP"

    def test_outside_window_before(self):
        """Bar at 07:45 ET (45 min before GDP 08:30) → NOT blocked."""
        bar = self._bar_at_et(7, 45)
        blocked, name, _ = check_economic_event(bar)
        assert blocked is False, "45 min before GDP should be outside ±30 min window"

    def test_outside_window_after(self):
        """Bar at 09:05 ET (35 min after GDP 08:30) → NOT blocked."""
        bar = self._bar_at_et(9, 5)
        blocked, name, _ = check_economic_event(bar)
        assert blocked is False, "35 min after GDP should be outside ±30 min window"

    def test_exact_boundary_minus_30(self):
        """Bar at exactly 08:00 ET (−30 min from GDP 08:30) → blocked (≤ 30)."""
        bar = self._bar_at_et(8, 0)
        blocked, _, _ = check_economic_event(bar)
        assert blocked is True, "At −30 min boundary, |delta|=30 ≤ 30 should block"

    def test_exact_boundary_plus_30(self):
        """Bar at exactly 09:00 ET (+30 min from GDP 08:30) → blocked (≤ 30)."""
        bar = self._bar_at_et(9, 0)
        blocked, _, _ = check_economic_event(bar)
        assert blocked is True, "At +30 min boundary, |delta|=30 ≤ 30 should block"


# ─── ISM blackout (10:00 ET, monthly) ────────────────────────────────────────

class TestISMBlackout:
    """ISM 2026-02-02 at 10:00 ET (winter = EST = UTC-5)."""

    ISM_DATE = "2026-02-02"
    ISM_ET   = "10:00"
    DST      = False

    def _bar_at_et(self, h: int, m: int) -> datetime:
        base = datetime.strptime(self.ISM_DATE, "%Y-%m-%d")
        et_dt = base.replace(hour=h, minute=m)
        return (et_dt + timedelta(hours=5)).replace(tzinfo=timezone.utc)

    def test_inside_window_at_event_time(self):
        """Bar at 10:00 ET → blocked."""
        bar = self._bar_at_et(10, 0)
        blocked, name, _ = check_economic_event(bar)
        assert blocked is True
        assert name == "ISM"

    def test_inside_window_before(self):
        """Bar at 09:45 ET (15 min before ISM 10:00) → blocked."""
        bar = self._bar_at_et(9, 45)
        blocked, name, _ = check_economic_event(bar)
        assert blocked is True
        assert name == "ISM"

    def test_inside_window_after(self):
        """Bar at 10:20 ET (20 min after ISM 10:00) → blocked."""
        bar = self._bar_at_et(10, 20)
        blocked, name, _ = check_economic_event(bar)
        assert blocked is True
        assert name == "ISM"

    def test_outside_window_before(self):
        """Bar at 09:25 ET (35 min before ISM 10:00) → NOT blocked."""
        bar = self._bar_at_et(9, 25)
        blocked, _, _ = check_economic_event(bar)
        assert blocked is False

    def test_outside_window_after(self):
        """Bar at 10:35 ET (35 min after ISM 10:00) → NOT blocked."""
        bar = self._bar_at_et(10, 35)
        blocked, _, _ = check_economic_event(bar)
        assert blocked is False


# ─── PPI blackout (08:30 ET, monthly) ────────────────────────────────────────

class TestPPIBlackout:
    """PPI 2026-01-15 at 08:30 ET (winter = EST = UTC-5)."""

    PPI_DATE = "2026-01-15"
    PPI_ET   = "08:30"
    DST      = False

    def _bar_at_et(self, h: int, m: int) -> datetime:
        base = datetime.strptime(self.PPI_DATE, "%Y-%m-%d")
        et_dt = base.replace(hour=h, minute=m)
        return (et_dt + timedelta(hours=5)).replace(tzinfo=timezone.utc)

    def test_inside_window_at_event_time(self):
        """Bar at 08:30 ET → blocked."""
        bar = self._bar_at_et(8, 30)
        blocked, name, _ = check_economic_event(bar)
        assert blocked is True
        assert name == "PPI"

    def test_inside_window_before(self):
        """Bar at 08:15 ET (15 min before PPI 08:30) → blocked."""
        bar = self._bar_at_et(8, 15)
        blocked, name, _ = check_economic_event(bar)
        assert blocked is True
        assert name == "PPI"

    def test_outside_window(self):
        """Bar at 07:55 ET (35 min before PPI 08:30) → NOT blocked."""
        bar = self._bar_at_et(7, 55)
        blocked, _, _ = check_economic_event(bar)
        assert blocked is False

    def test_ppi_summer_edt(self):
        """PPI 2026-06-11 at 08:30 EDT (summer = EDT = UTC-4) → blocked."""
        # June: EDT, UTC offset = -4
        base = datetime.strptime("2026-06-11", "%Y-%m-%d")
        et_dt = base.replace(hour=8, minute=30)
        bar = (et_dt + timedelta(hours=4)).replace(tzinfo=timezone.utc)
        blocked, name, _ = check_economic_event(bar)
        assert blocked is True, "PPI in EDT should still be blocked at event time"
        assert name == "PPI"


# ─── _ECONOMIC_EVENTS list coverage checks ───────────────────────────────────

class TestEconomicEventsListCoverage:
    """_ECONOMIC_EVENTS (the live blackout list) now contains GDP/ISM/PPI."""

    def test_gdp_present_in_event_list_2026(self):
        """GDP 2026 entries are in _ECONOMIC_EVENTS after wave-hardening extension."""
        gdp_dates = {ev[0] for ev in _ECONOMIC_EVENTS if ev[2] == "GDP" and ev[0].startswith("2026")}
        assert len(gdp_dates) == 4, f"Expected 4 GDP 2026 dates, got {len(gdp_dates)}: {gdp_dates}"

    def test_gdp_present_in_event_list_2027(self):
        """GDP 2027 entries are in _ECONOMIC_EVENTS."""
        gdp_dates = {ev[0] for ev in _ECONOMIC_EVENTS if ev[2] == "GDP" and ev[0].startswith("2027")}
        assert len(gdp_dates) == 4, f"Expected 4 GDP 2027 dates, got {len(gdp_dates)}: {gdp_dates}"

    def test_ism_present_in_event_list_2026(self):
        """ISM 2026 entries (12) are in _ECONOMIC_EVENTS."""
        ism_dates = {ev[0] for ev in _ECONOMIC_EVENTS if ev[2] == "ISM" and ev[0].startswith("2026")}
        assert len(ism_dates) == 12, f"Expected 12 ISM 2026 dates, got {len(ism_dates)}"

    def test_ism_present_in_event_list_2027(self):
        """ISM 2027 entries (12) are in _ECONOMIC_EVENTS."""
        ism_dates = {ev[0] for ev in _ECONOMIC_EVENTS if ev[2] == "ISM" and ev[0].startswith("2027")}
        assert len(ism_dates) == 12, f"Expected 12 ISM 2027 dates, got {len(ism_dates)}"

    def test_ppi_present_in_event_list_2026(self):
        """PPI 2026 entries (12) are in _ECONOMIC_EVENTS."""
        ppi_dates = {ev[0] for ev in _ECONOMIC_EVENTS if ev[2] == "PPI" and ev[0].startswith("2026")}
        assert len(ppi_dates) == 12, f"Expected 12 PPI 2026 dates, got {len(ppi_dates)}"

    def test_ppi_present_in_event_list_2027(self):
        """PPI 2027 entries (12) are in _ECONOMIC_EVENTS."""
        ppi_dates = {ev[0] for ev in _ECONOMIC_EVENTS if ev[2] == "PPI" and ev[0].startswith("2027")}
        assert len(ppi_dates) == 12, f"Expected 12 PPI 2027 dates, got {len(ppi_dates)}"

    def test_ism_times_are_10am_in_list(self):
        """All ISM entries in _ECONOMIC_EVENTS use time 10:00."""
        ism_entries = [ev for ev in _ECONOMIC_EVENTS if ev[2] == "ISM"]
        assert len(ism_entries) > 0, "No ISM entries found in _ECONOMIC_EVENTS"
        for ev in ism_entries:
            assert ev[1] == "10:00", f"ISM entry {ev[0]} has wrong time {ev[1]}"

    def test_gdp_times_are_830am_in_list(self):
        """All GDP entries in _ECONOMIC_EVENTS use time 08:30."""
        gdp_entries = [ev for ev in _ECONOMIC_EVENTS if ev[2] == "GDP"]
        assert len(gdp_entries) > 0, "No GDP entries found in _ECONOMIC_EVENTS"
        for ev in gdp_entries:
            assert ev[1] == "08:30", f"GDP entry {ev[0]} has wrong time {ev[1]}"

    def test_ppi_times_are_830am_in_list(self):
        """All PPI entries in _ECONOMIC_EVENTS use time 08:30."""
        ppi_entries = [ev for ev in _ECONOMIC_EVENTS if ev[2] == "PPI"]
        assert len(ppi_entries) > 0, "No PPI entries found in _ECONOMIC_EVENTS"
        for ev in ppi_entries:
            assert ev[1] == "08:30", f"PPI entry {ev[0]} has wrong time {ev[1]}"


# ─── Parity: _ECONOMIC_EVENTS matches STATIC_EVENTS for GDP/ISM/PPI 2026-2027 ─

class TestParityWithStaticEvents:
    """calendar_filter._ECONOMIC_EVENTS must exactly match STATIC_EVENTS[GDP/ISM/PPI] for 2026-2027.

    This is the enforcement gate: any drift between the two files is a bug.
    calendar_filter imports directly from economic_calendar at module level, so
    this test is also a regression guard for the import mechanism.
    """

    PARITY_TYPES = ("GDP", "ISM", "PPI")
    PARITY_YEARS = ("2026", "2027")

    def _filter_list(self, event_type: str) -> set[tuple[str, str]]:
        """Return {(date, time_et)} from _ECONOMIC_EVENTS for the given type/years."""
        return {
            (ev[0], ev[1])
            for ev in _ECONOMIC_EVENTS
            if ev[2] == event_type and ev[0][:4] in self.PARITY_YEARS
        }

    def _filter_static(self, event_type: str) -> set[tuple[str, str]]:
        """Return {(date, time_et)} from STATIC_EVENTS for the given type/years."""
        return {
            (e["date"], e["time_et"])
            for e in STATIC_EVENTS.get(event_type, [])
            if e["date"][:4] in self.PARITY_YEARS
        }

    def test_gdp_parity_2026_2027(self):
        """_ECONOMIC_EVENTS GDP 2026-2027 exactly matches STATIC_EVENTS GDP."""
        live = self._filter_list("GDP")
        canonical = self._filter_static("GDP")
        missing_from_live = canonical - live
        extra_in_live = live - canonical
        assert not missing_from_live, f"GDP missing from _ECONOMIC_EVENTS: {missing_from_live}"
        assert not extra_in_live, f"GDP extra in _ECONOMIC_EVENTS: {extra_in_live}"

    def test_ism_parity_2026_2027(self):
        """_ECONOMIC_EVENTS ISM 2026-2027 exactly matches STATIC_EVENTS ISM."""
        live = self._filter_list("ISM")
        canonical = self._filter_static("ISM")
        missing_from_live = canonical - live
        extra_in_live = live - canonical
        assert not missing_from_live, f"ISM missing from _ECONOMIC_EVENTS: {missing_from_live}"
        assert not extra_in_live, f"ISM extra in _ECONOMIC_EVENTS: {extra_in_live}"

    def test_ppi_parity_2026_2027(self):
        """_ECONOMIC_EVENTS PPI 2026-2027 exactly matches STATIC_EVENTS PPI."""
        live = self._filter_list("PPI")
        canonical = self._filter_static("PPI")
        missing_from_live = canonical - live
        extra_in_live = live - canonical
        assert not missing_from_live, f"PPI missing from _ECONOMIC_EVENTS: {missing_from_live}"
        assert not extra_in_live, f"PPI extra in _ECONOMIC_EVENTS: {extra_in_live}"
