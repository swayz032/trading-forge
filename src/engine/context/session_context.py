"""Session Context — Overnight range, killzone status, opening range.

Computes session-specific context from overnight + killzone data.
All times in ET (America/New_York).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np
import polars as pl


@dataclass
class SessionContext:
    overnight_range: Tuple[float, float]  # (ON_high, ON_low)
    overnight_bias: str         # "bullish" | "bearish" | "neutral"
    london_high: float          # London session high (if past London close)
    london_low: float           # London session low
    london_swept_pdh: bool      # Did London sweep previous day high?
    london_swept_pdl: bool      # Did London sweep previous day low?
    ny_killzone_active: bool    # 9:30-11:00 ET
    london_killzone_active: bool # 2:00-5:00 ET
    asian_killzone_active: bool # 20:00-00:00 ET
    current_session: str        # "asian" | "london" | "ny_am" | "ny_pm" | "overnight"
    opening_range: Tuple[float, float]  # First 15-min range of RTH
    or_broken: Optional[str]    # "above" | "below" | None
    macro_time_active: bool     # xx:50-xx:10 windows


def _get_session(hour: int, minute: int) -> str:
    """Classify current session from hour/minute (ET)."""
    t = hour * 60 + minute
    if t >= 20 * 60 or t < 2 * 60:  # 8 PM - 2 AM ET
        return "asian"
    if 2 * 60 <= t < 5 * 60:  # 2 AM - 5 AM
        return "london"
    if 9 * 60 + 30 <= t < 12 * 60:  # 9:30 AM - noon
        return "ny_am"
    if 12 * 60 <= t < 16 * 60:  # noon - 4 PM
        return "ny_pm"
    return "overnight"


def _is_macro_time(hour: int, minute: int) -> bool:
    """Check if current time is in ICT macro window (xx:50 - xx:10)."""
    return minute >= 50 or minute <= 10


def compute_session_context(
    df: pl.DataFrame,
    bar_idx: int,
    prev_day_high: float,
    prev_day_low: float,
) -> SessionContext:
    """Compute session context for a specific bar.

    Args:
        df: Intraday OHLCV data with ts_et (ET timezone) column
        bar_idx: Current bar index
        prev_day_high: Previous day's high (from HTF context)
        prev_day_low: Previous day's low
    """
    # Determine current time
    ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
    current_ts = df[ts_col][int(bar_idx)]

    # Extract hour and minute
    if hasattr(current_ts, 'hour'):
        current_hour = current_ts.hour
        current_minute = current_ts.minute
    else:
        current_hour = 9
        current_minute = 30

    current_session = _get_session(current_hour, current_minute)

    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()
    closes = df["close"].to_numpy()

    # Overnight range: from previous 4 PM to current bar
    # Simplified: look back up to 100 bars for overnight session
    on_start = max(0, bar_idx - 100)
    on_high = float(np.max(highs[on_start:bar_idx+1])) if bar_idx > on_start else float(highs[bar_idx])
    on_low = float(np.min(lows[on_start:bar_idx+1])) if bar_idx > on_start else float(lows[bar_idx])

    # Overnight bias: direction of overnight move
    if bar_idx > on_start:
        on_close = float(closes[bar_idx])
        on_open = float(closes[on_start])
        if on_close > on_open * 1.001:
            overnight_bias = "bullish"
        elif on_close < on_open * 0.999:
            overnight_bias = "bearish"
        else:
            overnight_bias = "neutral"
    else:
        overnight_bias = "neutral"

    # London session data (bars from 2-5 AM ET)
    london_high = float('nan')
    london_low = float('nan')
    london_swept_pdh = False
    london_swept_pdl = False

    # Scan backwards for London session bars
    london_found = False
    for i in range(max(0, bar_idx - 200), bar_idx):
        ts = df[ts_col][i]
        if hasattr(ts, 'hour') and 2 <= ts.hour < 5:
            h = float(highs[i])
            l = float(lows[i])
            if not london_found:
                london_high = h
                london_low = l
                london_found = True
            else:
                london_high = max(london_high, h)
                london_low = min(london_low, l)
            if h > prev_day_high:
                london_swept_pdh = True
            if l < prev_day_low:
                london_swept_pdl = True

    # Default to prev_day levels if London session hasn't occurred yet
    if not london_found:
        london_high = prev_day_high
        london_low = prev_day_low

    # Opening range: first 15-min of RTH (9:30-9:45)
    or_high = float('nan')
    or_low = float('nan')
    or_found = False
    for i in range(max(0, bar_idx - 50), bar_idx + 1):
        ts = df[ts_col][i]
        if hasattr(ts, 'hour') and ts.hour == 9 and 30 <= ts.minute < 45:
            h = float(highs[i])
            l = float(lows[i])
            if not or_found:
                or_high = h
                or_low = l
                or_found = True
            else:
                or_high = max(or_high, h)
                or_low = min(or_low, l)

    # Fallback if no OR bars found yet
    if not or_found:
        or_high = float(highs[bar_idx])
        or_low = float(lows[bar_idx])

    # OR broken?
    current_close = float(closes[bar_idx])
    or_broken = None
    if or_found and current_close > or_high:
        or_broken = "above"
    elif or_found and current_close < or_low:
        or_broken = "below"

    # Killzone status
    ny_kz = 9 * 60 + 30 <= current_hour * 60 + current_minute < 11 * 60
    london_kz = 2 * 60 <= current_hour * 60 + current_minute < 5 * 60
    asian_kz = current_hour >= 20 or current_hour < 2

    return SessionContext(
        overnight_range=(on_high, on_low),
        overnight_bias=overnight_bias,
        london_high=london_high,
        london_low=london_low,
        london_swept_pdh=london_swept_pdh,
        london_swept_pdl=london_swept_pdl,
        ny_killzone_active=ny_kz,
        london_killzone_active=london_kz,
        asian_killzone_active=asian_kz,
        current_session=current_session,
        opening_range=(or_high, or_low),
        or_broken=or_broken,
        macro_time_active=_is_macro_time(current_hour, current_minute),
    )
