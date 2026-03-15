"""Map strategies to their best-performing day archetypes."""

from __future__ import annotations

from typing import Any

from .classifier import ARCHETYPES


def map_strategy_to_archetypes(
    strategy_id: str,
    daily_results: list[dict],  # [{date, pnl, archetype}]
) -> dict[str, Any]:
    """
    Analyze which day archetypes a strategy performs best/worst on.

    Args:
        strategy_id: Identifier for the strategy.
        daily_results: List of dicts with 'date', 'pnl', and 'archetype' keys.

    Returns:
        {
            "strategy_id": str,
            "best_archetypes": [...],     # Sorted by avg P&L desc
            "worst_archetypes": [...],    # Sorted by avg P&L asc
            "archetype_stats": {
                "TREND_DAY_UP": {"avg_pnl": 450, "win_rate": 0.78, "count": 23},
                ...
            },
            "recommendation": str,
        }
    """
    # Group results by archetype
    buckets: dict[str, list[float]] = {a: [] for a in ARCHETYPES}
    for r in daily_results:
        arch = r.get("archetype", "")
        pnl = float(r.get("pnl", 0))
        if arch in buckets:
            buckets[arch].append(pnl)

    archetype_stats: dict[str, dict[str, Any]] = {}
    for arch in ARCHETYPES:
        pnls = buckets[arch]
        count = len(pnls)
        if count == 0:
            archetype_stats[arch] = {"avg_pnl": 0.0, "win_rate": 0.0, "count": 0}
            continue
        avg_pnl = sum(pnls) / count
        wins = sum(1 for p in pnls if p > 0)
        win_rate = wins / count
        archetype_stats[arch] = {
            "avg_pnl": round(avg_pnl, 2),
            "win_rate": round(win_rate, 4),
            "count": count,
        }

    # Sort by avg P&L
    sorted_by_pnl = sorted(
        [(a, s) for a, s in archetype_stats.items() if s["count"] > 0],
        key=lambda x: x[1]["avg_pnl"],
        reverse=True,
    )

    best = [a for a, _ in sorted_by_pnl]
    worst = list(reversed(best))

    # Build recommendation
    best_names = [a for a, s in sorted_by_pnl[:3] if s["avg_pnl"] > 0]
    worst_names = [a for a, s in sorted_by_pnl[-2:] if s["avg_pnl"] < 0]

    parts = []
    if best_names:
        parts.append(f"Trade on {', '.join(best_names)} days")
    if worst_names:
        parts.append(f"skip {', '.join(worst_names)} days")
    recommendation = "; ".join(parts) if parts else "Insufficient data for recommendation"

    return {
        "strategy_id": strategy_id,
        "best_archetypes": best,
        "worst_archetypes": worst,
        "archetype_stats": archetype_stats,
        "recommendation": recommendation,
    }
