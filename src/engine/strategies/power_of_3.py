"""ICT Power of 3 strategy — Accumulation (Asia), Manipulation (London), Distribution (NY).

One-sentence: Fade the London sweep of Asia range during NY AM session.
"""

from __future__ import annotations
import polars as pl
from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr
from src.engine.indicators.sessions import is_asia_killzone, is_london_killzone, is_nyam_killzone


class PowerOf3Strategy(BaseStrategy):
    name = "power_of_3"
    preferred_regime = None

    def __init__(self, atr_period: int = 14, sweep_buffer_pct: float = 0.1):
        self.atr_period = atr_period
        self.sweep_buffer_pct = sweep_buffer_pct
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
        nyam = is_nyam_killzone(df["ts_event"]).to_list()

        highs = df["high"].to_list()
        lows = df["low"].to_list()
        closes = df["close"].to_list()

        asia_high = None
        asia_low = None
        london_swept_high = False
        london_swept_low = False

        for i in range(len(df)):
            # Track Asia range
            if asia[i]:
                if asia_high is None:
                    asia_high = highs[i]
                    asia_low = lows[i]
                else:
                    asia_high = max(asia_high, highs[i])
                    asia_low = min(asia_low, lows[i])
                london_swept_high = False
                london_swept_low = False

            # Detect London sweep
            if london[i] and asia_high is not None:
                if highs[i] > asia_high:
                    london_swept_high = True
                if lows[i] < asia_low:
                    london_swept_low = True

            # NY entry: fade the London sweep
            if nyam[i] and asia_high is not None:
                if london_swept_high and closes[i] < asia_high:
                    entry_short[i] = True
                    london_swept_high = False  # consumed
                elif london_swept_low and closes[i] > asia_low:
                    entry_long[i] = True
                    london_swept_low = False

        result = result.with_columns([
            pl.Series("entry_long", entry_long),
            pl.Series("entry_short", entry_short),
            pl.Series("exit_long", exit_sig),
            pl.Series("exit_short", exit_sig),
            atr.alias(f"atr_{self.atr_period}"),
        ])
        return result

    def get_params(self) -> dict:
        return {"atr_period": self.atr_period, "sweep_buffer_pct": self.sweep_buffer_pct}

    def get_default_config(self) -> dict:
        return {"atr_period": 14, "sweep_buffer_pct": 0.1}
