"""ICT Power of 3 strategy — Accumulation (Asia), Manipulation (London), Distribution (NY).

One-sentence: Fade the London Judas Swing of Asia range during NY AM session, confirmed by
displacement, with session-based exit logic.

Phases:
  - Accumulation: Asia session (20:00-00:00 ET) — track consolidation range (Asia H/L)
  - Manipulation: London killzone (02:00-05:00 ET) — detect sweep of Asia H or L (Judas Swing)
  - Distribution: NY AM killzone (08:30-11:00 ET) — enter opposite to sweep after displacement

Direction logic:
  - London sweeps Asia High -> SHORT during NY (bearish distribution)
  - London sweeps Asia Low  -> LONG during NY (bullish distribution)

Parameters (4):
  - atr_period: ATR lookback for displacement detection
  - displacement_mult: ATR multiplier for displacement candle threshold
  - sweep_buffer_atr: fraction of ATR added to Asia range for sweep detection
  - max_bars_held: maximum bars to hold before time-based exit
"""

from __future__ import annotations
import polars as pl
from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr
from src.engine.indicators.sessions import is_asia_killzone, is_london_killzone, is_nyam_killzone
from src.engine.indicators.price_delivery import detect_displacement


class PowerOf3Strategy(BaseStrategy):
    name = "power_of_3"
    preferred_regime = None

    def __init__(
        self,
        atr_period: int = 14,
        displacement_mult: float = 1.5,
        sweep_buffer_atr: float = 0.1,
        max_bars_held: int = 20,
    ):
        self.atr_period = atr_period
        self.displacement_mult = displacement_mult
        self.sweep_buffer_atr = sweep_buffer_atr
        self.max_bars_held = max_bars_held
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

        # Early return if no timestamp column (can't determine sessions)
        if "ts_event" not in df.columns:
            result = result.with_columns([
                pl.Series("entry_long", entry_long),
                pl.Series("entry_short", entry_short),
                pl.Series("exit_long", exit_long),
                pl.Series("exit_short", exit_short),
                atr.alias(f"atr_{self.atr_period}"),
            ])
            return result

        # Session masks
        asia = is_asia_killzone(df["ts_event"]).to_list()
        london = is_london_killzone(df["ts_event"]).to_list()
        nyam = is_nyam_killzone(df["ts_event"]).to_list()

        # Displacement detection (strong institutional candle)
        displacement = detect_displacement(df, self.displacement_mult, self.atr_period)
        disp_list = displacement.to_list()

        # Price data
        highs = df["high"].to_list()
        lows = df["low"].to_list()
        closes = df["close"].to_list()
        atr_list = atr.to_list()
        # Trading day: bars from 18:00 ET onwards belong to the next trading day
        # This prevents Asia range (20:00-00:00) from resetting at midnight
        _ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
        hours_for_td = df[_ts_col].dt.hour().to_list()
        dates_raw = df[_ts_col].dt.date().to_list()
        import datetime as _dt
        trading_dates = []
        for i_td in range(len(dates_raw)):
            d = dates_raw[i_td]
            if hours_for_td[i_td] >= 18:  # After 6 PM = next trading day
                d = d + _dt.timedelta(days=1)
            trading_dates.append(d)

        # Extract ET hours for session exit logic
        if _ts_col in df.columns:
            ts_series = df[_ts_col]
            hours = ts_series.dt.hour().to_list()
            minutes = ts_series.dt.minute().to_list()
        else:
            hours = [12] * n
            minutes = [0] * n

        # Daily state
        asia_high = None
        asia_low = None
        london_swept_high = False
        london_swept_low = False
        sweep_high_price = None  # price of the sweep extreme (for SL)
        sweep_low_price = None
        displacement_bearish_after_high_sweep = False
        displacement_bullish_after_low_sweep = False
        current_date = None

        # Position tracking for exit logic
        long_entry_bar = -1
        short_entry_bar = -1

        for i in range(n):
            # ─── New trading day: reset state ───────────────────
            if trading_dates[i] != current_date:
                current_date = trading_dates[i]
                asia_high = None
                asia_low = None
                london_swept_high = False
                london_swept_low = False
                sweep_high_price = None
                sweep_low_price = None
                displacement_bearish_after_high_sweep = False
                displacement_bullish_after_low_sweep = False

            atr_val = atr_list[i]
            buffer = (atr_val * self.sweep_buffer_atr) if (atr_val is not None and atr_val == atr_val) else 0.0

            # ─── Phase 1: Accumulation (Asia) — track range ────
            if asia[i]:
                if asia_high is None:
                    asia_high = highs[i]
                    asia_low = lows[i]
                else:
                    asia_high = max(asia_high, highs[i])
                    asia_low = min(asia_low, lows[i])

            # ─── Phase 2: Manipulation (London) — detect sweep + displacement ──
            if london[i] and asia_high is not None:
                # Sweep detection with ATR buffer
                if highs[i] > asia_high + buffer:
                    london_swept_high = True
                    sweep_high_price = highs[i]
                if lows[i] < asia_low - buffer:
                    london_swept_low = True
                    sweep_low_price = lows[i]

                # Displacement confirmation AFTER sweep
                disp = disp_list[i]
                if london_swept_high and disp == "bearish":
                    displacement_bearish_after_high_sweep = True
                if london_swept_low and disp == "bullish":
                    displacement_bullish_after_low_sweep = True

            # ─── Exit checks (before entry to avoid same-bar entry+exit) ──
            h, m = hours[i], minutes[i]
            t_minutes = h * 60 + m
            session_exit_time = 15 * 60 + 45  # 15:45 ET
            exited_this_bar_long = False
            exited_this_bar_short = False

            if long_entry_bar >= 0:
                bars_held = i - long_entry_bar
                # Exit conditions: session end, max bars held, or structure break
                structure_break = closes[i] < (sweep_low_price if sweep_low_price is not None else (asia_low if asia_low is not None else 0))
                if t_minutes >= session_exit_time or bars_held >= self.max_bars_held or structure_break:
                    exit_long[i] = True
                    long_entry_bar = -1
                    exited_this_bar_long = True

            if short_entry_bar >= 0:
                bars_held = i - short_entry_bar
                structure_break = closes[i] > (sweep_high_price if sweep_high_price is not None else (asia_high if asia_high is not None else float("inf")))
                if t_minutes >= session_exit_time or bars_held >= self.max_bars_held or structure_break:
                    exit_short[i] = True
                    short_entry_bar = -1
                    exited_this_bar_short = True

            # ─── Phase 3: Distribution (NY AM) — entry ─────────
            if not nyam[i]:
                continue
            if asia_high is None:
                continue

            # Only enter if flat (no existing position)
            # SHORT: London swept Asia High + bearish displacement confirmed
            if short_entry_bar < 0 and not exited_this_bar_short and london_swept_high and displacement_bearish_after_high_sweep:
                if closes[i] < asia_high:  # price has returned below Asia High (fake breakout confirmed)
                    entry_short[i] = True
                    short_entry_bar = i
                    # Consume signals — one entry per day per direction
                    london_swept_high = False
                    displacement_bearish_after_high_sweep = False

            # LONG: London swept Asia Low + bullish displacement confirmed
            if long_entry_bar < 0 and not exited_this_bar_long and london_swept_low and displacement_bullish_after_low_sweep:
                if closes[i] > asia_low:  # price has returned above Asia Low (fake breakdown confirmed)
                    entry_long[i] = True
                    long_entry_bar = i
                    london_swept_low = False
                    displacement_bullish_after_low_sweep = False

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
            "sweep_buffer_atr": self.sweep_buffer_atr,
            "max_bars_held": self.max_bars_held,
        }

    def get_default_config(self) -> dict:
        return {
            "atr_period": 14,
            "displacement_mult": 1.5,
            "sweep_buffer_atr": 0.1,
            "max_bars_held": 20,
        }
