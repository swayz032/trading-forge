"""Multi-asset correlated Monte Carlo bootstrap.

MED #8 — Multi-Asset Correlation in MC (Wave 27.5 Pass D.4).

Problem: MC is single-symbol. A strategy trading MES + MNQ in tandem has paths
that don't respect the empirical correlation between those two symbols. When both
symbols decline together (positive correlation), naive independent bootstraps
over-optimistically estimate drawdown because each symbol is resampled without
regard to the other, breaking the joint distribution.

Fix: Cholesky decomposition on the empirical daily-P&L correlation matrix.
Independent bootstrap paths are decorrelated and then re-correlated via Cholesky
so the resulting multi-symbol paths preserve the observed inter-symbol correlation
structure.

Opt-in contract
---------------
This module is NOT imported unconditionally by monte_carlo.py.
Activated only when the caller passes ``daily_pnls_per_symbol: dict[str, list[float]]``
with ≥2 symbols AND ``MC_MULTI_ASSET_CORRELATION_ENABLED=true`` (default false).

Backward compat
---------------
Single-symbol path in monte_carlo.py (callers that pass a flat daily_pnls list)
is completely untouched.

Env var
-------
``MC_MULTI_ASSET_CORRELATION_ENABLED`` — default false (opt-in).

Audit row
---------
``monte_carlo.multi_asset_correlation`` — emitted when triggered.
Payload: { n_symbols, correlation_matrix_summary, max_pairwise_corr }.
"""

from __future__ import annotations

import os as _os

import numpy as np
from numpy.random import PCG64DXSM, SeedSequence


# ─── Env-var feature flag ────────────────────────────────────────────────────

def multi_asset_correlation_enabled() -> bool:
    """Return True when MC_MULTI_ASSET_CORRELATION_ENABLED is 'true'."""
    return _os.environ.get("MC_MULTI_ASSET_CORRELATION_ENABLED", "false").lower() in (
        "true", "1", "yes",
    )


# ─── RNG helper ─────────────────────────────────────────────────────────────

def _create_rng(seed: int) -> np.random.Generator:
    """Create deterministic PCG64DXSM generator."""
    ss = SeedSequence(seed)
    return np.random.Generator(PCG64DXSM(ss))


# ─── Correlation matrix ──────────────────────────────────────────────────────

def compute_correlation_matrix(
    daily_pnls_per_symbol: dict[str, list[float]],
) -> np.ndarray:
    """Compute Pearson correlation matrix from per-symbol daily P&L history.

    Args:
        daily_pnls_per_symbol: Dict mapping symbol → list of daily P&L floats.
            All lists must have the same length (aligned trading days).
            Minimum 2 symbols required. Minimum 2 observations per symbol.

    Returns:
        Symmetric correlation matrix of shape (n_symbols, n_symbols).
        Diagonal entries are 1.0.

    Raises:
        ValueError: When < 2 symbols, mismatched lengths, or zero-variance series.
    """
    symbols = sorted(daily_pnls_per_symbol.keys())
    n_symbols = len(symbols)

    if n_symbols < 2:
        raise ValueError(
            f"Multi-asset correlation requires >= 2 symbols, got {n_symbols}"
        )

    lengths = [len(daily_pnls_per_symbol[s]) for s in symbols]
    if len(set(lengths)) > 1:
        raise ValueError(
            f"All symbol daily P&L series must have equal length. "
            f"Got lengths: {dict(zip(symbols, lengths))}"
        )

    n_obs = lengths[0]
    if n_obs < 2:
        raise ValueError(
            f"Need at least 2 observations per symbol for correlation. Got {n_obs}."
        )

    # Build matrix: rows = observations, columns = symbols
    data = np.array(
        [daily_pnls_per_symbol[s] for s in symbols], dtype=np.float64,
    )  # shape: (n_symbols, n_obs)

    # Guard against zero-variance series
    stds = np.std(data, axis=1, ddof=1)
    zero_var = np.where(stds < 1e-12)[0]
    if len(zero_var) > 0:
        bad = [symbols[i] for i in zero_var]
        raise ValueError(
            f"Zero-variance daily P&L series detected for symbols: {bad}. "
            f"Cannot compute correlation."
        )

    # np.corrcoef expects rows = variables, columns = observations
    corr = np.corrcoef(data)  # (n_symbols, n_symbols)

    # Ensure perfect symmetry (floating-point guard)
    corr = (corr + corr.T) / 2.0
    np.fill_diagonal(corr, 1.0)

    return corr


# ─── Cholesky-correlated bootstrap ──────────────────────────────────────────

def multi_asset_block_bootstrap(
    daily_pnls_per_symbol: dict[str, list[float]],
    n_paths: int,
    correlation_matrix: np.ndarray,
    block_length: int = 8,
    seed: int = 42,
) -> dict[str, np.ndarray]:
    """Generate correlated multi-asset MC equity paths via Cholesky decomposition.

    Algorithm
    ---------
    1. Align all symbols to the same number of observations (min length).
    2. Generate independent block-bootstrap indices (same index set for all
       symbols — temporal alignment is preserved within blocks).
    3. Resample each symbol's P&L series using the shared block indices.
    4. Standardise each symbol's resampled paths to zero-mean / unit-variance.
    5. Apply Cholesky factor of the target correlation matrix to inject
       inter-symbol correlation.
    6. Re-scale back to each symbol's original mean and standard deviation.
    7. Accumulate into per-symbol cumulative equity paths.

    Determinism: seeded with PCG64DXSM via create_authoritative_rng pattern.
    Seed is respected exactly — same seed = same output across runs.

    Args:
        daily_pnls_per_symbol: Dict symbol → list of daily P&L floats (aligned length).
        n_paths: Number of simulation paths per symbol.
        correlation_matrix: (n_symbols × n_symbols) target correlation matrix.
            Produced by compute_correlation_matrix(). Must be positive-semi-definite.
        block_length: Block length for temporal structure preservation.
        seed: RNG seed.

    Returns:
        Dict symbol → ndarray of shape (n_paths, n_obs) — cumulative equity paths.
        Keys match the keys in daily_pnls_per_symbol.

    Raises:
        ValueError: When inputs are inconsistent or Cholesky fails.
    """
    symbols = sorted(daily_pnls_per_symbol.keys())
    n_symbols = len(symbols)

    if n_symbols < 2:
        raise ValueError(
            f"multi_asset_block_bootstrap requires >= 2 symbols, got {n_symbols}"
        )

    if correlation_matrix.shape != (n_symbols, n_symbols):
        raise ValueError(
            f"correlation_matrix shape {correlation_matrix.shape} does not match "
            f"n_symbols={n_symbols}"
        )

    # Align lengths
    lengths = [len(daily_pnls_per_symbol[s]) for s in symbols]
    n_obs = min(lengths)
    if n_obs < 2:
        raise ValueError(f"Need at least 2 observations. Got n_obs={n_obs}.")

    # Build data matrix (n_symbols, n_obs)
    data = np.array(
        [np.array(daily_pnls_per_symbol[s][:n_obs], dtype=np.float64)
         for s in symbols],
    )

    # Per-symbol stats for re-scaling
    means = data.mean(axis=1)     # (n_symbols,)
    stds = data.std(axis=1, ddof=1)  # (n_symbols,)
    stds_safe = np.where(stds < 1e-12, 1.0, stds)

    # Cholesky decomposition of the target correlation matrix
    # Adds a small ridge to handle near-singular matrices
    ridge = 1e-8 * np.eye(n_symbols)
    try:
        L = np.linalg.cholesky(correlation_matrix + ridge)  # (n_symbols, n_symbols)
    except np.linalg.LinAlgError as exc:
        raise ValueError(
            f"Cholesky decomposition failed — correlation matrix is not "
            f"positive-semi-definite: {exc}"
        ) from exc

    rng = _create_rng(seed)

    # Block-bootstrap index generation: shared indices preserve temporal alignment
    p_restart = 1.0 / max(1, block_length)
    block_indices = np.zeros((n_paths, n_obs), dtype=int)
    for sim_idx in range(n_paths):
        pos = int(rng.integers(0, n_obs))
        for t in range(n_obs):
            block_indices[sim_idx, t] = pos % n_obs
            if rng.random() < p_restart:
                pos = int(rng.integers(0, n_obs))
            else:
                pos += 1

    # Per-symbol independent bootstrap paths (standardised)
    # Shape: (n_paths, n_obs, n_symbols) → transposed for Cholesky application
    independent = np.zeros((n_paths, n_obs, n_symbols), dtype=np.float64)
    for sym_idx, symbol in enumerate(symbols):
        raw = data[sym_idx]
        # Standardise: zero mean, unit variance
        std_val = stds_safe[sym_idx]
        mean_val = means[sym_idx]
        resampled = raw[block_indices]  # (n_paths, n_obs)
        standardised = (resampled - mean_val) / std_val  # (n_paths, n_obs)
        independent[:, :, sym_idx] = standardised

    # Apply Cholesky correlation injection
    # independent shape: (n_paths, n_obs, n_symbols)
    # L shape: (n_symbols, n_symbols)
    # correlated[sim, t, :] = L @ independent[sim, t, :]
    correlated = independent @ L.T  # (n_paths, n_obs, n_symbols)

    # Re-scale to original mean/std and accumulate into equity paths
    result: dict[str, np.ndarray] = {}
    for sym_idx, symbol in enumerate(symbols):
        # Re-scale: correlated_rescaled = correlated * std + mean
        rescaled = correlated[:, :, sym_idx] * stds_safe[sym_idx] + means[sym_idx]
        # Cumulative equity path
        result[symbol] = np.cumsum(rescaled, axis=1)

    return result


# ─── Convenience entry-point used by monte_carlo.py dispatcher ──────────────

def run_multi_asset_correlation_bootstrap(
    daily_pnls_per_symbol: dict[str, list[float]],
    n_paths: int,
    block_length: int = 8,
    seed: int = 42,
    backtest_id: str = "unknown",
) -> tuple[dict[str, np.ndarray], dict]:
    """Full pipeline: compute correlation → Cholesky bootstrap.

    Returns:
        (paths_dict, audit_payload) tuple.
        paths_dict: symbol → ndarray (n_paths, n_obs) cumulative equity paths.
        audit_payload: dict for ``monte_carlo.multi_asset_correlation`` audit row.
    """
    symbols = sorted(daily_pnls_per_symbol.keys())

    corr_matrix = compute_correlation_matrix(daily_pnls_per_symbol)
    paths_dict = multi_asset_block_bootstrap(
        daily_pnls_per_symbol=daily_pnls_per_symbol,
        n_paths=n_paths,
        correlation_matrix=corr_matrix,
        block_length=block_length,
        seed=seed,
    )

    # Build correlation summary for audit (upper triangle only)
    n_sym = len(symbols)
    pairs: dict[str, float] = {}
    for i in range(n_sym):
        for j in range(i + 1, n_sym):
            key = f"{symbols[i]}_vs_{symbols[j]}"
            pairs[key] = round(float(corr_matrix[i, j]), 4)

    max_pairwise = float(np.max(np.abs(
        corr_matrix - np.eye(n_sym)
    ))) if n_sym > 1 else 0.0

    audit_payload = {
        "n_symbols": n_sym,
        "symbols": symbols,
        "correlation_matrix_summary": pairs,
        "max_pairwise_corr": round(max_pairwise, 4),
        "block_length": block_length,
        "n_paths": n_paths,
        "backtest_id": backtest_id,
    }

    # Emit audit row (best-effort — must never block MC)
    try:
        from src.engine.audit_writer import write_audit_row_sync
        write_audit_row_sync(
            action="monte_carlo.multi_asset_correlation",
            entity_type="monte_carlo",
            entity_id=backtest_id,
            severity="info",
            payload=audit_payload,
        )
    except Exception:
        pass

    return paths_dict, audit_payload
