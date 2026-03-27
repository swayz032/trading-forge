"""ICT London Raid strategy — Asia range sweep + MSS + FVG entry during London killzone.

One-sentence: Enter on FVG retrace after London sweeps Asia session high/low,
confirmed by displacement and Market Structure Shift.

Key concept elements (from cross-validation research):
- Asia range (20:00-00:00 ET) builds liquidity pools above/below the range
- London killzone (02:00-05:00 ET) sweeps one side of Asia range (Judas Swing)
- Displacement + MSS confirms the sweep is institutional (not noise)
- FVG formed by displacement provides precise entry zone
- Exit: session-based (11:00 AM ET) or max bars held (safety net)
"""

from __future__ import annotations

import polars as pl

from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr
from src.engine.indicators.price_delivery import detect_fvg, detect_displacement
from src.engine.indicators.market_structure import detect_swings, detect_mss
from src.engine.indicators.sessions import is_asia_killzone, is_london_killzone


class LondonRaidStrategy(BaseStrategy):
    name = "london_raid"
    preferred_regime = None

    def __init__(
        self,
        atr_period: int = 14,
        displacement_mult: float = 1.5,
        swing_lookback: int = 5,
        fvg_lookback: int = 5,
    ):
        self.atr_period = atr_period
        self.displacement_mult = displacement_mult
        self.swing_lookback = swing_lookback
        self.fvg_lookback = fvg_lookback
        self.symbol = "MES"
        self.timeframe = "5min"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        result = df.clone()
        n = len(df)
        atr = compute_atr(df, self.atr_period)

        entry_long = [False] * n
        entry_short = [False] * n
        exit_long = [False] * n
        exit_short = [False] * n

        if "ts_event" not in df.columns:
            result = result.with_columns([
                pl.Series("entry_long", entry_long),
                pl.Series("entry_short", entry_short),
                pl.Series("exit_long", exit_long),
                pl.Series("exit_short", exit_short),
                atr.alias(f"atr_{self.atr_period}"),
            ])
            return result

        # ─── Session masks ───────────────────────────────────────
        asia = is_asia_killzone(df["ts_event"]).to_list()
        london = is_london_killzone(df["ts_event"]).to_list()

        # ─── Market structure: swings + MSS ──────────────────────
        swings = detect_swings(df, self.swing_lookback)
        mss = detect_mss(df, swings, self.displacement_mult)
        mss_list = mss.to_list()

        # ─── Displacement candles ────────────────────────────────
        displacement = detect_displacement(df, self.displacement_mult, self.atr_period)
        disp_list = displacement.to_list()

        # ─── FVGs (displacement-confirmed) ───────────────────────
        fvgs = detect_fvg(df)
        valid_bullish_fvgs = []
        valid_bearish_fvgs = []

        if len(fvgs) > 0:
            for f_idx in range(len(fvgs)):
                fvg_bar = int(fvgs["index"][f_idx])
                fvg_type = str(fvgs["type"][f_idx])
                disp_bar = fvg_bar + 1  # candle 3 that created the gap

                if disp_bar >= n:
                    continue

                # Displacement must exist and match FVG direction
                disp_dir = disp_list[disp_bar]
                if disp_dir is None or disp_dir != fvg_type:
                    continue

                fvg_data = {
                    "bar": fvg_bar,
                    "top": float(fvgs["top"][f_idx]),
                    "bottom": float(fvgs["bottom"][f_idx]),
                }
                if fvg_type == "bullish":
                    valid_bullish_fvgs.append(fvg_data)
                else:
                    valid_bearish_fvgs.append(fvg_data)

        # ─── Price data ──────────────────────────────────────────
        highs = df["high"].to_list()
        lows = df["low"].to_list()
        closes = df["close"].to_list()
        # Trading day: bars from 18:00 ET onwards belong to the next trading day
        # This prevents Asia range (20:00-00:00) from resetting at midnight
        _ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
        hours_for_td = df[_ts_col].dt.hour().to_list()
        dates_raw = df[_ts_col].dt.date().to_list()
        import datetime
        trading_dates = []
        for i_td in range(len(dates_raw)):
            d = dates_raw[i_td]
            if hours_for_td[i_td] >= 18:  # After 6 PM = next trading day
                d = d + datetime.timedelta(days=1)
            trading_dates.append(d)

        # Extract hours/minutes for session exit logic
        hours = df[_ts_col].dt.hour().to_list()
        minutes = df[_ts_col].dt.minute().to_list()

        # ─── Track Asia range per day ────────────────────────────
        asia_high = None
        asia_low = None
        current_date = None

        # Track whether a sweep + MSS has occurred for current day
        sweep_bullish = False   # Asia low was swept -> bullish setup
        sweep_bearish = False   # Asia high was swept -> bearish setup
        mss_confirmed_bull = False
        mss_confirmed_bear = False

        # Track open positions for exit logic
        long_entry_bar = -1
        short_entry_bar = -1
        max_bars_held = 20  # ~100 min on 5m bars, safety net

        for i in range(n):
            h, m = hours[i], minutes[i]
            t_minutes = h * 60 + m

            # ─── Reset on new trading day ────────────────────────
            if trading_dates[i] != current_date:
                current_date = trading_dates[i]
                asia_high = None
                asia_low = None
                sweep_bullish = False
                sweep_bearish = False
                mss_confirmed_bull = False
                mss_confirmed_bear = False

            # ─── Build Asia range (20:00-00:00 ET) ───────────────
            if asia[i]:
                if asia_high is None:
                    asia_high = highs[i]
                    asia_low = lows[i]
                else:
                    asia_high = max(asia_high, highs[i])
                    asia_low = min(asia_low, lows[i])

            # ─── Exit checks first ───────────────────────────────
            exited_long = False
            exited_short = False

            if long_entry_bar >= 0:
                bars_held = i - long_entry_bar
                # Exit at 11:00 AM ET (end of NYAM killzone) or max bars held
                if t_minutes >= 11 * 60 or bars_held >= max_bars_held:
                    exit_long[i] = True
                    long_entry_bar = -1
                    exited_long = True

            if short_entry_bar >= 0:
                bars_held = i - short_entry_bar
                if t_minutes >= 11 * 60 or bars_held >= max_bars_held:
                    exit_short[i] = True
                    short_entry_bar = -1
                    exited_short = True

            # ─── Entry logic: only in London killzone ────────────
            if not london[i] or asia_high is None:
                continue

            # Step 1: Detect sweep of Asia range
            if not sweep_bearish and highs[i] > asia_high:
                sweep_bearish = True   # BSL swept -> bearish setup

            if not sweep_bullish and lows[i] < asia_low:
                sweep_bullish = True   # SSL swept -> bullish setup

            # Step 2: After sweep, check for MSS confirmation
            if sweep_bullish and not mss_confirmed_bull and mss_list[i] == "bullish":
                mss_confirmed_bull = True

            if sweep_bearish and not mss_confirmed_bear and mss_list[i] == "bearish":
                mss_confirmed_bear = True

            # Step 3: After sweep + MSS, look for FVG entry
            close = closes[i]

            if not exited_long and long_entry_bar < 0 and mss_confirmed_bull:
                for fvg in valid_bullish_fvgs:
                    if fvg["bar"] >= i:
                        continue
                    if i - fvg["bar"] > self.fvg_lookback:
                        continue
                    if fvg["bottom"] <= close <= fvg["top"]:
                        entry_long[i] = True
                        long_entry_bar = i
                        # Only take one London Raid per direction per day
                        mss_confirmed_bull = False
                        break

            if not exited_short and short_entry_bar < 0 and mss_confirmed_bear:
                for fvg in valid_bearish_fvgs:
                    if fvg["bar"] >= i:
                        continue
                    if i - fvg["bar"] > self.fvg_lookback:
                        continue
                    if fvg["bottom"] <= close <= fvg["top"]:
                        entry_short[i] = True
                        short_entry_bar = i
                        mss_confirmed_bear = False
                        break

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
            "atr_period": self.atr_period,
            "displacement_mult": self.displacement_mult,
            "swing_lookback": self.swing_lookback,
            "fvg_lookback": self.fvg_lookback,
        }

    def get_default_config(self) -> dict:
        return {
            "atr_period": 14,
            "displacement_mult": 1.5,
            "swing_lookback": 5,
            "fvg_lookback": 5,
        }
