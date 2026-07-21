"""ICT Equal Highs/Lows Raid strategy — sweep of equal levels + reversal confirmation.

One-sentence: Enter when price sweeps equal highs/lows liquidity and MSS or CHoCH confirms reversal.
"""

from __future__ import annotations

import polars as pl

from src.engine.indicators.liquidity import (
    detect_buyside_liquidity,
    detect_equal_highs,
    detect_equal_lows,
    detect_sellside_liquidity,
)
from src.engine.indicators.market_structure import (
    detect_choch,
    detect_mss,
    detect_swings,
)
from src.engine.strategy_base import BaseStrategy


class EqhlRaidStrategy(BaseStrategy):
    name = "eqhl_raid"
    preferred_regime = None  # works in all regimes

    def __init__(
        self,
        tolerance: float = 0.5,
        lookback: int = 5,
        reversal_bars: int = 3,
    ):
        self.tolerance = tolerance
        self.lookback = lookback
        self.reversal_bars = reversal_bars
        self.symbol = "MES"
        self.timeframe = "15min"

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

        swings = detect_swings(df, self.lookback)

        # Detect equal highs/lows with given tolerance
        eqh = detect_equal_highs(df, self.tolerance)
        eql = detect_equal_lows(df, self.tolerance)

        # Reversal confirmation indicators
        choch = detect_choch(df, swings)
        mss = detect_mss(df, swings)

        # Opposing liquidity for exit targets
        bsl = detect_buyside_liquidity(df, swings)
        ssl = detect_sellside_liquidity(df, swings)

        highs = df["high"].to_list()
        lows = df["low"].to_list()
        closes = df["close"].to_list()
        choch_list = choch.to_list()
        mss_list = mss.to_list()

        # Pre-compute equal high/low levels and their latest bar indices
        eqh_levels = []  # (max_index, price)
        for row_i in range(len(eqh)):
            idx_b = int(eqh["index_b"][row_i])
            price = float(eqh["price"][row_i])
            eqh_levels.append((idx_b, price))

        eql_levels = []  # (max_index, price)
        for row_i in range(len(eql)):
            idx_b = int(eql["index_b"][row_i])
            price = float(eql["price"][row_i])
            eql_levels.append((idx_b, price))

        # BSL/SSL levels for exit targets — kept as (creation_index, price) pairs
        # so target selection below can gate on causal existence at bar i, the
        # same convention already used for the entry-side eql_levels/eqh_levels
        # gate above (`if idx_b >= i: continue`). A level's `index` is its
        # cluster's CREATION bar (see liquidity.py's _cluster_swings_causal) —
        # picking a level whose creation index is >= the entry bar means the
        # trade would be targeting a price level that did not exist yet.
        bsl_levels = list(zip(bsl["index"].to_list(), bsl["price"].to_list(), strict=True)) if len(bsl) > 0 else []
        ssl_levels = list(zip(ssl["index"].to_list(), ssl["price"].to_list(), strict=True)) if len(ssl) > 0 else []

        entry_long = [False] * len(df)
        entry_short = [False] * len(df)
        exit_long = [False] * len(df)
        exit_short = [False] * len(df)

        # Track sweep events for reversal confirmation window
        last_eql_sweep_bar = -999
        last_eqh_sweep_bar = -999

        in_long = False
        long_target = None
        in_short = False
        short_target = None

        for i in range(len(df)):
            # ── Detect sweeps of equal lows (price wicks below) ──
            for idx_b, price in eql_levels:
                if idx_b >= i:
                    continue
                if lows[i] < price and closes[i] > price:
                    last_eql_sweep_bar = i

            # ── Detect sweeps of equal highs (price wicks above) ──
            for idx_b, price in eqh_levels:
                if idx_b >= i:
                    continue
                if highs[i] > price and closes[i] < price:
                    last_eqh_sweep_bar = i

            # Guard: prevent entry on same bar as exit (vectorbt drops the entry)
            exited_this_bar_long = False
            exited_this_bar_short = False

            # ── Exit long first: reach BSL target or bearish structure break ──
            if in_long:
                hit_target = long_target is not None and highs[i] >= long_target
                bearish_break = choch_list[i] == "bearish" or mss_list[i] == "bearish"
                if hit_target or bearish_break:
                    exit_long[i] = True
                    in_long = False
                    long_target = None
                    exited_this_bar_long = True

            # ── Exit short first: reach SSL target or bullish structure break ──
            if in_short:
                hit_target = short_target is not None and lows[i] <= short_target
                bullish_break = choch_list[i] == "bullish" or mss_list[i] == "bullish"
                if hit_target or bullish_break:
                    exit_short[i] = True
                    in_short = False
                    short_target = None
                    exited_this_bar_short = True

            # ── Entry long: EQL sweep within reversal_bars + bullish CHoCH or MSS ──
            if (
                not exited_this_bar_long
                and not in_long
                and not in_short
                and 0 < (i - last_eql_sweep_bar) <= self.reversal_bars
                and (choch_list[i] == "bullish" or mss_list[i] == "bullish")
            ):
                entry_long[i] = True
                in_long = True
                # Target = nearest BSL above close, restricted to levels whose
                # creation index is causally before this bar (idx_b < i, same
                # gate form as the entry-side sweep loops above). If gating
                # empties the eligible set, long_target stays None — NO
                # fallback substitution (see module docstring / packet
                # PROHIBITED clause): the position then enters with no
                # take-profit and relies solely on the bearish CHoCH/MSS
                # structure-break exit below.
                long_target = None
                eligible_bsl = sorted(
                    price for idx_b, price in bsl_levels if idx_b < i and price > closes[i]
                )
                if eligible_bsl:
                    long_target = eligible_bsl[0]

            # ── Entry short: EQH sweep within reversal_bars + bearish CHoCH or MSS ──
            if (
                not exited_this_bar_short
                and not in_short
                and not in_long
                and 0 < (i - last_eqh_sweep_bar) <= self.reversal_bars
                and (choch_list[i] == "bearish" or mss_list[i] == "bearish")
            ):
                entry_short[i] = True
                in_short = True
                # Mirror of the long-side gate above: nearest SSL below close,
                # restricted to idx_b < i. No fallback if gating empties the
                # set — enters with no take-profit, relies on the bullish
                # CHoCH/MSS structure-break exit below.
                short_target = None
                eligible_ssl = sorted(
                    (price for idx_b, price in ssl_levels if idx_b < i and price < closes[i]),
                    reverse=True,
                )
                if eligible_ssl:
                    short_target = eligible_ssl[0]

        result = result.with_columns([
            pl.Series("entry_long", entry_long),
            pl.Series("entry_short", entry_short),
            pl.Series("exit_long", exit_long),
            pl.Series("exit_short", exit_short),
            choch.alias("choch"),
            mss.alias("mss"),
        ])

        return result

    def get_params(self) -> dict:
        return {
            "tolerance": self.tolerance,
            "lookback": self.lookback,
            "reversal_bars": self.reversal_bars,
        }

    def get_default_config(self) -> dict:
        return {
            "tolerance": 0.5,
            "lookback": 5,
            "reversal_bars": 3,
        }
