"""
Day Archetype Classifier -- rule-based classification of trading days into 8 types.

The 8 Day Archetypes:
1. TREND_DAY_UP    -- Strong directional move up (>1.5 ATR range, close near high)
2. TREND_DAY_DOWN  -- Strong directional move down (>1.5 ATR range, close near low)
3. RANGE_DAY       -- Tight range (<0.7 ATR), mean-reverting, chop
4. REVERSAL_DAY    -- Opens trending, reverses (close opposite of early move)
5. EXPANSION_DAY   -- Volatility breakout from compression (range > 2x previous day)
6. GRIND_DAY       -- Slow directional move, small bars, low urgency
7. GAP_AND_GO      -- Gaps > 0.5 ATR and continues in gap direction
8. INSIDE_DAY      -- High/low contained within previous day's range
"""

from __future__ import annotations

from typing import Any

ARCHETYPES = [
    "TREND_DAY_UP",
    "TREND_DAY_DOWN",
    "RANGE_DAY",
    "REVERSAL_DAY",
    "EXPANSION_DAY",
    "GRIND_DAY",
    "GAP_AND_GO",
    "INSIDE_DAY",
]


def _close_position(open_: float, high: float, low: float, close: float) -> float:
    """Where close sits in the day's range.  0 = at low, 1 = at high."""
    rng = high - low
    if rng == 0:
        return 0.5
    return (close - low) / rng


def _day_range(high: float, low: float) -> float:
    return high - low


def classify_day(
    day_data: dict[str, Any],
    prev_day_data: dict[str, Any] | None = None,
    atr: float | None = None,
) -> dict[str, Any]:
    """
    Classify a single trading day into one of 8 archetypes.

    Args:
        day_data: {open, high, low, close, volume, vwap (optional)}
        prev_day_data: Previous day's OHLCV (for inside day, gap detection)
        atr: Current ATR value (14-period default)

    Returns:
        {
            "archetype": str,
            "confidence": float,   # 0-1
            "metrics": {
                "range_atr_ratio": float,
                "close_position": float,   # 0=low, 1=high
                "gap_size_atr": float,
                "is_inside": bool,
                "reversal_magnitude": float,
            },
        }
    """
    o = float(day_data["open"])
    h = float(day_data["high"])
    l = float(day_data["low"])  # noqa: E741
    c = float(day_data["close"])

    day_rng = _day_range(h, l)
    close_pos = _close_position(o, h, l, c)

    # Compute helpers that depend on prev day / ATR
    prev_h = float(prev_day_data["high"]) if prev_day_data else None
    prev_l = float(prev_day_data["low"]) if prev_day_data else None
    prev_c = float(prev_day_data["close"]) if prev_day_data else None
    prev_rng = _day_range(prev_h, prev_l) if prev_day_data else None

    # Default ATR to day range if not provided
    effective_atr = atr if atr and atr > 0 else day_rng if day_rng > 0 else 1.0

    range_atr_ratio = day_rng / effective_atr if effective_atr else 0.0
    gap_size_atr = abs(o - prev_c) / effective_atr if prev_c is not None else 0.0
    is_inside = (
        (h < prev_h and l > prev_l) if prev_h is not None and prev_l is not None else False
    )

    # Reversal: how much the close diverges from the early directional bias
    # Early bias = open vs midpoint of first half, approximated by open vs high/low proximity
    early_bias_up = (h - o) > (o - l)  # opened closer to low
    if early_bias_up:
        reversal_magnitude = max(0.0, (o - c) / day_rng) if day_rng > 0 else 0.0
    else:
        reversal_magnitude = max(0.0, (c - o) / day_rng) if day_rng > 0 else 0.0

    metrics = {
        "range_atr_ratio": round(range_atr_ratio, 4),
        "close_position": round(close_pos, 4),
        "gap_size_atr": round(gap_size_atr, 4),
        "is_inside": is_inside,
        "reversal_magnitude": round(reversal_magnitude, 4),
    }

    # ── Classification rules (priority order) ────────────────────

    # 1. INSIDE_DAY
    if is_inside:
        return {"archetype": "INSIDE_DAY", "confidence": 0.90, "metrics": metrics}

    # 2. GAP_AND_GO: gap > 0.5 ATR and close extends the gap direction
    if prev_c is not None and gap_size_atr > 0.5:
        gap_up = o > prev_c
        continues = (c > o) if gap_up else (c < o)
        if continues:
            conf = min(1.0, 0.6 + gap_size_atr * 0.2)
            return {"archetype": "GAP_AND_GO", "confidence": round(conf, 2), "metrics": metrics}

    # 3. EXPANSION_DAY: range > 2x previous day range
    if prev_rng is not None and prev_rng > 0 and day_rng > 2.0 * prev_rng:
        conf = min(1.0, 0.6 + (day_rng / prev_rng - 2.0) * 0.15)
        return {"archetype": "EXPANSION_DAY", "confidence": round(conf, 2), "metrics": metrics}

    # 4. TREND_DAY_UP
    if range_atr_ratio > 1.5 and close_pos > 0.80:
        conf = min(1.0, 0.6 + (range_atr_ratio - 1.5) * 0.15 + (close_pos - 0.8) * 1.0)
        return {"archetype": "TREND_DAY_UP", "confidence": round(conf, 2), "metrics": metrics}

    # 5. TREND_DAY_DOWN
    if range_atr_ratio > 1.5 and close_pos < 0.20:
        conf = min(1.0, 0.6 + (range_atr_ratio - 1.5) * 0.15 + (0.2 - close_pos) * 1.0)
        return {"archetype": "TREND_DAY_DOWN", "confidence": round(conf, 2), "metrics": metrics}

    # 6. REVERSAL_DAY: large early move reversed
    if reversal_magnitude > 0.5 and range_atr_ratio > 0.8:
        conf = min(1.0, 0.5 + reversal_magnitude * 0.4)
        return {"archetype": "REVERSAL_DAY", "confidence": round(conf, 2), "metrics": metrics}

    # 7. GRIND_DAY: directional but moderate range
    directional = abs(c - o) / day_rng if day_rng > 0 else 0
    if directional > 0.4 and 0.7 <= range_atr_ratio <= 1.5:
        conf = min(1.0, 0.5 + directional * 0.3)
        return {"archetype": "GRIND_DAY", "confidence": round(conf, 2), "metrics": metrics}

    # 8. RANGE_DAY: default / tight range
    if range_atr_ratio < 0.7:
        conf = min(1.0, 0.6 + (0.7 - range_atr_ratio) * 0.5)
    else:
        conf = 0.4  # low-confidence fallback
    return {"archetype": "RANGE_DAY", "confidence": round(conf, 2), "metrics": metrics}


def _compute_atr(bars: list[dict], period: int = 14) -> list[float | None]:
    """Compute ATR series from OHLCV bars. Returns list same length as bars."""
    atrs: list[float | None] = [None] * len(bars)
    if len(bars) < 2:
        return atrs

    true_ranges: list[float] = []
    for i, bar in enumerate(bars):
        h = float(bar["high"])
        l = float(bar["low"])  # noqa: E741
        if i == 0:
            true_ranges.append(h - l)
        else:
            prev_c = float(bars[i - 1]["close"])
            tr = max(h - l, abs(h - prev_c), abs(l - prev_c))
            true_ranges.append(tr)

    # Simple moving average ATR for first 'period' bars, then EMA
    for i in range(len(bars)):
        if i < period - 1:
            atrs[i] = None
        elif i == period - 1:
            atrs[i] = sum(true_ranges[: period]) / period
        else:
            prev_atr = atrs[i - 1]
            if prev_atr is not None:
                atrs[i] = (prev_atr * (period - 1) + true_ranges[i]) / period
    return atrs


def classify_day_series(
    bars: list[dict],
    atr_period: int = 14,
) -> list[dict]:
    """Classify a series of bars. Computes ATR automatically."""
    atrs = _compute_atr(bars, atr_period)
    results: list[dict] = []

    for i, bar in enumerate(bars):
        prev = bars[i - 1] if i > 0 else None
        atr_val = atrs[i]
        classification = classify_day(bar, prev, atr_val)
        results.append({
            **bar,
            "archetype": classification["archetype"],
            "archetype_confidence": classification["confidence"],
            "archetype_metrics": classification["metrics"],
        })
    return results
