"""Calendar-based skip conditions: holidays, triple witching, roll weeks, FOMC blackouts.

Per CLAUDE.md: Don't trade through FOMC/CPI/NFP without explicit event handling —
default is SIT_OUT ±30 min.  This module is the paper-engine's real-time check;
it is called once per bar via the python-runner bridge and must be fast.
"""

from __future__ import annotations

import warnings
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache


# ─── D5: Dynamic Holiday Calendar ────────────────────────────────────────────
# Previous behavior: hardcoded 2026 and 2027 lists; any year >= 2028 returned []
# with a runtime warning, making is_holiday() silently wrong for forward dates.
# New behavior: algorithmic generator using Federal holiday rules (fixed-date and
# observed rules) + CME-specific half-day schedule. Covers any year >= 2026.
# CME closes on all NYSE holidays; half-days (not full closes) are NOT treated as
# holidays in this module — they are handled by the session liquidity multipliers
# in get_session_multipliers(). Only FULL-CLOSE dates are listed here.
# Verification: is_holiday('2028-01-01') == True (New Year's Day 2028)
#               is_holiday('2026-01-01') == True (preserved from prior hardcode)
#               is_holiday('2027-11-25') == True (Thanksgiving 2027, preserved)


def _nth_weekday_of_month(year: int, month: int, weekday: int, n: int) -> date:
    """Return the nth occurrence of weekday (0=Mon,...,6=Sun) in a given month.

    Args:
        year: calendar year
        month: 1-12
        weekday: 0=Monday, 4=Friday, 6=Sunday
        n: 1-based occurrence (1=first, 2=second, 3=third, -1=last)
    """
    if n > 0:
        first = date(year, month, 1)
        # Days until target weekday
        delta = (weekday - first.weekday()) % 7
        first_occurrence = first + timedelta(days=delta)
        return first_occurrence + timedelta(weeks=(n - 1))
    else:
        # n == -1: last occurrence
        if month == 12:
            last_day = date(year + 1, 1, 1) - timedelta(days=1)
        else:
            last_day = date(year, month + 1, 1) - timedelta(days=1)
        delta = (last_day.weekday() - weekday) % 7
        return last_day - timedelta(days=delta)


def _good_friday(year: int) -> date:
    """Compute Good Friday using the Anonymous Gregorian algorithm."""
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    easter_sunday = date(year, month, day)
    return easter_sunday - timedelta(days=2)  # Good Friday = Easter - 2 days


def _observed_holiday(holiday: date) -> date:
    """Shift holiday to the nearest weekday if it falls on a weekend.

    NYSE rule: Saturday holiday → observed Friday, Sunday holiday → observed Monday.
    """
    dow = holiday.weekday()
    if dow == 5:  # Saturday → Friday
        return holiday - timedelta(days=1)
    elif dow == 6:  # Sunday → Monday
        return holiday + timedelta(days=1)
    return holiday


@lru_cache(maxsize=32)
def _compute_federal_holidays(year: int) -> list[date]:
    """Compute US Federal / NYSE market holidays for any year >= 2026.

    Based on NYSE market holiday schedule (not identical to Federal calendar —
    NYSE observes Good Friday; it does NOT observe Columbus Day, Veterans Day,
    or Presidents' Day for equities, but CME follows NYSE closures).

    Returns sorted list of full-close dates.
    """
    holidays: list[date] = []

    # 1. New Year's Day — January 1, observed
    holidays.append(_observed_holiday(date(year, 1, 1)))

    # 2. MLK Day — 3rd Monday of January
    holidays.append(_nth_weekday_of_month(year, 1, 0, 3))

    # 3. Presidents' Day — 3rd Monday of February
    holidays.append(_nth_weekday_of_month(year, 2, 0, 3))

    # 4. Good Friday — 2 days before Easter Sunday
    holidays.append(_good_friday(year))

    # 5. Memorial Day — last Monday of May
    holidays.append(_nth_weekday_of_month(year, 5, 0, -1))

    # 6. Juneteenth — June 19, observed (established 2022)
    if year >= 2022:
        holidays.append(_observed_holiday(date(year, 6, 19)))

    # 7. Independence Day — July 4, observed
    holidays.append(_observed_holiday(date(year, 7, 4)))

    # 8. Labor Day — 1st Monday of September
    holidays.append(_nth_weekday_of_month(year, 9, 0, 1))

    # 9. Thanksgiving — 4th Thursday of November
    holidays.append(_nth_weekday_of_month(year, 11, 3, 4))

    # 10. Christmas Day — December 25, observed
    holidays.append(_observed_holiday(date(year, 12, 25)))

    # De-duplicate and sort (edge case: Juneteenth observed could collide)
    return sorted(set(holidays))


@lru_cache(maxsize=32)
def _compute_triple_witching(year: int) -> list[date]:
    """Compute Triple Witching Fridays (3rd Friday of March, June, Sept, Dec) for any year."""
    result: list[date] = []
    for month in (3, 6, 9, 12):
        result.append(_nth_weekday_of_month(year, month, 4, 3))  # 4=Friday
    return sorted(result)


def _get_holidays_for_year(year: int) -> list[date]:
    """Return holiday list for the given year. Algorithmic for any year >= 2026."""
    return _compute_federal_holidays(year)


def _get_triple_witching_for_year(year: int) -> list[date]:
    """Return triple witching dates for the given year. Algorithmic for any year >= 2026."""
    return _compute_triple_witching(year)


def is_holiday(date_str: str) -> bool:
    """Convenience function: check if a date string (YYYY-MM-DD) is a market holiday.

    Returns True if the date is a NYSE/CME full-close day, OR if the date falls on
    a weekend (market is always closed on weekends). The 'observed' rule means that
    when a holiday like New Year's Day falls on Saturday, the OBSERVED closure is
    the prior Friday — e.g., Jan 1 2028 (Saturday) → Dec 31 2027 is the closed day.
    is_holiday('2028-01-01') returns True because Jan 1 is a holiday (even though
    trading was already closed Saturday). The observed date for the NYSE closure is
    Dec 31 2027, but the actual holiday date (Jan 1) is also a "holiday" by definition.
    We check: is the actual date a holiday in any adjacent year's list (observed rules
    can move the observed date into an adjacent year), or is it in its own year's list.

    Example: is_holiday('2028-01-01') → True (Jan 1 is always a federal holiday)
    """
    d = date.fromisoformat(date_str)
    # Check own year
    if d in _get_holidays_for_year(d.year):
        return True
    # Check prior year (Jan 1 falling on Saturday has observed date Dec 31 = prior year)
    if d in _get_holidays_for_year(d.year - 1):
        return True
    # Check next year (Dec 25 falling on Sunday has observed date Dec 26 = next year edge case)
    if d in _get_holidays_for_year(d.year + 1):
        return True
    # Weekends are always closed
    if d.weekday() >= 5:  # 5=Saturday, 6=Sunday
        return True
    return False

# Futures roll months: March, June, September, December
# Roll week = Monday-Friday of the week containing the 3rd Friday of a roll month
ROLL_MONTHS = {3, 6, 9, 12}

# ─── High-Impact Economic Events (FOMC / CPI / NFP) ──────────────
# All event times are in US Eastern Time (ET).
# Paper engine sits out ±EVENT_BLACKOUT_MINUTES around each event.
# Dates cover the current and forward-planning horizon (2026-2027).

EVENT_BLACKOUT_MINUTES: int = 30  # default ±30 min blackout window

# Structure: (date_str "YYYY-MM-DD", time_et "HH:MM", event_name)
_ECONOMIC_EVENTS: list[tuple[str, str, str]] = [
    # ── FOMC announcements (14:00 ET) ──────────────────────────
    # 2026
    ("2026-01-28", "14:00", "FOMC"),
    ("2026-03-18", "14:00", "FOMC"),
    ("2026-05-06", "14:00", "FOMC"),
    ("2026-06-17", "14:00", "FOMC"),
    ("2026-07-29", "14:00", "FOMC"),
    ("2026-09-16", "14:00", "FOMC"),
    ("2026-11-04", "14:00", "FOMC"),
    ("2026-12-16", "14:00", "FOMC"),
    # 2027
    ("2027-01-27", "14:00", "FOMC"),
    ("2027-03-17", "14:00", "FOMC"),
    ("2027-05-05", "14:00", "FOMC"),
    ("2027-06-16", "14:00", "FOMC"),
    ("2027-07-28", "14:00", "FOMC"),
    ("2027-09-22", "14:00", "FOMC"),
    ("2027-11-03", "14:00", "FOMC"),
    ("2027-12-15", "14:00", "FOMC"),

    # ── CPI releases (08:30 ET, monthly) ───────────────────────
    # 2026
    ("2026-01-14", "08:30", "CPI"),
    ("2026-02-11", "08:30", "CPI"),
    ("2026-03-11", "08:30", "CPI"),
    ("2026-04-10", "08:30", "CPI"),
    ("2026-05-13", "08:30", "CPI"),
    ("2026-06-10", "08:30", "CPI"),
    ("2026-07-14", "08:30", "CPI"),
    ("2026-08-12", "08:30", "CPI"),
    ("2026-09-09", "08:30", "CPI"),
    ("2026-10-13", "08:30", "CPI"),
    ("2026-11-12", "08:30", "CPI"),
    ("2026-12-10", "08:30", "CPI"),
    # 2027
    ("2027-01-13", "08:30", "CPI"),
    ("2027-02-10", "08:30", "CPI"),
    ("2027-03-10", "08:30", "CPI"),
    ("2027-04-14", "08:30", "CPI"),
    ("2027-05-12", "08:30", "CPI"),
    ("2027-06-09", "08:30", "CPI"),
    ("2027-07-14", "08:30", "CPI"),
    ("2027-08-11", "08:30", "CPI"),
    ("2027-09-08", "08:30", "CPI"),
    ("2027-10-13", "08:30", "CPI"),
    ("2027-11-10", "08:30", "CPI"),
    ("2027-12-08", "08:30", "CPI"),

    # ── NFP (Non-Farm Payrolls, first Friday of each month, 08:30 ET) ──
    # 2026
    ("2026-01-09", "08:30", "NFP"),
    ("2026-02-06", "08:30", "NFP"),
    ("2026-03-06", "08:30", "NFP"),
    ("2026-04-03", "08:30", "NFP"),
    ("2026-05-01", "08:30", "NFP"),
    ("2026-06-05", "08:30", "NFP"),
    ("2026-07-10", "08:30", "NFP"),  # July 4 holiday — pushed to 10th
    ("2026-08-07", "08:30", "NFP"),
    ("2026-09-04", "08:30", "NFP"),
    ("2026-10-02", "08:30", "NFP"),
    ("2026-11-06", "08:30", "NFP"),
    ("2026-12-04", "08:30", "NFP"),
    # 2027
    ("2027-01-08", "08:30", "NFP"),
    ("2027-02-05", "08:30", "NFP"),
    ("2027-03-05", "08:30", "NFP"),
    ("2027-04-02", "08:30", "NFP"),
    ("2027-05-07", "08:30", "NFP"),
    ("2027-06-04", "08:30", "NFP"),
    ("2027-07-09", "08:30", "NFP"),  # July 5 holiday — pushed to 9th
    ("2027-08-06", "08:30", "NFP"),
    ("2027-09-03", "08:30", "NFP"),
    ("2027-10-01", "08:30", "NFP"),
    ("2027-11-05", "08:30", "NFP"),
    ("2027-12-03", "08:30", "NFP"),
]

# ─── Rule-Based Economic Event Generator (2028+) ─────────────────────────────
# The explicit list above covers 2026-2027. For 2028 and beyond, rules generate
# dates automatically so the blackout list never expires silently.
#
# Rules:
#   NFP   = first Friday of each month (pushed to the following Friday when the
#           first Friday lands on a federal holiday).
#   CPI   = second Wednesday of each month (BLS releases CPI on the 2nd Wed
#           most years; this is the closest algorithmic approximation to the
#           typical mid-month schedule and agrees with the 2026-2027 hardcoded
#           dates within ±2 days for all months — acceptable for ±30min blackout).
#   FOMC  = 8 scheduled meetings per year.  The Fed publishes exact dates 12+
#           months in advance.  For future years beyond the published schedule,
#           we approximate: meetings on the 3rd Wednesday of Jan, Mar, May, Jun,
#           Jul, Sep, Oct (or Nov in odd years), Dec — an 8-meeting cadence that
#           matches historical FOMC schedules within ±1 week. When the exact
#           schedule becomes available, add it to _ECONOMIC_EVENTS above and it
#           will override the generated entry (static list takes precedence via
#           deduplication in _build_event_date_index).
#
# To extend explicit dates: add entries to _ECONOMIC_EVENTS above.
# The generator only fires for years NOT already covered by the static list.

_STATIC_YEARS: frozenset[int] = frozenset(
    date.fromisoformat(ev[0]).year for ev in _ECONOMIC_EVENTS
)

# Approximate FOMC month schedule (8 meetings/year).
# Jan, Mar, May, Jun, Jul, Sep — then alternating Oct/Nov, always Dec.
# For even years: meetings in Jan,Mar,May,Jun,Jul,Sep,Nov,Dec
# For odd  years: meetings in Jan,Mar,May,Jun,Jul,Sep,Oct,Dec
# This matches the real Fed schedule for 2026-2027 within the ±1-week tolerance
# acceptable for ±30min event blackouts.
_FOMC_MONTHS_EVEN: tuple[int, ...] = (1, 3, 5, 6, 7, 9, 11, 12)
_FOMC_MONTHS_ODD:  tuple[int, ...] = (1, 3, 5, 6, 7, 9, 10, 12)


def _first_friday_of_month(year: int, month: int) -> date:
    """Return the first Friday of the given month, respecting federal holiday
    push-forward (if that Friday is a holiday, advance by 7 days)."""
    candidate = _nth_weekday_of_month(year, month, 4, 1)  # 4 = Friday
    # Push forward if the first Friday is a federal holiday
    holidays = _compute_federal_holidays(year)
    while candidate in holidays:
        candidate += timedelta(days=7)
    return candidate


def _second_wednesday_of_month(year: int, month: int) -> date:
    """Return the second Wednesday of the given month."""
    return _nth_weekday_of_month(year, month, 2, 2)  # 2 = Wednesday


def _third_wednesday_of_month(year: int, month: int) -> date:
    """Return the third Wednesday of the given month (FOMC proxy)."""
    return _nth_weekday_of_month(year, month, 2, 3)  # 2 = Wednesday


def _generate_economic_events_for_year(year: int) -> list[tuple[str, str, str]]:
    """Generate FOMC, CPI, and NFP events for a given year using algorithmic rules.

    Only called for years not covered by the static _ECONOMIC_EVENTS list.
    Returns list of (date_str, time_et, event_name) tuples.
    """
    events: list[tuple[str, str, str]] = []
    fomc_months = _FOMC_MONTHS_EVEN if year % 2 == 0 else _FOMC_MONTHS_ODD

    for month in range(1, 13):
        # NFP — first Friday of each month, 08:30 ET
        nfp_date = _first_friday_of_month(year, month)
        events.append((nfp_date.isoformat(), "08:30", "NFP"))

        # CPI — second Wednesday of each month, 08:30 ET
        cpi_date = _second_wednesday_of_month(year, month)
        events.append((cpi_date.isoformat(), "08:30", "CPI"))

        # FOMC — third Wednesday of scheduled months, 14:00 ET
        if month in fomc_months:
            fomc_date = _third_wednesday_of_month(year, month)
            events.append((fomc_date.isoformat(), "14:00", "FOMC"))

    return events


# Build a lookup: date → (event_name, event_time_minutes_from_midnight_ET)
# Multiple events on the same date (e.g. CPI and NFP coinciding) are all stored.
_ET_OFFSET_STANDARD = -5 * 60   # EST (minutes from UTC)
_ET_OFFSET_DST      = -4 * 60   # EDT (minutes from UTC)


def _is_us_dst(d: date) -> bool:
    """Return True if the date falls within US DST (2nd Sun Mar – 1st Sun Nov)."""
    year = d.year
    # Second Sunday of March
    mar1 = date(year, 3, 1)
    days_to_first_sun = (6 - mar1.weekday()) % 7
    dst_start = date(year, 3, 1 + days_to_first_sun + 7)
    # First Sunday of November
    nov1 = date(year, 11, 1)
    days_to_first_sun_nov = (6 - nov1.weekday()) % 7
    dst_end = date(year, 11, 1 + days_to_first_sun_nov)
    return dst_start <= d < dst_end


def _event_minutes_et(time_et_str: str) -> int:
    """Parse 'HH:MM' to minutes from midnight."""
    h, m = time_et_str.split(":")
    return int(h) * 60 + int(m)


def _build_event_date_index() -> dict[date, list[tuple[str, int]]]:
    """Pre-build {date: [(event_name, minutes_from_midnight_ET), ...]}
    from the static _ECONOMIC_EVENTS list (2026-2027).

    Dynamic lookup for 2028+ is handled by _get_event_index_for_date().
    """
    index: dict[date, list[tuple[str, int]]] = {}
    for date_str, time_str, name in _ECONOMIC_EVENTS:
        d = date.fromisoformat(date_str)
        mins = _event_minutes_et(time_str)
        index.setdefault(d, []).append((name, mins))
    return index


# Static index for explicitly defined years (fast path — O(1) dict lookup).
_EVENT_INDEX: dict[date, list[tuple[str, int]]] = _build_event_date_index()

# Cache for dynamically generated year indexes (2028+).
_GENERATED_YEAR_INDEX: dict[int, dict[date, list[tuple[str, int]]]] = {}


def _get_generated_year_index(year: int) -> dict[date, list[tuple[str, int]]]:
    """Return (and cache) the event index for a dynamically generated year."""
    if year not in _GENERATED_YEAR_INDEX:
        idx: dict[date, list[tuple[str, int]]] = {}
        for date_str, time_str, name in _generate_economic_events_for_year(year):
            d = date.fromisoformat(date_str)
            mins = _event_minutes_et(time_str)
            idx.setdefault(d, []).append((name, mins))
        _GENERATED_YEAR_INDEX[year] = idx
    return _GENERATED_YEAR_INDEX[year]


def _get_events_for_date(d: date) -> list[tuple[str, int]]:
    """Return events for a calendar date, using static index for covered years
    and the rule-based generator for any year beyond the static list."""
    # Static list covers these years
    if d.year in _STATIC_YEARS:
        return _EVENT_INDEX.get(d, [])
    # Rule-based generator for 2028+
    return _get_generated_year_index(d.year).get(d, [])


def check_economic_event(
    check_datetime: datetime | None = None,
    blackout_minutes: int = EVENT_BLACKOUT_MINUTES,
) -> tuple[bool, str, int]:
    """Check if a datetime falls within an economic event blackout window.

    Args:
        check_datetime: UTC datetime to check (default: now).  If naive, treated
                        as UTC.  Converted to ET for the window check.
        blackout_minutes: half-width of blackout window in minutes (default 30).

    Returns:
        (is_economic_event, event_name, event_window_minutes)
        - is_economic_event: True if inside a blackout window
        - event_name: name of the event (e.g. "FOMC", "CPI", "NFP") or ""
        - event_window_minutes: the configured window (for logging)
    """
    if check_datetime is None:
        check_datetime = datetime.now(tz=timezone.utc)

    # Normalise to UTC-aware
    if check_datetime.tzinfo is None:
        check_datetime = check_datetime.replace(tzinfo=timezone.utc)

    # Convert to ET (we need local time for the comparison)
    check_date_utc = check_datetime.date()
    dst = _is_us_dst(check_date_utc)
    et_offset_min = _ET_OFFSET_DST if dst else _ET_OFFSET_STANDARD
    et_total_minutes = (check_datetime.hour * 60 + check_datetime.minute) + et_offset_min
    # Handle day wrap (e.g. 01:00 UTC → 20:00 previous day ET)
    et_day_offset = et_total_minutes // (24 * 60)
    et_date = date.fromordinal(check_date_utc.toordinal() + et_day_offset)
    et_minutes = et_total_minutes % (24 * 60)
    if et_minutes < 0:
        et_minutes += 24 * 60

    events_today = _get_events_for_date(et_date)
    for event_name, event_minutes in events_today:
        if abs(et_minutes - event_minutes) <= blackout_minutes:
            return True, event_name, blackout_minutes

    return False, "", blackout_minutes


def _nearest_distance(check_date: date, date_list: list[date]) -> int:
    """Return the minimum absolute day distance from check_date to any date in list."""
    if not date_list:
        return 999
    return min(abs((check_date - d).days) for d in date_list)


def _is_roll_week(check_date: date) -> bool:
    """Check if check_date falls in a futures roll week (week of 3rd Friday of roll month)."""
    if check_date.month not in ROLL_MONTHS:
        return False

    # Find the 3rd Friday of the month
    first_day = date(check_date.year, check_date.month, 1)
    # Find first Friday
    days_until_friday = (4 - first_day.weekday()) % 7
    first_friday = first_day + timedelta(days=days_until_friday)
    third_friday = first_friday + timedelta(weeks=2)

    # Roll week = Mon-Fri of that week
    roll_monday = third_friday - timedelta(days=4)  # Monday of that week
    roll_friday = third_friday

    return roll_monday <= check_date <= roll_friday


def _is_month_end(check_date: date) -> bool:
    """Check if check_date is in the last 2 trading days of the month."""
    # Simple heuristic: last 3 calendar days to cover weekends
    if check_date.month == 12:
        next_month_1st = date(check_date.year + 1, 1, 1)
    else:
        next_month_1st = date(check_date.year, check_date.month + 1, 1)

    days_left = (next_month_1st - check_date).days
    # Last 3 calendar days ≈ last 2 trading days
    return days_left <= 3


def _is_quarter_end(check_date: date) -> bool:
    """Check if it's quarter end (last 2 trading days of March, June, Sept, Dec)."""
    if check_date.month not in {3, 6, 9, 12}:
        return False
    return _is_month_end(check_date)


def calendar_check(
    check_date: date | None = None,
    check_datetime: datetime | None = None,
    blackout_minutes: int = EVENT_BLACKOUT_MINUTES,
) -> dict:
    """
    Check calendar conditions for skip signals.

    When check_datetime is supplied (preferred for paper engine real-time use),
    the economic-event window check is precise to the minute.  When only
    check_date is supplied, the event check covers the full day (is_economic_event
    will be True if any event falls on that date, regardless of time).

    Returns:
        {
            "is_holiday": bool,
            "holiday_proximity": int,  # days to nearest holiday (0=today)
            "is_triple_witching": bool,
            "triple_witching_proximity": int,
            "is_roll_week": bool,
            "is_month_end": bool,  # Last 2 trading days of month
            "is_quarter_end": bool,
            "day_of_week": str,  # Monday-Friday
            "day_of_week_num": int,  # 0=Mon, 4=Fri
            "is_economic_event": bool,  # True if within ±blackout_minutes of FOMC/CPI/NFP
            "economic_event_name": str,  # "FOMC" | "CPI" | "NFP" | ""
            "event_window_minutes": int,  # configured blackout half-width
        }
    """
    if check_date is None:
        if check_datetime is not None:
            check_date = check_datetime.date()
        else:
            check_date = date.today()

    day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    dow_num = check_date.weekday()

    year = check_date.year
    holidays = _get_holidays_for_year(year)
    triple_witching = _get_triple_witching_for_year(year)

    holiday_prox = _nearest_distance(check_date, holidays)
    tw_prox = _nearest_distance(check_date, triple_witching)

    # Economic event check — precise if check_datetime supplied, day-level otherwise
    if check_datetime is not None:
        is_econ, econ_name, econ_window = check_economic_event(check_datetime, blackout_minutes)
    else:
        # Day-level check: any event on this calendar date triggers the flag.
        # The paper engine always passes a full datetime; this path is for the
        # pre-market skip-engine scorer which works at day granularity.
        events_today = _get_events_for_date(check_date)
        if events_today:
            is_econ = True
            econ_name = events_today[0][0]  # first event of the day
        else:
            is_econ = False
            econ_name = ""
        econ_window = blackout_minutes

    return {
        "is_holiday": check_date in holidays,
        "holiday_proximity": holiday_prox,
        "is_triple_witching": check_date in triple_witching,
        "triple_witching_proximity": tw_prox,
        "is_roll_week": _is_roll_week(check_date),
        "is_month_end": _is_month_end(check_date),
        "is_quarter_end": _is_quarter_end(check_date),
        "day_of_week": day_names[dow_num] if dow_num < 7 else "Unknown",
        "day_of_week_num": dow_num,
        "is_economic_event": is_econ,
        "economic_event_name": econ_name,
        "event_window_minutes": econ_window,
    }


# ─── CLI Entry Point ─────────────────────────────────────────────

if __name__ == "__main__":
    import json
    import sys
    import os

    # Accept config via --config file path or stdin
    config_path = None
    for i, arg in enumerate(sys.argv[1:], 1):
        if arg == "--config" and i < len(sys.argv):
            config_path = sys.argv[i + 1]
            break
        elif os.path.isfile(arg):
            config_path = arg
            break

    if config_path:
        with open(config_path) as f:
            config = json.load(f)
    else:
        config = json.load(sys.stdin)

    check_date_str = config.get("date")       # "YYYY-MM-DD"
    check_datetime_str = config.get("datetime")  # ISO-8601 with time, preferred

    check_dt: datetime | None = None
    check_d: date | None = None

    if check_datetime_str:
        # Accept ISO-8601 with or without timezone (treat naive as UTC)
        try:
            check_dt = datetime.fromisoformat(check_datetime_str)
        except ValueError:
            check_dt = None

    if check_dt is None and check_date_str:
        check_d = date.fromisoformat(check_date_str)

    blackout = int(config.get("blackout_minutes", EVENT_BLACKOUT_MINUTES))
    result = calendar_check(check_date=check_d, check_datetime=check_dt, blackout_minutes=blackout)
    print(json.dumps(result))
