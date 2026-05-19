"""ICT Scalp strategy — Sweep→MSS→Displacement→FVG retrace during killzones.

One-sentence: Enter on FVG retrace after a liquidity sweep triggers an MSS
with displacement during Asia/London/NY AM killzones, exit at opposing swing
or max hold bars.
"""

from __future__ import annotations

import polars as pl

from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr
from src.engine.indicators.price_delivery import detect_fvg, detect_displacement
from src.engine.indicators.market_structure import detect_swings, detect_mss
from src.engine.indicators.liquidity import (
    detect_buyside_liquidity,
    detect_sellside_liquidity,
    detect_sweep,
)
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
        swing_lookback: int = 5,
        disp_atr_mult: float = 1.5,
    ):
        self.lookback = lookback
        self.fvg_min_size = fvg_min_size
        self.max_hold_bars = max_hold_bars
        self.swing_lookback = swing_lookback
        self.disp_atr_mult = disp_atr_mult
        self.symbol = "MES"
        self.timeframe = "5min"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        result = df.clone()
        n = len(df)

        # Edge case: not enough data
        if n < 10:
            return result.with_columns([
                pl.lit(False).alias("entry_long"),
                pl.lit(False).alias("entry_short"),
                pl.lit(False).alias("exit_long"),
                pl.lit(False).alias("exit_short"),
            ])

        # --- Compute all indicators ---
        atr = compute_atr(df, 14)
        fvgs = detect_fvg(df)
        swings = detect_swings(df, self.swing_lookback)
        mss = detect_mss(df, swings, self.disp_atr_mult)
        displacement = detect_displacement(df, self.disp_atr_mult)

        # Liquidity levels
        bsl = detect_buyside_liquidity(df, swings)
        ssl = detect_sellside_liquidity(df, swings)

        # Sweep detection
        sweep_bsl = detect_sweep(df, bsl) if len(bsl) > 0 else pl.Series("sweep", [False] * n)
        sweep_ssl = detect_sweep(df, ssl) if len(ssl) > 0 else pl.Series("sweep", [False] * n)

        # Session filters — combine all killzones
        if "ts_event" in df.columns:
            asia = is_asia_killzone(df["ts_event"])
            london = is_london_killzone(df["ts_event"])
            nyam = is_nyam_killzone(df["ts_event"])
            in_killzone = asia | london | nyam
        else:
            in_killzone = pl.Series("kz", [True] * n)

        # Pre-extract data for row-level logic
        closes = df["close"].to_list()
        highs = df["high"].to_list()
        lows = df["low"].to_list()
        kz_list = in_killzone.to_list()
        atr_list = atr.to_list()
        mss_list = mss.to_list()
        disp_list = displacement.to_list()
        sweep_bsl_list = sweep_bsl.to_list()
        sweep_ssl_list = sweep_ssl.to_list()

        # --- Build valid FVG catalog with minimum size filter ---
        valid_bullish_fvgs = []
        valid_bearish_fvgs = []
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
                    "midpoint": midpoint,
                }
                if fvg_type == "bullish":
                    valid_bullish_fvgs.append(entry)
                else:
                    valid_bearish_fvgs.append(entry)

        # --- Pre-compute swing highs/lows for exit targets ---
        swing_highs = []  # (bar, price)
        swing_lows = []   # (bar, price)
        if len(swings) > 0:
            for s_idx in range(len(swings)):
                s_bar = int(swings["index"][s_idx])
                s_type = str(swings["type"][s_idx])
                s_price = float(swings["price"][s_idx])
                if s_type == "high":
                    swing_highs.append((s_bar, s_price))
                else:
                    swing_lows.append((s_bar, s_price))

        # --- Track setup state: Sweep→MSS→Displacement→FVG ---
        # A "setup" is activated when we see a sweep + MSS + displacement in sequence.
        # Then we look for FVG retrace entry within `lookback` bars.
        #
        # Bullish setup: SSL sweep → bullish MSS → bullish displacement → bullish FVG
        # Bearish setup: BSL sweep → bearish MSS → bearish displacement → bearish FVG

        # Active setup tracking
        bull_setup_bar = None   # bar where bullish setup was confirmed
        bear_setup_bar = None   # bar where bearish setup was confirmed

        # Track last sweep bars
        last_ssl_sweep_bar = None
        last_bsl_sweep_bar = None

        # Build signal arrays
        entry_long = [False] * n
        entry_short = [False] * n
        exit_long = [False] * n
        exit_short = [False] * n

        # Active position tracking
        long_entry_bar = None
        short_entry_bar = None
        long_target = None
        short_target = None

        # Consumed FVGs to avoid re-entry
        consumed_bull = set()
        consumed_bear = set()

        for i in range(n):
            # --- Track sweeps ---
            if sweep_ssl_list[i]:
                last_ssl_sweep_bar = i
            if sweep_bsl_list[i]:
                last_bsl_sweep_bar = i

            # --- Detect setup activation ---
            # Bullish setup: recent SSL sweep + bullish MSS on this bar
            # (MSS already requires displacement internally)
            if (mss_list[i] == "bullish"
                    and last_ssl_sweep_bar is not None
                    and i - last_ssl_sweep_bar <= self.lookback):
                bull_setup_bar = i

            # Bearish setup: recent BSL sweep + bearish MSS on this bar
            if (mss_list[i] == "bearish"
                    and last_bsl_sweep_bar is not None
                    and i - last_bsl_sweep_bar <= self.lookback):
                bear_setup_bar = i

            # --- ENTRY LOGIC ---
            if kz_list[i] and long_entry_bar is None and short_entry_bar is None:
                close = closes[i]
                low = lows[i]
                high = highs[i]

                # Bullish entry: active bull setup + price retraces into bullish FVG
                if bull_setup_bar is not None and i - bull_setup_bar <= self.lookback:
                    for v_idx, vfvg in enumerate(valid_bullish_fvgs):
                        if v_idx in consumed_bull:
                            continue
                        # FVG must have formed at or after the setup bar
                        if vfvg["bar"] < bull_setup_bar:
                            continue
                        if vfvg["bar"] >= i:
                            continue
                        # Price retraces into the FVG zone
                        if low <= vfvg["top"] and close >= vfvg["bottom"]:
                            entry_long[i] = True
                            long_entry_bar = i
                            # Target: nearest swing high above entry
                            long_target = self._find_nearest_target(
                                swing_highs, i, close, direction="above"
                            )
                            consumed_bull.add(v_idx)
                            bull_setup_bar = None  # consume the setup
                            break

                # Bearish entry: active bear setup + price retraces into bearish FVG
                if (not entry_long[i]
                        and bear_setup_bar is not None
                        and i - bear_setup_bar <= self.lookback):
                    for v_idx, vfvg in enumerate(valid_bearish_fvgs):
                        if v_idx in consumed_bear:
                            continue
                        if vfvg["bar"] < bear_setup_bar:
                            continue
                        if vfvg["bar"] >= i:
                            continue
                        if high >= vfvg["bottom"] and close <= vfvg["top"]:
                            entry_short[i] = True
                            short_entry_bar = i
                            short_target = self._find_nearest_target(
                                swing_lows, i, close, direction="below"
                            )
                            consumed_bear.add(v_idx)
                            bear_setup_bar = None
                            break

            # --- EXIT LOGIC ---
            # Exit long: target reached or max hold bars
            if long_entry_bar is not None and i > long_entry_bar:
                bars_held = i - long_entry_bar
                if long_target is not None and highs[i] >= long_target:
                    exit_long[i] = True
                    long_entry_bar = None
                    long_target = None
                elif bars_held >= self.max_hold_bars:
                    exit_long[i] = True
                    long_entry_bar = None
                    long_target = None

            # Exit short: target reached or max hold bars
            if short_entry_bar is not None and i > short_entry_bar:
                bars_held = i - short_entry_bar
                if short_target is not None and lows[i] <= short_target:
                    exit_short[i] = True
                    short_entry_bar = None
                    short_target = None
                elif bars_held >= self.max_hold_bars:
                    exit_short[i] = True
                    short_entry_bar = None
                    short_target = None

            # --- Expire stale setups ---
            if bull_setup_bar is not None and i - bull_setup_bar > self.lookback:
                bull_setup_bar = None
            if bear_setup_bar is not None and i - bear_setup_bar > self.lookback:
                bear_setup_bar = None

        result = result.with_columns([
            pl.Series("entry_long", entry_long),
            pl.Series("entry_short", entry_short),
            pl.Series("exit_long", exit_long),
            pl.Series("exit_short", exit_short),
            atr.alias("atr_14"),
        ])

        return result

    @staticmethod
    def _find_nearest_target(
        swing_levels: list[tuple[int, float]],
        current_bar: int,
        current_price: float,
        direction: str,
    ) -> float | None:
        """Find the nearest swing level above (for longs) or below (for shorts).

        Only considers swing levels that formed BEFORE the current bar.
        Returns price of nearest target, or None if no valid target found.
        """
        best = None
        for bar, price in swing_levels:
            if bar >= current_bar:
                continue
            if direction == "above" and price > current_price:
                if best is None or price < best:
                    best = price
            elif direction == "below" and price < current_price:
                if best is None or price > best:
                    best = price
        return best

    def get_params(self) -> dict:
        return {
            "lookback": self.lookback,
            "fvg_min_size": self.fvg_min_size,
            "max_hold_bars": self.max_hold_bars,
            "swing_lookback": self.swing_lookback,
            "disp_atr_mult": self.disp_atr_mult,
        }

    def get_default_config(self) -> dict:
        return {
            "lookback": 5,
            "fvg_min_size": 0.3,
            "max_hold_bars": 12,
            "swing_lookback": 5,
            "disp_atr_mult": 1.5,
        }
