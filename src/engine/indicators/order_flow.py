"""ICT Order Flow indicators — Order Blocks, Breaker, Mitigation, Rejection, Propulsion.

Performance: Hot paths compiled with Numba @njit — handles 500K+ bars in seconds.
"""

from __future__ import annotations

import numpy as np
import polars as pl
from numba import njit


# ─── Numba-compiled kernels (machine-code speed) ──────────────────

@njit(cache=True)
def _find_bullish_obs(opens, closes, highs, lows, sl_indices):
    """Find last bearish candle before each swing low. Returns (index, top, bottom) arrays."""
    n = len(sl_indices)
    out_idx = np.empty(n, dtype=np.int64)
    out_top = np.empty(n, dtype=np.float64)
    out_bot = np.empty(n, dtype=np.float64)
    count = 0
    for k in range(n):
        sl = sl_indices[k]
        start = max(sl - 10, 0)
        for j in range(sl, start - 1, -1):
            if closes[j] < opens[j]:
                out_idx[count] = j
                out_top[count] = highs[j]
                out_bot[count] = lows[j]
                count += 1
                break
    return out_idx[:count], out_top[:count], out_bot[:count]


@njit(cache=True)
def _find_bearish_obs(opens, closes, highs, lows, sh_indices):
    """Find last bullish candle before each swing high."""
    n = len(sh_indices)
    out_idx = np.empty(n, dtype=np.int64)
    out_top = np.empty(n, dtype=np.float64)
    out_bot = np.empty(n, dtype=np.float64)
    count = 0
    for k in range(n):
        sh = sh_indices[k]
        start = max(sh - 10, 0)
        for j in range(sh, start - 1, -1):
            if closes[j] > opens[j]:
                out_idx[count] = j
                out_top[count] = highs[j]
                out_bot[count] = lows[j]
                count += 1
                break
    return out_idx[:count], out_top[:count], out_bot[:count]


@njit(cache=True)
def _find_breakers(closes, ob_indices, ob_tops, ob_bottoms, ob_is_bullish, n_bars):
    """Find first bar where each OB is broken through. O(m) per OB using numpy slice."""
    m = len(ob_indices)
    out_idx = np.empty(m, dtype=np.int64)
    out_top = np.empty(m, dtype=np.float64)
    out_bot = np.empty(m, dtype=np.float64)
    out_broken = np.empty(m, dtype=np.int64)
    out_is_bull_breaker = np.empty(m, dtype=np.bool_)
    count = 0

    for k in range(m):
        ob_idx = ob_indices[k]
        if ob_idx + 1 >= n_bars:
            continue

        if ob_is_bullish[k]:
            # Bullish OB broken when close < bottom → bearish breaker
            for i in range(ob_idx + 1, n_bars):
                if closes[i] < ob_bottoms[k]:
                    out_idx[count] = ob_idx
                    out_top[count] = ob_tops[k]
                    out_bot[count] = ob_bottoms[k]
                    out_broken[count] = i
                    out_is_bull_breaker[count] = False  # bearish breaker
                    count += 1
                    break
        else:
            # Bearish OB broken when close > top → bullish breaker
            for i in range(ob_idx + 1, n_bars):
                if closes[i] > ob_tops[k]:
                    out_idx[count] = ob_idx
                    out_top[count] = ob_tops[k]
                    out_bot[count] = ob_bottoms[k]
                    out_broken[count] = i
                    out_is_bull_breaker[count] = True  # bullish breaker
                    count += 1
                    break

    return out_idx[:count], out_top[:count], out_bot[:count], out_broken[:count], out_is_bull_breaker[:count]


@njit(cache=True)
def _compute_breaker_signals(closes, b_tops, b_bottoms, b_broken_at, b_is_bull, zone_age_limit, n_bars):
    """Generate entry_long/entry_short boolean arrays from breaker zones.

    Iterates over breakers (small, ~100-300), vectorized per-breaker scan over bars.
    Total: O(m × age_limit) not O(n × m).
    """
    entry_long = np.zeros(n_bars, dtype=np.bool_)
    entry_short = np.zeros(n_bars, dtype=np.bool_)

    for k in range(len(b_tops)):
        start = b_broken_at[k] + 1
        end = min(start + zone_age_limit, n_bars)
        top = b_tops[k]
        bot = b_bottoms[k]
        is_bull = b_is_bull[k]

        for i in range(start, end):
            c = closes[i]
            if bot <= c <= top:
                if is_bull:
                    entry_long[i] = True
                else:
                    entry_short[i] = True

    return entry_long, entry_short


# ─── Public API (Polars in/out, Numba inside) ─────────────────────

def detect_bullish_ob(df: pl.DataFrame, swings: pl.DataFrame) -> pl.DataFrame:
    """Detect Bullish Order Blocks — last bearish candle before a swing low."""
    swing_lows = swings.filter(pl.col("type") == "low").sort("index")
    empty = pl.DataFrame(schema={"index": pl.Int64, "top": pl.Float64, "bottom": pl.Float64, "type": pl.Utf8})

    if len(swing_lows) == 0:
        return empty

    idx, top, bot = _find_bullish_obs(
        df["open"].to_numpy(), df["close"].to_numpy(),
        df["high"].to_numpy(), df["low"].to_numpy(),
        swing_lows["index"].to_numpy().astype(np.int64),
    )

    if len(idx) == 0:
        return empty

    return pl.DataFrame({"index": idx, "top": top, "bottom": bot, "type": ["bullish"] * len(idx)})


def detect_bearish_ob(df: pl.DataFrame, swings: pl.DataFrame) -> pl.DataFrame:
    """Detect Bearish Order Blocks — last bullish candle before a swing high."""
    swing_highs = swings.filter(pl.col("type") == "high").sort("index")
    empty = pl.DataFrame(schema={"index": pl.Int64, "top": pl.Float64, "bottom": pl.Float64, "type": pl.Utf8})

    if len(swing_highs) == 0:
        return empty

    idx, top, bot = _find_bearish_obs(
        df["open"].to_numpy(), df["close"].to_numpy(),
        df["high"].to_numpy(), df["low"].to_numpy(),
        swing_highs["index"].to_numpy().astype(np.int64),
    )

    if len(idx) == 0:
        return empty

    return pl.DataFrame({"index": idx, "top": top, "bottom": bot, "type": ["bearish"] * len(idx)})


def detect_breaker(df: pl.DataFrame, obs: pl.DataFrame) -> pl.DataFrame:
    """Detect Breaker Blocks — OBs broken through, now opposite zones.

    Numba-compiled forward scan — O(m × avg_break_distance), not O(n²).
    """
    empty = pl.DataFrame(schema={
        "index": pl.Int64, "top": pl.Float64, "bottom": pl.Float64,
        "type": pl.Utf8, "broken_at": pl.Int64,
    })

    if len(obs) == 0:
        return empty

    closes = df["close"].to_numpy()
    ob_types = obs["type"].to_list()
    is_bullish = np.array([t == "bullish" for t in ob_types])

    idx, top, bot, broken, is_bull_breaker = _find_breakers(
        closes,
        obs["index"].to_numpy().astype(np.int64),
        obs["top"].to_numpy(),
        obs["bottom"].to_numpy(),
        is_bullish,
        len(closes),
    )

    if len(idx) == 0:
        return empty

    types = ["bullish_breaker" if b else "bearish_breaker" for b in is_bull_breaker]
    return pl.DataFrame({"index": idx, "top": top, "bottom": bot, "type": types, "broken_at": broken})


def compute_breaker_signals(df: pl.DataFrame, breakers: pl.DataFrame, zone_age_limit: int = 30):
    """Generate entry signals from breaker zones. Numba-compiled, O(m × age_limit).

    Returns (entry_long, entry_short) as numpy boolean arrays.
    """
    if len(breakers) == 0:
        n = len(df)
        return np.zeros(n, dtype=np.bool_), np.zeros(n, dtype=np.bool_)

    b_types = breakers["type"].to_list()
    is_bull = np.array([t == "bullish_breaker" for t in b_types])

    return _compute_breaker_signals(
        df["close"].to_numpy(),
        breakers["top"].to_numpy(),
        breakers["bottom"].to_numpy(),
        breakers["broken_at"].to_numpy().astype(np.int64),
        is_bull,
        zone_age_limit,
        len(df),
    )


def detect_mitigation(df: pl.DataFrame, obs: pl.DataFrame) -> pl.DataFrame:
    """Detect Mitigation Blocks — partially filled Order Blocks."""
    empty = pl.DataFrame(schema={
        "index": pl.Int64, "top": pl.Float64, "bottom": pl.Float64,
        "type": pl.Utf8, "mitigated_at": pl.Int64, "penetration_pct": pl.Float64,
    })

    if len(obs) == 0:
        return empty

    highs = df["high"].to_numpy()
    lows_arr = df["low"].to_numpy()
    n = len(highs)
    records = []

    ob_indices = obs["index"].to_numpy()
    ob_types = obs["type"].to_list()
    ob_tops = obs["top"].to_numpy()
    ob_bottoms = obs["bottom"].to_numpy()

    for k in range(len(obs)):
        ob_idx = int(ob_indices[k])
        ob_type = ob_types[k]
        ob_top = float(ob_tops[k])
        ob_bottom = float(ob_bottoms[k])
        ob_range = ob_top - ob_bottom

        if ob_range <= 0 or ob_idx + 1 >= n:
            continue

        if ob_type == "bullish":
            tail = lows_arr[ob_idx + 1:]
            hits = np.where((tail <= ob_top) & (tail >= ob_bottom))[0]
            if len(hits) > 0:
                i = ob_idx + 1 + int(hits[0])
                penetration = (ob_top - lows_arr[i]) / ob_range
                records.append({
                    "index": ob_idx, "top": ob_top, "bottom": ob_bottom,
                    "type": "bullish_mitigation", "mitigated_at": i,
                    "penetration_pct": round(float(penetration) * 100, 1),
                })
        elif ob_type == "bearish":
            tail = highs[ob_idx + 1:]
            hits = np.where((tail >= ob_bottom) & (tail <= ob_top))[0]
            if len(hits) > 0:
                i = ob_idx + 1 + int(hits[0])
                penetration = (highs[i] - ob_bottom) / ob_range
                records.append({
                    "index": ob_idx, "top": ob_top, "bottom": ob_bottom,
                    "type": "bearish_mitigation", "mitigated_at": i,
                    "penetration_pct": round(float(penetration) * 100, 1),
                })

    return pl.DataFrame(records) if records else empty


def detect_rejection(df: pl.DataFrame) -> pl.DataFrame:
    """Detect Rejection Blocks — candles with long wicks (wick >= 2x body). Fully vectorized."""
    opens = df["open"].to_numpy()
    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()
    closes = df["close"].to_numpy()

    body = np.abs(closes - opens)
    upper_wick = highs - np.maximum(opens, closes)
    lower_wick = np.minimum(opens, closes) - lows

    nonzero = body > 0
    bearish_mask = nonzero & (upper_wick >= 2.0 * body) & (upper_wick > lower_wick)
    bullish_mask = nonzero & (lower_wick >= 2.0 * body) & (lower_wick > upper_wick)

    empty = pl.DataFrame(schema={
        "index": pl.Int64, "type": pl.Utf8,
        "wick_high": pl.Float64, "wick_low": pl.Float64, "body_size": pl.Float64,
    })

    b_idx = np.where(bearish_mask)[0]
    u_idx = np.where(bullish_mask)[0]

    if len(b_idx) == 0 and len(u_idx) == 0:
        return empty

    records = []
    for i in b_idx:
        records.append({"index": int(i), "type": "bearish",
                        "wick_high": float(highs[i]), "wick_low": float(np.maximum(opens[i], closes[i])),
                        "body_size": float(body[i])})
    for i in u_idx:
        records.append({"index": int(i), "type": "bullish",
                        "wick_high": float(np.minimum(opens[i], closes[i])), "wick_low": float(lows[i]),
                        "body_size": float(body[i])})

    return pl.DataFrame(records).sort("index")


def detect_propulsion(df: pl.DataFrame, obs: pl.DataFrame, fvgs: pl.DataFrame) -> pl.DataFrame:
    """Detect Propulsion Blocks — OBs with overlapping FVG."""
    empty = pl.DataFrame(schema={
        "index": pl.Int64, "top": pl.Float64, "bottom": pl.Float64,
        "type": pl.Utf8, "ob_index": pl.Int64, "fvg_index": pl.Int64,
    })

    if len(obs) == 0 or len(fvgs) == 0:
        return empty

    ob_tops = obs["top"].to_numpy()
    ob_bottoms = obs["bottom"].to_numpy()
    ob_indices = obs["index"].to_numpy()
    ob_types = obs["type"].to_list()

    fvg_tops = fvgs["top"].to_numpy()
    fvg_bottoms = fvgs["bottom"].to_numpy()
    fvg_indices = fvgs["index"].to_numpy()

    records = []
    for k in range(len(obs)):
        ob_idx = int(ob_indices[k])
        idx_mask = np.abs(fvg_indices.astype(float) - ob_idx) <= 5
        if not idx_mask.any():
            continue

        overlap_tops = np.minimum(ob_tops[k], fvg_tops[idx_mask])
        overlap_bottoms = np.maximum(ob_bottoms[k], fvg_bottoms[idx_mask])
        valid = overlap_tops > overlap_bottoms

        if valid.any():
            first = int(np.where(valid)[0][0])
            candidates = np.where(idx_mask)[0]
            fvg_i = int(candidates[first])
            records.append({
                "index": ob_idx, "top": float(overlap_tops[first]), "bottom": float(overlap_bottoms[first]),
                "type": ob_types[k] + "_propulsion", "ob_index": ob_idx, "fvg_index": int(fvg_indices[fvg_i]),
            })

    return pl.DataFrame(records) if records else empty
