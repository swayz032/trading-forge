"""P(daily loss breach) calculator using daily P&L distribution."""

from __future__ import annotations

import math

import numpy as np

try:
    from scipy import stats as scipy_stats
    HAS_SCIPY = True
except ImportError:
    scipy_stats = None
    HAS_SCIPY = False


def _normal_cdf(x: float) -> float:
    """Standard normal CDF fallback when scipy is not available."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def daily_breach_probability(
    daily_pnls: list[float],
    daily_loss_limit: float | None,
) -> dict:
    """
    Calculate probability of breaching daily loss limit.
    Uses empirical distribution + fitted normal tail.

    Args:
        daily_pnls: Array of daily net P&L values.
        daily_loss_limit: Maximum allowed daily loss (positive number, e.g. 1000).
            None means the firm has no daily loss limit.

    Returns:
        {
            "breach_probability": float,  # 0.0-1.0
            "empirical_breach_count": int,
            "total_days": int,
            "worst_day": float,
            "mean_daily_pnl": float,
            "std_daily_pnl": float,
            "has_daily_limit": bool,
            "score": float,  # 0-100, higher = safer
        }
    """
    arr = np.array(daily_pnls, dtype=np.float64)

    if len(arr) == 0:
        return {
            "breach_probability": 0.0,
            "empirical_breach_count": 0,
            "total_days": 0,
            "worst_day": 0.0,
            "mean_daily_pnl": 0.0,
            "std_daily_pnl": 0.0,
            "has_daily_limit": daily_loss_limit is not None,
            "score": 100.0,
        }

    mean_pnl = float(np.mean(arr))
    std_pnl = float(np.std(arr, ddof=1)) if len(arr) > 1 else 0.0
    worst_day = float(np.min(arr))

    if daily_loss_limit is None:
        # No daily loss limit at this firm — perfect score
        return {
            "breach_probability": 0.0,
            "empirical_breach_count": 0,
            "total_days": len(arr),
            "worst_day": worst_day,
            "mean_daily_pnl": mean_pnl,
            "std_daily_pnl": std_pnl,
            "has_daily_limit": False,
            "score": 100.0,
        }

    # Empirical: count days where loss exceeded limit
    # daily_loss_limit is positive (e.g. 1000), losses are negative
    breach_threshold = -abs(daily_loss_limit)
    empirical_breaches = int(np.sum(arr < breach_threshold))
    empirical_prob = empirical_breaches / len(arr)

    # Fitted normal tail probability for more stable estimate
    if std_pnl > 0:
        # P(X < -daily_loss_limit) using normal CDF
        z_score = (breach_threshold - mean_pnl) / std_pnl
        if HAS_SCIPY:
            normal_prob = float(scipy_stats.norm.cdf(z_score))
        else:
            normal_prob = _normal_cdf(z_score)
        # Blend empirical and normal (empirical weighted more with more data)
        weight_empirical = min(len(arr) / 100, 0.7)  # Max 70% empirical
        weight_normal = 1.0 - weight_empirical
        breach_probability = weight_empirical * empirical_prob + weight_normal * normal_prob
    else:
        breach_probability = empirical_prob

    # Score: 0-100 where 100 = zero breach probability
    # Use exponential decay: score = 100 * exp(-20 * breach_prob)
    # At 5% breach prob -> score ~37, at 1% -> score ~82, at 0% -> 100
    score = 100.0 * np.exp(-20.0 * breach_probability)

    return {
        "breach_probability": round(breach_probability, 6),
        "empirical_breach_count": empirical_breaches,
        "total_days": len(arr),
        "worst_day": round(worst_day, 2),
        "mean_daily_pnl": round(mean_pnl, 2),
        "std_daily_pnl": round(std_pnl, 2),
        "has_daily_limit": True,
        "score": round(float(score), 2),
    }
