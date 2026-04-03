"""Extreme Value Theory for tail risk estimation.

Uses Generalized Pareto Distribution (GPD) via Peak-Over-Threshold method
to model tail losses more accurately than Normal assumptions.
"""
from __future__ import annotations

import numpy as np

try:
    from scipy.stats import genpareto
    GENPARETO_AVAILABLE = True
except ImportError:
    GENPARETO_AVAILABLE = False


def fit_generalized_pareto(
    losses: np.ndarray,
    threshold_percentile: float = 95,
) -> dict:
    """Fit GPD to tail losses above a threshold.

    Uses Peak-Over-Threshold (POT) method:
    1. Set threshold at given percentile of losses
    2. Extract exceedances above threshold
    3. Fit GPD to exceedances
    4. Estimate tail probabilities and Expected Shortfall

    Args:
        losses: 1D array of loss magnitudes (positive = loss)
        threshold_percentile: Percentile for threshold (default 95)

    Returns:
        {shape, scale, threshold, n_exceedances, exceedance_rate,
         tail_probabilities: {p99, p999, p9999}, expected_shortfall_evt, method}
    """
    losses = np.asarray(losses, dtype=np.float64)
    losses = losses[np.isfinite(losses)]

    if len(losses) < 20:
        return {"error": "insufficient_data", "n": len(losses)}

    threshold = float(np.percentile(losses, threshold_percentile))
    exceedances = losses[losses > threshold] - threshold

    if len(exceedances) < 10:
        return {"error": "insufficient_tail_data", "n_exceedances": len(exceedances)}

    if not GENPARETO_AVAILABLE:
        return _fallback_tail_estimate(losses, threshold, exceedances)

    try:
        shape, loc, scale = genpareto.fit(exceedances, floc=0)
    except Exception:
        return _fallback_tail_estimate(losses, threshold, exceedances)

    n = len(losses)
    n_u = len(exceedances)
    rate = n_u / n

    tail_probs = {}
    for p_label, p_val in [("p99", 0.01), ("p999", 0.001), ("p9999", 0.0001)]:
        if shape != 0:
            var_p = threshold + (scale / shape) * ((rate / p_val) ** shape - 1)
        else:
            var_p = threshold + scale * np.log(rate / max(p_val, 1e-10))
        tail_probs[p_label] = float(var_p)

    # Expected Shortfall via EVT
    if shape < 1:
        es = tail_probs["p99"] / (1 - shape) + (scale - shape * threshold) / (1 - shape)
    else:
        es = float("inf")

    return {
        "shape": float(shape),
        "scale": float(scale),
        "threshold": float(threshold),
        "n_exceedances": int(n_u),
        "exceedance_rate": float(rate),
        "tail_probabilities": tail_probs,
        "expected_shortfall_evt": float(es),
        "method": "peaks_over_threshold",
    }


def _fallback_tail_estimate(
    losses: np.ndarray,
    threshold: float,
    exceedances: np.ndarray,
) -> dict:
    """Simple exponential tail fallback when genpareto is unavailable."""
    mean_excess = float(np.mean(exceedances)) if len(exceedances) > 0 else 1.0
    n = len(losses)
    n_u = len(exceedances)
    rate = n_u / max(n, 1)

    tail_probs = {}
    for p_label, p_val in [("p99", 0.01), ("p999", 0.001), ("p9999", 0.0001)]:
        var_p = threshold + mean_excess * np.log(rate / max(p_val, 1e-10))
        tail_probs[p_label] = float(var_p)

    return {
        "shape": 0.0,
        "scale": mean_excess,
        "threshold": float(threshold),
        "n_exceedances": int(n_u),
        "exceedance_rate": float(rate),
        "tail_probabilities": tail_probs,
        "expected_shortfall_evt": float(tail_probs["p99"] + mean_excess),
        "method": "exponential_fallback",
    }


def compare_normal_vs_evt(losses: np.ndarray) -> dict:
    """Compare Normal vs EVT tail estimates.

    Shows how much Normal distribution underestimates tail risk.
    """
    evt = fit_generalized_pareto(losses)
    if "error" in evt:
        return evt

    mu = float(np.mean(losses))
    sigma = float(np.std(losses))
    sigma = max(sigma, 1e-10)

    normal_p99 = mu + 2.326 * sigma
    normal_p999 = mu + 3.090 * sigma

    evt_p99 = evt["tail_probabilities"]["p99"]
    evt_p999 = evt["tail_probabilities"]["p999"]

    return {
        "evt": evt,
        "normal_p99": float(normal_p99),
        "normal_p999": float(normal_p999),
        "evt_p99": evt_p99,
        "evt_p999": evt_p999,
        "underestimation_ratio_p99": evt_p99 / max(normal_p99, 0.01),
        "underestimation_ratio_p999": evt_p999 / max(normal_p999, 0.01),
    }
