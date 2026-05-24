"""HTF Narrative State — per-session institutional context (Wave 25 Pass 2 W25.5).

Computes four narrative dataclasses that capture the session-level institutional
context for an intraday trading session. All functions are PURE: no DB, no time.now(),
no side effects. Same inputs always produce the same output (replay determinism).

Session timing constants (ET):
    Asian session:  18:00 ET (prior day) → 03:00 ET
    London session: 03:00 ET → 08:30 ET (pre-NY open)
    NY session:     08:30 ET → 10:30 ET (AM high-probability window)
    Overnight range: Asian + London combined (18:00 ET prior → 09:30 ET)

All timestamps in the DataFrames are expected as UTC. ET offsets:
    EST = UTC-5, EDT = UTC-4. We use UTC arithmetic throughout and
    document the ET equivalents in comments.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import polars as pl

logger = logging.getLogger(__name__)

# ─── UTC hour boundaries for session detection ───────────────────────────────
# These assume EDT (summer, UTC-4). During EST (winter, UTC-5) add 1 hour.
# Production should use DST-aware detection via Intl.DateTimeFormat (TS side)
# or zoneinfo (Python side). For backtest replay, the small EST/EDT boundary
# difference (1h) does not materially affect session detection.

# Asian session: 22:00 UTC (prev day 18:00 EDT) → 07:00 UTC (03:00 EDT)
_ASIAN_START_UTC_HOUR = 22   # 18:00 EDT previous day
_ASIAN_END_UTC_HOUR   = 7    # 03:00 EDT

# London session: 07:00 UTC (03:00 EDT) → 12:30 UTC (08:30 EDT)
_LONDON_START_UTC_HOUR = 7
_LONDON_END_UTC_HOUR   = 12   # approximation; 12:30 for NY open

# NY session: 13:30 UTC (09:30 EDT) → 14:30 UTC (10:30 EDT)
_NY_OPEN_UTC_HOUR   = 13
_NY_OPEN_UTC_MINUTE = 30


# ─── Dataclasses ─────────────────────────────────────────────────────────────

@dataclass
class AsianRange:
    """Asian session high/low range (Globex overnight, 18:00–03:00 ET).

    Formed when Asian session bars are available. range_size = high - low.
    formed_at_bar_idx: index in the intraday_bars DataFrame of the last Asian bar.
    """
    high: Optional[float]
    low: Optional[float]
    range_size: Optional[float]
    formed_at_bar_idx: Optional[int]


@dataclass
class LondonBias:
    """London session directional bias and PDH/PDL sweep events.

    direction: "bullish" | "bearish" | None
      Bullish: London expanded higher (london_high > overnight_mid)
      Bearish: London expanded lower (london_low < overnight_mid)
      None: insufficient data.

    swept_pdh: True when London session printed a high above the prior-day-high.
    swept_pdl: True when London session printed a low below the prior-day-low.
    """
    direction: Optional[str]   # "bullish" | "bearish" | None
    swept_pdh: bool
    swept_pdl: bool


@dataclass
class NYBias:
    """NY open bias relative to the overnight (Asian + London) range.

    direction: "bullish" | "bearish" | None based on where NY opened relative
      to the overnight range midpoint.

    open_above_overnight_range: True when NY open price > overnight_range_high.
      Signals a gap-up / trend-continuation day.
    open_below_overnight_range: True when NY open price < overnight_range_low.
      Signals a gap-down / trend-continuation day.
    """
    direction: Optional[str]
    open_above_overnight_range: bool
    open_below_overnight_range: bool


@dataclass
class DailyDealing:
    """Daily dealing range quadrant positioning (ICT premium/discount framework).

    dealing_range_high: Yesterday's high (PDH).
    dealing_range_low: Yesterday's low (PDL).
    current_quadrant: Where the current price sits within the range.

    Quadrant definitions (Fibonacci-based):
        premium_upper:  price in [0.786, 1.0] of the range
        premium_lower:  price in [0.618, 0.786] of the range
        equilibrium:    price in [0.382, 0.618] of the range (50% zone)
        discount_upper: price in [0.236, 0.382] of the range
        discount_lower: price in [0.0,   0.236] of the range
    """
    dealing_range_high: Optional[float]
    dealing_range_low: Optional[float]
    current_quadrant: Optional[str]   # see quadrant definitions above


@dataclass
class HtfNarrative:
    """Full per-session HTF narrative state.

    Pure-function output: same inputs → same HtfNarrative. No side effects.
    consumed_at_bar_idx references the current_bar_idx argument passed to
    compute_htf_narrative() for traceability in replay.
    """
    asian_range: AsianRange
    london_bias: LondonBias
    ny_bias: NYBias
    daily_dealing: DailyDealing
    computed_at_bar_idx: int


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _get_session_bars(
    intraday_bars: pl.DataFrame,
    start_hour_utc: int,
    end_hour_utc: int,
    start_minute_utc: int = 0,
) -> pl.DataFrame:
    """Filter intraday bars to a session time window (UTC hours).

    Handles sessions that wrap midnight UTC (e.g. Asian: 22:00 → 07:00).
    start_hour_utc < end_hour_utc → normal window.
    start_hour_utc >= end_hour_utc → wraps midnight (e.g. 22 >= 7 wraps).
    """
    if "ts_event" not in intraday_bars.columns:
        return pl.DataFrame()

    ts = intraday_bars["ts_event"]

    # Extract hour + minute from ts_event
    hour_col = ts.dt.hour()
    minute_col = ts.dt.minute()

    if start_hour_utc < end_hour_utc:
        # Simple window: e.g. 07:00–12:00
        in_window = (
            (hour_col > start_hour_utc) |
            ((hour_col == start_hour_utc) & (minute_col >= start_minute_utc))
        ) & (hour_col < end_hour_utc)
    else:
        # Wraps midnight: e.g. 22:00 (prev day) → 07:00 (next day)
        in_window = (
            (hour_col >= start_hour_utc) |
            (hour_col < end_hour_utc)
        )

    return intraday_bars.filter(in_window)


def _classify_quadrant(price: float, high: float, low: float) -> Optional[str]:
    """Classify price into ICT dealing range quadrant.

    Returns None if range is zero (degenerate bar).
    """
    range_size = high - low
    if range_size < 1e-9:
        return None
    pct = (price - low) / range_size  # 0.0 = at low, 1.0 = at high
    if pct >= 0.786:
        return "premium_upper"
    elif pct >= 0.618:
        return "premium_lower"
    elif pct >= 0.382:
        return "equilibrium"
    elif pct >= 0.236:
        return "discount_upper"
    else:
        return "discount_lower"


def _safe_float(val: object) -> Optional[float]:
    """Safely convert a Polars scalar or Python numeric to float, None if null/NaN."""
    if val is None:
        return None
    try:
        f = float(val)
        import math
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


# ─── Core compute function ────────────────────────────────────────────────────

def compute_htf_narrative(
    daily_bars: pl.DataFrame,
    intraday_bars: pl.DataFrame,
    htf_bars: Optional[pl.DataFrame],
    current_bar_idx: int,
) -> HtfNarrative:
    """Compute per-session HTF narrative state. Pure function — no side effects.

    Consumes:
        daily_bars:     Daily OHLCV. Must have ts_event, open, high, low, close.
                        The most recent COMPLETED daily bar is daily_bars[-1].
        intraday_bars:  5m or finer OHLCV bars covering the current session.
                        Used for Asian/London/NY session window detection.
        htf_bars:       4H OHLCV (optional). Currently unused; reserved for future
                        4H level overlay (e.g. 4H OB/FVG detection in Pass 3).
        current_bar_idx: Index of the current bar in the exec-TF DataFrame.
                        Written to HtfNarrative.computed_at_bar_idx for traceability.

    Returns:
        HtfNarrative with all four sub-dataclasses populated. Individual fields
        may be None when insufficient data is available (fail-open: never raises).
    """
    # ── 1. AsianRange ─────────────────────────────────────────────────────────
    asian_range = _compute_asian_range(intraday_bars)

    # ── 2. LondonBias ─────────────────────────────────────────────────────────
    london_bias = _compute_london_bias(intraday_bars, daily_bars, asian_range)

    # ── 3. NYBias ─────────────────────────────────────────────────────────────
    ny_bias = _compute_ny_bias(intraday_bars, asian_range)

    # ── 4. DailyDealing ───────────────────────────────────────────────────────
    daily_dealing = _compute_daily_dealing(daily_bars, intraday_bars)

    return HtfNarrative(
        asian_range=asian_range,
        london_bias=london_bias,
        ny_bias=ny_bias,
        daily_dealing=daily_dealing,
        computed_at_bar_idx=current_bar_idx,
    )


def _compute_asian_range(intraday_bars: pl.DataFrame) -> AsianRange:
    """Compute Asian session range from intraday bars.

    Window: 22:00 UTC → 07:00 UTC (18:00 EDT → 03:00 EDT).
    """
    _empty = AsianRange(high=None, low=None, range_size=None, formed_at_bar_idx=None)
    if intraday_bars is None or len(intraday_bars) == 0:
        return _empty

    asian_bars = _get_session_bars(
        intraday_bars,
        start_hour_utc=_ASIAN_START_UTC_HOUR,
        end_hour_utc=_ASIAN_END_UTC_HOUR,
    )
    if len(asian_bars) == 0:
        return _empty

    high = _safe_float(asian_bars["high"].max())
    low = _safe_float(asian_bars["low"].min())
    if high is None or low is None:
        return _empty

    range_size = round(high - low, 4)
    # formed_at_bar_idx: index of last Asian bar in the original intraday_bars
    last_asian_ts = asian_bars["ts_event"][-1]
    formed_idx: Optional[int] = None
    try:
        matching = intraday_bars.filter(pl.col("ts_event") == last_asian_ts)
        if len(matching) > 0:
            # Find position in original df
            idx_arr = intraday_bars["ts_event"].to_list()
            formed_idx = len(idx_arr) - 1 - next(
                i for i, v in enumerate(reversed(idx_arr)) if v == last_asian_ts
            )
    except Exception:
        pass

    return AsianRange(
        high=high,
        low=low,
        range_size=range_size,
        formed_at_bar_idx=formed_idx,
    )


def _compute_london_bias(
    intraday_bars: pl.DataFrame,
    daily_bars: pl.DataFrame,
    asian_range: AsianRange,
) -> LondonBias:
    """Compute London session bias and PDH/PDL sweep detection.

    London window: 07:00 UTC → 12:00 UTC (03:00 EDT → 08:00 EDT).
    PDH/PDL from the most recent completed daily bar.
    """
    _empty = LondonBias(direction=None, swept_pdh=False, swept_pdl=False)
    if intraday_bars is None or len(intraday_bars) == 0:
        return _empty

    london_bars = _get_session_bars(
        intraday_bars,
        start_hour_utc=_LONDON_START_UTC_HOUR,
        end_hour_utc=_LONDON_END_UTC_HOUR,
    )
    if len(london_bars) == 0:
        return _empty

    london_high = _safe_float(london_bars["high"].max())
    london_low = _safe_float(london_bars["low"].min())

    # Direction: compare London range expansion vs Asian range midpoint
    direction: Optional[str] = None
    if asian_range.high is not None and asian_range.low is not None and london_high is not None and london_low is not None:
        overnight_mid = (asian_range.high + asian_range.low) / 2.0
        if london_high > overnight_mid and london_low > asian_range.low:
            direction = "bullish"
        elif london_low < overnight_mid and london_high < asian_range.high:
            direction = "bearish"
        # else: expansion in both directions or insufficient departure → None

    # PDH/PDL sweep
    swept_pdh = False
    swept_pdl = False
    if daily_bars is not None and len(daily_bars) >= 2 and london_high is not None and london_low is not None:
        # Use second-to-last bar = previous completed day (last bar = today forming)
        pdh = _safe_float(daily_bars["high"][-2])
        pdl = _safe_float(daily_bars["low"][-2])
        if pdh is not None:
            swept_pdh = london_high > pdh
        if pdl is not None:
            swept_pdl = london_low < pdl

    return LondonBias(direction=direction, swept_pdh=swept_pdh, swept_pdl=swept_pdl)


def _compute_ny_bias(
    intraday_bars: pl.DataFrame,
    asian_range: AsianRange,
) -> NYBias:
    """Compute NY open bias relative to the overnight (Asian) range.

    NY open: first bar at or after 13:30 UTC (09:30 EDT).
    """
    _empty = NYBias(direction=None, open_above_overnight_range=False, open_below_overnight_range=False)
    if intraday_bars is None or len(intraday_bars) == 0:
        return _empty
    if "ts_event" not in intraday_bars.columns:
        return _empty

    # Find first bar at or after 13:30 UTC
    hour_col = intraday_bars["ts_event"].dt.hour()
    min_col = intraday_bars["ts_event"].dt.minute()
    ny_mask = (hour_col > _NY_OPEN_UTC_HOUR) | (
        (hour_col == _NY_OPEN_UTC_HOUR) & (min_col >= _NY_OPEN_UTC_MINUTE)
    )
    ny_bars = intraday_bars.filter(ny_mask)
    if len(ny_bars) == 0:
        return _empty

    ny_open_price = _safe_float(ny_bars["open"][0])
    if ny_open_price is None:
        return _empty

    direction: Optional[str] = None
    open_above = False
    open_below = False

    if asian_range.high is not None and asian_range.low is not None:
        overnight_mid = (asian_range.high + asian_range.low) / 2.0
        open_above = ny_open_price > asian_range.high
        open_below = ny_open_price < asian_range.low
        if open_above or ny_open_price > overnight_mid:
            direction = "bullish"
        elif open_below or ny_open_price < overnight_mid:
            direction = "bearish"

    return NYBias(
        direction=direction,
        open_above_overnight_range=open_above,
        open_below_overnight_range=open_below,
    )


def _compute_daily_dealing(
    daily_bars: pl.DataFrame,
    intraday_bars: pl.DataFrame,
) -> DailyDealing:
    """Compute current dealing range quadrant using yesterday's PDH/PDL.

    dealing_range_high = PDH, dealing_range_low = PDL (yesterday).
    current_price = most recent close in intraday_bars (or daily_bars[-1] close).
    """
    _empty = DailyDealing(dealing_range_high=None, dealing_range_low=None, current_quadrant=None)

    pdh: Optional[float] = None
    pdl: Optional[float] = None

    if daily_bars is not None and len(daily_bars) >= 2:
        pdh = _safe_float(daily_bars["high"][-2])
        pdl = _safe_float(daily_bars["low"][-2])

    if pdh is None or pdl is None:
        return _empty

    # Current price: most recent intraday close, or daily close if no intraday
    current_price: Optional[float] = None
    if intraday_bars is not None and len(intraday_bars) > 0 and "close" in intraday_bars.columns:
        current_price = _safe_float(intraday_bars["close"][-1])
    elif daily_bars is not None and len(daily_bars) >= 1 and "close" in daily_bars.columns:
        current_price = _safe_float(daily_bars["close"][-1])

    if current_price is None:
        return DailyDealing(dealing_range_high=pdh, dealing_range_low=pdl, current_quadrant=None)

    quadrant = _classify_quadrant(current_price, pdh, pdl)
    return DailyDealing(
        dealing_range_high=pdh,
        dealing_range_low=pdl,
        current_quadrant=quadrant,
    )
