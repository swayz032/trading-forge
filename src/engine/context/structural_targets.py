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

from dataclasses import dataclass
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
    # DeepAR forecast (optional — only used when weight > 0)
    deepar_forecast: Optional[dict] = None,
    deepar_weight: float = 0.0,
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

    # When DeepAR is active (weight > 0) and forecast provided, use continuous
    # regime multiplier based on P(high_vol) instead of discrete buckets.
    # P(hv)=0.3 → mult=0.9, P(hv)=0.5 → 1.0, P(hv)=0.8 → 1.15
    if deepar_forecast and deepar_weight > 0.0:
        p_hv = float(deepar_forecast.get("p_high_vol", 0.5) or 0.5)
        adjustment = 1.0 + (p_hv - 0.5) * 0.5
    else:
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
        min_rr_ratio=2.0 * adjustment,  # Ranging=1.5R, normal=2.0R, high_vol=2.5R
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
    # Wave 1 Track 1A 2026-06-27: liquidity-mapped TP2 for static_styleC
    liquidity_snapshot: Optional[list] = None,  # list of dicts or LiquidityLevelSnapshot objects
) -> Optional[float]:
    """Single structural TP using DOL hierarchy. Returns None if no target >= 2R.

    Priority: BSL/SSL > old high/low > untested OB > unfilled FVG > 3×ATR fallback.
    Hard rule: TP must be >= 2R from entry. If nothing qualifies, return None (skip trade).

    Wave 1 Track 1A liquidity-mapped TP2 (static_styleC):
        If a qualified INTRADAY level from liquidity_snapshot exists within the
        configurable band around +2.0R (default [+1.4R, +2.6R]), it is returned
        directly as the TP2 anchor — BEFORE the structural candidate scan.
        This allows the static exit style to use the same intraday DOL targets
        that the adaptive engine uses.
        Backward-compat: no snapshot or no qualifying level → existing logic unchanged.
    """
    import os as _os

    risk = abs(entry_price - stop_price)
    if risk < 1e-9:
        return None

    # ── Wave 1 Track 1A: liquidity-mapped TP2 (BEFORE structural candidates) ──
    # Band: [+1.4R, +2.6R] around entry (env-configurable).
    # Only INTRADAY level types allowed (INTRADAY_ALLOWED_LEVEL_TYPES from adaptive_exits).
    # A concrete intraday level in this zone is a better anchor than the abstract +2.0R.
    # Backward-compat: falls through to existing logic when no level qualifies.
    if liquidity_snapshot:
        try:
            from src.engine.exits.adaptive_exits import (
                INTRADAY_ALLOWED_LEVEL_TYPES as _ALLOWED,
            )
        except ImportError:
            _ALLOWED = frozenset()

        _band_low_r = float(_os.environ.get("STATIC_TP2_LIQ_BAND_LOW_R", "1.4"))
        _band_high_r = float(_os.environ.get("STATIC_TP2_LIQ_BAND_HIGH_R", "2.6"))
        _band_low_dist = risk * _band_low_r
        _band_high_dist = risk * _band_high_r

        _liq_candidates: List[tuple] = []  # (dist_from_entry, price)
        for level in liquidity_snapshot:
            # Support both plain-dict (from JSON) and LiquidityLevelSnapshot dataclass
            if isinstance(level, dict):
                lt = level.get("level_type", "")
                lp = level.get("price")
            else:
                lt = getattr(level, "level_type", "")
                lp = getattr(level, "price", None)

            if not lt or lt not in _ALLOWED or lp is None:
                continue
            lp = float(lp)

            if direction == "long":
                if lp <= entry_price:
                    continue
                dist = lp - entry_price
            else:
                if lp >= entry_price:
                    continue
                dist = entry_price - lp

            if _band_low_dist <= dist <= _band_high_dist:
                _liq_candidates.append((dist, lp))

        if _liq_candidates:
            # Return the nearest qualifying intraday level in the band
            _liq_candidates.sort(key=lambda x: x[0])
            return _liq_candidates[0][1]

    # ── Existing structural candidate scan (unchanged) ──
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

    # F-7: Sort candidates by distance from entry (nearest first) so we
    # return the NEAREST level that satisfies >= 2R, not the first by
    # insertion priority order.
    candidates.sort(key=lambda tp: abs(tp - entry_price))

    for tp in candidates:
        if abs(tp - entry_price) >= min_tp_distance:
            return tp
    return None


# ─── Exit Style Selection ─────────────────────────────────────────────────────
# Wave 23 canonical: Style C 33/33/33 is the ONLY exit style (W23F.N, Wave 24).
# Style D is DEAD — select_exit_style() always returns "style_c".
# The vp_shape / macro_state args are retained for API compatibility + telemetry.
# Crisis macro receives "style_c" with a tighter Chandelier multiplier (handled
# by style_c_handler.py reading macro_state separately).

_STYLE_C_VP_SHAPES = {"D", "b", "P", "Thin"}


def select_exit_style(
    playbook: Optional[str] = None,
    vp_shape: Optional[str] = None,
    macro_state: Optional[str] = None,
) -> str:
    """Select exit style based on current regime context.

    Args:
        playbook: Bias engine playbook.  The router emits directional variants
                  "TREND_CONTINUATION_LONG" / "TREND_CONTINUATION_SHORT" — both
                  are valid Style C triggers.  The bare "TREND_CONTINUATION" string
                  was never emitted by route_playbook() and has been removed.
        vp_shape: Volume profile shape (e.g. "D", "b", "P", "Thin").
        macro_state: Current macro regime (e.g. "crisis", "growth", "easing").

    Returns:
        "style_c" always, except during a "crisis" macro regime.

    Design note (W23F.N 2026-05-20):
        Style D is DEAD — Wave 23 spec mandates Style C 33/33/33 as the canonical
        default.  The previous implementation compared against the bare string
        "TREND_CONTINUATION" which route_playbook() never emitted (it emits
        "TREND_CONTINUATION_LONG" / "TREND_CONTINUATION_SHORT"), so select_exit_style()
        always fell through to "style_d" — meaning the Style C runner was NEVER
        selected in production.  Fix: match directional variants, and return "style_c"
        for all non-crisis conditions (VP shape check retained for crisis-adjacent
        environments; crisis hard-blocks regardless of VP).
    """
    # Crisis regime: suppress trend-following exits regardless of playbook.
    # Every other condition defaults to Style C per W23F.N.
    if macro_state == "crisis":
        # In a crisis, conservative flat exits are preferred.  Return style_c with
        # tighter runner parameters — caller (style_c_handler) reads macro_state
        # separately to adjust Chandelier multiplier.  We still return "style_c"
        # because style_d no longer exists in the framework overlay (W23F.N).
        return "style_c"

    # Nominal path: Style C is always the answer.
    # The VP shape check is retained for observability (logged by caller) but no
    # longer gates the return value — all VP shapes get Style C per W23F.N.
    _ = vp_shape  # kept in signature for API compatibility; reserved for future telemetry

    # Directional trend-continuation playbooks get the full Style C runner.
    # All other playbooks (SWEEP_REVERSAL, ORB, MEAN_REVERSION, NO_TRADE) also
    # receive Style C — framework overlay applies Style C 33/33/33 universally.
    return "style_c"
