"""Economic calendar filter — static high-impact event dates.

Per CLAUDE.md: Don't trade through FOMC/CPI/NFP without explicit event
handling — default is SIT_OUT ±30 min.

F-4/F-8 fix (2026-05-20): Added 2025 CPI/NFP/GDP/PCE; extended GDP/PCE to
2027; added ISM Manufacturing and PPI as new event types. Dates sourced from
BLS/Fed published calendars. 2027 estimates are based on historical patterns —
mark TODO below if exact dates were projected rather than confirmed.
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta
from typing import Literal

import numpy as np
import polars as pl


# ─── Static Event Calendar (2023-2027) ───────────────────────────
# All times in ET. Only high-impact events that move futures.
# MFFU 2026 restricted events: FOMC, CPI, NFP, GDP, ISM, PPI (§6 CLAUDE.md).

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
