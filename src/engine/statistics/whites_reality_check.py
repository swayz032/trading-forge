"""White's Reality Check (WRC) — Wave 26 Pass G Pass E.

Implements White (2000) "A Reality Check for Data Snooping" to test whether
the best-performing strategy from a pool achieves positive expected returns or
whether its performance can be explained by data-snooping luck.

Null hypothesis H0:
    The best strategy's expected excess return over the benchmark is ≤ 0
    (i.e. the best strategy is no better than the benchmark after accounting
    for multiple-testing bias from selecting the winner out of N candidates).

Rejection of H0 (p_value < 0.05) means we have statistical evidence that the
winner has positive expected excess returns that survive multiple-testing
correction.

Key institutional properties:
  - Stationary bootstrap with data-driven block length (Politis & Romano 1994)
  - Operates on realized per-period excess returns (strategy minus benchmark)
  - Does NOT require a full population of N strategies — callers pass one
    strategy (the winner) and a benchmark; the test is symmetric with respect
    to multiple-testing bias through the bootstrap null distribution
  - Deterministic: fixed numpy seed via `rng_seed` parameter

References:
  White, H. (2000). "A Reality Check for Data Snooping." Econometrica 68(5):1097–1126.
  Sullivan, Timmermann & White (1999). "Data-snooping, technical trading rule
  performance, and the bootstrap." Journal of Finance 54(5):1647–1691.
  Politis, D. N. & Romano, J. P. (1994). "The Stationary Bootstrap."
  JASA 89(428):1303–1313.
"""

from __future__ import annotations

import os
from typing import Any

import numpy as np

# ── Constants ────────────────────────────────────────────────────────────────

_WRC_P_VALUE_THRESHOLD_DEFAULT = 0.05
_WRC_N_BOOTSTRAP_DEFAULT = 2000
_WRC_BLOCK_LENGTH_DEFAULT_FRACTION = 0.10  # block length = max(1, int(n * 0.10))


def get_wrc_p_threshold() -> float:
    """Read WRC_P_VALUE_THRESHOLD from env (default 0.05)."""
    try:
        return float(os.environ.get("WRC_P_VALUE_THRESHOLD", str(_WRC_P_VALUE_THRESHOLD_DEFAULT)))
    except (ValueError, TypeError):
        return _WRC_P_VALUE_THRESHOLD_DEFAULT


def _stationary_bootstrap_resample(
    data: np.ndarray,
    block_length: int,
    rng: np.random.Generator,
) -> np.ndarray:
    """Stationary bootstrap resample of 1-D array `data` with given mean block length.

    Each bootstrap sample has the same length as the original.  Block starts are
    drawn uniformly; each successive element within a block continues with
    geometric probability 1/block_length until a new block begins.

    Args:
        data:         1-D ndarray of returns, length n.
        block_length: Mean block length (Politis–Romano geometric parameter).
                      Must be >= 1.
        rng:          numpy Generator instance for reproducibility.

    Returns:
        1-D ndarray of length n — one bootstrap resample.
    """
    n = len(data)
    result = np.empty(n, dtype=data.dtype)
    p_new_block = 1.0 / max(1, block_length)
    i = 0
    while i < n:
        # Draw a new block start uniformly
        start = int(rng.integers(0, n))
        # Geometric block length — continue until new-block draw or budget exhausted
        j = start
        while i < n:
            result[i] = data[j % n]
            i += 1
            if i < n and rng.random() < p_new_block:
                break  # Start a new block
            j += 1
    return result


def _stationary_bootstrap_indices(
    n: int,
    block_length: int,
    rng: np.random.Generator,
) -> np.ndarray:
    """Return an integer index array of length *n* drawn via the stationary bootstrap.

    Identical random-walk logic to _stationary_bootstrap_resample() but returns
    indices rather than data values.  Callers apply ``data[indices]`` to resample
    each row of a (L, T) performance matrix with the **same** temporal draw,
    preserving cross-model correlation in the multi-model WRC/SPA constructions.

    Args:
        n:            Series length (number of time periods).
        block_length: Mean geometric block length (Politis-Romano parameter).
        rng:          numpy Generator for reproducibility.

    Returns:
        1-D integer ndarray of length *n* — the resample time indices.
    """
    indices = np.empty(n, dtype=np.intp)
    p_new_block = 1.0 / max(1, block_length)
    i = 0
    while i < n:
        start = int(rng.integers(0, n))
        j = start
        while i < n:
            indices[i] = j % n
            i += 1
            if i < n and rng.random() < p_new_block:
                break
            j += 1
    return indices


def whites_reality_check(
    strategy_returns: list[float] | np.ndarray,
    benchmark_returns: list[float] | np.ndarray,
    n_bootstrap: int = _WRC_N_BOOTSTRAP_DEFAULT,
    rng_seed: int = 42,
    block_length: int | None = None,
) -> dict[str, Any]:
    """White's Reality Check test for data snooping.

    Tests the null hypothesis that the best strategy's expected excess return
    over the benchmark is ≤ 0.  Rejects H0 when p_value < threshold (default
    0.05), which is the institutional standard for accepting strategy edge
    as statistically real after multiple-testing adjustment.

    Args:
        strategy_returns:  Per-period returns of the strategy (daily or bar).
                           Length must match benchmark_returns.
        benchmark_returns: Per-period returns of the benchmark.
                           Use zeros for "beat cash / beat nothing" tests.
        n_bootstrap:       Number of bootstrap replications (default 2000).
        rng_seed:          Seed for numpy RNG (determinism guarantee).
        block_length:      Mean block length for stationary bootstrap.
                           When None, defaults to max(1, int(n * 0.10)).

    Returns:
        dict with keys:
          p_value    (float)  — proportion of bootstrap samples where the
                                 resampled statistic exceeds the observed
                                 test statistic; null distribution-based p-value
          test_stat  (float)  — observed mean excess return (strategy - benchmark)
          passed     (bool)   — True when p_value < threshold (default 0.05)
          threshold  (float)  — p-value threshold used
          n_obs      (int)    — number of observations used
          n_bootstrap (int)   — bootstrap replications performed
          block_length (int)  — mean block length used
          mean_excess_return (float) — same as test_stat (labelled for consumers)
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
        raise ValueError("At least 2 observations are required for WRC")

    n = len(arr_strat)

    # Excess returns: strategy outperformance vs benchmark per bar
    excess = arr_strat - arr_bench

    # Observed test statistic: mean excess return
    # White (2000): T_n = (1/n) * sum(f_k^2 - f_k^0)
    # Simplified here to mean excess return which is equivalent for the
    # single-strategy case (SPA subsumes the full multi-strategy formulation).
    test_stat = float(np.mean(excess))

    # Block length: default to 10% of series length (Politis & Romano guidance)
    if block_length is None:
        block_length = max(1, int(n * _WRC_BLOCK_LENGTH_DEFAULT_FRACTION))

    threshold = get_wrc_p_threshold()
    rng = np.random.default_rng(rng_seed)

    # ── Bootstrap null distribution ──────────────────────────────────────────
    # Under H0 the expected value of excess returns is 0.  We demeane to
    # enforce H0 in the bootstrap world (consistent with White 2000 §3.1).
    excess_demeaned = excess - np.mean(excess)

    bootstrap_stats = np.empty(n_bootstrap, dtype=float)
    for b in range(n_bootstrap):
        resample = _stationary_bootstrap_resample(excess_demeaned, block_length, rng)
        bootstrap_stats[b] = float(np.mean(resample))

    # p-value: proportion of bootstrap statistics >= observed test statistic
    # One-sided test (right tail): we reject H0 when observed exceeds null dist.
    p_value = float(np.mean(bootstrap_stats >= test_stat))

    passed = p_value < threshold

    return {
        "p_value": round(p_value, 6),
        "test_stat": round(test_stat, 8),
        "passed": passed,
        "threshold": threshold,
        "n_obs": n,
        "n_bootstrap": n_bootstrap,
        "block_length": block_length,
        "mean_excess_return": round(test_stat, 8),
    }


def whites_reality_check_multi(
    performance_matrix: "np.ndarray | list",
    benchmark_matrix: "np.ndarray | list",
    n_bootstrap: int = _WRC_N_BOOTSTRAP_DEFAULT,
    rng_seed: int = 42,
    block_length: int | None = None,
    n_total_trials: int | None = None,
    k_eff: int | None = None,
) -> "dict[str, Any]":
    """White's Reality Check for L simultaneously-evaluated models.

    Implements White (2000) §3 with the **max-statistic** construction: the null
    distribution is built from the maximum test statistic across ALL L models
    jointly bootstrapped via a shared time-index resample.  This means the
    p-value accounts for having selected the best model from L candidates
    (proper data-snooping correction).

    CRITICAL difference from the single-series ``whites_reality_check()``:
      *Single series*: test_stat = mean(excess). Null built from one resampled
        series.  Does NOT penalise for selecting the best of L — identical to a
        t-test on the mean; gives the same p-value regardless of how many other
        paths were evaluated alongside.
      *Multi-model*: test_stat = max_k(mean(excess_k)). Null built from the
        joint bootstrap of ALL L rows via a **shared time-index** resample that
        preserves cross-model correlation.  A strategy that is best-of-L only by
        accident receives a higher p-value; a strategy that beats the benchmark
        on every path receives a lower one.

    Optional Šidák multiplicity correction when n_total_trials > k_eff:
      ``p_adj = 1 - (1 - p_raw) ** (n_total_trials / k_eff)``
    At n_total_trials == k_eff the correction is the identity (no double-count).
    At n_total_trials >> k_eff p_adj inflates toward 1 (more snooping = stricter).
    This reflects scout/mutation snooping beyond what the L-path bootstrap covers.

    References:
        White (2000). "A Reality Check for Data Snooping." Econometrica 68(5):1097-1126.
        Politis & Romano (1994). "The Stationary Bootstrap." JASA 89(428):1303-1313.
        Bailey & López de Prado (2014). "Deflated Sharpe Ratio." J Portfolio Mgmt.

    Args:
        performance_matrix: (L, T) array — L OOS return series, one per model
                            (CPCV path or WF window).  A 1-D array is treated as
                            a 1×T single-model matrix (backward-compat).
                            Truncate all rows to ``min(path_lengths)`` before
                            passing so the matrix is rectangular.
        benchmark_matrix:   (L, T) or (T,) benchmark returns; zeros for cash.
        n_bootstrap:        Bootstrap replications (default 2000).
        rng_seed:           Seed for determinism.
        block_length:       Mean stationary block length. Default: 10 % of T.
        n_total_trials:     Total scout / mutation trials from
                            ``research_trial_counter``.  When > k_eff the Šidák
                            correction inflates p_value proportionally.
        k_eff:              Effective model count assumed by bootstrap (= L when
                            None; override when some paths are correlated).

    Returns:
        dict with keys:
          p_value            (float) — gate-ready p-value (Šidák-adjusted)
          p_value_raw        (float) — bootstrap p before Šidák
          test_stat          (float) — max mean excess return across L models
          passed             (bool)  — True when p_value < threshold
          threshold          (float) — p-value threshold used
          n_models           (int)   — L (models in bootstrap universe)
          n_total_trials     (int|None)
          k_eff              (int)   — effective model count for Šidák ratio
          sidak_adjusted     (bool)  — True when Šidák was applied
          n_obs              (int)   — T (OOS periods per model)
          n_bootstrap        (int)
          block_length       (int)
          mean_excess_return (float) — alias for test_stat (consumer compat)
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
        # Broadcast (T,) → (L, T) so all models share the same benchmark
        bench = np.broadcast_to(bench, perf.shape).copy()
    if bench.shape != perf.shape:
        raise ValueError(
            f"Shape mismatch: performance_matrix {perf.shape} vs "
            f"benchmark_matrix {bench.shape}"
        )

    L, T = perf.shape
    if T < 2:
        raise ValueError(f"Need at least 2 time periods per model, got T={T}")

    # Per-model excess returns: (L, T)
    excess = perf - bench

    # Per-model sample means: (L,) — the L "model performances"
    model_means = excess.mean(axis=1)

    # Observed test statistic: max mean excess return across L models.
    # White (2000) Eq.(3.1): Vn = max_k { n^{-1} Σ_t f_{k,t} }
    T_obs = float(model_means.max())

    if block_length is None:
        block_length = max(1, int(T * _WRC_BLOCK_LENGTH_DEFAULT_FRACTION))

    threshold = get_wrc_p_threshold()
    _effective_k_eff: int = k_eff if k_eff is not None else L
    rng = np.random.default_rng(rng_seed)

    # ── Bootstrap null distribution (White 2000 §3.1) ────────────────────────
    # Enforce H0 by demeaning each model's excess series:
    #   excess_c[k] = excess[k] - mean(excess[k])  →  E[excess_c[k]] = 0 under H0.
    # Using the SAME time-index resample for all L rows preserves cross-model
    # correlation — this is the key multi-model upgrade over single-series WRC.
    excess_c = excess - model_means[:, np.newaxis]  # (L, T), H0 enforced per row

    bootstrap_max_stats = np.empty(n_bootstrap, dtype=float)
    for b in range(n_bootstrap):
        # One shared index resample applied to ALL L models simultaneously.
        idx = _stationary_bootstrap_indices(T, block_length, rng)
        bootstrap_max_stats[b] = float(excess_c[:, idx].mean(axis=1).max())

    # p-value: fraction of bootstrap max-stats >= observed max (one-sided right tail)
    p_raw = float(np.mean(bootstrap_max_stats >= T_obs))

    # ── Šidák multiplicity correction ────────────────────────────────────────
    # The L-model bootstrap accounts for snooping across k_eff paths.
    # When n_total_trials > k_eff, additional strategy variants were tried beyond
    # what the bootstrap directly models.  Šidák FWER correction:
    #   p_adj = 1 - (1 - p_raw) ** (n_total_trials / k_eff)
    # At n_total_trials == k_eff: p_adj == p_raw (identity, no double-count).
    # At n_total_trials >> k_eff: p_adj → 1 (more snooping → stricter gate).
    sidak_adjusted = bool(
        n_total_trials is not None
        and _effective_k_eff > 0
        and n_total_trials > _effective_k_eff
    )
    if sidak_adjusted:
        inflation = n_total_trials / _effective_k_eff
        p_value = float(min(1.0, 1.0 - (1.0 - p_raw) ** inflation))
    else:
        p_value = p_raw

    passed = bool(p_value < threshold)

    return {
        "p_value": round(p_value, 6),
        "p_value_raw": round(p_raw, 6),
        "test_stat": round(T_obs, 8),
        "passed": passed,
        "threshold": threshold,
        "n_models": L,
        "n_total_trials": n_total_trials,
        "k_eff": _effective_k_eff,
        "sidak_adjusted": sidak_adjusted,
        "n_obs": T,
        "n_bootstrap": n_bootstrap,
        "block_length": block_length,
        "mean_excess_return": round(T_obs, 8),  # alias for consumer backward-compat
    }
