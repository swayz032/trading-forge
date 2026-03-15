"""ICT NY Lunch Reversal strategy — MSS during lunch session after strong AM move.

One-sentence: Enter on Market Structure Shift during NY lunch (12-13 ET) when the
morning move exceeded a minimum ATR threshold, fading the AM direction.
"""

from __future__ import annotations

import polars as pl

from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr
from src.engine.indicators.market_structure import detect_swings, detect_mss
from src.engine.indicators.sessions import is_ny_lunch, is_nypm_killzone


class NYLunchReversalStrategy(BaseStrategy):
    name = "ny_lunch_reversal"
    preferred_regime = None  # works in all regimes

    def __init__(
        self,
        lookback: int = 5,
        displacement_mult: float = 1.5,
        min_am_move_atr: float = 2.0,
    ):
        self.lookback = lookback
        self.displacement_mult = displacement_mult
        self.min_am_move_atr = min_am_move_atr
        self.symbol = "ES"
        self.timeframe = "5min"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        result = df.clone()
        n = len(df)

        # Edge case: not enough data
        if n < self.lookback * 2 + 1:
            return result.with_columns([
                pl.lit(False).alias("entry_long"),
                pl.lit(False).alias("entry_short"),
                pl.lit(False).alias("exit_long"),
                pl.lit(False).alias("exit_short"),
            ])

        # Compute indicators
        atr = compute_atr(df, 14)
        swings = detect_swings(df, self.lookback)
        mss = detect_mss(df, swings, self.displacement_mult)

        # Session filters
        if "ts_event" in df.columns:
            lunch_mask = is_ny_lunch(df["ts_event"])
            nypm_mask = is_nypm_killzone(df["ts_event"])
            hour = df["ts_event"].cast(pl.Datetime("us")).dt.hour()
        else:
            lunch_mask = pl.Series("ny_lunch", [True] * n)
            nypm_mask = pl.Series("nypm", [False] * n)
            hour = pl.Series("hour", [12] * n)

        # Build signal arrays
        entry_long = [False] * n
        entry_short = [False] * n
        exit_long = [False] * n
        exit_short = [False] * n

        mss_list = mss.to_list()
        lunch_list = lunch_mask.to_list()
        nypm_list = nypm_mask.to_list()
        atr_list = atr.to_list()
        hour_list = hour.to_list()
        highs = df["high"].to_list()
        lows = df["low"].to_list()

        for i in range(self.lookback * 2, n):
            if not lunch_list[i]:
                continue

            # Measure the AM move: high-low range from 8:00 AM to current bar
            # Find the range of bars in the morning session (hour 8-11)
            am_high = None
            am_low = None
            for j in range(max(0, i - 120), i):  # look back up to 120 bars (~10 hrs on 5m)
                h = hour_list[j]
                if h is not None and 8 <= h < 12:
                    bar_high = highs[j]
                    bar_low = lows[j]
                    if am_high is None or bar_high > am_high:
                        am_high = bar_high
                    if am_low is None or bar_low < am_low:
                        am_low = bar_low

            if am_high is None or am_low is None:
                continue

            am_range = am_high - am_low
            atr_val = atr_list[i]
            if atr_val is None or atr_val != atr_val:  # NaN check
                continue

            # AM move must exceed threshold
            if am_range < self.min_am_move_atr * atr_val:
                continue

            # Check for MSS during lunch
            if mss_list[i] == "bullish":
                # Bullish MSS during lunch = AM was bearish, now reversing up
                entry_long[i] = True
            elif mss_list[i] == "bearish":
                # Bearish MSS during lunch = AM was bullish, now reversing down
                entry_short[i] = True

        # Exit: end of NY PM session or opposing signal
        in_position_long = False
        in_position_short = False
        for i in range(n):
            if entry_long[i]:
                in_position_long = True
                in_position_short = False
            elif entry_short[i]:
                in_position_short = True
                in_position_long = False

            # Exit at end of PM session (hour >= 16) or opposing entry
            if in_position_long:
                h = hour_list[i]
                if h is not None and h >= 16:
                    exit_long[i] = True
                    in_position_long = False
                elif entry_short[i]:
                    exit_long[i] = True
                    in_position_long = False

            if in_position_short:
                h = hour_list[i]
                if h is not None and h >= 16:
                    exit_short[i] = True
                    in_position_short = False
                elif entry_long[i]:
                    exit_short[i] = True
                    in_position_short = False

        result = result.with_columns([
            pl.Series("entry_long", entry_long),
            pl.Series("entry_short", entry_short),
            pl.Series("exit_long", exit_long),
            pl.Series("exit_short", exit_short),
            atr.alias("atr_14"),
            mss.alias("mss"),
        ])

        return result

    def get_params(self) -> dict:
        return {
            "lookback": self.lookback,
            "displacement_mult": self.displacement_mult,
            "min_am_move_atr": self.min_am_move_atr,
        }

    def get_default_config(self) -> dict:
        return {
            "lookback": 5,
            "displacement_mult": 1.5,
            "min_am_move_atr": 2.0,
        }
