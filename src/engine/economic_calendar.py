"""Economic calendar filter — static high-impact event dates.

Per CLAUDE.md: Don't trade through FOMC/CPI/NFP without explicit event
handling — default is SIT_OUT ±30 min.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Literal

import numpy as np
import polars as pl


# ─── Static Event Calendar (2023-2026) ───────────────────────────
# All times in ET. Only high-impact events that move futures.

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
    ],
    "CPI": [
        # 2024 (monthly, 8:30 AM ET)
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
    ],
    "NFP": [
        # 2024 (first Friday, 8:30 AM ET)
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
    ],
    "GDP": [
        # 2024 (quarterly, 8:30 AM ET)
        {"date": "2024-01-25", "time_et": "08:30"},
        {"date": "2024-04-25", "time_et": "08:30"},
        {"date": "2024-07-25", "time_et": "08:30"},
        {"date": "2024-10-30", "time_et": "08:30"},
    ],
    "PCE": [
        # 2024 (monthly, 8:30 AM ET)
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
    ],
}


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
    """Convert UTC timestamps to ET dates and minutes-from-midnight."""
    ts = timestamps.cast(pl.Datetime("us"))
    et = ts.dt.offset_by("-5h")
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
