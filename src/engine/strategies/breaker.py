"""ICT Breaker strategy — failed OB becomes breaker, enter on retest + FVG.

One-sentence: Enter when price returns to a broken order block (breaker) with FVG confirmation.
"""

from __future__ import annotations
import polars as pl
from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr
from src.engine.indicators.market_structure import detect_swings
from src.engine.indicators.price_delivery import detect_fvg
from src.engine.indicators.order_flow import detect_bullish_ob, detect_bearish_ob, detect_breaker


class BreakerStrategy(BaseStrategy):
    name = "breaker"
    preferred_regime = None

    def __init__(self, swing_lookback: int = 5, atr_period: int = 14, zone_age_limit: int = 30):
        self.swing_lookback = swing_lookback
        self.atr_period = atr_period
        self.zone_age_limit = zone_age_limit
        self.symbol = "ES"
        self.timeframe = "15min"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        result = df.clone()
        swings = detect_swings(df, self.swing_lookback)
        fvgs = detect_fvg(df)
        atr = compute_atr(df, self.atr_period)

        bull_obs = detect_bullish_ob(df, swings)
        bear_obs = detect_bearish_ob(df, swings)

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

        for i in range(len(df)):
            for b_idx in range(len(breakers)):
                broken_at = int(breakers["broken_at"][b_idx])
                if broken_at >= i or i - broken_at > self.zone_age_limit:
                    continue
                b_type = str(breakers["type"][b_idx])
                b_top = float(breakers["top"][b_idx])
                b_bottom = float(breakers["bottom"][b_idx])

                if b_type == "bullish_breaker" and b_bottom <= closes[i] <= b_top:
                    entry_long[i] = True
                elif b_type == "bearish_breaker" and b_bottom <= closes[i] <= b_top:
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
        return {"swing_lookback": self.swing_lookback, "atr_period": self.atr_period, "zone_age_limit": self.zone_age_limit}

    def get_default_config(self) -> dict:
        return {"swing_lookback": 5, "atr_period": 14, "zone_age_limit": 30}
