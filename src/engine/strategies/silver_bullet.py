"""ICT Silver Bullet strategy — FVG entry during specific 1-hour windows with displacement.

One-sentence: Enter on displacement-created FVG fill during the 10-11 AM, 2-3 PM, or 3-4 AM ET
Silver Bullet windows.

Key differences from generic killzone FVG:
- Windows are EXACTLY 10:00-11:00, 14:00-15:00, 03:00-04:00 ET (not the wider 8-11 killzone)
- FVG must be created by a displacement candle (strong institutional move)
- Displacement confirms the FVG is institutional, not noise
"""

from __future__ import annotations

import polars as pl

from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr
from src.engine.indicators.price_delivery import detect_fvg, detect_displacement
from src.engine.indicators.sessions import (
    is_silver_bullet_nyam,
    is_silver_bullet_nypm,
    is_silver_bullet_london,
)


class SilverBulletStrategy(BaseStrategy):
    name = "silver_bullet"
    preferred_regime = None  # works in trending and ranging

    def __init__(
        self,
        lookback: int = 5,
        atr_period: int = 14,
        atr_sl_mult: float = 2.0,
        displacement_mult: float = 1.5,
    ):
        self.lookback = lookback
        self.atr_period = atr_period
        self.atr_sl_mult = atr_sl_mult
        self.displacement_mult = displacement_mult
        self.symbol = "MES"
        self.timeframe = "5min"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        result = df.clone()
        n = len(df)

        # Silver Bullet specific windows (NOT the wide 8-11 killzone)
        if "ts_event" in df.columns:
            sb_nyam = is_silver_bullet_nyam(df["ts_event"])       # 10:00-11:00 ET
            sb_nypm = is_silver_bullet_nypm(df["ts_event"])       # 14:00-15:00 ET
            sb_london = is_silver_bullet_london(df["ts_event"])   # 03:00-04:00 ET
            in_sb_window = sb_nyam | sb_nypm | sb_london
        else:
            in_sb_window = pl.Series("sb", [True] * n)
            sb_nyam = in_sb_window

        # Detect FVGs and displacement candles
        fvgs = detect_fvg(df)
        atr = compute_atr(df, self.atr_period)
        displacement = detect_displacement(df, self.displacement_mult, self.atr_period)

        # Identify which FVGs were created by displacement candles
        # FVG "index" is the middle candle; displacement should be candle 3 (index+1)
        disp_list = displacement.to_list()
        valid_bullish_fvgs = []
        valid_bearish_fvgs = []

        if len(fvgs) > 0:
            for f_idx in range(len(fvgs)):
                fvg_bar = int(fvgs["index"][f_idx])
                fvg_type = str(fvgs["type"][f_idx])
                disp_bar = fvg_bar + 1  # candle that created the gap

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

        # Build signal arrays
        entry_long = [False] * n
        entry_short = [False] * n
        exit_long = [False] * n
        exit_short = [False] * n

        closes = df["close"].to_list()
        sb_list = in_sb_window.to_list()
        nyam_list = sb_nyam.to_list()

        # Extract ET hours for session exit logic
        _ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
        if _ts_col in df.columns:
            ts_series = df[_ts_col]
            hours = ts_series.dt.hour().to_list()
            minutes = ts_series.dt.minute().to_list()
        else:
            hours = [12] * n
            minutes = [0] * n

        # Track open positions for session exit
        long_entry_bar = -1
        long_is_nyam = False
        short_entry_bar = -1
        short_is_nyam = False

        for i in range(n):
            h, m = hours[i], minutes[i]
            t_minutes = h * 60 + m

            exited_this_bar_long = False
            exited_this_bar_short = False

            # ─── Exit checks first ─────────────────────────────
            if long_entry_bar >= 0:
                bars_held = i - long_entry_bar
                # NY AM/PM entries exit at 15:45 ET, London at 11:00 ET
                exit_time = (15 * 60 + 45) if long_is_nyam else (11 * 60)
                if t_minutes >= exit_time or bars_held >= 20:
                    exit_long[i] = True
                    long_entry_bar = -1
                    exited_this_bar_long = True

            if short_entry_bar >= 0:
                bars_held = i - short_entry_bar
                exit_time = (15 * 60 + 45) if short_is_nyam else (11 * 60)
                if t_minutes >= exit_time or bars_held >= 20:
                    exit_short[i] = True
                    short_entry_bar = -1
                    exited_this_bar_short = True

            # ─── Entry checks (only in SB windows, only if flat) ──
            if not sb_list[i]:
                continue

            if not exited_this_bar_long and long_entry_bar < 0:
                close = closes[i]
                for fvg in valid_bullish_fvgs:
                    if fvg["bar"] >= i:
                        continue
                    if i - fvg["bar"] > self.lookback:
                        continue
                    if fvg["bottom"] <= close <= fvg["top"]:
                        entry_long[i] = True
                        long_entry_bar = i
                        long_is_nyam = nyam_list[i]
                        break

            if not exited_this_bar_short and short_entry_bar < 0 and long_entry_bar < 0:
                close = closes[i]
                for fvg in valid_bearish_fvgs:
                    if fvg["bar"] >= i:
                        continue
                    if i - fvg["bar"] > self.lookback:
                        continue
                    if fvg["bottom"] <= close <= fvg["top"]:
                        entry_short[i] = True
                        short_entry_bar = i
                        short_is_nyam = nyam_list[i]
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
            "lookback": self.lookback,
            "atr_period": self.atr_period,
            "atr_sl_mult": self.atr_sl_mult,
            "displacement_mult": self.displacement_mult,
        }

    def get_default_config(self) -> dict:
        return {"lookback": 5, "atr_period": 14, "atr_sl_mult": 2.0, "displacement_mult": 1.5}
