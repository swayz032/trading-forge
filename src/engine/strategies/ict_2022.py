"""ICT 2022 Model strategy — HTF bias + liquidity sweep + MSS + FVG entry at OTE.

One-sentence: After establishing HTF directional bias, wait for a liquidity sweep,
then enter on FVG within the OTE zone (0.618-0.786) after MSS confirms direction.

The ICT 2022 Model is a multi-step institutional trading model:
1. HTF Bias — determine daily/4H direction (premium/discount + trend)
2. Liquidity Sweep — price sweeps BSL or SSL (institutional stop hunt)
3. MSS — Market Structure Shift confirms direction change after sweep
4. FVG at OTE — enter on FVG fill within the OTE zone of the impulse leg

Key fix: The original used premium/discount zone alone. The 2022 Model REQUIRES
the full sequence: bias → sweep → MSS → FVG at OTE. Without the sweep step,
it's just a generic premium/discount FVG strategy.
"""

from __future__ import annotations

import polars as pl

from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr
from src.engine.indicators.market_structure import (
    detect_swings,
    detect_mss,
    compute_premium_discount,
)
from src.engine.indicators.price_delivery import detect_fvg
from src.engine.indicators.liquidity import (
    detect_buyside_liquidity,
    detect_sellside_liquidity,
    detect_sweep,
)
from src.engine.indicators.fibonacci import ote_zone


class ICT2022Strategy(BaseStrategy):
    name = "ict_2022"
    preferred_regime = "TRENDING_UP"

    def __init__(
        self,
        htf_lookback: int = 20,
        ltf_lookback: int = 5,
        atr_period: int = 14,
        sweep_window: int = 15,
        ote_window: int = 15,
    ):
        self.htf_lookback = htf_lookback
        self.ltf_lookback = ltf_lookback
        self.atr_period = atr_period
        self.sweep_window = sweep_window  # bars to look back for a sweep event
        self.ote_window = ote_window
        self.symbol = "MES"
        self.timeframe = "5min"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        result = df.clone()
        n = len(df)

        # HTF structure for bias (larger lookback)
        htf_swings = detect_swings(df, self.htf_lookback)
        pd_zones = compute_premium_discount(df, htf_swings)

        # LTF structure for entry timing
        ltf_swings = detect_swings(df, self.ltf_lookback)
        mss = detect_mss(df, ltf_swings)
        fvgs = detect_fvg(df)
        atr = compute_atr(df, self.atr_period)

        # Liquidity detection + sweeps
        bsl = detect_buyside_liquidity(df, htf_swings)
        ssl = detect_sellside_liquidity(df, htf_swings)
        sweep_bsl = detect_sweep(df, bsl)
        sweep_ssl = detect_sweep(df, ssl)

        pd_list = pd_zones.to_list()
        mss_list = mss.to_list()
        closes = df["close"].to_list()
        sweep_bsl_list = sweep_bsl.to_list()
        sweep_ssl_list = sweep_ssl.to_list()

        bullish_fvgs = fvgs.filter(pl.col("type") == "bullish")
        bearish_fvgs = fvgs.filter(pl.col("type") == "bearish")

        # Swing points for OTE calculation
        swing_highs = ltf_swings.filter(pl.col("type") == "high").sort("index")
        swing_lows = ltf_swings.filter(pl.col("type") == "low").sort("index")
        sh_prices = swing_highs["price"].to_list() if len(swing_highs) > 0 else []
        sh_indices = swing_highs["index"].to_list() if len(swing_highs) > 0 else []
        sl_prices = swing_lows["price"].to_list() if len(swing_lows) > 0 else []
        sl_indices = swing_lows["index"].to_list() if len(swing_lows) > 0 else []

        entry_long = [False] * n
        entry_short = [False] * n
        exit_long = [False] * n
        exit_short = [False] * n

        # Track state: sweep → MSS → FVG at OTE
        last_ssl_sweep = -999  # sell-side sweep → potential long
        last_bsl_sweep = -999  # buy-side sweep → potential short
        last_bullish_mss = -999
        last_bearish_mss = -999

        long_entry_bar = -1
        short_entry_bar = -1

        # Extract ET hours for session exit
        _ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
        if _ts_col in df.columns:
            ts_series = df[_ts_col]
            hours = ts_series.dt.hour().to_list()
            minutes = ts_series.dt.minute().to_list()
        else:
            hours = [12] * n
            minutes = [0] * n

        for i in range(n):
            # Track sweep events
            if sweep_ssl_list[i]:
                last_ssl_sweep = i
            if sweep_bsl_list[i]:
                last_bsl_sweep = i

            # Track MSS events
            if mss_list[i] == "bullish":
                last_bullish_mss = i
            elif mss_list[i] == "bearish":
                last_bearish_mss = i

            h, m = hours[i], minutes[i]
            t_minutes = h * 60 + m

            exited_this_bar_long = False
            exited_this_bar_short = False

            # ─── Exit checks first ─────────────────────────────
            if long_entry_bar >= 0:
                if t_minutes >= 15 * 60 + 45 or (i - long_entry_bar) >= 30:
                    exit_long[i] = True
                    long_entry_bar = -1
                    exited_this_bar_long = True

            if short_entry_bar >= 0:
                if t_minutes >= 15 * 60 + 45 or (i - short_entry_bar) >= 30:
                    exit_short[i] = True
                    short_entry_bar = -1
                    exited_this_bar_short = True

            # ─── Long: discount bias + SSL sweep + bullish MSS + FVG at OTE ──
            if (
                not exited_this_bar_long
                and long_entry_bar < 0
                and pd_list[i] == "discount"
                and (i - last_ssl_sweep) <= self.sweep_window
                and last_ssl_sweep > 0
                and (i - last_bullish_mss) <= self.ote_window
                and last_bullish_mss > last_ssl_sweep  # MSS must come AFTER sweep
            ):
                # Find OTE zone from recent swing
                recent_sh = None
                recent_sl = None
                for j in range(len(sh_indices) - 1, -1, -1):
                    if sh_indices[j] <= i:
                        recent_sh = sh_prices[j]
                        break
                for j in range(len(sl_indices) - 1, -1, -1):
                    if sl_indices[j] <= i:
                        recent_sl = sl_prices[j]
                        break

                if recent_sh is not None and recent_sl is not None:
                    ote_upper, ote_lower = ote_zone(recent_sh, recent_sl)
                    close = closes[i]

                    # Price in OTE zone + FVG fill
                    if ote_lower <= close <= ote_upper:
                        for f_idx in range(len(bullish_fvgs)):
                            fvg_bar = int(bullish_fvgs["index"][f_idx])
                            if fvg_bar >= i or i - fvg_bar > 10:
                                continue
                            top = float(bullish_fvgs["top"][f_idx])
                            bottom = float(bullish_fvgs["bottom"][f_idx])
                            if bottom <= close <= top:
                                entry_long[i] = True
                                long_entry_bar = i
                                break

            # ─── Short: premium bias + BSL sweep + bearish MSS + FVG at OTE ─
            if (
                not exited_this_bar_short
                and short_entry_bar < 0
                and pd_list[i] == "premium"
                and (i - last_bsl_sweep) <= self.sweep_window
                and last_bsl_sweep > 0
                and (i - last_bearish_mss) <= self.ote_window
                and last_bearish_mss > last_bsl_sweep  # MSS must come AFTER sweep
            ):
                recent_sh = None
                recent_sl = None
                for j in range(len(sh_indices) - 1, -1, -1):
                    if sh_indices[j] <= i:
                        recent_sh = sh_prices[j]
                        break
                for j in range(len(sl_indices) - 1, -1, -1):
                    if sl_indices[j] <= i:
                        recent_sl = sl_prices[j]
                        break

                if recent_sh is not None and recent_sl is not None:
                    ote_upper, ote_lower = ote_zone(recent_sh, recent_sl)
                    close = closes[i]

                    if ote_lower <= close <= ote_upper:
                        for f_idx in range(len(bearish_fvgs)):
                            fvg_bar = int(bearish_fvgs["index"][f_idx])
                            if fvg_bar >= i or i - fvg_bar > 10:
                                continue
                            top = float(bearish_fvgs["top"][f_idx])
                            bottom = float(bearish_fvgs["bottom"][f_idx])
                            if bottom <= close <= top:
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
        return {
            "htf_lookback": self.htf_lookback,
            "ltf_lookback": self.ltf_lookback,
            "atr_period": self.atr_period,
        }

    def get_default_config(self) -> dict:
        return {"htf_lookback": 20, "ltf_lookback": 5, "atr_period": 14}
