"""ICT London Raid strategy — Asia range sweep + London reversal.

One-sentence: Enter when London sweeps Asia session high/low and reverses with displacement.
"""

from __future__ import annotations
import polars as pl
from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr
from src.engine.indicators.sessions import is_asia_killzone, is_london_killzone


class LondonRaidStrategy(BaseStrategy):
    name = "london_raid"
    preferred_regime = None

    def __init__(self, atr_period: int = 14, displacement_mult: float = 1.5):
        self.atr_period = atr_period
        self.displacement_mult = displacement_mult
        self.symbol = "ES"
        self.timeframe = "5min"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        result = df.clone()
        atr = compute_atr(df, self.atr_period)

        entry_long = [False] * len(df)
        entry_short = [False] * len(df)
        exit_sig = [False] * len(df)

        if "ts_event" not in df.columns:
            result = result.with_columns([
                pl.Series("entry_long", entry_long),
                pl.Series("entry_short", entry_short),
                pl.Series("exit_long", exit_sig),
                pl.Series("exit_short", exit_sig),
                atr.alias(f"atr_{self.atr_period}"),
            ])
            return result

        asia = is_asia_killzone(df["ts_event"]).to_list()
        london = is_london_killzone(df["ts_event"]).to_list()
        highs = df["high"].to_list()
        lows = df["low"].to_list()
        opens = df["open"].to_list()
        closes = df["close"].to_list()
        atr_list = atr.to_list()

        asia_high = None
        asia_low = None

        for i in range(len(df)):
            if asia[i]:
                if asia_high is None:
                    asia_high = highs[i]
                    asia_low = lows[i]
                else:
                    asia_high = max(asia_high, highs[i])
                    asia_low = min(asia_low, lows[i])

            if london[i] and asia_high is not None:
                atr_val = atr_list[i]
                if atr_val is None or atr_val != atr_val:
                    continue
                body = abs(closes[i] - opens[i])
                displacement = body > self.displacement_mult * atr_val

                # Sweep high + bearish displacement → short
                if highs[i] > asia_high and closes[i] < opens[i] and displacement:
                    entry_short[i] = True
                # Sweep low + bullish displacement → long
                elif lows[i] < asia_low and closes[i] > opens[i] and displacement:
                    entry_long[i] = True

        result = result.with_columns([
            pl.Series("entry_long", entry_long),
            pl.Series("entry_short", entry_short),
            pl.Series("exit_long", exit_sig),
            pl.Series("exit_short", exit_sig),
            atr.alias(f"atr_{self.atr_period}"),
        ])
        return result

    def get_params(self) -> dict:
        return {"atr_period": self.atr_period, "displacement_mult": self.displacement_mult}

    def get_default_config(self) -> dict:
        return {"atr_period": 14, "displacement_mult": 1.5}
