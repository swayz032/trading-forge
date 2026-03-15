"""ICT Market Structure indicators -- swing detection, BOS, CHoCH, MSS.

These are foundational for all ICT strategies. Swing detection
feeds into order blocks, liquidity, and fibonacci modules.
"""

from __future__ import annotations

import polars as pl


def detect_swings(df: pl.DataFrame, lookback: int = 5) -> pl.DataFrame:
    """Detect swing highs and swing lows using lookback comparison.

    A swing high is a bar whose high is the highest in a (2*lookback+1) window.
    A swing low is a bar whose low is the lowest in a (2*lookback+1) window.

    Returns:
        DataFrame with columns: index, type ("high"/"low"), price, ts_event
    """
    highs = df["high"]
    lows = df["low"]
    window = 2 * lookback + 1

    # Rolling max/min centered on middle of window
    rolling_max = highs.rolling_max(window_size=window, center=True)
    rolling_min = lows.rolling_min(window_size=window, center=True)

    swing_high_mask = highs == rolling_max
    swing_low_mask = lows == rolling_min

    records = []
    for i in range(len(df)):
        if swing_high_mask[i]:
            rec = {"index": i, "type": "high", "price": float(highs[i])}
            if "ts_event" in df.columns:
                rec["ts_event"] = df["ts_event"][i]
            records.append(rec)
        if swing_low_mask[i]:
            rec = {"index": i, "type": "low", "price": float(lows[i])}
            if "ts_event" in df.columns:
                rec["ts_event"] = df["ts_event"][i]
            records.append(rec)

    if not records:
        schema = {"index": pl.Int64, "type": pl.Utf8, "price": pl.Float64}
        if "ts_event" in df.columns:
            schema["ts_event"] = df["ts_event"].dtype
        return pl.DataFrame(schema=schema)

    return pl.DataFrame(records).sort("index")


def detect_bos(df: pl.DataFrame, swings: pl.DataFrame) -> pl.Series:
    """Break of Structure -- price breaks beyond a prior swing point.

    Bullish BOS: close breaks above a prior swing high.
    Bearish BOS: close breaks below a prior swing low.

    Returns:
        Series of str: "bullish", "bearish", or null for each bar.
    """
    result = [None] * len(df)

    swing_highs = swings.filter(pl.col("type") == "high")
    swing_lows = swings.filter(pl.col("type") == "low")

    last_swing_high = None
    last_swing_low = None
    sh_idx = 0
    sl_idx = 0

    for i in range(len(df)):
        # Update last known swing points
        while sh_idx < len(swing_highs) and swing_highs["index"][sh_idx] < i:
            last_swing_high = float(swing_highs["price"][sh_idx])
            sh_idx += 1
        while sl_idx < len(swing_lows) and swing_lows["index"][sl_idx] < i:
            last_swing_low = float(swing_lows["price"][sl_idx])
            sl_idx += 1

        close = float(df["close"][i])
        if last_swing_high is not None and close > last_swing_high:
            result[i] = "bullish"
            last_swing_high = None  # consumed
        elif last_swing_low is not None and close < last_swing_low:
            result[i] = "bearish"
            last_swing_low = None  # consumed

    return pl.Series("bos", result, dtype=pl.Utf8)


def detect_choch(df: pl.DataFrame, swings: pl.DataFrame) -> pl.Series:
    """Change of Character -- trend reversal signal.

    Bullish CHoCH: in a downtrend (lower highs), price breaks above a prior swing high.
    Bearish CHoCH: in an uptrend (higher lows), price breaks below a prior swing low.

    Returns:
        Series of str: "bullish", "bearish", or null.
    """
    result = [None] * len(df)

    swing_highs = swings.filter(pl.col("type") == "high").sort("index")
    swing_lows = swings.filter(pl.col("type") == "low").sort("index")

    # Track trend via swing sequence
    trend = None  # "up" or "down"

    sh_prices = swing_highs["price"].to_list() if len(swing_highs) > 0 else []
    sh_indices = swing_highs["index"].to_list() if len(swing_highs) > 0 else []
    sl_prices = swing_lows["price"].to_list() if len(swing_lows) > 0 else []
    sl_indices = swing_lows["index"].to_list() if len(swing_lows) > 0 else []

    sh_ptr = 0
    sl_ptr = 0
    last_sh_price = None
    last_sl_price = None

    for i in range(len(df)):
        # Update swing points up to current bar
        while sh_ptr < len(sh_indices) and sh_indices[sh_ptr] < i:
            new_sh = sh_prices[sh_ptr]
            if last_sh_price is not None:
                if new_sh > last_sh_price:
                    trend = "up"
                elif new_sh < last_sh_price:
                    trend = "down"
            last_sh_price = new_sh
            sh_ptr += 1

        while sl_ptr < len(sl_indices) and sl_indices[sl_ptr] < i:
            new_sl = sl_prices[sl_ptr]
            if last_sl_price is not None:
                if new_sl > last_sl_price:
                    trend = "up"
                elif new_sl < last_sl_price:
                    trend = "down"
            last_sl_price = new_sl
            sl_ptr += 1

        close = float(df["close"][i])

        # CHoCH = break against current trend
        if trend == "down" and last_sh_price is not None and close > last_sh_price:
            result[i] = "bullish"
            trend = "up"
        elif trend == "up" and last_sl_price is not None and close < last_sl_price:
            result[i] = "bearish"
            trend = "down"

    return pl.Series("choch", result, dtype=pl.Utf8)


def detect_mss(
    df: pl.DataFrame,
    swings: pl.DataFrame,
    displacement_atr_mult: float = 1.5,
) -> pl.Series:
    """Market Structure Shift -- CHoCH confirmed by displacement (strong move).

    MSS = CHoCH + the breaking candle has range > displacement_atr_mult * ATR.

    Returns:
        Series of str: "bullish", "bearish", or null.
    """
    from src.engine.indicators.core import compute_atr

    choch = detect_choch(df, swings)
    atr = compute_atr(df, 14)

    result = [None] * len(df)
    for i in range(len(df)):
        if choch[i] is not None:
            candle_range = abs(float(df["close"][i]) - float(df["open"][i]))
            atr_val = atr[i]
            if atr_val is not None and not (atr_val != atr_val):  # not NaN
                if candle_range > displacement_atr_mult * float(atr_val):
                    result[i] = choch[i]

    return pl.Series("mss", result, dtype=pl.Utf8)


def compute_premium_discount(
    df: pl.DataFrame, swings: pl.DataFrame
) -> pl.Series:
    """Premium/Discount zones relative to the most recent swing range.

    Premium = above 50% of range (swing low to swing high)
    Discount = below 50% of range
    Equilibrium = near 50%

    Returns:
        Series of str: "premium", "discount", or "equilibrium".
    """
    result = ["equilibrium"] * len(df)

    # Find most recent swing high and swing low pairs
    swing_highs = swings.filter(pl.col("type") == "high").sort("index")
    swing_lows = swings.filter(pl.col("type") == "low").sort("index")

    if len(swing_highs) == 0 or len(swing_lows) == 0:
        return pl.Series("premium_discount", result, dtype=pl.Utf8)

    sh_prices = swing_highs["price"].to_list()
    sh_indices = swing_highs["index"].to_list()
    sl_prices = swing_lows["price"].to_list()
    sl_indices = swing_lows["index"].to_list()

    last_sh = None
    last_sl = None
    sh_ptr = 0
    sl_ptr = 0

    for i in range(len(df)):
        while sh_ptr < len(sh_indices) and sh_indices[sh_ptr] <= i:
            last_sh = sh_prices[sh_ptr]
            sh_ptr += 1
        while sl_ptr < len(sl_indices) and sl_indices[sl_ptr] <= i:
            last_sl = sl_prices[sl_ptr]
            sl_ptr += 1

        if last_sh is not None and last_sl is not None and last_sh != last_sl:
            mid = (last_sh + last_sl) / 2.0
            close = float(df["close"][i])
            rng = abs(last_sh - last_sl)
            threshold = rng * 0.1  # 10% band around equilibrium

            if close > mid + threshold:
                result[i] = "premium"
            elif close < mid - threshold:
                result[i] = "discount"
            else:
                result[i] = "equilibrium"

    return pl.Series("premium_discount", result, dtype=pl.Utf8)


def compute_equilibrium(
    df: pl.DataFrame, swings: pl.DataFrame
) -> pl.Series:
    """Equilibrium level -- 50% of the most recent swing range.

    Returns:
        Series of float: the equilibrium price level at each bar.
    """
    result = [None] * len(df)

    swing_highs = swings.filter(pl.col("type") == "high").sort("index")
    swing_lows = swings.filter(pl.col("type") == "low").sort("index")

    if len(swing_highs) == 0 or len(swing_lows) == 0:
        return pl.Series("equilibrium", result, dtype=pl.Float64)

    sh_prices = swing_highs["price"].to_list()
    sh_indices = swing_highs["index"].to_list()
    sl_prices = swing_lows["price"].to_list()
    sl_indices = swing_lows["index"].to_list()

    last_sh = None
    last_sl = None
    sh_ptr = 0
    sl_ptr = 0

    for i in range(len(df)):
        while sh_ptr < len(sh_indices) and sh_indices[sh_ptr] <= i:
            last_sh = sh_prices[sh_ptr]
            sh_ptr += 1
        while sl_ptr < len(sl_indices) and sl_indices[sl_ptr] <= i:
            last_sl = sl_prices[sl_ptr]
            sl_ptr += 1

        if last_sh is not None and last_sl is not None:
            result[i] = (last_sh + last_sl) / 2.0

    return pl.Series("equilibrium", result, dtype=pl.Float64)
