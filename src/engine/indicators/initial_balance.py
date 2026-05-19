"""Initial Balance (IB) — first-hour RTH range and extension tracking.

RTH IB window: 9:30 AM - 10:30 AM US Eastern Time.
Extension status tracks whether price has broken above/below the IB range
during the remainder of the RTH session.

DST safety: timestamps are expected in ET (America/New_York) or naive-ET.
Uses the same _to_et_components() pattern as sessions.py.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

import polars as pl


# ─── IB window constants (ET) ─────────────────────────────────────────────────

IB_START_HOUR: int = 9
IB_START_MINUTE: int = 30
IB_END_HOUR: int = 10
IB_END_MINUTE: int = 30   # exclusive: bars < 10:30 are in IB

RTH_OPEN_HOUR: int = 9
RTH_OPEN_MINUTE: int = 30
RTH_CLOSE_HOUR: int = 16
RTH_CLOSE_MINUTE: int = 0


# ─── Output dataclass ─────────────────────────────────────────────────────────

IBExtensionStatus = Literal[
    "IB_HOLD",
    "IB_EXTENSION_UP",
    "IB_EXTENSION_DOWN",
    "IB_EXTENSION_BOTH",
]


@dataclass
class InitialBalance:
    """Initial Balance computation result."""

    ib_high: float
    ib_low: float
    ib_range: float
    ib_extended_high: bool
    ib_extended_low: bool
    ib_extension_status: IBExtensionStatus
    ib_bar_count: int           # Number of bars in IB window
    post_ib_bar_count: int      # Number of bars after IB in RTH


# ─── Core computation ─────────────────────────────────────────────────────────

def _to_et_minute_of_day(ts: pl.Series) -> pl.Series:
    """Return total ET minutes-of-day (0=midnight, 570=9:30 AM, 630=10:30 AM)."""
    hour = ts.dt.hour()
    minute = ts.dt.minute()
    return (hour.cast(pl.Int32) * 60 + minute.cast(pl.Int32)).alias("et_minute")


IB_START_MINUTES = IB_START_HOUR * 60 + IB_START_MINUTE   # 570
IB_END_MINUTES = IB_END_HOUR * 60 + IB_END_MINUTE         # 630
RTH_OPEN_MINUTES = RTH_OPEN_HOUR * 60 + RTH_OPEN_MINUTE   # 570
RTH_CLOSE_MINUTES = RTH_CLOSE_HOUR * 60 + RTH_CLOSE_MINUTE  # 960


def compute_initial_balance(
    bars: pl.DataFrame,
    ts_col: str = "ts_event",
) -> Optional[InitialBalance]:
    """Compute Initial Balance from an intraday bar DataFrame.

    Args:
        bars: Polars DataFrame with ts_event (ET or naive-ET), high, low columns.
              Expected to contain RTH bars for one trading session.
        ts_col: Name of the timestamp column (default "ts_event").

    Returns:
        InitialBalance dataclass, or None if no IB bars found.

    Notes:
        - ts_event must be in Eastern Time (or naive, assumed ET) per sessions.py
          convention. UTC timestamps must be converted by caller before passing.
        - Half-day sessions may have a truncated IB; the function computes on
          whatever bars exist in the window.
    """
    if len(bars) == 0:
        return None

    required = {ts_col, "high", "low"}
    missing = required - set(bars.columns)
    if missing:
        raise ValueError(f"bars missing columns: {missing}")

    ts = bars[ts_col]

    # Compute ET minutes of day
    et_minutes = _to_et_minute_of_day(ts)

    # IB bars: 9:30 inclusive to 10:30 exclusive
    ib_mask = (et_minutes >= IB_START_MINUTES) & (et_minutes < IB_END_MINUTES)
    ib_bars = bars.filter(ib_mask)

    if len(ib_bars) == 0:
        return None

    ib_high = float(ib_bars["high"].max())
    ib_low = float(ib_bars["low"].min())
    ib_range = ib_high - ib_low

    # Post-IB RTH bars: 10:30 inclusive to 16:00 exclusive
    post_ib_mask = (et_minutes >= IB_END_MINUTES) & (et_minutes < RTH_CLOSE_MINUTES)
    post_ib_bars = bars.filter(post_ib_mask)

    ib_extended_high = False
    ib_extended_low = False

    if len(post_ib_bars) > 0:
        post_high = float(post_ib_bars["high"].max())
        post_low = float(post_ib_bars["low"].min())
        ib_extended_high = post_high > ib_high
        ib_extended_low = post_low < ib_low

    # Determine extension status
    if ib_extended_high and ib_extended_low:
        status: IBExtensionStatus = "IB_EXTENSION_BOTH"
    elif ib_extended_high:
        status = "IB_EXTENSION_UP"
    elif ib_extended_low:
        status = "IB_EXTENSION_DOWN"
    else:
        status = "IB_HOLD"

    return InitialBalance(
        ib_high=ib_high,
        ib_low=ib_low,
        ib_range=ib_range,
        ib_extended_high=ib_extended_high,
        ib_extended_low=ib_extended_low,
        ib_extension_status=status,
        ib_bar_count=len(ib_bars),
        post_ib_bar_count=len(post_ib_bars),
    )
