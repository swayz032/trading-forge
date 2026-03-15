"""ICT Quarterly Theory Swing strategy — phase-based entries in premium/discount zones.

One-sentence: Enter on bullish BOS in discount during accumulation/manipulation, or bearish BOS in premium during distribution.
"""

from __future__ import annotations

import polars as pl

from src.engine.strategy_base import BaseStrategy
from src.engine.indicators.market_structure import (
    detect_swings,
    detect_bos,
    compute_premium_discount,
)
from src.engine.indicators.sessions import quarterly_theory


class QuarterlySwingStrategy(BaseStrategy):
    name = "quarterly_swing"
    preferred_regime = "TRENDING_UP"

    def __init__(
        self,
        lookback: int = 5,
        htf_lookback: int = 20,
        quarter_phase_filter: str = "all",
    ):
        self.lookback = lookback
        self.htf_lookback = htf_lookback
        self.quarter_phase_filter = quarter_phase_filter
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

        # Detect swings at two timeframes
        swings = detect_swings(df, self.lookback)
        htf_swings = detect_swings(df, self.htf_lookback)

        # BOS using standard lookback swings
        bos = detect_bos(df, swings)

        # Premium/discount using HTF swings for broader context
        pd_zone = compute_premium_discount(df, htf_swings)

        # Quarterly theory phase
        if "ts_event" in df.columns:
            qt_phase = quarterly_theory(df["ts_event"], self.timeframe)
        else:
            # Fallback: no timestamp, treat all as "all"
            qt_phase = pl.Series("quarterly_phase", ["Q1"] * len(df), dtype=pl.Utf8)

        # Map quarterly phases to ICT concepts:
        # Q1 = Accumulation, Q2 = Manipulation, Q3 = Distribution, Q4 = Continuation
        phase_map = {"Q1": "accumulation", "Q2": "manipulation", "Q3": "distribution", "Q4": "continuation"}

        bos_list = bos.to_list()
        pd_list = pd_zone.to_list()
        qt_list = qt_phase.to_list()

        entry_long = [False] * len(df)
        entry_short = [False] * len(df)
        exit_long = [False] * len(df)
        exit_short = [False] * len(df)

        in_long = False
        in_short = False
        prev_phase = None

        for i in range(len(df)):
            phase = phase_map.get(qt_list[i], "unknown")

            # ── Entry logic ──────────────────────────────────────
            # Long: accumulation or manipulation phase + discount zone + bullish BOS
            long_phase_ok = (
                self.quarter_phase_filter == "all"
                or phase in ("accumulation", "manipulation")
            )
            if long_phase_ok and pd_list[i] == "discount" and bos_list[i] == "bullish":
                entry_long[i] = True
                in_long = True

            # Short: distribution phase + premium zone + bearish BOS
            short_phase_ok = (
                self.quarter_phase_filter == "all"
                or phase == "distribution"
            )
            if short_phase_ok and pd_list[i] == "premium" and bos_list[i] == "bearish":
                entry_short[i] = True
                in_short = True

            # ── Exit logic ───────────────────────────────────────
            # Exit on phase transition
            if prev_phase is not None and phase != prev_phase:
                if in_long:
                    exit_long[i] = True
                    in_long = False
                if in_short:
                    exit_short[i] = True
                    in_short = False

            # Exit on opposing structure break
            if in_long and bos_list[i] == "bearish":
                exit_long[i] = True
                in_long = False
            if in_short and bos_list[i] == "bullish":
                exit_short[i] = True
                in_short = False

            prev_phase = phase

        result = result.with_columns([
            pl.Series("entry_long", entry_long),
            pl.Series("entry_short", entry_short),
            pl.Series("exit_long", exit_long),
            pl.Series("exit_short", exit_short),
            bos.alias("bos"),
            pd_zone.alias("premium_discount"),
            qt_phase.alias("quarterly_phase"),
        ])

        return result

    def get_params(self) -> dict:
        return {
            "lookback": self.lookback,
            "htf_lookback": self.htf_lookback,
            "quarter_phase_filter": self.quarter_phase_filter,
        }

    def get_default_config(self) -> dict:
        return {
            "lookback": 5,
            "htf_lookback": 20,
            "quarter_phase_filter": "all",
        }
