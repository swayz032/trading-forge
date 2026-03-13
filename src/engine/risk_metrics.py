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
) -> dict:
    """Compute annualized Sharpe ratio for each path, return distribution.

    Args:
        paths: Cumulative P&L paths
        percentiles: Percentile levels
        risk_free_rate: Annual risk-free rate (default 0)

    Returns:
        Dict with percentile keys
    """
    daily = np.diff(paths, axis=1)
    daily_rf = risk_free_rate / 252
    excess = daily - daily_rf
    means = np.mean(excess, axis=1)
    stds = np.std(excess, axis=1, ddof=1)
    stds = np.where(stds == 0, 1e-10, stds)
    sharpes = means / stds * np.sqrt(252)

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
        "median": int(np.median(arr)),
        "p5": int(np.percentile(arr, 5)),
        "p95": int(np.percentile(arr, 95)),
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


def compute_all_risk_metrics(
    paths: np.ndarray,
    initial_capital: float,
    ruin_threshold: float,
) -> dict:
    """Compute all risk metrics — orchestrator called by monte_carlo.py.

    Returns:
        Combined dict for DB riskMetrics JSONB column
    """
    percentiles = [0.05, 0.25, 0.50, 0.75, 0.95]

    dd_dist = compute_max_drawdown_distribution(paths, initial_capital, percentiles)
    sharpe_dist = compute_sharpe_distribution(paths, percentiles)
    ruin = compute_probability_of_ruin(paths, ruin_threshold, initial_capital)
    calmar = compute_calmar_ratio(paths, initial_capital)
    ulcer = compute_ulcer_index(paths, initial_capital)
    recovery = compute_time_to_recovery(paths, initial_capital)
    var = compute_var(paths)
    cvar = compute_cvar(paths)

    return {
        "max_drawdown_distribution": dd_dist,
        "sharpe_distribution": sharpe_dist,
        "probability_of_ruin": ruin,
        "calmar_ratio": calmar["median"],
        "ulcer_index": ulcer["median"],
        "time_to_recovery": recovery["median"],
        **var,
        **cvar,
    }
