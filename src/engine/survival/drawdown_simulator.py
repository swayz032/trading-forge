"""Monte Carlo drawdown breach probability simulator."""

from __future__ import annotations

import numpy as np


def mc_drawdown_breach(
    daily_pnls: list[float],
    max_drawdown: float,
    drawdown_type: str,  # "trailing" | "EOD" | "intraday"
    num_sims: int = 5000,
    seed: int = 42,
) -> dict:
    """
    Monte Carlo simulation for drawdown breach probability.
    Shuffles daily P&Ls and tracks max DD under each sim.

    For trailing DD: tracks running peak-to-trough drawdown.
    For EOD DD: same as trailing but only measures at end-of-day (equivalent
        for daily P&L data since we only have daily resolution).
    For intraday DD: applies a 1.2x multiplier to account for intraday
        excursions beyond daily close-to-close moves.

    Args:
        daily_pnls: Array of daily net P&L values.
        max_drawdown: Maximum allowed drawdown (positive number, e.g. 2000).
        drawdown_type: "trailing", "EOD", or "intraday".
        num_sims: Number of Monte Carlo simulations.
        seed: Random seed for reproducibility.

    Returns:
        {
            "breach_probability": float,
            "median_max_dd": float,
            "p95_max_dd": float,
            "p99_max_dd": float,
            "sims_run": int,
            "score": float,  # 0-100, higher = safer
        }
    """
    arr = np.array(daily_pnls, dtype=np.float64)

    if len(arr) == 0:
        return {
            "breach_probability": 0.0,
            "median_max_dd": 0.0,
            "p95_max_dd": 0.0,
            "p99_max_dd": 0.0,
            "sims_run": 0,
            "score": 100.0,
        }

    rng = np.random.default_rng(seed)
    n_days = len(arr)
    max_dd_limit = abs(max_drawdown)

    # Intraday drawdown is harsher — intraday excursions can be ~20% worse
    # than close-to-close moves suggest
    intraday_multiplier = 1.2 if drawdown_type == "intraday" else 1.0

    # Vectorized: all sims at once, chunked for memory safety
    CHUNK_SIZE = 50_000
    max_dds = np.empty(num_sims, dtype=np.float64)

    for chunk_start in range(0, num_sims, CHUNK_SIZE):
        chunk_end = min(chunk_start + CHUNK_SIZE, num_sims)
        chunk_size = chunk_end - chunk_start

        tiled = np.tile(arr, (chunk_size, 1))
        shuffled = rng.permuted(tiled, axis=1)  # independent permutation per row
        equity = np.cumsum(shuffled, axis=1)
        running_peak = np.maximum.accumulate(equity, axis=1)
        drawdowns = (running_peak - equity) * intraday_multiplier
        max_dds[chunk_start:chunk_end] = np.max(drawdowns, axis=1)

    breach_count = int(np.sum(max_dds >= max_dd_limit))
    breach_probability = breach_count / num_sims
    median_max_dd = float(np.median(max_dds))
    p95_max_dd = float(np.percentile(max_dds, 95))
    p99_max_dd = float(np.percentile(max_dds, 99))

    # Score: 0-100 where 100 = zero breach probability
    # Exponential decay: score = 100 * exp(-5 * breach_prob)
    # At 10% breach -> score ~61, at 20% -> score ~37, at 50% -> score ~8
    score = 100.0 * np.exp(-5.0 * breach_probability)

    return {
        "breach_probability": round(breach_probability, 6),
        "median_max_dd": round(median_max_dd, 2),
        "p95_max_dd": round(p95_max_dd, 2),
        "p99_max_dd": round(p99_max_dd, 2),
        "sims_run": num_sims,
        "score": round(float(score), 2),
    }
