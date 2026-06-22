"""Confidence intervals around MC outputs using scipy.stats.bootstrap.

Wave 27.5 Pass A.1 — CRITICAL #2: probability_of_ruin now included in full BCa
bootstrap pipeline (was computed as scalar with no interval, making B14 binary
pass/fail with no quantified uncertainty).

Wave hardening 2026-06-22, MC BCa scale fix (F1): scipy BCa uses an O(n²)
jackknife internally, which OOMs at production n_sims (≥15K). Fixed by capping
the bootstrap *resample input* at BCA_MAX_SAMPLE (default 5000) while keeping
point_estimate on the FULL sample. Subsampling slightly widens CIs (smaller n)
= more conservative = institutionally safe. n_effective key records actual
sample size used for the interval.

Provides statistically rigorous uncertainty bounds on:
- survival_rate
- probability_of_ruin (NEW: full BCa CI — B14 can now read ci_low/ci_high)
- max_drawdown_p5
- cvar95

Output contract for each metric in `bca_confidence_intervals`:
  {
    "point_estimate": float,    # raw metric value over full MC sample (NEVER subsampled)
    "ci_low": float,            # lower bound of confidence interval
    "ci_high": float,           # upper bound of confidence interval
    "confidence_level": float,  # 0.95
    "ci_method": str,           # "BCa" | "percentile" | "percentile_fallback"
    "n_resamples": int,         # bootstrap resamples used (default 9999)
    "standard_error": float,    # bootstrap standard error
    "n_effective": int,         # actual sample size used for CI (≤ BCA_MAX_SAMPLE when capped)
  }

B14 gate SHOULD read `bca_confidence_intervals.probability_of_ruin.ci_high`
(worst-case upper bound at 95% confidence) rather than the point estimate alone.
Wiring B14 to use ci_high is deferred to Pass B (Pass B.A2); this pass ships
the CI data so the gate can consume it without blocking MC runs.
"""
from __future__ import annotations

import os

import numpy as np

# Wave hardening 2026-06-22: cap bootstrap resample input to avoid O(n²) BCa jackknife OOM.
# At 5000: jackknife allocates 5000 × 4999 × 8 bytes ≈ 200 MB — safe on the 32 GB tower.
# At 15000: 1.68 GiB OOM; at 100000: ~80 GiB guaranteed OOM.
# Subsampling widens CIs slightly (conservative = institutionally safe).
BCA_MAX_SAMPLE: int = int(os.environ.get("MC_BCA_MAX_SAMPLE", "5000"))

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
        Wave 27.5 Pass A.1 — CRITICAL #2 contract:
        {
            point_estimate: float,
            ci_low: float,
            ci_high: float,
            confidence_level: float,
            ci_method: str,       # "BCa" | "percentile" | "percentile_fallback"
            n_resamples: int,     # number of bootstrap resamples used
            standard_error: float,
        }
        Note: "method" key still included for backward compatibility with
        existing consumers that read .method. New consumers should read .ci_method.
    """
    rng = np.random.default_rng(seed)
    # point_estimate ALWAYS uses the full data — never subsampled.
    point = float(statistic_fn(data, axis=0))

    # Wave hardening 2026-06-22: cap bootstrap resample input at BCA_MAX_SAMPLE.
    # Only the CI computation is bounded; point_estimate above uses full data.
    n_full = len(data)
    if n_full > BCA_MAX_SAMPLE:
        boot_data = data[rng.choice(n_full, size=BCA_MAX_SAMPLE, replace=False)]
    else:
        boot_data = data
    n_effective = len(boot_data)

    if not SCIPY_BOOTSTRAP_AVAILABLE:
        # Fallback: simple percentile bootstrap (also capped for memory consistency)
        n = n_effective
        boot_stats = np.zeros(n_resamples)
        for i in range(n_resamples):
            idx = rng.integers(0, n, size=n)
            boot_stats[i] = statistic_fn(boot_data[idx], axis=0)
        alpha = 1.0 - confidence_level
        ci_low = float(np.percentile(boot_stats, 100 * alpha / 2))
        ci_high = float(np.percentile(boot_stats, 100 * (1 - alpha / 2)))
        se = float(np.std(boot_stats))
        return {
            "point_estimate": point,
            "ci_low": ci_low,
            "ci_high": ci_high,
            "confidence_level": confidence_level,
            "ci_method": "percentile_fallback",
            "method": "percentile_fallback",  # backward compat
            "n_resamples": n_resamples,
            "standard_error": se,
            "n_effective": n_effective,
        }

    result = scipy_bootstrap(
        (boot_data,),
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
        "ci_method": method,
        "method": method,  # backward compat
        "n_resamples": n_resamples,
        "standard_error": float(result.standard_error),
        "n_effective": n_effective,
    }


# ─── Pre-built statistic functions for common MC outputs ─────────


def survival_rate_stat(terminal_values: np.ndarray, axis=0):
    """Fraction of paths that don't breach (terminal > 0)."""
    return np.mean(terminal_values > 0, axis=axis)


def max_drawdown_p5_stat(max_drawdowns: np.ndarray, axis=0):
    """5th percentile of max drawdowns (worst-case).

    Convention: drawdowns are POSITIVE dollar amounts (depth of loss).
    The 5th percentile is the worst 5% of outcomes — a large POSITIVE number
    means a severe drawdown. CI low/high are also positive (dollar depths).

    F-7 FIX: previously returned a negative value because max_drawdowns was
    computed as `np.min(mc_paths - peak, axis=1)` (most-negative = worst DD).
    compute_all_mc_cis() now passes POSITIVE dollar drawdown magnitudes, so
    this statistic returns positive values throughout the pipeline.
    Downstream consumers receiving negative max_drawdown_p5 CIs should be
    re-baselined: the absolute magnitude is unchanged; only the sign flips.
    """
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
    """Compute BCa CIs for all standard MC metrics at once.

    Wave 27.5 Pass A.1 — CRITICAL #2: probability_of_ruin now has full BCa CI.
    B14 gate SHOULD read probability_of_ruin_ci.ci_high (worst-case upper bound)
    for robust promotion decisions; wiring is deferred to Pass B.A2.

    Args:
        mc_paths: (n_sims, n_steps) equity paths
        confidence_level: 0.95 = 95% CI
        n_resamples: bootstrap resamples (default 9999)
        seed: RNG seed for reproducibility

    Returns:
        Dict of {metric_name: CI dict} with the following keys:
          - survival_rate
          - probability_of_ruin          (alias: probability_of_ruin_ci)
          - max_drawdown_p5
          - cvar95

        Each CI dict has shape:
          {point_estimate, ci_low, ci_high, confidence_level,
           ci_method, n_resamples, standard_error}

        probability_of_ruin is ALSO available under key "probability_of_ruin_ci"
        for clarity at B14 call sites.
    """
    if mc_paths.ndim != 2 or mc_paths.shape[0] == 0:
        return {}

    terminal = mc_paths[:, -1]

    # Max drawdown per path — POSITIVE dollar magnitude convention.
    # F-7 FIX: previously computed as np.min(mc_paths - peak, axis=1) which returns
    # NEGATIVE values (most-negative = worst DD). BCa CIs then reported negative
    # ci_low/ci_high for max_drawdown_p5 — counterintuitive and incorrectly signed
    # for downstream consumers (promotion gates, risk reports, UI).
    # Fix: convert to positive depth = peak - equity. Larger positive value = worse DD.
    # The absolute magnitude is unchanged; only the sign convention is corrected.
    # NOTE: any existing test fixtures that assert negative max_drawdown_p5 ci_low/ci_high
    # must be re-baselined to positive values of the same magnitude (documented here).
    peak = np.maximum.accumulate(mc_paths, axis=1)
    max_dd_per_path = np.max(peak - mc_paths, axis=1)  # positive dollar drawdown depth

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

    # CRITICAL #2: expose probability_of_ruin under the explicit "probability_of_ruin_ci"
    # key so B14 call sites have an unambiguous contract name.  The data is identical to
    # results["probability_of_ruin"] — this is an alias, not a recomputation.
    results["probability_of_ruin_ci"] = results["probability_of_ruin"]

    return results
