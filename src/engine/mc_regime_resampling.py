"""Regime-aware block bootstrap for Monte Carlo simulation.

MED #7 — Regime-Aware MC Resampling (Wave 27.5 Pass D.4).

Problem: Naive block bootstrap mixes regimes. A strategy that loses money in
volatile environments has loss clusters in high-vol periods. Naive resampling
can amplify those clusters by sampling within a regime without respecting
regime-transition probabilities, producing paths that over- or under-represent
regime exposure relative to the real distribution.

Fix: segment trades by detected regime label, then recombine blocks respecting
the empirical regime-transition matrix. Result: MC paths that reflect the same
regime distribution and transition structure as the original trade history.

Opt-in contract
---------------
This module is NOT imported unconditionally by monte_carlo.py.
It is loaded only when ``method="regime_block_bootstrap"`` AND
``MC_REGIME_AWARE_BOOTSTRAP_ENABLED=true`` (default false) is set in env.

Backward compat
---------------
Existing methods (block_bootstrap, return_bootstrap, arch_stationary,
trade_resample) are untouched. Only additive dispatch added in monte_carlo.py.

Env var
-------
``MC_REGIME_AWARE_BOOTSTRAP_ENABLED`` — default false (opt-in).

Audit row
---------
``monte_carlo.regime_aware_resample`` — emitted when method is selected.
Payload: { n_regimes_detected, transitions_count, regime_distribution }.
"""

from __future__ import annotations

import os as _os

import numpy as np
from numpy.random import PCG64DXSM, SeedSequence


# ─── RNG helper ─────────────────────────────────────────────────────────────

def _create_rng(seed: int) -> np.random.Generator:
    """Create deterministic PCG64DXSM generator (matches monte_carlo.py pattern)."""
    ss = SeedSequence(seed)
    return np.random.Generator(PCG64DXSM(ss))


# ─── Env-var feature flag ────────────────────────────────────────────────────

def regime_aware_bootstrap_enabled() -> bool:
    """Return True when MC_REGIME_AWARE_BOOTSTRAP_ENABLED is 'true'."""
    return _os.environ.get("MC_REGIME_AWARE_BOOTSTRAP_ENABLED", "false").lower() in (
        "true", "1", "yes",
    )


# ─── Trade segmentation ──────────────────────────────────────────────────────

def segment_trades_by_regime(
    trades: list[dict],
    regime_per_trade: list[str],
) -> dict[str, list[dict]]:
    """Partition trades into per-regime buckets.

    Args:
        trades: List of trade dicts (any shape; module is agnostic to content).
        regime_per_trade: Parallel list of regime labels (one per trade).
            Length must equal len(trades).

    Returns:
        Dict mapping regime_label → list of trade dicts in that regime.
        Empty regimes are omitted.

    Raises:
        ValueError: When lengths mismatch or both inputs are empty.
    """
    if len(trades) != len(regime_per_trade):
        raise ValueError(
            f"trades length ({len(trades)}) must equal regime_per_trade length "
            f"({len(regime_per_trade)})"
        )
    if len(trades) == 0:
        raise ValueError("Cannot segment empty trades list")

    buckets: dict[str, list[dict]] = {}
    for trade, regime in zip(trades, regime_per_trade):
        if regime not in buckets:
            buckets[regime] = []
        buckets[regime].append(trade)

    return buckets


# ─── Transition matrix estimation ───────────────────────────────────────────

def estimate_regime_transition_matrix(
    regime_per_trade: list[str],
    regimes: list[str],
) -> np.ndarray:
    """Estimate empirical Markov transition matrix from a regime sequence.

    Args:
        regime_per_trade: Ordered sequence of regime labels.
        regimes: Sorted list of unique regime labels (column/row order).

    Returns:
        2D ndarray of shape (n_regimes, n_regimes).
        Entry [i, j] = P(next_regime = regimes[j] | current_regime = regimes[i]).
        Rows sum to 1.0. Rows with no observations default to uniform distribution.
    """
    n = len(regimes)
    idx = {r: i for i, r in enumerate(regimes)}
    counts = np.zeros((n, n), dtype=float)

    for cur, nxt in zip(regime_per_trade[:-1], regime_per_trade[1:]):
        if cur in idx and nxt in idx:
            counts[idx[cur], idx[nxt]] += 1.0

    # Row-normalise; rows with no observations → uniform (never-observed regime)
    row_sums = counts.sum(axis=1, keepdims=True)
    row_sums_safe = np.where(row_sums == 0, 1.0, row_sums)
    transition_matrix = counts / row_sums_safe

    # Fix zero-rows: replace with uniform distribution
    zero_rows = (row_sums.flatten() == 0)
    if zero_rows.any():
        transition_matrix[zero_rows] = 1.0 / n

    return transition_matrix


# ─── Regime distribution summary ────────────────────────────────────────────

def compute_regime_distribution(regime_per_trade: list[str]) -> dict[str, float]:
    """Return empirical regime frequencies as fractions summing to 1.0."""
    if not regime_per_trade:
        return {}
    counts: dict[str, int] = {}
    for r in regime_per_trade:
        counts[r] = counts.get(r, 0) + 1
    total = len(regime_per_trade)
    return {r: c / total for r, c in counts.items()}


# ─── Core bootstrap function ─────────────────────────────────────────────────

def regime_aware_block_bootstrap(
    trades_by_regime: dict[str, list[dict]],
    n_paths: int,
    block_length: int,
    regime_transition_matrix: np.ndarray,
    seed: int = 42,
    pnl_key: str = "pnl",
) -> np.ndarray:
    """Generate MC equity paths respecting regime structure.

    Algorithm
    ---------
    1. Determine regime sequence length: sum of all trades across all regimes
       (the total path length per simulation equals the original n_trades).
    2. For each path:
       a. Sample an initial regime from the empirical regime stationary distribution.
       b. Walk through trades: at each step, either continue within the current regime
          block (probability 1 - 1/block_length) or transition to a new regime via
          the transition matrix (probability 1/block_length).
       c. Draw a random trade from the current regime's trade pool (with replacement).
    3. Accumulate trade P&Ls into equity paths.

    Args:
        trades_by_regime: Output of segment_trades_by_regime().
            Keys = regime labels, values = list of trade dicts.
        n_paths: Number of simulation paths to generate.
        block_length: Expected block length within a regime before allowing
            regime transitions. Same semantics as block_bootstrap block_length.
        regime_transition_matrix: 2D array (n_regimes × n_regimes) of transition
            probabilities. Row i = P(transition from regime i to regime j).
            Must be output of estimate_regime_transition_matrix().
        seed: RNG seed for full determinism (PCG64DXSM).
        pnl_key: Key in each trade dict that holds the float P&L value.

    Returns:
        2D ndarray of shape (n_paths, n_trades_total) — cumulative equity paths.
        Each row is an independent bootstrap path. Values are cumulative sums.

    Raises:
        ValueError: When trades_by_regime is empty or any regime has no trades.
    """
    if not trades_by_regime:
        raise ValueError("trades_by_regime must be non-empty")

    regimes = sorted(trades_by_regime.keys())
    n_regimes = len(regimes)

    # Total path length = total trades across all regimes
    n_trades_total = sum(len(v) for v in trades_by_regime.values())
    if n_trades_total == 0:
        raise ValueError("All regime trade buckets are empty")

    # Extract P&L arrays per regime
    pnl_by_regime: dict[str, np.ndarray] = {}
    for regime, trade_list in trades_by_regime.items():
        try:
            pnl_by_regime[regime] = np.array(
                [float(t[pnl_key]) for t in trade_list], dtype=np.float64,
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(
                f"Cannot extract pnl_key='{pnl_key}' from regime '{regime}' trades: {exc}"
            ) from exc

    # Compute empirical regime distribution for initial-regime sampling
    regime_counts = np.array(
        [len(trades_by_regime[r]) for r in regimes], dtype=float,
    )
    regime_prior = regime_counts / regime_counts.sum()

    # Block transition probability: at each trade step, with prob p_transition,
    # allow regime switch (sampled from current row of transition matrix).
    # With prob (1 - p_transition), stay in current regime.
    p_transition = 1.0 / max(1, block_length)

    rng = _create_rng(seed)

    # Pre-allocate output
    paths = np.zeros((n_paths, n_trades_total), dtype=np.float64)

    for sim_idx in range(n_paths):
        # Sample initial regime
        cur_regime_idx = int(rng.choice(n_regimes, p=regime_prior))

        for trade_idx in range(n_trades_total):
            cur_regime = regimes[cur_regime_idx]
            pnl_arr = pnl_by_regime[cur_regime]

            # Draw a random trade from the current regime
            trade_pick = int(rng.integers(0, len(pnl_arr)))
            paths[sim_idx, trade_idx] = pnl_arr[trade_pick]

            # Decide whether to transition regime at next step
            if rng.random() < p_transition:
                trans_probs = regime_transition_matrix[cur_regime_idx]
                cur_regime_idx = int(rng.choice(n_regimes, p=trans_probs))

    # Convert to cumulative equity paths
    return np.cumsum(paths, axis=1)


# ─── Convenience entry-point used by monte_carlo.py dispatcher ──────────────

def run_regime_block_bootstrap(
    trades: list[dict],
    regime_per_trade: list[str],
    n_paths: int,
    block_length: int,
    seed: int = 42,
    pnl_key: str = "pnl",
    backtest_id: str = "unknown",
) -> tuple[np.ndarray, dict]:
    """Full pipeline: segment → estimate matrix → bootstrap.

    Returns:
        (paths_ndarray, audit_payload) tuple.
        paths_ndarray: shape (n_paths, n_trades_total) cumulative equity paths.
        audit_payload: dict for ``monte_carlo.regime_aware_resample`` audit row.
    """
    trades_by_regime = segment_trades_by_regime(trades, regime_per_trade)
    regimes = sorted(trades_by_regime.keys())
    transition_matrix = estimate_regime_transition_matrix(regime_per_trade, regimes)
    regime_dist = compute_regime_distribution(regime_per_trade)

    n_transitions = sum(
        1 for cur, nxt in zip(regime_per_trade[:-1], regime_per_trade[1:])
        if cur != nxt
    )

    paths = regime_aware_block_bootstrap(
        trades_by_regime=trades_by_regime,
        n_paths=n_paths,
        block_length=block_length,
        regime_transition_matrix=transition_matrix,
        seed=seed,
        pnl_key=pnl_key,
    )

    audit_payload = {
        "n_regimes_detected": len(regimes),
        "regimes": regimes,
        "transitions_count": n_transitions,
        "regime_distribution": {r: round(v, 4) for r, v in regime_dist.items()},
        "block_length": block_length,
        "n_paths": n_paths,
        "n_trades_per_path": paths.shape[1],
        "backtest_id": backtest_id,
    }

    # Emit audit row (best-effort — must never block MC)
    try:
        from src.engine.audit_writer import write_audit_row_sync
        write_audit_row_sync(
            action="monte_carlo.regime_aware_resample",
            entity_type="monte_carlo",
            entity_id=backtest_id,
            severity="info",
            payload=audit_payload,
        )
    except Exception:
        pass

    return paths, audit_payload
