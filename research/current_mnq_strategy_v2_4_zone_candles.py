#!/usr/bin/env python3
"""Zone-aware candlestick interpretation for MNQ v2.4.

A support can only break DOWN; a resistance can only break UP. A candle that
pierces support and closes back above it is a reclaim/rejection, not a bullish
'breakout of support'. Likewise a resistance rejection is not a bearish breakout.
This directional distinction is essential to the trader's zone-first process.
"""
from __future__ import annotations

import pandas as pd

from research.current_mnq_strategy_v2_4_candles import (
    Interaction,
    ZoneCandleDecision,
    classify_patterns,
    geometry,
)


def zone_interaction(last_row, zone_side: str, zone_lo: float, zone_hi: float,
                     pad: float = 0.0) -> Interaction:
    if zone_side not in {"S", "R"}:
        raise ValueError("zone_side must be S or R")
    g = geometry(last_row)
    lo, hi = float(zone_lo) - pad, float(zone_hi) + pad
    if g.high < lo or g.low > hi:
        return Interaction.NONE

    if zone_side == "S":
        # Support failure is a close BELOW support. Trading above the top of the
        # support after touching it is rejection/reclaim, not a breakout signal.
        if g.close < lo:
            return Interaction.BREAK_CLOSE_DOWN
        if g.low < lo and g.close >= lo:
            return Interaction.SWEEP_RECLAIM_UP
        return Interaction.TOUCH

    # Resistance failure is a close ABOVE resistance. Trading below resistance
    # after testing it is rejection/reclaim, not a downside breakout signal.
    if g.close > hi:
        return Interaction.BREAK_CLOSE_UP
    if g.high > hi and g.close <= hi:
        return Interaction.SWEEP_RECLAIM_DOWN
    return Interaction.TOUCH


def evaluate_at_zone(bars: pd.DataFrame, zone_side: str, zone_lo: float,
                     zone_hi: float, pad: float = 0.0) -> ZoneCandleDecision:
    if bars is None or len(bars) == 0:
        return ZoneCandleDecision(False, Interaction.NONE.value, (), False, False,
                                  False, False, False, False, False, "NO_BARS")
    interaction = zone_interaction(bars.iloc[-1], zone_side, zone_lo, zone_hi, pad)
    ev = classify_patterns(bars)
    if interaction == Interaction.NONE:
        return ZoneCandleDecision(
            False, interaction.value, ev.patterns, False, False, ev.indecision,
            False, False, False, False,
            "NO_ZONE_INTERACTION_PATTERN_HAS_ZERO_AUTHORITY",
        )

    last = geometry(bars.iloc[-1])
    bull_control = ev.bullish_reversal or ev.bullish_momentum
    bear_control = ev.bearish_reversal or ev.bearish_momentum

    # A sweep/reclaim is a Fight-state fact, not sufficient by itself. The candle
    # story must still show directional buyer/seller control. This prevents a
    # long-legged doji sweep from being promoted into a trade without takeover.
    rev_long = (
        zone_side == "S"
        and interaction in {Interaction.TOUCH, Interaction.SWEEP_RECLAIM_UP}
        and bull_control
        and not bear_control
        and not (ev.indecision and not ev.bullish_reversal)
    )
    rev_short = (
        zone_side == "R"
        and interaction in {Interaction.TOUCH, Interaction.SWEEP_RECLAIM_DOWN}
        and bear_control
        and not bull_control
        and not (ev.indecision and not ev.bearish_reversal)
    )
    brk_long = (
        zone_side == "R"
        and interaction == Interaction.BREAK_CLOSE_UP
        and (
            ev.bullish_momentum
            or (last.bullish and last.body_frac >= 0.55 and last.close_loc >= 0.70)
        )
    )
    brk_short = (
        zone_side == "S"
        and interaction == Interaction.BREAK_CLOSE_DOWN
        and (
            ev.bearish_momentum
            or (last.bearish and last.body_frac >= 0.55 and last.close_loc <= 0.30)
        )
    )

    if ev.indecision and not (rev_long or rev_short or brk_long or brk_short):
        reason = "ZONE_REACHED_BUT_CONTROL_MIXED_WAIT"
    elif rev_long:
        reason = "SUPPORT_REJECTION_BUYER_CONTROL"
    elif rev_short:
        reason = "RESISTANCE_REJECTION_SELLER_CONTROL"
    elif brk_long:
        reason = "RESISTANCE_BREAK_BULLISH_ACCEPTANCE"
    elif brk_short:
        reason = "SUPPORT_BREAK_BEARISH_ACCEPTANCE"
    else:
        reason = "ZONE_REACHED_NO_CONFIRMED_DIRECTIONAL_CONTROL"

    return ZoneCandleDecision(
        True, interaction.value, ev.patterns, bull_control, bear_control,
        ev.indecision, rev_long, rev_short, brk_long, brk_short, reason,
    )
