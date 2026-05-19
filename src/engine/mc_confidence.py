"""Confidence intervals around MC outputs using scipy.stats.bootstrap.

Provides statistically rigorous uncertainty bounds on:
- Survival rate, breach probability, profit factor, Sharpe, max drawdown percentiles
"""
from __future__ import annotations

import numpy as np

try:
    from scipy.stats import bootstrap as scipy_bootstrap
    SCIPY_BOOTSTRAP_AVAILABLE = True
except ImportError:
    SCIPY_BOOTSTRAP_AVAILABLE = False


def compute_mc_confidence_intervals(
    data: np.ndarray,
    statistic_fn,
    confidence_level: float = 0.95,
    method: str = "BCa",
    n_resamples: int = 9999,
    seed: int = 42,
) -> dict:
    """Compute BCa confidence intervals around a MC-derived metric.

    Args:
        data: 1D or 2D array of MC simulation results
        statistic_fn: Function(data, axis) -> scalar metric
        confidence_level: 0.95 = 95% CI
        method: "BCa" (bias-corrected accelerated), "percentile", or "basic"
        n_resamples: Bootstrap resamples for CI computation
        seed: RNG seed

    Returns:
        {point_estimate, ci_low, ci_high, confidence_level, method, standard_error}
    """
    rng = np.random.default_rng(seed)
    point = float(statistic_fn(data, axis=0))

    if not SCIPY_BOOTSTRAP_AVAILABLE:
        # Fallback: simple percentile bootstrap
        n = len(data)
        boot_stats = np.zeros(n_resamples)
        for i in range(n_resamples):
            idx = rng.integers(0, n, size=n)
            boot_stats[i] = statistic_fn(data[idx], axis=0)
        alpha = 1.0 - confidence_level
        ci_low = float(np.percentile(boot_stats, 100 * alpha / 2))
        ci_high = float(np.percentile(boot_stats, 100 * (1 - alpha / 2)))
        se = float(np.std(boot_stats))
        return {
            "point_estimate": point,
            "ci_low": ci_low,
            "ci_high": ci_high,
            "confidence_level": confidence_level,
            "method": "percentile_fallback",
            "standard_error": se,
        }

    result = scipy_bootstrap(
        (data,),
        statistic=statistic_fn,
        n_resamples=n_resamples,
        confidence_level=confidence_level,
        method=method.lower(),
        random_state=rng,
    )

    return {
        "point_estimate": point,
        "ci_low": float(result.confidence_interval.low),
        "ci_high": float(result.confidence_interval.high),
        "confidence_level": confidence_level,
        "method": method,
        "standard_error": float(result.standard_error),
    }


# ─── Pre-built statistic functions for common MC outputs ─────────


def survival_rate_stat(terminal_values: np.ndarray, axis=0):
    """Fraction of paths that don't breach (terminal > 0)."""
    return np.mean(terminal_values > 0, axis=axis)


def max_drawdown_p5_stat(max_drawdowns: np.ndarray, axis=0):
    """5th percentile of max drawdowns (worst-case)."""
    return np.percentile(max_drawdowns, 5, axis=axis)


def probability_of_ruin_stat(terminal_values: np.ndarray, axis=0):
    """Fraction of paths hitting ruin (terminal <= threshold)."""
    return np.mean(terminal_values <= 0, axis=axis)


def cvar95_stat(terminal_values: np.ndarray, axis=0):
    """Conditional VaR at 95% — mean of worst 5% of outcomes."""
    threshold = np.percentile(terminal_values, 5, axis=axis)
    mask = terminal_values <= np.expand_dims(threshold, axis=axis) if np.ndim(threshold) > 0 else terminal_values <= threshold
    masked = np.where(mask, terminal_values, np.nan)
    return np.nanmean(masked, axis=axis)


def compute_all_mc_cis(
    mc_paths: np.ndarray,
    confidence_level: float = 0.95,
    n_resamples: int = 9999,
    seed: int = 42,
) -> dict[str, dict]:
    """Compute CIs for all standard MC metrics at once.

    Args:
        mc_paths: (n_sims, n_steps) equity paths

    Returns:
        Dict of {metric_name: {point_estimate, ci_low, ci_high, ...}}
    """
    if mc_paths.ndim != 2 or mc_paths.shape[0] == 0:
        return {}

    terminal = mc_paths[:, -1]

    # Max drawdown per path
    peak = np.maximum.accumulate(mc_paths, axis=1)
    drawdowns = mc_paths - peak
    max_dd_per_path = np.min(drawdowns, axis=1)

    results = {}
    for name, data, fn in [
        ("survival_rate", terminal, survival_rate_stat),
        ("probability_of_ruin", terminal, probability_of_ruin_stat),
        ("max_drawdown_p5", max_dd_per_path, max_drawdown_p5_stat),
        ("cvar95", terminal, cvar95_stat),
    ]:
        results[name] = compute_mc_confidence_intervals(
            data, fn,
            confidence_level=confidence_level,
            n_resamples=n_resamples,
            seed=seed,
        )

    return results
