"""ICT Midnight Open strategy — mean reversion to the 00:00 ET reference level.

One-sentence: Enter when price is near midnight open during a killzone session with FVG or MSS confirmation, targeting a return to the midnight level.
"""

from __future__ import annotations

import polars as pl

from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr
from src.engine.indicators.market_structure import detect_swings, detect_mss
from src.engine.indicators.price_delivery import detect_fvg
from src.engine.indicators.sessions import (
    midnight_open as compute_midnight_open,
    is_london_killzone,
    is_nyam_killzone,
)


class MidnightOpenStrategy(BaseStrategy):
    name = "midnight_open"
    preferred_regime = None  # works in all regimes

    def __init__(
        self,
        lookback: int = 5,
        distance_threshold_atr: float = 1.5,
        session_filter: str = "any",
    ):
        self.lookback = lookback
        self.distance_threshold_atr = distance_threshold_atr
        self.session_filter = session_filter
        self.symbol = "MES"
        self.timeframe = "5min"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        result = df.clone()

        if len(df) < self.lookback * 3:
            result = result.with_columns([
                pl.lit(False).alias("entry_long"),
                pl.lit(False).alias("entry_short"),
                pl.lit(False).alias("exit_long"),
                pl.lit(False).alias("exit_short"),
            ])
            return result

        # Core indicators
        atr = compute_atr(df, 14)
        swings = detect_swings(df, self.lookback)
        mss = detect_mss(df, swings)
        fvgs = detect_fvg(df)

        # Midnight open reference level
        if "ts_event" in df.columns:
            mo_level = compute_midnight_open(df)
        else:
            # Fallback: use first bar's open for each implied day
            mo_level = pl.Series("midnight_open", [float(df["open"][0])] * len(df))

        # Session filter
        if "ts_event" in df.columns:
            london = is_london_killzone(df["ts_event"])
            nyam = is_nyam_killzone(df["ts_event"])
            if self.session_filter == "london":
                in_session = london
            elif self.session_filter == "ny_am":
                in_session = nyam
            else:  # "any"
                in_session = london | nyam
        else:
            in_session = pl.Series("session", [True] * len(df))

        # Pre-extract lists for loop
        closes = df["close"].to_list()
        highs = df["high"].to_list()
        lows = df["low"].to_list()
        atr_list = atr.to_list()
        mo_list = mo_level.to_list()
        mss_list = mss.to_list()
        session_list = in_session.to_list()

        bullish_fvgs = fvgs.filter(pl.col("type") == "bullish")
        bearish_fvgs = fvgs.filter(pl.col("type") == "bearish")

        # Build FVG active-at-bar lookup (recent FVGs within lookback)
        def has_bullish_fvg(bar_idx: int) -> bool:
            for f_idx in range(len(bullish_fvgs)):
                fvg_bar = int(bullish_fvgs["index"][f_idx])
                if fvg_bar >= bar_idx:
                    continue
                if bar_idx - fvg_bar > self.lookback:
                    continue
                top = float(bullish_fvgs["top"][f_idx])
                bottom = float(bullish_fvgs["bottom"][f_idx])
                if bottom <= closes[bar_idx] <= top:
                    return True
            return False

        def has_bearish_fvg(bar_idx: int) -> bool:
            for f_idx in range(len(bearish_fvgs)):
                fvg_bar = int(bearish_fvgs["index"][f_idx])
                if fvg_bar >= bar_idx:
                    continue
                if bar_idx - fvg_bar > self.lookback:
                    continue
                top = float(bearish_fvgs["top"][f_idx])
                bottom = float(bearish_fvgs["bottom"][f_idx])
                if bottom <= closes[bar_idx] <= top:
                    return True
            return False

        entry_long = [False] * len(df)
        entry_short = [False] * len(df)
        exit_long = [False] * len(df)
        exit_short = [False] * len(df)

        in_long = False
        long_entry_distance = 0.0
        in_short = False
        short_entry_distance = 0.0

        for i in range(len(df)):
            mo = mo_list[i]
            atr_val = atr_list[i]
            close = closes[i]

            # Skip if no valid ATR or midnight open
            if mo is None or atr_val is None:
                continue
            if atr_val != atr_val or mo != mo:  # NaN check
                continue
            if atr_val == 0:
                continue

            distance = abs(close - mo)
            within_threshold = distance <= self.distance_threshold_atr * atr_val

            # Guard: prevent entry on same bar as exit (vectorbt drops the entry)
            exited_this_bar_long = False
            exited_this_bar_short = False

            # ── Exit long first: price reaches midnight open (target) or moves 2x away ──
            if in_long:
                reached_target = highs[i] >= mo
                moved_away = (mo - lows[i]) >= 2.0 * long_entry_distance and long_entry_distance > 0
                if reached_target or moved_away:
                    exit_long[i] = True
                    in_long = False
                    exited_this_bar_long = True

            # ── Exit short first: price reaches midnight open (target) or moves 2x away ──
            if in_short:
                reached_target = lows[i] <= mo
                moved_away = (highs[i] - mo) >= 2.0 * short_entry_distance and short_entry_distance > 0
                if reached_target or moved_away:
                    exit_short[i] = True
                    in_short = False
                    exited_this_bar_short = True

            # ── Entry long: price below midnight open, within ATR threshold,
            #    in session, with bullish FVG fill or bullish MSS ──
            if (
                not exited_this_bar_long
                and not in_long
                and session_list[i]
                and close < mo
                and within_threshold
                and (has_bullish_fvg(i) or mss_list[i] == "bullish")
            ):
                entry_long[i] = True
                in_long = True
                long_entry_distance = distance

            # ── Entry short: price above midnight open, within ATR threshold,
            #    in session, with bearish FVG fill or bearish MSS ──
            if (
                not exited_this_bar_short
                and not in_short
                and session_list[i]
                and close > mo
                and within_threshold
                and (has_bearish_fvg(i) or mss_list[i] == "bearish")
            ):
                entry_short[i] = True
                in_short = True
                short_entry_distance = distance

        result = result.with_columns([
            pl.Series("entry_long", entry_long),
            pl.Series("entry_short", entry_short),
            pl.Series("exit_long", exit_long),
            pl.Series("exit_short", exit_short),
            atr.alias("atr_14"),
            mo_level.alias("midnight_open"),
            mss.alias("mss"),
        ])

        return result

    def get_params(self) -> dict:
        return {
            "lookback": self.lookback,
            "distance_threshold_atr": self.distance_threshold_atr,
            "session_filter": self.session_filter,
        }

    def get_default_config(self) -> dict:
        return {
            "lookback": 5,
            "distance_threshold_atr": 1.5,
            "session_filter": "any",
        }
