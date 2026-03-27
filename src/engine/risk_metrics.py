"""Risk metrics computation for Monte Carlo simulated equity paths.

Pure math functions operating on numpy arrays of simulated equity curves.
"""

from __future__ import annotations

import numpy as np


def compute_max_drawdown_distribution(
    paths: np.ndarray,
    initial_capital: float,
    percentiles: list[float],
) -> dict:
    """Compute max drawdown for each path and return percentile distribution.

    Args:
        paths: 2D array (n_sims, n_steps) of cumulative P&L (not equity)
        initial_capital: Starting capital to add to paths
        percentiles: e.g. [0.05, 0.25, 0.50, 0.75, 0.95]

    Returns:
        Dict with p5, p25, p50, p75, p95 keys
    """
    equity = paths + initial_capital
    running_max = np.maximum.accumulate(equity, axis=1)
    drawdowns = running_max - equity
    max_dds = np.max(drawdowns, axis=1)

    result = {}
    for p in percentiles:
        key = f"p{int(p * 100)}"
        result[key] = float(np.percentile(max_dds, p * 100))
    return result


def compute_probability_of_ruin(
    paths: np.ndarray,
    ruin_threshold: float,
    initial_capital: float,
) -> float:
    """Fraction of paths where equity hits ruin_threshold.

    Args:
        paths: Cumulative P&L paths
        ruin_threshold: Account balance at which ruin occurs (0 = total loss)
        initial_capital: Starting capital

    Returns:
        Float between 0.0 and 1.0
    """
    equity = paths + initial_capital
    # Check if any point in each path goes below threshold
    hit_ruin = np.any(equity <= ruin_threshold, axis=1)
    return float(np.mean(hit_ruin))


def compute_sharpe_distribution(
    paths: np.ndarray,
    percentiles: list[float],
    risk_free_rate: float = 0.0,
    periods_per_year: float = 252.0,
) -> dict:
    """Compute annualized Sharpe ratio for each path, return distribution.

    Args:
        paths: Cumulative P&L paths
        percentiles: Percentile levels
        risk_free_rate: Annual risk-free rate (default 0)
        periods_per_year: Annualization factor (252 for daily, trades_per_year for trade-level)

    Returns:
        Dict with percentile keys
    """
    daily = np.diff(paths, axis=1)
    daily_rf = risk_free_rate / periods_per_year
    excess = daily - daily_rf
    means = np.mean(excess, axis=1)
    stds = np.std(excess, axis=1, ddof=1)
    stds = np.where(stds == 0, 1e-10, stds)
    sharpes = means / stds * np.sqrt(periods_per_year)

    result = {}
    for p in percentiles:
        key = f"p{int(p * 100)}"
        result[key] = float(np.percentile(sharpes, p * 100))
    return result


def compute_calmar_ratio(
    paths: np.ndarray,
    initial_capital: float,
) -> dict:
    """Calmar ratio = annualized return / max drawdown for each path.

    Returns:
        Dict with median, p5, p95
    """
    equity = paths + initial_capital
    n_days = paths.shape[1]
    years = n_days / 252

    # Annual return
    total_return = equity[:, -1] / equity[:, 0]
    annual_return = np.where(years > 0, total_return ** (1 / years) - 1, 0)

    # Max drawdown
    running_max = np.maximum.accumulate(equity, axis=1)
    drawdowns = running_max - equity
    max_dds = np.max(drawdowns, axis=1)
    # As fraction of peak
    max_dd_pct = max_dds / np.max(running_max, axis=1)
    max_dd_pct = np.where(max_dd_pct == 0, 1e-10, max_dd_pct)

    calmar = annual_return / max_dd_pct

    return {
        "median": float(np.median(calmar)),
        "p5": float(np.percentile(calmar, 5)),
        "p95": float(np.percentile(calmar, 95)),
    }


def compute_ulcer_index(
    paths: np.ndarray,
    initial_capital: float,
) -> dict:
    """Ulcer Index = sqrt(mean(drawdown_pct^2)) — measures pain of drawdowns.

    Returns:
        Dict with median, p5, p95
    """
    equity = paths + initial_capital
    running_max = np.maximum.accumulate(equity, axis=1)
    dd_pct = (running_max - equity) / running_max * 100  # percentage
    ulcer = np.sqrt(np.mean(dd_pct ** 2, axis=1))

    return {
        "median": float(np.median(ulcer)),
        "p5": float(np.percentile(ulcer, 5)),
        "p95": float(np.percentile(ulcer, 95)),
    }


def compute_time_to_recovery(
    paths: np.ndarray,
    initial_capital: float,
) -> dict:
    """For each path, find max drawdown point and count days to recover.

    Returns:
        Dict with median, p5, p95 (in trading days)
    """
    equity = paths + initial_capital
    running_max = np.maximum.accumulate(equity, axis=1)
    drawdowns = running_max - equity

    recovery_days = []
    for i in range(paths.shape[0]):
        dd = drawdowns[i]
        if np.max(dd) == 0:
            recovery_days.append(0)
            continue

        # Find the point of max drawdown
        max_dd_idx = int(np.argmax(dd))
        peak_before = running_max[i, max_dd_idx]

        # Find recovery: first time equity >= peak after max_dd_idx
        recovered = False
        for j in range(max_dd_idx + 1, len(dd)):
            if equity[i, j] >= peak_before:
                recovery_days.append(j - max_dd_idx)
                recovered = True
                break
        if not recovered:
            # Never recovered within the simulation
            recovery_days.append(len(dd) - max_dd_idx)

    arr = np.array(recovery_days)
    return {
        "median": round(float(np.median(arr))),
        "p5": round(float(np.percentile(arr, 5))),
        "p95": round(float(np.percentile(arr, 95))),
    }


def compute_var(
    paths: np.ndarray,
    levels: list[float] | None = None,
) -> dict:
    """Value at Risk — the loss threshold exceeded only X% of the time.

    Computed from daily P&Ls across all simulated paths.

    Returns:
        Dict with var_95, var_99
    """
    if levels is None:
        levels = [0.95, 0.99]

    daily = np.diff(paths, axis=1).flatten()

    result = {}
    for level in levels:
        # VaR is the negative percentile of losses
        pct = (1 - level) * 100  # e.g., 5th percentile for 95% VaR
        var_value = -float(np.percentile(daily, pct))
        key = f"var_{int(level * 100)}"
        result[key] = max(0, var_value)  # VaR as positive loss number
    return result


def compute_cvar(
    paths: np.ndarray,
    levels: list[float] | None = None,
) -> dict:
    """Conditional VaR (Expected Shortfall) — average loss in the worst X%.

    Returns:
        Dict with cvar_95, cvar_99
    """
    if levels is None:
        levels = [0.95, 0.99]

    daily = np.diff(paths, axis=1).flatten()

    result = {}
    for level in levels:
        pct = (1 - level) * 100
        threshold = np.percentile(daily, pct)
        tail = daily[daily <= threshold]
        cvar_value = -float(np.mean(tail)) if len(tail) > 0 else 0.0
        key = f"cvar_{int(level * 100)}"
        result[key] = max(0, cvar_value)
    return result


def compute_drawdown_duration(
    paths: np.ndarray,
    initial_capital: float,
) -> dict:
    """Compute drawdown depth AND duration for each simulation.

    Tracks how long each path stays in drawdown (below its high-water mark)
    and how long recovery takes after the max drawdown point.

    Args:
        paths: 2D array (n_sims, n_steps) of cumulative P&L
        initial_capital: Starting capital to add to paths

    Returns:
        Dict with max_dd_duration_bars and recovery_time_bars percentiles
        (p50, p75, p90, p95, p99)
    """
    equity = paths + initial_capital
    running_max = np.maximum.accumulate(equity, axis=1)
    in_drawdown = equity < running_max  # boolean mask: True when below HWM

    n_sims = paths.shape[0]
    max_dd_durations = np.zeros(n_sims, dtype=np.int64)
    recovery_times = np.zeros(n_sims, dtype=np.int64)

    for i in range(n_sims):
        # Max consecutive bars in drawdown
        dd_mask = in_drawdown[i]
        if not np.any(dd_mask):
            max_dd_durations[i] = 0
            recovery_times[i] = 0
            continue

        # Find longest consecutive run of True in dd_mask
        # Use diff to find transitions
        changes = np.diff(dd_mask.astype(np.int8), prepend=0, append=0)
        starts = np.where(changes == 1)[0]
        ends = np.where(changes == -1)[0]
        if len(starts) > 0 and len(ends) > 0:
            durations = ends[:len(starts)] - starts[:len(starts)]
            max_dd_durations[i] = int(np.max(durations))
        else:
            max_dd_durations[i] = 0

        # Recovery time from max drawdown point
        drawdowns = running_max[i] - equity[i]
        max_dd_idx = int(np.argmax(drawdowns))
        peak_before = running_max[i, max_dd_idx]

        recovered = False
        for j in range(max_dd_idx + 1, paths.shape[1]):
            if equity[i, j] >= peak_before:
                recovery_times[i] = j - max_dd_idx
                recovered = True
                break
        if not recovered:
            recovery_times[i] = paths.shape[1] - max_dd_idx

    pct_levels = [50, 75, 90, 95, 99]
    dd_duration_pcts = {}
    recovery_pcts = {}
    for p in pct_levels:
        dd_duration_pcts[f"p{p}"] = round(float(np.percentile(max_dd_durations, p)))
        recovery_pcts[f"p{p}"] = round(float(np.percentile(recovery_times, p)))

    return {
        "max_dd_duration_bars": dd_duration_pcts,
        "recovery_time_bars": recovery_pcts,
    }


def compute_lo_sharpe_distribution(
    paths: np.ndarray,
    percentiles: list[float],
    risk_free_rate: float = 0.0,
    periods_per_year: float = 252.0,
    max_lag: int = 0,
) -> dict:
    """Lo (2002) autocorrelation-adjusted Sharpe ratio.

    Momentum strategies inflate raw Sharpe by up to 65%. This correction
    divides by sqrt(1 + 2*sum(rho_k)) where rho_k are autocorrelations
    of step returns at lag k.
    """
    step_returns = np.diff(paths, axis=1)
    n_sims, n_steps = step_returns.shape

    if max_lag <= 0:
        max_lag = min(n_steps - 1, max(1, int(np.ceil(n_steps ** (1 / 3)))))

    # Sample up to 1000 paths for autocorrelation estimation (perf)
    sample_size = min(n_sims, 1000)
    sample_idx = np.linspace(0, n_sims - 1, sample_size, dtype=int)
    sample = step_returns[sample_idx]

    # Compute mean autocorrelation at each lag
    correction_factors = np.ones(sample_size)
    for k in range(1, max_lag + 1):
        autocorrs = np.array([
            np.corrcoef(sample[i, :-k], sample[i, k:])[0, 1]
            for i in range(sample_size)
        ])
        autocorrs = np.nan_to_num(autocorrs, nan=0.0)
        correction_factors += 2 * autocorrs

    correction_factors = np.maximum(correction_factors, 0.1)
    median_correction = float(np.median(np.sqrt(correction_factors)))

    # Compute raw Sharpe per path, then apply correction
    daily_rf = risk_free_rate / periods_per_year
    excess = step_returns - daily_rf
    means = np.mean(excess, axis=1)
    stds = np.std(excess, axis=1, ddof=1)
    stds = np.where(stds == 0, 1e-10, stds)
    raw_sharpes = means / stds * np.sqrt(periods_per_year)
    lo_sharpes = raw_sharpes / median_correction

    result = {}
    for p in percentiles:
        key = f"p{int(p * 100)}"
        result[key] = float(np.percentile(lo_sharpes, p * 100))
    result["correction_factor"] = round(median_correction, 4)
    return result


def compute_omega_ratio(
    paths: np.ndarray,
    threshold: float = 0.0,
) -> dict:
    """Omega ratio — full distribution metric, better than Sharpe for non-normal returns.

    Omega = sum(max(0, r - threshold)) / sum(max(0, threshold - r))
    Omega > 1 = profitable, > 2 = strong edge.
    """
    step_returns = np.diff(paths, axis=1)

    gains = np.sum(np.maximum(step_returns - threshold, 0), axis=1)
    losses = np.sum(np.maximum(threshold - step_returns, 0), axis=1)
    losses = np.where(losses == 0, 1e-10, losses)
    omegas = gains / losses

    return {
        "median": round(float(np.median(omegas)), 4),
        "p5": round(float(np.percentile(omegas, 5)), 4),
        "p25": round(float(np.percentile(omegas, 25)), 4),
        "p95": round(float(np.percentile(omegas, 95)), 4),
        "threshold": threshold,
    }


def compute_tail_ratio(paths: np.ndarray) -> dict:
    """Tail ratio = p95 / |p5| of step returns. >1 means fatter right tail (good)."""
    step_returns = np.diff(paths, axis=1)

    p95 = np.percentile(step_returns, 95, axis=1)
    p5 = np.percentile(step_returns, 5, axis=1)
    abs_p5 = np.where(np.abs(p5) == 0, 1e-10, np.abs(p5))
    tail_ratios = p95 / abs_p5

    return {
        "median": round(float(np.median(tail_ratios)), 4),
        "p5": round(float(np.percentile(tail_ratios, 5)), 4),
        "p95": round(float(np.percentile(tail_ratios, 95)), 4),
    }


def compute_kelly_fraction(paths: np.ndarray) -> dict:
    """Bootstrap Kelly criterion: f* = mean / variance of step returns.

    Conservative recommendation: 25th percentile / 2 (half-Kelly at p25).
    """
    step_returns = np.diff(paths, axis=1)
    means = np.mean(step_returns, axis=1)
    variances = np.var(step_returns, axis=1, ddof=1)
    variances = np.where(variances == 0, 1e-10, variances)
    kelly = means / variances

    full_kelly_p25 = float(np.percentile(kelly, 25))
    half_kelly = max(0.0, full_kelly_p25 / 2.0)

    return {
        "full_kelly_median": round(float(np.median(kelly)), 6),
        "full_kelly_p25": round(full_kelly_p25, 6),
        "half_kelly_recommended": round(half_kelly, 6),
        "interpretation": (
            f"Risk {half_kelly*100:.2f}% of capital per trade (half-Kelly at p25). "
            f"Full Kelly median: {float(np.median(kelly))*100:.2f}%."
        ),
    }


def compute_permutation_test(
    trades: np.ndarray,
    n_permutations: int = 1000,
    seed: int = 42,
) -> dict:
    """Permutation test for edge detection using path-dependent metrics.

    Compares actual trade sequence's composite path score against shuffled
    orderings. Uses final_equity / (1 + max_dd) as the test statistic —
    this IS sensitive to trade ordering (unlike Sharpe which is invariant
    to permutation for IID data).

    If actual score is in the top 5% of permutations → edge detected.
    """
    rng = np.random.default_rng(seed)

    def _path_score(t: np.ndarray) -> float:
        """Composite: final equity / (1 + max drawdown). Higher = better."""
        equity = np.cumsum(t)
        final = equity[-1]
        peak = np.maximum.accumulate(equity)
        max_dd = float(np.max(peak - equity))
        return final / (1.0 + max_dd)

    actual_score = _path_score(trades)

    # Also compute Sharpe for reporting
    actual_mean = np.mean(trades)
    actual_std = np.std(trades, ddof=1)
    if actual_std == 0:
        actual_std = 1e-10
    actual_sharpe = actual_mean / actual_std * np.sqrt(252)

    # Generate permuted scores
    permuted_scores = np.empty(n_permutations)
    for i in range(n_permutations):
        shuffled = rng.permutation(trades)
        permuted_scores[i] = _path_score(shuffled)

    # p-value: fraction of permuted scores >= actual (lower = better edge)
    p_value = float(np.mean(permuted_scores >= actual_score))
    has_edge = p_value < 0.05

    return {
        "actual_sharpe": round(actual_sharpe, 4),
        "actual_path_score": round(actual_score, 4),
        "p_value": round(p_value, 4),
        "has_edge": has_edge,
        "n_permutations": n_permutations,
        "interpretation": (
            f"Strategy path score {actual_score:.2f} ranks in the "
            f"{'top' if has_edge else 'bottom'} {p_value*100:.1f}% of {n_permutations} random orderings. "
            f"{'Edge detected (p < 0.05).' if has_edge else 'No significant edge detected.'}"
        ),
    }


def compute_deflated_sharpe_ratio(
    observed_sharpe: float,
    n_trials: int,
    n_observations: int,
    skewness: float = 0.0,
    kurtosis: float = 3.0,
    sharpe_std: float = 0.0,
) -> dict:
    """Deflated Sharpe Ratio — corrects for multiple testing bias.

    Lopez de Prado (2014): adjusts for (1) selection bias from testing N strategies,
    (2) non-normal returns (skew/kurtosis), (3) short track records.
    """
    from scipy import stats as sp_stats
    import math

    gamma = 0.5772156649  # Euler-Mascheroni constant

    # Expected max Sharpe under null (from N independent trials)
    if n_trials <= 1:
        sr_expected_max = 0.0
    else:
        log_n = math.log(n_trials)
        sr_expected_max = (
            math.sqrt(2 * log_n)
            * (1 - gamma / (2 * log_n))
            + gamma / math.sqrt(2 * log_n)
        )

    # Corrected standard deviation of Sharpe for non-normality
    if sharpe_std <= 0:
        # Compute from return moments
        sr = observed_sharpe
        sharpe_std = math.sqrt(
            (1 - skewness * sr + ((kurtosis - 3) / 4) * sr ** 2)
            / max(1, n_observations - 1)
        )

    if sharpe_std <= 0:
        sharpe_std = 1e-10

    # DSR test statistic
    dsr = (observed_sharpe - sr_expected_max) / sharpe_std

    # p-value from standard normal CDF
    p_value = 1.0 - float(sp_stats.norm.cdf(dsr))
    passes = p_value < 0.05

    if passes:
        interpretation = f"DSR passes (p={p_value:.4f}). Edge survives multiple-testing correction with {n_trials} trials."
    else:
        interpretation = f"DSR fails (p={p_value:.4f}). Edge likely an artifact of testing {n_trials} variants."

    return {
        "dsr": round(float(dsr), 4),
        "p_value": round(p_value, 4),
        "passes": passes,
        "sr_expected_max": round(sr_expected_max, 4),
        "n_trials": n_trials,
        "interpretation": interpretation,
    }


def compute_pbo(
    walk_forward_windows: list[dict],
    metric: str = "sharpe_ratio",
) -> dict:
    """Probability of Backtest Overfitting — combinatorial analysis of WF windows.

    For M windows, compute all (M choose M/2) combinations.
    For each combo: rank strategies on IS half, check if top-ranked strategy
    is also top on OOS half. PBO = fraction where IS-best is OOS-worst-half.

    Simplified single-strategy version: checks if OOS performance degrades
    relative to what IS ranking would predict.
    """
    from itertools import combinations

    n_windows = len(walk_forward_windows)
    if n_windows < 4:
        return {
            "pbo": None,
            "interpretation": f"Need at least 4 walk-forward windows for PBO (have {n_windows}).",
            "n_combinations": 0,
        }

    # Extract OOS metric values per window
    oos_values = []
    for w in walk_forward_windows:
        metrics = w.get("oos_metrics", {})
        val = metrics.get(metric, 0)
        oos_values.append(float(val))

    half = n_windows // 2
    n_overfit = 0
    n_combos = 0

    # For each combination of windows as "IS proxy"
    for is_indices in combinations(range(n_windows), half):
        oos_indices = [i for i in range(n_windows) if i not in is_indices]

        # IS performance = mean of selected windows' OOS metrics (proxy for IS ranking)
        is_mean = sum(oos_values[i] for i in is_indices) / len(is_indices)
        oos_mean = sum(oos_values[i] for i in oos_indices) / len(oos_indices)

        # Overfit = IS looks better than OOS
        if is_mean > oos_mean:
            n_overfit += 1
        n_combos += 1

    pbo = n_overfit / max(1, n_combos)

    if pbo < 0.15:
        interp = f"PBO={pbo:.2f} — Low overfitting probability. Strategy appears robust."
    elif pbo < 0.40:
        interp = f"PBO={pbo:.2f} — Moderate overfitting risk. Monitor OOS degradation."
    else:
        interp = f"PBO={pbo:.2f} — High overfitting probability. Strategy likely curve-fit."

    return {
        "pbo": round(pbo, 4),
        "interpretation": interp,
        "n_combinations": n_combos,
    }


def compute_all_risk_metrics(
    paths: np.ndarray,
    initial_capital: float,
    ruin_threshold: float,
    periods_per_year: float = 252.0,
    skip_drawdown_duration: bool = False,
) -> dict:
    """Compute all risk metrics — orchestrator called by monte_carlo.py.

    Returns:
        Combined dict for DB riskMetrics JSONB column
    """
    percentiles = [0.05, 0.25, 0.50, 0.75, 0.95]

    dd_dist = compute_max_drawdown_distribution(paths, initial_capital, percentiles)
    sharpe_dist = compute_sharpe_distribution(paths, percentiles, periods_per_year=periods_per_year)
    ruin = compute_probability_of_ruin(paths, ruin_threshold, initial_capital)
    calmar = compute_calmar_ratio(paths, initial_capital)
    ulcer = compute_ulcer_index(paths, initial_capital)
    recovery = compute_time_to_recovery(paths, initial_capital)
    var = compute_var(paths)
    cvar = compute_cvar(paths)
    dd_duration = compute_drawdown_duration(paths, initial_capital) if not skip_drawdown_duration else {}
    lo_sharpe = compute_lo_sharpe_distribution(paths, percentiles, periods_per_year=periods_per_year)
    omega = compute_omega_ratio(paths)
    tail = compute_tail_ratio(paths)
    kelly = compute_kelly_fraction(paths)

    return {
        "max_drawdown_distribution": dd_dist,
        "sharpe_distribution": sharpe_dist,
        "lo_sharpe_distribution": lo_sharpe,
        "omega_ratio": omega["median"],
        "omega_distribution": omega,
        "tail_ratio": tail["median"],
        "tail_distribution": tail,
        "kelly_fraction": kelly,
        "probability_of_ruin": ruin,
        "calmar_ratio": calmar["median"],
        "ulcer_index": ulcer["median"],
        "time_to_recovery": recovery["median"],
        "drawdown_duration": dd_duration,
        **var,
        **cvar,
    }
