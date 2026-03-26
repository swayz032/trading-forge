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

    # Winner/loser ratio
    if stats.get("avg_winner_to_loser_ratio", 0) < 1.5:
        rejections.append(
            f"Avg winner/loser ratio {stats['avg_winner_to_loser_ratio']:.2f} < 1.5."
        )

    # Max drawdown — must survive tightest 50K prop firm (Topstep/Alpha/Earn2Trade = $2,000)
    if stats["max_drawdown"] >= 2000:
        rejections.append(
            f"Max drawdown ${stats['max_drawdown']:.0f} >= $2,000. "
            f"Exceeds tightest prop firm DD limit (Topstep 50K)."
        )

    # Consecutive losers
    if stats.get("max_consecutive_losing_days", 0) > 4:
        rejections.append(
            f"Max consecutive losing days: {stats['max_consecutive_losing_days']}. "
            f"Maximum 4 allowed."
        )

    # Red days vs green days
    avg_loss = abs(stats.get("avg_loss_on_red_days", 0))
    avg_win = stats.get("avg_win_on_green_days", 0)
    if avg_loss > avg_win and avg_loss > 0:
        rejections.append(
            f"Avg loss on red days (${avg_loss:.0f}) > "
            f"avg win on green days (${avg_win:.0f}) — unsustainable."
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
    if pnl >= 350 and win_days >= 13 and dd < 1750 and pf >= 2.0 and sharpe >= 1.75:
        return "TIER_2"
    if pnl >= 250 and win_days >= 12 and dd < 2000 and pf >= 1.75 and sharpe >= 1.5:
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
