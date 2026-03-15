"""
Survival Scorer — weighted fitness function optimizing for prop firm survival.
A strategy that survives is worth more than a strategy that profits then dies.

7 Survival Metrics:
1. P(daily loss breach) — from daily P&L distribution
2. P(max DD breach) — Monte Carlo simulation
3. Consistency score — best-day concentration
4. Recovery speed — days to recover from max DD
5. Worst-month survival — minimum winning days in any month
6. Commission drag — net vs gross impact per firm
7. Evaluation speed — days to pass evaluation target

Usage:
    python -m src.engine.survival.survival_scorer --config '{"daily_pnls":[...],"firm":"MFFU"}'
"""

from __future__ import annotations

import json
import sys
import time
from collections import defaultdict

import numpy as np

from .firm_profiles import get_firm_profile
from .daily_breach_model import daily_breach_probability
from .drawdown_simulator import mc_drawdown_breach
from .concentration_analyzer import concentration_analysis

# Default weights (sum to 1.0)
DEFAULT_WEIGHTS = {
    "daily_breach_prob": 0.20,
    "dd_breach_prob": 0.25,
    "consistency": 0.15,
    "recovery_speed": 0.10,
    "worst_month": 0.10,
    "commission_drag": 0.10,
    "eval_speed": 0.10,
}

# Evaluation profit targets per account type (approximate)
EVAL_PROFIT_TARGETS = {
    "50K": 3000,
    "100K": 6000,
    "Express": 3000,
}


def _recovery_speed_score(daily_pnls: list[float]) -> dict:
    """
    Calculate recovery speed from max drawdown in the equity curve.

    Returns:
        {
            "avg_recovery_days": float,
            "max_recovery_days": int,
            "max_dd_value": float,
            "score": float,  # 0-100
        }
    """
    arr = np.array(daily_pnls, dtype=np.float64)
    if len(arr) == 0:
        return {"avg_recovery_days": 0, "max_recovery_days": 0, "max_dd_value": 0.0, "score": 50.0}

    equity = np.cumsum(arr)
    running_peak = np.maximum.accumulate(equity)
    drawdowns = running_peak - equity

    max_dd_value = float(np.max(drawdowns))

    # Find all drawdown periods and their recovery times
    in_drawdown = False
    dd_start = 0
    recovery_days_list = []

    for i in range(len(drawdowns)):
        if drawdowns[i] > 0 and not in_drawdown:
            in_drawdown = True
            dd_start = i
        elif drawdowns[i] == 0 and in_drawdown:
            in_drawdown = False
            recovery_days_list.append(i - dd_start)

    # If still in drawdown at end, count it as unrecovered
    if in_drawdown:
        recovery_days_list.append(len(drawdowns) - dd_start)

    if len(recovery_days_list) == 0:
        # Never had a drawdown — perfect
        return {"avg_recovery_days": 0, "max_recovery_days": 0, "max_dd_value": 0.0, "score": 100.0}

    avg_recovery = float(np.mean(recovery_days_list))
    max_recovery = int(np.max(recovery_days_list))

    # Score: faster recovery = higher score
    # 1 day recovery -> 100, 5 days -> ~61, 10 days -> ~37, 20 days -> ~14
    score = 100.0 * np.exp(-0.05 * avg_recovery)

    return {
        "avg_recovery_days": round(avg_recovery, 1),
        "max_recovery_days": max_recovery,
        "max_dd_value": round(max_dd_value, 2),
        "score": round(float(score), 2),
    }


def _worst_month_score(daily_pnls: list[float]) -> dict:
    """
    Group daily P&Ls by month (assuming ~20 trading days per month),
    count winning days per month, take minimum.

    Returns:
        {
            "worst_month_win_days": int,
            "avg_month_win_days": float,
            "total_months": int,
            "score": float,  # 0-100
        }
    """
    arr = np.array(daily_pnls, dtype=np.float64)
    if len(arr) == 0:
        return {"worst_month_win_days": 0, "avg_month_win_days": 0.0, "total_months": 0, "score": 0.0}

    # Split into ~20-day months
    days_per_month = 20
    months = []
    for start in range(0, len(arr), days_per_month):
        month_data = arr[start:start + days_per_month]
        if len(month_data) >= 10:  # Only count months with at least 10 days
            win_days = int(np.sum(month_data > 0))
            months.append(win_days)

    if len(months) == 0:
        return {"worst_month_win_days": 0, "avg_month_win_days": 0.0, "total_months": 0, "score": 0.0}

    worst = min(months)
    avg = float(np.mean(months))

    # Score: 12+ winning days = good, 10 = minimum, below 10 = bad
    # 14+ -> ~90+, 12 -> ~75, 10 -> ~50, 8 -> ~25, 5 -> ~0
    if worst >= 14:
        score = 90.0 + (worst - 14) * 2.5  # Cap at 100
    elif worst >= 10:
        score = 50.0 + (worst - 10) * 10.0
    else:
        score = max(0.0, worst * 5.0)

    score = min(100.0, score)

    return {
        "worst_month_win_days": worst,
        "avg_month_win_days": round(avg, 1),
        "total_months": len(months),
        "score": round(score, 2),
    }


def _commission_drag_score(
    daily_pnls: list[float],
    commission_per_side: float,
    avg_trades_per_day: float = 2.0,
) -> dict:
    """
    Calculate commission impact: net vs gross ratio.

    Args:
        daily_pnls: Net daily P&Ls (already include commissions).
        commission_per_side: Commission per contract per side at this firm.
        avg_trades_per_day: Average number of round-trip trades per day.

    Returns:
        {
            "net_gross_ratio": float,
            "daily_commission_estimate": float,
            "score": float,  # 0-100
        }
    """
    arr = np.array(daily_pnls, dtype=np.float64)
    if len(arr) == 0:
        return {"net_gross_ratio": 1.0, "daily_commission_estimate": 0.0, "score": 100.0}

    # Estimate daily commission cost (2 sides per round trip)
    daily_commission = commission_per_side * 2.0 * avg_trades_per_day
    total_net = float(np.sum(arr))
    total_gross = total_net + daily_commission * len(arr)  # Add back commissions

    if total_gross <= 0:
        net_gross_ratio = 0.0
    else:
        net_gross_ratio = total_net / total_gross

    # Score: higher ratio = less drag = better
    # 0.95 -> 95, 0.80 -> 80, 0.50 -> 50
    score = max(0.0, min(100.0, net_gross_ratio * 100.0))

    return {
        "net_gross_ratio": round(net_gross_ratio, 4),
        "daily_commission_estimate": round(daily_commission, 2),
        "score": round(score, 2),
    }


def _eval_speed_score(
    daily_pnls: list[float],
    eval_profit_target: float,
) -> dict:
    """
    Estimate days to pass evaluation based on average daily P&L.

    Returns:
        {
            "expected_eval_days": int,
            "avg_daily_pnl": float,
            "score": float,  # 0-100
        }
    """
    arr = np.array(daily_pnls, dtype=np.float64)
    if len(arr) == 0:
        return {"expected_eval_days": 999, "avg_daily_pnl": 0.0, "score": 0.0}

    avg_daily = float(np.mean(arr))

    if avg_daily <= 0:
        return {"expected_eval_days": 999, "avg_daily_pnl": round(avg_daily, 2), "score": 0.0}

    expected_days = int(np.ceil(eval_profit_target / avg_daily))

    # Score: faster = better
    # 5 days -> 100, 10 days -> ~82, 15 days -> ~67, 20 days -> ~55, 30 -> ~35
    if expected_days <= 5:
        score = 100.0
    elif expected_days <= 30:
        score = 100.0 * np.exp(-0.035 * (expected_days - 5))
    else:
        score = max(0.0, 30.0 - (expected_days - 30) * 0.5)

    return {
        "expected_eval_days": expected_days,
        "avg_daily_pnl": round(avg_daily, 2),
        "score": round(float(score), 2),
    }


def _assign_grade(score: float) -> str:
    """Assign letter grade from composite score."""
    if score >= 80:
        return "A"
    elif score >= 65:
        return "B"
    elif score >= 50:
        return "C"
    elif score >= 35:
        return "D"
    else:
        return "F"


def survival_score(
    daily_pnls: list[float],
    firm: str,
    account_type: str = "50K",
    num_mc_sims: int = 5000,
    weights: dict | None = None,
    avg_trades_per_day: float = 2.0,
) -> dict:
    """
    Calculate composite survival score (0-100) for a strategy at a specific firm.

    Args:
        daily_pnls: Array of daily net P&L values from backtest.
        firm: Firm name (MFFU, Topstep, etc.).
        account_type: Account type (50K, 100K, Express, etc.).
        num_mc_sims: Number of Monte Carlo simulations for DD breach prob.
        weights: Optional custom weights (defaults to DEFAULT_WEIGHTS).
        avg_trades_per_day: Average round-trip trades per day for commission calc.

    Returns:
        {
            "survival_score": float,  # 0-100 composite
            "metrics": {
                "daily_breach_prob": float,  # 0-100 score
                "dd_breach_prob": float,     # 0-100 score
                "consistency": float,        # 0-100 score
                "recovery_speed": float,     # 0-100 score
                "worst_month": float,        # 0-100 score
                "commission_drag": float,    # 0-100 score
                "eval_speed": float,         # 0-100 score
            },
            "raw": { ... },
            "firm": str,
            "account_type": str,
            "grade": str,  # A | B | C | D | F
        }
    """
    profile = get_firm_profile(firm, account_type)
    if profile is None:
        return {
            "survival_score": 0.0,
            "metrics": {},
            "raw": {},
            "firm": firm,
            "account_type": account_type,
            "grade": "F",
            "error": f"Unknown firm/account: {firm}/{account_type}",
        }

    w = weights or DEFAULT_WEIGHTS

    # 1. Daily breach probability
    daily_result = daily_breach_probability(daily_pnls, profile["daily_loss_limit"])

    # 2. MC drawdown breach
    mc_result = mc_drawdown_breach(
        daily_pnls,
        profile["max_drawdown"],
        profile["drawdown_type"],
        num_sims=num_mc_sims,
    )

    # 3. Consistency / concentration
    conc_result = concentration_analysis(daily_pnls, profile["consistency_threshold"])

    # 4. Recovery speed
    recovery_result = _recovery_speed_score(daily_pnls)

    # 5. Worst month
    month_result = _worst_month_score(daily_pnls)

    # 6. Commission drag
    comm_result = _commission_drag_score(
        daily_pnls, profile["commission_per_side"], avg_trades_per_day
    )

    # 7. Eval speed
    eval_target = EVAL_PROFIT_TARGETS.get(account_type, 3000)
    eval_result = _eval_speed_score(daily_pnls, eval_target)

    # Collect normalized scores (each 0-100)
    metrics = {
        "daily_breach_prob": daily_result["score"],
        "dd_breach_prob": mc_result["score"],
        "consistency": conc_result["score"],
        "recovery_speed": recovery_result["score"],
        "worst_month": month_result["score"],
        "commission_drag": comm_result["score"],
        "eval_speed": eval_result["score"],
    }

    # Weighted composite
    composite = sum(metrics[k] * w[k] for k in w)

    # Raw values for transparency
    raw = {
        "daily_breach_probability": daily_result["breach_probability"],
        "mc_dd_breach_probability": mc_result["breach_probability"],
        "best_day_pct": conc_result["best_day_pct"],
        "avg_recovery_days": recovery_result["avg_recovery_days"],
        "worst_month_win_days": month_result["worst_month_win_days"],
        "net_gross_ratio": comm_result["net_gross_ratio"],
        "expected_eval_days": eval_result["expected_eval_days"],
    }

    grade = _assign_grade(composite)

    return {
        "survival_score": round(composite, 2),
        "metrics": {k: round(v, 2) for k, v in metrics.items()},
        "raw": raw,
        "firm": firm,
        "account_type": account_type,
        "grade": grade,
    }


# ─── CLI Entry Point ─────────────────────────────────────────────

def main():
    """CLI: python -m src.engine.survival.survival_scorer --config <json>"""
    import argparse

    parser = argparse.ArgumentParser(description="Survival Scorer")
    parser.add_argument("--config", required=True, help="JSON config string or file path")
    args = parser.parse_args()

    import os
    config_input = args.config
    if os.path.isfile(config_input):
        with open(config_input) as f:
            config = json.load(f)
    else:
        config = json.loads(config_input)

    result = survival_score(
        daily_pnls=config["daily_pnls"],
        firm=config["firm"],
        account_type=config.get("account_type", "50K"),
        num_mc_sims=config.get("num_mc_sims", 5000),
        weights=config.get("weights"),
        avg_trades_per_day=config.get("avg_trades_per_day", 2.0),
    )

    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
