"""Eligibility Gate — Final TAKE/REDUCE/SKIP decision for every signal.

Wraps all strategies via Option C (post-filter decorator). Strategies fire
signals unchanged. This gate decides whether to take, reduce, or skip.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from src.engine.context.bias_engine import DailyBiasState
from src.engine.context.playbook_router import PlaybookDecision, route_playbook
from src.engine.context.location_score import LocationScore
from src.engine.context.structural_stops import StopPlan
from src.engine.context.structural_targets import TargetPlan


@dataclass
class EligibilityDecision:
    action: str               # "TAKE" | "REDUCE" | "SKIP"
    confidence: float         # 0.0-1.0
    reasoning: List[str]      # Human-readable reasons
    bias_state: Optional[DailyBiasState] = None
    location_score: int = 0
    stop_plan: Optional[StopPlan] = None
    target_plan: Optional[TargetPlan] = None
    playbook: str = "NO_TRADE"
    override_stop: Optional[float] = None
    override_targets: List[float] = field(default_factory=list)
    partial_sizes: tuple = (0.33, 0.33, 0.34)
    position_size_adjustment: float = 1.0


def evaluate_signal(
    signal: dict,              # {"direction": "long"|"short", "strategy_name": str, "entry_price": float}
    bias_state: DailyBiasState,
    playbook: PlaybookDecision,
    location: LocationScore,
    stop_plan: StopPlan,
    target_plan: TargetPlan,
    daily_loss_used_pct: float = 0.0,  # 0.0-1.0, how much of daily loss limit consumed
    max_trades_hit: bool = False,
) -> EligibilityDecision:
    """Evaluate a raw strategy signal through the eligibility gate.

    TAKE requires ALL of:
      1. Playbook allows this strategy family
      2. Direction aligns with bias (or reversal playbook active)
      3. Location score >= 40
      4. TP2 reward:risk >= 2.0
      5. No hard blockers (events, daily loss cap, drift)

    REDUCE if:
      - Location score 30-39
      - Bias confidence 0.3-0.5
      - Approaching daily loss limit (>60% used)

    SKIP if any of:
      - Playbook doesn't allow this strategy
      - Direction opposes bias AND not a reversal setup
      - Location score < 30
      - TP2 reward:risk < 1.5
      - Hard blocker active
      - NO_TRADE playbook selected
    """
    reasoning = []
    direction = signal.get("direction", "long")
    strategy_name = signal.get("strategy_name", "unknown")

    # ─── Hard SKIP checks ─────────────────────────────────────

    # 1. NO_TRADE playbook
    if playbook.playbook == "NO_TRADE":
        reasoning.append(f"NO_TRADE playbook active")
        if bias_state.no_trade_reasons:
            reasoning.extend(bias_state.no_trade_reasons)
        return EligibilityDecision(
            action="SKIP", confidence=0.0, reasoning=reasoning,
            bias_state=bias_state, playbook=playbook.playbook,
        )

    # 2. Strategy not in allowed list
    # Normalize strategy name for matching
    strat_lower = strategy_name.lower().replace("strategy", "").strip().replace("_", "")
    allowed_lower = [s.lower().replace("_", "") for s in playbook.allowed_strategies]
    strategy_allowed = strat_lower in allowed_lower or not playbook.allowed_strategies

    if not strategy_allowed:
        reasoning.append(
            f"Strategy '{strategy_name}' not in playbook '{playbook.playbook}' "
            f"(allowed: {playbook.allowed_strategies})"
        )
        return EligibilityDecision(
            action="SKIP", confidence=0.0, reasoning=reasoning,
            bias_state=bias_state, playbook=playbook.playbook,
        )

    # 3. Direction vs bias alignment
    is_reversal_playbook = "REVERSAL" in playbook.playbook or "MEAN_REVERSION" in playbook.playbook
    bias_direction = "long" if bias_state.net_bias > 0 else "short" if bias_state.net_bias < 0 else "neutral"

    if not is_reversal_playbook and direction != bias_direction and bias_direction != "neutral":
        reasoning.append(
            f"Direction '{direction}' opposes bias '{bias_direction}' "
            f"(net_bias={bias_state.net_bias}) and playbook is not reversal"
        )
        return EligibilityDecision(
            action="SKIP", confidence=0.0, reasoning=reasoning,
            bias_state=bias_state, playbook=playbook.playbook,
        )

    # 4. Location score < 30 → hard SKIP
    if location.score < 30:
        reasoning.append(f"Location score {location.score} < 30 ({location.grade})")
        return EligibilityDecision(
            action="SKIP", confidence=0.0, reasoning=reasoning,
            bias_state=bias_state, location_score=location.score,
            playbook=playbook.playbook,
        )

    # 5. TP2 R:R < 1.5 → hard SKIP
    if target_plan.rr_achieved < 1.5:
        reasoning.append(f"TP2 R:R {target_plan.rr_achieved:.1f} < 1.5 minimum")
        return EligibilityDecision(
            action="SKIP", confidence=0.0, reasoning=reasoning,
            bias_state=bias_state, location_score=location.score,
            playbook=playbook.playbook, target_plan=target_plan,
        )

    # 6. Max trades hit
    if max_trades_hit:
        reasoning.append("Daily trade limit reached")
        return EligibilityDecision(
            action="SKIP", confidence=0.0, reasoning=reasoning,
            bias_state=bias_state, playbook=playbook.playbook,
        )

    # ─── REDUCE checks ────────────────────────────────────────

    reduce_reasons = []

    if 30 <= location.score < 40:
        reduce_reasons.append(f"Borderline location score {location.score}")

    if 0.3 <= bias_state.bias_confidence < 0.5:
        reduce_reasons.append(f"Weak bias confidence {bias_state.bias_confidence:.2f}")

    if daily_loss_used_pct > 0.6:
        reduce_reasons.append(f"Daily loss {daily_loss_used_pct:.0%} consumed (>60%)")

    if target_plan.rr_achieved < 2.0:
        reduce_reasons.append(f"TP2 R:R {target_plan.rr_achieved:.1f} below ideal 2.0")

    if reduce_reasons:
        reasoning.append("REDUCE: " + "; ".join(reduce_reasons))
        return EligibilityDecision(
            action="REDUCE",
            confidence=bias_state.bias_confidence * playbook.confidence_modifier * 0.5,
            reasoning=reasoning,
            bias_state=bias_state,
            location_score=location.score,
            stop_plan=stop_plan,
            target_plan=target_plan,
            playbook=playbook.playbook,
            override_stop=stop_plan.stop_price,
            override_targets=[target_plan.tp1],  # TP1 only for reduced
            partial_sizes=(1.0, 0.0, 0.0),
            position_size_adjustment=0.5,
        )

    # ─── TAKE ─────────────────────────────────────────────────

    reasoning.append(f"TAKE: playbook={playbook.playbook}, location={location.score} ({location.grade})")
    reasoning.append(f"Bias: net={bias_state.net_bias}, confidence={bias_state.bias_confidence:.2f}")
    reasoning.append(f"R:R={target_plan.rr_achieved:.1f}, stop={stop_plan.stop_reason}")

    confidence = bias_state.bias_confidence * playbook.confidence_modifier
    confidence = max(0.0, min(1.0, confidence))

    return EligibilityDecision(
        action="TAKE",
        confidence=confidence,
        reasoning=reasoning,
        bias_state=bias_state,
        location_score=location.score,
        stop_plan=stop_plan,
        target_plan=target_plan,
        playbook=playbook.playbook,
        override_stop=stop_plan.stop_price,
        override_targets=[target_plan.tp1, target_plan.tp2],
        partial_sizes=target_plan.partial_sizes,
        position_size_adjustment=1.0,
    )
