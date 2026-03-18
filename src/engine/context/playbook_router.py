"""Playbook Router — Maps bias state to allowed playbook and strategy families.

Routes: bias + confidence + conditions → one of 9 playbooks → allowed strategies.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from src.engine.context.bias_engine import DailyBiasState


@dataclass
class PlaybookDecision:
    playbook: str              # e.g. "TREND_CONTINUATION_LONG"
    allowed_strategies: List[str]
    allowed_setups: List[str]
    confidence_modifier: float  # 1.0 = no change, 0.5 = reduce confidence


# Strategy family mappings
CONTINUATION_STRATS = ["ote", "ict_swing", "propulsion", "power_of_3", "quarterly_swing"]
REVERSAL_STRATS = ["breaker", "eqhl_raid", "london_raid", "judas_swing", "mitigation"]
MEAN_REV_STRATS = ["ny_lunch_reversal", "midnight_open"]
ORB_STRATS = ["iofed", "ict_scalp"]
ALL_STRATS = CONTINUATION_STRATS + REVERSAL_STRATS + MEAN_REV_STRATS + ORB_STRATS


def route_playbook(bias: DailyBiasState) -> PlaybookDecision:
    """Route bias state to the best playbook.

    Logic:
    - Strong directional bias (±40+, confidence > 0.6) → TREND_CONTINUATION
    - Moderate bias after sweep (±20-40) → SWEEP_REVERSAL
    - Weak opposite bias in extreme location → MEAN_REVERSION
    - OR break with directional bias → ORB
    - No conviction or hard blockers → NO_TRADE
    """
    nb = bias.net_bias
    conf = bias.bias_confidence
    session = bias.session_context

    # NO_TRADE conditions (checked first)
    if bias.no_trade_reasons:
        return PlaybookDecision(
            playbook="NO_TRADE",
            allowed_strategies=[],
            allowed_setups=[],
            confidence_modifier=0.0,
        )

    # TREND_CONTINUATION — strong aligned bias
    if nb >= 40 and conf >= 0.6:
        return PlaybookDecision(
            playbook="TREND_CONTINUATION_LONG",
            allowed_strategies=CONTINUATION_STRATS,
            allowed_setups=["breakout_pullback", "vwap_reclaim", "fvg_continuation", "ob_retest"],
            confidence_modifier=1.0,
        )
    if nb <= -40 and conf >= 0.6:
        return PlaybookDecision(
            playbook="TREND_CONTINUATION_SHORT",
            allowed_strategies=CONTINUATION_STRATS,
            allowed_setups=["breakout_pullback", "vwap_rejection", "fvg_continuation", "ob_retest"],
            confidence_modifier=1.0,
        )

    # SWEEP_REVERSAL — moderate bias after liquidity sweep
    # LONG reversal requires SELL-SIDE swept (pdl_swept) — sellers exhausted
    if -20 <= nb <= 40 and session.london_swept_pdl:
        return PlaybookDecision(
            playbook="SWEEP_REVERSAL_LONG",
            allowed_strategies=REVERSAL_STRATS,
            allowed_setups=["sweep_reclaim", "breaker_retest", "turtle_soup"],
            confidence_modifier=0.9,
        )
    # SHORT reversal requires BUY-SIDE swept (pdh_swept) — buyers exhausted
    if -40 <= nb <= 20 and session.london_swept_pdh:
        return PlaybookDecision(
            playbook="SWEEP_REVERSAL_SHORT",
            allowed_strategies=REVERSAL_STRATS,
            allowed_setups=["sweep_reclaim", "breaker_retest", "turtle_soup"],
            confidence_modifier=0.9,
        )

    # ORB — opening range breakout with directional bias
    if session.or_broken == "above" and nb >= 20:
        return PlaybookDecision(
            playbook="ORB_LONG",
            allowed_strategies=ORB_STRATS,
            allowed_setups=["opening_range_breakout", "opening_range_retest"],
            confidence_modifier=0.85,
        )
    if session.or_broken == "below" and nb <= -20:
        return PlaybookDecision(
            playbook="ORB_SHORT",
            allowed_strategies=ORB_STRATS,
            allowed_setups=["opening_range_breakout", "opening_range_retest"],
            confidence_modifier=0.85,
        )

    # MEAN_REVERSION — extreme location with weak opposite bias
    if nb <= -20 and bias.htf_context.pd_location == "discount":
        return PlaybookDecision(
            playbook="MEAN_REVERSION_LONG",
            allowed_strategies=MEAN_REV_STRATS,
            allowed_setups=["vwap_rejection", "fvg_fill", "ob_rejection"],
            confidence_modifier=0.7,
        )
    if nb >= 20 and bias.htf_context.pd_location == "premium":
        return PlaybookDecision(
            playbook="MEAN_REVERSION_SHORT",
            allowed_strategies=MEAN_REV_STRATS,
            allowed_setups=["vwap_rejection", "fvg_fill", "ob_rejection"],
            confidence_modifier=0.7,
        )

    # Default: weak bias, no clear setup → NO_TRADE
    return PlaybookDecision(
        playbook="NO_TRADE",
        allowed_strategies=[],
        allowed_setups=[],
        confidence_modifier=0.0,
    )
