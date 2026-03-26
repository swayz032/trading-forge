"""DOL-based Targeting — Draw On Liquidity targets using PD Array Matrix hierarchy.

Target hierarchy (highest priority first):
1. External liquidity (BSL/SSL)
2. Old high/low (untapped daily/weekly)
3. Order block (untested)
4. Fair value gap (unfilled)
5. VWAP bands (±1σ, ±2σ)

Partial exit: institutional thirds (1/3, 1/3, 1/3)
Key rule: TP2 must always be > 2R from entry
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Tuple


@dataclass
class TargetPlan:
    tp1: float
    tp1_reason: str
    tp2: float
    tp2_reason: str
    tp3_mode: str               # "structural_trail" | "range_exit" | "event_close"
    tp3_trail_structure: str    # What to trail behind
    regime_adjustment: float    # 1.0 normal, 1.25 high vol, 0.75 ranging
    partial_sizes: Tuple[float, float, float] = (0.33, 0.33, 0.34)
    min_rr_ratio: float = 2.0
    rr_achieved: float = 0.0   # Actual R:R for TP2


def compute_targets(
    direction: str,
    entry_price: float,
    stop_price: float,
    # Structural levels
    nearest_bsl: Optional[float] = None,
    nearest_ssl: Optional[float] = None,
    nearest_old_high: Optional[float] = None,
    nearest_old_low: Optional[float] = None,
    nearest_untested_ob: Optional[float] = None,
    nearest_unfilled_fvg: Optional[float] = None,
    vwap: float = 0.0,
    vwap_std: float = 0.0,
    # Regime
    regime: str = "normal",    # "trending" | "ranging" | "high_vol" | "pre_event"
) -> TargetPlan:
    """Compute DOL-based targets with institutional thirds.

    Regime adjustments:
    - Trending: TP2/TP3 extend to external liquidity
    - Ranging: TP1 at midpoint, TP2 at boundary, no TP3
    - High vol: Widen all targets 1.25×
    - Pre-event: TP1 only, close everything
    """
    risk = abs(entry_price - stop_price)
    if risk < 1e-9:
        risk = 1.0

    regime_mult = {"normal": 1.0, "trending": 1.0, "ranging": 0.75, "high_vol": 1.25, "pre_event": 0.5}
    adjustment = regime_mult.get(regime, 1.0)

    # Collect all potential targets with priority
    targets = []

    if direction == "long":
        # Internal liquidity first (TP1 candidates)
        if nearest_unfilled_fvg is not None and nearest_unfilled_fvg > entry_price:
            targets.append((nearest_unfilled_fvg, "FVG_fill", 1))
        if nearest_untested_ob is not None and nearest_untested_ob > entry_price:
            targets.append((nearest_untested_ob, "untested_OB", 2))
        if vwap > 0 and vwap_std > 0:
            targets.append((vwap + vwap_std, "VWAP_plus_1sd", 5))

        # External liquidity (TP2 candidates)
        if nearest_bsl is not None and nearest_bsl > entry_price:
            targets.append((nearest_bsl, "BSL", 0))  # Highest priority
        if nearest_old_high is not None and nearest_old_high > entry_price:
            targets.append((nearest_old_high, "old_high", 1))

    else:  # short
        if nearest_unfilled_fvg is not None and nearest_unfilled_fvg < entry_price:
            targets.append((nearest_unfilled_fvg, "FVG_fill", 1))
        if nearest_untested_ob is not None and nearest_untested_ob < entry_price:
            targets.append((nearest_untested_ob, "untested_OB", 2))
        if vwap > 0 and vwap_std > 0:
            targets.append((vwap - vwap_std, "VWAP_minus_1sd", 5))

        if nearest_ssl is not None and nearest_ssl < entry_price:
            targets.append((nearest_ssl, "SSL", 0))
        if nearest_old_low is not None and nearest_old_low < entry_price:
            targets.append((nearest_old_low, "old_low", 1))

    # Sort by distance from entry
    if direction == "long":
        targets.sort(key=lambda x: x[0])  # Nearest first
    else:
        targets.sort(key=lambda x: -x[0])  # Nearest first (lowest price for shorts)

    # TP1: nearest internal target
    # TP2: nearest external target that gives >= 2R
    min_tp2_distance = risk * 2.0 * adjustment

    tp1 = entry_price + (risk * 1.0 * (1 if direction == "long" else -1))
    tp1_reason = "1R_default"
    tp2 = entry_price + (risk * 2.5 * (1 if direction == "long" else -1))
    tp2_reason = "2.5R_default"

    internal_targets = [t for t in targets if abs(t[0] - entry_price) < min_tp2_distance]
    external_targets = [t for t in targets if abs(t[0] - entry_price) >= min_tp2_distance]

    if internal_targets:
        tp1 = internal_targets[0][0]
        tp1_reason = internal_targets[0][1]

    if external_targets:
        tp2 = external_targets[0][0]
        tp2_reason = external_targets[0][1]

    # Ensure TP2 > 2R
    rr_achieved = abs(tp2 - entry_price) / risk if risk > 0 else 0.0

    # TP3 mode based on regime
    if regime == "ranging":
        tp3_mode = "range_exit"
        tp3_trail = "opposing_boundary"
    elif regime == "pre_event":
        tp3_mode = "event_close"
        tp3_trail = "close_all_pre_event"
    else:
        tp3_mode = "structural_trail"
        tp3_trail = "new_ob_or_fvg"

    # Partial sizes adjust for regime
    if regime == "pre_event":
        partials = (1.0, 0.0, 0.0)  # All out at TP1
    elif regime == "ranging":
        partials = (0.5, 0.5, 0.0)  # No TP3 in ranges
    else:
        partials = (0.33, 0.33, 0.34)

    return TargetPlan(
        tp1=tp1,
        tp1_reason=tp1_reason,
        tp2=tp2,
        tp2_reason=tp2_reason,
        tp3_mode=tp3_mode,
        tp3_trail_structure=tp3_trail,
        regime_adjustment=adjustment,
        partial_sizes=partials,
        rr_achieved=rr_achieved,
    )


def compute_single_tp(
    direction: str,
    entry_price: float,
    stop_price: float,
    nearest_bsl: Optional[float] = None,
    nearest_ssl: Optional[float] = None,
    nearest_old_high: Optional[float] = None,
    nearest_old_low: Optional[float] = None,
    nearest_untested_ob: Optional[float] = None,
    nearest_unfilled_fvg: Optional[float] = None,
    atr: float = 0.0,
) -> Optional[float]:
    """Single structural TP using DOL hierarchy. Returns None if no target >= 2R.

    Priority: BSL/SSL > old high/low > untested OB > unfilled FVG > 3×ATR fallback.
    Hard rule: TP must be >= 2R from entry. If nothing qualifies, return None (skip trade).
    """
    risk = abs(entry_price - stop_price)
    if risk < 1e-9:
        return None
    min_tp_distance = risk * 2.0

    candidates: List[float] = []
    if direction == "long":
        for level in [nearest_bsl, nearest_old_high, nearest_untested_ob, nearest_unfilled_fvg]:
            if level is not None and level > entry_price:
                candidates.append(level)
        if atr > 0:
            candidates.append(entry_price + atr * 3.0)
    else:
        for level in [nearest_ssl, nearest_old_low, nearest_untested_ob, nearest_unfilled_fvg]:
            if level is not None and level < entry_price:
                candidates.append(level)
        if atr > 0:
            candidates.append(entry_price - atr * 3.0)

    for tp in candidates:
        if abs(tp - entry_price) >= min_tp_distance:
            return tp
    return None
