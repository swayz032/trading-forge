"""ICT Liquidity indicators — BSL, SSL, EQH, EQL, Sweeps, Inducement, Raids.

Liquidity in ICT represents clusters of stop losses above swing highs
(buy-side) or below swing lows (sell-side). Institutions target these
pools to fill large orders.
"""

from __future__ import annotations

import polars as pl


def _cluster_swings_causal(prices: list[float], indices: list[int]) -> list[dict]:
    """Cluster swing points into liquidity levels using a CAUSAL streaming pass.

    ``prices``/``indices`` MUST already be sorted by ``indices`` ascending — i.e. in
    the order the swings become *known* (this matches ``detect_swings``'s
    confirmation-delay-shifted ``index`` column, which is the record-knowability
    index for a swing: a swing is not visible until its own ``index`` bar).

    Each swing, in that knowability order, joins the FIRST existing cluster whose
    anchor price is within 0.5% of the swing's price; if none matches, the swing
    opens a new cluster anchored at its own price. A cluster's anchor price is
    fixed forever at creation (by whichever swing formed it first) and is never
    recomputed from later members.

    MEMBERSHIP is provably causal: the assignment made for swing k depends only on
    clusters built from swings 0..k-1 plus swing k itself, never on swings after k.
    (This part is provably equivalent to the old used-set greedy scan — both are
    "earliest-anchor-wins" partitions of the same fixed-threshold relation; see
    AR-107 diagnosis. A future swing was never able to steal an earlier swing into
    a different price anchor.)

    The ACTUAL defect fixed here is the reported ``index`` field. The old code used
    ``max(cluster_indices)`` — the latest member's index. Because a cluster can
    keep gaining members forever, that "index" is not stable: a row visible with
    index=73 when only 100 bars are known can silently become index=135 once bar
    135's swing joins the same (price-anchor-unchanged) cluster — the row born at
    bar 73 "vanishes" under any `index < C` visibility query, even though the level
    itself, and its assignment, never changed. This IS the AR-096 F-1 "vanishing"
    symptom: whether a *row* is visible at bar i was being decided by data at bar
    >> i, purely through the choice of which member's index gets reported.

    Fix: report ``index = min(cluster_indices)`` — the CREATION index (first swing
    that formed the cluster and fixed its price anchor). This value is provably
    immutable once assigned: the first member of a given cluster can never change
    as more data arrives (new swings only ever join or spawn a NEW cluster; existing
    clusters are never merged or re-founded on a different first member). So a row
    (index, price) pair reported at cutoff C is guaranteed to still be reported
    (identical index and price) at any cutoff C' > C — only ``level_count`` may
    grow, which is documented, expected, and itself causal (it always reflects
    exactly the touches known as of whichever cutoff produced the row).

    Contrast with the banned wrong fix (cluster over everything, then slice output
    by index) — there the MEMBERSHIP pass itself still scans the whole array before
    any slicing, and (per the equivalence above) membership was never the leak; the
    banned fix also does nothing about the max-index reporting instability, so it
    would still show the exact F-1 vanishing symptom despite "passing" a naive
    truncation probe run against its own sliced output.
    """
    clusters: list[dict] = []  # [{"anchor_price": float, "indices": [int, ...]}, ...]

    for price, idx in zip(prices, indices, strict=True):
        target = None
        for c in clusters:
            threshold = c["anchor_price"] * 0.005  # 0.5%, same tolerance as before
            if abs(price - c["anchor_price"]) <= threshold:
                target = c
                break
        if target is None:
            clusters.append({"anchor_price": price, "indices": [idx]})
        else:
            target["indices"].append(idx)

    return [
        {
            "index": min(c["indices"]),  # creation index — immutable once assigned (see above)
            "price": c["anchor_price"],
            "level_count": len(c["indices"]),
        }
        for c in clusters
    ]


def detect_buyside_liquidity(df: pl.DataFrame, swings: pl.DataFrame) -> pl.DataFrame:
    """Detect Buy-Side Liquidity — clusters of swing highs where buy stops rest.

    BSL sits above swing highs. When price sweeps above, it triggers buy stops
    providing liquidity for institutional sell orders.

    Clustering is CAUSAL: a level's membership as of bar i depends only on swing
    highs known by bar i (see ``_cluster_swings_causal``). A later swing high can
    extend an existing level's ``level_count`` but can never retroactively re-anchor
    or absorb a swing that was already assigned to a different level, and it can
    never change an already-reported row's ``index`` or ``price`` (``index`` is the
    cluster's CREATION index, not its latest touch — see ``_cluster_swings_causal``
    docstring for why that convention is required for causal row visibility).

    Returns:
        DataFrame with columns: index (creation bar of the cluster), price,
        level_count (how many swing highs cluster here, as of the input swings)
    """
    swing_highs = swings.filter(pl.col("type") == "high").sort("index")

    if len(swing_highs) == 0:
        return pl.DataFrame(schema={"index": pl.Int64, "price": pl.Float64, "level_count": pl.Int64})

    prices = swing_highs["price"].to_list()
    indices = swing_highs["index"].to_list()
    records = _cluster_swings_causal(prices, indices)

    return pl.DataFrame(records)


def detect_sellside_liquidity(df: pl.DataFrame, swings: pl.DataFrame) -> pl.DataFrame:
    """Detect Sell-Side Liquidity — clusters of swing lows where sell stops rest.

    SSL sits below swing lows. When price sweeps below, it triggers sell stops
    providing liquidity for institutional buy orders.

    Clustering is CAUSAL: a level's membership as of bar i depends only on swing
    lows known by bar i (see ``_cluster_swings_causal``). A later swing low can
    extend an existing level's ``level_count`` but can never retroactively re-anchor
    or absorb a swing that was already assigned to a different level, and it can
    never change an already-reported row's ``index`` or ``price`` (``index`` is the
    cluster's CREATION index, not its latest touch — see ``_cluster_swings_causal``
    docstring for why that convention is required for causal row visibility).

    Returns:
        DataFrame with columns: index (creation bar of the cluster), price,
        level_count
    """
    swing_lows = swings.filter(pl.col("type") == "low").sort("index")

    if len(swing_lows) == 0:
        return pl.DataFrame(schema={"index": pl.Int64, "price": pl.Float64, "level_count": pl.Int64})

    prices = swing_lows["price"].to_list()
    indices = swing_lows["index"].to_list()
    records = _cluster_swings_causal(prices, indices)

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
