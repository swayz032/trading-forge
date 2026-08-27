#!/usr/bin/env python3
"""Deterministic candlestick recognition for Current MNQ v2.4.

Design rule from the trader:
    NO ZONE -> NO TRADE.

Candlestick names are a human-readable taxonomy over normalized OHLC geometry.
The engine must use the geometry + sequence to infer buyer/seller control only
AFTER price reaches an authorized zone. A named pattern away from a zone has zero
entry authority.

The constants here are semantic geometry defaults, not PnL-optimized thresholds.
Definitions of obscure Japanese labels vary across references, so the machine
stores both the recognized label and the underlying measurements.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Iterable

import numpy as np
import pandas as pd

EPS = 1e-12


class Interaction(str, Enum):
    NONE = "NONE"
    TOUCH = "TOUCH"
    SWEEP_RECLAIM_UP = "SWEEP_RECLAIM_UP"
    SWEEP_RECLAIM_DOWN = "SWEEP_RECLAIM_DOWN"
    BREAK_CLOSE_UP = "BREAK_CLOSE_UP"
    BREAK_CLOSE_DOWN = "BREAK_CLOSE_DOWN"


@dataclass(frozen=True)
class Geometry:
    open: float
    high: float
    low: float
    close: float
    range: float
    body: float
    body_frac: float
    upper_wick: float
    lower_wick: float
    upper_frac: float
    lower_frac: float
    close_loc: float
    bullish: bool
    bearish: bool


@dataclass(frozen=True)
class CandleEvidence:
    patterns: tuple[str, ...]
    bullish_reversal: bool
    bearish_reversal: bool
    bullish_momentum: bool
    bearish_momentum: bool
    indecision: bool
    compression: bool
    expansion: bool


@dataclass(frozen=True)
class ZoneCandleDecision:
    reached_zone: bool
    interaction: str
    patterns: tuple[str, ...]
    bullish_control: bool
    bearish_control: bool
    indecision: bool
    reversal_long_confirmed: bool
    reversal_short_confirmed: bool
    breakout_long_confirmed: bool
    breakout_short_confirmed: bool
    reason: str


def geometry(row) -> Geometry:
    o, h, l, c = map(float, (row.open, row.high, row.low, row.close))
    r = max(h - l, EPS)
    b = abs(c - o)
    uw = max(0.0, h - max(o, c))
    lw = max(0.0, min(o, c) - l)
    return Geometry(
        open=o, high=h, low=l, close=c, range=r, body=b,
        body_frac=b / r, upper_wick=uw, lower_wick=lw,
        upper_frac=uw / r, lower_frac=lw / r,
        close_loc=(c - l) / r, bullish=c > o, bearish=c < o,
    )


def _near(a: float, b: float, tolerance: float) -> bool:
    return abs(a - b) <= tolerance


def _doji(g: Geometry) -> bool:
    return g.body_frac <= 0.10


def _spinning(g: Geometry) -> bool:
    return g.body_frac <= 0.30 and g.upper_frac >= 0.20 and g.lower_frac >= 0.20


def _long_body(g: Geometry) -> bool:
    return g.body_frac >= 0.65


def _marubozu(g: Geometry) -> bool:
    return g.body_frac >= 0.80 and g.upper_frac <= 0.10 and g.lower_frac <= 0.10


def _lower_rejection(g: Geometry) -> bool:
    return g.lower_frac >= 0.50 and g.body_frac <= 0.45 and g.upper_frac <= 0.25


def _upper_rejection(g: Geometry) -> bool:
    return g.upper_frac >= 0.50 and g.body_frac <= 0.45 and g.lower_frac <= 0.25


def _engulfs(a: Geometry, b: Geometry) -> bool:
    alo, ahi = sorted((a.open, a.close))
    blo, bhi = sorted((b.open, b.close))
    return blo <= alo + EPS and bhi >= ahi - EPS and (bhi - blo) > (ahi - alo) + EPS


def _inside(a: Geometry, b: Geometry) -> bool:
    return b.high <= a.high + EPS and b.low >= a.low - EPS


def _outside(a: Geometry, b: Geometry) -> bool:
    return b.high >= a.high - EPS and b.low <= a.low + EPS


def _body_inside(a: Geometry, b: Geometry) -> bool:
    alo, ahi = sorted((a.open, a.close))
    blo, bhi = sorted((b.open, b.close))
    return blo >= alo - EPS and bhi <= ahi + EPS


def _mid(g: Geometry) -> float:
    return (g.open + g.close) / 2.0


def _gap_up(a: Geometry, b: Geometry) -> bool:
    return b.low > a.high


def _gap_down(a: Geometry, b: Geometry) -> bool:
    return b.high < a.low


def _trend3(gs: list[Geometry], bullish: bool) -> bool:
    if len(gs) < 3:
        return False
    a, b, c = gs[-3:]
    if bullish:
        return all(x.bullish and x.body_frac >= 0.50 for x in (a, b, c)) and b.close > a.close and c.close > b.close
    return all(x.bearish and x.body_frac >= 0.50 for x in (a, b, c)) and b.close < a.close and c.close < b.close


def classify_patterns(bars: pd.DataFrame) -> CandleEvidence:
    if bars is None or len(bars) == 0:
        return CandleEvidence((), False, False, False, False, False, False, False)
    q = bars.tail(5)
    gs = [geometry(r) for _, r in q.iterrows()]
    g = gs[-1]
    pats: set[str] = set()
    bull_rev = bear_rev = bull_mom = bear_mom = False
    indecision = False

    # Single-candle families.
    if _doji(g):
        pats.add("DOJI")
        indecision = True
        if g.upper_frac >= 0.40 and g.lower_frac >= 0.40:
            pats.add("LONG_LEGGED_DOJI")
        if g.lower_frac >= 0.60 and g.upper_frac <= 0.15:
            pats.add("DRAGONFLY_DOJI"); bull_rev = True
        if g.upper_frac >= 0.60 and g.lower_frac <= 0.15:
            pats.add("GRAVESTONE_DOJI"); bear_rev = True
    if _spinning(g):
        pats.add("SPINNING_TOP"); indecision = True
    if _lower_rejection(g):
        pats.update(("HAMMER_GEOMETRY", "BULLISH_PIN_REJECTION")); bull_rev = True
    if _upper_rejection(g):
        pats.update(("SHOOTING_STAR_GEOMETRY", "BEARISH_PIN_REJECTION")); bear_rev = True
    if _marubozu(g):
        if g.bullish:
            pats.add("BULLISH_MARUBOZU"); bull_mom = True
        elif g.bearish:
            pats.add("BEARISH_MARUBOZU"); bear_mom = True
    elif _long_body(g):
        if g.bullish:
            pats.add("BULLISH_LONG_BODY_DISPLACEMENT"); bull_mom = True
        elif g.bearish:
            pats.add("BEARISH_LONG_BODY_DISPLACEMENT"); bear_mom = True

    # Two-candle families.
    if len(gs) >= 2:
        a, b = gs[-2], gs[-1]
        tol = max(a.range, b.range) * 0.08
        if a.bearish and b.bullish and _engulfs(a, b):
            pats.add("BULLISH_ENGULFING"); bull_rev = True
        if a.bullish and b.bearish and _engulfs(a, b):
            pats.add("BEARISH_ENGULFING"); bear_rev = True
        if _body_inside(a, b):
            pats.add("INSIDE_BODY")
            if _doji(b): pats.add("HARAMI_CROSS")
            elif a.bearish and b.bullish: pats.add("BULLISH_HARAMI"); bull_rev = True
            elif a.bullish and b.bearish: pats.add("BEARISH_HARAMI"); bear_rev = True
        if _inside(a, b): pats.add("INSIDE_BAR")
        if _outside(a, b): pats.add("OUTSIDE_BAR")
        if a.bearish and b.bullish and b.open <= a.close + tol and b.close >= _mid(a) and b.close < a.open:
            pats.add("PIERCING_LINE"); bull_rev = True
        if a.bullish and b.bearish and b.open >= a.close - tol and b.close <= _mid(a) and b.close > a.open:
            pats.add("DARK_CLOUD_COVER"); bear_rev = True
        if _near(a.low, b.low, tol) and a.bearish and b.bullish:
            pats.add("TWEEZER_BOTTOM"); bull_rev = True
        if _near(a.high, b.high, tol) and a.bullish and b.bearish:
            pats.add("TWEEZER_TOP"); bear_rev = True
        if a.bearish and b.bullish and _gap_up(a, b):
            pats.add("BULLISH_KICKER"); bull_mom = True
        if a.bullish and b.bearish and _gap_down(a, b):
            pats.add("BEARISH_KICKER"); bear_mom = True

    # Three-candle reversal/control families.
    if len(gs) >= 3:
        a, b, c = gs[-3:]
        small_mid = b.body_frac <= 0.35
        if a.bearish and a.body_frac >= 0.50 and small_mid and c.bullish and c.close >= _mid(a):
            pats.add("MORNING_STAR"); bull_rev = True
            if _doji(b): pats.add("MORNING_DOJI_STAR")
        if a.bullish and a.body_frac >= 0.50 and small_mid and c.bearish and c.close <= _mid(a):
            pats.add("EVENING_STAR"); bear_rev = True
            if _doji(b): pats.add("EVENING_DOJI_STAR")
        if _trend3(gs, True):
            pats.add("THREE_WHITE_SOLDIERS"); bull_mom = True
        if _trend3(gs, False):
            pats.add("THREE_BLACK_CROWS"); bear_mom = True
        if a.bearish and _body_inside(a, b) and c.bullish and c.close > a.open:
            pats.add("THREE_INSIDE_UP"); bull_rev = True
        if a.bullish and _body_inside(a, b) and c.bearish and c.close < a.open:
            pats.add("THREE_INSIDE_DOWN"); bear_rev = True
        if a.bearish and b.bullish and _engulfs(a, b) and c.bullish and c.close > b.close:
            pats.add("THREE_OUTSIDE_UP"); bull_rev = True
        if a.bullish and b.bearish and _engulfs(a, b) and c.bearish and c.close < b.close:
            pats.add("THREE_OUTSIDE_DOWN"); bear_rev = True
        if a.bearish and _doji(b) and c.bullish and _gap_down(a, b) and _gap_up(b, c):
            pats.add("BULLISH_ABANDONED_BABY"); bull_rev = True
        if a.bullish and _doji(b) and c.bearish and _gap_up(a, b) and _gap_down(b, c):
            pats.add("BEARISH_ABANDONED_BABY"); bear_rev = True

    # Five-candle continuation families. These are uncommon in intraday futures,
    # but the recognizer knows them rather than silently treating them as unknown.
    if len(gs) >= 5:
        a, b, c, d, e = gs[-5:]
        inner = (b, c, d)
        if a.bullish and e.bullish and a.body_frac >= 0.55 and e.body_frac >= 0.55:
            if all(x.high <= a.high + EPS and x.low >= a.low - EPS for x in inner) and e.close > a.close:
                pats.add("RISING_THREE_METHODS"); bull_mom = True
        if a.bearish and e.bearish and a.body_frac >= 0.55 and e.body_frac >= 0.55:
            if all(x.high <= a.high + EPS and x.low >= a.low - EPS for x in inner) and e.close < a.close:
                pats.add("FALLING_THREE_METHODS"); bear_mom = True

    ranges = np.array([x.range for x in gs], dtype=float)
    compression = len(ranges) >= 3 and ranges[-2] < ranges[-3] and ranges[-1] <= ranges[-2] * 1.10
    expansion = len(ranges) >= 2 and ranges[-1] >= ranges[-2] * 1.25
    if compression: pats.add("COMPRESSION")
    if expansion:
        pats.add("EXPANSION")
        if g.bullish: bull_mom = True
        elif g.bearish: bear_mom = True

    return CandleEvidence(
        tuple(sorted(pats)), bull_rev, bear_rev, bull_mom, bear_mom,
        indecision, compression, expansion,
    )


def zone_interaction(last_row, zone_lo: float, zone_hi: float, pad: float = 0.0) -> Interaction:
    g = geometry(last_row)
    lo, hi = float(zone_lo) - pad, float(zone_hi) + pad
    if g.high < lo or g.low > hi:
        return Interaction.NONE
    if g.low < lo and g.close >= lo:
        return Interaction.SWEEP_RECLAIM_UP
    if g.high > hi and g.close <= hi:
        return Interaction.SWEEP_RECLAIM_DOWN
    if g.close > hi:
        return Interaction.BREAK_CLOSE_UP
    if g.close < lo:
        return Interaction.BREAK_CLOSE_DOWN
    return Interaction.TOUCH


def evaluate_at_zone(bars: pd.DataFrame, zone_side: str, zone_lo: float, zone_hi: float,
                     pad: float = 0.0) -> ZoneCandleDecision:
    """Interpret candlesticks ONLY after the last completed bar reaches the zone.

    zone_side: 'S' support or 'R' resistance before the current interaction.
    """
    if bars is None or len(bars) == 0:
        return ZoneCandleDecision(False, Interaction.NONE.value, (), False, False, False,
                                  False, False, False, False, "NO_BARS")
    interaction = zone_interaction(bars.iloc[-1], zone_lo, zone_hi, pad)
    ev = classify_patterns(bars)
    if interaction == Interaction.NONE:
        return ZoneCandleDecision(False, interaction.value, ev.patterns, False, False,
                                  ev.indecision, False, False, False, False,
                                  "NO_ZONE_INTERACTION_PATTERN_HAS_ZERO_AUTHORITY")

    last = geometry(bars.iloc[-1])
    bull_control = ev.bullish_reversal or ev.bullish_momentum
    bear_control = ev.bearish_reversal or ev.bearish_momentum

    # Failed push/reclaim is itself meaningful candle-story evidence even when it
    # does not have a famous textbook name.
    if interaction == Interaction.SWEEP_RECLAIM_UP:
        bull_control = True
    if interaction == Interaction.SWEEP_RECLAIM_DOWN:
        bear_control = True

    rev_long = zone_side == "S" and interaction in {
        Interaction.TOUCH, Interaction.SWEEP_RECLAIM_UP,
    } and bull_control and not bear_control
    rev_short = zone_side == "R" and interaction in {
        Interaction.TOUCH, Interaction.SWEEP_RECLAIM_DOWN,
    } and bear_control and not bull_control
    brk_long = zone_side == "R" and interaction == Interaction.BREAK_CLOSE_UP and (
        ev.bullish_momentum or (last.bullish and last.body_frac >= 0.55 and last.close_loc >= 0.70)
    )
    brk_short = zone_side == "S" and interaction == Interaction.BREAK_CLOSE_DOWN and (
        ev.bearish_momentum or (last.bearish and last.body_frac >= 0.55 and last.close_loc <= 0.30)
    )

    if ev.indecision and not (bull_control ^ bear_control):
        reason = "ZONE_REACHED_BUT_CONTROL_MIXED_WAIT"
    elif rev_long: reason = "SUPPORT_REJECTION_BUYER_CONTROL"
    elif rev_short: reason = "RESISTANCE_REJECTION_SELLER_CONTROL"
    elif brk_long: reason = "RESISTANCE_BREAK_BULLISH_ACCEPTANCE"
    elif brk_short: reason = "SUPPORT_BREAK_BEARISH_ACCEPTANCE"
    else: reason = "ZONE_REACHED_NO_CONFIRMED_DIRECTIONAL_CONTROL"

    return ZoneCandleDecision(
        True, interaction.value, ev.patterns, bull_control, bear_control, ev.indecision,
        rev_long, rev_short, brk_long, brk_short, reason,
    )
