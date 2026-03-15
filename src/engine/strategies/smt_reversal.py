"""ICT SMT Reversal strategy — single-instrument swing failure as proxy for SMT divergence.

One-sentence: Enter on swing high/low failure (price makes new extreme but momentum doesn't confirm),
confirmed by Market Structure Shift, as a single-instrument proxy for cross-instrument SMT divergence.
"""

from __future__ import annotations

import polars as pl

from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.market_structure import detect_swings, detect_mss
from src.engine.indicators.core import compute_atr, compute_rsi


class SMTReversalStrategy(BaseStrategy):
    """SMT Reversal — swing failure + MSS confirmation.

    Since compute() only receives one DataFrame, we approximate SMT divergence
    using a single-instrument approach: detect swing high/low failures where
    price makes a new extreme but RSI momentum diverges (doesn't confirm).
    The full cross-instrument SMT via smt_divergence() is used externally.

    Params (3):
        lookback: window for detecting new highs/lows (SMT divergence proxy)
        swing_lookback: swing detection sensitivity
        confirmation_bars: max bars to wait for MSS after divergence
    """

    name = "smt_reversal"
    preferred_regime = None  # divergence IS the regime signal

    def __init__(
        self,
        lookback: int = 20,
        swing_lookback: int = 5,
        confirmation_bars: int = 5,
    ):
        self.lookback = lookback
        self.swing_lookback = swing_lookback
        self.confirmation_bars = confirmation_bars
        self.symbol = "ES"
        self.timeframe = "15min"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        n = len(df)

        # Edge case: not enough data
        if n < self.lookback + self.swing_lookback + 10:
            return df.with_columns([
                pl.lit(False).alias("entry_long"),
                pl.lit(False).alias("entry_short"),
                pl.lit(False).alias("exit_long"),
                pl.lit(False).alias("exit_short"),
            ])

        swings = detect_swings(df, self.swing_lookback)
        mss = detect_mss(df, swings)
        atr = compute_atr(df, 14)
        rsi = compute_rsi(df["close"], 14)

        highs = df["high"].to_list()
        lows = df["low"].to_list()
        rsi_vals = rsi.to_list()
        mss_vals = mss.to_list()

        # Step 1: Detect single-instrument swing failures (SMT proxy).
        # Bearish divergence: price makes new high but RSI doesn't → expect reversal DOWN.
        # Bullish divergence: price makes new low but RSI doesn't → expect reversal UP.
        bearish_div = [False] * n  # price new high, RSI not → short setup
        bullish_div = [False] * n  # price new low, RSI not → long setup

        for i in range(self.lookback, n):
            window_start = i - self.lookback

            price_high_window = highs[window_start:i]
            price_low_window = lows[window_start:i]
            rsi_window = rsi_vals[window_start:i]

            if not price_high_window or not rsi_window:
                continue

            # Filter out None/NaN from RSI window
            valid_rsi = [r for r in rsi_window if r is not None and r == r]
            if not valid_rsi:
                continue

            curr_rsi = rsi_vals[i]
            if curr_rsi is None or curr_rsi != curr_rsi:
                continue

            prev_high_max = max(price_high_window)
            prev_low_min = min(price_low_window)
            prev_rsi_max = max(valid_rsi)
            prev_rsi_min = min(valid_rsi)

            # Bearish divergence: new high in price, RSI fails to make new high
            if highs[i] > prev_high_max and curr_rsi < prev_rsi_max:
                bearish_div[i] = True

            # Bullish divergence: new low in price, RSI fails to make new low
            if lows[i] < prev_low_min and curr_rsi > prev_rsi_min:
                bullish_div[i] = True

        # Step 2: Confirm divergence with MSS within confirmation_bars.
        entry_long = [False] * n
        entry_short = [False] * n
        exit_long = [False] * n
        exit_short = [False] * n

        for i in range(n):
            # Look back up to confirmation_bars for a divergence signal
            if mss_vals[i] == "bullish":
                for j in range(max(0, i - self.confirmation_bars), i + 1):
                    if bullish_div[j]:
                        entry_long[i] = True
                        break

            elif mss_vals[i] == "bearish":
                for j in range(max(0, i - self.confirmation_bars), i + 1):
                    if bearish_div[j]:
                        entry_short[i] = True
                        break

            # Exit: opposing divergence or opposing MSS
            if bearish_div[i] and any(entry_long[max(0, i - 50):i]):
                exit_long[i] = True
            if bullish_div[i] and any(entry_short[max(0, i - 50):i]):
                exit_short[i] = True

            # Also exit on opposing MSS
            if mss_vals[i] == "bearish" and any(entry_long[max(0, i - 50):i]):
                exit_long[i] = True
            if mss_vals[i] == "bullish" and any(entry_short[max(0, i - 50):i]):
                exit_short[i] = True

        result = df.with_columns([
            pl.Series("entry_long", entry_long),
            pl.Series("entry_short", entry_short),
            pl.Series("exit_long", exit_long),
            pl.Series("exit_short", exit_short),
            rsi.alias("rsi_14"),
            atr.alias("atr_14"),
            mss.alias("mss"),
        ])
        return result

    def get_params(self) -> dict:
        return {
            "lookback": self.lookback,
            "swing_lookback": self.swing_lookback,
            "confirmation_bars": self.confirmation_bars,
        }

    def get_default_config(self) -> dict:
        return {
            "lookback": 20,
            "swing_lookback": 5,
            "confirmation_bars": 5,
        }
