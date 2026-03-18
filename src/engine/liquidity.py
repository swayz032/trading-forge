"""Time-of-day liquidity profiles — session-based slippage multipliers.

Per CLAUDE.md: Don't ignore time-of-day liquidity — overnight ES has 2x
spreads vs RTH core; slippage multipliers by session are mandatory.

All session boundaries are in Eastern Time (ET).
"""

from __future__ import annotations

import numpy as np
import polars as pl


# ─── Session Definitions (Eastern Time) ──────────────────────────

SESSIONS = [
    # (label, start_hour, start_min, end_hour, end_min, multiplier)
    ("RTH_CORE",    10,  0, 15, 30, 1.0),
    ("RTH_CLOSE",   15, 30, 16,  0, 1.2),
    ("RTH_OPEN",     9, 30, 10,  0, 1.3),
    ("PRE_MARKET",   4,  0,  9, 30, 1.5),
    ("OVERNIGHT",   20,  0, 24,  0, 2.0),  # 8 PM – midnight
    ("OVERNIGHT_2",  0,  0,  4,  0, 2.0),  # midnight – 4 AM
]

# Default multiplier for anything not covered (e.g., 4-8 PM gap between
# RTH close and overnight — treat as after-hours, moderate liquidity)
_DEFAULT_MULTIPLIER = 1.5
_DEFAULT_LABEL = "AFTER_HOURS"


def _to_et_hours_minutes(timestamps: pl.Series) -> tuple[np.ndarray, np.ndarray]:
    """Convert timestamps to ET hour and minute arrays.

    Assumes input is UTC. ET = UTC - 5 (EST) or UTC - 4 (EDT).
    We use EST (UTC-5) as a conservative default — slightly earlier session
    boundaries mean slightly higher slippage estimates, which is safer.
    """
    # Cast to datetime if needed, subtract 5 hours for ET
    ts = timestamps.cast(pl.Datetime("us"))
    et = ts.dt.offset_by("-5h")
    hours = et.dt.hour().to_numpy().astype(np.int32)
    minutes = et.dt.minute().to_numpy().astype(np.int32)
    return hours, minutes


def _time_in_range(
    hours: np.ndarray,
    minutes: np.ndarray,
    start_h: int,
    start_m: int,
    end_h: int,
    end_m: int,
) -> np.ndarray:
    """Check if each (hour, minute) falls in [start, end) range."""
    time_val = hours * 60 + minutes
    start_val = start_h * 60 + start_m
    end_val = end_h * 60 + end_m
    return (time_val >= start_val) & (time_val < end_val)


def classify_session(timestamps: pl.Series) -> np.ndarray:
    """Classify each timestamp into a session label.

    Args:
        timestamps: Polars Series of timestamps (assumed UTC)

    Returns:
        numpy array of session label strings
    """
    hours, minutes = _to_et_hours_minutes(timestamps)
    n = len(timestamps)
    labels = np.full(n, _DEFAULT_LABEL, dtype=object)

    for label, sh, sm, eh, em, _ in SESSIONS:
        mask = _time_in_range(hours, minutes, sh, sm, eh, em)
        labels[mask] = label

    return labels


# ─── Event-Specific Multipliers (applied ON TOP of session multipliers) ───

EVENT_MULTIPLIERS = {
    "FOMC": 4.0,          # FOMC rate decisions — 4-20 ticks possible on ES
    "CPI": 3.0,           # CPI release at 8:30 ET — major volatility spike
    "NFP": 3.0,           # First Friday of month
    "PPI": 2.0,           # Producer Price Index
    "PCE": 2.5,           # Personal Consumption Expenditures (Fed's preferred)
    "GDP": 2.0,           # GDP release
    "RETAIL_SALES": 2.0,  # Retail sales
    "INVENTORY": 2.5,     # CL-specific (EIA, Wednesday 10:30 ET)
    "OPEC": 3.0,          # CL-specific — OPEC decisions
    "JOLTS": 1.5,         # Job openings
    "ISM": 2.0,           # ISM Manufacturing/Services
}


def get_session_multipliers(timestamps: pl.Series) -> np.ndarray:
    """Get slippage multiplier for each timestamp based on session.

    Args:
        timestamps: Polars Series of timestamps (assumed UTC)

    Returns:
        numpy array of float multipliers (1.0 = RTH core, 2.0 = overnight)
    """
    hours, minutes = _to_et_hours_minutes(timestamps)
    n = len(timestamps)
    multipliers = np.full(n, _DEFAULT_MULTIPLIER, dtype=np.float64)

    for _, sh, sm, eh, em, mult in SESSIONS:
        mask = _time_in_range(hours, minutes, sh, sm, eh, em)
        multipliers[mask] = mult

    return multipliers


def get_event_adjusted_multipliers(
    timestamps: pl.Series,
    event_bars: np.ndarray | None = None,
    event_type: str = "FOMC",
) -> np.ndarray:
    """Get slippage multipliers adjusted for both session AND event risk.

    Args:
        timestamps: Polars Series of timestamps
        event_bars: Boolean array marking bars within event windows (+-30 min)
        event_type: Type of event for multiplier lookup

    Returns:
        numpy array of combined multipliers
    """
    base = get_session_multipliers(timestamps)

    if event_bars is not None:
        event_mult = EVENT_MULTIPLIERS.get(event_type, 2.0)
        # Apply event multiplier on top of session multiplier
        base[event_bars.astype(bool)] *= event_mult

    return base
