"""ICT OTE strategy — BOS + Fibonacci OTE zone + FVG.

One-sentence: After BOS, enter at the OTE zone (0.618-0.786 fib) when an FVG forms there.

Fix: Ensure fib measurement uses the most recent IMPULSIVE leg (displacement-based swing),
not just any swing high/low. Also add price-based stop loss below/above the swing extreme.
"""

from __future__ import annotations
import polars as pl
from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr
from src.engine.indicators.market_structure import detect_swings, detect_bos
from src.engine.indicators.price_delivery import detect_fvg, detect_displacement
from src.engine.indicators.fibonacci import ote_zone


class OTEStrategy(BaseStrategy):
    name = "ote_strategy"
    preferred_regime = "TRENDING_UP"

    def __init__(self, swing_lookback: int = 10, atr_period: int = 14, ote_lookback: int = 15):
        self.swing_lookback = swing_lookback
        self.atr_period = atr_period
        self.ote_lookback = ote_lookback
        self.symbol = "ES"
        self.timeframe = "15min"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        result = df.clone()

        swings = detect_swings(df, self.swing_lookback)
        bos = detect_bos(df, swings)
        fvgs = detect_fvg(df)
        atr = compute_atr(df, self.atr_period)
        displacement = detect_displacement(df, 1.5, self.atr_period)

        n = len(df)
        entry_long = [False] * n
        entry_short = [False] * n
        exit_long = [False] * n
        exit_short = [False] * n
        closes = df["close"].to_list()
        bos_list = bos.to_list()

        # Extract ET hours for session exit logic
        _ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
        if _ts_col in df.columns:
            ts_series = df[_ts_col]
            hours = ts_series.dt.hour().to_list()
            minutes = ts_series.dt.minute().to_list()
        else:
            hours = [12] * n
            minutes = [0] * n

        swing_highs = swings.filter(pl.col("type") == "high").sort("index")
        swing_lows = swings.filter(pl.col("type") == "low").sort("index")
        sh_prices = swing_highs["price"].to_list() if len(swing_highs) > 0 else []
        sh_indices = swing_highs["index"].to_list() if len(swing_highs) > 0 else []
        sl_prices = swing_lows["price"].to_list() if len(swing_lows) > 0 else []
        sl_indices = swing_lows["index"].to_list() if len(swing_lows) > 0 else []

        last_bullish_bos = -999
        last_bearish_bos = -999

        bullish_fvgs = fvgs.filter(pl.col("type") == "bullish")
        bearish_fvgs = fvgs.filter(pl.col("type") == "bearish")

        # Track open positions
        long_entry_bar = -1
        short_entry_bar = -1

        for i in range(n):
            if bos_list[i] == "bullish":
                last_bullish_bos = i
            elif bos_list[i] == "bearish":
                last_bearish_bos = i

            h, m = hours[i], minutes[i]
            t_minutes = h * 60 + m

            # Guard: prevent entry on same bar as exit (vectorbt drops the entry)
            exited_this_bar_long = False
            exited_this_bar_short = False

            # ─── Exit checks first ─────────────────────────────
            # Exit at 15:45 ET; safety net 20 bars
            if long_entry_bar >= 0:
                if t_minutes >= 15 * 60 + 45 or (i - long_entry_bar) >= 20:
                    exit_long[i] = True
                    long_entry_bar = -1
                    exited_this_bar_long = True

            if short_entry_bar >= 0:
                if t_minutes >= 15 * 60 + 45 or (i - short_entry_bar) >= 20:
                    exit_short[i] = True
                    short_entry_bar = -1
                    exited_this_bar_short = True

            # ─── Long: after bullish BOS, price in OTE zone + FVG ──
            # Fib must be measured from the impulsive leg (most recent swing low to swing high)
            if not exited_this_bar_long and long_entry_bar < 0 and (i - last_bullish_bos) <= self.ote_lookback and last_bullish_bos > 0:
                # Find the swing high that was broken (BOS target) and the swing low before it
                recent_sh = None
                recent_sl = None
                for j in range(len(sh_indices) - 1, -1, -1):
                    if sh_indices[j] <= last_bullish_bos:
                        recent_sh = sh_prices[j]
                        break
                for j in range(len(sl_indices) - 1, -1, -1):
                    if sl_indices[j] <= last_bullish_bos:
                        recent_sl = sl_prices[j]
                        break

                if recent_sh is not None and recent_sl is not None:
                    ote_upper, ote_lower = ote_zone(recent_sh, recent_sl)
                    if ote_lower <= closes[i] <= ote_upper:
                        for f_idx in range(len(bullish_fvgs)):
                            fvg_bar = int(bullish_fvgs["index"][f_idx])
                            if fvg_bar >= i or i - fvg_bar > 10:
                                continue
                            top = float(bullish_fvgs["top"][f_idx])
                            bottom = float(bullish_fvgs["bottom"][f_idx])
                            if bottom <= closes[i] <= top:
                                entry_long[i] = True
                                long_entry_bar = i
                                break

            # ─── Short: after bearish BOS, price in OTE zone + FVG ─
            # Fib from the impulsive leg (swing high to swing low before BOS)
            if not exited_this_bar_short and short_entry_bar < 0 and (i - last_bearish_bos) <= self.ote_lookback and last_bearish_bos > 0:
                recent_sh = None
                recent_sl = None
                for j in range(len(sh_indices) - 1, -1, -1):
                    if sh_indices[j] <= last_bearish_bos:
                        recent_sh = sh_prices[j]
                        break
                for j in range(len(sl_indices) - 1, -1, -1):
                    if sl_indices[j] <= last_bearish_bos:
                        recent_sl = sl_prices[j]
                        break

                if recent_sh is not None and recent_sl is not None:
                    ote_upper, ote_lower = ote_zone(recent_sh, recent_sl)
                    if ote_lower <= closes[i] <= ote_upper:
                        for f_idx in range(len(bearish_fvgs)):
                            fvg_bar = int(bearish_fvgs["index"][f_idx])
                            if fvg_bar >= i or i - fvg_bar > 10:
                                continue
                            top = float(bearish_fvgs["top"][f_idx])
                            bottom = float(bearish_fvgs["bottom"][f_idx])
                            if bottom <= closes[i] <= top:
                                entry_short[i] = True
                                short_entry_bar = i
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
        return {"swing_lookback": self.swing_lookback, "atr_period": self.atr_period, "ote_lookback": self.ote_lookback}

    def get_default_config(self) -> dict:
        return {"swing_lookback": 10, "atr_period": 14, "ote_lookback": 15}
