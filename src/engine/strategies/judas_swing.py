"""ICT Judas Swing strategy — fade the fake opening move after MSS confirms reversal.

One-sentence: Detect the fake opening move (first 15-30 min direction), wait for MSS
to confirm reversal, then enter on FVG in the OPPOSITE direction of the fake move.

Key concept: The "Judas" move is a deceptive opening direction designed to trap retail
traders. Smart money creates the fake move to build liquidity, then reverses to trade
in the real direction. The MSS confirms the reversal is institutional.

Applies to: London open (2:00-5:00 ET) and NY AM open (8:30-11:00 ET).
"""

from __future__ import annotations

import polars as pl

from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.core import compute_atr
from src.engine.indicators.market_structure import detect_swings, detect_mss
from src.engine.indicators.price_delivery import detect_fvg
from src.engine.indicators.sessions import is_nyam_killzone, is_london_killzone


class JudasSwingStrategy(BaseStrategy):
    name = "judas_swing"
    preferred_regime = None

    def __init__(
        self,
        swing_lookback: int = 3,
        atr_period: int = 14,
        fvg_window: int = 5,
        opening_bars: int = 6,  # ~30 min on 5min chart
    ):
        self.swing_lookback = swing_lookback
        self.atr_period = atr_period
        self.fvg_window = fvg_window
        self.opening_bars = opening_bars
        self.symbol = "ES"
        self.timeframe = "5min"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        result = df.clone()
        n = len(df)

        swings = detect_swings(df, self.swing_lookback)
        mss = detect_mss(df, swings)
        fvgs = detect_fvg(df)
        atr = compute_atr(df, self.atr_period)

        entry_long = [False] * n
        entry_short = [False] * n
        exit_long = [False] * n
        exit_short = [False] * n

        # Session filters
        if "ts_event" in df.columns:
            nyam = is_nyam_killzone(df["ts_event"]).to_list()
            london = is_london_killzone(df["ts_event"]).to_list()
            _ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
            hours = df[_ts_col].dt.hour().to_list()
            minutes = df[_ts_col].dt.minute().to_list()
        else:
            nyam = [True] * n
            london = [False] * n
            hours = [9] * n
            minutes = [0] * n

        mss_list = mss.to_list()
        closes = df["close"].to_list()
        highs = df["high"].to_list()
        lows = df["low"].to_list()
        bullish_fvgs = fvgs.filter(pl.col("type") == "bullish")
        bearish_fvgs = fvgs.filter(pl.col("type") == "bearish")

        # ─── Track fake opening moves per session ─────────────
        # For each session (London/NY), track the first N bars' direction
        # The "fake move" direction is the direction of the opening push

        # Session boundaries: London starts at hour 2, NY at hour 8
        # We track: session_open_high, session_open_low, opening_move_direction
        current_session = None
        session_start_bar = -1
        session_open_high = 0.0
        session_open_low = 999999.0
        opening_move_dir = None  # "bullish" or "bearish" — this is the FAKE direction
        mss_confirmed = False  # MSS that opposes the fake move

        long_entry_bar = -1
        short_entry_bar = -1

        for i in range(n):
            h, m = hours[i], minutes[i]
            t_minutes = h * 60 + m

            # Detect session boundaries
            new_session = None
            if london[i] and (current_session != "london" or not london[max(0, i - 1)]):
                new_session = "london"
            elif nyam[i] and h == 8 and m <= 35 and current_session != "nyam":
                new_session = "nyam"

            if new_session is not None:
                current_session = new_session
                session_start_bar = i
                session_open_high = highs[i]
                session_open_low = lows[i]
                opening_move_dir = None
                mss_confirmed = False

            # Track opening range (first N bars of session)
            if session_start_bar >= 0 and 0 < (i - session_start_bar) <= self.opening_bars:
                if highs[i] > session_open_high:
                    session_open_high = highs[i]
                if lows[i] < session_open_low:
                    session_open_low = lows[i]

                # After opening bars complete, determine fake move direction
                if (i - session_start_bar) == self.opening_bars:
                    open_price = closes[session_start_bar]
                    close_price = closes[i]
                    if close_price > open_price:
                        opening_move_dir = "bullish"  # fake move was UP → real move DOWN
                    elif close_price < open_price:
                        opening_move_dir = "bearish"  # fake move was DOWN → real move UP
                    else:
                        opening_move_dir = None  # no clear direction

            # Track MSS that OPPOSES the fake move (confirms reversal)
            if opening_move_dir is not None and mss_list[i] is not None:
                if opening_move_dir == "bullish" and mss_list[i] == "bearish":
                    # Fake move was bullish, MSS confirms bearish reversal
                    mss_confirmed = True
                elif opening_move_dir == "bearish" and mss_list[i] == "bullish":
                    # Fake move was bearish, MSS confirms bullish reversal
                    mss_confirmed = True

            exited_this_bar_long = False
            exited_this_bar_short = False

            # ─── Exit checks first ─────────────────────────────
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

            # ─── Entry: only after opening move identified + MSS confirmed ──
            if not (nyam[i] or london[i]):
                continue
            if opening_move_dir is None or not mss_confirmed:
                continue

            # Long entry: fake move was BEARISH, MSS confirmed BULLISH reversal
            if (
                not exited_this_bar_long
                and long_entry_bar < 0
                and opening_move_dir == "bearish"
            ):
                close = closes[i]
                for f_idx in range(len(bullish_fvgs)):
                    fvg_bar = int(bullish_fvgs["index"][f_idx])
                    if fvg_bar >= i or i - fvg_bar > self.fvg_window:
                        continue
                    top = float(bullish_fvgs["top"][f_idx])
                    bottom = float(bullish_fvgs["bottom"][f_idx])
                    if bottom <= close <= top:
                        entry_long[i] = True
                        long_entry_bar = i
                        break

            # Short entry: fake move was BULLISH, MSS confirmed BEARISH reversal
            if (
                not exited_this_bar_short
                and short_entry_bar < 0
                and opening_move_dir == "bullish"
            ):
                close = closes[i]
                for f_idx in range(len(bearish_fvgs)):
                    fvg_bar = int(bearish_fvgs["index"][f_idx])
                    if fvg_bar >= i or i - fvg_bar > self.fvg_window:
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
            "swing_lookback": self.swing_lookback,
            "atr_period": self.atr_period,
            "fvg_window": self.fvg_window,
            "opening_bars": self.opening_bars,
        }

    def get_default_config(self) -> dict:
        return {"swing_lookback": 3, "atr_period": 14, "fvg_window": 5, "opening_bars": 6}
