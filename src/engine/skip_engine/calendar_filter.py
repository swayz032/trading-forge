"""Calendar-based skip conditions: holidays, triple witching, roll weeks, FOMC blackouts.

Per CLAUDE.md: Don't trade through FOMC/CPI/NFP without explicit event handling —
default is SIT_OUT ±30 min.  This module is the paper-engine's real-time check;
it is called once per bar via the python-runner bridge and must be fast.
"""

from __future__ import annotations

import warnings
from datetime import date, datetime, timedelta, timezone

# US Market Holidays by year
US_HOLIDAYS_2026: list[date] = [
    date(2026, 1, 1),   # New Year's Day
    date(2026, 1, 19),  # MLK Day
    date(2026, 2, 16),  # Presidents' Day
    date(2026, 4, 3),   # Good Friday
    date(2026, 5, 25),  # Memorial Day
    date(2026, 7, 3),   # Independence Day (observed)
    date(2026, 9, 7),   # Labor Day
    date(2026, 11, 26), # Thanksgiving
    date(2026, 12, 25), # Christmas
]

US_HOLIDAYS_2027: list[date] = [
    date(2027, 1, 1),   # New Year's Day
    date(2027, 1, 18),  # MLK Day
    date(2027, 2, 15),  # Presidents' Day
    date(2027, 3, 26),  # Good Friday
    date(2027, 5, 31),  # Memorial Day
    date(2027, 7, 5),   # Independence Day (observed, July 4 is Sunday)
    date(2027, 9, 6),   # Labor Day
    date(2027, 11, 25), # Thanksgiving
    date(2027, 12, 24), # Christmas (observed, Dec 25 is Saturday)
]

# Year-keyed lookup for holidays
US_HOLIDAYS_BY_YEAR: dict[int, list[date]] = {
    2026: US_HOLIDAYS_2026,
    2027: US_HOLIDAYS_2027,
}

# Triple Witching Fridays (3rd Friday of March, June, Sept, Dec)
TRIPLE_WITCHING_2026: list[date] = [
    date(2026, 3, 20),
    date(2026, 6, 19),
    date(2026, 9, 18),
    date(2026, 12, 18),
]

TRIPLE_WITCHING_2027: list[date] = [
    date(2027, 3, 19),
    date(2027, 6, 18),
    date(2027, 9, 17),
    date(2027, 12, 17),
]

TRIPLE_WITCHING_BY_YEAR: dict[int, list[date]] = {
    2026: TRIPLE_WITCHING_2026,
    2027: TRIPLE_WITCHING_2027,
}


def _get_holidays_for_year(year: int) -> list[date]:
    """Return holiday list for the given year, with a runtime warning if missing."""
    if year not in US_HOLIDAYS_BY_YEAR:
        warnings.warn(
            f"No US market holiday data for year {year}. "
            f"Calendar filter will not detect holidays. "
            f"Add US_HOLIDAYS_{year} to calendar_filter.py.",
            stacklevel=3,
        )
        return []
    return US_HOLIDAYS_BY_YEAR[year]


def _get_triple_witching_for_year(year: int) -> list[date]:
    """Return triple witching dates for the given year, with a runtime warning if missing."""
    if year not in TRIPLE_WITCHING_BY_YEAR:
        warnings.warn(
            f"No triple witching data for year {year}. "
            f"Add TRIPLE_WITCHING_{year} to calendar_filter.py.",
            stacklevel=3,
        )
        return []
    return TRIPLE_WITCHING_BY_YEAR[year]

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
    """Pre-build {date: [(event_name, minutes_from_midnight_ET), ...]}."""
    index: dict[date, list[tuple[str, int]]] = {}
    for date_str, time_str, name in _ECONOMIC_EVENTS:
        d = date.fromisoformat(date_str)
        mins = _event_minutes_et(time_str)
        index.setdefault(d, []).append((name, mins))
    return index


_EVENT_INDEX: dict[date, list[tuple[str, int]]] = _build_event_date_index()


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

    events_today = _EVENT_INDEX.get(et_date, [])
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
        events_today = _EVENT_INDEX.get(check_date, [])
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
