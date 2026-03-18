"""Structural Stop Placement — Replaces ATR-only stops with structure-based invalidation.

Priority: sweep_wick > order_block > FVG > swing_point
Buffer: max(instrument_min, ATR(14) × 0.10)
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np


@dataclass
class StopPlan:
    stop_price: float
    stop_reason: str       # "sweep_wick" | "order_block" | "fvg" | "swing_point" | "atr_fallback"
    buffer: float
    risk_dollars: float    # (entry - stop) × contracts × point_value
    session_adjustment: float  # 1.0 normal, 1.5× during session transitions


def compute_structural_stop(
    direction: str,         # "long" | "short"
    entry_price: float,
    point_value: float,
    atr: float,
    tick_size: float,
    # Structural levels (pre-computed from indicator modules)
    nearest_ob_below: Optional[float] = None,  # For longs: OB bottom below entry
    nearest_ob_above: Optional[float] = None,  # For shorts: OB top above entry
    nearest_fvg_below: Optional[float] = None,
    nearest_fvg_above: Optional[float] = None,
    nearest_swing_low: Optional[float] = None,
    nearest_swing_high: Optional[float] = None,
    sweep_wick_low: Optional[float] = None,    # Wick of a recent sweep candle
    sweep_wick_high: Optional[float] = None,
    session_transition: bool = False,
) -> StopPlan:
    """Compute structural stop placement.

    For LONGS: stop goes BELOW structure (sweep wick > OB bottom > FVG bottom > swing low)
    For SHORTS: stop goes ABOVE structure (sweep wick > OB top > FVG top > swing high)
    """
    buffer = max(tick_size, atr * 0.10)
    session_adj = 1.5 if session_transition else 1.0
    buffer *= session_adj

    stop_price = None
    stop_reason = "atr_fallback"

    if direction == "long":
        # Priority: sweep_wick > OB > FVG > swing_low > ATR fallback
        candidates = []
        if sweep_wick_low is not None and sweep_wick_low < entry_price:
            candidates.append((sweep_wick_low - buffer, "sweep_wick"))
        if nearest_ob_below is not None and nearest_ob_below < entry_price:
            candidates.append((nearest_ob_below - buffer, "order_block"))
        if nearest_fvg_below is not None and nearest_fvg_below < entry_price:
            candidates.append((nearest_fvg_below - buffer, "fvg"))
        if nearest_swing_low is not None and nearest_swing_low < entry_price:
            candidates.append((nearest_swing_low - buffer, "swing_point"))

        if candidates:
            # Pick the CLOSEST structural stop below entry (highest price)
            candidates.sort(key=lambda x: -x[0])
            stop_price, stop_reason = candidates[0]
        else:
            # ATR fallback: 1.5× ATR below entry
            stop_price = entry_price - (atr * 1.5 * session_adj)
            stop_reason = "atr_fallback"

    else:  # short
        candidates = []
        if sweep_wick_high is not None and sweep_wick_high > entry_price:
            candidates.append((sweep_wick_high + buffer, "sweep_wick"))
        if nearest_ob_above is not None and nearest_ob_above > entry_price:
            candidates.append((nearest_ob_above + buffer, "order_block"))
        if nearest_fvg_above is not None and nearest_fvg_above > entry_price:
            candidates.append((nearest_fvg_above + buffer, "fvg"))
        if nearest_swing_high is not None and nearest_swing_high > entry_price:
            candidates.append((nearest_swing_high + buffer, "swing_point"))

        if candidates:
            # Pick the CLOSEST structural stop above entry (lowest price)
            candidates.sort(key=lambda x: x[0])
            stop_price, stop_reason = candidates[0]
        else:
            stop_price = entry_price + (atr * 1.5 * session_adj)
            stop_reason = "atr_fallback"

    risk_per_contract = abs(entry_price - stop_price) * point_value

    return StopPlan(
        stop_price=stop_price,
        stop_reason=stop_reason,
        buffer=buffer,
        risk_dollars=risk_per_contract,
        session_adjustment=session_adj,
    )
