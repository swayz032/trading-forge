"""Compare strategies by survival score across firms."""

from __future__ import annotations

import json
import sys

from .survival_scorer import survival_score
from .firm_profiles import list_firms


def compare_strategies(
    strategies: list[dict],  # Each has "name", "daily_pnls", etc.
    firms: list[str] | None = None,
    account_type: str = "50K",
    num_mc_sims: int = 5000,
) -> dict:
    """
    Compare multiple strategies across multiple firms.
    Returns ranked leaderboard.

    Args:
        strategies: List of dicts with "name" and "daily_pnls" keys.
        firms: List of firm names to compare against. None = all firms.
        account_type: Account type to test against.
        num_mc_sims: Number of MC sims per strategy-firm combo.

    Returns:
        {
            "leaderboard": [
                {
                    "rank": int,
                    "strategy": str,
                    "avg_survival_score": float,
                    "best_firm": str,
                    "best_firm_score": float,
                    "worst_firm": str,
                    "worst_firm_score": float,
                    "scores_by_firm": { firm: score },
                    "grades_by_firm": { firm: grade },
                },
                ...
            ],
            "firm_rankings": {
                firm: [
                    {"strategy": str, "score": float, "grade": str},
                    ...
                ]
            },
            "strategies_tested": int,
            "firms_tested": int,
        }
    """
    target_firms = firms or list_firms()

    # Score every strategy at every firm
    all_results = []
    for strat in strategies:
        strat_name = strat["name"]
        daily_pnls = strat["daily_pnls"]
        scores_by_firm = {}
        grades_by_firm = {}

        for firm in target_firms:
            result = survival_score(
                daily_pnls=daily_pnls,
                firm=firm,
                account_type=account_type,
                num_mc_sims=num_mc_sims,
            )
            scores_by_firm[firm] = result["survival_score"]
            grades_by_firm[firm] = result["grade"]

        valid_scores = {f: s for f, s in scores_by_firm.items() if s > 0}

        if valid_scores:
            avg_score = sum(valid_scores.values()) / len(valid_scores)
            best_firm = max(valid_scores, key=valid_scores.get)
            worst_firm = min(valid_scores, key=valid_scores.get)
        else:
            avg_score = 0.0
            best_firm = target_firms[0] if target_firms else "N/A"
            worst_firm = target_firms[0] if target_firms else "N/A"

        all_results.append({
            "strategy": strat_name,
            "avg_survival_score": round(avg_score, 2),
            "best_firm": best_firm,
            "best_firm_score": round(scores_by_firm.get(best_firm, 0.0), 2),
            "worst_firm": worst_firm,
            "worst_firm_score": round(scores_by_firm.get(worst_firm, 0.0), 2),
            "scores_by_firm": {k: round(v, 2) for k, v in scores_by_firm.items()},
            "grades_by_firm": grades_by_firm,
        })

    # Sort by average survival score descending
    all_results.sort(key=lambda x: x["avg_survival_score"], reverse=True)
    for i, r in enumerate(all_results):
        r["rank"] = i + 1

    # Per-firm rankings
    firm_rankings = {}
    for firm in target_firms:
        firm_list = []
        for r in all_results:
            firm_list.append({
                "strategy": r["strategy"],
                "score": r["scores_by_firm"].get(firm, 0.0),
                "grade": r["grades_by_firm"].get(firm, "F"),
            })
        firm_list.sort(key=lambda x: x["score"], reverse=True)
        firm_rankings[firm] = firm_list

    return {
        "leaderboard": all_results,
        "firm_rankings": firm_rankings,
        "strategies_tested": len(strategies),
        "firms_tested": len(target_firms),
    }


# ─── CLI Entry Point ─────────────────────────────────────────────

def main():
    """CLI: python -m src.engine.survival.survival_comparator --config <json>"""
    import argparse
    import os

    parser = argparse.ArgumentParser(description="Survival Comparator")
    parser.add_argument("--config", required=True, help="JSON config string or file path")
    args = parser.parse_args()

    config_input = args.config
    if os.path.isfile(config_input):
        with open(config_input) as f:
            config = json.load(f)
    else:
        config = json.loads(config_input)

    result = compare_strategies(
        strategies=config["strategies"],
        firms=config.get("firms"),
        account_type=config.get("account_type", "50K"),
        num_mc_sims=config.get("num_mc_sims", 5000),
    )

    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
