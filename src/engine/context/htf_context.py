"""HTF Context — Pre-loads daily, 4H, 1H alongside strategy timeframe.

All HTF data uses PREVIOUS completed bar (shift(1)) — no look-ahead.
Today's daily bar is NOT available until 16:00 ET close.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import polars as pl

logger = logging.getLogger(__name__)


@dataclass
class HTFContext:
    daily_trend: str        # "bullish" | "bearish" | "neutral" (SMA 20/50/200 alignment)
    weekly_trend: str       # "bullish" | "bearish" | "neutral"
    four_h_trend: str       # "bullish" | "bearish" | "neutral"
    pd_location: str        # "premium" | "discount" | "equilibrium" (vs daily range)
    prev_day_high: float
    prev_day_low: float
    prev_day_close: float
    weekly_high: float
    weekly_low: float
    adr: float              # Average Daily Range (20-day)
    atr_percentile: float   # Current ATR vs 60-day percentile (0-100)
    daily_ob_levels: list = field(default_factory=list)   # Untested daily order blocks
    daily_fvg_levels: list = field(default_factory=list)  # Unfilled daily FVGs
    adx: float = 0.0       # Trend strength


def _classify_trend(sma_20: float, sma_50: float, sma_200: float, close: float) -> str:
    """Classify trend from SMA alignment. Bullish = 20>50>200 and close above all."""
    if sma_20 > sma_50 > sma_200 and close > sma_20:
        return "bullish"
    elif sma_20 < sma_50 < sma_200 and close < sma_20:
        return "bearish"
    return "neutral"


def _premium_discount(price: float, high: float, low: float) -> str:
    """Premium/discount relative to a range. Above midpoint = premium, below = discount."""
    range_size = high - low
    if range_size < 1e-9:
        return "equilibrium"
    pct = (price - low) / range_size
    if pct > 0.618:
        return "premium"
    elif pct < 0.382:
        return "discount"
    return "equilibrium"


def compute_htf_context(
    daily_df: pl.DataFrame,
    four_h_df: Optional[pl.DataFrame],
    one_h_df: Optional[pl.DataFrame],
    current_price: float,
    bar_date: object = None,
) -> HTFContext:
    """Compute higher-timeframe context using COMPLETED bars only (shift-1 safe).

    Args:
        daily_df: Daily OHLCV data (must have SMA columns or we compute them)
        four_h_df: 4H OHLCV data (optional)
        one_h_df: 1H OHLCV data (optional)
        current_price: Current bar's close price
        bar_date: Current bar's date (to filter daily data up to previous day)
    """
    # Use PREVIOUS completed daily bar (no look-ahead)
    # If bar_date provided, filter to only completed days
    d = daily_df
    if bar_date is not None and "ts_event" in d.columns:
        d = d.filter(pl.col("ts_event") < bar_date)

    if len(d) < 200:
        # Not enough data for full analysis — return neutral defaults
        last = d.row(-1, named=True) if len(d) > 0 else None
        return HTFContext(
            daily_trend="neutral", weekly_trend="neutral", four_h_trend="neutral",
            pd_location="equilibrium",
            prev_day_high=float(last["high"]) if last is not None else current_price,
            prev_day_low=float(last["low"]) if last is not None else current_price,
            prev_day_close=float(last["close"]) if last is not None else current_price,
            weekly_high=current_price, weekly_low=current_price,
            adr=0.0, atr_percentile=50.0,
        )

    closes = d["close"].to_numpy()
    highs = d["high"].to_numpy()
    lows = d["low"].to_numpy()

    # SMAs on daily
    sma_20 = float(np.mean(closes[-20:]))
    sma_50 = float(np.mean(closes[-50:]))
    sma_200 = float(np.mean(closes[-200:]))
    daily_trend = _classify_trend(sma_20, sma_50, sma_200, float(closes[-1]))

    # Previous day values
    prev_day_high = float(highs[-1])
    prev_day_low = float(lows[-1])
    prev_day_close = float(closes[-1])

    # ------------------------------------------------------------------
    # F-1: Weekly high/low — ISO-week grouping, NOT rolling last 5 bars.
    # Filter to the PREVIOUS completed ISO week relative to bar_date.
    # Falls back to last 5 bars if no prior-week data exists.
    # ------------------------------------------------------------------
    weekly_high, weekly_low = _compute_weekly_range(d, bar_date, highs, lows)

    # ADR (20-day average daily range)
    daily_ranges = highs[-20:] - lows[-20:]
    adr = float(np.mean(daily_ranges))

    # ATR percentile (14-day ATR vs 60-day window)
    # F-10: highs/lows/closes here are slices of the already-filtered `d`
    # so bar_date filtering at the top of this function prevents lookahead.
    if len(d) >= 60:
        # Simple ATR: average of true ranges
        tr = np.maximum(
            highs[-60:] - lows[-60:],
            np.maximum(
                np.abs(highs[-60:] - np.roll(closes[-60:], 1)),
                np.abs(lows[-60:] - np.roll(closes[-60:], 1)),
            )
        )
        tr[0] = highs[-60] - lows[-60]  # First bar has no previous close
        current_atr = float(np.mean(tr[-14:]))
        all_atrs = np.array([float(np.mean(tr[i:i+14])) for i in range(len(tr)-14+1)])
        atr_percentile = float(np.sum(all_atrs <= current_atr) / len(all_atrs) * 100)
    else:
        atr_percentile = 50.0

    # Premium/discount
    pd_location = _premium_discount(current_price, prev_day_high, prev_day_low)

    # 4H trend
    # ★★ KNOWN LOOK-AHEAD — DO NOT WIRE (independent grade F-1, 2026-07-20).
    # The `bar_date` filter above (see `d = daily_df ... filter(ts_event < bar_date)`)
    # applies ONLY to `daily_df`. `four_h_df`/`one_h_df` are used UNSLICED below, so
    # c4[-1]/c4[-20:]/c4[-200:] read the END OF THE WHOLE LOADED FRAME regardless of
    # bar_date. For a cache entry keyed to day D that is FUTURE data. The module header's
    # "All HTF data uses PREVIOUS completed bar (shift(1)) — no look-ahead" is TRUE FOR
    # DAILY and FALSE HERE. No consumer reads four_h_trend today (verified repo-wide), and
    # htf_columns.py has WITHDRAWN its column. Fixing this changes the eligibility gate's
    # behavior, so it needs its OWN ratify packet + independent grade — do not fix inline.
    four_h_trend = "neutral"
    if four_h_df is not None and len(four_h_df) >= 200:
        c4 = four_h_df["close"].to_numpy()
        four_h_trend = _classify_trend(
            float(np.mean(c4[-20:])), float(np.mean(c4[-50:])),
            float(np.mean(c4[-200:])), float(c4[-1])
        )

    # Weekly trend (approximate from daily: 20-week ≈ 100 days, 50-week ≈ 250, 200-week ≈ 1000)
    weekly_trend = "neutral"
    if len(closes) >= 250:
        sma_200w = float(np.mean(closes[-min(1000, len(closes)):])) if len(closes) >= 500 else float(np.mean(closes))
        weekly_trend = _classify_trend(
            float(np.mean(closes[-100:])), float(np.mean(closes[-250:])),
            sma_200w,
            float(closes[-1])
        )

    # ADX (simplified — use 14-period directional movement)
    adx = 0.0
    if len(d) >= 28:
        # Simplified ADX calculation
        plus_dm = np.maximum(np.diff(highs[-28:]), 0)
        minus_dm = np.maximum(-np.diff(lows[-28:]), 0)
        # Zero out when opposite DM is larger
        mask = plus_dm > minus_dm
        plus_dm = np.where(mask, plus_dm, 0)
        minus_dm = np.where(~mask, minus_dm, 0)
        tr_vals = np.maximum(
            highs[-27:] - lows[-27:],
            np.maximum(np.abs(highs[-27:] - closes[-28:-1]), np.abs(lows[-27:] - closes[-28:-1]))
        )
        atr14 = float(np.mean(tr_vals[-14:]))
        if atr14 > 0:
            plus_di = float(np.mean(plus_dm[-14:])) / atr14 * 100
            minus_di = float(np.mean(minus_dm[-14:])) / atr14 * 100
            di_sum = plus_di + minus_di
            if di_sum > 0:
                dx = abs(plus_di - minus_di) / di_sum * 100
                adx = dx  # Simplified — true ADX smooths DX over 14 periods

    return HTFContext(
        daily_trend=daily_trend,
        weekly_trend=weekly_trend,
        four_h_trend=four_h_trend,
        pd_location=pd_location,
        prev_day_high=prev_day_high,
        prev_day_low=prev_day_low,
        prev_day_close=prev_day_close,
        weekly_high=weekly_high,
        weekly_low=weekly_low,
        adr=adr,
        atr_percentile=atr_percentile,
        adx=adx,
    )


def _compute_weekly_range(
    d: pl.DataFrame,
    bar_date: object,
    highs: "np.ndarray",
    lows: "np.ndarray",
) -> tuple:
    """Compute weekly high/low using ISO-week grouping.

    Returns the high/low of the PREVIOUS completed ISO week relative to
    bar_date. If bar_date is None or no ts_event column, or no prior-week
    data exists, falls back to last 5 bars with a warning log.

    Returns:
        (weekly_high, weekly_low)
    """
    fallback_high = float(np.max(highs[-5:]))
    fallback_low = float(np.min(lows[-5:]))

    if bar_date is None or "ts_event" not in d.columns:
        logger.warning("htf_context: bar_date not provided; weekly range falls back to last 5 bars")
        return fallback_high, fallback_low

    try:
        # Determine current bar's ISO week from bar_date
        import datetime as _dt
        if hasattr(bar_date, "isocalendar"):
            bar_iso = bar_date.isocalendar()
        elif hasattr(bar_date, "date"):
            bar_iso = bar_date.date().isocalendar()
        else:
            # Try parsing string
            bar_dt = _dt.date.fromisoformat(str(bar_date)[:10])
            bar_iso = bar_dt.isocalendar()

        bar_iso_year = bar_iso[0]
        bar_iso_week = bar_iso[1]

        # Compute previous week
        if bar_iso_week == 1:
            prev_iso_year = bar_iso_year - 1
            # ISO weeks in the previous year
            dec_28 = _dt.date(prev_iso_year, 12, 28)
            prev_iso_week = dec_28.isocalendar()[1]
        else:
            prev_iso_year = bar_iso_year
            prev_iso_week = bar_iso_week - 1

        # Add iso_week + iso_year columns to filter
        weekly_d = (
            d
            .with_columns([
                pl.col("ts_event").dt.week().alias("_iso_week"),
                pl.col("ts_event").dt.iso_year().alias("_iso_year"),
            ])
            .filter(
                (pl.col("_iso_year") == prev_iso_year) &
                (pl.col("_iso_week") == prev_iso_week)
            )
        )

        if len(weekly_d) == 0:
            logger.warning(
                "htf_context: no bars found for ISO week %d-%d; falling back to last 5 bars",
                prev_iso_year, prev_iso_week,
            )
            return fallback_high, fallback_low

        wh = float(weekly_d["high"].max())
        wl = float(weekly_d["low"].min())
        return wh, wl

    except Exception as exc:
        logger.warning("htf_context: ISO-week weekly range failed (%s); falling back to last 5 bars", exc)
        return fallback_high, fallback_low
