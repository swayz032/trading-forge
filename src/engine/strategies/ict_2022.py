"""ICT 2022 Model strategy — HTF bias + LTF MSS + FVG entry.

One-sentence: Trade LTF MSS + FVG in direction of HTF premium/discount bias.
"""

from __future__ import annotations

import polars as pl

from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr
from src.engine.indicators.market_structure import detect_swings, detect_mss, compute_premium_discount
from src.engine.indicators.price_delivery import detect_fvg


class ICT2022Strategy(BaseStrategy):
    name = "ict_2022"
    preferred_regime = "TRENDING_UP"

    def __init__(self, htf_lookback: int = 20, ltf_lookback: int = 5, atr_period: int = 14):
        self.htf_lookback = htf_lookback
        self.ltf_lookback = ltf_lookback
        self.atr_period = atr_period
        self.symbol = "ES"
        self.timeframe = "5min"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        result = df.clone()

        # HTF structure for bias (using larger lookback)
        htf_swings = detect_swings(df, self.htf_lookback)
        pd_zones = compute_premium_discount(df, htf_swings)

        # LTF structure for entry timing
        ltf_swings = detect_swings(df, self.ltf_lookback)
        mss = detect_mss(df, ltf_swings)
        fvgs = detect_fvg(df)
        atr = compute_atr(df, self.atr_period)

        entry_long = [False] * len(df)
        entry_short = [False] * len(df)
        exit_sig = [False] * len(df)

        pd_list = pd_zones.to_list()
        mss_list = mss.to_list()
        closes = df["close"].to_list()

        bullish_fvgs = fvgs.filter(pl.col("type") == "bullish")
        bearish_fvgs = fvgs.filter(pl.col("type") == "bearish")

        # Track recent MSS signals
        last_bullish_mss = -999
        last_bearish_mss = -999

        for i in range(len(df)):
            if mss_list[i] == "bullish":
                last_bullish_mss = i
            elif mss_list[i] == "bearish":
                last_bearish_mss = i

            # Long: discount zone + recent bullish MSS + FVG fill
            if pd_list[i] == "discount" and (i - last_bullish_mss) <= 10:
                for f_idx in range(len(bullish_fvgs)):
                    fvg_bar = int(bullish_fvgs["index"][f_idx])
                    if fvg_bar >= i or i - fvg_bar > 10:
                        continue
                    top = float(bullish_fvgs["top"][f_idx])
                    bottom = float(bullish_fvgs["bottom"][f_idx])
                    if bottom <= closes[i] <= top:
                        entry_long[i] = True
                        break

            # Short: premium zone + recent bearish MSS + FVG fill
            elif pd_list[i] == "premium" and (i - last_bearish_mss) <= 10:
                for f_idx in range(len(bearish_fvgs)):
                    fvg_bar = int(bearish_fvgs["index"][f_idx])
                    if fvg_bar >= i or i - fvg_bar > 10:
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
        return {"htf_lookback": self.htf_lookback, "ltf_lookback": self.ltf_lookback, "atr_period": self.atr_period}

    def get_default_config(self) -> dict:
        return {"htf_lookback": 20, "ltf_lookback": 5, "atr_period": 14}
