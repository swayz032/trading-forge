"""ICT Quarterly Theory Swing strategy — session-based phase entries.

One-sentence: Enter during Q3 (NY AM distribution) after Q2 (London manipulation)
sweeps liquidity, confirmed by displacement + BOS, using True Open as directional filter.
"""

from __future__ import annotations

import polars as pl

from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.market_structure import (
    detect_swings,
    detect_bos,
    compute_premium_discount,
)
from src.engine.indicators.price_delivery import detect_displacement
from src.engine.indicators.liquidity import (
    detect_buyside_liquidity,
    detect_sellside_liquidity,
    detect_sweep,
)


# ─── Daily Quarterly Theory session boundaries (ET hours) ─────────
# Q1 = Asia     18:00 - 00:00  (accumulation)
# Q2 = London   00:00 - 06:00  (manipulation / Judas swing)
# Q3 = NY AM    06:00 - 12:00  (distribution / real move) ← ENTRY PHASE
# Q4 = NY PM    12:00 - 18:00  (continuation / reversal)

Q1_START, Q1_END = 18, 0   # wraps midnight
Q2_START, Q2_END = 0, 6
Q3_START, Q3_END = 6, 12
Q4_START, Q4_END = 12, 18


def _daily_quarter_phase(ts: pl.Series) -> pl.Series:
    """Map each bar to its daily quarter phase based on 6-hour sessions.

    Returns:
        Series of str: "Q1", "Q2", "Q3", or "Q4".
    """
    hour = ts.dt.hour()

    # Q1: 18:00 - 23:59 (hour >= 18)
    # Q2: 00:00 - 05:59 (hour >= 0 and hour < 6)
    # Q3: 06:00 - 11:59 (hour >= 6 and hour < 12)
    # Q4: 12:00 - 17:59 (hour >= 12 and hour < 18)
    phase_expr = (
        pl.when(pl.col("__hour") >= 18).then(pl.lit("Q1"))
        .when(pl.col("__hour") < 6).then(pl.lit("Q2"))
        .when(pl.col("__hour") < 12).then(pl.lit("Q3"))
        .otherwise(pl.lit("Q4"))
        .alias("quarterly_phase")
    )
    return hour.to_frame("__hour").select(phase_expr).to_series()


def _compute_true_open(df: pl.DataFrame) -> pl.Series:
    """Compute the True Open — opening price at Q2 start (London open, ~00:00 ET).

    For each trading day, the True Open is the first bar's open price
    where hour < 6 (Q2 London session start).

    Returns:
        Series of float: True Open price for each bar.
    """
    _ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
    hour = df[_ts_col].dt.hour()

    # Trading day date: bars from 18:00-23:59 belong to the NEXT trading day
    # Bars from 00:00-17:59 belong to the current calendar date
    date = df[_ts_col].dt.date()

    opens = df["open"].to_list()
    hours = hour.to_list()
    dates = date.to_list()

    # For each trading day, find the first Q2 bar's open price
    true_opens_by_date: dict = {}
    for i in range(len(df)):
        d = dates[i]
        h = hours[i]
        # Q2 starts at hour 0 — find first bar of Q2 for each date
        if 0 <= h < 6 and d not in true_opens_by_date:
            true_opens_by_date[d] = opens[i]

    # Map back to each bar
    result = []
    for i in range(len(df)):
        d = dates[i]
        h = hours[i]
        # Q1 bars (18:00-23:59) map to the NEXT calendar date's True Open
        if h >= 18:
            # This is tricky — we need the next day's Q2 open
            # For now, use None (these bars are accumulation, not entry bars)
            import datetime
            next_d = d + datetime.timedelta(days=1)
            result.append(true_opens_by_date.get(next_d))
        else:
            result.append(true_opens_by_date.get(d))

    return pl.Series("true_open", result, dtype=pl.Float64)


class QuarterlySwingStrategy(BaseStrategy):
    name = "quarterly_swing"
    preferred_regime = "TRENDING_UP"

    def __init__(
        self,
        lookback: int = 5,
        htf_lookback: int = 20,
        disp_atr_mult: float = 2.0,
    ):
        self.lookback = lookback
        self.htf_lookback = htf_lookback
        self.disp_atr_mult = disp_atr_mult
        self.symbol = "ES"
        self.timeframe = "1h"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        result = df.clone()

        if len(df) < self.htf_lookback * 2:
            result = result.with_columns([
                pl.lit(False).alias("entry_long"),
                pl.lit(False).alias("entry_short"),
                pl.lit(False).alias("exit_long"),
                pl.lit(False).alias("exit_short"),
            ])
            return result

        # ── Indicators ────────────────────────────────────────────
        # Swing detection at two timeframes
        swings = detect_swings(df, self.lookback)
        htf_swings = detect_swings(df, self.htf_lookback)

        # BOS for entry confirmation
        bos = detect_bos(df, swings)

        # Premium/discount for additional confluence
        pd_zone = compute_premium_discount(df, htf_swings)

        # Displacement detection
        displacement = detect_displacement(df, atr_mult=self.disp_atr_mult)

        # Liquidity levels and sweeps
        bsl = detect_buyside_liquidity(df, swings)
        ssl = detect_sellside_liquidity(df, swings)
        bsl_sweep = detect_sweep(df, bsl)
        ssl_sweep = detect_sweep(df, ssl)

        # ── Session phase detection (6-hour daily quarters) ───────
        if "ts_event" not in df.columns:
            # No timestamp — cannot determine session phases, return empty signals
            result = result.with_columns([
                pl.lit(False).alias("entry_long"),
                pl.lit(False).alias("entry_short"),
                pl.lit(False).alias("exit_long"),
                pl.lit(False).alias("exit_short"),
            ])
            return result

        _ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
        qt_phase = _daily_quarter_phase(df[_ts_col])
        true_open = _compute_true_open(df)

        # ── Convert to lists for row-level logic ──────────────────
        phase_list = qt_phase.to_list()
        bos_list = bos.to_list()
        pd_list = pd_zone.to_list()
        disp_list = displacement.to_list()
        bsl_sweep_list = bsl_sweep.to_list()
        ssl_sweep_list = ssl_sweep.to_list()
        true_open_list = true_open.to_list()
        close_list = df["close"].to_list()
        high_list = df["high"].to_list()
        low_list = df["low"].to_list()

        entry_long = [False] * len(df)
        entry_short = [False] * len(df)
        exit_long = [False] * len(df)
        exit_short = [False] * len(df)

        in_long = False
        in_short = False
        prev_phase = None

        # Track Q2 manipulation state per trading day
        q2_swept_ssl = False   # Q2 swept sellside -> bullish bias
        q2_swept_bsl = False   # Q2 swept buyside -> bearish bias
        q2_manip_low = None    # Lowest low during Q2 (SL reference for longs)
        q2_manip_high = None   # Highest high during Q2 (SL reference for shorts)

        for i in range(len(df)):
            phase = phase_list[i]
            to_price = true_open_list[i]

            # Guard: prevent entry on same bar as exit
            exited_this_bar_long = False
            exited_this_bar_short = False

            # ── Phase transition tracking ─────────────────────────
            if prev_phase is not None and phase != prev_phase:
                # Reset manipulation tracking on Q1 -> Q2 transition
                if phase == "Q2":
                    q2_swept_ssl = False
                    q2_swept_bsl = False
                    q2_manip_low = None
                    q2_manip_high = None

            # ── Q2: Track manipulation (liquidity sweeps) ─────────
            if phase == "Q2":
                if ssl_sweep_list[i]:
                    q2_swept_ssl = True
                if bsl_sweep_list[i]:
                    q2_swept_bsl = True
                # Track Q2 extremes for stop reference
                if q2_manip_low is None or low_list[i] < q2_manip_low:
                    q2_manip_low = low_list[i]
                if q2_manip_high is None or high_list[i] > q2_manip_high:
                    q2_manip_high = high_list[i]

            # ── Exit logic (process first) ────────────────────────
            # Exit on Q3 -> Q4 transition (distribution ending)
            if prev_phase == "Q3" and phase == "Q4":
                if in_long:
                    exit_long[i] = True
                    in_long = False
                    exited_this_bar_long = True
                if in_short:
                    exit_short[i] = True
                    in_short = False
                    exited_this_bar_short = True

            # Exit on opposing BOS during Q3
            if in_long and bos_list[i] == "bearish":
                exit_long[i] = True
                in_long = False
                exited_this_bar_long = True
            if in_short and bos_list[i] == "bullish":
                exit_short[i] = True
                in_short = False
                exited_this_bar_short = True

            # ── Entry logic (Q3 ONLY — distribution phase) ────────
            if phase == "Q3" and to_price is not None:

                # LONG: Q2 swept SSL (sellside) + price below True Open
                #       + bullish BOS or displacement + optional discount
                long_ok = (
                    not exited_this_bar_long
                    and not in_long
                    and q2_swept_ssl
                    and close_list[i] < to_price
                    and (bos_list[i] == "bullish" or disp_list[i] == "bullish")
                )
                if long_ok:
                    entry_long[i] = True
                    in_long = True

                # SHORT: Q2 swept BSL (buyside) + price above True Open
                #        + bearish BOS or displacement + optional premium
                short_ok = (
                    not exited_this_bar_short
                    and not in_short
                    and q2_swept_bsl
                    and close_list[i] > to_price
                    and (bos_list[i] == "bearish" or disp_list[i] == "bearish")
                )
                if short_ok:
                    entry_short[i] = True
                    in_short = True

            prev_phase = phase

        result = result.with_columns([
            pl.Series("entry_long", entry_long),
            pl.Series("entry_short", entry_short),
            pl.Series("exit_long", exit_long),
            pl.Series("exit_short", exit_short),
            bos.alias("bos"),
            pd_zone.alias("premium_discount"),
            qt_phase,
            true_open,
            displacement.alias("displacement"),
            bsl_sweep.alias("bsl_sweep"),
            ssl_sweep.alias("ssl_sweep"),
        ])

        return result

    def get_params(self) -> dict:
        return {
            "lookback": self.lookback,
            "htf_lookback": self.htf_lookback,
            "disp_atr_mult": self.disp_atr_mult,
        }

    def get_default_config(self) -> dict:
        return {
            "lookback": 5,
            "htf_lookback": 20,
            "disp_atr_mult": 2.0,
        }
