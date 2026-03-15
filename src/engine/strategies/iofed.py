"""ICT IOFED strategy — Institutional Order Flow Entry Drill.

One-sentence: Enter on FVG fill after a displacement candle creates the FVG,
catching institutional re-entry into the established order flow direction.
"""

from __future__ import annotations

import polars as pl

from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr
from src.engine.indicators.price_delivery import detect_fvg


class IOFEDStrategy(BaseStrategy):
    name = "iofed"
    preferred_regime = "TRENDING_UP"  # also works TRENDING_DOWN

    def __init__(
        self,
        lookback: int = 10,
        displacement_mult: float = 2.0,
        fvg_min_size: float = 0.5,
    ):
        self.lookback = lookback
        self.displacement_mult = displacement_mult
        self.fvg_min_size = fvg_min_size
        self.symbol = "ES"
        self.timeframe = "5min"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        result = df.clone()
        n = len(df)

        # Edge case: not enough data for FVG detection (need at least 3 bars)
        if n < max(3, self.lookback):
            return result.with_columns([
                pl.lit(False).alias("entry_long"),
                pl.lit(False).alias("entry_short"),
                pl.lit(False).alias("exit_long"),
                pl.lit(False).alias("exit_short"),
            ])

        # Compute indicators
        atr = compute_atr(df, 14)
        fvgs = detect_fvg(df)

        # Identify displacement candles: |close - open| > displacement_mult * ATR
        opens = df["open"].to_list()
        closes = df["close"].to_list()
        highs = df["high"].to_list()
        lows = df["low"].to_list()
        atr_list = atr.to_list()

        displacement_bars = set()  # indices of displacement candles
        displacement_dir = {}  # index -> "bullish" or "bearish"
        for i in range(n):
            atr_val = atr_list[i]
            if atr_val is None or atr_val != atr_val:  # NaN check
                continue
            body = abs(closes[i] - opens[i])
            if body > self.displacement_mult * atr_val:
                displacement_bars.add(i)
                displacement_dir[i] = "bullish" if closes[i] > opens[i] else "bearish"

        # Filter FVGs: must be created by a displacement candle and meet min size
        # FVG "index" is the middle candle; displacement should be candle 3 (index+1)
        # or the middle candle itself
        valid_fvgs = []
        if len(fvgs) > 0:
            for f_idx in range(len(fvgs)):
                fvg_bar = int(fvgs["index"][f_idx])
                fvg_type = str(fvgs["type"][f_idx])
                top = float(fvgs["top"][f_idx])
                bottom = float(fvgs["bottom"][f_idx])
                fvg_size = top - bottom

                # Check min size in ATR terms
                atr_at_fvg = atr_list[fvg_bar] if fvg_bar < n else None
                if atr_at_fvg is None or atr_at_fvg != atr_at_fvg:
                    continue
                if fvg_size < self.fvg_min_size * atr_at_fvg:
                    continue

                # Displacement candle must be the candle that created the gap
                # (candle after the middle = fvg_bar + 1)
                disp_bar = fvg_bar + 1
                if disp_bar in displacement_bars:
                    # Direction must match
                    if displacement_dir[disp_bar] == fvg_type:
                        valid_fvgs.append({
                            "bar": fvg_bar,
                            "type": fvg_type,
                            "top": top,
                            "bottom": bottom,
                            "midpoint": (top + bottom) / 2.0,
                        })

        # Build signal arrays
        entry_long = [False] * n
        entry_short = [False] * n
        exit_long = [False] * n
        exit_short = [False] * n

        # Track which FVGs have been consumed (only enter once per FVG)
        consumed = set()

        for i in range(n):
            close = closes[i]

            for v_idx, vfvg in enumerate(valid_fvgs):
                if v_idx in consumed:
                    continue
                fvg_bar = vfvg["bar"]
                if fvg_bar >= i:
                    continue
                # Only look within lookback window
                if i - fvg_bar > self.lookback:
                    continue

                top = vfvg["top"]
                bottom = vfvg["bottom"]

                # Bullish FVG fill: price retraces down into the FVG zone
                if vfvg["type"] == "bullish" and bottom <= close <= top:
                    entry_long[i] = True
                    consumed.add(v_idx)
                    break

                # Bearish FVG fill: price retraces up into the FVG zone
                if vfvg["type"] == "bearish" and bottom <= close <= top:
                    entry_short[i] = True
                    consumed.add(v_idx)
                    break

        # Exit: opposing displacement or FVG in opposite direction
        in_position_long = False
        in_position_short = False
        for i in range(n):
            if entry_long[i]:
                in_position_long = True
                in_position_short = False
            elif entry_short[i]:
                in_position_short = True
                in_position_long = False

            if in_position_long:
                # Exit on bearish displacement
                if i in displacement_bars and displacement_dir[i] == "bearish":
                    exit_long[i] = True
                    in_position_long = False
                # Exit on opposing entry
                elif entry_short[i]:
                    exit_long[i] = True
                    in_position_long = False

            if in_position_short:
                # Exit on bullish displacement
                if i in displacement_bars and displacement_dir[i] == "bullish":
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
        ])

        return result

    def get_params(self) -> dict:
        return {
            "lookback": self.lookback,
            "displacement_mult": self.displacement_mult,
            "fvg_min_size": self.fvg_min_size,
        }

    def get_default_config(self) -> dict:
        return {
            "lookback": 10,
            "displacement_mult": 2.0,
            "fvg_min_size": 0.5,
        }
