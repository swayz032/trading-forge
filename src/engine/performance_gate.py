"""Performance gates, tier classification, and Forge Score.

Hard minimums from CLAUDE.md — all metrics on walk-forward OOS data only.
"""

from __future__ import annotations


def check_performance_gate(stats: dict) -> tuple[bool, list[str]]:
    """Check hard minimum performance requirements.

    All metrics must be from walk-forward OUT-OF-SAMPLE data.

    Returns:
        (passed, rejection_reasons)
    """
    rejections: list[str] = []

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

    # Earnings power
    if stats["avg_daily_pnl"] < 250:
        rejections.append(
            f"avg_daily_pnl ${stats['avg_daily_pnl']:.0f} < $250 minimum. "
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
) -> float:
    """Compute Forge Score (0-100).

    Components:
    - Earnings power (0-30): avg_daily_pnl scaled
    - Daily survival (0-25): win day rate scaled
    - Drawdown vs prop firm (0-20): distance from $2,500 limit
    - MC + Walk-forward (0-25): MC survival (0-10) + WF consistency (0-10) + Sharpe stability (0-5)
    - Crisis bonus (0-5): bonus pts for surviving historical crises (capped at 100)

    Returns:
        float score 0-100 (capped)
    """
    # Earnings power (0-30): $250 = 0, $750+ = 30
    earnings = min(30, max(0, (stats["avg_daily_pnl"] - 250) / 500 * 30))

    # Daily survival (0-25): 60% = 0, 80%+ = 25
    total_days = max(stats["total_trading_days"], 1)
    win_rate = stats["winning_days"] / total_days
    survival = min(25, max(0, (win_rate - 0.60) / 0.20 * 25))

    # Drawdown vs prop firm (0-20): $2,000 = 0 (tightest 50K firm), $500 = 20
    dd = stats["max_drawdown"]
    drawdown_score = min(20, max(0, (2000 - dd) / 1500 * 20))

    # MC + Walk-forward (0-25)
    if mc_results is not None:
        # MC survival rate (0-10): 99%+ = 10, 90% = 0, linear
        ruin = mc_results.get("probability_of_ruin", 1.0)
        survival_rate = 1.0 - ruin
        mc_survival = min(10, max(0, (survival_rate - 0.90) / 0.09 * 10))

        # Walk-forward OOS consistency (0-10): Sharpe + PF from stats
        sharpe_wf = min(5, max(0, (stats["sharpe_ratio"] - 1.5) / 1.5 * 5))
        pf_wf = min(5, max(0, (stats["profit_factor"] - 1.75) / 1.25 * 5))
        wf_consistency = sharpe_wf + pf_wf

        # Sharpe stability (0-5): MC Sharpe spread (p95 - p5)
        sharpe_dist = mc_results.get("sharpe_distribution", {})
        spread = sharpe_dist.get("p95", 5.0) - sharpe_dist.get("p5", 0.0)
        sharpe_stability = min(5, max(0, (2.0 - spread) / 1.5 * 5))

        consistency = mc_survival + wf_consistency + sharpe_stability
    else:
        # Backward compat: original Sharpe + PF method
        sharpe_part = min(12.5, max(0, (stats["sharpe_ratio"] - 1.5) / 1.5 * 12.5))
        pf_part = min(12.5, max(0, (stats["profit_factor"] - 1.75) / 1.25 * 12.5))
        consistency = sharpe_part + pf_part

    base_score = earnings + survival + drawdown_score + consistency

    # Crisis bonus (0-5): all pass = 5, lose ~0.6 per failure, 0 if 2+ fail
    crisis_bonus = 0.0
    if crisis_results is not None:
        scenarios = crisis_results.get("scenarios", [])
        if scenarios:
            passed_count = sum(1 for s in scenarios if s.get("passed", False))
            total = len(scenarios)
            failed_count = total - passed_count
            if failed_count >= 2:
                crisis_bonus = 0.0
            elif total > 0:
                crisis_bonus = (passed_count / total) * 5.0

    return round(min(100, base_score + crisis_bonus), 1)


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
