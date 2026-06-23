"""Economic calendar filter — static high-impact event dates.

Per CLAUDE.md: Don't trade through FOMC/CPI/NFP without explicit event
handling — default is SIT_OUT ±30 min.

F-4/F-8 fix (2026-05-20): Added 2025 CPI/NFP/GDP/PCE; extended GDP/PCE to
2027; added ISM Manufacturing and PPI as new event types. Dates sourced from
BLS/Fed published calendars. 2027 estimates are based on historical patterns —
mark TODO below if exact dates were projected rather than confirmed.

Wave hardening 2026-06-22 Phase 1 — MFFU Feb-2026 policy — correct T1 set:
  Added FOMC_MINUTES and EIA to STATIC_EVENTS.
  FOMC_MINUTES: released approximately 3 weeks after each FOMC meeting.
    Dates are the "~3 weeks after FOMC" approximation and MUST be verified by the
    operator against the Fed's published Minutes release calendar before live use.
    TODO: operator confirm exact dates from https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
  EIA: Crude Oil Inventories, every Wednesday 10:30 ET.
    Holiday-adjusted: when a Monday US federal holiday falls in that week,
    the EIA petroleum report shifts to Thursday 11:00 ET.
    Dates generated via generate_eia_dates_for_year() — operator MUST verify
    against the official EIA 2026 schedule (image in MFFU policy doc §5).
    Product scope: EIA affects CL/MCL ONLY (crude-energy traders per MFFU Feb-2026).

EVENT_PRODUCT_SCOPE: separate dict keyed by event_type listing affected_products.
  Chosen over adding a 4th element to _ECONOMIC_EVENTS tuples because the
  existing tuple shape (date, time_et, name) is unpacked in multiple consumers;
  a separate map is non-invasive and allows future product-aware filtering without
  touching all existing call sites.
"""

from __future__ import annotations

import sys
from datetime import date as _date, datetime, timedelta
from typing import Literal

import numpy as np
import polars as pl


# ─── Product scope map ────────────────────────────────────────────
# Wave hardening 2026-06-22 Phase 1, MFFU Feb-2026 policy — correct T1 set.
# Keyed by event_type. Empty list = affects all products (no filter applied).
# Separate from STATIC_EVENTS tuples to avoid breaking existing (date, time_et)
# unpack consumers.
#
# EIA: crude-energy-only per MFFU Feb-2026 policy §5 ("For energy traders: EIA").
# FOMC / FOMC_MINUTES / CPI / NFP: all products (all traders).
# GDP / PCE / ISM / PPI: historical data only (NOT T1 per Feb-2026 policy);
#   listed as empty list so non-blackout consumers can still query them.
EVENT_PRODUCT_SCOPE: dict[str, list[str]] = {
    "FOMC":         [],             # all products
    "FOMC_MINUTES": [],             # all products
    "CPI":          [],             # all products
    "NFP":          [],             # all products
    "EIA":          ["MCL", "CL"],  # crude-energy only (MFFU §5 energy-trader clause)
    "GDP":          [],             # NOT T1 per Feb-2026; kept for non-blackout reference
    "PCE":          [],             # NOT T1 per Feb-2026; kept for non-blackout reference
    "ISM":          [],             # NOT T1 per Feb-2026; kept for non-blackout reference
    "PPI":          [],             # NOT T1 per Feb-2026; kept for non-blackout reference
}


# ─── EIA petroleum report date generator ─────────────────────────
# Wave hardening 2026-06-22 Phase 1, MFFU Feb-2026 policy — EIA.
# Standard schedule: every Wednesday at 10:30 ET.
# Holiday shift rule: when a Monday US federal holiday falls in that week,
#   EIA shifts to Thursday 11:00 ET.
# US federal Monday holidays 2026: MLK (Jan 19), Presidents (Feb 16),
#   Memorial (May 25), Labor (Sep 7), Columbus (Oct 12).
# US federal Monday holidays 2027: MLK (Jan 18), Presidents (Feb 15),
#   Memorial (May 31 → affects Wed Jun 2), Labor (Sep 6), Columbus (Oct 11).
#
# IMPORTANT: Operator MUST verify these dates against the official EIA 2026-2027
# petroleum status report release calendar:
#   https://www.eia.gov/petroleum/supply/weekly/
# The MFFU policy doc §5 contains the authoritative image of the EIA schedule.

def _federal_monday_holidays(year: int) -> set[_date]:
    """Return the set of Monday federal holidays for the given year.

    Only returns Monday-specific holidays (not all NYSE holidays).
    These are the ones that trigger an EIA Wednesday→Thursday shift.
    """
    from calendar import MONDAY
    def nth_weekday(y: int, month: int, weekday: int, n: int) -> _date:
        """nth occurrence (1-based) of weekday in month."""
        first = _date(y, month, 1)
        delta = (weekday - first.weekday()) % 7
        return first + timedelta(days=delta + (n - 1) * 7)

    def last_monday(y: int, month: int) -> _date:
        if month == 12:
            last_day = _date(y + 1, 1, 1) - timedelta(days=1)
        else:
            last_day = _date(y, month + 1, 1) - timedelta(days=1)
        delta = (last_day.weekday() - MONDAY) % 7
        return last_day - timedelta(days=delta)

    def observed(h: _date) -> _date:
        dow = h.weekday()
        if dow == 5:
            return h - timedelta(days=1)
        if dow == 6:
            return h + timedelta(days=1)
        return h

    monday_holidays: set[_date] = set()

    # MLK Day — 3rd Monday of January
    mlk = nth_weekday(year, 1, MONDAY, 3)
    if mlk.weekday() == MONDAY:
        monday_holidays.add(mlk)

    # Presidents' Day — 3rd Monday of February
    pres = nth_weekday(year, 2, MONDAY, 3)
    if pres.weekday() == MONDAY:
        monday_holidays.add(pres)

    # Memorial Day — last Monday of May
    mem = last_monday(year, 5)
    if mem.weekday() == MONDAY:
        monday_holidays.add(mem)

    # Labor Day — 1st Monday of September
    labor = nth_weekday(year, 9, MONDAY, 1)
    if labor.weekday() == MONDAY:
        monday_holidays.add(labor)

    # Columbus Day — 2nd Monday of October
    columbus = nth_weekday(year, 10, MONDAY, 2)
    if columbus.weekday() == MONDAY:
        monday_holidays.add(columbus)

    return monday_holidays


def generate_eia_dates_for_year(year: int) -> list[dict]:
    """Generate EIA Crude Oil Inventory release dates for a calendar year.

    Standard schedule: every Wednesday at 10:30 ET.
    Holiday shift: when the Monday of that week is a US federal holiday,
      the report shifts to Thursday 11:00 ET.

    Returns list of dicts: {date: "YYYY-MM-DD", time_et: "HH:MM"}.

    NOTE: These are algorithmically derived. The operator MUST verify against
    the official EIA release calendar for 2026-2027 before live use.
    """
    from calendar import WEDNESDAY, THURSDAY
    monday_holidays = _federal_monday_holidays(year)
    results = []

    # Iterate over every week in the year
    # Start from the first Wednesday of the year
    d = _date(year, 1, 1)
    # Advance to first Wednesday
    while d.weekday() != WEDNESDAY:
        d += timedelta(days=1)

    while d.year == year:
        # Find the Monday of this week (3 days before Wednesday)
        week_monday = d - timedelta(days=2)  # Wednesday - 2 = Monday
        if week_monday in monday_holidays:
            # Holiday shift: report moves to Thursday 11:00 ET
            thursday = d + timedelta(days=1)
            if thursday.year == year:
                results.append({"date": thursday.isoformat(), "time_et": "11:00"})
        else:
            results.append({"date": d.isoformat(), "time_et": "10:30"})
        d += timedelta(weeks=1)

    return results


# Pre-generate EIA for 2026-2027 (the live blackout horizon).
# Stored in STATIC_EVENTS["EIA"] so all downstream consumers use a single source.
_EIA_2026 = generate_eia_dates_for_year(2026)
_EIA_2027 = generate_eia_dates_for_year(2027)


# ─── Static Event Calendar (2023-2027) ───────────────────────────
# All times in ET. Only high-impact events that move futures.
# T1 per MFFU Feb-2026 policy: FOMC, FOMC_MINUTES, CPI, NFP, EIA (energy).
# Historical reference (non-T1 per Feb-2026): GDP, PCE, ISM, PPI.

STATIC_EVENTS: dict[str, list[dict]] = {
    "FOMC": [
        # 2023
        {"date": "2023-02-01", "time_et": "14:00"},
        {"date": "2023-03-22", "time_et": "14:00"},
        {"date": "2023-05-03", "time_et": "14:00"},
        {"date": "2023-06-14", "time_et": "14:00"},
        {"date": "2023-07-26", "time_et": "14:00"},
        {"date": "2023-09-20", "time_et": "14:00"},
        {"date": "2023-11-01", "time_et": "14:00"},
        {"date": "2023-12-13", "time_et": "14:00"},
        # 2024
        {"date": "2024-01-31", "time_et": "14:00"},
        {"date": "2024-03-20", "time_et": "14:00"},
        {"date": "2024-05-01", "time_et": "14:00"},
        {"date": "2024-06-12", "time_et": "14:00"},
        {"date": "2024-07-31", "time_et": "14:00"},
        {"date": "2024-09-18", "time_et": "14:00"},
        {"date": "2024-11-07", "time_et": "14:00"},
        {"date": "2024-12-18", "time_et": "14:00"},
        # 2025
        {"date": "2025-01-29", "time_et": "14:00"},
        {"date": "2025-03-19", "time_et": "14:00"},
        {"date": "2025-05-07", "time_et": "14:00"},
        {"date": "2025-06-18", "time_et": "14:00"},
        {"date": "2025-07-30", "time_et": "14:00"},
        {"date": "2025-09-17", "time_et": "14:00"},
        {"date": "2025-11-05", "time_et": "14:00"},
        {"date": "2025-12-17", "time_et": "14:00"},
        # 2026
        {"date": "2026-01-28", "time_et": "14:00"},
        {"date": "2026-03-18", "time_et": "14:00"},
        {"date": "2026-05-06", "time_et": "14:00"},
        {"date": "2026-06-17", "time_et": "14:00"},
        {"date": "2026-07-29", "time_et": "14:00"},
        {"date": "2026-09-16", "time_et": "14:00"},
        {"date": "2026-11-04", "time_et": "14:00"},
        {"date": "2026-12-16", "time_et": "14:00"},
        # 2027
        {"date": "2027-01-27", "time_et": "14:00"},
        {"date": "2027-03-17", "time_et": "14:00"},
        {"date": "2027-05-05", "time_et": "14:00"},
        {"date": "2027-06-16", "time_et": "14:00"},
        {"date": "2027-07-28", "time_et": "14:00"},
        {"date": "2027-09-22", "time_et": "14:00"},
        {"date": "2027-11-03", "time_et": "14:00"},
        {"date": "2027-12-15", "time_et": "14:00"},
    ],
    "CPI": [
        # 2024 (monthly, 8:30 AM ET — BLS published schedule)
        {"date": "2024-01-11", "time_et": "08:30"},
        {"date": "2024-02-13", "time_et": "08:30"},
        {"date": "2024-03-12", "time_et": "08:30"},
        {"date": "2024-04-10", "time_et": "08:30"},
        {"date": "2024-05-15", "time_et": "08:30"},
        {"date": "2024-06-12", "time_et": "08:30"},
        {"date": "2024-07-11", "time_et": "08:30"},
        {"date": "2024-08-14", "time_et": "08:30"},
        {"date": "2024-09-11", "time_et": "08:30"},
        {"date": "2024-10-10", "time_et": "08:30"},
        {"date": "2024-11-13", "time_et": "08:30"},
        {"date": "2024-12-11", "time_et": "08:30"},
        # 2025 (monthly, 8:30 AM ET — BLS published schedule)
        # Source: https://www.bls.gov/schedule/2025/home.htm
        {"date": "2025-01-15", "time_et": "08:30"},
        {"date": "2025-02-12", "time_et": "08:30"},
        {"date": "2025-03-12", "time_et": "08:30"},
        {"date": "2025-04-10", "time_et": "08:30"},
        {"date": "2025-05-13", "time_et": "08:30"},
        {"date": "2025-06-11", "time_et": "08:30"},
        {"date": "2025-07-15", "time_et": "08:30"},
        {"date": "2025-08-12", "time_et": "08:30"},
        {"date": "2025-09-10", "time_et": "08:30"},
        {"date": "2025-10-15", "time_et": "08:30"},
        {"date": "2025-11-13", "time_et": "08:30"},
        {"date": "2025-12-10", "time_et": "08:30"},
        # 2026 (monthly, 8:30 AM ET — second Tuesday/Wednesday)
        {"date": "2026-01-14", "time_et": "08:30"},
        {"date": "2026-02-11", "time_et": "08:30"},
        {"date": "2026-03-11", "time_et": "08:30"},
        {"date": "2026-04-14", "time_et": "08:30"},
        {"date": "2026-05-12", "time_et": "08:30"},
        {"date": "2026-06-10", "time_et": "08:30"},
        {"date": "2026-07-14", "time_et": "08:30"},
        {"date": "2026-08-12", "time_et": "08:30"},
        {"date": "2026-09-15", "time_et": "08:30"},
        {"date": "2026-10-13", "time_et": "08:30"},
        {"date": "2026-11-10", "time_et": "08:30"},
        {"date": "2026-12-10", "time_et": "08:30"},
        # 2027 (monthly, 8:30 AM ET — projected; TODO: confirm from BLS when released)
        {"date": "2027-01-13", "time_et": "08:30"},
        {"date": "2027-02-10", "time_et": "08:30"},
        {"date": "2027-03-10", "time_et": "08:30"},
        {"date": "2027-04-13", "time_et": "08:30"},
        {"date": "2027-05-12", "time_et": "08:30"},
        {"date": "2027-06-10", "time_et": "08:30"},
        {"date": "2027-07-13", "time_et": "08:30"},
        {"date": "2027-08-11", "time_et": "08:30"},
        {"date": "2027-09-14", "time_et": "08:30"},
        {"date": "2027-10-13", "time_et": "08:30"},
        {"date": "2027-11-10", "time_et": "08:30"},
        {"date": "2027-12-10", "time_et": "08:30"},
    ],
    "NFP": [
        # 2024 (first Friday, 8:30 AM ET — BLS published schedule)
        {"date": "2024-01-05", "time_et": "08:30"},
        {"date": "2024-02-02", "time_et": "08:30"},
        {"date": "2024-03-08", "time_et": "08:30"},
        {"date": "2024-04-05", "time_et": "08:30"},
        {"date": "2024-05-03", "time_et": "08:30"},
        {"date": "2024-06-07", "time_et": "08:30"},
        {"date": "2024-07-05", "time_et": "08:30"},
        {"date": "2024-08-02", "time_et": "08:30"},
        {"date": "2024-09-06", "time_et": "08:30"},
        {"date": "2024-10-04", "time_et": "08:30"},
        {"date": "2024-11-01", "time_et": "08:30"},
        {"date": "2024-12-06", "time_et": "08:30"},
        # 2025 (first Friday, 8:30 AM ET — BLS published schedule)
        # Source: https://www.bls.gov/schedule/2025/home.htm
        {"date": "2025-01-10", "time_et": "08:30"},
        {"date": "2025-02-07", "time_et": "08:30"},
        {"date": "2025-03-07", "time_et": "08:30"},
        {"date": "2025-04-04", "time_et": "08:30"},
        {"date": "2025-05-02", "time_et": "08:30"},
        {"date": "2025-06-06", "time_et": "08:30"},
        {"date": "2025-07-03", "time_et": "08:30"},  # Independence Day proximity — confirmed BLS
        {"date": "2025-08-01", "time_et": "08:30"},
        {"date": "2025-09-05", "time_et": "08:30"},
        {"date": "2025-10-03", "time_et": "08:30"},
        {"date": "2025-11-07", "time_et": "08:30"},
        {"date": "2025-12-05", "time_et": "08:30"},
        # 2026 (first Friday, 8:30 AM ET)
        {"date": "2026-01-02", "time_et": "08:30"},
        {"date": "2026-02-06", "time_et": "08:30"},
        {"date": "2026-03-06", "time_et": "08:30"},
        {"date": "2026-04-03", "time_et": "08:30"},
        {"date": "2026-05-01", "time_et": "08:30"},
        {"date": "2026-06-05", "time_et": "08:30"},
        {"date": "2026-07-02", "time_et": "08:30"},
        {"date": "2026-08-07", "time_et": "08:30"},
        {"date": "2026-09-04", "time_et": "08:30"},
        {"date": "2026-10-02", "time_et": "08:30"},
        {"date": "2026-11-06", "time_et": "08:30"},
        {"date": "2026-12-04", "time_et": "08:30"},
        # 2027 (first Friday, 8:30 AM ET — projected)
        {"date": "2027-01-08", "time_et": "08:30"},
        {"date": "2027-02-05", "time_et": "08:30"},
        {"date": "2027-03-05", "time_et": "08:30"},
        {"date": "2027-04-02", "time_et": "08:30"},
        {"date": "2027-05-07", "time_et": "08:30"},
        {"date": "2027-06-04", "time_et": "08:30"},
        {"date": "2027-07-02", "time_et": "08:30"},
        {"date": "2027-08-06", "time_et": "08:30"},
        {"date": "2027-09-03", "time_et": "08:30"},
        {"date": "2027-10-01", "time_et": "08:30"},
        {"date": "2027-11-05", "time_et": "08:30"},
        {"date": "2027-12-03", "time_et": "08:30"},
    ],
    "GDP": [
        # 2024 (quarterly advance estimate, 8:30 AM ET — BEA published schedule)
        {"date": "2024-01-25", "time_et": "08:30"},
        {"date": "2024-04-25", "time_et": "08:30"},
        {"date": "2024-07-25", "time_et": "08:30"},
        {"date": "2024-10-30", "time_et": "08:30"},
        # 2025 (quarterly advance estimate — BEA published schedule)
        # Source: https://www.bea.gov/news/schedule
        {"date": "2025-01-30", "time_et": "08:30"},
        {"date": "2025-04-30", "time_et": "08:30"},
        {"date": "2025-07-30", "time_et": "08:30"},
        {"date": "2025-10-29", "time_et": "08:30"},
        # 2026 (quarterly — projected; TODO: confirm from BEA when released)
        {"date": "2026-01-29", "time_et": "08:30"},
        {"date": "2026-04-29", "time_et": "08:30"},
        {"date": "2026-07-29", "time_et": "08:30"},
        {"date": "2026-10-28", "time_et": "08:30"},
        # 2027 (quarterly — projected; TODO: confirm from BEA when released)
        {"date": "2027-01-28", "time_et": "08:30"},
        {"date": "2027-04-28", "time_et": "08:30"},
        {"date": "2027-07-28", "time_et": "08:30"},
        {"date": "2027-10-27", "time_et": "08:30"},
    ],
    "PCE": [
        # 2024 (monthly, 8:30 AM ET — BEA Personal Income and Outlays release)
        {"date": "2024-01-26", "time_et": "08:30"},
        {"date": "2024-02-29", "time_et": "08:30"},
        {"date": "2024-03-29", "time_et": "08:30"},
        {"date": "2024-04-26", "time_et": "08:30"},
        {"date": "2024-05-31", "time_et": "08:30"},
        {"date": "2024-06-28", "time_et": "08:30"},
        {"date": "2024-07-26", "time_et": "08:30"},
        {"date": "2024-08-30", "time_et": "08:30"},
        {"date": "2024-09-27", "time_et": "08:30"},
        {"date": "2024-10-31", "time_et": "08:30"},
        {"date": "2024-11-27", "time_et": "08:30"},
        {"date": "2024-12-20", "time_et": "08:30"},
        # 2025 (monthly, 8:30 AM ET — BEA published schedule)
        # Source: https://www.bea.gov/news/schedule
        {"date": "2025-01-31", "time_et": "08:30"},
        {"date": "2025-02-28", "time_et": "08:30"},
        {"date": "2025-03-28", "time_et": "08:30"},
        {"date": "2025-04-30", "time_et": "08:30"},
        {"date": "2025-05-30", "time_et": "08:30"},
        {"date": "2025-06-27", "time_et": "08:30"},
        {"date": "2025-07-25", "time_et": "08:30"},
        {"date": "2025-08-29", "time_et": "08:30"},
        {"date": "2025-09-26", "time_et": "08:30"},
        {"date": "2025-10-31", "time_et": "08:30"},
        {"date": "2025-11-26", "time_et": "08:30"},
        {"date": "2025-12-19", "time_et": "08:30"},
        # 2026 (monthly — projected; TODO: confirm from BEA when released)
        {"date": "2026-01-30", "time_et": "08:30"},
        {"date": "2026-02-27", "time_et": "08:30"},
        {"date": "2026-03-27", "time_et": "08:30"},
        {"date": "2026-04-30", "time_et": "08:30"},
        {"date": "2026-05-29", "time_et": "08:30"},
        {"date": "2026-06-26", "time_et": "08:30"},
        {"date": "2026-07-31", "time_et": "08:30"},
        {"date": "2026-08-28", "time_et": "08:30"},
        {"date": "2026-09-25", "time_et": "08:30"},
        {"date": "2026-10-30", "time_et": "08:30"},
        {"date": "2026-11-25", "time_et": "08:30"},
        {"date": "2026-12-18", "time_et": "08:30"},
        # 2027 (monthly — projected; TODO: confirm from BEA when released)
        {"date": "2027-01-29", "time_et": "08:30"},
        {"date": "2027-02-26", "time_et": "08:30"},
        {"date": "2027-03-26", "time_et": "08:30"},
        {"date": "2027-04-30", "time_et": "08:30"},
        {"date": "2027-05-28", "time_et": "08:30"},
        {"date": "2027-06-25", "time_et": "08:30"},
        {"date": "2027-07-30", "time_et": "08:30"},
        {"date": "2027-08-27", "time_et": "08:30"},
        {"date": "2027-09-24", "time_et": "08:30"},
        {"date": "2027-10-29", "time_et": "08:30"},
        {"date": "2027-11-24", "time_et": "08:30"},
        {"date": "2027-12-17", "time_et": "08:30"},
    ],
    "ISM": [
        # ISM Manufacturing PMI — first business day of the month, 10:00 AM ET
        # Source: Institute for Supply Management published calendar
        # 2024
        {"date": "2024-01-02", "time_et": "10:00"},
        {"date": "2024-02-01", "time_et": "10:00"},
        {"date": "2024-03-01", "time_et": "10:00"},
        {"date": "2024-04-01", "time_et": "10:00"},
        {"date": "2024-05-01", "time_et": "10:00"},
        {"date": "2024-06-03", "time_et": "10:00"},
        {"date": "2024-07-01", "time_et": "10:00"},
        {"date": "2024-08-01", "time_et": "10:00"},
        {"date": "2024-09-03", "time_et": "10:00"},
        {"date": "2024-10-01", "time_et": "10:00"},
        {"date": "2024-11-01", "time_et": "10:00"},
        {"date": "2024-12-02", "time_et": "10:00"},
        # 2025
        {"date": "2025-01-02", "time_et": "10:00"},
        {"date": "2025-02-03", "time_et": "10:00"},
        {"date": "2025-03-03", "time_et": "10:00"},
        {"date": "2025-04-01", "time_et": "10:00"},
        {"date": "2025-05-01", "time_et": "10:00"},
        {"date": "2025-06-02", "time_et": "10:00"},
        {"date": "2025-07-01", "time_et": "10:00"},
        {"date": "2025-08-01", "time_et": "10:00"},
        {"date": "2025-09-02", "time_et": "10:00"},
        {"date": "2025-10-01", "time_et": "10:00"},
        {"date": "2025-11-03", "time_et": "10:00"},
        {"date": "2025-12-01", "time_et": "10:00"},
        # 2026 (projected — first business day of month)
        {"date": "2026-01-02", "time_et": "10:00"},
        {"date": "2026-02-02", "time_et": "10:00"},
        {"date": "2026-03-02", "time_et": "10:00"},
        {"date": "2026-04-01", "time_et": "10:00"},
        {"date": "2026-05-01", "time_et": "10:00"},
        {"date": "2026-06-01", "time_et": "10:00"},
        {"date": "2026-07-01", "time_et": "10:00"},
        {"date": "2026-08-03", "time_et": "10:00"},
        {"date": "2026-09-01", "time_et": "10:00"},
        {"date": "2026-10-01", "time_et": "10:00"},
        {"date": "2026-11-02", "time_et": "10:00"},
        {"date": "2026-12-01", "time_et": "10:00"},
        # 2027 (projected — first business day of month)
        {"date": "2027-01-04", "time_et": "10:00"},
        {"date": "2027-02-01", "time_et": "10:00"},
        {"date": "2027-03-01", "time_et": "10:00"},
        {"date": "2027-04-01", "time_et": "10:00"},
        {"date": "2027-05-03", "time_et": "10:00"},
        {"date": "2027-06-01", "time_et": "10:00"},
        {"date": "2027-07-01", "time_et": "10:00"},
        {"date": "2027-08-02", "time_et": "10:00"},
        {"date": "2027-09-01", "time_et": "10:00"},
        {"date": "2027-10-01", "time_et": "10:00"},
        {"date": "2027-11-01", "time_et": "10:00"},
        {"date": "2027-12-01", "time_et": "10:00"},
    ],
    "PPI": [
        # Producer Price Index — typically 2nd Tuesday of month, 8:30 AM ET
        # Source: https://www.bls.gov/schedule/2024/home.htm (PPI section)
        # 2024
        {"date": "2024-01-12", "time_et": "08:30"},
        {"date": "2024-02-16", "time_et": "08:30"},
        {"date": "2024-03-14", "time_et": "08:30"},
        {"date": "2024-04-11", "time_et": "08:30"},
        {"date": "2024-05-14", "time_et": "08:30"},
        {"date": "2024-06-13", "time_et": "08:30"},
        {"date": "2024-07-12", "time_et": "08:30"},
        {"date": "2024-08-13", "time_et": "08:30"},
        {"date": "2024-09-12", "time_et": "08:30"},
        {"date": "2024-10-11", "time_et": "08:30"},
        {"date": "2024-11-14", "time_et": "08:30"},
        {"date": "2024-12-12", "time_et": "08:30"},
        # 2025 (BLS published schedule)
        # Source: https://www.bls.gov/schedule/2025/home.htm
        {"date": "2025-01-14", "time_et": "08:30"},
        {"date": "2025-02-13", "time_et": "08:30"},
        {"date": "2025-03-13", "time_et": "08:30"},
        {"date": "2025-04-11", "time_et": "08:30"},
        {"date": "2025-05-15", "time_et": "08:30"},
        {"date": "2025-06-12", "time_et": "08:30"},
        {"date": "2025-07-15", "time_et": "08:30"},
        {"date": "2025-08-14", "time_et": "08:30"},
        {"date": "2025-09-11", "time_et": "08:30"},
        {"date": "2025-10-14", "time_et": "08:30"},
        {"date": "2025-11-13", "time_et": "08:30"},
        {"date": "2025-12-11", "time_et": "08:30"},
        # 2026 (projected — day after CPI release, typically)
        {"date": "2026-01-15", "time_et": "08:30"},
        {"date": "2026-02-12", "time_et": "08:30"},
        {"date": "2026-03-12", "time_et": "08:30"},
        {"date": "2026-04-15", "time_et": "08:30"},
        {"date": "2026-05-13", "time_et": "08:30"},
        {"date": "2026-06-11", "time_et": "08:30"},
        {"date": "2026-07-15", "time_et": "08:30"},
        {"date": "2026-08-13", "time_et": "08:30"},
        {"date": "2026-09-16", "time_et": "08:30"},
        {"date": "2026-10-14", "time_et": "08:30"},
        {"date": "2026-11-11", "time_et": "08:30"},
        {"date": "2026-12-11", "time_et": "08:30"},
        # 2027 (projected; TODO: confirm from BLS when released)
        {"date": "2027-01-14", "time_et": "08:30"},
        {"date": "2027-02-11", "time_et": "08:30"},
        {"date": "2027-03-11", "time_et": "08:30"},
        {"date": "2027-04-14", "time_et": "08:30"},
        {"date": "2027-05-13", "time_et": "08:30"},
        {"date": "2027-06-11", "time_et": "08:30"},
        {"date": "2027-07-14", "time_et": "08:30"},
        {"date": "2027-08-12", "time_et": "08:30"},
        {"date": "2027-09-15", "time_et": "08:30"},
        {"date": "2027-10-14", "time_et": "08:30"},
        {"date": "2027-11-11", "time_et": "08:30"},
        {"date": "2027-12-09", "time_et": "08:30"},
    ],

    # ─── FOMC Minutes (14:00 ET, ~3 weeks after each FOMC meeting) ───────────
    # Wave hardening 2026-06-22 Phase 1, MFFU Feb-2026 policy — FOMC_MINUTES.
    # T1 event for ALL traders per MFFU Feb-2026 policy.
    # Dates are the "~3 weeks after FOMC" approximation (21 calendar days).
    # TODO: Operator MUST verify exact release dates against the Fed's published
    # Minutes calendar: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
    # The Fed typically releases Minutes at 2:00 PM ET on the specified date.
    # These approximate dates may shift by 1-3 days from the computed "+21 days".
    "FOMC_MINUTES": [
        # 2026 — computed as FOMC date + 21 calendar days
        # FOMC 2026-01-28 + 21 = 2026-02-18 (Wednesday)
        {"date": "2026-02-18", "time_et": "14:00"},
        # FOMC 2026-03-18 + 21 = 2026-04-08 (Wednesday)
        {"date": "2026-04-08", "time_et": "14:00"},
        # FOMC 2026-05-06 + 21 = 2026-05-27 (Wednesday)
        {"date": "2026-05-27", "time_et": "14:00"},
        # FOMC 2026-06-17 + 21 = 2026-07-08 (Wednesday)
        {"date": "2026-07-08", "time_et": "14:00"},
        # FOMC 2026-07-29 + 21 = 2026-08-19 (Wednesday)
        {"date": "2026-08-19", "time_et": "14:00"},
        # FOMC 2026-09-16 + 21 = 2026-10-07 (Wednesday)
        {"date": "2026-10-07", "time_et": "14:00"},
        # FOMC 2026-11-04 + 21 = 2026-11-25 (Wednesday)
        {"date": "2026-11-25", "time_et": "14:00"},
        # FOMC 2026-12-16 + 21 = 2027-01-06 (Wednesday, falls in 2027)
        {"date": "2027-01-06", "time_et": "14:00"},
        # 2027 — computed as FOMC date + 21 calendar days
        # FOMC 2027-01-27 + 21 = 2027-02-17 (Wednesday)
        {"date": "2027-02-17", "time_et": "14:00"},
        # FOMC 2027-03-17 + 21 = 2027-04-07 (Wednesday)
        {"date": "2027-04-07", "time_et": "14:00"},
        # FOMC 2027-05-05 + 21 = 2027-05-26 (Wednesday)
        {"date": "2027-05-26", "time_et": "14:00"},
        # FOMC 2027-06-16 + 21 = 2027-07-07 (Wednesday)
        {"date": "2027-07-07", "time_et": "14:00"},
        # FOMC 2027-07-28 + 21 = 2027-08-18 (Wednesday)
        {"date": "2027-08-18", "time_et": "14:00"},
        # FOMC 2027-09-22 + 21 = 2027-10-13 (Wednesday)
        {"date": "2027-10-13", "time_et": "14:00"},
        # FOMC 2027-11-03 + 21 = 2027-11-24 (Wednesday)
        {"date": "2027-11-24", "time_et": "14:00"},
        # FOMC 2027-12-15 + 21 = 2028-01-05 (Wednesday, falls in 2028 — omitted)
    ],

    # ─── EIA Crude Oil Inventories (Wed 10:30 ET; Thu 11:00 ET on Mon-holiday weeks) ─
    # Wave hardening 2026-06-22 Phase 1, MFFU Feb-2026 policy — EIA.
    # T1 event for energy traders (CL/MCL) per MFFU Feb-2026 policy §5.
    # Product scope: see EVENT_PRODUCT_SCOPE["EIA"] = ["MCL", "CL"].
    # Generated via generate_eia_dates_for_year() — see function docstring.
    # TODO: Operator MUST verify these dates against the official EIA weekly
    # petroleum status report schedule:
    #   https://www.eia.gov/petroleum/supply/weekly/
    # The MFFU policy doc §5 image is the authoritative calendar for 2026.
    # Holiday shift: Monday US federal holiday in that week → report moves to
    #   Thursday 11:00 ET. Affected 2026 weeks: Jan 19 (MLK→Jan 21→Thu Jan 22),
    #   Feb 16 (Presidents→Feb 18→Thu Feb 19), May 25 (Memorial→May 27→Thu May 28),
    #   Sep 7 (Labor→Sep 9→Thu Sep 10), Oct 12 (Columbus→Oct 14→Thu Oct 15).
    #   Affected 2027 weeks: Jan 18 (MLK→Jan 20→Thu Jan 21),
    #   Feb 15 (Presidents→Feb 17→Thu Feb 18), May 31 (Memorial→Jun 2→Thu Jun 3),
    #   Sep 6 (Labor→Sep 8→Thu Sep 9), Oct 11 (Columbus→Oct 13→Thu Oct 14).
    "EIA": _EIA_2026 + _EIA_2027,
}


def _warn_if_calendar_incomplete(year: int) -> None:
    """Emit a stderr warning if any event type is missing dates for the given year."""
    for event_type, events in STATIC_EVENTS.items():
        years_in_calendar = {e["date"][:4] for e in events}
        if str(year) not in years_in_calendar:
            print(
                f"WARNING: economic_calendar missing dates for year {year} event_type={event_type}",
                file=sys.stderr,
            )


def _parse_event_datetime(event: dict) -> datetime:
    """Parse event date + time_et into a datetime (ET)."""
    date_str = event["date"]
    time_str = event["time_et"]
    h, m = int(time_str.split(":")[0]), int(time_str.split(":")[1])
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    return dt.replace(hour=h, minute=m)


def _get_events_for_policies(
    policies: list[dict],
) -> list[tuple[datetime, str, str, int]]:
    """Build flat list of (event_dt_et, event_type, action, window_min)."""
    events = []
    for policy in policies:
        event_type = policy["event_type"]
        action = policy.get("action", "SIT_OUT")
        window = policy.get("window_minutes", 30)

        if event_type not in STATIC_EVENTS:
            continue

        for evt in STATIC_EVENTS[event_type]:
            dt = _parse_event_datetime(evt)
            events.append((dt, event_type, action, window))

    return events


def _timestamps_to_et_date_and_minutes(timestamps: pl.Series) -> tuple[list, np.ndarray]:
    """Convert timestamps to ET dates and minutes-from-midnight.

    If timezone-aware (America/New_York), extract directly — Polars respects tz.
    If naive, cast to UTC then convert to ET (handles EST/EDT automatically).
    """
    ts = timestamps
    tz = getattr(ts.dtype, 'time_zone', None)
    if tz is not None:
        if tz == "America/New_York":
            et = ts
        else:
            et = ts.dt.convert_time_zone("America/New_York")
    else:
        # Naive — assume UTC, cast then convert (handles EST/EDT correctly)
        et = ts.cast(pl.Datetime("us", time_zone="UTC")).dt.convert_time_zone("America/New_York")
    dates = et.dt.date().to_list()
    hours = et.dt.hour().to_numpy().astype(np.int32)
    minutes = et.dt.minute().to_numpy().astype(np.int32)
    minutes_from_midnight = hours * 60 + minutes
    return dates, minutes_from_midnight


def _check_in_window(
    bar_dates: list,
    bar_minutes: np.ndarray,
    evt_dt: datetime,
    window: int,
) -> np.ndarray:
    """Check which bars fall within ±window minutes of an event."""
    evt_date = evt_dt.date()
    evt_min = evt_dt.hour * 60 + evt_dt.minute
    n = len(bar_dates)

    result = np.zeros(n, dtype=bool)
    for i in range(n):
        if bar_dates[i] == evt_date:
            if abs(int(bar_minutes[i]) - evt_min) <= window:
                result[i] = True
    return result


def generate_event_mask(
    timestamps: pl.Series,
    policies: list[dict],
) -> np.ndarray:
    """Generate boolean mask — True = bar is within an event window (SIT_OUT).

    Args:
        timestamps: Polars Series of bar timestamps (UTC)
        policies: List of policy dicts with event_type, action, window_minutes

    Returns:
        numpy bool array, True where entries should be blocked
    """
    n = len(timestamps)
    mask = np.zeros(n, dtype=bool)

    events = _get_events_for_policies(policies)
    if not events:
        return mask

    bar_dates, bar_minutes = _timestamps_to_et_date_and_minutes(timestamps)

    for evt_dt, _, action, window in events:
        if action not in ("SIT_OUT", "REDUCE"):
            continue

        in_window = _check_in_window(bar_dates, bar_minutes, evt_dt, window)
        if action == "SIT_OUT":
            mask |= in_window

    return mask


def generate_size_reduction(
    timestamps: pl.Series,
    policies: list[dict],
) -> np.ndarray:
    """Generate size multiplier array — 1.0 normal, 0.5 REDUCE, 0.0 SIT_OUT.

    Args:
        timestamps: Polars Series of bar timestamps (UTC)
        policies: List of policy dicts

    Returns:
        numpy float array of size multipliers
    """
    n = len(timestamps)
    reduction = np.ones(n, dtype=np.float64)

    events = _get_events_for_policies(policies)
    if not events:
        return reduction

    bar_dates, bar_minutes = _timestamps_to_et_date_and_minutes(timestamps)

    for evt_dt, _, action, window in events:
        in_window = _check_in_window(bar_dates, bar_minutes, evt_dt, window)

        if action == "SIT_OUT":
            reduction[in_window] = 0.0
        elif action == "REDUCE":
            reduce_mask = in_window & (reduction > 0.0)
            reduction[reduce_mask] = np.minimum(reduction[reduce_mask], 0.5)

    return reduction


def get_event_slippage_multipliers(
    timestamps: pl.Series,
    policies: list[dict],
) -> np.ndarray:
    """Get slippage multipliers for event windows — 3.0x during events.

    Args:
        timestamps: Polars Series of bar timestamps (UTC)
        policies: List of policy dicts

    Returns:
        numpy float array of slippage multipliers (1.0 outside events, 3.0 inside)
    """
    n = len(timestamps)
    multipliers = np.ones(n, dtype=np.float64)

    events = _get_events_for_policies(policies)
    if not events:
        return multipliers

    bar_dates, bar_minutes = _timestamps_to_et_date_and_minutes(timestamps)

    for evt_dt, _, action, window in events:
        if action == "IGNORE":
            continue
        in_window = _check_in_window(bar_dates, bar_minutes, evt_dt, window)
        multipliers[in_window] = 3.0

    return multipliers
