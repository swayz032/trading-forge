"""ICT Unicorn strategy — Breaker Block + FVG overlap (Unicorn Zone).

One-sentence: Enter when price retraces to a zone where a displacement-created FVG
overlaps a Breaker Block, with stop beyond the breaker and target at opposing swing.

Setup sequence (per ICT methodology):
1. Swing structure -> Order Block forms at swing point
2. OB is broken through with displacement -> becomes Breaker Block
3. FVG forms during the displacement that overlaps the Breaker range
4. Overlap zone = Unicorn Zone
5. Enter on retrace into the Unicorn Zone
6. SL beyond breaker boundary, TP at opposing swing / next liquidity level
"""

from __future__ import annotations

import polars as pl

from src.engine.indicators.core import compute_atr
from src.engine.indicators.market_structure import detect_swings
from src.engine.indicators.order_flow import detect_bearish_ob, detect_breaker, detect_bullish_ob
from src.engine.indicators.price_delivery import detect_displacement, detect_fvg
from src.engine.strategy_base import BaseStrategy


class UnicornStrategy(BaseStrategy):
    name = "unicorn"
    preferred_regime = "TRENDING"

    def __init__(
        self,
        swing_lookback: int = 5,
        atr_period: int = 14,
        max_zone_age: int = 20,
        atr_sl_mult: float = 0.5,
        max_hold_bars: int = 40,
    ):
        self.swing_lookback = swing_lookback
        self.atr_period = atr_period
        self.max_zone_age = max_zone_age
        self.atr_sl_mult = atr_sl_mult
        self.max_hold_bars = max_hold_bars
        self.symbol = "MES"
        self.timeframe = "15min"

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        result = df.clone()
        n = len(df)

        swings = detect_swings(df, self.swing_lookback)
        fvgs = detect_fvg(df)
        atr = compute_atr(df, self.atr_period)
        displacement = detect_displacement(df, atr_mult=1.5, atr_period=self.atr_period)

        # Get order blocks and breakers
        bull_obs = detect_bullish_ob(df, swings, lookback=self.swing_lookback)
        bear_obs = detect_bearish_ob(df, swings, lookback=self.swing_lookback)

        all_obs_list = []
        if len(bull_obs) > 0:
            all_obs_list.append(bull_obs)
        if len(bear_obs) > 0:
            all_obs_list.append(bear_obs)

        if all_obs_list:
            all_obs = pl.concat(all_obs_list)
            breakers = detect_breaker(df, all_obs)
        else:
            breakers = pl.DataFrame(schema={
                "index": pl.Int64, "top": pl.Float64, "bottom": pl.Float64,
                "type": pl.Utf8, "broken_at": pl.Int64,
            })

        # Pre-compute displacement list for validation
        disp_list = displacement.to_list()
        closes = df["close"].to_list()
        atr_list = atr.to_list()

        # ─── Build Unicorn Zones ──────────────────────────────────
        # A Unicorn Zone = Breaker Block + FVG overlap where:
        #   1. FVG formed near or at the breaker break point (displacement)
        #   2. FVG type aligns with breaker type (bullish-bullish, bearish-bearish)
        #   3. FVG range overlaps breaker range

        unicorn_zones = []

        # Defect-10 fix (streaming validity, no look-ahead): the OLD code
        # computed two batch booleans ("any matching displacement in
        # [b_broken_at-1, b_broken_at+1]" and "first FVG within ±5 bars of
        # b_broken_at") and then admitted retests starting at `formed_at+1`
        # (=b_broken_at+1) regardless of whether the displacement/FVG evidence
        # that VALIDATES the zone actually existed yet at that bar — an entry
        # at b_broken_at+1 could be justified by an FVG that only forms at
        # b_broken_at+5 (its own future). The fix instead records, per zone,
        # `valid_from` = the LATER of (a) the earliest matching displacement
        # bar and (b) the confirming FVG's own bar — the zone is only
        # genuinely "known" once BOTH pieces of evidence exist. Entries are
        # then gated on `t >= valid_from` in addition to the existing
        # `formed >= i` check. Direct bar-indexing — no half_window/lag
        # offset (L=0 axis; see test_l0_axis_truncated_replay_contract in
        # test_audit_a12.py). Strictly entry-SUPPRESSING relative to the old
        # behavior (streaming_trades ⊆ batch_trades).
        for b_idx in range(len(breakers)):
            b_type = str(breakers["type"][b_idx])
            b_top = float(breakers["top"][b_idx])
            b_bottom = float(breakers["bottom"][b_idx])
            b_broken_at = int(breakers["broken_at"][b_idx])

            # Validate displacement at the break point — earliest matching
            # bar in the window (ascending scan => first hit IS earliest;
            # never-valid sentinel = None when no match exists).
            disp_valid_from = None
            # Displacement must exist by the break bar; future displacement
            # cannot retroactively create a tradeable Unicorn zone.
            for d in range(max(0, b_broken_at - 1), min(n, b_broken_at + 1)):
                d_val = disp_list[d]
                if d_val is not None:
                    # Displacement direction must match breaker direction
                    if b_type == "bullish_breaker" and d_val == "bullish":
                        disp_valid_from = d
                        break
                    elif b_type == "bearish_breaker" and d_val == "bearish":
                        disp_valid_from = d
                        break

            if disp_valid_from is None:
                continue

            # Find FVGs that overlap with this breaker
            # FVG must: (a) overlap breaker range, (b) align directionally,
            # (c) form near the break point
            fvg_type_needed = "bullish" if b_type == "bullish_breaker" else "bearish"

            for f_idx in range(len(fvgs)):
                f_type = str(fvgs["type"][f_idx])
                if f_type != fvg_type_needed:
                    continue

                f_bar = int(fvgs["index"][f_idx])
                f_top = float(fvgs["top"][f_idx])
                f_bottom = float(fvgs["bottom"][f_idx])

                # FVG should form near the break point, but never AFTER the earliest
                # bar this zone can be entered on (b_broken_at + 1). The displacement
                # that breaks the OB precedes/coincides with the break, so allow up to
                # 5 bars BEFORE b_broken_at but zero bars after — a symmetric +/-5
                # window would let zone existence read FVG data from the zone's own
                # future (up to b_broken_at + 5), which is the look-ahead bug.
                if f_bar > b_broken_at or f_bar < b_broken_at - 5:
                    continue

                # Check overlap: min(tops) > max(bottoms)
                overlap_top = min(b_top, f_top)
                overlap_bottom = max(b_bottom, f_bottom)
                if overlap_top <= overlap_bottom:
                    continue

                # Zone is only knowable once BOTH the displacement AND this
                # specific overlapping FVG are confirmed — valid_from is the
                # LATER of the two confirming bars (streaming validity).
                zone_valid_from = max(disp_valid_from, f_bar)

                # Valid Unicorn Zone found
                unicorn_zones.append({
                    "type": b_type,
                    "zone_top": overlap_top,
                    "zone_bottom": overlap_bottom,
                    "breaker_top": b_top,
                    "breaker_bottom": b_bottom,
                    "formed_at": b_broken_at,
                    "valid_from": zone_valid_from,
                })
                break  # one FVG match per breaker is sufficient

        # ─── Generate signals ─────────────────────────────────────
        entry_long = [False] * n
        entry_short = [False] * n
        exit_long = [False] * n
        exit_short = [False] * n

        # Track open position state for exit logic
        long_entry_bar = -1
        long_breaker_bottom = 0.0
        long_atr_at_entry = 0.0
        short_entry_bar = -1
        short_breaker_top = 0.0
        short_atr_at_entry = 0.0

        for i in range(n):
            close = closes[i]
            atr_val = atr_list[i]
            if atr_val is None or atr_val != atr_val:
                atr_val = 0.0

            exited_this_bar_long = False
            exited_this_bar_short = False

            # ─── Exit checks first ────────────────────────────────
            if long_entry_bar >= 0:
                bars_held = i - long_entry_bar
                # SL: price closes below breaker bottom minus ATR buffer
                sl_level = long_breaker_bottom - (self.atr_sl_mult * long_atr_at_entry)
                if close < sl_level or bars_held >= self.max_hold_bars:
                    exit_long[i] = True
                    long_entry_bar = -1
                    exited_this_bar_long = True

            if short_entry_bar >= 0:
                bars_held = i - short_entry_bar
                # SL: price closes above breaker top plus ATR buffer
                sl_level = short_breaker_top + (self.atr_sl_mult * short_atr_at_entry)
                if close > sl_level or bars_held >= self.max_hold_bars:
                    exit_short[i] = True
                    short_entry_bar = -1
                    exited_this_bar_short = True

            # ─── Entry checks (only if flat, not exited this bar) ─
            for zone in unicorn_zones:
                formed = zone["formed_at"]

                # Zone must be formed in the past and not too old
                if formed >= i:
                    continue
                if i - formed > self.max_zone_age:
                    continue

                # Streaming validity gate (Defect-10 fix): the zone is not
                # tradeable until its confirming evidence bar (displacement +
                # FVG), which may be strictly later than `formed`.
                if i < zone["valid_from"]:
                    continue

                # Zone invalidation: check if price already closed past
                # breaker boundary since formation (zone is dead)
                invalidated = False
                for j in range(formed + 1, i):
                    if zone["type"] == "bullish_breaker" and closes[j] < zone["breaker_bottom"]:
                        invalidated = True
                        break
                    elif zone["type"] == "bearish_breaker" and closes[j] > zone["breaker_top"]:
                        invalidated = True
                        break
                if invalidated:
                    continue

                # Entry: price retraces into the Unicorn Zone
                if zone["type"] == "bullish_breaker" and long_entry_bar < 0 and not exited_this_bar_long:
                    if zone["zone_bottom"] <= close <= zone["zone_top"]:
                        entry_long[i] = True
                        long_entry_bar = i
                        long_breaker_bottom = zone["breaker_bottom"]
                        long_atr_at_entry = atr_val
                        break

                elif zone["type"] == "bearish_breaker" and short_entry_bar < 0 and not exited_this_bar_short:
                    if zone["zone_bottom"] <= close <= zone["zone_top"]:
                        entry_short[i] = True
                        short_entry_bar = i
                        short_breaker_top = zone["breaker_top"]
                        short_atr_at_entry = atr_val
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
            "max_zone_age": self.max_zone_age,
            "atr_sl_mult": self.atr_sl_mult,
            "max_hold_bars": self.max_hold_bars,
        }

    def get_default_config(self) -> dict:
        return {
            "swing_lookback": 5,
            "atr_period": 14,
            "max_zone_age": 20,
            "atr_sl_mult": 0.5,
            "max_hold_bars": 40,
        }
