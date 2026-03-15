"""ICT OTE strategy — BOS + Fibonacci OTE zone + FVG.

One-sentence: After BOS, enter at the OTE zone (0.618-0.786 fib) when an FVG forms there.
"""

from __future__ import annotations
import polars as pl
from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr
from src.engine.indicators.market_structure import detect_swings, detect_bos
from src.engine.indicators.price_delivery import detect_fvg
from src.engine.indicators.fibonacci import ote_zone


class OTEStrategy(BaseStrategy):
    name = "ote_strategy"
    preferred_regime = "TRENDING_UP"

    def __init__(self, swing_lookback: int = 10, atr_period: int = 14, ote_lookback: int = 15):
        self.swing_lookback = swing_lookback
        self.atr_period = atr_period
        self.ote_lookback = ote_lookback
        self.symbol = "ES"
        self.timeframe = "15min"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        result = df.clone()

        swings = detect_swings(df, self.swing_lookback)
        bos = detect_bos(df, swings)
        fvgs = detect_fvg(df)
        atr = compute_atr(df, self.atr_period)

        entry_long = [False] * len(df)
        entry_short = [False] * len(df)
        exit_sig = [False] * len(df)
        closes = df["close"].to_list()
        bos_list = bos.to_list()

        swing_highs = swings.filter(pl.col("type") == "high").sort("index")
        swing_lows = swings.filter(pl.col("type") == "low").sort("index")
        sh_prices = swing_highs["price"].to_list() if len(swing_highs) > 0 else []
        sh_indices = swing_highs["index"].to_list() if len(swing_highs) > 0 else []
        sl_prices = swing_lows["price"].to_list() if len(swing_lows) > 0 else []
        sl_indices = swing_lows["index"].to_list() if len(swing_lows) > 0 else []

        last_bullish_bos = -999
        last_bearish_bos = -999

        bullish_fvgs = fvgs.filter(pl.col("type") == "bullish")
        bearish_fvgs = fvgs.filter(pl.col("type") == "bearish")

        for i in range(len(df)):
            if bos_list[i] == "bullish":
                last_bullish_bos = i
            elif bos_list[i] == "bearish":
                last_bearish_bos = i

            # Long: after bullish BOS, price in OTE zone + FVG
            if (i - last_bullish_bos) <= self.ote_lookback and last_bullish_bos > 0:
                # Find recent swing high/low for OTE calc
                recent_sh = None
                recent_sl = None
                for j in range(len(sh_indices) - 1, -1, -1):
                    if sh_indices[j] <= i:
                        recent_sh = sh_prices[j]
                        break
                for j in range(len(sl_indices) - 1, -1, -1):
                    if sl_indices[j] <= i:
                        recent_sl = sl_prices[j]
                        break

                if recent_sh is not None and recent_sl is not None:
                    ote_upper, ote_lower = ote_zone(recent_sh, recent_sl)
                    if ote_lower <= closes[i] <= ote_upper:
                        # Check for FVG in zone
                        for f_idx in range(len(bullish_fvgs)):
                            fvg_bar = int(bullish_fvgs["index"][f_idx])
                            if fvg_bar >= i or i - fvg_bar > 10:
                                continue
                            top = float(bullish_fvgs["top"][f_idx])
                            bottom = float(bullish_fvgs["bottom"][f_idx])
                            if bottom <= closes[i] <= top:
                                entry_long[i] = True
                                break

            # Short: after bearish BOS, price in OTE zone + FVG
            if (i - last_bearish_bos) <= self.ote_lookback and last_bearish_bos > 0:
                recent_sh = None
                recent_sl = None
                for j in range(len(sh_indices) - 1, -1, -1):
                    if sh_indices[j] <= i:
                        recent_sh = sh_prices[j]
                        break
                for j in range(len(sl_indices) - 1, -1, -1):
                    if sl_indices[j] <= i:
                        recent_sl = sl_prices[j]
                        break

                if recent_sh is not None and recent_sl is not None:
                    ote_upper, ote_lower = ote_zone(recent_sh, recent_sl)
                    if ote_lower <= closes[i] <= ote_upper:
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
        return {"swing_lookback": self.swing_lookback, "atr_period": self.atr_period, "ote_lookback": self.ote_lookback}

    def get_default_config(self) -> dict:
        return {"swing_lookback": 10, "atr_period": 14, "ote_lookback": 15}
