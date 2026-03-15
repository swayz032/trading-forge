"""ICT Fibonacci indicators -- retracements, OTE zone, extensions, auto-swing fib.

The Optimal Trade Entry (OTE) zone (0.618-0.786 retracement) is a core
ICT concept for identifying high-probability entry points.
"""

from __future__ import annotations

import polars as pl


# Standard Fibonacci levels
FIB_LEVELS = {
    "0.0": 0.0,
    "0.236": 0.236,
    "0.382": 0.382,
    "0.5": 0.5,
    "0.618": 0.618,
    "0.705": 0.705,
    "0.786": 0.786,
    "1.0": 1.0,
}

# Extension levels
EXT_LEVELS = {
    "-0.272": -0.272,
    "-0.618": -0.618,
    "-1.0": -1.0,
    "-1.618": -1.618,
    "-2.618": -2.618,
}


def fib_retracement(high: float, low: float) -> dict[str, float]:
    """Calculate Fibonacci retracement levels between a high and low.

    Levels are calculated from the high down:
    - 0.0 = high (no retracement)
    - 1.0 = low (full retracement)

    Args:
        high: Swing high price
        low: Swing low price

    Returns:
        Dict mapping level names to price values.
    """
    rng = high - low
    return {name: high - (ratio * rng) for name, ratio in FIB_LEVELS.items()}


def ote_zone(high: float, low: float) -> tuple[float, float]:
    """Calculate the Optimal Trade Entry zone (0.618-0.786 retracement).

    This is the "sweet spot" for ICT entries -- deep enough retracement
    to offer good risk/reward, but not so deep that structure is broken.

    Args:
        high: Swing high price
        low: Swing low price

    Returns:
        Tuple of (upper_bound, lower_bound) price levels.
        For a bullish OTE (retracement down from high):
        - upper = 0.618 level (closer to high)
        - lower = 0.786 level (closer to low)
    """
    rng = high - low
    upper = high - (0.618 * rng)
    lower = high - (0.786 * rng)
    return (upper, lower)


def fib_extensions(high: float, low: float, swing: float) -> dict[str, float]:
    """Calculate Fibonacci extension levels from a swing point.

    Extensions project beyond the original range for profit targets.
    Measured from the retracement swing point.

    Args:
        high: Original swing high
        low: Original swing low
        swing: Retracement swing point (where price bounced)

    Returns:
        Dict mapping extension level names to price values.
    """
    rng = high - low
    # For bullish extension (from low swing, projecting up)
    return {name: swing - (ratio * rng) for name, ratio in EXT_LEVELS.items()}


def auto_swing_fib(df: pl.DataFrame, swings: pl.DataFrame) -> pl.DataFrame:
    """Automatically calculate Fibonacci levels from detected swing pairs.

    Takes the most recent swing high-low pair and calculates retracement
    levels, OTE zone, and extension targets.

    Args:
        df: OHLCV DataFrame
        swings: Output from detect_swings()

    Returns:
        DataFrame with columns: level_name, price, type ("retracement"/"extension"/"ote")
    """
    swing_highs = swings.filter(pl.col("type") == "high").sort("index")
    swing_lows = swings.filter(pl.col("type") == "low").sort("index")

    if len(swing_highs) == 0 or len(swing_lows) == 0:
        return pl.DataFrame(schema={
            "level_name": pl.Utf8, "price": pl.Float64, "type": pl.Utf8,
        })

    # Use the most recent swing pair
    last_sh = float(swing_highs["price"][-1])
    last_sl = float(swing_lows["price"][-1])

    # Determine direction: if last swing high is after last swing low -> bullish context
    sh_idx = int(swing_highs["index"][-1])
    sl_idx = int(swing_lows["index"][-1])

    high = max(last_sh, last_sl)
    low = min(last_sh, last_sl)

    records = []

    # Retracement levels
    retracements = fib_retracement(high, low)
    for name, price in retracements.items():
        records.append({"level_name": f"fib_{name}", "price": price, "type": "retracement"})

    # OTE zone
    ote_upper, ote_lower = ote_zone(high, low)
    records.append({"level_name": "ote_upper", "price": ote_upper, "type": "ote"})
    records.append({"level_name": "ote_lower", "price": ote_lower, "type": "ote"})

    # Extension levels (from the low, projecting up)
    extensions = fib_extensions(high, low, low)
    for name, price in extensions.items():
        records.append({"level_name": f"ext_{name}", "price": price, "type": "extension"})

    return pl.DataFrame(records)
