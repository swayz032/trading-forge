"""Tests for calendar_filter.py MFFU Feb-2026 News Policy macro-blackout.

Wave hardening 2026-06-22 Phase 1 — correct the live T1 set.

The CURRENT MFFU News Policy (Feb 2026) Tier-1 set is FOMC, FOMC Minutes,
Employment Report (NFP), CPI [all products] + EIA [energy/MCL only] + Agricultural.
A prior commit wrongly added GDP/ISM/PPI from a STALE doc; this suite verifies they
are REMOVED from the live blackout and that FOMC_MINUTES is now present.

Verifies:
  1. check_economic_event() blocks inside FOMC_MINUTES (14:00 ET).
  2. check_economic_event() does NOT block on former GDP/ISM/PPI dates (removed).
  3. _ECONOMIC_EVENTS contains FOMC_MINUTES for 2026-2027 and NOT GDP/ISM/PPI.
  4. Parity between calendar_filter._ECONOMIC_EVENTS and economic_calendar.STATIC_EVENTS
     for the universal set (FOMC_MINUTES). EIA is product-scoped (MCL) + firm-aware and
     handled in Phase 2 — intentionally NOT in the universal live blackout.

Note: bare import of the full backtester (vectorbt) HANGS pytest collection on the
tower.  This module only imports calendar_filter and economic_calendar — both are pure
datetime / dict logic with no vectorbt dependency.
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


# ─── FOMC Minutes blackout (14:00 ET, ~3 weeks after each FOMC) ───────────────

class TestFOMCMinutesBlackout:
    """FOMC Minutes 2026-02-18 at 14:00 ET (winter = EST = UTC-5). T1 all products."""

    FM_DATE = "2026-02-18"
    FM_ET = "14:00"
    DST = False  # February = EST

    def _bar_at_et(self, h: int, m: int) -> datetime:
        base = datetime.strptime(self.FM_DATE, "%Y-%m-%d")
        et_dt = base.replace(hour=h, minute=m)
        return (et_dt + timedelta(hours=5)).replace(tzinfo=timezone.utc)

    def test_inside_window_at_event_time(self):
        """Bar at 14:00 ET (exactly at FOMC Minutes) → blocked."""
        blocked, name, window = check_economic_event(self._bar_at_et(14, 0))
        assert blocked is True, f"FOMC_MINUTES window should block at t=0, got {blocked}"
        assert name == "FOMC_MINUTES"
        assert window == EVENT_BLACKOUT_MINUTES

    def test_inside_window_before(self):
        """Bar at 13:45 ET (15 min before) → blocked."""
        blocked, name, _ = check_economic_event(self._bar_at_et(13, 45))
        assert blocked is True
        assert name == "FOMC_MINUTES"

    def test_outside_window(self):
        """Bar at 13:00 ET (60 min before) → NOT blocked."""
        blocked, _, _ = check_economic_event(self._bar_at_et(13, 0))
        assert blocked is False


# ─── Removed events: GDP / ISM / PPI must NOT block (MFFU Feb-2026 — not T1) ──

class TestRemovedEventsNotBlocked:
    """GDP (08:30), ISM (10:00), PPI (08:30) are NOT T1 per current MFFU policy.

    A prior commit blocked them from a stale doc. They are now removed from the live
    blackout — these dates must trade freely (subject only to other gates).
    """

    # A former GDP date (2026-01-29 08:30), ISM (2026-02-02 10:00), PPI (2026-01-15 08:30).
    def test_former_gdp_window_not_blocked(self):
        bar = _et_to_utc("2026-01-29", "08:30", dst=False)
        blocked, _, _ = check_economic_event(bar)
        assert blocked is False, "GDP is not T1 (MFFU Feb-2026) — must NOT block"

    def test_former_ism_window_not_blocked(self):
        bar = _et_to_utc("2026-02-02", "10:00", dst=False)
        blocked, _, _ = check_economic_event(bar)
        assert blocked is False, "ISM is not T1 (MFFU Feb-2026) — must NOT block"

    def test_former_ppi_window_not_blocked(self):
        bar = _et_to_utc("2026-01-15", "08:30", dst=False)
        blocked, _, _ = check_economic_event(bar)
        assert blocked is False, "PPI is not T1 (MFFU Feb-2026) — must NOT block"


# ─── Live event-list coverage ─────────────────────────────────────────────────

class TestEconomicEventsListCoverage:
    """The live _ECONOMIC_EVENTS contains the correct universal T1 set."""

    def _types(self) -> set[str]:
        return {evt[2] for evt in _ECONOMIC_EVENTS}

    def test_fomc_minutes_present_2026(self):
        fm = [e for e in _ECONOMIC_EVENTS if e[2] == "FOMC_MINUTES" and e[0].startswith("2026")]
        assert len(fm) >= 7, f"expected 2026 FOMC_MINUTES entries, got {len(fm)}"

    def test_fomc_minutes_present_2027(self):
        fm = [e for e in _ECONOMIC_EVENTS if e[2] == "FOMC_MINUTES" and e[0].startswith("2027")]
        assert len(fm) >= 7, f"expected 2027 FOMC_MINUTES entries, got {len(fm)}"

    def test_fomc_minutes_times_are_2pm(self):
        for e in _ECONOMIC_EVENTS:
            if e[2] == "FOMC_MINUTES":
                assert e[1] == "14:00", f"FOMC_MINUTES must be 14:00 ET, got {e[1]} on {e[0]}"

    def test_gdp_ism_ppi_absent(self):
        types = self._types()
        for t in ("GDP", "ISM", "PPI"):
            assert t not in types, f"{t} must be REMOVED from live blackout (not T1)"

    def test_universal_set_is_correct(self):
        assert self._types() == {"FOMC", "CPI", "NFP", "FOMC_MINUTES"}, (
            f"universal live T1 set must be FOMC/CPI/NFP/FOMC_MINUTES, got {self._types()}"
        )

    def test_eia_not_in_universal_live_set(self):
        """EIA is product-scoped (MCL) + firm-aware — handled in Phase 2, NOT universal."""
        assert "EIA" not in self._types(), "EIA must NOT be in the firm/product-agnostic live set"


# ─── Parity with STATIC_EVENTS (universal set) ────────────────────────────────

class TestParityWithStaticEvents:
    """Live FOMC_MINUTES exactly matches economic_calendar.STATIC_EVENTS."""

    def _filter_list(self, event_type: str) -> set[tuple[str, str]]:
        return {
            (e[0], e[1]) for e in _ECONOMIC_EVENTS
            if e[2] == event_type and e[0][:4] in ("2026", "2027")
        }

    def _filter_static(self, event_type: str) -> set[tuple[str, str]]:
        return {
            (e["date"], e["time_et"]) for e in STATIC_EVENTS.get(event_type, [])
            if e["date"][:4] in ("2026", "2027")
        }

    def test_fomc_minutes_parity_2026_2027(self):
        live = self._filter_list("FOMC_MINUTES")
        canonical = self._filter_static("FOMC_MINUTES")
        assert not (canonical - live), f"FOMC_MINUTES missing from live: {canonical - live}"
        assert not (live - canonical), f"FOMC_MINUTES extra in live: {live - canonical}"

    def test_fomc_parity_2026(self):
        """Inline FOMC 2026 dates in _ECONOMIC_EVENTS must match STATIC_EVENTS.

        Extended parity (D2): guards the 4th-copy divergence where calendar_filter
        had 3 wrong FOMC 2026 dates (05-06/11-04/12-16) while STATIC_EVENTS was
        corrected. Both must agree so the live blackout uses the same FOMC schedule
        as the backtest event mask.
        """
        live = self._filter_list("FOMC")
        canonical = self._filter_static("FOMC")
        missing = canonical - live
        extra = live - canonical
        assert not missing, f"FOMC in STATIC_EVENTS but missing from calendar_filter: {sorted(missing)}"
        assert not extra, f"FOMC in calendar_filter but not in STATIC_EVENTS: {sorted(extra)}"

    def test_cpi_parity_2026(self):
        """Inline CPI 2026 dates in _ECONOMIC_EVENTS must match STATIC_EVENTS.

        Extended parity (D2): calendar_filter had 3 wrong CPI 2026 dates
        (05-13/09-09/11-12). After D2 correction both sources must agree.
        """
        live = {e for e in self._filter_list("CPI") if e[0].startswith("2026")}
        canonical = {e for e in self._filter_static("CPI") if e[0].startswith("2026")}
        missing = canonical - live
        extra = live - canonical
        assert not missing, f"CPI 2026 in STATIC_EVENTS but missing from calendar_filter: {sorted(missing)}"
        assert not extra, f"CPI 2026 in calendar_filter but not in STATIC_EVENTS: {sorted(extra)}"

    def test_nfp_parity_2026(self):
        """Inline NFP 2026 dates in _ECONOMIC_EVENTS must match STATIC_EVENTS.

        Extended parity (D2): calendar_filter had NFP Jan 2026 as 2026-01-09
        (second Friday) while STATIC_EVENTS has 2026-01-02 (correct first Friday).
        After D2 correction both sources must agree for all 12 months.
        """
        live = {e for e in self._filter_list("NFP") if e[0].startswith("2026")}
        canonical = {e for e in self._filter_static("NFP") if e[0].startswith("2026")}
        missing = canonical - live
        extra = live - canonical
        assert not missing, f"NFP 2026 in STATIC_EVENTS but missing from calendar_filter: {sorted(missing)}"
        assert not extra, f"NFP 2026 in calendar_filter but not in STATIC_EVENTS: {sorted(extra)}"

    def test_fomc_2026_correct_dates(self):
        """Spot-check the 3 previously wrong FOMC 2026 dates are now correct.

        This test names the exact dates so a future accidental revert is immediately
        visible rather than hidden behind a parity pass.
        """
        fomc_2026 = {e[0] for e in _ECONOMIC_EVENTS if e[2] == "FOMC" and e[0].startswith("2026")}
        assert "2026-04-29" in fomc_2026, "FOMC 2026-04-29 missing (was wrong as 2026-05-06)"
        assert "2026-10-28" in fomc_2026, "FOMC 2026-10-28 missing (was wrong as 2026-11-04)"
        assert "2026-12-09" in fomc_2026, "FOMC 2026-12-09 missing (was wrong as 2026-12-16)"
        assert "2026-05-06" not in fomc_2026, "Wrong FOMC date 2026-05-06 still present"
        assert "2026-11-04" not in fomc_2026, "Wrong FOMC date 2026-11-04 still present"
        assert "2026-12-16" not in fomc_2026, "Wrong FOMC date 2026-12-16 still present"
