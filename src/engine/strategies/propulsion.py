"""ICT Propulsion Block strategy — OB + FVG overlap creates high-probability entry zone.

One-sentence: Enter when price returns to a propulsion block (order block overlapping with an FVG),
a high-confidence institutional zone.
"""

from __future__ import annotations

import polars as pl

from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.market_structure import detect_swings
from src.engine.indicators.order_flow import detect_bullish_ob, detect_bearish_ob, detect_propulsion
from src.engine.indicators.price_delivery import detect_fvg
from src.engine.indicators.core import compute_atr


class PropulsionStrategy(BaseStrategy):
    """Propulsion Block — OB + FVG overlap, enter on return to zone.

    A propulsion block forms when an order block overlaps with an FVG,
    creating a stronger area of institutional interest. Entry triggers
    when price returns to the propulsion zone.

    Params (3):
        lookback: swing detection sensitivity
        fvg_min_size: minimum FVG size in points to filter noise
        ob_max_age: max bars since OB formation for it to remain valid
    """

    name = "propulsion"
    preferred_regime = "TRENDING_UP"

    def __init__(
        self,
        lookback: int = 5,
        fvg_min_size: float = 1.0,
        ob_max_age: int = 50,
    ):
        self.lookback = lookback
        self.fvg_min_size = fvg_min_size
        self.ob_max_age = ob_max_age
        self.symbol = "ES"
        self.timeframe = "15min"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        n = len(df)

        # Edge case: not enough data
        if n < 2 * self.lookback + 10:
            return df.with_columns([
                pl.lit(False).alias("entry_long"),
                pl.lit(False).alias("entry_short"),
                pl.lit(False).alias("exit_long"),
                pl.lit(False).alias("exit_short"),
            ])

        swings = detect_swings(df, self.lookback)
        fvgs_raw = detect_fvg(df)
        atr = compute_atr(df, 14)

        # Filter FVGs by minimum size
        if len(fvgs_raw) > 0:
            fvgs = fvgs_raw.filter(
                (pl.col("top") - pl.col("bottom")) >= self.fvg_min_size
            )
        else:
            fvgs = fvgs_raw

        bull_obs = detect_bullish_ob(df, swings)
        bear_obs = detect_bearish_ob(df, swings)

        # Detect propulsion blocks for bullish and bearish sides separately.
        bull_propulsions = _safe_propulsion(df, bull_obs, fvgs, "bullish")
        bear_propulsions = _safe_propulsion(df, bear_obs, fvgs, "bearish")

        closes = df["close"].to_list()
        lows = df["low"].to_list()
        highs = df["high"].to_list()

        entry_long = [False] * n
        entry_short = [False] * n
        exit_long = [False] * n
        exit_short = [False] * n

        # Pre-extract propulsion zone data for fast iteration.
        bull_zones = _extract_zones(bull_propulsions)
        bear_zones = _extract_zones(bear_propulsions)

        for i in range(n):
            # Entry long: price returns to bullish propulsion zone
            for z_idx, z_top, z_bottom, z_form_idx in bull_zones:
                age = i - z_form_idx
                if age <= 0 or age > self.ob_max_age:
                    continue
                # Price dips into the zone
                if lows[i] <= z_top and closes[i] >= z_bottom:
                    entry_long[i] = True
                    break

            # Entry short: price returns to bearish propulsion zone
            for z_idx, z_top, z_bottom, z_form_idx in bear_zones:
                age = i - z_form_idx
                if age <= 0 or age > self.ob_max_age:
                    continue
                # Price rallies into the zone
                if highs[i] >= z_bottom and closes[i] <= z_top:
                    entry_short[i] = True
                    break

            # Exit long: price moves beyond zone by 2x zone size OR opposing propulsion
            if entry_short[i]:
                exit_long[i] = True
            for z_idx, z_top, z_bottom, z_form_idx in bull_zones:
                zone_size = z_top - z_bottom
                if zone_size > 0 and closes[i] < z_bottom - 2.0 * zone_size:
                    exit_long[i] = True
                    break

            # Exit short: price moves beyond zone by 2x OR opposing propulsion
            if entry_long[i]:
                exit_short[i] = True
            for z_idx, z_top, z_bottom, z_form_idx in bear_zones:
                zone_size = z_top - z_bottom
                if zone_size > 0 and closes[i] > z_top + 2.0 * zone_size:
                    exit_short[i] = True
                    break

        result = df.with_columns([
            pl.Series("entry_long", entry_long),
            pl.Series("entry_short", entry_short),
            pl.Series("exit_long", exit_long),
            pl.Series("exit_short", exit_short),
            atr.alias("atr_14"),
        ])
        return result

    def get_params(self) -> dict:
        return {
            "lookback": self.lookback,
            "fvg_min_size": self.fvg_min_size,
            "ob_max_age": self.ob_max_age,
        }

    def get_default_config(self) -> dict:
        return {
            "lookback": 5,
            "fvg_min_size": 1.0,
            "ob_max_age": 50,
        }


# ─── Helpers ──────────────────────────────────────────────────────


def _safe_propulsion(
    df: pl.DataFrame,
    obs: pl.DataFrame,
    fvgs: pl.DataFrame,
    side: str,
) -> pl.DataFrame:
    """Run detect_propulsion only if we have OBs and FVGs on the right side."""
    if len(obs) == 0 or len(fvgs) == 0:
        return pl.DataFrame(schema={
            "index": pl.Int64, "top": pl.Float64, "bottom": pl.Float64,
            "type": pl.Utf8, "ob_index": pl.Int64, "fvg_index": pl.Int64,
        })

    # Filter FVGs to matching side
    side_fvgs = fvgs.filter(pl.col("type") == side)
    if len(side_fvgs) == 0:
        return pl.DataFrame(schema={
            "index": pl.Int64, "top": pl.Float64, "bottom": pl.Float64,
            "type": pl.Utf8, "ob_index": pl.Int64, "fvg_index": pl.Int64,
        })

    return detect_propulsion(df, obs, side_fvgs)


def _extract_zones(
    propulsions: pl.DataFrame,
) -> list[tuple[int, float, float, int]]:
    """Extract propulsion zones as a list of (index, top, bottom, formation_index)."""
    if len(propulsions) == 0:
        return []
    return [
        (
            int(propulsions["index"][i]),
            float(propulsions["top"][i]),
            float(propulsions["bottom"][i]),
            int(propulsions["index"][i]),
        )
        for i in range(len(propulsions))
    ]
