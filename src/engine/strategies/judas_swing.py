"""ICT Judas Swing strategy — fake move at session open + MSS + FVG.

One-sentence: Fade the opening fake move after MSS confirms reversal, enter on FVG.
"""

from __future__ import annotations
import polars as pl
from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr
from src.engine.indicators.market_structure import detect_swings, detect_mss
from src.engine.indicators.price_delivery import detect_fvg
from src.engine.indicators.sessions import is_nyam_killzone


class JudasSwingStrategy(BaseStrategy):
    name = "judas_swing"
    preferred_regime = None

    def __init__(self, swing_lookback: int = 3, atr_period: int = 14, fvg_window: int = 5):
        self.swing_lookback = swing_lookback
        self.atr_period = atr_period
        self.fvg_window = fvg_window
        self.symbol = "ES"
        self.timeframe = "5min"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        result = df.clone()

        swings = detect_swings(df, self.swing_lookback)
        mss = detect_mss(df, swings)
        fvgs = detect_fvg(df)
        atr = compute_atr(df, self.atr_period)

        entry_long = [False] * len(df)
        entry_short = [False] * len(df)
        exit_sig = [False] * len(df)

        if "ts_event" in df.columns:
            nyam = is_nyam_killzone(df["ts_event"]).to_list()
        else:
            nyam = [True] * len(df)

        mss_list = mss.to_list()
        closes = df["close"].to_list()
        bullish_fvgs = fvgs.filter(pl.col("type") == "bullish")
        bearish_fvgs = fvgs.filter(pl.col("type") == "bearish")

        last_bullish_mss = -999
        last_bearish_mss = -999

        for i in range(len(df)):
            if mss_list[i] == "bullish":
                last_bullish_mss = i
            elif mss_list[i] == "bearish":
                last_bearish_mss = i

            if not nyam[i]:
                continue

            # Long: bullish MSS + FVG fill
            if (i - last_bullish_mss) <= self.fvg_window:
                for f_idx in range(len(bullish_fvgs)):
                    fvg_bar = int(bullish_fvgs["index"][f_idx])
                    if fvg_bar >= i or i - fvg_bar > self.fvg_window:
                        continue
                    top = float(bullish_fvgs["top"][f_idx])
                    bottom = float(bullish_fvgs["bottom"][f_idx])
                    if bottom <= closes[i] <= top:
                        entry_long[i] = True
                        break

            # Short: bearish MSS + FVG fill
            if (i - last_bearish_mss) <= self.fvg_window:
                for f_idx in range(len(bearish_fvgs)):
                    fvg_bar = int(bearish_fvgs["index"][f_idx])
                    if fvg_bar >= i or i - fvg_bar > self.fvg_window:
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
        return {"swing_lookback": self.swing_lookback, "atr_period": self.atr_period, "fvg_window": self.fvg_window}

    def get_default_config(self) -> dict:
        return {"swing_lookback": 3, "atr_period": 14, "fvg_window": 5}
