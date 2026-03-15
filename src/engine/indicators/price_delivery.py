"""ICT Price Delivery indicators — FVG, IFVG, Volume Imbalance, Liquidity Void.

Fair Value Gaps are the core price delivery concept in ICT methodology.
They represent inefficient price delivery where price moved too fast.
"""

from __future__ import annotations

import polars as pl


def detect_fvg(df: pl.DataFrame) -> pl.DataFrame:
    """Detect Fair Value Gaps (3-candle pattern).

    Bullish FVG: candle[i-2] high < candle[i] low (gap between candle 1 high and candle 3 low)
    Bearish FVG: candle[i-2] low > candle[i] high (gap between candle 1 low and candle 3 high)

    Returns:
        DataFrame with columns: index, type ("bullish"/"bearish"), top, bottom, midpoint, filled
    """
    records = []
    highs = df["high"].to_list()
    lows = df["low"].to_list()

    for i in range(2, len(df)):
        # Bullish FVG: gap up — candle[i-2] high < candle[i] low
        if highs[i - 2] < lows[i]:
            records.append({
                "index": i - 1,  # middle candle
                "type": "bullish",
                "top": lows[i],
                "bottom": highs[i - 2],
                "midpoint": (lows[i] + highs[i - 2]) / 2.0,
                "filled": False,
            })
        # Bearish FVG: gap down — candle[i-2] low > candle[i] high
        elif lows[i - 2] > highs[i]:
            records.append({
                "index": i - 1,
                "type": "bearish",
                "top": lows[i - 2],
                "bottom": highs[i],
                "midpoint": (lows[i - 2] + highs[i]) / 2.0,
                "filled": False,
            })

    if not records:
        return pl.DataFrame(schema={
            "index": pl.Int64, "type": pl.Utf8, "top": pl.Float64,
            "bottom": pl.Float64, "midpoint": pl.Float64, "filled": pl.Boolean,
        })

    return pl.DataFrame(records)


def detect_ifvg(df: pl.DataFrame, fvgs: pl.DataFrame) -> pl.DataFrame:
    """Detect Inverse Fair Value Gaps — FVGs that have been filled and may act as support/resistance.

    An IFVG is a previously-filled FVG that price revisits.
    A bullish FVG is filled when price trades through it (close below bottom).
    A bearish FVG is filled when price trades through it (close above top).

    Returns:
        DataFrame with same schema as FVGs, but only filled ones.
    """
    if len(fvgs) == 0:
        return fvgs.clone()

    filled_records = []
    closes = df["close"].to_list()

    for row_idx in range(len(fvgs)):
        fvg_index = int(fvgs["index"][row_idx])
        fvg_type = str(fvgs["type"][row_idx])
        top = float(fvgs["top"][row_idx])
        bottom = float(fvgs["bottom"][row_idx])
        midpoint = float(fvgs["midpoint"][row_idx])

        filled = False
        for i in range(fvg_index + 1, len(df)):
            close = closes[i]
            if fvg_type == "bullish" and close < bottom:
                filled = True
                break
            elif fvg_type == "bearish" and close > top:
                filled = True
                break

        if filled:
            filled_records.append({
                "index": fvg_index,
                "type": fvg_type,
                "top": top,
                "bottom": bottom,
                "midpoint": midpoint,
                "filled": True,
            })

    if not filled_records:
        return pl.DataFrame(schema={
            "index": pl.Int64, "type": pl.Utf8, "top": pl.Float64,
            "bottom": pl.Float64, "midpoint": pl.Float64, "filled": pl.Boolean,
        })

    return pl.DataFrame(filled_records)


def compute_consequent_encroachment(fvgs: pl.DataFrame) -> pl.Series:
    """Consequent Encroachment — the 50% level of each FVG.

    CE is the midpoint of the FVG. Price often reacts at this level.

    Returns:
        Series of floats: CE price level for each FVG.
    """
    if len(fvgs) == 0:
        return pl.Series("ce", [], dtype=pl.Float64)

    return fvgs["midpoint"].alias("ce")


def detect_volume_imbalance(df: pl.DataFrame) -> pl.DataFrame:
    """Detect Volume Imbalances — gaps between consecutive candle bodies.

    Bullish: current open > previous close (gap up in bodies)
    Bearish: current open < previous close (gap down in bodies)

    Returns:
        DataFrame with columns: index, type, top, bottom
    """
    records = []
    opens = df["open"].to_list()
    closes = df["close"].to_list()

    for i in range(1, len(df)):
        prev_close = closes[i - 1]
        curr_open = opens[i]

        if curr_open > prev_close:
            records.append({
                "index": i,
                "type": "bullish",
                "top": curr_open,
                "bottom": prev_close,
            })
        elif curr_open < prev_close:
            records.append({
                "index": i,
                "type": "bearish",
                "top": prev_close,
                "bottom": curr_open,
            })

    if not records:
        return pl.DataFrame(schema={
            "index": pl.Int64, "type": pl.Utf8,
            "top": pl.Float64, "bottom": pl.Float64,
        })

    return pl.DataFrame(records)


def detect_opening_gap(df: pl.DataFrame) -> pl.Series:
    """Detect opening gaps — difference between current open and previous close.

    Positive = gap up, Negative = gap down, ~0 = no gap.

    Returns:
        Series of float: gap size at each bar (0.0 for first bar).
    """
    opens = df["open"]
    prev_close = df["close"].shift(1)
    gap = opens - prev_close
    return gap.fill_null(0.0).alias("opening_gap")


def detect_liquidity_void(df: pl.DataFrame, threshold: float = 2.0) -> pl.DataFrame:
    """Detect Liquidity Voids — large single-candle moves with minimal overlap.

    A void is when a candle's range is > threshold * ATR, indicating
    price moved through a zone with no liquidity.

    Returns:
        DataFrame with columns: index, type ("bullish"/"bearish"), top, bottom, size
    """
    from src.engine.indicators.core import compute_atr

    atr = compute_atr(df, 14)
    records = []

    highs = df["high"].to_list()
    lows = df["low"].to_list()
    closes = df["close"].to_list()
    opens = df["open"].to_list()
    atr_vals = atr.to_list()

    for i in range(1, len(df)):
        candle_range = highs[i] - lows[i]
        atr_val = atr_vals[i]

        if atr_val is None or atr_val != atr_val:  # NaN check
            continue

        if candle_range > threshold * atr_val:
            direction = "bullish" if closes[i] > opens[i] else "bearish"
            records.append({
                "index": i,
                "type": direction,
                "top": highs[i],
                "bottom": lows[i],
                "size": candle_range,
            })

    if not records:
        return pl.DataFrame(schema={
            "index": pl.Int64, "type": pl.Utf8,
            "top": pl.Float64, "bottom": pl.Float64, "size": pl.Float64,
        })

    return pl.DataFrame(records)
