"""ICT Swing Trade strategy — HTF bias + liquidity sweep + PD array entry.

One-sentence: Enter after a liquidity sweep when price retraces into a
discount/premium-aligned PD array (order block or FVG) with BOS confirmation,
targeting the opposing liquidity pool.
"""

from __future__ import annotations

import polars as pl

from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr
from src.engine.indicators.market_structure import (
    detect_swings,
    detect_bos,
    compute_premium_discount,
)
from src.engine.indicators.price_delivery import detect_fvg
from src.engine.indicators.order_flow import detect_bullish_ob, detect_bearish_ob
from src.engine.indicators.liquidity import (
    detect_buyside_liquidity,
    detect_sellside_liquidity,
    detect_sweep,
)


class ICTSwingStrategy(BaseStrategy):
    name = "ict_swing"
    preferred_regime = "TRENDING_UP"
    overnight_hold = True  # swing trade: holds multi-day

    def __init__(
        self,
        htf_lookback: int = 10,
        sweep_lookback: int = 40,
        pd_array_lookback: int = 20,
    ):
        self.htf_lookback = htf_lookback
        self.sweep_lookback = sweep_lookback
        self.pd_array_lookback = pd_array_lookback
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

        # ── Core indicators ──────────────────────────────────────────
        atr = compute_atr(df, 14)
        swings = detect_swings(df, self.htf_lookback)
        bos = detect_bos(df, swings)
        pd_zone = compute_premium_discount(df, swings)

        # Liquidity detection
        bsl = detect_buyside_liquidity(df, swings)
        ssl = detect_sellside_liquidity(df, swings)
        sweep_bsl = detect_sweep(df, bsl)
        sweep_ssl = detect_sweep(df, ssl)

        # PD arrays: order blocks + FVGs
        bull_obs = detect_bullish_ob(df, swings)
        bear_obs = detect_bearish_ob(df, swings)
        fvgs = detect_fvg(df)

        # ── Pre-extract to lists for the bar loop ────────────────────
        closes = df["close"].to_list()
        bos_list = bos.to_list()
        pd_list = pd_zone.to_list()
        sweep_bsl_list = sweep_bsl.to_list()
        sweep_ssl_list = sweep_ssl.to_list()

        # Extract bullish PD arrays (bullish OBs + bullish FVGs)
        bull_pd_bars = []
        bull_pd_tops = []
        bull_pd_bots = []
        if len(bull_obs) > 0:
            for idx in range(len(bull_obs)):
                bull_pd_bars.append(int(bull_obs["index"][idx]))
                bull_pd_tops.append(float(bull_obs["top"][idx]))
                bull_pd_bots.append(float(bull_obs["bottom"][idx]))
        bullish_fvgs = fvgs.filter(pl.col("type") == "bullish") if len(fvgs) > 0 else fvgs
        if len(bullish_fvgs) > 0:
            for idx in range(len(bullish_fvgs)):
                bull_pd_bars.append(int(bullish_fvgs["index"][idx]))
                bull_pd_tops.append(float(bullish_fvgs["top"][idx]))
                bull_pd_bots.append(float(bullish_fvgs["bottom"][idx]))

        # Extract bearish PD arrays (bearish OBs + bearish FVGs)
        bear_pd_bars = []
        bear_pd_tops = []
        bear_pd_bots = []
        if len(bear_obs) > 0:
            for idx in range(len(bear_obs)):
                bear_pd_bars.append(int(bear_obs["index"][idx]))
                bear_pd_tops.append(float(bear_obs["top"][idx]))
                bear_pd_bots.append(float(bear_obs["bottom"][idx]))
        bearish_fvgs = fvgs.filter(pl.col("type") == "bearish") if len(fvgs) > 0 else fvgs
        if len(bearish_fvgs) > 0:
            for idx in range(len(bearish_fvgs)):
                bear_pd_bars.append(int(bearish_fvgs["index"][idx]))
                bear_pd_tops.append(float(bearish_fvgs["top"][idx]))
                bear_pd_bots.append(float(bearish_fvgs["bottom"][idx]))

        # Extract BSL/SSL target prices for exit targeting
        bsl_prices = bsl["price"].to_list() if len(bsl) > 0 else []
        ssl_prices = ssl["price"].to_list() if len(ssl) > 0 else []

        # ── Build signal arrays ──────────────────────────────────────
        entry_long = [False] * n
        entry_short = [False] * n
        exit_long = [False] * n
        exit_short = [False] * n

        # State tracking
        last_ssl_sweep_bar = -999  # last bar where SSL was swept (bullish trigger)
        last_bsl_sweep_bar = -999  # last bar where BSL was swept (bearish trigger)
        last_bullish_bos_bar = -999
        last_bearish_bos_bar = -999

        for i in range(n):
            # Track liquidity sweep events
            if sweep_ssl_list[i]:
                last_ssl_sweep_bar = i
            if sweep_bsl_list[i]:
                last_bsl_sweep_bar = i

            # Track BOS events
            if bos_list[i] == "bullish":
                last_bullish_bos_bar = i
            elif bos_list[i] == "bearish":
                last_bearish_bos_bar = i

            close = closes[i]

            # ── LONG ENTRY ───────────────────────────────────────────
            # Conditions:
            #   1. SSL sweep occurred recently (liquidity grab below lows)
            #   2. Bullish BOS after the sweep (confirms institutional reversal)
            #   3. Price is in discount zone
            #   4. Price is at a bullish PD array (OB or FVG)
            if (
                last_ssl_sweep_bar >= i - self.sweep_lookback
                and last_bullish_bos_bar > last_ssl_sweep_bar
                and last_bullish_bos_bar <= i
                and pd_list[i] == "discount"
            ):
                # Check for bullish PD array (OB or FVG) at current price
                for k in range(len(bull_pd_bars)):
                    bar_k = bull_pd_bars[k]
                    if bar_k >= i or i - bar_k > self.pd_array_lookback:
                        continue
                    if bull_pd_bots[k] <= close <= bull_pd_tops[k]:
                        entry_long[i] = True
                        break

            # ── SHORT ENTRY ──────────────────────────────────────────
            # Conditions:
            #   1. BSL sweep occurred recently (liquidity grab above highs)
            #   2. Bearish BOS after the sweep (confirms institutional reversal)
            #   3. Price is in premium zone
            #   4. Price is at a bearish PD array (OB or FVG)
            if (
                last_bsl_sweep_bar >= i - self.sweep_lookback
                and last_bearish_bos_bar > last_bsl_sweep_bar
                and last_bearish_bos_bar <= i
                and pd_list[i] == "premium"
            ):
                for k in range(len(bear_pd_bars)):
                    bar_k = bear_pd_bars[k]
                    if bar_k >= i or i - bar_k > self.pd_array_lookback:
                        continue
                    if bear_pd_bots[k] <= close <= bear_pd_tops[k]:
                        entry_short[i] = True
                        break

        # ── Exit logic: opposing liquidity pool or structure break ────
        in_long = False
        in_short = False
        long_target = None
        short_target = None

        for i in range(n):
            if entry_long[i]:
                in_long = True
                in_short = False
                # Target = nearest BSL above current price
                long_target = None
                for p in bsl_prices:
                    if p > closes[i]:
                        if long_target is None or p < long_target:
                            long_target = p

            elif entry_short[i]:
                in_short = True
                in_long = False
                # Target = nearest SSL below current price
                short_target = None
                for p in ssl_prices:
                    if p < closes[i]:
                        if short_target is None or p > short_target:
                            short_target = p

            # Exit long: BSL target hit or bearish BOS
            if in_long:
                if long_target is not None and closes[i] >= long_target:
                    exit_long[i] = True
                    in_long = False
                elif bos_list[i] == "bearish":
                    exit_long[i] = True
                    in_long = False

            # Exit short: SSL target hit or bullish BOS
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
            bos.alias("bos"),
            pd_zone.alias("premium_discount"),
            sweep_bsl.alias("sweep_bsl"),
            sweep_ssl.alias("sweep_ssl"),
        ])

        return result

    def get_params(self) -> dict:
        return {
            "htf_lookback": self.htf_lookback,
            "sweep_lookback": self.sweep_lookback,
            "pd_array_lookback": self.pd_array_lookback,
        }

    def get_default_config(self) -> dict:
        return {
            "htf_lookback": 10,
            "sweep_lookback": 40,
            "pd_array_lookback": 20,
        }
