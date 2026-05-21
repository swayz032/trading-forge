"""Session Context — Overnight range, killzone status, opening range.

Computes session-specific context from overnight + killzone data.
All times in ET (America/New_York).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional, Tuple
from zoneinfo import ZoneInfo

import numpy as np
import polars as pl

logger = logging.getLogger(__name__)

_ET_ZONE = ZoneInfo("America/New_York")
_UTC_ZONE = ZoneInfo("UTC")


def _to_et(ts):
    """Convert a timestamp to ET (America/New_York). Treats naive as UTC.

    F-9 DST fold (2026-05-20):
    On the fall DST transition (first Sunday of November), the 01:00-02:00 ET
    hour fires TWICE — once under EDT (UTC-4) then again under EST (UTC-5).
    ZoneInfo.astimezone() resolves the wall-clock value but the resulting ET
    timestamps are NOT unique across the fold: two distinct UTC bars map to
    the same (hour, minute) ET reading.

    HARD RULE: _to_et() output is for DISPLAY and SESSION CLASSIFICATION only
    (hour/minute checks like 02:00-05:00 London, 09:30-12:00 NY AM). It must
    NEVER be used as a key for deduplication, "is bar X in window Y today"
    membership where X must be unique, or as an ordering primitive.

    Any temporal scan that needs uniqueness MUST key off the original UTC
    ts_event (or its bar_idx, which is monotonic by construction in the
    intraday DataFrame). The scans in this file already iterate by bar_idx
    (range(..., bar_idx)) — they are SAFE because bar_idx is unique even
    when two adjacent bars share the same ET wall-clock reading.
    """
    if ts is None:
        return None
    if hasattr(ts, "tzinfo") and ts.tzinfo is None:
        ts = ts.replace(tzinfo=_UTC_ZONE)
    return ts.astimezone(_ET_ZONE)


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
    current_session: str        # "asian" | "london" | "pre_market" | "ny_am" | "ny_pm" | "maintenance" | "overnight"
    opening_range: Tuple[float, float]  # First 15-min range of RTH
    or_broken: Optional[str]    # "above" | "below" | None
    macro_time_active: bool     # xx:50-xx:10 windows


def _get_session(hour: int, minute: int) -> str:
    """Classify current session from hour/minute (ET).

    Session windows:
      maintenance : 17:00-18:00 ET (Globex pause: 16:00-17:00 CT)
      asian       : 18:00-02:00 ET (after maintenance opens)
      london      : 02:00-05:00 ET
      pre_market  : 05:00-09:30 ET
      ny_am       : 09:30-12:00 ET
      ny_pm       : 12:00-16:00 ET
      overnight   : 16:00-17:00 ET (RTH close before Globex pause)
    """
    t = hour * 60 + minute
    # Globex maintenance: 17:00-18:00 ET (16 CT - 17 CT)
    if 17 * 60 <= t < 18 * 60:
        return "maintenance"
    # Asian: 18:00 ET (after maintenance) through 02:00 ET
    if t >= 18 * 60 or t < 2 * 60:
        return "asian"
    # London killzone: 02:00-05:00 ET
    if 2 * 60 <= t < 5 * 60:
        return "london"
    # Pre-market: 05:00-09:30 ET
    if 5 * 60 <= t < 9 * 60 + 30:
        return "pre_market"
    # NY AM: 09:30-12:00 ET
    if 9 * 60 + 30 <= t < 12 * 60:
        return "ny_am"
    # NY PM: 12:00-16:00 ET
    if 12 * 60 <= t < 16 * 60:
        return "ny_pm"
    # 16:00-17:00 ET: RTH closed, Globex not yet paused
    return "overnight"


def _is_macro_time(hour: int, minute: int) -> bool:
    """Check if current time is in ICT macro window (xx:50 - xx:10)."""
    return minute >= 50 or minute <= 10


def _trading_date_et(ts_et) -> object:
    """Return the CME trading date for an ET timestamp.

    A new trading day starts at 17:00 CT (18:00 ET) the prior calendar day.
    Bars before 18:00 ET belong to the PREVIOUS calendar date's trading session.
    We use 17:00 ET as the cutoff (conservative; CME is 16:00 CT = 17:00 ET).
    """
    if ts_et is None:
        return None
    from datetime import timedelta
    # If hour < 17 ET, this bar is part of the current calendar day's session.
    # If hour >= 17 ET, this bar belongs to TOMORROW's trading date.
    if ts_et.hour >= 17:
        return (ts_et + timedelta(days=1)).date()
    return ts_et.date()


def compute_session_context(
    df: pl.DataFrame,
    bar_idx: int,
    prev_day_high: float,
    prev_day_low: float,
) -> SessionContext:
    """Compute session context for a specific bar.

    Args:
        df: Intraday OHLCV data with ts_et (ET timezone) or ts_event (UTC) column
        bar_idx: Current bar index
        prev_day_high: Previous day's high (from HTF context)
        prev_day_low: Previous day's low
    """
    ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
    current_ts_raw = df[ts_col][int(bar_idx)]

    # Convert to ET — handles both naive UTC and tz-aware timestamps
    current_ts_et = _to_et(current_ts_raw)

    if current_ts_et is not None:
        current_hour = current_ts_et.hour
        current_minute = current_ts_et.minute
    else:
        current_hour = 9
        current_minute = 30

    current_session = _get_session(current_hour, current_minute)
    current_trading_date = _trading_date_et(current_ts_et)

    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()
    closes = df["close"].to_numpy()

    # ------------------------------------------------------------------
    # F-2: Overnight range — timestamp-driven scan (not hardcoded -100)
    # Walk backward from bar_idx collecting bars whose ET hour is in
    # [17,24) OR [0,9) (Globex overnight) AND share the same trading date.
    # Stop when trading date changes.
    # ------------------------------------------------------------------
    on_highs = []
    on_lows = []
    for i in range(bar_idx, -1, -1):
        ts_raw = df[ts_col][i]
        ts_et = _to_et(ts_raw)
        if ts_et is None:
            break
        bar_trading_date = _trading_date_et(ts_et)
        if bar_trading_date != current_trading_date:
            break
        bar_hour = ts_et.hour
        # Globex overnight hours: 17:00-23:59 ET and 00:00-08:59 ET
        if bar_hour >= 17 or bar_hour < 9:
            on_highs.append(float(highs[i]))
            on_lows.append(float(lows[i]))

    if on_highs:
        on_high = float(np.max(on_highs))
        on_low = float(np.min(on_lows))
    else:
        on_high = float(highs[bar_idx])
        on_low = float(lows[bar_idx])

    # Overnight bias: direction of overnight move relative to prior RTH close
    if on_highs:
        on_close = float(closes[bar_idx])
        # Use earliest overnight bar as the "open"
        on_open_idx = bar_idx - len(on_highs) + 1
        on_open = float(closes[max(0, on_open_idx)])
        if on_close > on_open * 1.001:
            overnight_bias = "bullish"
        elif on_close < on_open * 0.999:
            overnight_bias = "bearish"
        else:
            overnight_bias = "neutral"
    else:
        overnight_bias = "neutral"

    # ------------------------------------------------------------------
    # F-3 + F-6: London scan — timestamp-driven, same trading-date only
    # 2-5 AM ET bars that belong to the SAME trading date as current bar.
    # ------------------------------------------------------------------
    london_high = float('nan')
    london_low = float('nan')
    london_swept_pdh = False
    london_swept_pdl = False
    london_found = False

    for i in range(max(0, bar_idx - 200), bar_idx):
        ts_raw = df[ts_col][i]
        ts_et = _to_et(ts_raw)
        if ts_et is None:
            continue
        bar_hour = ts_et.hour
        # F-3: must be same trading date as current bar
        bar_trading_date = _trading_date_et(ts_et)
        if bar_trading_date != current_trading_date:
            continue
        # F-6: use _to_et() hour — correctly handles UTC input
        if 2 <= bar_hour < 5:
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

    if not london_found:
        london_high = prev_day_high
        london_low = prev_day_low

    # ------------------------------------------------------------------
    # F-4: Opening range scan — EXCLUDE current bar (range(... bar_idx),
    # not range(... bar_idx + 1)) to prevent lookahead.
    # F-6: use _to_et() for hour/minute reads.
    # ------------------------------------------------------------------
    or_high = float('nan')
    or_low = float('nan')
    or_found = False
    for i in range(max(0, bar_idx - 50), bar_idx):  # F-4: bar_idx excluded
        ts_raw = df[ts_col][i]
        ts_et = _to_et(ts_raw)
        if ts_et is None:
            continue
        # F-6: use converted ET hour/minute
        if ts_et.hour == 9 and 30 <= ts_et.minute < 45:
            h = float(highs[i])
            l = float(lows[i])
            if not or_found:
                or_high = h
                or_low = l
                or_found = True
            else:
                or_high = max(or_high, h)
                or_low = min(or_low, l)

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

    # ------------------------------------------------------------------
    # F-6: Killzone status — use ET-converted hour/minute
    # ------------------------------------------------------------------
    t_mins = current_hour * 60 + current_minute
    ny_kz = 9 * 60 + 30 <= t_mins < 11 * 60
    london_kz = 2 * 60 <= t_mins < 5 * 60
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
