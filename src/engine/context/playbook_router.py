"""Playbook Router — Maps bias state to allowed playbook and strategy families.

Routes: bias + confidence + conditions -> one of 9 playbooks -> allowed strategies.

PLAYBOOK_ROUTING contains the declarative spec for each playbook.
route_playbook() evaluates the current DailyBiasState and returns a PlaybookDecision.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from src.engine.context.bias_engine import DailyBiasState


@dataclass
class PlaybookDecision:
    playbook: str              # e.g. "TREND_CONTINUATION_LONG"
    allowed_strategies: List[str]
    allowed_setups: List[str]
    confidence_modifier: float  # 1.0 = no change, 0.5 = reduce confidence
    no_trade_reasons: List[str] = None  # populated when playbook == NO_TRADE

    def __post_init__(self):
        if self.no_trade_reasons is None:
            self.no_trade_reasons = []


# ---------------------------------------------------------------------------
# Strategy family mappings
# ---------------------------------------------------------------------------
CONTINUATION_STRATS = ["ote", "ict_swing", "propulsion", "power_of_3", "quarterly_swing", "silver_bullet"]
REVERSAL_STRATS = ["breaker", "eqhl_raid", "london_raid", "judas_swing", "mitigation"]
MEAN_REV_STRATS = ["ny_lunch_reversal", "midnight_open"]
ORB_STRATS = ["iofed", "ict_scalp"]
ALL_STRATS = CONTINUATION_STRATS + REVERSAL_STRATS + MEAN_REV_STRATS + ORB_STRATS


# ---------------------------------------------------------------------------
# PLAYBOOK_ROUTING — declarative spec per playbook
#
# Each entry:
#   bias_range:         (min_net_bias, max_net_bias) inclusive
#   confidence_min:     minimum bias_confidence required (None = no check)
#   requires:           list of conditions that must be true
#   allowed_strategies: strategy families eligible under this playbook
#   allowed_setups:     setup patterns eligible under this playbook
# ---------------------------------------------------------------------------
PLAYBOOK_ROUTING: Dict[str, Dict[str, Any]] = {
    "NO_TRADE": {
        "bias_range": (-14, 14),
        "confidence_min": None,
        "requires": [
            "abs_net_bias_lt_15",
            "confidence_lt_0.3",
            "event_risk_active",
            "daily_loss_cap_near",
            "max_trades_hit",
            "range_compression",
            "volatility_spike",
        ],
        "allowed_strategies": [],
        "allowed_setups": [],
    },
    "TREND_CONTINUATION_LONG": {
        "bias_range": (40, 100),
        "confidence_min": 0.6,
        "requires": ["htf_trend_aligned_bullish"],
        "allowed_strategies": CONTINUATION_STRATS,
        "allowed_setups": ["breakout_pullback", "vwap_reclaim", "fvg_continuation", "ob_retest"],
    },
    "TREND_CONTINUATION_SHORT": {
        "bias_range": (-100, -40),
        "confidence_min": 0.6,
        "requires": ["htf_trend_aligned_bearish"],
        "allowed_strategies": CONTINUATION_STRATS,
        "allowed_setups": ["breakout_pullback", "vwap_rejection", "fvg_continuation", "ob_retest"],
    },
    "SWEEP_REVERSAL_LONG": {
        "bias_range": (-20, 40),
        "confidence_min": None,
        "requires": ["london_swept_pdl"],
        "allowed_strategies": REVERSAL_STRATS,
        "allowed_setups": ["sweep_reclaim", "breaker_retest", "turtle_soup"],
    },
    "SWEEP_REVERSAL_SHORT": {
        "bias_range": (-40, 20),
        "confidence_min": None,
        "requires": ["london_swept_pdh"],
        "allowed_strategies": REVERSAL_STRATS,
        "allowed_setups": ["sweep_reclaim", "breaker_retest", "turtle_soup"],
    },
    "MEAN_REVERSION_LONG": {
        "bias_range": (-100, -20),
        "confidence_min": None,
        "requires": ["pd_location_discount"],
        "allowed_strategies": MEAN_REV_STRATS,
        "allowed_setups": ["vwap_rejection", "fvg_fill", "ob_rejection"],
    },
    "MEAN_REVERSION_SHORT": {
        "bias_range": (20, 100),
        "confidence_min": None,
        "requires": ["pd_location_premium"],
        "allowed_strategies": MEAN_REV_STRATS,
        "allowed_setups": ["vwap_rejection", "fvg_fill", "ob_rejection"],
    },
    "ORB_LONG": {
        "bias_range": (20, 100),
        "confidence_min": None,
        "requires": ["or_broken_above"],
        "allowed_strategies": ORB_STRATS,
        "allowed_setups": ["opening_range_breakout", "opening_range_retest"],
    },
    "ORB_SHORT": {
        "bias_range": (-100, -20),
        "confidence_min": None,
        "requires": ["or_broken_below"],
        "allowed_strategies": ORB_STRATS,
        "allowed_setups": ["opening_range_breakout", "opening_range_retest"],
    },
}


def _check_no_trade_conditions(
    bias: DailyBiasState,
    daily_loss_cap_near: bool = False,
    max_trades_hit: bool = False,
) -> List[str]:
    """Evaluate all NO_TRADE conditions.

    Returns a list of reason strings. If non-empty, the router must return NO_TRADE.

    Conditions checked:
    1. abs(net_bias) < 15                — no directional conviction
    2. confidence < 0.3                  — conflicting signals
    3. event_risk_active                 — high-impact event within +/-30 min
    4. daily_loss_cap_near               — approaching daily loss limit
    5. max_trades_hit                    — max trades per session reached
    6. range_compression (ATR < 10pctl)  — no opportunity
    7. volatility_spike (ATR > 90pctl)   — uncontrolled risk
    """
    reasons: List[str] = []

    # Inherit reasons already computed by bias_engine (abs_bias<15, conf<0.3,
    # event_risk, range_compression, volatility_spike)
    reasons.extend(bias.no_trade_reasons)

    # Additional session-level blockers not known to bias_engine
    if daily_loss_cap_near:
        reasons.append("Daily loss cap approaching — sit out")
    if max_trades_hit:
        reasons.append("Maximum trades per session reached")

    return reasons


def route_playbook(
    bias: DailyBiasState,
    *,
    daily_loss_cap_near: bool = False,
    max_trades_hit: bool = False,
) -> PlaybookDecision:
    """Route bias state to the best playbook.

    Evaluation order:
    1. NO_TRADE hard blockers (checked first — safety always wins)
    2. TREND_CONTINUATION (strong aligned bias >= |40|, confidence >= 0.6)
    3. SWEEP_REVERSAL (moderate bias after liquidity sweep)
    4. ORB (opening range breakout with directional bias)
    5. MEAN_REVERSION (extreme location with opposite bias)
    6. Default fallback -> NO_TRADE
    """
    nb = bias.net_bias
    conf = bias.bias_confidence
    session = bias.session_context

    # ------------------------------------------------------------------
    # 1. NO_TRADE conditions (checked first — any single blocker kills)
    # ------------------------------------------------------------------
    no_trade_reasons = _check_no_trade_conditions(
        bias,
        daily_loss_cap_near=daily_loss_cap_near,
        max_trades_hit=max_trades_hit,
    )
    if no_trade_reasons:
        return PlaybookDecision(
            playbook="NO_TRADE",
            allowed_strategies=[],
            allowed_setups=[],
            confidence_modifier=0.0,
            no_trade_reasons=no_trade_reasons,
        )

    # ------------------------------------------------------------------
    # 2. TREND_CONTINUATION — strong aligned bias
    # ------------------------------------------------------------------
    spec = PLAYBOOK_ROUTING["TREND_CONTINUATION_LONG"]
    if nb >= spec["bias_range"][0] and conf >= spec["confidence_min"]:
        return PlaybookDecision(
            playbook="TREND_CONTINUATION_LONG",
            allowed_strategies=spec["allowed_strategies"],
            allowed_setups=spec["allowed_setups"],
            confidence_modifier=1.0,
        )

    spec = PLAYBOOK_ROUTING["TREND_CONTINUATION_SHORT"]
    if nb <= spec["bias_range"][1] and conf >= spec["confidence_min"]:
        return PlaybookDecision(
            playbook="TREND_CONTINUATION_SHORT",
            allowed_strategies=spec["allowed_strategies"],
            allowed_setups=spec["allowed_setups"],
            confidence_modifier=1.0,
        )

    # ------------------------------------------------------------------
    # 3. SWEEP_REVERSAL — moderate bias after liquidity sweep
    # ------------------------------------------------------------------
    spec = PLAYBOOK_ROUTING["SWEEP_REVERSAL_LONG"]
    if spec["bias_range"][0] <= nb <= spec["bias_range"][1] and session.london_swept_pdl:
        return PlaybookDecision(
            playbook="SWEEP_REVERSAL_LONG",
            allowed_strategies=spec["allowed_strategies"],
            allowed_setups=spec["allowed_setups"],
            confidence_modifier=0.9,
        )

    spec = PLAYBOOK_ROUTING["SWEEP_REVERSAL_SHORT"]
    if spec["bias_range"][0] <= nb <= spec["bias_range"][1] and session.london_swept_pdh:
        return PlaybookDecision(
            playbook="SWEEP_REVERSAL_SHORT",
            allowed_strategies=spec["allowed_strategies"],
            allowed_setups=spec["allowed_setups"],
            confidence_modifier=0.9,
        )

    # ------------------------------------------------------------------
    # 4. ORB — opening range breakout with directional bias
    # ------------------------------------------------------------------
    spec = PLAYBOOK_ROUTING["ORB_LONG"]
    if session.or_broken == "above" and nb >= spec["bias_range"][0]:
        return PlaybookDecision(
            playbook="ORB_LONG",
            allowed_strategies=spec["allowed_strategies"],
            allowed_setups=spec["allowed_setups"],
            confidence_modifier=0.85,
        )

    spec = PLAYBOOK_ROUTING["ORB_SHORT"]
    if session.or_broken == "below" and nb <= spec["bias_range"][1]:
        return PlaybookDecision(
            playbook="ORB_SHORT",
            allowed_strategies=spec["allowed_strategies"],
            allowed_setups=spec["allowed_setups"],
            confidence_modifier=0.85,
        )

    # ------------------------------------------------------------------
    # 5. MEAN_REVERSION — extreme location with weak opposite bias
    # ------------------------------------------------------------------
    spec = PLAYBOOK_ROUTING["MEAN_REVERSION_LONG"]
    if nb <= spec["bias_range"][1] and bias.htf_context.pd_location == "discount":
        return PlaybookDecision(
            playbook="MEAN_REVERSION_LONG",
            allowed_strategies=spec["allowed_strategies"],
            allowed_setups=spec["allowed_setups"],
            confidence_modifier=0.7,
        )

    spec = PLAYBOOK_ROUTING["MEAN_REVERSION_SHORT"]
    if nb >= spec["bias_range"][0] and bias.htf_context.pd_location == "premium":
        return PlaybookDecision(
            playbook="MEAN_REVERSION_SHORT",
            allowed_strategies=spec["allowed_strategies"],
            allowed_setups=spec["allowed_setups"],
            confidence_modifier=0.7,
        )

    # ------------------------------------------------------------------
    # 6. Default fallback — no playbook matched
    # ------------------------------------------------------------------
    return PlaybookDecision(
        playbook="NO_TRADE",
        allowed_strategies=[],
        allowed_setups=[],
        confidence_modifier=0.0,
        no_trade_reasons=["No playbook conditions matched current bias state"],
    )
