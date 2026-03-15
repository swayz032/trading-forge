"""Calendar-based skip conditions: holidays, triple witching, roll weeks, FOMC blackouts."""

from __future__ import annotations

from datetime import date, timedelta

# US Market Holidays 2026
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

# Triple Witching Fridays 2026 (3rd Friday of March, June, Sept, Dec)
TRIPLE_WITCHING_2026: list[date] = [
    date(2026, 3, 20),
    date(2026, 6, 19),
    date(2026, 9, 18),
    date(2026, 12, 18),
]

# Futures roll months: March, June, September, December
# Roll week = Monday-Friday of the week containing the 3rd Friday of a roll month
ROLL_MONTHS = {3, 6, 9, 12}


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


def calendar_check(check_date: date | None = None) -> dict:
    """
    Check calendar conditions for skip signals.

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
        }
    """
    if check_date is None:
        check_date = date.today()

    day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    dow_num = check_date.weekday()

    holiday_prox = _nearest_distance(check_date, US_HOLIDAYS_2026)
    tw_prox = _nearest_distance(check_date, TRIPLE_WITCHING_2026)

    return {
        "is_holiday": check_date in US_HOLIDAYS_2026,
        "holiday_proximity": holiday_prox,
        "is_triple_witching": check_date in TRIPLE_WITCHING_2026,
        "triple_witching_proximity": tw_prox,
        "is_roll_week": _is_roll_week(check_date),
        "is_month_end": _is_month_end(check_date),
        "is_quarter_end": _is_quarter_end(check_date),
        "day_of_week": day_names[dow_num] if dow_num < 7 else "Unknown",
        "day_of_week_num": dow_num,
    }
