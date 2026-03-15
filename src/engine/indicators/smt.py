"""ICT SMT (Smart Money Technique) Divergence indicators.

SMT divergence occurs when correlated instruments fail to confirm
each other's highs or lows. This signals institutional activity
and potential reversals.

Core function: smt_divergence() works with any instrument pair.
Pre-configured pairs: ES/NQ, DXY/EURUSD, GC/DXY, YM/ES.
"""

from __future__ import annotations

import polars as pl

from src.engine.indicators.market_structure import detect_swings


def smt_divergence(
    df_a: pl.DataFrame,
    df_b: pl.DataFrame,
    lookback: int = 20,
) -> pl.DataFrame:
    """Detect SMT divergence between two correlated instruments.

    Bullish SMT: instrument A makes a new low but instrument B does NOT.
    Bearish SMT: instrument A makes a new high but instrument B does NOT.

    Both DataFrames must have the same length and be time-aligned.

    Args:
        df_a: OHLCV DataFrame for instrument A
        df_b: OHLCV DataFrame for instrument B
        lookback: Window for detecting new highs/lows

    Returns:
        DataFrame with columns: index, type ("bullish"/"bearish"),
        price_a, price_b, divergence_size
    """
    if len(df_a) != len(df_b):
        raise ValueError(
            f"DataFrames must have same length: {len(df_a)} vs {len(df_b)}"
        )

    records = []

    highs_a = df_a["high"].to_list()
    lows_a = df_a["low"].to_list()
    highs_b = df_b["high"].to_list()
    lows_b = df_b["low"].to_list()

    for i in range(lookback, len(df_a)):
        window_start = i - lookback

        # Check for new high in A
        a_high_window = highs_a[window_start:i]
        a_low_window = lows_a[window_start:i]
        b_high_window = highs_b[window_start:i]
        b_low_window = lows_b[window_start:i]

        a_max = max(a_high_window) if a_high_window else 0
        b_max = max(b_high_window) if b_high_window else 0
        a_min = min(a_low_window) if a_low_window else 0
        b_min = min(b_low_window) if b_low_window else 0

        # Bearish SMT: A makes new high, B does NOT
        if highs_a[i] > a_max and highs_b[i] <= b_max:
            div_size = highs_a[i] - a_max
            records.append({
                "index": i,
                "type": "bearish",
                "price_a": highs_a[i],
                "price_b": highs_b[i],
                "divergence_size": abs(div_size),
            })

        # Bullish SMT: A makes new low, B does NOT
        elif lows_a[i] < a_min and lows_b[i] >= b_min:
            div_size = a_min - lows_a[i]
            records.append({
                "index": i,
                "type": "bullish",
                "price_a": lows_a[i],
                "price_b": lows_b[i],
                "divergence_size": abs(div_size),
            })

    if not records:
        return pl.DataFrame(schema={
            "index": pl.Int64,
            "type": pl.Utf8,
            "price_a": pl.Float64,
            "price_b": pl.Float64,
            "divergence_size": pl.Float64,
        })

    return pl.DataFrame(records)


def custom_smt(
    df_a: pl.DataFrame,
    df_b: pl.DataFrame,
    correlation_type: str = "positive",
    lookback: int = 20,
) -> pl.DataFrame:
    """Custom SMT divergence with configurable correlation type.

    For positively correlated pairs (ES/NQ): divergence = one makes new extreme, other doesn't.
    For negatively correlated pairs (DXY/EURUSD): divergence = both move same direction.

    Args:
        df_a: OHLCV DataFrame for instrument A
        df_b: OHLCV DataFrame for instrument B
        correlation_type: "positive" or "negative"
        lookback: Window for detecting new highs/lows

    Returns:
        Same schema as smt_divergence().
    """
    if correlation_type == "positive":
        return smt_divergence(df_a, df_b, lookback)

    # Negative correlation: flip instrument B
    # For DXY/EURUSD: when DXY goes up, EUR should go down
    # Divergence = both go same direction
    if len(df_a) != len(df_b):
        raise ValueError(f"DataFrames must have same length: {len(df_a)} vs {len(df_b)}")

    records = []

    highs_a = df_a["high"].to_list()
    lows_a = df_a["low"].to_list()
    highs_b = df_b["high"].to_list()
    lows_b = df_b["low"].to_list()

    for i in range(lookback, len(df_a)):
        window_start = i - lookback

        a_high_window = highs_a[window_start:i]
        a_low_window = lows_a[window_start:i]
        b_high_window = highs_b[window_start:i]
        b_low_window = lows_b[window_start:i]

        a_max = max(a_high_window) if a_high_window else 0
        b_max = max(b_high_window) if b_high_window else 0
        a_min = min(a_low_window) if a_low_window else 0
        b_min = min(b_low_window) if b_low_window else 0

        # Negative divergence: A makes new high AND B also makes new high
        # (they should move opposite)
        if highs_a[i] > a_max and highs_b[i] > b_max:
            records.append({
                "index": i,
                "type": "bearish",
                "price_a": highs_a[i],
                "price_b": highs_b[i],
                "divergence_size": abs(highs_a[i] - a_max),
            })

        # A makes new low AND B also makes new low
        elif lows_a[i] < a_min and lows_b[i] < b_min:
            records.append({
                "index": i,
                "type": "bullish",
                "price_a": lows_a[i],
                "price_b": lows_b[i],
                "divergence_size": abs(a_min - lows_a[i]),
            })

    if not records:
        return pl.DataFrame(schema={
            "index": pl.Int64,
            "type": pl.Utf8,
            "price_a": pl.Float64,
            "price_b": pl.Float64,
            "divergence_size": pl.Float64,
        })

    return pl.DataFrame(records)


# ─── Pre-configured pair functions ────────────────────────────────
# These are convenience wrappers — the core smt_divergence() does all the work.

def es_nq_smt(df_es: pl.DataFrame, df_nq: pl.DataFrame, lookback: int = 20) -> pl.DataFrame:
    """ES vs NQ SMT divergence (positive correlation)."""
    return smt_divergence(df_es, df_nq, lookback)


def dxy_eurusd_smt(df_dxy: pl.DataFrame, df_eur: pl.DataFrame, lookback: int = 20) -> pl.DataFrame:
    """DXY vs EUR/USD SMT divergence (negative correlation)."""
    return custom_smt(df_dxy, df_eur, correlation_type="negative", lookback=lookback)


def gc_dxy_smt(df_gc: pl.DataFrame, df_dxy: pl.DataFrame, lookback: int = 20) -> pl.DataFrame:
    """Gold vs DXY SMT divergence (negative correlation)."""
    return custom_smt(df_gc, df_dxy, correlation_type="negative", lookback=lookback)


def ym_es_smt(df_ym: pl.DataFrame, df_es: pl.DataFrame, lookback: int = 20) -> pl.DataFrame:
    """YM vs ES SMT divergence (positive correlation)."""
    return smt_divergence(df_ym, df_es, lookback)


def nq_es_smt(df_nq: pl.DataFrame, df_es: pl.DataFrame, lookback: int = 20) -> pl.DataFrame:
    """NQ vs ES SMT divergence (positive correlation)."""
    return smt_divergence(df_nq, df_es, lookback)
