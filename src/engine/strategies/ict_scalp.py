"""ICT Scalp strategy — ultra-short-term FVG fills during killzones.

One-sentence: Enter on first touch of an FVG during Asia/London/NY AM killzones,
exit when the FVG is fully filled (CE reached) or max hold bars exceeded.
"""

from __future__ import annotations

import polars as pl

from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr
from src.engine.indicators.price_delivery import detect_fvg, compute_consequent_encroachment
from src.engine.indicators.sessions import (
    is_asia_killzone,
    is_london_killzone,
    is_nyam_killzone,
)


class ICTScalpStrategy(BaseStrategy):
    name = "ict_scalp"
    preferred_regime = None  # works in all regimes

    def __init__(
        self,
        lookback: int = 5,
        fvg_min_size: float = 0.3,
        max_hold_bars: int = 12,
    ):
        self.lookback = lookback
        self.fvg_min_size = fvg_min_size
        self.max_hold_bars = max_hold_bars
        self.symbol = "ES"
        self.timeframe = "5min"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        result = df.clone()
        n = len(df)

        # Edge case: not enough data
        if n < 3:
            return result.with_columns([
                pl.lit(False).alias("entry_long"),
                pl.lit(False).alias("entry_short"),
                pl.lit(False).alias("exit_long"),
                pl.lit(False).alias("exit_short"),
            ])

        # Compute indicators
        atr = compute_atr(df, 14)
        fvgs = detect_fvg(df)

        # Session filters — combine all killzones
        if "ts_event" in df.columns:
            asia = is_asia_killzone(df["ts_event"])
            london = is_london_killzone(df["ts_event"])
            nyam = is_nyam_killzone(df["ts_event"])
            in_killzone = asia | london | nyam
        else:
            in_killzone = pl.Series("kz", [True] * n)

        # Pre-extract data
        closes = df["close"].to_list()
        highs = df["high"].to_list()
        lows = df["low"].to_list()
        kz_list = in_killzone.to_list()
        atr_list = atr.to_list()

        # Filter FVGs by minimum size (in ATR terms)
        valid_bullish = []
        valid_bearish = []
        if len(fvgs) > 0:
            for f_idx in range(len(fvgs)):
                fvg_bar = int(fvgs["index"][f_idx])
                fvg_type = str(fvgs["type"][f_idx])
                top = float(fvgs["top"][f_idx])
                bottom = float(fvgs["bottom"][f_idx])
                midpoint = float(fvgs["midpoint"][f_idx])
                fvg_size = top - bottom

                atr_at_fvg = atr_list[fvg_bar] if fvg_bar < n else None
                if atr_at_fvg is None or atr_at_fvg != atr_at_fvg:
                    continue
                if fvg_size < self.fvg_min_size * atr_at_fvg:
                    continue

                entry = {
                    "bar": fvg_bar,
                    "top": top,
                    "bottom": bottom,
                    "ce": midpoint,  # consequent encroachment = midpoint
                    "touched": False,
                }
                if fvg_type == "bullish":
                    valid_bullish.append(entry)
                else:
                    valid_bearish.append(entry)

        # Build signal arrays
        entry_long = [False] * n
        entry_short = [False] * n
        exit_long = [False] * n
        exit_short = [False] * n

        # Track active positions for exit logic
        long_entry_bar = None
        short_entry_bar = None
        long_ce_target = None
        short_ce_target = None

        # Set of consumed FVG indices to avoid re-entry
        consumed_bull = set()
        consumed_bear = set()

        for i in range(n):
            # --- ENTRY LOGIC ---
            if kz_list[i] and long_entry_bar is None and short_entry_bar is None:
                close = closes[i]
                low = lows[i]
                high = highs[i]

                # Check bullish FVGs: price touches down into FVG zone
                for v_idx, vfvg in enumerate(valid_bullish):
                    if v_idx in consumed_bull:
                        continue
                    if vfvg["bar"] >= i:
                        continue
                    if i - vfvg["bar"] > self.lookback:
                        continue
                    # First touch: low dips into or close enters the FVG zone
                    if low <= vfvg["top"] and close >= vfvg["bottom"]:
                        entry_long[i] = True
                        long_entry_bar = i
                        long_ce_target = vfvg["ce"]
                        consumed_bull.add(v_idx)
                        break

                # Check bearish FVGs: price touches up into FVG zone
                if not entry_long[i]:
                    for v_idx, vfvg in enumerate(valid_bearish):
                        if v_idx in consumed_bear:
                            continue
                        if vfvg["bar"] >= i:
                            continue
                        if i - vfvg["bar"] > self.lookback:
                            continue
                        if high >= vfvg["bottom"] and close <= vfvg["top"]:
                            entry_short[i] = True
                            short_entry_bar = i
                            short_ce_target = vfvg["ce"]
                            consumed_bear.add(v_idx)
                            break

            # --- EXIT LOGIC ---
            # Exit long: CE reached or max hold bars
            if long_entry_bar is not None and i > long_entry_bar:
                bars_held = i - long_entry_bar
                # CE target reached (price moved through midpoint = FVG fully filled)
                if long_ce_target is not None and closes[i] >= long_ce_target:
                    exit_long[i] = True
                    long_entry_bar = None
                    long_ce_target = None
                elif bars_held >= self.max_hold_bars:
                    exit_long[i] = True
                    long_entry_bar = None
                    long_ce_target = None

            # Exit short: CE reached or max hold bars
            if short_entry_bar is not None and i > short_entry_bar:
                bars_held = i - short_entry_bar
                if short_ce_target is not None and closes[i] <= short_ce_target:
                    exit_short[i] = True
                    short_entry_bar = None
                    short_ce_target = None
                elif bars_held >= self.max_hold_bars:
                    exit_short[i] = True
                    short_entry_bar = None
                    short_ce_target = None

        result = result.with_columns([
            pl.Series("entry_long", entry_long),
            pl.Series("entry_short", entry_short),
            pl.Series("exit_long", exit_long),
            pl.Series("exit_short", exit_short),
            atr.alias("atr_14"),
        ])

        return result

    def get_params(self) -> dict:
        return {
            "lookback": self.lookback,
            "fvg_min_size": self.fvg_min_size,
            "max_hold_bars": self.max_hold_bars,
        }

    def get_default_config(self) -> dict:
        return {
            "lookback": 5,
            "fvg_min_size": 0.3,
            "max_hold_bars": 12,
        }
