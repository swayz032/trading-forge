"""Location Score — Scores WHERE the signal fires (0-100).

Higher = better entry location. Institutional-grade entries score 80+.
Combines: Premium/Discount + OTE, liquidity sweep (hard gate), OB/FVG overlap,
VWAP alignment, PDH/PDL proximity, opening range context, confluence count.

ICT/SMC A+ setup definition: sweep MUST be present, OB+FVG overlap is the
gold standard for structure, and OTE zone (61.8-79% fib) is the optimal entry.
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
    sweep_present: bool         # Whether a liquidity sweep occurred (hard gate for eligibility)
    ob_fvg_overlap: bool        # Whether OB and FVG are both present
    in_ote_zone: bool           # Whether entry is in 61.8-79% fib zone
    confluence_count: int       # Number of independent positive factors
    in_killzone: bool           # Whether current bar is in a valid kill zone


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
    in_killzone: bool = False,
    has_mss: bool = False,
) -> LocationScore:
    """Score trade location from 0-100 using ICT/SMC A+ criteria.

    Score bands:
      80-100: Institutional-grade (all factors align)
      60-79:  Good (most factors align)
      40-59:  Acceptable (some structure, some weakness)
      20-39:  Poor (fighting structure)
      0-19:   Terrible (fade candidate or skip)

    Scoring breakdown (max 100):
      1. Premium/Discount + OTE zone     — max 20 pts
      2. Liquidity sweep (HARD GATE)     — max 20 pts
      3. Structure: OB + FVG overlap     — max 20 pts
      4. VWAP alignment                  — max 10 pts
      5. PDH/PDL proximity               — max 15 pts
      6. Opening range context           — max 10 pts
      7. Confluence count bonus          — max  5 pts
    """
    factors = {}

    # --- Derived flags ---
    sweep_present = after_sweep
    ob_fvg_overlap = at_order_block and at_fvg

    # OTE zone: 61.8-79% retracement of the dealing range (PDH-PDL).
    # For longs: OTE is near the low end (PDL + 21%-38.2% of range = 61.8-79% retrace from top).
    # For shorts: OTE is near the high end.
    pdh = htf.prev_day_high
    pdl = htf.prev_day_low
    pd_range = pdh - pdl if pdh > pdl else 1.0

    if direction == "long":
        # OTE for longs = price between PDL + 21% and PDL + 38.2% of range
        # (i.e., 61.8%-79% retracement from the high)
        ote_low = pdl + 0.21 * pd_range
        ote_high = pdl + 0.382 * pd_range
        in_ote = ote_low <= entry_price <= ote_high
    else:
        # OTE for shorts = price between PDH - 38.2% and PDH - 21% of range
        ote_low = pdh - 0.382 * pd_range
        ote_high = pdh - 0.21 * pd_range
        in_ote = ote_low <= entry_price <= ote_high

    # ---------------------------------------------------------------
    # 1. Premium/Discount + OTE zone (max 20 pts)
    # ---------------------------------------------------------------
    correct_zone = (
        (direction == "long" and htf.pd_location == "discount")
        or (direction == "short" and htf.pd_location == "premium")
    )
    at_equilibrium = htf.pd_location == "equilibrium"

    if correct_zone:
        factors["pd_zone"] = 10
        if in_ote:
            factors["pd_zone"] = 20  # Correct zone + OTE = full marks
    elif at_equilibrium:
        factors["pd_zone"] = 5
    else:
        factors["pd_zone"] = 0  # Wrong zone

    # ---------------------------------------------------------------
    # 2. Liquidity Sweep — HARD GATE (max 20 pts)
    # ---------------------------------------------------------------
    factors["sweep"] = 20 if sweep_present else 0

    # ---------------------------------------------------------------
    # 3. Structure: OB + FVG overlap (max 20 pts)
    # ---------------------------------------------------------------
    if ob_fvg_overlap:
        factors["structure"] = 20
    elif at_order_block:
        factors["structure"] = 10
    elif at_fvg:
        factors["structure"] = 8
    else:
        factors["structure"] = 0

    # ---------------------------------------------------------------
    # 4. VWAP alignment (max 10 pts)
    # ---------------------------------------------------------------
    if vwap > 0:
        pct_from_vwap = (entry_price - vwap) / vwap
        if direction == "long" and pct_from_vwap < -0.001:
            factors["vwap_zone"] = 10  # Below VWAP for longs
        elif direction == "short" and pct_from_vwap > 0.001:
            factors["vwap_zone"] = 10  # Above VWAP for shorts
        elif abs(pct_from_vwap) <= 0.001:
            factors["vwap_zone"] = 5   # At VWAP
        else:
            factors["vwap_zone"] = 0   # Wrong side
    else:
        factors["vwap_zone"] = 5  # No VWAP data — neutral

    # ---------------------------------------------------------------
    # 5. PDH/PDL proximity (max 15 pts)
    # ---------------------------------------------------------------
    if direction == "long":
        dist_from_pdl = abs(entry_price - pdl) / pd_range
        factors["pdhl_proximity"] = max(0, int(15 * (1.0 - dist_from_pdl)))
    else:
        dist_from_pdh = abs(entry_price - pdh) / pd_range
        factors["pdhl_proximity"] = max(0, int(15 * (1.0 - dist_from_pdh)))

    # ---------------------------------------------------------------
    # 6. Opening range context (max 10 pts)
    # ---------------------------------------------------------------
    or_high, or_low = session.opening_range
    if direction == "long" and session.or_broken == "above":
        factors["or_context"] = 10
    elif direction == "short" and session.or_broken == "below":
        factors["or_context"] = 10
    elif session.or_broken is None:
        factors["or_context"] = 5  # OR not yet broken — neutral
    else:
        factors["or_context"] = 0  # OR broken opposite direction

    # ---------------------------------------------------------------
    # 7. Confluence count bonus (max 5 pts)
    # ---------------------------------------------------------------
    # Count independent positive factors
    positive_factors = 0
    if factors["pd_zone"] > 0:
        positive_factors += 1
    if sweep_present:
        positive_factors += 1
    if factors["structure"] > 0:
        positive_factors += 1
    if factors.get("vwap_zone", 0) > 0:
        positive_factors += 1
    if factors["pdhl_proximity"] > 0:
        positive_factors += 1
    if factors["or_context"] > 0:
        positive_factors += 1
    if in_killzone:
        positive_factors += 1
    if has_mss:
        positive_factors += 1

    if positive_factors >= 5:
        factors["confluence_bonus"] = 5
    elif positive_factors == 4:
        factors["confluence_bonus"] = 3
    elif positive_factors == 3:
        factors["confluence_bonus"] = 1
    else:
        factors["confluence_bonus"] = 0

    confluence_count = positive_factors

    # ---------------------------------------------------------------
    # Total & grade
    # ---------------------------------------------------------------
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

    return LocationScore(
        score=total,
        factors=factors,
        grade=grade,
        sweep_present=sweep_present,
        ob_fvg_overlap=ob_fvg_overlap,
        in_ote_zone=in_ote,
        confluence_count=confluence_count,
        in_killzone=in_killzone,
    )
