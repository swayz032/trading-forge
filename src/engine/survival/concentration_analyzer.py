"""Best-day concentration analysis for consistency rules."""

from __future__ import annotations

import numpy as np


def concentration_analysis(
    daily_pnls: list[float],
    consistency_threshold: float | None,
) -> dict:
    """
    Analyze best-day P&L concentration.
    Key metric for TPT (50%) and FFN Express (15%) consistency rules.

    Args:
        daily_pnls: Array of daily net P&L values.
        consistency_threshold: Max allowed fraction of total profit from a single day.
            E.g. 0.50 for TPT, 0.15 for FFN Express. None if no rule.

    Returns:
        {
            "best_day_pnl": float,
            "total_pnl": float,
            "best_day_pct": float,
            "passes_threshold": bool | None,  # None if no threshold
            "top_3_days_pct": float,
            "distribution_evenness": float,  # 0-1, higher = more even
            "score": float,  # 0-100, higher = more consistent
        }
    """
    arr = np.array(daily_pnls, dtype=np.float64)

    if len(arr) == 0:
        return {
            "best_day_pnl": 0.0,
            "total_pnl": 0.0,
            "best_day_pct": 0.0,
            "passes_threshold": None if consistency_threshold is None else True,
            "top_3_days_pct": 0.0,
            "distribution_evenness": 0.0,
            "score": 50.0,
        }

    total_pnl = float(np.sum(arr))
    best_day_pnl = float(np.max(arr))

    # Best day as percentage of total profit
    if total_pnl > 0:
        best_day_pct = best_day_pnl / total_pnl if best_day_pnl > 0 else 0.0
    else:
        # If total P&L is zero or negative, best day pct is meaningless
        # but we set it high to indicate poor distribution
        best_day_pct = 1.0

    # Top 3 days concentration
    sorted_pnls = np.sort(arr)[::-1]  # Descending
    top_3_sum = float(np.sum(sorted_pnls[:3]))
    top_3_days_pct = top_3_sum / total_pnl if total_pnl > 0 else 1.0

    # Distribution evenness: 1 - normalized entropy deficit
    # Perfect evenness = all days contribute equally to profit
    positive_days = arr[arr > 0]
    if len(positive_days) > 1 and np.sum(positive_days) > 0:
        proportions = positive_days / np.sum(positive_days)
        # Shannon entropy normalized to [0, 1]
        entropy = -np.sum(proportions * np.log(proportions + 1e-12))
        max_entropy = np.log(len(positive_days))
        distribution_evenness = float(entropy / max_entropy) if max_entropy > 0 else 0.0
    else:
        distribution_evenness = 0.0

    # Threshold check
    if consistency_threshold is not None:
        passes_threshold = best_day_pct <= consistency_threshold
    else:
        passes_threshold = None

    # Score calculation
    if consistency_threshold is None:
        # No consistency rule — score based on evenness alone
        score = distribution_evenness * 100.0
    else:
        # Score based on how far we are from the threshold
        # If best_day_pct = 0 -> perfect (100), if best_day_pct >= threshold -> 0
        if best_day_pct <= 0:
            score = 100.0
        elif best_day_pct >= consistency_threshold:
            # Failed: scale from 0 down to 0 as we exceed threshold
            score = max(0.0, (1.0 - best_day_pct) * 50.0)
        else:
            # Passing: scale from 50 to 100 based on margin
            margin = (consistency_threshold - best_day_pct) / consistency_threshold
            score = 50.0 + margin * 50.0

    return {
        "best_day_pnl": round(best_day_pnl, 2),
        "total_pnl": round(total_pnl, 2),
        "best_day_pct": round(best_day_pct, 4),
        "passes_threshold": passes_threshold,
        "top_3_days_pct": round(top_3_days_pct, 4),
        "distribution_evenness": round(distribution_evenness, 4),
        "score": round(float(score), 2),
    }
