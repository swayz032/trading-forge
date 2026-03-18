"""Location Score — Scores WHERE the signal fires (0-100).

Higher = better entry location. Institutional-grade entries score 80+.
Combines: PDH/PDL proximity, VWAP zone, sweep status, OB/FVG presence, premium/discount.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from src.engine.context.htf_context import HTFContext
from src.engine.context.session_context import SessionContext


@dataclass
class LocationScore:
    score: int                  # 0-100
    factors: dict               # Individual factor scores
    grade: str                  # "institutional" | "good" | "acceptable" | "poor" | "terrible"


def compute_location_score(
    entry_price: float,
    direction: str,  # "long" | "short"
    htf: HTFContext,
    session: SessionContext,
    vwap: float = 0.0,
    at_order_block: bool = False,
    at_fvg: bool = False,
    after_sweep: bool = False,
    at_value_area_edge: bool = False,
) -> LocationScore:
    """Score trade location from 0-100.

    Score bands:
      80-100: Institutional-grade (all factors align)
      60-79:  Good (most factors align)
      40-59:  Acceptable (some structure, some weakness)
      20-39:  Poor (fighting structure)
      0-19:   Terrible (fade candidate or skip)
    """
    factors = {}

    # 1. Premium/Discount (max 25 points)
    if direction == "long":
        if htf.pd_location == "discount":
            factors["pd_zone"] = 25
        elif htf.pd_location == "equilibrium":
            factors["pd_zone"] = 12
        else:
            factors["pd_zone"] = 0  # Long in premium = bad
    else:
        if htf.pd_location == "premium":
            factors["pd_zone"] = 25
        elif htf.pd_location == "equilibrium":
            factors["pd_zone"] = 12
        else:
            factors["pd_zone"] = 0

    # 2. PDH/PDL proximity (max 20 points)
    pdh = htf.prev_day_high
    pdl = htf.prev_day_low
    pd_range = pdh - pdl if pdh > pdl else 1.0

    if direction == "long":
        # Entry near PDL = good location for longs
        dist_from_pdl = abs(entry_price - pdl) / pd_range
        factors["pdhl_proximity"] = max(0, int(20 * (1.0 - dist_from_pdl)))
    else:
        dist_from_pdh = abs(entry_price - pdh) / pd_range
        factors["pdhl_proximity"] = max(0, int(20 * (1.0 - dist_from_pdh)))

    # 3. VWAP zone (max 15 points)
    if vwap > 0:
        pct_from_vwap = (entry_price - vwap) / vwap
        if direction == "long" and pct_from_vwap < 0:
            factors["vwap_zone"] = 15  # Below VWAP for longs = good
        elif direction == "short" and pct_from_vwap > 0:
            factors["vwap_zone"] = 15  # Above VWAP for shorts = good
        elif abs(pct_from_vwap) < 0.001:
            factors["vwap_zone"] = 8  # At VWAP
        else:
            factors["vwap_zone"] = 0  # Wrong side of VWAP
    else:
        factors["vwap_zone"] = 8  # No VWAP data — neutral

    # 4. Sweep status (max 15 points)
    factors["sweep_status"] = 15 if after_sweep else 0

    # 5. OB/FVG presence (max 15 points)
    structure_score = 0
    if at_order_block:
        structure_score += 10
    if at_fvg:
        structure_score += 8
    if at_value_area_edge:
        structure_score += 5
    factors["structure"] = min(15, structure_score)

    # 6. Opening range context (max 10 points)
    or_high, or_low = session.opening_range
    if direction == "long" and session.or_broken == "above":
        factors["or_context"] = 10
    elif direction == "short" and session.or_broken == "below":
        factors["or_context"] = 10
    elif session.or_broken is None:
        factors["or_context"] = 5  # OR not yet broken — neutral
    else:
        factors["or_context"] = 0  # OR broken opposite direction

    total = sum(factors.values())
    total = max(0, min(100, total))

    if total >= 80:
        grade = "institutional"
    elif total >= 60:
        grade = "good"
    elif total >= 40:
        grade = "acceptable"
    elif total >= 20:
        grade = "poor"
    else:
        grade = "terrible"

    return LocationScore(score=total, factors=factors, grade=grade)
