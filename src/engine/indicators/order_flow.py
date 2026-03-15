"""ICT Order Flow indicators — Order Blocks, Breaker, Mitigation, Rejection, Propulsion.

Order Blocks represent institutional footprints where large orders were placed.
They act as supply/demand zones for future price reactions.
"""

from __future__ import annotations

import polars as pl


def detect_bullish_ob(df: pl.DataFrame, swings: pl.DataFrame) -> pl.DataFrame:
    """Detect Bullish Order Blocks — the last bearish candle before a swing low that leads to a BOS up.

    A bullish OB is the last down-close candle before price makes a swing low
    and then breaks structure to the upside.

    Args:
        df: OHLCV DataFrame
        swings: Output from detect_swings()

    Returns:
        DataFrame with columns: index, top (high of OB candle), bottom (low of OB candle), type="bullish"
    """
    records = []
    swing_lows = swings.filter(pl.col("type") == "low").sort("index")

    if len(swing_lows) == 0:
        return pl.DataFrame(schema={
            "index": pl.Int64, "top": pl.Float64, "bottom": pl.Float64, "type": pl.Utf8,
        })

    opens = df["open"].to_list()
    closes = df["close"].to_list()
    highs = df["high"].to_list()
    lows = df["low"].to_list()

    for row_i in range(len(swing_lows)):
        sl_idx = int(swing_lows["index"][row_i])

        # Look backward from swing low for last bearish candle
        for j in range(sl_idx, max(sl_idx - 10, 0), -1):
            if closes[j] < opens[j]:  # bearish candle
                records.append({
                    "index": j,
                    "top": highs[j],
                    "bottom": lows[j],
                    "type": "bullish",
                })
                break

    if not records:
        return pl.DataFrame(schema={
            "index": pl.Int64, "top": pl.Float64, "bottom": pl.Float64, "type": pl.Utf8,
        })

    return pl.DataFrame(records)


def detect_bearish_ob(df: pl.DataFrame, swings: pl.DataFrame) -> pl.DataFrame:
    """Detect Bearish Order Blocks — the last bullish candle before a swing high that leads to a BOS down.

    Args:
        df: OHLCV DataFrame
        swings: Output from detect_swings()

    Returns:
        DataFrame with columns: index, top, bottom, type="bearish"
    """
    records = []
    swing_highs = swings.filter(pl.col("type") == "high").sort("index")

    if len(swing_highs) == 0:
        return pl.DataFrame(schema={
            "index": pl.Int64, "top": pl.Float64, "bottom": pl.Float64, "type": pl.Utf8,
        })

    opens = df["open"].to_list()
    closes = df["close"].to_list()
    highs = df["high"].to_list()
    lows = df["low"].to_list()

    for row_i in range(len(swing_highs)):
        sh_idx = int(swing_highs["index"][row_i])

        for j in range(sh_idx, max(sh_idx - 10, 0), -1):
            if closes[j] > opens[j]:  # bullish candle
                records.append({
                    "index": j,
                    "top": highs[j],
                    "bottom": lows[j],
                    "type": "bearish",
                })
                break

    if not records:
        return pl.DataFrame(schema={
            "index": pl.Int64, "top": pl.Float64, "bottom": pl.Float64, "type": pl.Utf8,
        })

    return pl.DataFrame(records)


def detect_breaker(df: pl.DataFrame, obs: pl.DataFrame) -> pl.DataFrame:
    """Detect Breaker Blocks — Order Blocks that have been broken through and now act as opposite zones.

    A bullish OB that gets broken becomes a bearish breaker (and vice versa).
    Price traded through the OB zone, invalidating its original purpose.

    Args:
        df: OHLCV DataFrame
        obs: Combined order blocks from detect_bullish_ob/detect_bearish_ob

    Returns:
        DataFrame with columns: index, top, bottom, type ("bullish_breaker"/"bearish_breaker"), broken_at
    """
    records = []
    closes = df["close"].to_list()

    for row_i in range(len(obs)):
        ob_idx = int(obs["index"][row_i])
        ob_type = str(obs["type"][row_i])
        ob_top = float(obs["top"][row_i])
        ob_bottom = float(obs["bottom"][row_i])

        # Check if OB was broken through after formation
        for i in range(ob_idx + 1, len(df)):
            close = closes[i]
            if ob_type == "bullish" and close < ob_bottom:
                # Bullish OB broken → becomes bearish breaker
                records.append({
                    "index": ob_idx,
                    "top": ob_top,
                    "bottom": ob_bottom,
                    "type": "bearish_breaker",
                    "broken_at": i,
                })
                break
            elif ob_type == "bearish" and close > ob_top:
                # Bearish OB broken → becomes bullish breaker
                records.append({
                    "index": ob_idx,
                    "top": ob_top,
                    "bottom": ob_bottom,
                    "type": "bullish_breaker",
                    "broken_at": i,
                })
                break

    if not records:
        return pl.DataFrame(schema={
            "index": pl.Int64, "top": pl.Float64, "bottom": pl.Float64,
            "type": pl.Utf8, "broken_at": pl.Int64,
        })

    return pl.DataFrame(records)


def detect_mitigation(df: pl.DataFrame, obs: pl.DataFrame) -> pl.DataFrame:
    """Detect Mitigation Blocks — partially filled Order Blocks.

    Price returns to the OB zone but doesn't fully break through.
    The OB is mitigated (partially filled) but still holds as a zone.

    Args:
        df: OHLCV DataFrame
        obs: Order blocks from detect_bullish_ob/detect_bearish_ob

    Returns:
        DataFrame with columns: index, top, bottom, type, mitigated_at, penetration_pct
    """
    records = []
    highs = df["high"].to_list()
    lows = df["low"].to_list()

    for row_i in range(len(obs)):
        ob_idx = int(obs["index"][row_i])
        ob_type = str(obs["type"][row_i])
        ob_top = float(obs["top"][row_i])
        ob_bottom = float(obs["bottom"][row_i])
        ob_range = ob_top - ob_bottom

        if ob_range <= 0:
            continue

        for i in range(ob_idx + 1, len(df)):
            if ob_type == "bullish":
                # Price comes down into the bullish OB zone
                if lows[i] <= ob_top and lows[i] >= ob_bottom:
                    penetration = (ob_top - lows[i]) / ob_range
                    records.append({
                        "index": ob_idx,
                        "top": ob_top,
                        "bottom": ob_bottom,
                        "type": "bullish_mitigation",
                        "mitigated_at": i,
                        "penetration_pct": round(penetration * 100, 1),
                    })
                    break
            elif ob_type == "bearish":
                if highs[i] >= ob_bottom and highs[i] <= ob_top:
                    penetration = (highs[i] - ob_bottom) / ob_range
                    records.append({
                        "index": ob_idx,
                        "top": ob_top,
                        "bottom": ob_bottom,
                        "type": "bearish_mitigation",
                        "mitigated_at": i,
                        "penetration_pct": round(penetration * 100, 1),
                    })
                    break

    if not records:
        return pl.DataFrame(schema={
            "index": pl.Int64, "top": pl.Float64, "bottom": pl.Float64,
            "type": pl.Utf8, "mitigated_at": pl.Int64, "penetration_pct": pl.Float64,
        })

    return pl.DataFrame(records)


def detect_rejection(df: pl.DataFrame) -> pl.DataFrame:
    """Detect Rejection Blocks — candles with long wicks showing institutional rejection.

    A rejection block has a wick that is >= 2x the body size,
    indicating price was rejected at that level.

    Returns:
        DataFrame with columns: index, type ("bullish"/"bearish"), wick_high, wick_low, body_size
    """
    records = []
    opens = df["open"].to_list()
    highs = df["high"].to_list()
    lows = df["low"].to_list()
    closes = df["close"].to_list()

    for i in range(len(df)):
        body = abs(closes[i] - opens[i])
        upper_wick = highs[i] - max(opens[i], closes[i])
        lower_wick = min(opens[i], closes[i]) - lows[i]

        if body == 0:
            continue

        # Bearish rejection: long upper wick (rejected at highs)
        if upper_wick >= 2.0 * body and upper_wick > lower_wick:
            records.append({
                "index": i,
                "type": "bearish",
                "wick_high": highs[i],
                "wick_low": max(opens[i], closes[i]),
                "body_size": body,
            })
        # Bullish rejection: long lower wick (rejected at lows)
        elif lower_wick >= 2.0 * body and lower_wick > upper_wick:
            records.append({
                "index": i,
                "type": "bullish",
                "wick_high": min(opens[i], closes[i]),
                "wick_low": lows[i],
                "body_size": body,
            })

    if not records:
        return pl.DataFrame(schema={
            "index": pl.Int64, "type": pl.Utf8,
            "wick_high": pl.Float64, "wick_low": pl.Float64, "body_size": pl.Float64,
        })

    return pl.DataFrame(records)


def detect_propulsion(df: pl.DataFrame, obs: pl.DataFrame, fvgs: pl.DataFrame) -> pl.DataFrame:
    """Detect Propulsion Blocks — Order Blocks with an overlapping FVG.

    A propulsion block is a higher-confidence zone where an OB and FVG overlap,
    creating a stronger area of institutional interest.

    Args:
        df: OHLCV DataFrame
        obs: Order blocks
        fvgs: Fair Value Gaps from detect_fvg()

    Returns:
        DataFrame with columns: index, top, bottom, type, ob_index, fvg_index
    """
    records = []

    for ob_i in range(len(obs)):
        ob_top = float(obs["top"][ob_i])
        ob_bottom = float(obs["bottom"][ob_i])
        ob_idx = int(obs["index"][ob_i])
        ob_type = str(obs["type"][ob_i])

        for fvg_i in range(len(fvgs)):
            fvg_top = float(fvgs["top"][fvg_i])
            fvg_bottom = float(fvgs["bottom"][fvg_i])
            fvg_idx = int(fvgs["index"][fvg_i])

            # Check for overlap
            overlap_top = min(ob_top, fvg_top)
            overlap_bottom = max(ob_bottom, fvg_bottom)

            if overlap_top > overlap_bottom and abs(fvg_idx - ob_idx) <= 5:
                records.append({
                    "index": ob_idx,
                    "top": overlap_top,
                    "bottom": overlap_bottom,
                    "type": ob_type + "_propulsion",
                    "ob_index": ob_idx,
                    "fvg_index": fvg_idx,
                })
                break  # one propulsion per OB

    if not records:
        return pl.DataFrame(schema={
            "index": pl.Int64, "top": pl.Float64, "bottom": pl.Float64,
            "type": pl.Utf8, "ob_index": pl.Int64, "fvg_index": pl.Int64,
        })

    return pl.DataFrame(records)
