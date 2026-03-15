"""Extract 13 premarket features for day archetype prediction."""

from __future__ import annotations

from typing import Any

PREMARKET_FEATURES = [
    "overnight_range_atr",       # Overnight session range / ATR
    "gap_size_atr",              # Gap from prev close to current open / ATR
    "prev_day_archetype",        # Yesterday's archetype (encoded)
    "prev_day_range_atr",        # Yesterday's range / ATR
    "vix_level",                 # Current VIX
    "vix_change_1d",             # VIX change from yesterday
    "volume_premarket_ratio",    # Pre-market volume / avg pre-market volume
    "day_of_week",               # 0-4 (Mon-Fri)
    "days_to_fomc",              # Days until next FOMC
    "days_to_opex",              # Days until options expiration
    "prev_close_vs_vwap",        # Prev close relative to VWAP
    "atr_percentile_20d",        # Current ATR percentile vs 20-day history
    "consecutive_same_type",     # How many days in a row of same archetype
]

# Encoding map for prev_day_archetype (ordinal)
_ARCHETYPE_ENCODING: dict[str, float] = {
    "TREND_DAY_UP": 0.0,
    "TREND_DAY_DOWN": 1.0,
    "RANGE_DAY": 2.0,
    "REVERSAL_DAY": 3.0,
    "EXPANSION_DAY": 4.0,
    "GRIND_DAY": 5.0,
    "GAP_AND_GO": 6.0,
    "INSIDE_DAY": 7.0,
}


def extract_features(
    current_premarket: dict[str, Any],
    prev_day: dict[str, Any],
    historical_context: dict[str, Any] | None = None,
) -> dict[str, float]:
    """
    Extract all 13 premarket features.

    Args:
        current_premarket: {
            open, overnight_high, overnight_low,
            premarket_volume, avg_premarket_volume,
            day_of_week (0-4), vix, prev_vix
        }
        prev_day: {
            open, high, low, close, volume, vwap (optional),
            archetype (optional), atr (optional)
        }
        historical_context: {
            days_to_fomc, days_to_opex,
            atr_history_20d (list of floats),
            consecutive_same_type (int)
        }

    Returns:
        dict of {feature_name: value} for the predictor.
    """
    ctx = historical_context or {}

    atr = float(prev_day.get("atr", 1.0)) or 1.0

    # Overnight range
    o_high = float(current_premarket.get("overnight_high", 0))
    o_low = float(current_premarket.get("overnight_low", 0))
    overnight_range = (o_high - o_low) if o_high and o_low else 0.0
    overnight_range_atr = overnight_range / atr

    # Gap
    cur_open = float(current_premarket.get("open", 0))
    prev_close = float(prev_day.get("close", 0))
    gap = abs(cur_open - prev_close) if cur_open and prev_close else 0.0
    gap_size_atr = gap / atr

    # Previous day range / ATR
    prev_h = float(prev_day.get("high", 0))
    prev_l = float(prev_day.get("low", 0))
    prev_range = prev_h - prev_l if prev_h and prev_l else 0.0
    prev_day_range_atr = prev_range / atr

    # Previous day archetype
    prev_arch = prev_day.get("archetype", "RANGE_DAY")
    prev_day_archetype = _ARCHETYPE_ENCODING.get(str(prev_arch), 2.0)

    # VIX
    vix = float(current_premarket.get("vix", 20.0))
    prev_vix = float(current_premarket.get("prev_vix", vix))
    vix_change = vix - prev_vix

    # Volume ratio
    pm_vol = float(current_premarket.get("premarket_volume", 1.0))
    avg_pm_vol = float(current_premarket.get("avg_premarket_volume", 1.0)) or 1.0
    volume_premarket_ratio = pm_vol / avg_pm_vol

    # Calendar
    day_of_week = float(current_premarket.get("day_of_week", 0))
    days_to_fomc = float(ctx.get("days_to_fomc", 30))
    days_to_opex = float(ctx.get("days_to_opex", 30))

    # Prev close vs VWAP
    prev_vwap = float(prev_day.get("vwap", prev_close)) or prev_close
    prev_close_vs_vwap = (prev_close - prev_vwap) / atr if prev_close and prev_vwap else 0.0

    # ATR percentile (rank current ATR within 20d history)
    atr_hist = ctx.get("atr_history_20d", [])
    if atr_hist and len(atr_hist) > 0:
        below = sum(1 for a in atr_hist if float(a) <= atr)
        atr_percentile = below / len(atr_hist)
    else:
        atr_percentile = 0.5

    # Consecutive same type
    consecutive = float(ctx.get("consecutive_same_type", 0))

    return {
        "overnight_range_atr": round(overnight_range_atr, 4),
        "gap_size_atr": round(gap_size_atr, 4),
        "prev_day_archetype": prev_day_archetype,
        "prev_day_range_atr": round(prev_day_range_atr, 4),
        "vix_level": round(vix, 2),
        "vix_change_1d": round(vix_change, 2),
        "volume_premarket_ratio": round(volume_premarket_ratio, 4),
        "day_of_week": day_of_week,
        "days_to_fomc": days_to_fomc,
        "days_to_opex": days_to_opex,
        "prev_close_vs_vwap": round(prev_close_vs_vwap, 4),
        "atr_percentile_20d": round(atr_percentile, 4),
        "consecutive_same_type": consecutive,
    }
