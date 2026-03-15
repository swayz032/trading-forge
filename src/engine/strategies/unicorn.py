"""ICT Unicorn strategy — Breaker Block + FVG overlap.

One-sentence: Enter when price returns to a breaker block that overlaps with an FVG.
"""

from __future__ import annotations

import polars as pl

from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr
from src.engine.indicators.market_structure import detect_swings
from src.engine.indicators.price_delivery import detect_fvg
from src.engine.indicators.order_flow import detect_bullish_ob, detect_bearish_ob, detect_breaker


class UnicornStrategy(BaseStrategy):
    name = "unicorn"
    preferred_regime = "TRENDING_UP"

    def __init__(self, swing_lookback: int = 5, atr_period: int = 14, max_zone_age: int = 20):
        self.swing_lookback = swing_lookback
        self.atr_period = atr_period
        self.max_zone_age = max_zone_age
        self.symbol = "ES"
        self.timeframe = "15min"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        result = df.clone()

        swings = detect_swings(df, self.swing_lookback)
        fvgs = detect_fvg(df)
        atr = compute_atr(df, self.atr_period)

        # Get order blocks and breakers
        bull_obs = detect_bullish_ob(df, swings)
        bear_obs = detect_bearish_ob(df, swings)

        # Combine OBs
        all_obs_list = []
        if len(bull_obs) > 0:
            all_obs_list.append(bull_obs)
        if len(bear_obs) > 0:
            all_obs_list.append(bear_obs)

        if all_obs_list:
            all_obs = pl.concat(all_obs_list)
            breakers = detect_breaker(df, all_obs)
        else:
            breakers = pl.DataFrame(schema={
                "index": pl.Int64, "top": pl.Float64, "bottom": pl.Float64,
                "type": pl.Utf8, "broken_at": pl.Int64,
            })

        entry_long = [False] * len(df)
        entry_short = [False] * len(df)
        exit_sig = [False] * len(df)
        closes = df["close"].to_list()

        # Find breaker + FVG overlaps
        for i in range(len(df)):
            close = closes[i]

            for b_idx in range(len(breakers)):
                b_bar = int(breakers["index"][b_idx])
                b_type = str(breakers["type"][b_idx])
                b_top = float(breakers["top"][b_idx])
                b_bottom = float(breakers["bottom"][b_idx])

                if i - b_bar > self.max_zone_age:
                    continue
                if b_bar >= i:
                    continue

                # Check if any FVG overlaps with this breaker
                has_fvg_overlap = False
                for f_idx in range(len(fvgs)):
                    f_top = float(fvgs["top"][f_idx])
                    f_bottom = float(fvgs["bottom"][f_idx])
                    overlap = min(b_top, f_top) > max(b_bottom, f_bottom)
                    if overlap:
                        has_fvg_overlap = True
                        break

                if not has_fvg_overlap:
                    continue

                # Entry: price returns to breaker zone
                if b_type == "bullish_breaker" and b_bottom <= close <= b_top:
                    entry_long[i] = True
                elif b_type == "bearish_breaker" and b_bottom <= close <= b_top:
                    entry_short[i] = True

        result = result.with_columns([
            pl.Series("entry_long", entry_long),
            pl.Series("entry_short", entry_short),
            pl.Series("exit_long", exit_sig),
            pl.Series("exit_short", exit_sig),
            atr.alias(f"atr_{self.atr_period}"),
        ])
        return result

    def get_params(self) -> dict:
        return {"swing_lookback": self.swing_lookback, "atr_period": self.atr_period, "max_zone_age": self.max_zone_age}

    def get_default_config(self) -> dict:
        return {"swing_lookback": 5, "atr_period": 14, "max_zone_age": 20}
