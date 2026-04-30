"""Performance gates, tier classification, and Forge Score.

Hard minimums from CLAUDE.md — all metrics on walk-forward OOS data only.
"""

from __future__ import annotations

import logging
import os

from src.engine.survival.survival_scorer import survival_score as score_strategy_survival

logger = logging.getLogger(__name__)

# ── TF_SURVIVAL_IN_FORGE_SCORE ─────────────────────────────────────────────
# Controls whether raw_survival_score is included in the composite forge_score.
#
# SHADOW mode (default, env var absent or "false"):
#   - survival_component IS computed and logged as telemetry
#   - forge_score returned to callers does NOT include survival_component
#   - allows monitoring metric drift before enforcing
#
# ENFORCE mode (env var = "true"):
#   - survival_component IS included in the composite forge_score
#   - scores will shift upward for strategies with high survival scores and
#     downward for strategies with low survival scores (0 pts below score 60)
#
# Risk of metric drift when enforcing:
#   - Strategies with survival_score < 60 lose up to 11 points from forge_score
#   - Strategies with survival_score >= 100 gain up to 11 points
#   - Historical forge_score comparisons are NOT valid across the mode boundary
_SURVIVAL_IN_FORGE_SCORE = os.environ.get("TF_SURVIVAL_IN_FORGE_SCORE", "false").lower() == "true"


# P2-G: Per-firm avg_daily_pnl threshold adjustments.
# Commission ranges: Topstep $0.37/side, Alpha $0.00/side, Tradeify $1.29/side, others $0.62/side.
# At ~10 trades/day that's a $0-$25.8 swing in net daily P&L vs the $0.62 baseline.
# Firms with lower commissions effectively raise the net hurdle (same gross needed, less deducted).
# Firms with higher commissions (Tradeify) need a slightly lower gross to clear the same net bar.
# Adjustment is in net P&L dollars: positive = easier threshold, negative = harder threshold.
# Rationale: $0.62 baseline at 10 trades/day = $12.40 commission drag. Alpha at $0.00 = $0 drag,
# so a strategy at $250 gross on Alpha actually clears $262.40 net. Tradeify at $1.29 = $25.80,
# so $250 gross only clears $224.20 net — we relax by $25 to compensate for higher drag.
_FIRM_DAILY_PNL_ADJUSTMENT: dict[str, float] = {
    # Alpha Futures: $0.00/side — no commission drag, so $250 gross = $262/net. No relaxation needed.
    "alpha_50k": 0,
    "alpha_25k": 0,
    # Topstep: $0.37/side — very low drag. Treat as baseline.
    "topstep_50k": 0,
    "topstep_25k": 0,
    # MFFU: $0.62/side — baseline. No adjustment.
    "mffu_50k": 0,
    # Earn2Trade: $0.62/side — baseline.
    "earn2trade_50k": 0,
    # Apex: $0.62/side — baseline.
    "apex_50k": 0,
    "apex_25k": 0,
    # TPT: $0.62/side — baseline.
    "tpt_50k": 0,
    # FFN: $0.62/side — baseline.
    "ffn_50k": 0,
    # Tradeify: $1.29/side — $6.70 extra drag vs baseline at 10 trades/day.
    # Relax threshold by $20 to account for higher commission environment.
    "tradeify_50k": +20,
    "tradeify_25k": +20,
}


def check_performance_gate(stats: dict, firm_key: str | None = None) -> tuple[bool, list[str]]:
    """Check hard minimum performance requirements.

    All metrics must be from walk-forward OUT-OF-SAMPLE data.

    Args:
        stats: Performance statistics dict.
        firm_key: Optional prop firm key. When supplied, adjusts the avg_daily_pnl
            threshold based on per-firm commission levels. Firms with higher commissions
            (Tradeify $1.29/side) get a relaxed threshold; firms with zero commissions
            (Alpha) get no relaxation.

    Returns:
        (passed, rejection_reasons)
    """
    rejections: list[str] = []

    # P2-G: compute per-firm adjusted daily PnL threshold
    _pnl_adjustment = _FIRM_DAILY_PNL_ADJUSTMENT.get(firm_key or "", 0)
    _min_daily_pnl = 250 - _pnl_adjustment  # positive adjustment RELAXES (lowers) threshold

    # Zero-day guard
    if stats.get("total_trading_days", 0) == 0:
        return (False, ["No trading days — cannot evaluate performance"])

    # Hard gate: minimum sample days
    if stats.get("total_trading_days", 0) < 60:
        return (False, [
            f"Only {stats.get('total_trading_days', 0)} OOS trading days — "
            f"minimum 60 required for statistical reliability"
        ])

    # Hard gate: minimum sample trades
    if stats.get("total_trades", 0) < 100:
        return (False, [
            f"Only {stats.get('total_trades', 0)} OOS trades — "
            f"minimum 100 required for statistical reliability"
        ])

    # Earnings power (per-firm adjusted threshold)
    if stats["avg_daily_pnl"] < _min_daily_pnl:
        _threshold_note = f" (firm={firm_key}, adj={_pnl_adjustment:+.0f})" if firm_key else ""
        rejections.append(
            f"avg_daily_pnl ${stats['avg_daily_pnl']:.0f} < ${_min_daily_pnl:.0f} minimum{_threshold_note}. "
            f"Strategy earns ${stats['avg_daily_pnl'] * 20:.0f}/month — not worth one account."
        )

    # Daily survival: 60%+ winning days
    win_rate = stats["winning_days"] / stats["total_trading_days"]
    if win_rate < 0.60:
        rejections.append(
            f"Win rate by days {win_rate:.0%} < 60% minimum. "
            f"{stats['total_trading_days'] - stats['winning_days']} losing days "
            f"out of {stats['total_trading_days']} — too inconsistent."
        )

    # Worst month
    if stats.get("worst_month_win_days", 0) < 10:
        rejections.append(
            f"Worst month had only {stats['worst_month_win_days']} winning days. "
            f"Minimum 10 required."
        )

    # Profit factor
    if stats["profit_factor"] < 1.75:
        rejections.append(
            f"Profit factor {stats['profit_factor']:.2f} < 1.75 minimum."
        )

    # Sharpe
    if stats["sharpe_ratio"] < 1.5:
        rejections.append(
            f"Sharpe ratio {stats['sharpe_ratio']:.2f} < 1.5 minimum."
        )

    # Winner/loser ratio — minimum 1:2 R:R (avg win $ must be 2x avg loss $)
    if stats.get("avg_winner_to_loser_ratio", 0) < 2.0:
        rejections.append(
            f"Avg winner/loser ratio {stats['avg_winner_to_loser_ratio']:.2f} < 2.0."
        )

    # Max drawdown — must survive tightest 50K prop firm (Topstep/Alpha/Earn2Trade = $2,000)
    if stats["max_drawdown"] > 2000:
        rejections.append(
            f"Max drawdown ${stats['max_drawdown']:.0f} > $2,000. "
            f"Exceeds tightest prop firm DD limit (Topstep 50K)."
        )

    # Consecutive losers
    if stats.get("max_consecutive_losing_days", 0) > 4:
        rejections.append(
            f"Max consecutive losing days: {stats['max_consecutive_losing_days']}. "
            f"Maximum 4 allowed."
        )

    # Expectancy per trade
    if stats.get("expectancy_per_trade", 0) < 75:
        rejections.append("expectancy_per_trade < $75")

    # Red days vs green days
    avg_loss = abs(stats.get("avg_loss_on_red_days", 0))
    avg_win = stats.get("avg_win_on_green_days", 0)
    if avg_loss > avg_win and avg_loss > 0:
        rejections.append(
            f"Avg loss on red days (${avg_loss:.0f}) > "
            f"avg win on green days (${avg_win:.0f}) — unsustainable."
        )

    # B-6: Recovery days gate — flag if DD recovery > 5 days
    recovery_days = stats.get("recovery_days_from_max_dd", 0)
    if recovery_days > 5:
        rejections.append(
            f"Recovery from max drawdown took {recovery_days} days (max 5 allowed)."
        )

    # Task 3.7: Sample size warning (not a rejection, but flagged)
    warnings: list[str] = []
    total_trades = stats.get("total_trades", 0)
    if total_trades < 500:
        warnings.append(
            f"Only {total_trades} trades — results may be statistically unreliable (need 500+). "
            f"Sample confidence: {'MEDIUM' if total_trades >= 200 else 'LOW'}."
        )

    # Alpha decay flag (warning, not rejection)
    decay = stats.get("decay_analysis", {})
    if decay.get("composite_score", 0) > 60:
        warnings.append(
            f"DECAYING: composite decay score {decay['composite_score']:.1f}/100. "
            f"Half-life: {decay.get('half_life_days', 'N/A')} days. "
            f"Trend: {decay.get('trend', 'unknown')}. Monitor closely."
        )

    return (len(rejections) == 0, rejections + warnings)


def classify_tier(stats: dict) -> str:
    """Classify strategy into performance tier.

    TIER_1: $500+/day, 14+ win days, <$1,500 DD, PF >= 2.5, Sharpe >= 2.0
    TIER_2: $350+/day, 13+ win days, <$2,000 DD, PF >= 2.0, Sharpe >= 1.75
    TIER_3: $250+/day, 12+ win days, <$2,500 DD, PF >= 1.75, Sharpe >= 1.5

    NOTE — Sharpe ratio is dollar-denominated:
        sharpe_ratio = mean(daily_pnl_$) / std(daily_pnl_$) * sqrt(252)
        This is computed on raw dollar P&L, not percentage returns. It is
        scale-dependent (a 5-contract strategy will show higher dollar Sharpe
        than 1-contract even if the edge is identical). Do NOT compare this
        Sharpe directly to academic Sharpe ratios or benchmarks computed on
        percentage returns. Use only for relative ranking within this system.
    """
    pnl = stats["avg_daily_pnl"]
    win_days = stats["winning_days"] / stats["total_trading_days"] * 20
    dd = stats["max_drawdown"]
    pf = stats["profit_factor"]
    sharpe = stats["sharpe_ratio"]

    if pnl >= 500 and win_days >= 14 and dd < 1500 and pf >= 2.5 and sharpe >= 2.0:
        return "TIER_1"
    if pnl >= 350 and win_days >= 13 and dd < 2000 and pf >= 2.0 and sharpe >= 1.75:
        return "TIER_2"
    if pnl >= 250 and win_days >= 12 and dd < 2500 and pf >= 1.75 and sharpe >= 1.5:
        return "TIER_3"
    return "REJECTED"


def compute_forge_score(
    stats: dict,
    mc_results: dict | None = None,
    crisis_results: dict | None = None,
    survival_results: dict | None = None,
    firm_max_dd: float = 2000.0,
) -> dict:
    """Compute Forge Score (0-100) with survival component and crisis hard veto.

    Components:
    - Earnings power (0-27): avg_daily_pnl scaled (reduced from 30 to make room for survival)
    - Daily survival (0-22): win day rate scaled (reduced from 25)
    - Drawdown vs prop firm (0-18): distance from $2,500 limit (reduced from 20)
    - MC + Walk-forward (0-22): MC survival (0-9) + WF consistency (0-9) + Sharpe stability (0-4)
      (reduced from 25 to make room for survival)
    - Survival optimizer (0-11): prop-firm survival score from survival_scorer
      Note: these 5 components sum to 100 (27+22+18+22+11=100).
    - Crisis veto (hard gate, not bonus): if any crisis scenario DD > firm_max_dd, score=0 + REJECT flag

    The Sharpe ratio in this output is dollar-denominated (based on daily P&L in dollars).
    It is scale-dependent and NOT directly comparable to academic Sharpe ratios computed
    on percentage returns. Use only for relative ranking of strategies on the same instrument.

    Returns:
        dict with keys:
            "score": float 0-100 (capped)
            "passed": bool — False if crisis veto triggered
            "crisis_veto": bool — True if any scenario DD exceeded firm_max_dd
            "crisis_veto_reason": str — human-readable reason if vetoed
            "components": dict — per-component breakdown for audit
    """
    # ── D7: Crisis hard veto — CLAUDE.md: "if any scenario exceeds prop firm max drawdown → FAIL"
    # Previous behavior: crisis was bonus-only (0-5 pts), strategy could pass even on 2008 blow-up.
    # New behavior: ANY scenario with DD > firm_max_dd forces passed=False regardless of score.
    # Risk of metric drift: strategies that previously passed with crisis failures will now be REJECTED.
    # This is intentional — prevents deploying strategies that blow up in stressed regimes.
    crisis_veto = False
    crisis_veto_reason = ""
    if crisis_results is not None:
        scenarios = crisis_results.get("scenarios", [])
        for s in scenarios:
            scenario_dd = s.get("max_drawdown", 0.0)
            scenario_name = s.get("name", "unknown")
            if scenario_dd > firm_max_dd:
                crisis_veto = True
                crisis_veto_reason = (
                    f"crisis-stress-breach: scenario '{scenario_name}' max_drawdown "
                    f"${scenario_dd:.0f} exceeds firm_max_dd ${firm_max_dd:.0f}"
                )
                break  # First breach is sufficient — no need to scan all

    # ── Earnings power (0-27): $250 = 0, $750+ = 27
    # Reduced from 30 to 27 to accommodate survival_score component (total still = 100)
    earnings = min(27, max(0, (stats["avg_daily_pnl"] - 250) / 500 * 27))

    # ── Daily survival (0-22): 60% = 0, 80%+ = 22
    # Reduced from 25 to 22 to accommodate survival_score component
    total_days = max(stats["total_trading_days"], 1)
    win_rate = stats["winning_days"] / total_days
    daily_survival = min(22, max(0, (win_rate - 0.60) / 0.20 * 22))

    # ── Drawdown vs prop firm (0-18): $2,000 = 0 (tightest 50K firm), $500 = 18
    # Reduced from 20 to 18 to accommodate survival_score component
    dd = stats["max_drawdown"]
    drawdown_score = min(18, max(0, (2000 - dd) / 1500 * 18))

    # ── MC + Walk-forward (0-22)
    # Reduced from 25 to 22 to accommodate survival_score component
    if mc_results is not None:
        # MC survival rate (0-9): 99%+ = 9, 90% = 0, linear
        ruin = mc_results.get("probability_of_ruin", 1.0)
        survival_rate = 1.0 - ruin
        mc_survival = min(9, max(0, (survival_rate - 0.90) / 0.09 * 9))

        # Walk-forward OOS consistency (0-9): Sharpe + PF from stats
        sharpe_wf = min(4.5, max(0, (stats["sharpe_ratio"] - 1.5) / 1.5 * 4.5))
        pf_wf = min(4.5, max(0, (stats["profit_factor"] - 1.75) / 1.25 * 4.5))
        wf_consistency = sharpe_wf + pf_wf

        # Sharpe stability (0-4): MC Sharpe spread (p95 - p5)
        sharpe_dist = mc_results.get("sharpe_distribution", {})
        spread = sharpe_dist.get("p95", 5.0) - sharpe_dist.get("p5", 0.0)
        sharpe_stability = min(4, max(0, (2.0 - spread) / 1.5 * 4))

        consistency = mc_survival + wf_consistency + sharpe_stability
    else:
        # Backward compat: original Sharpe + PF method, scaled to 22 max
        sharpe_part = min(11, max(0, (stats["sharpe_ratio"] - 1.5) / 1.5 * 11))
        pf_part = min(11, max(0, (stats["profit_factor"] - 1.75) / 1.25 * 11))
        consistency = sharpe_part + pf_part

    # ── C4: Survival optimizer score (0-11)
    # Integrates prop-firm survival metrics: daily breach prob, DD breach prob,
    # consistency, recovery speed, worst month, commission drag, eval speed.
    # A strategy that survives the firm's rules is worth more than one that merely profits.
    # survival_results is the output of score_strategy_survival() — composite 0-100 score.
    survival_component = 0.0
    raw_survival_score = 0.0
    if survival_results is not None:
        raw_survival_score = float(survival_results.get("survival_score", 0.0))
        # Map 0-100 survival score to 0-11 component points
        # survival_score 60 → 0 pts (minimum threshold), 100 → 11 pts
        survival_component = min(11, max(0, (raw_survival_score - 60) / 40 * 11))
    # If no survival_results provided, component stays 0 (backward compat — won't block scoring,
    # but survival gate in lifecycle-service will still require survival_score >= 60 directly)

    # ── TF_SURVIVAL_IN_FORGE_SCORE: shadow vs enforce ─────────────────────
    # SHADOW (default): compute survival_component but exclude it from base_score.
    #   The score is logged so metric drift can be observed before the gate is enforced.
    # ENFORCE: include survival_component in base_score (full 100-point composite).
    if _SURVIVAL_IN_FORGE_SCORE:
        # ENFORCE — survival_component is part of the composite (up to 11 pts)
        base_score = earnings + daily_survival + drawdown_score + consistency + survival_component
    else:
        # SHADOW — survival_component excluded; base_score is the pre-C4 formula
        base_score = earnings + daily_survival + drawdown_score + consistency
        shadow_with_survival = base_score + survival_component
        logger.info(
            "forge_score shadow: survival excluded from composite "
            "(TF_SURVIVAL_IN_FORGE_SCORE=false). "
            "raw_survival_score=%.1f survival_component=%.2f "
            "score_without=%.1f score_with_survival=%.1f",
            raw_survival_score,
            survival_component,
            base_score,
            shadow_with_survival,
        )

    # ── Crisis veto forces score to 0 and marks as failed (no bonus, no partial credit)
    if crisis_veto:
        final_score = 0.0
        passed = False
    else:
        final_score = round(min(100, base_score), 1)
        passed = True  # score-based pass; caller also checks performance_gate separately

    return {
        "score": final_score,
        "passed": passed,
        "crisis_veto": crisis_veto,
        "crisis_veto_reason": crisis_veto_reason,
        "components": {
            "earnings_power": round(earnings, 2),
            "daily_survival": round(daily_survival, 2),
            "drawdown_score": round(drawdown_score, 2),
            "mc_wf_consistency": round(consistency, 2),
            "survival_optimizer": round(survival_component, 2),
            "raw_survival_score": round(raw_survival_score, 2),
            # Shadow audit field: True = survival included in score, False = shadow only.
            # Downstream consumers can use this to detect mode and avoid comparing scores
            # across mode boundaries (pre-enforce scores are NOT comparable to post-enforce scores).
            "survival_in_score": _SURVIVAL_IN_FORGE_SCORE,
        },
    }


# ─── Kill Signal Logic (Refinement Loop) ────────────────────────────────

# TIER_3 minimums for reference (used by kill signal)
_TIER3_MINS = {
    "sharpe_ratio": 1.5,
    "profit_factor": 1.75,
    "avg_daily_pnl": 250,
    "win_rate": 0.60,
}


def compute_kill_signal(attempts: list[dict]) -> str | None:
    """Decide whether to kill a strategy concept during refinement.

    Called after each iteration by the n8n refinement loop.
    Examines the history of all attempts so far.

    Args:
        attempts: List of backtest result dicts (one per iteration).
                  Each must contain at least: sharpe_ratio, max_drawdown,
                  win_rate (0-1), profit_factor, avg_daily_pnl.

    Returns:
        Kill signal string, or None to continue refinement.
        - "no_edge"           — Best Sharpe < 0.8 (no exploitable edge)
        - "catastrophic_risk" — Any attempt has DD > $6,000 (3x firm limit)
        - "wrong_direction"   — All attempts have win_rate < 0.40
        - "unprofitable"      — All attempts have profit_factor < 1.0
        - "flat_improvement"  — Sharpe improvement < 0.1 between iterations
        - "below_tier3"       — Best attempt < 70% of TIER_3 minimums (Stage 2+ only)
        - None                — Keep refining
    """
    if not attempts:
        return None

    # ── Catastrophic risk: immediate kill ──
    for a in attempts:
        if a.get("max_drawdown", 0) > 6000:
            return "catastrophic_risk"

    best_sharpe = max(a.get("sharpe_ratio", 0) for a in attempts)
    best_pf = max(a.get("profit_factor", 0) for a in attempts)
    best_wr = max(a.get("win_rate", 0) for a in attempts)
    best_pnl = max(a.get("avg_daily_pnl", 0) for a in attempts)

    # ── No edge: Sharpe too low across all attempts ──
    if best_sharpe < 0.8:
        return "no_edge"

    # ── Wrong direction: win rate < 40% across all ──
    if best_wr < 0.40:
        return "wrong_direction"

    # ── Unprofitable: PF < 1.0 across all ──
    if best_pf < 1.0:
        return "unprofitable"

    # ── Flat improvement: Sharpe delta < 0.1 between last two attempts ──
    if len(attempts) >= 2:
        prev_sharpe = attempts[-2].get("sharpe_ratio", 0)
        curr_sharpe = attempts[-1].get("sharpe_ratio", 0)
        if abs(curr_sharpe - prev_sharpe) < 0.1 and curr_sharpe < _TIER3_MINS["sharpe_ratio"]:
            return "flat_improvement"

    # ── Below TIER_3 threshold (for Stage 2+ decisions) ──
    # Best must reach at least 70% of TIER_3 mins to justify continuing
    if len(attempts) >= 3:
        pct_sharpe = best_sharpe / _TIER3_MINS["sharpe_ratio"]
        pct_pf = best_pf / _TIER3_MINS["profit_factor"]
        pct_pnl = best_pnl / _TIER3_MINS["avg_daily_pnl"]
        avg_pct = (pct_sharpe + pct_pf + pct_pnl) / 3
        if avg_pct < 0.70:
            return "below_tier3"

    return None


def get_refinement_stage(iteration: int) -> int:
    """Map iteration number (0-8) to refinement stage (1-3).

    Stage 1 (iterations 0-2): Parameter refinement
    Stage 2 (iterations 3-5): Logic variant
    Stage 3 (iterations 6-8): Concept pivot
    """
    if iteration < 3:
        return 1
    if iteration < 6:
        return 2
    return 3


def get_stage_prompt(stage: int) -> str:
    """Return the Ollama prompt modifier for each refinement stage."""
    prompts = {
        1: (
            "STAGE 1 — PARAMETER REFINEMENT: Same strategy logic, adjust parameters. "
            "Try different lookback periods, ATR multiples, or threshold values. "
            "Do NOT change the core entry/exit logic."
        ),
        2: (
            "STAGE 2 — LOGIC VARIANT: Same edge thesis, different execution. "
            "Try a different entry method (e.g., mean reversion instead of breakout) "
            "or different exit logic. Keep the same market hypothesis."
        ),
        3: (
            "STAGE 3 — CONCEPT PIVOT: Different edge entirely for this symbol/session. "
            "Abandon the previous approach. Try a completely different strategy concept "
            "(e.g., session pattern instead of momentum)."
        ),
    }
    return prompts.get(stage, prompts[1])
