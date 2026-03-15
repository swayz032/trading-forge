"""ICT Turtle Soup strategy — liquidity sweep + FVG reversal.

One-sentence: Enter on FVG after price sweeps a liquidity level and reverses.
"""

from __future__ import annotations
import polars as pl
from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr
from src.engine.indicators.market_structure import detect_swings
from src.engine.indicators.price_delivery import detect_fvg
from src.engine.indicators.liquidity import detect_buyside_liquidity, detect_sellside_liquidity, detect_sweep


class TurtleSoupStrategy(BaseStrategy):
    name = "turtle_soup"
    preferred_regime = "RANGE_BOUND"

    def __init__(self, swing_lookback: int = 10, atr_period: int = 14, fvg_lookback: int = 5):
        self.swing_lookback = swing_lookback
        self.atr_period = atr_period
        self.fvg_lookback = fvg_lookback
        self.symbol = "ES"
        self.timeframe = "15min"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        result = df.clone()

        swings = detect_swings(df, self.swing_lookback)
        bsl = detect_buyside_liquidity(df, swings)
        ssl = detect_sellside_liquidity(df, swings)
        fvgs = detect_fvg(df)
        atr = compute_atr(df, self.atr_period)

        sweep_bsl = detect_sweep(df, bsl)
        sweep_ssl = detect_sweep(df, ssl)

        entry_long = [False] * len(df)
        entry_short = [False] * len(df)
        exit_sig = [False] * len(df)
        closes = df["close"].to_list()

        sweep_bsl_list = sweep_bsl.to_list()
        sweep_ssl_list = sweep_ssl.to_list()
        bullish_fvgs = fvgs.filter(pl.col("type") == "bullish")
        bearish_fvgs = fvgs.filter(pl.col("type") == "bearish")

        last_bsl_sweep = -999
        last_ssl_sweep = -999

        for i in range(len(df)):
            if sweep_bsl_list[i]:
                last_bsl_sweep = i
            if sweep_ssl_list[i]:
                last_ssl_sweep = i

            # Long: SSL sweep + bullish FVG fill
            if (i - last_ssl_sweep) <= self.fvg_lookback and last_ssl_sweep > 0:
                for f_idx in range(len(bullish_fvgs)):
                    fvg_bar = int(bullish_fvgs["index"][f_idx])
                    if fvg_bar >= i or i - fvg_bar > self.fvg_lookback:
                        continue
                    top = float(bullish_fvgs["top"][f_idx])
                    bottom = float(bullish_fvgs["bottom"][f_idx])
                    if bottom <= closes[i] <= top:
                        entry_long[i] = True
                        break

            # Short: BSL sweep + bearish FVG fill
            if (i - last_bsl_sweep) <= self.fvg_lookback and last_bsl_sweep > 0:
                for f_idx in range(len(bearish_fvgs)):
                    fvg_bar = int(bearish_fvgs["index"][f_idx])
                    if fvg_bar >= i or i - fvg_bar > self.fvg_lookback:
                        continue
                    top = float(bearish_fvgs["top"][f_idx])
                    bottom = float(bearish_fvgs["bottom"][f_idx])
                    if bottom <= closes[i] <= top:
                        entry_short[i] = True
                        break

        result = result.with_columns([
            pl.Series("entry_long", entry_long),
            pl.Series("entry_short", entry_short),
            pl.Series("exit_long", exit_sig),
            pl.Series("exit_short", exit_sig),
            atr.alias(f"atr_{self.atr_period}"),
        ])
        return result

    def get_params(self) -> dict:
        return {"swing_lookback": self.swing_lookback, "atr_period": self.atr_period, "fvg_lookback": self.fvg_lookback}

    def get_default_config(self) -> dict:
        return {"swing_lookback": 10, "atr_period": 14, "fvg_lookback": 5}
