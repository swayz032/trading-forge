"""Parameter robustness analysis — analyze Optuna study results.

Determines whether a strategy is robust (performs well across parameter
ranges) or overfit (performance collapses with small parameter changes).
"""

from __future__ import annotations

from typing import Optional

import optuna


def analyze_optuna_study(study: optuna.Study) -> dict:
    """Analyze an Optuna study for parameter robustness.

    A robust strategy has a performance plateau: the top 15% of trials
    should have low variance (±15%) in their scores.

    Args:
        study: Completed Optuna study

    Returns:
        dict with: is_robust, plateau_variance, top_trial_count,
                   best_score, worst_top_score, score_range
    """
    if len(study.trials) == 0:
        return {
            "is_robust": False,
            "plateau_variance": 0.0,
            "top_trial_count": 0,
            "best_score": 0.0,
            "worst_top_score": 0.0,
            "score_range": 0.0,
        }

    # Get all completed trial values (negate back since we minimize negative Sharpe)
    values = [-t.value for t in study.trials if t.value is not None]

    if not values:
        return {
            "is_robust": False,
            "plateau_variance": 0.0,
            "top_trial_count": 0,
            "best_score": 0.0,
            "worst_top_score": 0.0,
            "score_range": 0.0,
        }

    values.sort(reverse=True)

    # Top 15% of trials
    top_count = max(1, int(len(values) * 0.15))
    top_values = values[:top_count]

    best = top_values[0]
    worst_top = top_values[-1]

    # Variance check: top trials within ±15% of each other
    if best > 0:
        variance_pct = ((best - worst_top) / best) * 100.0
    else:
        variance_pct = 100.0

    is_robust = variance_pct <= 15.0

    return {
        "is_robust": is_robust,
        "plateau_variance": round(variance_pct, 2),
        "top_trial_count": top_count,
        "best_score": round(best, 4),
        "worst_top_score": round(worst_top, 4),
        "score_range": round(values[0] - values[-1], 4),
    }


def compute_param_importance(study: optuna.Study) -> dict[str, float]:
    """Compute parameter importance from an Optuna study.

    Wraps optuna.importance.get_param_importances with error handling.

    Returns:
        Dict mapping parameter names to importance scores (0.0-1.0).
    """
    try:
        importance = optuna.importance.get_param_importances(study)
        return {k: round(v, 4) for k, v in importance.items()}
    except Exception:
        return {}


def extract_robust_range(
    study: optuna.Study,
    threshold: float = 0.85,
) -> dict[str, tuple[float, float]]:
    """Extract the parameter range where performance stays above threshold × best.

    For each parameter, finds the min and max values among trials whose
    performance is >= threshold × best_score.

    Args:
        study: Completed Optuna study
        threshold: Fraction of best score to use as cutoff (e.g., 0.85 = 85%)

    Returns:
        Dict mapping param names to (min, max) tuples.
    """
    if len(study.trials) == 0:
        return {}

    values = [-t.value for t in study.trials if t.value is not None]
    if not values:
        return {}

    best_score = max(values)
    cutoff = best_score * threshold

    # Collect params from trials above cutoff
    param_ranges: dict[str, list[float]] = {}

    for trial in study.trials:
        if trial.value is None:
            continue
        score = -trial.value
        if score >= cutoff:
            for name, value in trial.params.items():
                if isinstance(value, (int, float)):
                    if name not in param_ranges:
                        param_ranges[name] = []
                    param_ranges[name].append(float(value))

    # Extract min/max for each param
    result = {}
    for name, values_list in param_ranges.items():
        result[name] = (round(min(values_list), 4), round(max(values_list), 4))

    return result
