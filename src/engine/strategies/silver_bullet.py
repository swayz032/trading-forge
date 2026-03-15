"""ICT Silver Bullet strategy — FVG entries during killzones.

One-sentence: Enter on FVG fill during NY AM or London killzone with ATR stop.
"""

from __future__ import annotations

import polars as pl

from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr
from src.engine.indicators.price_delivery import detect_fvg
from src.engine.indicators.sessions import is_nyam_killzone, is_london_killzone


class SilverBulletStrategy(BaseStrategy):
    name = "silver_bullet"
    preferred_regime = None  # works in trending and ranging

    def __init__(self, lookback: int = 5, atr_period: int = 14, atr_sl_mult: float = 2.0):
        self.lookback = lookback
        self.atr_period = atr_period
        self.atr_sl_mult = atr_sl_mult
        self.symbol = "ES"
        self.timeframe = "5min"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        result = df.clone()

        # Session filters
        if "ts_event" in df.columns:
            nyam = is_nyam_killzone(df["ts_event"])
            london = is_london_killzone(df["ts_event"])
            in_killzone = nyam | london
        else:
            in_killzone = pl.Series("kz", [True] * len(df))

        # Detect FVGs
        fvgs = detect_fvg(df)
        atr = compute_atr(df, self.atr_period)

        # Build signal arrays
        entry_long = [False] * len(df)
        entry_short = [False] * len(df)
        exit_sig = [False] * len(df)

        closes = df["close"].to_list()
        kz_list = in_killzone.to_list()

        bullish_fvgs = fvgs.filter(pl.col("type") == "bullish")
        bearish_fvgs = fvgs.filter(pl.col("type") == "bearish")

        # Check each bar for FVG fill during killzone
        for i in range(len(df)):
            if not kz_list[i]:
                continue

            close = closes[i]

            # Bullish FVG fill: price comes down into bullish FVG zone
            for f_idx in range(len(bullish_fvgs)):
                fvg_bar = int(bullish_fvgs["index"][f_idx])
                if fvg_bar >= i:
                    continue
                if i - fvg_bar > self.lookback:
                    continue
                top = float(bullish_fvgs["top"][f_idx])
                bottom = float(bullish_fvgs["bottom"][f_idx])
                if bottom <= close <= top:
                    entry_long[i] = True
                    break

            # Bearish FVG fill
            for f_idx in range(len(bearish_fvgs)):
                fvg_bar = int(bearish_fvgs["index"][f_idx])
                if fvg_bar >= i:
                    continue
                if i - fvg_bar > self.lookback:
                    continue
                top = float(bearish_fvgs["top"][f_idx])
                bottom = float(bearish_fvgs["bottom"][f_idx])
                if bottom <= close <= top:
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
        return {"lookback": self.lookback, "atr_period": self.atr_period, "atr_sl_mult": self.atr_sl_mult}

    def get_default_config(self) -> dict:
        return {"lookback": 5, "atr_period": 14, "atr_sl_mult": 2.0}
