"""Hansen's Superior Predictive Ability (SPA) test — Wave 26 Pass G Pass E.

Implements Hansen (2005) "A Test for Superior Predictive Ability" which extends
White's Reality Check to handle dominated alternatives properly.  The SPA test
is more powerful when testing many strategies because it removes strategies that
are significantly WORSE than the benchmark from the null distribution, which
eliminates the power loss from dominated alternatives that inflate the WRC
p-value.

Three p-values are returned:
  spa_lower    — most conservative; includes ALL strategies in null distribution
                 (equivalent to White's Reality Check p-value in the limit)
  spa_consistent — consistent p-value (recommended); removes strategies that
                   are significantly worse than benchmark from null distribution
  spa_upper    — least conservative; removes all strategies with negative sample
                 average performance from null distribution

Gate: passes when spa_consistent < 0.05.

References:
  Hansen, P. R. (2005). "A Test for Superior Predictive Ability."
  Journal of Business & Economic Statistics 23(4):365–380.
  White, H. (2000). "A Reality Check for Data Snooping." Econometrica 68(5):1097–1126.
  Politis & Romano (1994). "The Stationary Bootstrap." JASA 89(428):1303–1313.
"""

from __future__ import annotations

import os
from typing import Any

import numpy as np

from src.engine.statistics.whites_reality_check import (
    _WRC_BLOCK_LENGTH_DEFAULT_FRACTION,
    _WRC_N_BOOTSTRAP_DEFAULT,
    _stationary_bootstrap_indices,  # shared-index bootstrap for multi-model use
    )

# ── Constants ────────────────────────────────────────────────────────────────

_SPA_P_VALUE_THRESHOLD_DEFAULT = 0.05
_SPA_LAMBDA_DEFAULT = 1.0  # Hansen (2005) Eq.8 — z_lower threshold multiplier


def get_spa_p_threshold() -> float:
    """Read SPA_P_VALUE_THRESHOLD from env (default 0.05)."""
    try:
        return float(os.environ.get("SPA_P_VALUE_THRESHOLD", str(_SPA_P_VALUE_THRESHOLD_DEFAULT)))
    except (ValueError, TypeError):
        return _SPA_P_VALUE_THRESHOLD_DEFAULT


def hansens_spa(
    strategy_returns: list[float] | np.ndarray,
    benchmark_returns: list[float] | np.ndarray,
    n_bootstrap: int = _WRC_N_BOOTSTRAP_DEFAULT,
    rng_seed: int = 42,
    block_length: int | None = None,
) -> dict[str, Any]:
    """Hansen's Superior Predictive Ability test.

    Tests whether the strategy has superior predictive ability compared to the
    benchmark, after accounting for data snooping from having tested multiple
    strategies.  The SPA test is more powerful than White's Reality Check when
    dominated alternatives are present in the candidate pool.

    In the single-strategy formulation used here, `strategy_returns` represents
    the winner strategy and `benchmark_returns` is the comparison baseline.
    The three SPA variants model different assumptions about how dominated
    alternatives are handled:

    - `spa_lower`:      Includes ALL deviations below benchmark in null dist
                        (most conservative — over-penalizes; same as raw WRC)
    - `spa_consistent`: Removes strategies significantly WORSE than benchmark
                        (recommended; consistent estimator per Hansen 2005 §4)
    - `spa_upper`:      Removes ALL strategies with negative sample mean
                        (least conservative; upper bound on SPA power)

    Gate logic: `passed = spa_consistent_p < threshold` (default 0.05).

    Args:
        strategy_returns:  Per-period returns of the strategy.
        benchmark_returns: Per-period returns of benchmark (use zeros for cash).
        n_bootstrap:       Bootstrap replications (default 2000).
        rng_seed:          Seed for numpy RNG (determinism guarantee).
        block_length:      Mean stationary bootstrap block length.
                           When None, defaults to max(1, int(n * 0.10)).

    Returns:
        dict with keys:
          spa_lower_p      (float)  — conservative SPA p-value
          spa_consistent_p (float)  — consistent SPA p-value (recommended gate)
          spa_upper_p      (float)  — liberal SPA p-value
          passed           (bool)   — True when spa_consistent_p < threshold
          threshold        (float)  — p-value threshold used
          n_obs            (int)    — number of observations
          n_bootstrap      (int)    — bootstrap replications
          block_length     (int)    — mean block length used
          mean_excess_return (float) — observed mean excess return
    """
    arr_strat = np.asarray(strategy_returns, dtype=float)
    arr_bench = np.asarray(benchmark_returns, dtype=float)

    if arr_strat.ndim != 1 or arr_bench.ndim != 1:
        raise ValueError("strategy_returns and benchmark_returns must be 1-D arrays")
    if len(arr_strat) != len(arr_bench):
        raise ValueError(
            f"Length mismatch: strategy_returns ({len(arr_strat)}) "
            f"vs benchmark_returns ({len(arr_bench)})"
        )
    if len(arr_strat) < 2:
        raise ValueError("At least 2 observations are required for SPA")

    n = len(arr_strat)

    # Excess returns per period
    excess = arr_strat - arr_bench  # shape (n,)
    mu_hat = float(np.mean(excess))  # observed test statistic

    # Block length default
    if block_length is None:
        block_length = max(1, int(n * _WRC_BLOCK_LENGTH_DEFAULT_FRACTION))

    threshold = get_spa_p_threshold()
    rng = np.random.default_rng(rng_seed)

    # ── Hansen (2005) — variance normalisation ────────────────────────────────
    # The SPA test statistic uses the sample variance of the excess return mean
    # to normalise.  We estimate the long-run variance via the HAC estimator
    # implied by the stationary bootstrap (mean of bootstrap statistic variances).
    #
    # For the single-strategy case this simplifies: the three SPA variants
    # differ only in how the demeaned bootstrap series is computed:
    #
    #   lower:      demeaned by 0 (no mean removed — most conservative)
    #   consistent: demeaned by max(0, mu_hat) — removes mean if positive edge
    #   upper:      demeaned by mu_hat (removes full sample mean)
    #
    # We collect all three from the same bootstrap loop.

    # Precompute demeaned series for each variant
    excess_lower = excess  # no demeaning — largest penalty for lower bound
    excess_consistent = excess - max(0.0, mu_hat)  # Hansen (2005) Eq.8
    excess_upper = excess - mu_hat  # fully demeaned

    boot_lower = np.empty(n_bootstrap, dtype=float)
    boot_consistent = np.empty(n_bootstrap, dtype=float)
    boot_upper = np.empty(n_bootstrap, dtype=float)

    for b in range(n_bootstrap):
        # One shared time-index resample applied to all three variants.
        # Previously each variant called _stationary_bootstrap_resample independently
        # (consuming 3× as many RNG draws per iteration), which broke the temporal
        # correlation requirement: the three SPA variants must be compared on the
        # same bootstrap draw to be statistically comparable (Hansen 2005 §4).
        # Fix (2026-06-28): use _stationary_bootstrap_indices to get one shared
        # index and apply it to each demeaned series via numpy fancy indexing.
        idx = _stationary_bootstrap_indices(n, block_length, rng)
        boot_lower[b]      = float(np.mean(excess_lower[idx]))
        boot_consistent[b] = float(np.mean(excess_consistent[idx]))
        boot_upper[b]      = float(np.mean(excess_upper[idx]))

    # p-values: proportion of bootstrap statistics >= observed mean excess return
    spa_lower_p = float(np.mean(boot_lower >= mu_hat))
    spa_consistent_p = float(np.mean(boot_consistent >= mu_hat))
    spa_upper_p = float(np.mean(boot_upper >= mu_hat))

    passed = spa_consistent_p < threshold

    return {
        "spa_lower_p": round(spa_lower_p, 6),
        "spa_consistent_p": round(spa_consistent_p, 6),
        "spa_upper_p": round(spa_upper_p, 6),
        "passed": passed,
        "threshold": threshold,
        "n_obs": n,
        "n_bootstrap": n_bootstrap,
        "block_length": block_length,
        "mean_excess_return": round(mu_hat, 8),
    }


def hansens_spa_multi(
    performance_matrix: "np.ndarray | list",
    benchmark_matrix: "np.ndarray | list",
    n_bootstrap: int = _WRC_N_BOOTSTRAP_DEFAULT,
    rng_seed: int = 42,
    block_length: int | None = None,
    n_total_trials: int | None = None,
    k_eff: int | None = None,
) -> "dict[str, Any]":
    """Hansen's Superior Predictive Ability for L simultaneously-evaluated models.

    Extends ``whites_reality_check_multi()`` with two improvements from
    Hansen (2005):

    1. **Consistent recentering** — dominated models (negative sample mean) are
       down-weighted from the bootstrap null so they do not inflate the p-value.
       SPA is strictly more powerful than WRC when some paths underperform.

    2. **Studentized statistics** — each model's test statistic is normalised by
       its long-run standard deviation (estimated via bootstrap variance), making
       the max-statistic scale-invariant.  Without studentisation a single
       high-volatility path can dominate the max-statistic spuriously.

    Three p-values are returned (Hansen 2005 Table 1):
      *lower*     — most conservative; no recentering (= WRC multi variant)
      *consistent*— recommended gate; removes positive-edge models from null
      *upper*     — least conservative; full demeaning for all models

    Optional Šidák multiplicity correction when n_total_trials > k_eff:
      ``p_adj = 1 - (1 - p_raw) ** (n_total_trials / k_eff)``

    References:
        Hansen (2005). "A Test for Superior Predictive Ability."
            J Business & Economic Statistics 23(4):365-380. §3-4, Eqs.(3.1)-(3.6).
        White (2000). "A Reality Check for Data Snooping." Econometrica 68(5):1097-1126.
        Politis & Romano (1994). "The Stationary Bootstrap." JASA 89(428):1303-1313.

    Args:
        performance_matrix: (L, T) array — L OOS return series (CPCV paths or
                            WF windows).  A 1-D array is treated as 1×T.
        benchmark_matrix:   (L, T) or (T,) benchmark; zeros for cash comparison.
        n_bootstrap:        Bootstrap replications (default 2000).
        rng_seed:           Seed for determinism.
        block_length:       Mean stationary block length. Default: 10 % of T.
        n_total_trials:     Total scout / mutation trials for Šidák correction.
        k_eff:              Effective model count (= L when None).

    Returns:
        dict with keys:
          spa_consistent_p    (float) — gate-ready p-value (Šidák-adjusted); TS gate key
          spa_lower_p         (float) — conservative p (Šidák-adjusted)
          spa_upper_p         (float) — liberal p (Šidák-adjusted)
          spa_consistent_p_raw (float) — consistent p before Šidák
          spa_lower_p_raw     (float)
          spa_upper_p_raw     (float)
          passed              (bool)  — True when spa_consistent_p < threshold
          threshold           (float)
          n_models            (int)   — L
          n_total_trials      (int|None)
          k_eff               (int)
          sidak_adjusted      (bool)
          test_stat_studentized (float) — max studentised observed stat
          mean_excess_return  (float) — max per-model mean excess return
          n_obs               (int)   — T
          n_bootstrap         (int)
          block_length        (int)
    """

    perf = np.asarray(performance_matrix, dtype=float)
    if perf.ndim == 1:
        perf = perf.reshape(1, -1)
    if perf.ndim != 2:
        raise ValueError(
            f"performance_matrix must be 1-D or 2-D, got shape {perf.shape}"
        )

    bench = np.asarray(benchmark_matrix, dtype=float)
    if bench.ndim == 1:
        bench = np.broadcast_to(bench, perf.shape).copy()
    if bench.shape != perf.shape:
        raise ValueError(
            f"Shape mismatch: performance_matrix {perf.shape} vs "
            f"benchmark_matrix {bench.shape}"
        )

    L, T = perf.shape
    if T < 2:
        raise ValueError(f"Need at least 2 time periods per model, got T={T}")

    excess = perf - bench          # (L, T)
    mu_hat = excess.mean(axis=1)  # (L,) per-model sample mean

    if block_length is None:
        block_length = max(1, int(T * _WRC_BLOCK_LENGTH_DEFAULT_FRACTION))

    threshold = get_spa_p_threshold()
    _effective_k_eff: int = k_eff if k_eff is not None else L
    rng = np.random.default_rng(rng_seed)

    # ── Three centering variants (Hansen 2005 §4) ─────────────────────────────
    # lower:      no centering (most conservative; all model variance in null)
    # consistent: center by max(0, mu_hat_k) — removes dominated-alternative bias
    # upper:      center by mu_hat_k (full demeaning; least conservative)
    excess_lower      = excess                                          # (L, T)
    excess_consistent = excess - np.maximum(0.0, mu_hat)[:, np.newaxis]  # (L, T)
    excess_upper      = excess - mu_hat[:, np.newaxis]                 # (L, T)

    # ── Bootstrap: collect per-model means for variance estimation and null ───
    # All three variants use the SAME shared time-index each iteration so they
    # remain temporally comparable (Hansen 2005 requires this).
    boot_means_lower      = np.empty((n_bootstrap, L), dtype=float)  # (B, L)
    boot_means_consistent = np.empty((n_bootstrap, L), dtype=float)
    boot_means_upper      = np.empty((n_bootstrap, L), dtype=float)

    for b in range(n_bootstrap):
        idx = _stationary_bootstrap_indices(T, block_length, rng)
        boot_means_lower[b]      = excess_lower[:, idx].mean(axis=1)
        boot_means_consistent[b] = excess_consistent[:, idx].mean(axis=1)
        boot_means_upper[b]      = excess_upper[:, idx].mean(axis=1)

    # ── Long-run variance estimate for studentisation ─────────────────────────
    # Estimated from the upper (fully-demeaned) bootstrap means — the canonical
    # HAC estimator implied by the stationary bootstrap (Politis-Romano 1994).
    # omega_hat_k = sqrt(T * Var_bootstrap(mean_t(excess_upper[k, τ])))
    # Shared across all three variants so p-values are on a comparable scale.
    boot_std_upper = boot_means_upper.std(axis=0, ddof=1)  # (L,)
    omega_hat = np.where(
        boot_std_upper > 1e-10,
        np.sqrt(T) * boot_std_upper,
        1.0,   # fallback: avoid division by zero for degenerate constant series
    )  # (L,)

    # ── Observed studentised test statistics ──────────────────────────────────
    # t_k = sqrt(T) * mu_hat_k / omega_hat_k   (Hansen 2005 Eq.3.2)
    t_obs = (np.sqrt(T) * mu_hat) / omega_hat   # (L,)
    T_obs_student = float(t_obs.max())

    # ── Studentised bootstrap null max-statistics ─────────────────────────────
    # t*[b, k] = sqrt(T) * mean(excess_v[k, τ_b]) / omega_hat_k
    # T*_v[b]  = max_k(t*[b, k])
    inv_omega = 1.0 / omega_hat  # (L,) — broadcast with (B, L) means
    T_star_lower      = (np.sqrt(T) * boot_means_lower      * inv_omega[np.newaxis, :]).max(axis=1)
    T_star_consistent = (np.sqrt(T) * boot_means_consistent * inv_omega[np.newaxis, :]).max(axis=1)
    T_star_upper      = (np.sqrt(T) * boot_means_upper      * inv_omega[np.newaxis, :]).max(axis=1)

    # Raw p-values: P(T* >= T_obs_student) — one-sided right tail
    spa_lower_p_raw      = float(np.mean(T_star_lower      >= T_obs_student))
    spa_consistent_p_raw = float(np.mean(T_star_consistent >= T_obs_student))
    spa_upper_p_raw      = float(np.mean(T_star_upper      >= T_obs_student))

    # ── Šidák multiplicity correction ─────────────────────────────────────────
    sidak_adjusted = bool(
        n_total_trials is not None
        and _effective_k_eff > 0
        and n_total_trials > _effective_k_eff
    )
    if sidak_adjusted:
        inflation = n_total_trials / _effective_k_eff
        spa_lower_p      = float(min(1.0, 1.0 - (1.0 - spa_lower_p_raw)      ** inflation))
        spa_consistent_p = float(min(1.0, 1.0 - (1.0 - spa_consistent_p_raw) ** inflation))
        spa_upper_p      = float(min(1.0, 1.0 - (1.0 - spa_upper_p_raw)      ** inflation))
    else:
        spa_lower_p      = spa_lower_p_raw
        spa_consistent_p = spa_consistent_p_raw
        spa_upper_p      = spa_upper_p_raw

    passed = bool(spa_consistent_p < threshold)

    return {
        "spa_consistent_p":     round(spa_consistent_p, 6),     # TS gate contract key
        "spa_lower_p":          round(spa_lower_p, 6),
        "spa_upper_p":          round(spa_upper_p, 6),
        "spa_consistent_p_raw": round(spa_consistent_p_raw, 6),
        "spa_lower_p_raw":      round(spa_lower_p_raw, 6),
        "spa_upper_p_raw":      round(spa_upper_p_raw, 6),
        "passed":               passed,
        "threshold":            threshold,
        "n_models":             L,
        "n_total_trials":       n_total_trials,
        "k_eff":                _effective_k_eff,
        "sidak_adjusted":       sidak_adjusted,
        "test_stat_studentized": round(T_obs_student, 8),
        "mean_excess_return":   round(float(mu_hat.max()), 8),  # consumer compat
        "n_obs":                T,
        "n_bootstrap":          n_bootstrap,
        "block_length":         block_length,
    }
