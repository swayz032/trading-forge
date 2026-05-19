"""Eligibility Gate — Final TAKE/REDUCE/SKIP decision for every signal.

Wraps all strategies via Option C (post-filter decorator). Strategies fire
signals unchanged. This gate decides whether to take, reduce, or skip.

Real ICT/SMC A+ criteria:
  TAKE  = A+ setup (full size, all TPs) — requires 3R, sweep, confluence >= 4, kill zone
  REDUCE = B+ setup (half size, TP1 only) — tradeable but not A+
  SKIP  = No trade — hard blocker present
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from src.engine.context.bias_engine import DailyBiasState
from src.engine.context.playbook_router import PlaybookDecision, route_playbook
from src.engine.context.location_score import LocationScore
from src.engine.context.session_context import SessionContext
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


def _kill_zone_active(session: SessionContext) -> bool:
    """Return True if NY or London kill zone is active."""
    return session.ny_killzone_active or session.london_killzone_active


def evaluate_signal(
    signal: dict,              # {"direction": "long"|"short", "strategy_name": str, "entry_price": float}
    bias_state: DailyBiasState,
    playbook: PlaybookDecision,
    location: LocationScore,
    stop_plan: StopPlan,
    target_plan: TargetPlan,
    session: SessionContext,
    daily_loss_used_pct: float = 0.0,  # 0.0-1.0, how much of daily loss limit consumed
    max_trades_hit: bool = False,
) -> EligibilityDecision:
    """Evaluate a raw strategy signal through the eligibility gate.

    HARD SKIP (any one = skip):
      1. NO_TRADE playbook active
      2. Strategy not in playbook's allowed list
      3. Direction opposes bias AND not reversal playbook
      4. Not in kill zone (NY or London)
      5. No liquidity sweep (location.sweep_present must be True)
      6. Location score < 60
      7. TP2 R:R < 2.0
      8. Max trades hit
      9. Bias confidence < 0.4

    TAKE (A+ — full size, all TPs) requires ALL:
      - Location score >= 80 (institutional grade)
      - TP2 R:R >= 3.0
      - Bias confidence >= 0.6
      - Liquidity sweep present
      - Confluence count >= 4
      - Kill zone active

    REDUCE (B+ — half size, TP1 only):
      Everything that passes SKIP checks but doesn't qualify for TAKE.
    """
    reasoning = []
    direction = signal.get("direction", "long")
    strategy_name = signal.get("strategy_name", "unknown")

    # ─── Hard SKIP checks ─────────────────────────────────────

    # 1. NO_TRADE playbook
    if playbook.playbook == "NO_TRADE":
        reasoning.append("NO_TRADE playbook active")
        if bias_state.no_trade_reasons:
            reasoning.extend(bias_state.no_trade_reasons)
        return EligibilityDecision(
            action="SKIP", confidence=0.0, reasoning=reasoning,
            bias_state=bias_state, playbook=playbook.playbook,
        )

    # 2. Strategy not in allowed list
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

    # 4. Kill zone gate — signals outside NY/London kill zones are SKIP
    if not _kill_zone_active(session):
        reasoning.append(
            f"Not in kill zone (session={session.current_session}, "
            f"ny_kz={session.ny_killzone_active}, london_kz={session.london_killzone_active})"
        )
        return EligibilityDecision(
            action="SKIP", confidence=0.0, reasoning=reasoning,
            bias_state=bias_state, playbook=playbook.playbook,
        )

    # 5. Liquidity sweep required — no sweep = no trade
    if not location.sweep_present:
        reasoning.append("No liquidity sweep present — A+/B+ requires sweep")
        return EligibilityDecision(
            action="SKIP", confidence=0.0, reasoning=reasoning,
            bias_state=bias_state, location_score=location.score,
            playbook=playbook.playbook,
        )

    # 6. Location score < 60 → hard SKIP
    if location.score < 60:
        reasoning.append(f"Location score {location.score} < 60 ({location.grade})")
        return EligibilityDecision(
            action="SKIP", confidence=0.0, reasoning=reasoning,
            bias_state=bias_state, location_score=location.score,
            playbook=playbook.playbook,
        )

    # 7. TP2 R:R below regime-adjusted minimum → hard SKIP
    if target_plan.rr_achieved < target_plan.min_rr_ratio:
        reasoning.append(f"TP2 R:R {target_plan.rr_achieved:.1f} < {target_plan.min_rr_ratio:.1f} minimum")
        return EligibilityDecision(
            action="SKIP", confidence=0.0, reasoning=reasoning,
            bias_state=bias_state, location_score=location.score,
            playbook=playbook.playbook, target_plan=target_plan,
        )

    # 8. Max trades hit
    if max_trades_hit:
        reasoning.append("Daily trade limit reached")
        return EligibilityDecision(
            action="SKIP", confidence=0.0, reasoning=reasoning,
            bias_state=bias_state, playbook=playbook.playbook,
        )

    # 9. Bias confidence < 0.4 → hard SKIP
    if bias_state.bias_confidence < 0.4:
        reasoning.append(f"Bias confidence {bias_state.bias_confidence:.2f} < 0.4 minimum")
        return EligibilityDecision(
            action="SKIP", confidence=0.0, reasoning=reasoning,
            bias_state=bias_state, location_score=location.score,
            playbook=playbook.playbook,
        )

    # ─── TAKE (A+ — full size, all TPs) ─────────────────────

    is_a_plus = (
        location.score >= 80
        and target_plan.rr_achieved >= 3.0
        and bias_state.bias_confidence >= 0.6
        and location.sweep_present          # Already guaranteed by SKIP #5, explicit for clarity
        and location.confluence_count >= 4
        and _kill_zone_active(session)       # Already guaranteed by SKIP #4, explicit for clarity
    )

    if is_a_plus:
        reasoning.append(
            f"TAKE (A+): playbook={playbook.playbook}, location={location.score} ({location.grade})"
        )
        reasoning.append(
            f"Bias: net={bias_state.net_bias}, confidence={bias_state.bias_confidence:.2f}"
        )
        reasoning.append(
            f"R:R={target_plan.rr_achieved:.1f}, confluence={location.confluence_count}, "
            f"sweep=True, stop={stop_plan.stop_reason}"
        )

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

    # ─── REDUCE (B+ — half size, TP1 only) ──────────────────
    # Everything that passed SKIP checks but didn't qualify for TAKE

    reduce_reasons = []

    if location.score < 80:
        reduce_reasons.append(f"Location score {location.score} < 80 (not institutional)")

    if target_plan.rr_achieved < 3.0:
        reduce_reasons.append(f"TP2 R:R {target_plan.rr_achieved:.1f} < 3.0 A+ threshold")

    if bias_state.bias_confidence < 0.6:
        reduce_reasons.append(f"Bias confidence {bias_state.bias_confidence:.2f} < 0.6")

    if location.confluence_count < 4:
        reduce_reasons.append(f"Confluence count {location.confluence_count} < 4")

    if daily_loss_used_pct > 0.6:
        reduce_reasons.append(f"Daily loss {daily_loss_used_pct:.0%} consumed (>60%)")

    reasoning.append("REDUCE (B+): " + "; ".join(reduce_reasons))

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
