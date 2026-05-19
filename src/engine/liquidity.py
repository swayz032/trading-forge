"""Time-of-day liquidity profiles — session-based slippage multipliers.

Per CLAUDE.md: Don't ignore time-of-day liquidity — overnight ES has 2x
spreads vs RTH core; slippage multipliers by session are mandatory.

All session boundaries are in Eastern Time (ET).
"""

from __future__ import annotations

import numpy as np
import polars as pl


# ─── Session Definitions (Eastern Time) ──────────────────────────

SESSION_MULTIPLIERS = {
    "pre_market": 2.0,       # 6:00-9:30 ET — thin pre-market, wide spreads
    "open_30min": 0.8,       # 9:30-10:00 — highest liquidity of day
    "rth_core": 1.0,         # 10:00-15:30 — baseline liquidity
    "close_30min": 1.2,      # 15:30-16:00 — MOC flows, wider spreads
    "overnight": 3.0,        # 16:00-6:00 — thin book, wide spreads
}

SESSIONS = [
    # (label, start_hour, start_min, end_hour, end_min, multiplier)
    # Order matters: more specific ranges first, checked sequentially
    ("RTH_OPEN",     9, 30, 10,  0, SESSION_MULTIPLIERS["open_30min"]),
    ("RTH_CORE",    10,  0, 15, 30, SESSION_MULTIPLIERS["rth_core"]),
    ("RTH_CLOSE",   15, 30, 16,  0, SESSION_MULTIPLIERS["close_30min"]),
    ("CME_HALT",    16,  0, 17,  0, 100.0),  # CME Globex daily halt 4-5 PM ET — prohibitive but finite
    ("PRE_MARKET",   6,  0,  9, 30, SESSION_MULTIPLIERS["pre_market"]),
    ("OVERNIGHT",   17,  0, 18,  0, SESSION_MULTIPLIERS["overnight"]),  # 5-6 PM ET (post-halt)
    ("OVERNIGHT_2", 18,  0, 24,  0, SESSION_MULTIPLIERS["overnight"]),  # 6 PM – midnight
    ("OVERNIGHT_3",  0,  0,  6,  0, SESSION_MULTIPLIERS["overnight"]),  # midnight – 6 AM
]

# Default multiplier for anything not covered
_DEFAULT_MULTIPLIER = SESSION_MULTIPLIERS["overnight"]
_DEFAULT_LABEL = "AFTER_HOURS"


def _to_et_hours_minutes(timestamps: pl.Series) -> tuple[np.ndarray, np.ndarray]:
    """Convert timestamps to ET hour and minute arrays.

    Handles both UTC and already-ET-aware timestamps (e.g. ts_et from data_loader).
    """
    tz = getattr(timestamps.dtype, "time_zone", None)
    if tz is not None and tz != "":
        if tz == "America/New_York":
            et = timestamps
        else:
            et = timestamps.dt.convert_time_zone("America/New_York")
    else:
        ts = timestamps.cast(pl.Datetime("us", time_zone="UTC"))
        et = ts.dt.convert_time_zone("America/New_York")
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


def compute_fill_probability_by_volume(
    bar_volume: float,
    median_volume: float,
    order_size_contracts: int = 1,
) -> float:
    """Fill probability penalized when bar volume is below 20th percentile.

    Called by both the Python backtester and the TS paper engine (via paper_bridge).
    The paper engine uses a scalar bar volume and a rolling median over the bar buffer;
    the backtester can pass vectorised values by calling this per-row.

    Args:
        bar_volume: Volume of the current bar.
        median_volume: Rolling median volume (representative of normal liquidity).
        order_size_contracts: Order size; reserved for future multi-contract scaling.

    Returns:
        Fill probability in [0.30, 1.0].  Higher = more likely to fill.
    """
    if bar_volume <= 0 or median_volume <= 0:
        return 0.5  # conservative default

    volume_ratio = bar_volume / median_volume

    if volume_ratio >= 1.0:
        return 1.0  # full liquidity
    elif volume_ratio >= 0.5:
        # 0.85 to 1.0 linearly across [0.5, 1.0)
        return 0.85 + 0.15 * (volume_ratio - 0.5) / 0.5
    elif volume_ratio >= 0.2:
        # 0.60 to 0.85 linearly across [0.2, 0.5)
        return 0.60 + 0.25 * (volume_ratio - 0.2) / 0.3
    else:
        # Severe penalty below 20th percentile: clamp at 0.30
        return max(0.30, volume_ratio * 3)


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
