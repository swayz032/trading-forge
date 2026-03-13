"""Monte Carlo simulation engine — GPU-accelerated via cuPy, falls back to NumPy.

Usage:
    python -m src.engine.monte_carlo --config '{"backtest_id":"...","trades":[...],"daily_pnls":[...]}'
"""

from __future__ import annotations

import json
import sys
import time

import numpy as np

try:
    import cupy as cp
    GPU_AVAILABLE = True
except ImportError:
    cp = None
    GPU_AVAILABLE = False

from src.engine.config import MonteCarloRequest


def get_array_module(use_gpu: bool):
    """Return cupy if GPU requested and available, else numpy."""
    if use_gpu and GPU_AVAILABLE:
        return cp
    return np


def _to_numpy(arr, xp) -> np.ndarray:
    """Convert array to numpy (handles both cupy and numpy)."""
    if xp is np:
        return arr
    return cp.asnumpy(arr)


def trade_resample(
    trades: np.ndarray,
    n_sims: int,
    seed: int = 42,
    xp=None,
) -> np.ndarray:
    """Resample trade P&Ls with replacement, compute equity paths.

    Shuffles the trade sequence n_sims times to test: "If these same trades
    happened in a different order, what would the drawdown look like?"

    Returns:
        2D array of shape (n_sims, n_trades) — cumulative equity paths
    """
    if len(trades) == 0:
        raise ValueError("Cannot resample empty trades array")

    if xp is None:
        xp = np

    trades_xp = xp.asarray(trades)
    rng = xp.random.default_rng(seed)
    indices = rng.integers(0, len(trades), size=(n_sims, len(trades)))
    sampled = trades_xp[indices]
    paths = xp.cumsum(sampled, axis=1)

    return _to_numpy(paths, xp)


def return_bootstrap(
    daily_returns: np.ndarray,
    n_sims: int,
    n_days: int,
    seed: int = 42,
    xp=None,
) -> np.ndarray:
    """Bootstrap daily returns to generate simulated equity paths.

    Returns:
        2D array of shape (n_sims, n_days) — cumulative equity paths
    """
    if len(daily_returns) == 0:
        raise ValueError("Cannot bootstrap empty daily returns array")

    if xp is None:
        xp = np

    returns_xp = xp.asarray(daily_returns)
    rng = xp.random.default_rng(seed)
    indices = rng.integers(0, len(daily_returns), size=(n_sims, n_days))
    sampled = returns_xp[indices]
    paths = xp.cumsum(sampled, axis=1)

    return _to_numpy(paths, xp)


def _compute_max_drawdowns(paths: np.ndarray, initial_capital: float) -> np.ndarray:
    """Compute max drawdown for each equity path."""
    equity = paths + initial_capital
    running_max = np.maximum.accumulate(equity, axis=1)
    drawdowns = running_max - equity
    return np.max(drawdowns, axis=1)


def _compute_sharpe_ratios(paths: np.ndarray) -> np.ndarray:
    """Compute annualized Sharpe ratio for each path's daily returns."""
    daily = np.diff(paths, axis=1)
    means = np.mean(daily, axis=1)
    stds = np.std(daily, axis=1, ddof=1)
    stds = np.where(stds == 0, 1e-10, stds)
    return means / stds * np.sqrt(252)


def _compute_percentiles(values: np.ndarray, levels: list[float]) -> dict:
    """Compute named percentiles from an array."""
    result = {}
    for level in levels:
        pct = level * 100
        key = f"p{int(pct)}"
        result[key] = float(np.percentile(values, pct))
    return result


def _sample_paths(
    paths: np.ndarray,
    max_store: int,
    initial_capital: float,
) -> list[list[float]]:
    """Sample representative equity paths for storage/visualization."""
    n_sims = paths.shape[0]
    if n_sims <= max_store:
        indices = list(range(n_sims))
    else:
        final_values = paths[:, -1]
        sorted_idx = np.argsort(final_values)
        step = max(1, n_sims // max_store)
        indices = sorted_idx[::step][:max_store]

    sampled = []
    for i in indices:
        path = [initial_capital] + (paths[i] + initial_capital).tolist()
        sampled.append(path)
    return sampled


def run_monte_carlo(
    request: MonteCarloRequest,
    trades: list[float],
    daily_pnls: list[float],
    equity_curve: list[float],
) -> dict:
    """Run full Monte Carlo simulation.

    Returns:
        Dict with confidence_intervals, risk_metrics, paths, metadata
    """
    start_time = time.perf_counter()

    xp = get_array_module(request.use_gpu)
    gpu_used = xp is not np

    trades_arr = np.array(trades, dtype=np.float64)
    daily_arr = np.array(daily_pnls, dtype=np.float64)

    if request.method == "trade_resample":
        paths = trade_resample(trades_arr, request.num_simulations, seed=42, xp=xp)
    elif request.method == "return_bootstrap":
        n_days = len(daily_pnls)
        paths = return_bootstrap(daily_arr, request.num_simulations, n_days, seed=42, xp=xp)
    else:  # "both"
        half = request.num_simulations // 2
        other_half = request.num_simulations - half
        trade_paths = trade_resample(trades_arr, half, seed=42, xp=xp)
        n_days = len(daily_pnls)
        return_paths = return_bootstrap(daily_arr, other_half, n_days, seed=43, xp=xp)
        # Pad shorter to match longer columns
        max_cols = max(trade_paths.shape[1], return_paths.shape[1])
        if trade_paths.shape[1] < max_cols:
            pad = np.full(
                (trade_paths.shape[0], max_cols - trade_paths.shape[1]),
                trade_paths[:, -1:],
            )
            trade_paths = np.hstack([trade_paths, pad])
        if return_paths.shape[1] < max_cols:
            pad = np.full(
                (return_paths.shape[0], max_cols - return_paths.shape[1]),
                return_paths[:, -1:],
            )
            return_paths = np.hstack([return_paths, pad])
        paths = np.vstack([trade_paths, return_paths])

    # Compute metrics
    max_drawdowns = _compute_max_drawdowns(paths, request.initial_capital)
    sharpe_ratios = _compute_sharpe_ratios(paths)

    confidence_intervals = {
        "max_drawdown": _compute_percentiles(max_drawdowns, request.confidence_levels),
        "sharpe_ratio": _compute_percentiles(sharpe_ratios, request.confidence_levels),
    }

    risk_metrics = _compute_risk_metrics(
        paths, request.initial_capital, request.ruin_threshold,
    )

    sampled_paths = _sample_paths(paths, request.max_paths_to_store, request.initial_capital)

    elapsed_ms = int((time.perf_counter() - start_time) * 1000)

    return {
        "num_simulations": request.num_simulations,
        "method": request.method,
        "confidence_intervals": confidence_intervals,
        "risk_metrics": risk_metrics,
        "paths": sampled_paths,
        "execution_time_ms": elapsed_ms,
        "gpu_accelerated": gpu_used,
    }


def _compute_risk_metrics(
    paths: np.ndarray,
    initial_capital: float,
    ruin_threshold: float,
) -> dict:
    """Compute all risk metrics from simulated equity paths."""
    from src.engine.risk_metrics import compute_all_risk_metrics
    return compute_all_risk_metrics(paths, initial_capital, ruin_threshold)


# ─── CLI Entry Point ─────────────────────────────────────────────

def main():
    """CLI: python -m src.engine.monte_carlo --config <json> [--mc-id <uuid>]"""
    import argparse

    parser = argparse.ArgumentParser(description="Monte Carlo Simulation Engine")
    parser.add_argument("--config", required=True, help="JSON config string or file path")
    parser.add_argument("--mc-id", default=None, help="Monte Carlo run ID")
    args = parser.parse_args()

    import os
    config_input = args.config
    if os.path.isfile(config_input):
        with open(config_input) as f:
            config = json.load(f)
    else:
        config = json.loads(config_input)

    request = MonteCarloRequest(
        backtest_id=config.get("backtest_id", "cli"),
        num_simulations=config.get("num_simulations", 10_000),
        method=config.get("method", "both"),
        use_gpu=config.get("use_gpu", True),
        initial_capital=config.get("initial_capital", 100_000.0),
        max_paths_to_store=config.get("max_paths_to_store", 100),
        ruin_threshold=config.get("ruin_threshold", 0.0),
    )

    result = run_monte_carlo(
        request,
        trades=config["trades"],
        daily_pnls=config["daily_pnls"],
        equity_curve=config.get("equity_curve", []),
    )

    if args.mc_id:
        result["mc_id"] = args.mc_id

    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
