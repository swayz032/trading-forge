"""ICT Swing Trade strategy — HTF structure + OTE zone + FVG confluence.

One-sentence: Enter on bullish BOS + price retracing to the OTE zone (0.618-0.786
fib) with an FVG present in that zone, targeting fib extension levels.
"""

from __future__ import annotations

import polars as pl

from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr, compute_adx
from src.engine.indicators.market_structure import detect_swings, detect_bos
from src.engine.indicators.price_delivery import detect_fvg
from src.engine.indicators.fibonacci import ote_zone, fib_extensions


class ICTSwingStrategy(BaseStrategy):
    name = "ict_swing"
    preferred_regime = "TRENDING_UP"

    def __init__(
        self,
        htf_lookback: int = 10,
        ote_tolerance: float = 0.1,
        min_adx: float = 20.0,
    ):
        self.htf_lookback = htf_lookback
        self.ote_tolerance = ote_tolerance
        self.min_adx = min_adx
        self.symbol = "ES"
        self.timeframe = "1h"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        result = df.clone()
        n = len(df)

        # Edge case: not enough data
        if n < self.htf_lookback * 2 + 1:
            return result.with_columns([
                pl.lit(False).alias("entry_long"),
                pl.lit(False).alias("entry_short"),
                pl.lit(False).alias("exit_long"),
                pl.lit(False).alias("exit_short"),
            ])

        # Compute indicators
        atr = compute_atr(df, 14)
        adx = compute_adx(df, 14)
        swings = detect_swings(df, self.htf_lookback)
        bos = detect_bos(df, swings)
        fvgs = detect_fvg(df)

        # Pre-extract swing data
        swing_highs = swings.filter(pl.col("type") == "high").sort("index")
        swing_lows = swings.filter(pl.col("type") == "low").sort("index")

        sh_prices = swing_highs["price"].to_list() if len(swing_highs) > 0 else []
        sh_indices = swing_highs["index"].to_list() if len(swing_highs) > 0 else []
        sl_prices = swing_lows["price"].to_list() if len(swing_lows) > 0 else []
        sl_indices = swing_lows["index"].to_list() if len(swing_lows) > 0 else []

        # Pre-extract FVG data
        bullish_fvgs = fvgs.filter(pl.col("type") == "bullish") if len(fvgs) > 0 else fvgs
        bearish_fvgs = fvgs.filter(pl.col("type") == "bearish") if len(fvgs) > 0 else fvgs

        # Build signal arrays
        entry_long = [False] * n
        entry_short = [False] * n
        exit_long = [False] * n
        exit_short = [False] * n

        closes = df["close"].to_list()
        bos_list = bos.to_list()
        adx_list = adx.to_list()
        atr_list = atr.to_list()

        # Track state: after a bullish BOS, look for OTE retracement
        last_bullish_bos_bar = None
        last_bearish_bos_bar = None
        last_swing_high = None
        last_swing_low = None
        sh_ptr = 0
        sl_ptr = 0

        for i in range(n):
            # Update swing pointers
            while sh_ptr < len(sh_indices) and sh_indices[sh_ptr] < i:
                last_swing_high = sh_prices[sh_ptr]
                sh_ptr += 1
            while sl_ptr < len(sl_indices) and sl_indices[sl_ptr] < i:
                last_swing_low = sl_prices[sl_ptr]
                sl_ptr += 1

            # ADX filter: need trending conditions
            adx_val = adx_list[i]
            if adx_val is None or adx_val != adx_val or adx_val < self.min_adx:
                continue

            # Track BOS events
            if bos_list[i] == "bullish":
                last_bullish_bos_bar = i
            elif bos_list[i] == "bearish":
                last_bearish_bos_bar = i

            close = closes[i]

            # ---- LONG ENTRY: Bullish BOS + OTE retracement + FVG ----
            if (
                last_bullish_bos_bar is not None
                and last_swing_high is not None
                and last_swing_low is not None
                and last_swing_high > last_swing_low
            ):
                ote_upper, ote_lower = ote_zone(last_swing_high, last_swing_low)
                rng = last_swing_high - last_swing_low
                tolerance = self.ote_tolerance * rng

                # Price in or near OTE zone
                if ote_lower - tolerance <= close <= ote_upper + tolerance:
                    # Check for bullish FVG in OTE zone
                    fvg_in_ote = False
                    for f_idx in range(len(bullish_fvgs)):
                        fvg_bar = int(bullish_fvgs["index"][f_idx])
                        if fvg_bar >= i or i - fvg_bar > self.htf_lookback * 4:
                            continue
                        fvg_top = float(bullish_fvgs["top"][f_idx])
                        fvg_bottom = float(bullish_fvgs["bottom"][f_idx])
                        # FVG overlaps with OTE zone
                        if fvg_bottom <= ote_upper and fvg_top >= ote_lower:
                            fvg_in_ote = True
                            break

                    if fvg_in_ote:
                        entry_long[i] = True

            # ---- SHORT ENTRY: Bearish BOS + OTE retracement + FVG ----
            if (
                last_bearish_bos_bar is not None
                and last_swing_high is not None
                and last_swing_low is not None
                and last_swing_high > last_swing_low
            ):
                ote_upper, ote_lower = ote_zone(last_swing_high, last_swing_low)
                # For shorts, OTE is measured from low up (premium zone)
                short_ote_lower = last_swing_low + 0.618 * (last_swing_high - last_swing_low)
                short_ote_upper = last_swing_low + 0.786 * (last_swing_high - last_swing_low)
                rng = last_swing_high - last_swing_low
                tolerance = self.ote_tolerance * rng

                if short_ote_lower - tolerance <= close <= short_ote_upper + tolerance:
                    fvg_in_ote = False
                    for f_idx in range(len(bearish_fvgs)):
                        fvg_bar = int(bearish_fvgs["index"][f_idx])
                        if fvg_bar >= i or i - fvg_bar > self.htf_lookback * 4:
                            continue
                        fvg_top = float(bearish_fvgs["top"][f_idx])
                        fvg_bottom = float(bearish_fvgs["bottom"][f_idx])
                        if fvg_bottom <= short_ote_upper and fvg_top >= short_ote_lower:
                            fvg_in_ote = True
                            break

                    if fvg_in_ote:
                        entry_short[i] = True

        # Exit logic: fib extension targets or structure break
        in_long = False
        in_short = False
        long_target = None
        short_target = None
        long_swing_high = None
        long_swing_low = None

        for i in range(n):
            if entry_long[i]:
                in_long = True
                in_short = False
                # Set exit target at 1.0 extension (or -0.272 fib extension)
                if last_swing_high is not None and last_swing_low is not None:
                    exts = fib_extensions(last_swing_high, last_swing_low, closes[i])
                    long_target = exts.get("-0.272")
                    long_swing_high = last_swing_high
                    long_swing_low = last_swing_low

            elif entry_short[i]:
                in_short = True
                in_long = False
                if last_swing_high is not None and last_swing_low is not None:
                    exts = fib_extensions(last_swing_high, last_swing_low, closes[i])
                    short_target = exts.get("-0.272")

            # Exit long: target hit or bearish BOS
            if in_long:
                if long_target is not None and closes[i] >= long_target:
                    exit_long[i] = True
                    in_long = False
                elif bos_list[i] == "bearish":
                    exit_long[i] = True
                    in_long = False

            # Exit short: target hit or bullish BOS
            if in_short:
                if short_target is not None and closes[i] <= short_target:
                    exit_short[i] = True
                    in_short = False
                elif bos_list[i] == "bullish":
                    exit_short[i] = True
                    in_short = False

        result = result.with_columns([
            pl.Series("entry_long", entry_long),
            pl.Series("entry_short", entry_short),
            pl.Series("exit_long", exit_long),
            pl.Series("exit_short", exit_short),
            atr.alias("atr_14"),
            adx.alias("adx_14"),
            bos.alias("bos"),
        ])

        return result

    def get_params(self) -> dict:
        return {
            "htf_lookback": self.htf_lookback,
            "ote_tolerance": self.ote_tolerance,
            "min_adx": self.min_adx,
        }

    def get_default_config(self) -> dict:
        return {
            "htf_lookback": 10,
            "ote_tolerance": 0.1,
            "min_adx": 20.0,
        }
