"""ICT Propulsion Block strategy — candle-2 body within FVG, enter on retest.

One-sentence: Enter when price retraces to the displacement candle body (propulsion
block) inside an FVG, exit when price closes past the mean threshold.
"""

from __future__ import annotations

import polars as pl

from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.market_structure import detect_swings, detect_bos
from src.engine.indicators.price_delivery import detect_fvg, detect_displacement
from src.engine.indicators.core import compute_atr


class PropulsionStrategy(BaseStrategy):
    """Propulsion Block — displacement candle body within FVG, retest entry.

    A propulsion block is the body (open-to-close) of the displacement candle
    (candle 2) that created an FVG.  The mean threshold (50 % of candle-2's
    full high-low range) serves as the hard invalidation line.

    Entry triggers when price retraces into the propulsion-block zone in the
    direction of the displacement (continuation only).

    Params (3):
        lookback: swing detection sensitivity (for BOS confluence filter)
        disp_atr_mult: displacement threshold — candle body must exceed
                       this multiple of ATR to qualify
        pb_max_age: max bars since PB formation for it to remain valid
    """

    name = "propulsion"
    preferred_regime = "TRENDING"

    def __init__(
        self,
        lookback: int = 5,
        disp_atr_mult: float = 1.5,
        pb_max_age: int = 50,
    ):
        self.lookback = lookback
        self.disp_atr_mult = disp_atr_mult
        self.pb_max_age = pb_max_age
        self.symbol = "MES"
        self.timeframe = "15min"

    # ────────────────────────────────────────────────────────────────
    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        n = len(df)

        # Edge case: not enough data
        if n < 2 * self.lookback + 10:
            return df.with_columns([
                pl.lit(False).alias("entry_long"),
                pl.lit(False).alias("entry_short"),
                pl.lit(False).alias("exit_long"),
                pl.lit(False).alias("exit_short"),
            ])

        # ── Indicators ──────────────────────────────────────────────
        atr = compute_atr(df, 14)
        fvgs = detect_fvg(df)
        displacement = detect_displacement(df, self.disp_atr_mult, 14)
        swings = detect_swings(df, self.lookback)
        bos = detect_bos(df, swings)

        # ── Build propulsion blocks from FVGs + displacement ────────
        opens = df["open"].to_list()
        closes = df["close"].to_list()
        highs = df["high"].to_list()
        lows = df["low"].to_list()
        disp_list = displacement.to_list()
        bos_list = bos.to_list()

        # Each propulsion block: (form_idx, zone_top, zone_bottom, mean_thresh, direction, has_bos)
        pb_list: list[tuple[int, float, float, float, str, bool]] = []

        for row_i in range(len(fvgs)):
            fvg_idx = int(fvgs["index"][row_i])  # candle 2 index
            fvg_type = str(fvgs["type"][row_i])

            # Candle 2 must be a displacement candle
            if fvg_idx >= n:
                continue
            candle_disp = disp_list[fvg_idx]
            if candle_disp is None:
                continue

            # Displacement direction must match FVG type
            if fvg_type == "bullish" and candle_disp != "bullish":
                continue
            if fvg_type == "bearish" and candle_disp != "bearish":
                continue

            # Propulsion block zone = body of candle 2
            c2_open = opens[fvg_idx]
            c2_close = closes[fvg_idx]
            zone_top = max(c2_open, c2_close)
            zone_bottom = min(c2_open, c2_close)

            # Mean threshold = 50% of candle 2 full range (high to low)
            c2_high = highs[fvg_idx]
            c2_low = lows[fvg_idx]
            mean_thresh = (c2_high + c2_low) / 2.0

            # BOS confluence: check if BOS occurred at or near the FVG
            has_bos = False
            for offset in range(-2, 3):
                check_idx = fvg_idx + offset
                if 0 <= check_idx < n and bos_list[check_idx] is not None:
                    if fvg_type == "bullish" and bos_list[check_idx] == "bullish":
                        has_bos = True
                        break
                    if fvg_type == "bearish" and bos_list[check_idx] == "bearish":
                        has_bos = True
                        break

            pb_list.append((fvg_idx, zone_top, zone_bottom, mean_thresh, fvg_type, has_bos))

        # ── Signal generation ───────────────────────────────────────
        entry_long = [False] * n
        entry_short = [False] * n
        exit_long = [False] * n
        exit_short = [False] * n

        # Track active position state for mean-threshold exits
        long_active = False
        long_mean_thresh = 0.0
        short_active = False
        short_mean_thresh = 0.0

        for i in range(n):
            exited_this_bar_long = False
            exited_this_bar_short = False

            # ── Exit long: close below mean threshold (before entries) ──
            if long_active and closes[i] < long_mean_thresh:
                exit_long[i] = True
                long_active = False
                exited_this_bar_long = True

            # ── Exit short: close above mean threshold (before entries) ─
            if short_active and closes[i] > short_mean_thresh:
                exit_short[i] = True
                short_active = False
                exited_this_bar_short = True

            # ── Entry long: price retraces into bullish PB zone ─────
            if not long_active and not short_active and not exited_this_bar_long:
                for form_idx, z_top, z_bot, mt, direction, has_bos in pb_list:
                    if direction != "bullish":
                        continue
                    age = i - form_idx
                    if age <= 1 or age > self.pb_max_age:
                        continue
                    # Price dips into the zone and closes above zone bottom
                    if lows[i] <= z_top and closes[i] >= z_bot:
                        entry_long[i] = True
                        long_active = True
                        long_mean_thresh = mt
                        break

            # ── Entry short: price retraces into bearish PB zone ────
            if not short_active and not long_active and not exited_this_bar_short:
                for form_idx, z_top, z_bot, mt, direction, has_bos in pb_list:
                    if direction != "bearish":
                        continue
                    age = i - form_idx
                    if age <= 1 or age > self.pb_max_age:
                        continue
                    # Price rallies into the zone and closes below zone top
                    if highs[i] >= z_bot and closes[i] <= z_top:
                        entry_short[i] = True
                        short_active = True
                        short_mean_thresh = mt
                        break

        result = df.with_columns([
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
            "disp_atr_mult": self.disp_atr_mult,
            "pb_max_age": self.pb_max_age,
        }

    def get_default_config(self) -> dict:
        return {
            "lookback": 5,
            "disp_atr_mult": 1.5,
            "pb_max_age": 50,
        }
