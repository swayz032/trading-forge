"""Candle pattern detectors — the highest-leverage `needs_new` evaluator family (groundability audit 2026-06-30).

The n=8 groundability audit (docs/designs/groundability-audit-n8-2026-06-30.md) found ~14 compiler-emitted
conditions across 4 transcripts blocked on ONE missing evaluator family: candle patterns (engulfing / rejection /
strong-close) plus the MKsj educator-idiolect "weakness" (= sweep-and-reject: a high is taken out and price
closes back below it with bearish rejection). This module grounds them.

Design rules (house style — smt_divergence.py):
    - Pure functions: no I/O, no time.now(), no global state; deterministic.
    - STDLIB-ONLY on purpose: per-bar functions over floats + sequence helpers over plain sequences —
      importable under pytest collection on the tower (no vectorbt / polars / numpy pull), callable from the
      backtester per-bar management loop and from any polars pipeline via .to_list()/row access.
    - Zero-range bars (h == l) never match any pattern (no division; explicit guard).
    - Thresholds are NAMED constants (operator-tunable via kwargs, defaults = textbook definitions).

Grounded conditions (condition-grounding.ts registry cites this module):
    engulfing / pin bar / wick rejection / strong candle / confirmation candle → is_*_engulfing, is_rejection_*,
    is_strong_close;  "weakness" / "valid high taken with weakness closing lower" → detect_weakness (+ mirror
    detect_strength for longs — MKsj trades both directions).
"""
from __future__ import annotations

from typing import Optional, Sequence

# Textbook defaults: pin-bar wick ≥ 2× body AND ≥ half the bar's range; strong close = body ≥ 70% of range.
WICK_BODY_RATIO: float = 2.0
WICK_RANGE_FRAC: float = 0.5
STRONG_BODY_FRAC: float = 0.7
WEAKNESS_LOOKBACK: int = 20


def _body(o: float, c: float) -> float:
    return abs(c - o)


def _range(h: float, l: float) -> float:
    return h - l


# ─── Engulfing ────────────────────────────────────────────────────────────────

def is_bullish_engulfing(prev_o: float, prev_c: float, o: float, c: float) -> bool:
    """Prior bar bearish, this bar bullish, and this body fully engulfs the prior body."""
    return prev_c < prev_o and c > o and o <= prev_c and c >= prev_o and _body(o, c) > _body(prev_o, prev_c)


def is_bearish_engulfing(prev_o: float, prev_c: float, o: float, c: float) -> bool:
    """Prior bar bullish, this bar bearish, and this body fully engulfs the prior body."""
    return prev_c > prev_o and c < o and o >= prev_c and c <= prev_o and _body(o, c) > _body(prev_o, prev_c)


# ─── Rejection (pin bar / hammer / shooting star) ─────────────────────────────

def is_rejection_upper(
    o: float, h: float, l: float, c: float,
    wick_body_ratio: float = WICK_BODY_RATIO, wick_range_frac: float = WICK_RANGE_FRAC,
) -> bool:
    """Upper-wick rejection (shooting-star/pin): sellers rejected the highs.

    upper_wick ≥ ratio × body AND upper_wick ≥ frac × range. Zero-range bars never match.
    """
    rng = _range(h, l)
    if rng <= 0:
        return False
    upper_wick = h - max(o, c)
    body = _body(o, c)
    return upper_wick >= wick_body_ratio * body and upper_wick >= wick_range_frac * rng


def is_rejection_lower(
    o: float, h: float, l: float, c: float,
    wick_body_ratio: float = WICK_BODY_RATIO, wick_range_frac: float = WICK_RANGE_FRAC,
) -> bool:
    """Lower-wick rejection (hammer): buyers rejected the lows. Mirror of is_rejection_upper."""
    rng = _range(h, l)
    if rng <= 0:
        return False
    lower_wick = min(o, c) - l
    body = _body(o, c)
    return lower_wick >= wick_body_ratio * body and lower_wick >= wick_range_frac * rng


# ─── Strong close ("strong candle" / "confirmation candle" / displacement-lite) ──

def is_strong_close(o: float, h: float, l: float, c: float, body_range_frac: float = STRONG_BODY_FRAC) -> bool:
    """Body dominates the bar (≥ frac of range) — a conviction candle in either direction."""
    rng = _range(h, l)
    return rng > 0 and _body(o, c) >= body_range_frac * rng


# ─── Weakness / strength (MKsj educator idiolect — sweep-and-reject, explicitly defined) ──

def detect_weakness(
    opens: Sequence[float], highs: Sequence[float], lows: Sequence[float], closes: Sequence[float],
    i: int, lookback: int = WEAKNESS_LOOKBACK, reference_high: Optional[float] = None,
) -> bool:
    """"Valid high taken with weakness closing lower" — the SHORT-side sweep-and-reject.

    True at bar i when: (1) high[i] exceeds the reference high (default: max high of the prior `lookback`
    bars); (2) close[i] is back BELOW that reference (the take was rejected); (3) the bar itself shows
    bearish character (bearish body OR upper-wick rejection). Pure; no look-ahead (reference uses bars < i).
    """
    if i <= 0 or i >= len(highs):
        return False
    ref = reference_high if reference_high is not None else max(highs[max(0, i - lookback):i], default=None)
    if ref is None:
        return False
    took_out = highs[i] > ref
    closed_back = closes[i] < ref
    bearish_char = closes[i] < opens[i] or is_rejection_upper(opens[i], highs[i], lows[i], closes[i])
    return took_out and closed_back and bearish_char


def detect_strength(
    opens: Sequence[float], highs: Sequence[float], lows: Sequence[float], closes: Sequence[float],
    i: int, lookback: int = WEAKNESS_LOOKBACK, reference_low: Optional[float] = None,
) -> bool:
    """LONG-side mirror: a low is taken out and price closes back ABOVE it with bullish character."""
    if i <= 0 or i >= len(lows):
        return False
    ref = reference_low if reference_low is not None else min(lows[max(0, i - lookback):i], default=None)
    if ref is None:
        return False
    took_out = lows[i] < ref
    closed_back = closes[i] > ref
    bullish_char = closes[i] > opens[i] or is_rejection_lower(opens[i], highs[i], lows[i], closes[i])
    return took_out and closed_back and bullish_char
