"""ICT Market Structure indicators -- swing detection, BOS, CHoCH, MSS.

These are foundational for all ICT strategies. Swing detection
feeds into order blocks, liquidity, and fibonacci modules.

Wave 25 W25.2 additions (2026-05-24):
    detect_choch_with_context() -- CHoCH with prior_bos_direction param
    detect_mss_with_context()   -- MSS = CHoCH + displacement candle
    premium_discount_zone()     -- pure scalar PD-array math helper
"""

from __future__ import annotations

import polars as pl

# ─── Named constants (no magic numbers inline) ────────────────────────────────
ATR_PERIOD_DEFAULT: int = 14
SWING_LOOKBACK_DEFAULT: int = 5
MSS_DISPLACEMENT_THRESHOLD: float = 1.5  # ATR multiples required for MSS confirmation


def detect_swings(df: pl.DataFrame, lookback: int = 5) -> pl.DataFrame:
    """Detect swing highs and swing lows using lookback comparison.

    A swing high is a bar whose high is the highest in a (2*lookback+1) window.
    A swing low is a bar whose low is the lowest in a (2*lookback+1) window.

    Vectorized — no Python row loops.

    Returns:
        DataFrame with columns: index, type ("high"/"low"), price, ts_event
    """
    highs = df["high"]
    lows = df["low"]
    window = 2 * lookback + 1
    half_window = lookback  # confirmation delay: swing not visible until this many bars later

    # Rolling max/min centered on middle of window to find true local extrema
    rolling_max = highs.rolling_max(window_size=window, center=True)
    rolling_min = lows.rolling_min(window_size=window, center=True)

    swing_high_mask = highs == rolling_max
    swing_low_mask = lows == rolling_min

    # Vectorized extraction using Polars filter — no Python loop
    # Add half_window to each swing index so the swing is only "visible"
    # after the confirmation window completes (eliminates lookahead bias).
    idx_col = pl.Series("index", range(len(df)), dtype=pl.Int64)

    swing_highs = (
        df.with_columns(idx_col)
        .filter(swing_high_mask)
        .select([
            (pl.col("index") + half_window).alias("index"),
            pl.lit("high").alias("type"),
            pl.col("high").alias("price"),
            *([pl.col("ts_event")] if "ts_event" in df.columns else []),
        ])
        .filter(pl.col("index") < len(df))
    )

    swing_lows = (
        df.with_columns(idx_col)
        .filter(swing_low_mask)
        .select([
            (pl.col("index") + half_window).alias("index"),
            pl.lit("low").alias("type"),
            pl.col("low").alias("price"),
            *([pl.col("ts_event")] if "ts_event" in df.columns else []),
        ])
        .filter(pl.col("index") < len(df))
    )

    parts = [swing_highs, swing_lows]
    parts = [p for p in parts if len(p) > 0]

    if not parts:
        schema = {"index": pl.Int64, "type": pl.Utf8, "price": pl.Float64}
        if "ts_event" in df.columns:
            schema["ts_event"] = df["ts_event"].dtype
        return pl.DataFrame(schema=schema)

    return pl.concat(parts).sort("index")


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
        # Use strict < to match detect_bos/detect_choch swing pointer advancement
        while sh_ptr < len(sh_indices) and sh_indices[sh_ptr] < i:
            last_sh = sh_prices[sh_ptr]
            sh_ptr += 1
        while sl_ptr < len(sl_indices) and sl_indices[sl_ptr] < i:
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
        # Use strict < to match detect_bos/detect_choch swing pointer advancement
        while sh_ptr < len(sh_indices) and sh_indices[sh_ptr] < i:
            last_sh = sh_prices[sh_ptr]
            sh_ptr += 1
        while sl_ptr < len(sl_indices) and sl_indices[sl_ptr] < i:
            last_sl = sl_prices[sl_ptr]
            sl_ptr += 1

        if last_sh is not None and last_sl is not None:
            result[i] = (last_sh + last_sl) / 2.0

    return pl.Series("equilibrium", result, dtype=pl.Float64)


# ─── Wave 25 W25.2: Context-aware detectors (new spec-conformant signatures) ──
# These extend the original detect_choch/detect_mss which operate independently
# on swings with no knowledge of BOS direction. The new variants accept
# prior_bos_direction as an explicit input so the structure engine can ask:
# "given we were in a bullish BOS series, did a CHoCH just occur?"
#
# No look-ahead: all detectors use only data up to and including bar i.
# The swing lookback offset from detect_swings() already encodes the
# confirmation delay (half_window bars). These functions never read ahead.


def detect_choch_with_context(
    bars: pl.DataFrame,
    swings: pl.DataFrame,
    prior_bos_direction: str,
) -> pl.DataFrame:
    """Change of Character with explicit prior-BOS-direction context.

    Answers: given we were in a `prior_bos_direction` BOS series, did
    a counter-trend structure break occur?

    CHoCH definition:
      - If prior_bos_direction="bullish": first close BELOW the most-recent
        confirmed swing low (the swing low that established the prior upleg).
      - If prior_bos_direction="bearish": first close ABOVE the most-recent
        confirmed swing high (the swing high that established the prior downleg).

    No look-ahead: swing pointer advances strictly at index < i, so bar i
    can only reference swings confirmed before it.

    Args:
        bars:                 Execution-TF DataFrame with close, open, high, low columns.
        swings:               Output of detect_swings() — index, type, price columns.
        prior_bos_direction:  "bullish" | "bearish"

    Returns:
        DataFrame with columns:
          choch_detected   (bool)  — True on the bar where CHoCH fires
          choch_direction  (str)   — "bullish" | "bearish" | None
          choch_bar_idx    (int)   — bar index of the CHoCH, else None
          choch_magnitude  (float) — points distance of the break, else None
    """
    n = len(bars)
    choch_detected: list[bool] = [False] * n
    choch_direction: list[str | None] = [None] * n
    choch_bar_idx: list[int | None] = [None] * n
    choch_magnitude: list[float | None] = [None] * n

    if prior_bos_direction not in ("bullish", "bearish"):
        # Unknown direction — cannot define counter-trend; return all-false
        return pl.DataFrame({
            "choch_detected": pl.Series(choch_detected, dtype=pl.Boolean),
            "choch_direction": pl.Series(choch_direction, dtype=pl.Utf8),
            "choch_bar_idx": pl.Series(choch_bar_idx, dtype=pl.Int64),
            "choch_magnitude": pl.Series(choch_magnitude, dtype=pl.Float64),
        })

    swing_highs = swings.filter(pl.col("type") == "high").sort("index")
    swing_lows = swings.filter(pl.col("type") == "low").sort("index")

    sh_prices = swing_highs["price"].to_list() if len(swing_highs) > 0 else []
    sh_indices = swing_highs["index"].to_list() if len(swing_highs) > 0 else []
    sl_prices = swing_lows["price"].to_list() if len(swing_lows) > 0 else []
    sl_indices = swing_lows["index"].to_list() if len(swing_lows) > 0 else []

    sh_ptr = 0
    sl_ptr = 0
    last_sh: float | None = None
    last_sl: float | None = None
    choch_fired = False  # only fire once per call (first counter-trend break)

    for i in range(n):
        # Advance swing pointers — strict < to avoid look-ahead
        while sh_ptr < len(sh_indices) and sh_indices[sh_ptr] < i:
            last_sh = float(sh_prices[sh_ptr])
            sh_ptr += 1
        while sl_ptr < len(sl_indices) and sl_indices[sl_ptr] < i:
            last_sl = float(sl_prices[sl_ptr])
            sl_ptr += 1

        if choch_fired:
            # Already detected — mark all subsequent bars as False
            continue

        close = float(bars["close"][i])

        if prior_bos_direction == "bullish":
            # CHoCH: close breaks BELOW the last confirmed swing low
            if last_sl is not None and close < last_sl:
                choch_detected[i] = True
                choch_direction[i] = "bearish"
                choch_bar_idx[i] = i
                choch_magnitude[i] = round(last_sl - close, 4)
                choch_fired = True
        else:  # prior_bos_direction == "bearish"
            # CHoCH: close breaks ABOVE the last confirmed swing high
            if last_sh is not None and close > last_sh:
                choch_detected[i] = True
                choch_direction[i] = "bullish"
                choch_bar_idx[i] = i
                choch_magnitude[i] = round(close - last_sh, 4)
                choch_fired = True

    return pl.DataFrame({
        "choch_detected": pl.Series(choch_detected, dtype=pl.Boolean),
        "choch_direction": pl.Series(choch_direction, dtype=pl.Utf8),
        "choch_bar_idx": pl.Series(choch_bar_idx, dtype=pl.Int64),
        "choch_magnitude": pl.Series(choch_magnitude, dtype=pl.Float64),
    })


def detect_mss_with_context(
    bars: pl.DataFrame,
    choch_result: pl.DataFrame,
    atr_period: int = ATR_PERIOD_DEFAULT,
) -> pl.DataFrame:
    """Market Structure Shift: CHoCH confirmed by displacement candle.

    MSS fires when the CHoCH break bar has candle range >= MSS_DISPLACEMENT_THRESHOLD
    times the ATR at that bar. A small-body CHoCH (e.g. wick extension) does NOT
    qualify as MSS — only a displacement candle with genuine range.

    No look-ahead: ATR is computed rolling up to and including bar i; the CHoCH
    flag is already no-look-ahead (computed by detect_choch_with_context).

    Args:
        bars:         Execution-TF DataFrame with open, high, low, close, volume.
        choch_result: Output of detect_choch_with_context().
        atr_period:   Rolling ATR period (default ATR_PERIOD_DEFAULT=14).

    Returns:
        DataFrame with columns:
          mss_detected              (bool)
          mss_direction             (str)   — "bullish" | "bearish" | None
          mss_displacement_atr_mult (float) — multiplier at the MSS bar, else None
    """
    from src.engine.indicators.core import compute_atr

    n = len(bars)
    mss_detected: list[bool] = [False] * n
    mss_direction: list[str | None] = [None] * n
    mss_displacement_atr_mult: list[float | None] = [None] * n

    atr_series = compute_atr(bars, atr_period)
    choch_detected_col = choch_result["choch_detected"].to_list()
    choch_direction_col = choch_result["choch_direction"].to_list()

    for i in range(n):
        if not choch_detected_col[i]:
            continue

        candle_range = abs(float(bars["close"][i]) - float(bars["open"][i]))
        atr_val = atr_series[i]
        if atr_val is None or (atr_val != atr_val):  # None or NaN
            continue

        atr_f = float(atr_val)
        if atr_f <= 0:
            continue

        mult = candle_range / atr_f
        if mult >= MSS_DISPLACEMENT_THRESHOLD:
            mss_detected[i] = True
            mss_direction[i] = choch_direction_col[i]
            mss_displacement_atr_mult[i] = round(mult, 4)

    return pl.DataFrame({
        "mss_detected": pl.Series(mss_detected, dtype=pl.Boolean),
        "mss_direction": pl.Series(mss_direction, dtype=pl.Utf8),
        "mss_displacement_atr_mult": pl.Series(mss_displacement_atr_mult, dtype=pl.Float64),
    })


def premium_discount_zone(
    price: float,
    swing_high: float,
    swing_low: float,
) -> str:
    """PD-array scalar helper: classify price relative to the range midpoint.

    Returns:
        "premium"      if (price - swing_low) / range > 0.5
        "discount"     if (price - swing_low) / range < 0.5
        "equilibrium"  if exactly 0.5, OR if swing_high == swing_low (degenerate range)

    No look-ahead: purely scalar computation on already-known price levels.
    """
    if swing_high == swing_low:
        return "equilibrium"

    rng = swing_high - swing_low
    if rng <= 0:
        # Inverted range (swing_low > swing_high) — defensive fallback
        return "equilibrium"

    ratio = (price - swing_low) / rng
    if ratio > 0.5:
        return "premium"
    elif ratio < 0.5:
        return "discount"
    else:
        return "equilibrium"
