"""ICT Liquidity indicators — BSL, SSL, EQH, EQL, Sweeps, Inducement, Raids.

Liquidity in ICT represents clusters of stop losses above swing highs
(buy-side) or below swing lows (sell-side). Institutions target these
pools to fill large orders.
"""

from __future__ import annotations

import polars as pl


def detect_buyside_liquidity(df: pl.DataFrame, swings: pl.DataFrame) -> pl.DataFrame:
    """Detect Buy-Side Liquidity — clusters of swing highs where buy stops rest.

    BSL sits above swing highs. When price sweeps above, it triggers buy stops
    providing liquidity for institutional sell orders.

    Returns:
        DataFrame with columns: index, price, level_count (how many swing highs cluster here)
    """
    swing_highs = swings.filter(pl.col("type") == "high").sort("index")

    if len(swing_highs) == 0:
        return pl.DataFrame(schema={"index": pl.Int64, "price": pl.Float64, "level_count": pl.Int64})

    # Group nearby swing highs (within 0.5% of price)
    prices = swing_highs["price"].to_list()
    indices = swing_highs["index"].to_list()
    records = []
    used = set()

    for i in range(len(prices)):
        if i in used:
            continue
        cluster_price = prices[i]
        cluster_indices = [indices[i]]
        threshold = cluster_price * 0.005  # 0.5%

        for j in range(i + 1, len(prices)):
            if j in used:
                continue
            if abs(prices[j] - cluster_price) <= threshold:
                cluster_indices.append(indices[j])
                used.add(j)

        used.add(i)
        records.append({
            "index": max(cluster_indices),  # latest swing in cluster
            "price": cluster_price,
            "level_count": len(cluster_indices),
        })

    return pl.DataFrame(records)


def detect_sellside_liquidity(df: pl.DataFrame, swings: pl.DataFrame) -> pl.DataFrame:
    """Detect Sell-Side Liquidity — clusters of swing lows where sell stops rest.

    SSL sits below swing lows. When price sweeps below, it triggers sell stops
    providing liquidity for institutional buy orders.

    Returns:
        DataFrame with columns: index, price, level_count
    """
    swing_lows = swings.filter(pl.col("type") == "low").sort("index")

    if len(swing_lows) == 0:
        return pl.DataFrame(schema={"index": pl.Int64, "price": pl.Float64, "level_count": pl.Int64})

    prices = swing_lows["price"].to_list()
    indices = swing_lows["index"].to_list()
    records = []
    used = set()

    for i in range(len(prices)):
        if i in used:
            continue
        cluster_price = prices[i]
        cluster_indices = [indices[i]]
        threshold = cluster_price * 0.005

        for j in range(i + 1, len(prices)):
            if j in used:
                continue
            if abs(prices[j] - cluster_price) <= threshold:
                cluster_indices.append(indices[j])
                used.add(j)

        used.add(i)
        records.append({
            "index": max(cluster_indices),
            "price": cluster_price,
            "level_count": len(cluster_indices),
        })

    return pl.DataFrame(records)


def detect_equal_highs(df: pl.DataFrame, tolerance: float = 0.5) -> pl.DataFrame:
    """Detect Equal Highs — two or more swing highs at nearly the same price.

    Equal highs are a strong BSL target because many traders place stops above them.

    Args:
        df: OHLCV DataFrame
        tolerance: Maximum price difference to consider "equal" (in points)

    Returns:
        DataFrame with columns: index_a, index_b, price, diff
    """
    from src.engine.indicators.market_structure import detect_swings

    swings = detect_swings(df, lookback=5)
    swing_highs = swings.filter(pl.col("type") == "high").sort("index")

    records = []
    prices = swing_highs["price"].to_list() if len(swing_highs) > 0 else []
    indices = swing_highs["index"].to_list() if len(swing_highs) > 0 else []

    for i in range(len(prices)):
        for j in range(i + 1, len(prices)):
            diff = abs(prices[i] - prices[j])
            if diff <= tolerance:
                records.append({
                    "index_a": indices[i],
                    "index_b": indices[j],
                    "price": (prices[i] + prices[j]) / 2.0,
                    "diff": diff,
                })

    if not records:
        return pl.DataFrame(schema={
            "index_a": pl.Int64, "index_b": pl.Int64,
            "price": pl.Float64, "diff": pl.Float64,
        })

    return pl.DataFrame(records)


def detect_equal_lows(df: pl.DataFrame, tolerance: float = 0.5) -> pl.DataFrame:
    """Detect Equal Lows — two or more swing lows at nearly the same price.

    Equal lows are a strong SSL target.

    Returns:
        DataFrame with columns: index_a, index_b, price, diff
    """
    from src.engine.indicators.market_structure import detect_swings

    swings = detect_swings(df, lookback=5)
    swing_lows = swings.filter(pl.col("type") == "low").sort("index")

    records = []
    prices = swing_lows["price"].to_list() if len(swing_lows) > 0 else []
    indices = swing_lows["index"].to_list() if len(swing_lows) > 0 else []

    for i in range(len(prices)):
        for j in range(i + 1, len(prices)):
            diff = abs(prices[i] - prices[j])
            if diff <= tolerance:
                records.append({
                    "index_a": indices[i],
                    "index_b": indices[j],
                    "price": (prices[i] + prices[j]) / 2.0,
                    "diff": diff,
                })

    if not records:
        return pl.DataFrame(schema={
            "index_a": pl.Int64, "index_b": pl.Int64,
            "price": pl.Float64, "diff": pl.Float64,
        })

    return pl.DataFrame(records)


def detect_sweep(df: pl.DataFrame, liquidity_levels: pl.DataFrame) -> pl.Series:
    """Detect Liquidity Sweeps — price briefly breaks a liquidity level then reverses.

    A sweep occurs when price takes out a liquidity level (high closes above BSL
    or low closes below SSL) and then closes back inside within 1-3 bars.

    Args:
        df: OHLCV DataFrame
        liquidity_levels: DataFrame with 'price' column (BSL or SSL levels)

    Returns:
        Boolean Series: True on bars where a sweep is detected.
    """
    result = [False] * len(df)

    if len(liquidity_levels) == 0:
        return pl.Series("sweep", result)

    levels = liquidity_levels["price"].to_list()
    highs = df["high"].to_list()
    lows = df["low"].to_list()
    closes = df["close"].to_list()

    for level in levels:
        for i in range(1, len(df)):
            # Sweep above (BSL sweep)
            if highs[i] > level and closes[i] < level:
                result[i] = True
            # Sweep below (SSL sweep)
            elif lows[i] < level and closes[i] > level:
                result[i] = True

    return pl.Series("sweep", result)


def detect_inducement(df: pl.DataFrame, swings: pl.DataFrame) -> pl.DataFrame:
    """Detect Inducement — minor swing points that lure retail traders before the real move.

    Inducement is a minor swing point (shorter lookback) that gets taken out
    before price reaches the real liquidity target (major swing).

    Returns:
        DataFrame with columns: index, type ("bullish"/"bearish"), price
    """
    from src.engine.indicators.market_structure import detect_swings as _detect_swings

    # Minor swings (lookback=2) vs major swings (lookback=5 from input)
    minor_swings = _detect_swings(df, lookback=2)

    records = []
    major_highs = set(swings.filter(pl.col("type") == "high")["index"].to_list()) if len(swings) > 0 else set()
    major_lows = set(swings.filter(pl.col("type") == "low")["index"].to_list()) if len(swings) > 0 else set()

    for row_i in range(len(minor_swings)):
        idx = int(minor_swings["index"][row_i])
        swing_type = str(minor_swings["type"][row_i])
        price = float(minor_swings["price"][row_i])

        # Minor swing that isn't a major swing = potential inducement
        if swing_type == "high" and idx not in major_highs:
            records.append({"index": idx, "type": "bearish", "price": price})
        elif swing_type == "low" and idx not in major_lows:
            records.append({"index": idx, "type": "bullish", "price": price})

    if not records:
        return pl.DataFrame(schema={"index": pl.Int64, "type": pl.Utf8, "price": pl.Float64})

    return pl.DataFrame(records)


def detect_raid(df: pl.DataFrame, liquidity_levels: pl.DataFrame) -> pl.Series:
    """Detect Liquidity Raids — aggressive sweep + reversal pattern.

    A raid is a sweep followed by a strong reversal candle (displacement).
    More aggressive than a simple sweep — indicates institutional entry.

    Args:
        df: OHLCV DataFrame
        liquidity_levels: DataFrame with 'price' column

    Returns:
        Boolean Series: True on bars where a raid is detected.
    """
    sweeps = detect_sweep(df, liquidity_levels)
    result = [False] * len(df)

    opens = df["open"].to_list()
    closes = df["close"].to_list()
    highs = df["high"].to_list()
    lows = df["low"].to_list()

    for i in range(len(df) - 1):
        if not sweeps[i]:
            continue

        # Check next bar for displacement (strong reversal)
        next_i = i + 1
        next_body = abs(closes[next_i] - opens[next_i])
        next_range = highs[next_i] - lows[next_i]

        # Displacement: body > 60% of total range
        # Signal at the displacement bar (next_i), not the sweep bar,
        # to avoid 1-bar lookahead bias
        if next_range > 0 and next_body / next_range > 0.6:
            result[next_i] = True

    return pl.Series("raid", result)
