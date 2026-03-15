"""
Economic Event Calendar -- FOMC, CPI, NFP, PPI release schedule.
Pre-computed schedule + proximity calculator for skip engine integration.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

# ─── Known 2025-2026 FOMC dates ─────────────────────────────────
FOMC_DATES_2025 = [
    "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18",
    "2025-07-30", "2025-09-17", "2025-11-05", "2025-12-17",
]

FOMC_DATES_2026 = [
    "2026-01-28", "2026-03-18", "2026-05-06", "2026-06-17",
    "2026-07-29", "2026-09-16", "2026-11-04", "2026-12-16",
]

# CPI release dates 2025-2026 (typically 2nd or 3rd week of month, 8:30 AM ET)
CPI_DATES_2025 = [
    "2025-01-15", "2025-02-12", "2025-03-12", "2025-04-10",
    "2025-05-13", "2025-06-11", "2025-07-15", "2025-08-12",
    "2025-09-10", "2025-10-14", "2025-11-12", "2025-12-10",
]

CPI_DATES_2026 = [
    "2026-01-14", "2026-02-11", "2026-03-11", "2026-04-14",
    "2026-05-12", "2026-06-10", "2026-07-14", "2026-08-12",
    "2026-09-15", "2026-10-13", "2026-11-12", "2026-12-10",
]

# NFP release dates 2025-2026 (typically first Friday of month, 8:30 AM ET)
NFP_DATES_2025 = [
    "2025-01-10", "2025-02-07", "2025-03-07", "2025-04-04",
    "2025-05-02", "2025-06-06", "2025-07-03", "2025-08-01",
    "2025-09-05", "2025-10-03", "2025-11-07", "2025-12-05",
]

NFP_DATES_2026 = [
    "2026-01-09", "2026-02-06", "2026-03-06", "2026-04-03",
    "2026-05-01", "2026-06-05", "2026-07-02", "2026-08-07",
    "2026-09-04", "2026-10-02", "2026-11-06", "2026-12-04",
]

# PPI release dates 2025-2026 (monthly, 8:30 AM ET)
PPI_DATES_2025 = [
    "2025-01-14", "2025-02-13", "2025-03-13", "2025-04-11",
    "2025-05-15", "2025-06-12", "2025-07-15", "2025-08-14",
    "2025-09-11", "2025-10-09", "2025-11-13", "2025-12-11",
]

PPI_DATES_2026 = [
    "2026-01-15", "2026-02-12", "2026-03-12", "2026-04-09",
    "2026-05-14", "2026-06-11", "2026-07-16", "2026-08-13",
    "2026-09-10", "2026-10-14", "2026-11-12", "2026-12-10",
]


# Impact levels by event type
EVENT_IMPACT = {
    "FOMC": "high",
    "CPI": "high",
    "NFP": "high",
    "PPI": "medium",
}

# Default sit-out windows (minutes before and after release)
SIT_OUT_WINDOWS = {
    "high": 30,     # +/- 30 min for FOMC, CPI, NFP
    "medium": 15,   # +/- 15 min for PPI
    "low": 0,
}


def _build_event_list() -> list[dict]:
    """Build flat list of all known events."""
    events: list[dict] = []

    def _add(event_type: str, dates: list[str], time_et: str) -> None:
        impact = EVENT_IMPACT.get(event_type, "medium")
        for d in dates:
            events.append({
                "event": event_type,
                "date": d,
                "time_et": time_et,
                "impact_level": impact,
                "sit_out_minutes": SIT_OUT_WINDOWS.get(impact, 0),
            })

    _add("FOMC", FOMC_DATES_2025 + FOMC_DATES_2026, "14:00")
    _add("CPI", CPI_DATES_2025 + CPI_DATES_2026, "08:30")
    _add("NFP", NFP_DATES_2025 + NFP_DATES_2026, "08:30")
    _add("PPI", PPI_DATES_2025 + PPI_DATES_2026, "08:30")

    events.sort(key=lambda x: x["date"])
    return events


# Pre-built event list
ALL_EVENTS = _build_event_list()


def get_upcoming_events(
    from_date: date | None = None,
    days_ahead: int = 14,
) -> list[dict]:
    """
    Get upcoming economic events within the window.

    Args:
        from_date: Starting date (default: today).
        days_ahead: Number of days to look ahead.

    Returns:
        List of event dicts: [{event, date, time_et, impact_level, sit_out_minutes}]
    """
    if from_date is None:
        from_date = date.today()

    end_date = from_date + timedelta(days=days_ahead)
    from_str = from_date.isoformat()
    end_str = end_date.isoformat()

    return [
        evt for evt in ALL_EVENTS
        if from_str <= evt["date"] <= end_str
    ]


def event_proximity(
    check_date: date | None = None,
) -> dict:
    """
    How close is today to a major economic event?

    Args:
        check_date: Date to check (default: today).

    Returns:
        {
            "nearest_event": str,
            "nearest_date": str,
            "days_until": int,
            "impact_level": "high" | "medium" | "low",
            "recommendation": "TRADE" | "REDUCE" | "SIT_OUT",
            "sit_out_window_minutes": int,
        }
    """
    if check_date is None:
        check_date = date.today()

    check_str = check_date.isoformat()

    nearest_event: dict | None = None
    min_days: int = 999

    for evt in ALL_EVENTS:
        evt_date = date.fromisoformat(evt["date"])
        delta = (evt_date - check_date).days

        # Only look at today and future events
        if delta < 0:
            continue

        if delta < min_days:
            min_days = delta
            nearest_event = evt

    if nearest_event is None:
        return {
            "nearest_event": None,
            "nearest_date": None,
            "days_until": -1,
            "impact_level": "low",
            "recommendation": "TRADE",
            "sit_out_window_minutes": 0,
        }

    # Determine recommendation based on proximity
    impact = nearest_event["impact_level"]
    sit_out_minutes = nearest_event["sit_out_minutes"]

    if min_days == 0:
        # Event is today
        if impact == "high":
            recommendation = "SIT_OUT"
        else:
            recommendation = "REDUCE"
    elif min_days == 1 and impact == "high":
        recommendation = "REDUCE"
    else:
        recommendation = "TRADE"

    return {
        "nearest_event": nearest_event["event"],
        "nearest_date": nearest_event["date"],
        "days_until": min_days,
        "impact_level": impact,
        "recommendation": recommendation,
        "sit_out_window_minutes": sit_out_minutes,
    }
