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
    Product scope: EIA affects CL/MCL/QM ONLY (crude-energy traders per MFFU Feb-2026).

EVENT_PRODUCT_SCOPE (2026-07-08 scope fix — NOW ACTIVELY CONSUMED): separate dict keyed by
  event_type listing affected products, mirroring the TS reference of truth
  `news-policy.ts::eventAffectsSymbol`. Threaded through the shared chokepoint
  `_get_events_for_policies(policies, symbol)` so all three consumers (mask / size-reduction
  / slippage) product-scope events consistently. Convention:
    • FOMC / FOMC_MINUTES → ALL products    • CPI / NFP → equity-index ONLY    • EIA → crude ONLY
  Chosen over adding a 4th element to _ECONOMIC_EVENTS tuples because the existing tuple
  shape (date, time_et, name) is unpacked in multiple consumers; a separate map is
  non-invasive. (Was previously dead code — an EIA event blacked out index symbols and
  CPI/NFP had no index-only scoping. Fixed by threading a REQUIRED symbol param.)
"""

from __future__ import annotations

import sys
from datetime import date as _date, datetime, timedelta
from typing import Literal

import numpy as np
import polars as pl


# ─── Product scope map ────────────────────────────────────────────
# Ratified live convention (2026-07-08 scope fix) — the Python macro-blackout mask MUST
# agree with the TS reference of truth `src/server/lib/news-policy.ts::eventAffectsSymbol`
# across the known symbol universe.
# Convention (the pin — non-negotiable):
#   • FOMC / FOMC_MINUTES → ALL products (rate decisions move everything)
#   • CPI / NFP           → equity-INDEX products ONLY
#   • EIA                 → CRUDE products ONLY
#
# Keyed by event_type. Empty list = affects all products (no product filter).
# Non-empty list = the event affects ONLY the listed symbols.
# Separate from STATIC_EVENTS tuples to avoid breaking existing (date, time_et)
# unpack consumers.
#
# INDEX_SYMBOLS / CRUDE_SYMBOLS mirror the TS sets in news-policy.ts EXACTLY so the parity
# gate (scripts/check-ts-python-event-product-scope-parity.ts) holds across the full symbol
# universe. QM is included in CRUDE_SYMBOLS to match the TS set.
#
# GDP / PCE / ISM / PPI: historical data only (NOT T1 per Feb-2026 policy);
#   listed as empty list so non-blackout consumers can still query them (all products).
INDEX_SYMBOLS: list[str] = ["MES", "MNQ", "ES", "NQ", "M2K", "RTY", "MYM", "YM"]
CRUDE_SYMBOLS: list[str] = ["MCL", "CL", "QM"]

EVENT_PRODUCT_SCOPE: dict[str, list[str]] = {
    "FOMC":         [],             # all products
    "FOMC_MINUTES": [],             # all products
    "CPI":          INDEX_SYMBOLS,  # equity-index ONLY (matches TS eventAffectsSymbol)
    "NFP":          INDEX_SYMBOLS,  # equity-index ONLY (matches TS eventAffectsSymbol)
    "EIA":          CRUDE_SYMBOLS,  # crude ONLY — MCL/CL/QM (matches TS eventAffectsSymbol)
    "GDP":          [],             # NOT T1 per Feb-2026; kept for non-blackout reference
    "PCE":          [],             # NOT T1 per Feb-2026; kept for non-blackout reference
    "ISM":          [],             # NOT T1 per Feb-2026; kept for non-blackout reference
    "PPI":          [],             # NOT T1 per Feb-2026; kept for non-blackout reference
}

# Union of every symbol we can product-scope. A product-scoped event (CPI/NFP/EIA) with a
# symbol OUTSIDE this universe must fail loudly (never silently treat as all-or-none).
_KNOWN_PRODUCT_SYMBOLS: frozenset[str] = frozenset(INDEX_SYMBOLS) | frozenset(CRUDE_SYMBOLS)


def symbol_passes_event_scope(event_type: str, symbol: str) -> bool:
    """Whether a product-scoped event of `event_type` affects `symbol`.

    Mirrors TS `news-policy.ts::eventAffectsSymbol` exactly:
      • empty scope list (FOMC/FOMC_MINUTES/GDP/…) or unknown event_type → True (all products)
      • non-empty scope list (CPI/NFP → index, EIA → crude) → True iff symbol ∈ list

    Case-insensitive on both event_type and symbol, matching the TS `.toUpperCase()`.
    Pure — no I/O, no side effects. Used by the parity-gate subprocess.
    """
    scope = EVENT_PRODUCT_SCOPE.get((event_type or "").upper(), [])
    if not scope:
        return True  # empty list / unknown event type = affects all products
    return (symbol or "").upper() in scope


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
# 2024-2025 included so backtests on historical data have EIA windows too.
# ── EIA 2020-2023 backfill (Defect-9 Part B, 2026-07-07) ─────────────────────────
# Actual reported weeks pulled from EIA API v2 (series WCESTUS1, period=week-ending Fri);
# release = following Wednesday 10:30 ET, shifted to Thursday 11:00 ET when a federal
# holiday (observed) falls Mon/Tue/Wed of the release week. Improves on the Monday-only
# generate_eia_dates_for_year() shift (captures midweek Tue/Wed holidays it misses, e.g.
# Jul-4-2023 Tue → Thu Jul 6, Veterans Wed-Nov-11-2020 → Thu Nov 12). Neither the EIA API
# nor FRED exposes an actual release-timestamp endpoint — these dates are derived.
_EIA_2020_2023 = [
    {"date": "2020-01-02", "time_et": "11:00"},
    {"date": "2020-01-08", "time_et": "10:30"},
    {"date": "2020-01-15", "time_et": "10:30"},
    {"date": "2020-01-23", "time_et": "11:00"},
    {"date": "2020-01-29", "time_et": "10:30"},
    {"date": "2020-02-05", "time_et": "10:30"},
    {"date": "2020-02-12", "time_et": "10:30"},
    {"date": "2020-02-20", "time_et": "11:00"},
    {"date": "2020-02-26", "time_et": "10:30"},
    {"date": "2020-03-04", "time_et": "10:30"},
    {"date": "2020-03-11", "time_et": "10:30"},
    {"date": "2020-03-18", "time_et": "10:30"},
    {"date": "2020-03-25", "time_et": "10:30"},
    {"date": "2020-04-01", "time_et": "10:30"},
    {"date": "2020-04-08", "time_et": "10:30"},
    {"date": "2020-04-15", "time_et": "10:30"},
    {"date": "2020-04-22", "time_et": "10:30"},
    {"date": "2020-04-29", "time_et": "10:30"},
    {"date": "2020-05-06", "time_et": "10:30"},
    {"date": "2020-05-13", "time_et": "10:30"},
    {"date": "2020-05-20", "time_et": "10:30"},
    {"date": "2020-05-28", "time_et": "11:00"},
    {"date": "2020-06-03", "time_et": "10:30"},
    {"date": "2020-06-10", "time_et": "10:30"},
    {"date": "2020-06-17", "time_et": "10:30"},
    {"date": "2020-06-24", "time_et": "10:30"},
    {"date": "2020-07-01", "time_et": "10:30"},
    {"date": "2020-07-08", "time_et": "10:30"},
    {"date": "2020-07-15", "time_et": "10:30"},
    {"date": "2020-07-22", "time_et": "10:30"},
    {"date": "2020-07-29", "time_et": "10:30"},
    {"date": "2020-08-05", "time_et": "10:30"},
    {"date": "2020-08-12", "time_et": "10:30"},
    {"date": "2020-08-19", "time_et": "10:30"},
    {"date": "2020-08-26", "time_et": "10:30"},
    {"date": "2020-09-02", "time_et": "10:30"},
    {"date": "2020-09-10", "time_et": "11:00"},
    {"date": "2020-09-16", "time_et": "10:30"},
    {"date": "2020-09-23", "time_et": "10:30"},
    {"date": "2020-09-30", "time_et": "10:30"},
    {"date": "2020-10-07", "time_et": "10:30"},
    {"date": "2020-10-15", "time_et": "11:00"},
    {"date": "2020-10-21", "time_et": "10:30"},
    {"date": "2020-10-28", "time_et": "10:30"},
    {"date": "2020-11-04", "time_et": "10:30"},
    {"date": "2020-11-12", "time_et": "11:00"},
    {"date": "2020-11-18", "time_et": "10:30"},
    {"date": "2020-11-25", "time_et": "10:30"},
    {"date": "2020-12-02", "time_et": "10:30"},
    {"date": "2020-12-09", "time_et": "10:30"},
    {"date": "2020-12-16", "time_et": "10:30"},
    {"date": "2020-12-23", "time_et": "10:30"},
    {"date": "2020-12-30", "time_et": "10:30"},
    {"date": "2021-01-06", "time_et": "10:30"},
    {"date": "2021-01-13", "time_et": "10:30"},
    {"date": "2021-01-21", "time_et": "11:00"},
    {"date": "2021-01-27", "time_et": "10:30"},
    {"date": "2021-02-03", "time_et": "10:30"},
    {"date": "2021-02-10", "time_et": "10:30"},
    {"date": "2021-02-18", "time_et": "11:00"},
    {"date": "2021-02-24", "time_et": "10:30"},
    {"date": "2021-03-03", "time_et": "10:30"},
    {"date": "2021-03-10", "time_et": "10:30"},
    {"date": "2021-03-17", "time_et": "10:30"},
    {"date": "2021-03-24", "time_et": "10:30"},
    {"date": "2021-03-31", "time_et": "10:30"},
    {"date": "2021-04-07", "time_et": "10:30"},
    {"date": "2021-04-14", "time_et": "10:30"},
    {"date": "2021-04-21", "time_et": "10:30"},
    {"date": "2021-04-28", "time_et": "10:30"},
    {"date": "2021-05-05", "time_et": "10:30"},
    {"date": "2021-05-12", "time_et": "10:30"},
    {"date": "2021-05-19", "time_et": "10:30"},
    {"date": "2021-05-26", "time_et": "10:30"},
    {"date": "2021-06-03", "time_et": "11:00"},
    {"date": "2021-06-09", "time_et": "10:30"},
    {"date": "2021-06-16", "time_et": "10:30"},
    {"date": "2021-06-23", "time_et": "10:30"},
    {"date": "2021-06-30", "time_et": "10:30"},
    {"date": "2021-07-08", "time_et": "11:00"},
    {"date": "2021-07-14", "time_et": "10:30"},
    {"date": "2021-07-21", "time_et": "10:30"},
    {"date": "2021-07-28", "time_et": "10:30"},
    {"date": "2021-08-04", "time_et": "10:30"},
    {"date": "2021-08-11", "time_et": "10:30"},
    {"date": "2021-08-18", "time_et": "10:30"},
    {"date": "2021-08-25", "time_et": "10:30"},
    {"date": "2021-09-01", "time_et": "10:30"},
    {"date": "2021-09-09", "time_et": "11:00"},
    {"date": "2021-09-15", "time_et": "10:30"},
    {"date": "2021-09-22", "time_et": "10:30"},
    {"date": "2021-09-29", "time_et": "10:30"},
    {"date": "2021-10-06", "time_et": "10:30"},
    {"date": "2021-10-14", "time_et": "11:00"},
    {"date": "2021-10-20", "time_et": "10:30"},
    {"date": "2021-10-27", "time_et": "10:30"},
    {"date": "2021-11-03", "time_et": "10:30"},
    {"date": "2021-11-10", "time_et": "10:30"},
    {"date": "2021-11-17", "time_et": "10:30"},
    {"date": "2021-11-24", "time_et": "10:30"},
    {"date": "2021-12-01", "time_et": "10:30"},
    {"date": "2021-12-08", "time_et": "10:30"},
    {"date": "2021-12-15", "time_et": "10:30"},
    {"date": "2021-12-22", "time_et": "10:30"},
    {"date": "2021-12-29", "time_et": "10:30"},
    {"date": "2022-01-05", "time_et": "10:30"},
    {"date": "2022-01-12", "time_et": "10:30"},
    {"date": "2022-01-20", "time_et": "11:00"},
    {"date": "2022-01-26", "time_et": "10:30"},
    {"date": "2022-02-02", "time_et": "10:30"},
    {"date": "2022-02-09", "time_et": "10:30"},
    {"date": "2022-02-16", "time_et": "10:30"},
    {"date": "2022-02-24", "time_et": "11:00"},
    {"date": "2022-03-02", "time_et": "10:30"},
    {"date": "2022-03-09", "time_et": "10:30"},
    {"date": "2022-03-16", "time_et": "10:30"},
    {"date": "2022-03-23", "time_et": "10:30"},
    {"date": "2022-03-30", "time_et": "10:30"},
    {"date": "2022-04-06", "time_et": "10:30"},
    {"date": "2022-04-13", "time_et": "10:30"},
    {"date": "2022-04-20", "time_et": "10:30"},
    {"date": "2022-04-27", "time_et": "10:30"},
    {"date": "2022-05-04", "time_et": "10:30"},
    {"date": "2022-05-11", "time_et": "10:30"},
    {"date": "2022-05-18", "time_et": "10:30"},
    {"date": "2022-05-25", "time_et": "10:30"},
    {"date": "2022-06-02", "time_et": "11:00"},
    {"date": "2022-06-08", "time_et": "10:30"},
    {"date": "2022-06-15", "time_et": "10:30"},
    {"date": "2022-06-23", "time_et": "11:00"},
    {"date": "2022-06-29", "time_et": "10:30"},
    {"date": "2022-07-07", "time_et": "11:00"},
    {"date": "2022-07-13", "time_et": "10:30"},
    {"date": "2022-07-20", "time_et": "10:30"},
    {"date": "2022-07-27", "time_et": "10:30"},
    {"date": "2022-08-03", "time_et": "10:30"},
    {"date": "2022-08-10", "time_et": "10:30"},
    {"date": "2022-08-17", "time_et": "10:30"},
    {"date": "2022-08-24", "time_et": "10:30"},
    {"date": "2022-08-31", "time_et": "10:30"},
    {"date": "2022-09-08", "time_et": "11:00"},
    {"date": "2022-09-14", "time_et": "10:30"},
    {"date": "2022-09-21", "time_et": "10:30"},
    {"date": "2022-09-28", "time_et": "10:30"},
    {"date": "2022-10-05", "time_et": "10:30"},
    {"date": "2022-10-13", "time_et": "11:00"},
    {"date": "2022-10-19", "time_et": "10:30"},
    {"date": "2022-10-26", "time_et": "10:30"},
    {"date": "2022-11-02", "time_et": "10:30"},
    {"date": "2022-11-09", "time_et": "10:30"},
    {"date": "2022-11-16", "time_et": "10:30"},
    {"date": "2022-11-23", "time_et": "10:30"},
    {"date": "2022-11-30", "time_et": "10:30"},
    {"date": "2022-12-07", "time_et": "10:30"},
    {"date": "2022-12-14", "time_et": "10:30"},
    {"date": "2022-12-21", "time_et": "10:30"},
    {"date": "2022-12-29", "time_et": "11:00"},
    {"date": "2023-01-05", "time_et": "11:00"},
    {"date": "2023-01-11", "time_et": "10:30"},
    {"date": "2023-01-19", "time_et": "11:00"},
    {"date": "2023-01-25", "time_et": "10:30"},
    {"date": "2023-02-01", "time_et": "10:30"},
    {"date": "2023-02-08", "time_et": "10:30"},
    {"date": "2023-02-15", "time_et": "10:30"},
    {"date": "2023-02-23", "time_et": "11:00"},
    {"date": "2023-03-01", "time_et": "10:30"},
    {"date": "2023-03-08", "time_et": "10:30"},
    {"date": "2023-03-15", "time_et": "10:30"},
    {"date": "2023-03-22", "time_et": "10:30"},
    {"date": "2023-03-29", "time_et": "10:30"},
    {"date": "2023-04-05", "time_et": "10:30"},
    {"date": "2023-04-12", "time_et": "10:30"},
    {"date": "2023-04-19", "time_et": "10:30"},
    {"date": "2023-04-26", "time_et": "10:30"},
    {"date": "2023-05-03", "time_et": "10:30"},
    {"date": "2023-05-10", "time_et": "10:30"},
    {"date": "2023-05-17", "time_et": "10:30"},
    {"date": "2023-05-24", "time_et": "10:30"},
    {"date": "2023-06-01", "time_et": "11:00"},
    {"date": "2023-06-07", "time_et": "10:30"},
    {"date": "2023-06-14", "time_et": "10:30"},
    {"date": "2023-06-22", "time_et": "11:00"},
    {"date": "2023-06-28", "time_et": "10:30"},
    {"date": "2023-07-06", "time_et": "11:00"},
    {"date": "2023-07-12", "time_et": "10:30"},
    {"date": "2023-07-19", "time_et": "10:30"},
    {"date": "2023-07-26", "time_et": "10:30"},
    {"date": "2023-08-02", "time_et": "10:30"},
    {"date": "2023-08-09", "time_et": "10:30"},
    {"date": "2023-08-16", "time_et": "10:30"},
    {"date": "2023-08-23", "time_et": "10:30"},
    {"date": "2023-08-30", "time_et": "10:30"},
    {"date": "2023-09-07", "time_et": "11:00"},
    {"date": "2023-09-13", "time_et": "10:30"},
    {"date": "2023-09-20", "time_et": "10:30"},
    {"date": "2023-09-27", "time_et": "10:30"},
    {"date": "2023-10-04", "time_et": "10:30"},
    {"date": "2023-10-12", "time_et": "11:00"},
    {"date": "2023-10-18", "time_et": "10:30"},
    {"date": "2023-10-25", "time_et": "10:30"},
    {"date": "2023-11-01", "time_et": "10:30"},
    {"date": "2023-11-08", "time_et": "10:30"},
    {"date": "2023-11-15", "time_et": "10:30"},
    {"date": "2023-11-22", "time_et": "10:30"},
    {"date": "2023-11-29", "time_et": "10:30"},
    {"date": "2023-12-06", "time_et": "10:30"},
    {"date": "2023-12-13", "time_et": "10:30"},
    {"date": "2023-12-20", "time_et": "10:30"},
    {"date": "2023-12-28", "time_et": "11:00"},
]

_EIA_2024 = generate_eia_dates_for_year(2024)
_EIA_2025 = generate_eia_dates_for_year(2025)
_EIA_2026 = generate_eia_dates_for_year(2026)
_EIA_2027 = generate_eia_dates_for_year(2027)


# ─── Static Event Calendar (2023-2027) ───────────────────────────
# All times in ET. Only high-impact events that move futures.
# T1 per MFFU Feb-2026 policy: FOMC, FOMC_MINUTES, CPI, NFP, EIA (energy).
# Historical reference (non-T1 per Feb-2026): GDP, PCE, ISM, PPI.

STATIC_EVENTS: dict[str, list[dict]] = {
    "FOMC": [
        # 2020 (7 scheduled FOMC announcements — NO March; the Mar 3 intermeeting cut and
        # Mar 15 Sunday emergency cut are UNSCHEDULED and EXCLUDED; the scheduled Mar 17-18
        # 2020 meeting was cancelled — Defect-9 Part B backfill 2026-07-07)
        {"date": "2020-01-29", "time_et": "14:00"},
        {"date": "2020-04-29", "time_et": "14:00"},
        {"date": "2020-06-10", "time_et": "14:00"},
        {"date": "2020-07-29", "time_et": "14:00"},
        {"date": "2020-09-16", "time_et": "14:00"},
        {"date": "2020-11-05", "time_et": "14:00"},
        {"date": "2020-12-16", "time_et": "14:00"},
        # 2021 (Defect-9 Part B backfill)
        {"date": "2021-01-27", "time_et": "14:00"},
        {"date": "2021-03-17", "time_et": "14:00"},
        {"date": "2021-04-28", "time_et": "14:00"},
        {"date": "2021-06-16", "time_et": "14:00"},
        {"date": "2021-07-28", "time_et": "14:00"},
        {"date": "2021-09-22", "time_et": "14:00"},
        {"date": "2021-11-03", "time_et": "14:00"},
        {"date": "2021-12-15", "time_et": "14:00"},
        # 2022 (Defect-9 Part B backfill)
        {"date": "2022-01-26", "time_et": "14:00"},
        {"date": "2022-03-16", "time_et": "14:00"},
        {"date": "2022-05-04", "time_et": "14:00"},
        {"date": "2022-06-15", "time_et": "14:00"},
        {"date": "2022-07-27", "time_et": "14:00"},
        {"date": "2022-09-21", "time_et": "14:00"},
        {"date": "2022-11-02", "time_et": "14:00"},
        {"date": "2022-12-14", "time_et": "14:00"},
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
        {"date": "2025-10-29", "time_et": "14:00"},  # corrected from 2025-11-05 (D1)
        {"date": "2025-12-10", "time_et": "14:00"},  # corrected from 2025-12-17 (D1)
        # 2026
        {"date": "2026-01-28", "time_et": "14:00"},
        {"date": "2026-03-18", "time_et": "14:00"},
        {"date": "2026-04-29", "time_et": "14:00"},  # corrected from 2026-05-06 (D1)
        {"date": "2026-06-17", "time_et": "14:00"},
        {"date": "2026-07-29", "time_et": "14:00"},
        {"date": "2026-09-16", "time_et": "14:00"},
        {"date": "2026-10-28", "time_et": "14:00"},  # corrected from 2026-11-04 (D1)
        {"date": "2026-12-09", "time_et": "14:00"},  # corrected from 2026-12-16 (D1)
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
        # 2020-2023 (Defect-9 Part B backfill — FRED release_id 10; Feb seasonal-adj revision deduped)
        {"date": "2020-01-14", "time_et": "08:30"},
        {"date": "2020-02-13", "time_et": "08:30"},
        {"date": "2020-03-11", "time_et": "08:30"},
        {"date": "2020-04-10", "time_et": "08:30"},
        {"date": "2020-05-12", "time_et": "08:30"},
        {"date": "2020-06-10", "time_et": "08:30"},
        {"date": "2020-07-14", "time_et": "08:30"},
        {"date": "2020-08-12", "time_et": "08:30"},
        {"date": "2020-09-11", "time_et": "08:30"},
        {"date": "2020-10-13", "time_et": "08:30"},
        {"date": "2020-11-12", "time_et": "08:30"},
        {"date": "2020-12-10", "time_et": "08:30"},
        {"date": "2021-01-13", "time_et": "08:30"},
        {"date": "2021-02-10", "time_et": "08:30"},
        {"date": "2021-03-10", "time_et": "08:30"},
        {"date": "2021-04-13", "time_et": "08:30"},
        {"date": "2021-05-12", "time_et": "08:30"},
        {"date": "2021-06-10", "time_et": "08:30"},
        {"date": "2021-07-13", "time_et": "08:30"},
        {"date": "2021-08-11", "time_et": "08:30"},
        {"date": "2021-09-14", "time_et": "08:30"},
        {"date": "2021-10-13", "time_et": "08:30"},
        {"date": "2021-11-10", "time_et": "08:30"},
        {"date": "2021-12-10", "time_et": "08:30"},
        {"date": "2022-01-12", "time_et": "08:30"},
        {"date": "2022-02-10", "time_et": "08:30"},
        {"date": "2022-03-10", "time_et": "08:30"},
        {"date": "2022-04-12", "time_et": "08:30"},
        {"date": "2022-05-11", "time_et": "08:30"},
        {"date": "2022-06-10", "time_et": "08:30"},
        {"date": "2022-07-13", "time_et": "08:30"},
        {"date": "2022-08-10", "time_et": "08:30"},
        {"date": "2022-09-13", "time_et": "08:30"},
        {"date": "2022-10-13", "time_et": "08:30"},
        {"date": "2022-11-10", "time_et": "08:30"},
        {"date": "2022-12-13", "time_et": "08:30"},
        {"date": "2023-01-12", "time_et": "08:30"},
        {"date": "2023-02-14", "time_et": "08:30"},
        {"date": "2023-03-14", "time_et": "08:30"},
        {"date": "2023-04-12", "time_et": "08:30"},
        {"date": "2023-05-10", "time_et": "08:30"},
        {"date": "2023-06-13", "time_et": "08:30"},
        {"date": "2023-07-12", "time_et": "08:30"},
        {"date": "2023-08-10", "time_et": "08:30"},
        {"date": "2023-09-13", "time_et": "08:30"},
        {"date": "2023-10-12", "time_et": "08:30"},
        {"date": "2023-11-14", "time_et": "08:30"},
        {"date": "2023-12-12", "time_et": "08:30"},
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
        {"date": "2026-04-10", "time_et": "08:30"},  # corrected from 2026-04-14 (D1)
        {"date": "2026-05-12", "time_et": "08:30"},
        {"date": "2026-06-10", "time_et": "08:30"},
        {"date": "2026-07-14", "time_et": "08:30"},
        {"date": "2026-08-12", "time_et": "08:30"},
        {"date": "2026-09-11", "time_et": "08:30"},  # corrected from 2026-09-15 (D1)
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
        # 2020-2023 (Defect-9 Part B backfill — FRED release_id 50; Friday-filter dedup)
        {"date": "2020-01-10", "time_et": "08:30"},
        {"date": "2020-02-07", "time_et": "08:30"},
        {"date": "2020-03-06", "time_et": "08:30"},
        {"date": "2020-04-03", "time_et": "08:30"},
        {"date": "2020-05-08", "time_et": "08:30"},
        {"date": "2020-06-05", "time_et": "08:30"},
        {"date": "2020-07-02", "time_et": "08:30"},
        {"date": "2020-08-07", "time_et": "08:30"},
        {"date": "2020-09-04", "time_et": "08:30"},
        {"date": "2020-10-02", "time_et": "08:30"},
        {"date": "2020-11-06", "time_et": "08:30"},
        {"date": "2020-12-04", "time_et": "08:30"},
        {"date": "2021-01-08", "time_et": "08:30"},
        {"date": "2021-02-05", "time_et": "08:30"},
        {"date": "2021-03-05", "time_et": "08:30"},
        {"date": "2021-04-02", "time_et": "08:30"},
        {"date": "2021-05-07", "time_et": "08:30"},
        {"date": "2021-06-04", "time_et": "08:30"},
        {"date": "2021-07-02", "time_et": "08:30"},
        {"date": "2021-08-06", "time_et": "08:30"},
        {"date": "2021-09-03", "time_et": "08:30"},
        {"date": "2021-10-08", "time_et": "08:30"},
        {"date": "2021-11-05", "time_et": "08:30"},
        {"date": "2021-12-03", "time_et": "08:30"},
        {"date": "2022-01-07", "time_et": "08:30"},
        {"date": "2022-02-04", "time_et": "08:30"},
        {"date": "2022-03-04", "time_et": "08:30"},
        {"date": "2022-04-01", "time_et": "08:30"},
        {"date": "2022-05-06", "time_et": "08:30"},
        {"date": "2022-06-03", "time_et": "08:30"},
        {"date": "2022-07-08", "time_et": "08:30"},
        {"date": "2022-08-05", "time_et": "08:30"},
        {"date": "2022-09-02", "time_et": "08:30"},
        {"date": "2022-10-07", "time_et": "08:30"},
        {"date": "2022-11-04", "time_et": "08:30"},
        {"date": "2022-12-02", "time_et": "08:30"},
        {"date": "2023-01-06", "time_et": "08:30"},
        {"date": "2023-02-03", "time_et": "08:30"},
        {"date": "2023-03-10", "time_et": "08:30"},
        {"date": "2023-04-07", "time_et": "08:30"},
        {"date": "2023-05-05", "time_et": "08:30"},
        {"date": "2023-06-02", "time_et": "08:30"},
        {"date": "2023-07-07", "time_et": "08:30"},
        {"date": "2023-08-04", "time_et": "08:30"},
        {"date": "2023-09-01", "time_et": "08:30"},
        {"date": "2023-10-06", "time_et": "08:30"},
        {"date": "2023-11-03", "time_et": "08:30"},
        {"date": "2023-12-08", "time_et": "08:30"},
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
        {"date": "2026-07-10", "time_et": "08:30"},  # corrected from 2026-07-02 (D1 — Jul 3 is observed Independence Day, push to Jul 10)
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
    #
    # 2020-2025 rows are ARCHIVAL FACTS — the exact "Minutes: (Released Month DD,
    # YYYY)" release date the Fed published for each SCHEDULED meeting, TRANSCRIBED
    # (not +21-derived). Primary sources (federalreserve.gov):
    #   fomccalendars.htm                (2021-2026 "Released ..." release dates)
    #   fomchistorical2020.htm           (2020 archival — historical materials lag)
    # Minutes drop at 2:00 PM ET, normally exactly 3 weeks after the meeting's
    # decision day; a handful land 1-2 days EARLY when +21 would fall on/after a
    # holiday (2020-11-25, 2023-11-21, 2024-11-26, 2025-12-30 = pre-Thanksgiving /
    # pre-New-Year shifts). The transcribed archival date wins over the arithmetic.
    #
    # SCHEDULED-MEETINGS ONLY: the March-2020 emergency actions (Mar 2 conference
    # call + Mar 15 unscheduled cut that replaced the cancelled Mar 17-18 scheduled
    # meeting; their minutes were released Apr 8, 2020) are EXCLUDED — the macro
    # instrument covers scheduled-meeting artifacts only. That is why 2020 has 7
    # rows, not 8 (this mirrors the March-2020 emergency FOMC-statement exclusion).
    #
    # 2026 rows dated <= 2026-07-09 are ARCHIVAL (actual Fed release dates verified
    # on fomccalendars.htm). Rows dated after 2026-07-09 remain the "~3 weeks after
    # FOMC" (+21) FUTURE approximation and may shift 1-3 days; replace each with its
    # archival date as the Minutes are published.
    # TODO: verify future-projection rows against fomccalendars.htm as they release.
    "FOMC_MINUTES": [
        # ── 2020 archival (fomchistorical2020.htm; March emergency EXCLUDED) ──
        {"date": "2020-02-19", "time_et": "14:00"},  # Jan 28-29 mtg
        {"date": "2020-05-20", "time_et": "14:00"},  # Apr 28-29 mtg
        {"date": "2020-07-01", "time_et": "14:00"},  # Jun 9-10 mtg
        {"date": "2020-08-19", "time_et": "14:00"},  # Jul 28-29 mtg
        {"date": "2020-10-07", "time_et": "14:00"},  # Sep 15-16 mtg
        {"date": "2020-11-25", "time_et": "14:00"},  # Nov 4-5 mtg (early: +21 = Nov 26, pre-Thanksgiving)
        {"date": "2021-01-06", "time_et": "14:00"},  # Dec 15-16, 2020 mtg
        # ── 2021 archival (fomccalendars.htm) ──
        {"date": "2021-02-17", "time_et": "14:00"},  # Jan 26-27 mtg
        {"date": "2021-04-07", "time_et": "14:00"},  # Mar 16-17 mtg
        {"date": "2021-05-19", "time_et": "14:00"},  # Apr 27-28 mtg
        {"date": "2021-07-07", "time_et": "14:00"},  # Jun 15-16 mtg
        {"date": "2021-08-18", "time_et": "14:00"},  # Jul 27-28 mtg
        {"date": "2021-10-13", "time_et": "14:00"},  # Sep 21-22 mtg
        {"date": "2021-11-24", "time_et": "14:00"},  # Nov 2-3 mtg (Wed pre-Thanksgiving)
        {"date": "2022-01-05", "time_et": "14:00"},  # Dec 14-15, 2021 mtg
        # ── 2022 archival (fomccalendars.htm) ──
        {"date": "2022-02-16", "time_et": "14:00"},  # Jan 25-26 mtg
        {"date": "2022-04-06", "time_et": "14:00"},  # Mar 15-16 mtg
        {"date": "2022-05-25", "time_et": "14:00"},  # May 3-4 mtg
        {"date": "2022-07-06", "time_et": "14:00"},  # Jun 14-15 mtg
        {"date": "2022-08-17", "time_et": "14:00"},  # Jul 26-27 mtg
        {"date": "2022-10-12", "time_et": "14:00"},  # Sep 20-21 mtg
        {"date": "2022-11-23", "time_et": "14:00"},  # Nov 1-2 mtg (Wed pre-Thanksgiving)
        {"date": "2023-01-04", "time_et": "14:00"},  # Dec 13-14, 2022 mtg
        # ── 2023 archival (fomccalendars.htm) ──
        {"date": "2023-02-22", "time_et": "14:00"},  # Jan 31-Feb 1 mtg
        {"date": "2023-04-12", "time_et": "14:00"},  # Mar 21-22 mtg
        {"date": "2023-05-24", "time_et": "14:00"},  # May 2-3 mtg
        {"date": "2023-07-05", "time_et": "14:00"},  # Jun 13-14 mtg
        {"date": "2023-08-16", "time_et": "14:00"},  # Jul 25-26 mtg
        {"date": "2023-10-11", "time_et": "14:00"},  # Sep 19-20 mtg
        {"date": "2023-11-21", "time_et": "14:00"},  # Oct 31-Nov 1 mtg (early: +21 = Nov 22, pre-Thanksgiving)
        {"date": "2024-01-03", "time_et": "14:00"},  # Dec 12-13, 2023 mtg
        # ── 2024 archival (fomccalendars.htm) ──
        {"date": "2024-02-21", "time_et": "14:00"},  # Jan 30-31 mtg
        {"date": "2024-04-10", "time_et": "14:00"},  # Mar 19-20 mtg
        {"date": "2024-05-22", "time_et": "14:00"},  # Apr 30-May 1 mtg
        {"date": "2024-07-03", "time_et": "14:00"},  # Jun 11-12 mtg (Wed pre-July 4)
        {"date": "2024-08-21", "time_et": "14:00"},  # Jul 30-31 mtg
        {"date": "2024-10-09", "time_et": "14:00"},  # Sep 17-18 mtg
        {"date": "2024-11-26", "time_et": "14:00"},  # Nov 6-7 mtg (early: +21 = Nov 28, pre-Thanksgiving)
        {"date": "2025-01-08", "time_et": "14:00"},  # Dec 17-18, 2024 mtg
        # ── 2025 archival (fomccalendars.htm) ──
        {"date": "2025-02-19", "time_et": "14:00"},  # Jan 28-29 mtg
        {"date": "2025-04-09", "time_et": "14:00"},  # Mar 18-19 mtg
        {"date": "2025-05-28", "time_et": "14:00"},  # May 6-7 mtg
        {"date": "2025-07-09", "time_et": "14:00"},  # Jun 17-18 mtg
        {"date": "2025-08-20", "time_et": "14:00"},  # Jul 29-30 mtg
        {"date": "2025-10-08", "time_et": "14:00"},  # Sep 16-17 mtg
        {"date": "2025-11-19", "time_et": "14:00"},  # Oct 28-29 mtg
        {"date": "2025-12-30", "time_et": "14:00"},  # Dec 9-10 mtg (early: +21 = Dec 31, pre-New-Year)
        # 2026 — rows <= 2026-07-09 are ARCHIVAL; later rows are +21 FUTURE approx
        # Jan 27-28 mtg — ARCHIVAL release Feb 18, 2026 (fomccalendars.htm)
        {"date": "2026-02-18", "time_et": "14:00"},
        # Mar 17-18 mtg — ARCHIVAL release Apr 8, 2026 (fomccalendars.htm)
        {"date": "2026-04-08", "time_et": "14:00"},
        # Apr 28-29 mtg — ARCHIVAL release May 20, 2026 (fomccalendars.htm)
        #   REPAIRED from 2026-05-27, which was +21 off the SUPERSEDED May 6 mtg date
        {"date": "2026-05-20", "time_et": "14:00"},
        # Jun 16-17 mtg — ARCHIVAL release Jul 8, 2026 (fomccalendars.htm)
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
    "EIA": _EIA_2020_2023 + _EIA_2024 + _EIA_2025 + _EIA_2026 + _EIA_2027,
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


# ─── Authoritative synced calendar (backtest/live parity, 2026-06-23) ──────────
# The backtest event mask previously read the hardcoded STATIC_EVENTS, several of which
# were projected/WRONG (FOMC 2026 May 6/Nov 4/Dec 16 vs the Fed's Apr 29/Oct 28/Dec 9).
# economic-calendar-sync-service.ts syncs authoritative dates (FRED/Fed/EIA) into the
# `economic_release_dates` table (which the live TS gate reads) AND writes a JSON snapshot
# at src/engine/economic_release_dates.json. We read that JSON here — no DB driver needed
# (the tower Python has no psycopg2) — so backtest dates == live dates. FAIL-SAFE: missing/
# unreadable JSON falls back to the hardcoded STATIC_EVENTS.
_AUTH_EVENTS_CACHE: dict | None = None
_AUTH_EVENTS_LOADED = False


def _load_authoritative_events() -> dict | None:
    """Load synced release dates from the JSON snapshot. None on any failure (→ STATIC_EVENTS)."""
    global _AUTH_EVENTS_CACHE, _AUTH_EVENTS_LOADED
    if _AUTH_EVENTS_LOADED:
        return _AUTH_EVENTS_CACHE
    _AUTH_EVENTS_LOADED = True  # attempt at most once per process
    try:
        import os
        import json
        # JSON lives next to this module: src/engine/economic_release_dates.json
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "economic_release_dates.json")
        if not os.path.exists(path):
            return None
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        # Expected shape: {"events": [{"event_type","date","time_et"}, ...]}
        rows = data.get("events", []) if isinstance(data, dict) else []
        if not rows:
            return None
        out: dict[str, list[dict]] = {}
        for r in rows:
            et = r.get("event_type")
            if not et:
                continue
            out.setdefault(et, []).append({"date": r["date"], "time_et": r["time_et"]})
        _AUTH_EVENTS_CACHE = out
        return out
    except Exception:
        return None  # fail-safe → hardcoded STATIC_EVENTS


def _events_for_type(event_type: str) -> list[dict]:
    """Authoritative events for a type: synced JSON (FRED/Fed/EIA) if available, else hardcoded."""
    auth = _load_authoritative_events()
    if auth is not None and event_type in auth:
        return auth[event_type]
    return STATIC_EVENTS.get(event_type, [])


def _get_events_for_policies(
    policies: list[dict],
    symbol: str,
) -> list[tuple[datetime, str, str, int]]:
    """Build flat list of (event_dt_et, event_type, action, window_min) for `symbol`.

    Shared chokepoint for all three consumers (mask / size-reduction / slippage) so the
    per-symbol product scope is applied consistently. A policy's event is included ONLY
    when `symbol_passes_event_scope(event_type, symbol)` — so an EIA (crude) event does not
    black out an index symbol, and CPI/NFP only affect index products (matches the TS
    reference `news-policy.ts::eventAffectsSymbol`).

    SYMBOL REQUIRED, NEVER GUESS:
      • symbol is None → ValueError (callers must thread the real backtest symbol).
      • a product-scoped event (CPI/NFP/EIA) is in the policy set AND symbol is outside the
        known product universe → ValueError (refuse to guess scope). All-products events
        (FOMC/FOMC_MINUTES) accept any non-None symbol.

    Reads authoritative DB dates (economic_release_dates) per event type, falling back to
    the hardcoded STATIC_EVENTS — so backtest dates match the live gate.
    """
    if symbol is None:
        raise ValueError(
            "economic_calendar: symbol is REQUIRED for event-product scoping "
            "(never guess). Pass the backtest/strategy symbol into "
            "generate_event_mask / generate_size_reduction / get_event_slippage_multipliers."
        )

    sym = symbol.upper()

    # If any product-scoped event (CPI/NFP/EIA) is in the policy set, the symbol MUST be a
    # recognized product — otherwise we cannot decide scope and must fail loudly rather than
    # silently treat it as all-or-none.
    has_product_scoped = any(
        EVENT_PRODUCT_SCOPE.get((p["event_type"] or "").upper(), [])
        for p in policies
    )
    if has_product_scoped and sym not in _KNOWN_PRODUCT_SYMBOLS:
        raise ValueError(
            f"economic_calendar: symbol {symbol!r} is not in the known product universe "
            f"(index={INDEX_SYMBOLS}, crude={CRUDE_SYMBOLS}) but a product-scoped event "
            f"(CPI/NFP/EIA) is in the policy set. Refusing to guess product scope."
        )

    events = []
    for policy in policies:
        event_type = policy["event_type"]
        # Per-symbol product filter — the single, consistent scoping chokepoint.
        if not symbol_passes_event_scope(event_type, sym):
            continue
        action = policy.get("action", "SIT_OUT")
        window = policy.get("window_minutes", 30)

        for evt in _events_for_type(event_type):
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
    symbol: str,
) -> np.ndarray:
    """Generate boolean mask — True = bar is within an event window (SIT_OUT).

    Args:
        timestamps: Polars Series of bar timestamps (UTC)
        policies: List of policy dicts with event_type, action, window_minutes
        symbol: REQUIRED — the product symbol (e.g. "MES"/"MCL"). Used to product-scope
            events (an EIA event does not mask an index symbol; CPI/NFP mask index only).
            None → ValueError; unknown symbol with a product-scoped event → ValueError.

    Returns:
        numpy bool array, True where entries should be blocked
    """
    n = len(timestamps)
    mask = np.zeros(n, dtype=bool)

    events = _get_events_for_policies(policies, symbol)
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
    symbol: str,
) -> np.ndarray:
    """Generate size multiplier array — 1.0 normal, 0.5 REDUCE, 0.0 SIT_OUT.

    Args:
        timestamps: Polars Series of bar timestamps (UTC)
        policies: List of policy dicts
        symbol: REQUIRED — the product symbol used to product-scope events (see
            generate_event_mask). None → ValueError; unknown symbol with a product-scoped
            event → ValueError.

    Returns:
        numpy float array of size multipliers
    """
    n = len(timestamps)
    reduction = np.ones(n, dtype=np.float64)

    events = _get_events_for_policies(policies, symbol)
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
    symbol: str,
) -> np.ndarray:
    """Get slippage multipliers for event windows — 3.0x during events.

    Args:
        timestamps: Polars Series of bar timestamps (UTC)
        policies: List of policy dicts
        symbol: REQUIRED — the product symbol used to product-scope events (see
            generate_event_mask). None → ValueError; unknown symbol with a product-scoped
            event → ValueError.

    Returns:
        numpy float array of slippage multipliers (1.0 outside events, 3.0 inside)
    """
    n = len(timestamps)
    multipliers = np.ones(n, dtype=np.float64)

    events = _get_events_for_policies(policies, symbol)
    if not events:
        return multipliers

    bar_dates, bar_minutes = _timestamps_to_et_date_and_minutes(timestamps)

    for evt_dt, _, action, window in events:
        if action == "IGNORE":
            continue
        in_window = _check_in_window(bar_dates, bar_minutes, evt_dt, window)
        multipliers[in_window] = 3.0

    return multipliers
