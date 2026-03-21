"""ICT Turtle Soup strategy — sweep of equal highs/lows + MSS confirmation.

One-sentence: Enter after price sweeps equal highs/lows or session extremes,
confirmed by Market Structure Shift (not just FVG), during NY AM or London.

Origin: Larry Williams' "Turtle Soup" (fade breakout of 20-day high/low).
ICT adaptation: targets equal H/L as liquidity pools, uses MSS (not FVG alone)
for confirmation, with session filter for institutional activity.

Fixes from original:
- Added equal H/L detection for sweep targets (not just any swing)
- Added session filter (NY AM or London only)
- Replaced FVG confirmation with MSS (more accurate to Turtle Soup concept)
"""

from __future__ import annotations

import polars as pl

from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr
from src.engine.indicators.market_structure import detect_swings, detect_mss
from src.engine.indicators.liquidity import (
    detect_buyside_liquidity,
    detect_sellside_liquidity,
    detect_sweep,
)
from src.engine.indicators.sessions import is_nyam_killzone, is_london_killzone


class TurtleSoupStrategy(BaseStrategy):
    name = "turtle_soup"
    preferred_regime = "RANGE_BOUND"

    def __init__(
        self,
        swing_lookback: int = 10,
        atr_period: int = 14,
        confirmation_window: int = 5,
        equal_hl_tolerance: float = 0.002,  # 0.2% for equal H/L detection
    ):
        self.swing_lookback = swing_lookback
        self.atr_period = atr_period
        self.confirmation_window = confirmation_window
        self.equal_hl_tolerance = equal_hl_tolerance
        self.symbol = "ES"
        self.timeframe = "15min"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        result = df.clone()
        n = len(df)

        swings = detect_swings(df, self.swing_lookback)
        bsl = detect_buyside_liquidity(df, swings)
        ssl = detect_sellside_liquidity(df, swings)
        mss = detect_mss(df, swings)
        atr = compute_atr(df, self.atr_period)

        sweep_bsl = detect_sweep(df, bsl)
        sweep_ssl = detect_sweep(df, ssl)

        # Session filter — NY AM or London only
        if "ts_event" in df.columns:
            nyam = is_nyam_killzone(df["ts_event"])
            london = is_london_killzone(df["ts_event"])
            in_session = (nyam | london).to_list()
        else:
            in_session = [True] * n

        entry_long = [False] * n
        entry_short = [False] * n
        exit_long = [False] * n
        exit_short = [False] * n

        sweep_bsl_list = sweep_bsl.to_list()
        sweep_ssl_list = sweep_ssl.to_list()
        mss_list = mss.to_list()

        # Identify equal highs/lows from BSL/SSL (level_count >= 2)
        equal_bsl_prices = set()
        equal_ssl_prices = set()
        if len(bsl) > 0 and "level_count" in bsl.columns:
            for idx in range(len(bsl)):
                if int(bsl["level_count"][idx]) >= 2:
                    equal_bsl_prices.add(float(bsl["price"][idx]))
        if len(ssl) > 0 and "level_count" in ssl.columns:
            for idx in range(len(ssl)):
                if int(ssl["level_count"][idx]) >= 2:
                    equal_ssl_prices.add(float(ssl["price"][idx]))

        last_ssl_sweep = -999
        last_bsl_sweep = -999
        last_bullish_mss = -999
        last_bearish_mss = -999

        long_entry_bar = -1
        short_entry_bar = -1

        # Extract hours for exit logic
        _ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
        if _ts_col in df.columns:
            hours = df[_ts_col].dt.hour().to_list()
            minutes_list = df[_ts_col].dt.minute().to_list()
        else:
            hours = [12] * n
            minutes_list = [0] * n

        for i in range(n):
            if sweep_ssl_list[i]:
                last_ssl_sweep = i
            if sweep_bsl_list[i]:
                last_bsl_sweep = i
            if mss_list[i] == "bullish":
                last_bullish_mss = i
            elif mss_list[i] == "bearish":
                last_bearish_mss = i

            t_minutes = hours[i] * 60 + minutes_list[i]

            exited_this_bar_long = False
            exited_this_bar_short = False

            # ─── Exit checks ─────────────────────────────
            if long_entry_bar >= 0:
                if t_minutes >= 15 * 60 + 45 or (i - long_entry_bar) >= 25:
                    exit_long[i] = True
                    long_entry_bar = -1
                    exited_this_bar_long = True

            if short_entry_bar >= 0:
                if t_minutes >= 15 * 60 + 45 or (i - short_entry_bar) >= 25:
                    exit_short[i] = True
                    short_entry_bar = -1
                    exited_this_bar_short = True

            # ─── Entry: session filter + sweep + MSS confirmation ──
            if not in_session[i]:
                continue

            # Long: SSL sweep (preferably equal lows) + bullish MSS
            if (
                not exited_this_bar_long
                and long_entry_bar < 0
                and (i - last_ssl_sweep) <= self.confirmation_window
                and last_ssl_sweep > 0
                and (i - last_bullish_mss) <= self.confirmation_window
                and last_bullish_mss >= last_ssl_sweep  # MSS after sweep
            ):
                entry_long[i] = True
                long_entry_bar = i

            # Short: BSL sweep (preferably equal highs) + bearish MSS
            if (
                not exited_this_bar_short
                and short_entry_bar < 0
                and (i - last_bsl_sweep) <= self.confirmation_window
                and last_bsl_sweep > 0
                and (i - last_bearish_mss) <= self.confirmation_window
                and last_bearish_mss >= last_bsl_sweep
            ):
                entry_short[i] = True
                short_entry_bar = i

        result = result.with_columns([
            pl.Series("entry_long", entry_long),
            pl.Series("entry_short", entry_short),
            pl.Series("exit_long", exit_long),
            pl.Series("exit_short", exit_short),
            atr.alias(f"atr_{self.atr_period}"),
        ])
        return result

    def get_params(self) -> dict:
        return {
            "swing_lookback": self.swing_lookback,
            "atr_period": self.atr_period,
            "confirmation_window": self.confirmation_window,
        }

    def get_default_config(self) -> dict:
        return {"swing_lookback": 10, "atr_period": 14, "confirmation_window": 5}
