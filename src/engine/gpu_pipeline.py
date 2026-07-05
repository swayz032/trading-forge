"""GPU-accelerated data pipeline helpers using RAPIDS cuDF/cuML.

All functions have CPU fallbacks — RAPIDS is optional.
"""
from __future__ import annotations
import numpy as np

try:
    import cupy as cp
    CUPY_AVAILABLE = True
except ImportError:
    cp = None
    CUPY_AVAILABLE = False

try:
    import cudf
    import cuml
    RAPIDS_AVAILABLE = True
except ImportError:
    cudf = None
    cuml = None
    RAPIDS_AVAILABLE = False


def to_gpu_df(polars_df):
    """Polars → cuDF via Arrow (zero-copy when possible). Falls back to pandas."""
    if not RAPIDS_AVAILABLE:
        return polars_df.to_pandas()
    return cudf.DataFrame.from_arrow(polars_df.to_arrow())


def regime_cluster_gpu(features: np.ndarray, n_clusters: int = 4) -> np.ndarray:
    """GPU KMeans for regime clustering. Falls back to simple percentile-based."""
    if RAPIDS_AVAILABLE:
        km = cuml.KMeans(n_clusters=n_clusters, random_state=42)
        labels = km.fit_predict(cudf.DataFrame(features))
        return np.asarray(labels)
    # CPU fallback: simple percentile-based bucketing
    from sklearn.cluster import KMeans as SkKMeans
    try:
        km = SkKMeans(n_clusters=n_clusters, random_state=42, n_init=10)
        return km.fit_predict(features)
    except ImportError:
        # No sklearn either — use quantile buckets
        percentiles = np.linspace(0, 100, n_clusters + 1)
        thresholds = np.percentile(features[:, 0] if features.ndim > 1 else features, percentiles)
        labels = np.digitize(features[:, 0] if features.ndim > 1 else features, thresholds[1:-1])
        return labels


def batch_correlation_gpu(returns_matrix: np.ndarray) -> np.ndarray:
    """GPU correlation matrix. Falls back to numpy."""
    if CUPY_AVAILABLE:
        gpu_mat = cp.asarray(returns_matrix)
        corr = cp.corrcoef(gpu_mat, rowvar=False)
        return cp.asnumpy(corr)
    return np.corrcoef(returns_matrix, rowvar=False)


def find_similar_gpu(query_vector: np.ndarray, corpus_vectors: np.ndarray, top_k: int = 10):
    """GPU-accelerated cosine similarity over full corpus. Falls back to numpy."""
    if CUPY_AVAILABLE and len(corpus_vectors) > 0:
        q = cp.asarray(query_vector.reshape(1, -1), dtype=cp.float32)
        C = cp.asarray(corpus_vectors, dtype=cp.float32)
        norms = cp.linalg.norm(C, axis=1, keepdims=True)
        norms = cp.maximum(norms, 1e-10)
        C_normed = C / norms
        q_normed = q / cp.maximum(cp.linalg.norm(q), 1e-10)
        similarities = (C_normed @ q_normed.T).flatten()
        k = min(top_k, len(similarities))
        top_indices = cp.argsort(similarities)[-k:][::-1]
        return cp.asnumpy(top_indices), cp.asnumpy(similarities[top_indices])

    # CPU fallback
    if len(corpus_vectors) == 0:
        return np.array([], dtype=int), np.array([], dtype=float)
    q = query_vector.reshape(1, -1).astype(np.float32)
    C = corpus_vectors.astype(np.float32)
    norms = np.linalg.norm(C, axis=1, keepdims=True)
    norms = np.maximum(norms, 1e-10)
    C_normed = C / norms
    q_normed = q / max(np.linalg.norm(q), 1e-10)
    similarities = (C_normed @ q_normed.T).flatten()
    k = min(top_k, len(similarities))
    top_indices = np.argsort(similarities)[-k:][::-1]
    return top_indices, similarities[top_indices]


def block_bootstrap_gpu(
    trades: np.ndarray,
    n_sims: int,
    block_length: int,
    seed: int = 42,
    start_pos: np.ndarray | None = None,
    block_draws: np.ndarray | None = None,
    restart_pos: np.ndarray | None = None,
) -> np.ndarray:
    """GPU block bootstrap using CuPy. Falls back to CPU numpy.

    FIX (deepscan18 B-E1, 2026-07-05): resample INDICES are generated on CPU
    via the authoritative PCG64DXSM RNG (`create_authoritative_rng` in
    monte_carlo.py — the same generator family as every other MC path,
    including this function's CPU sibling `monte_carlo._block_bootstrap_core`),
    never on-device. This function used to call `xp.random.default_rng(seed)`
    directly, which — when `xp is cp` (CuPy) — is CuPy's OWN RNG algorithm and
    stream, a different sequence than PCG64DXSM for the identical seed. Same
    seed thus produced a different resample (and a different
    `probability_of_ruin_ci.ci_high`) on GPU vs CPU, straddling the B14 0.20
    hard-gate threshold depending on which machine ran the backtest.

    `monte_carlo.block_bootstrap()` pre-generates start_pos/block_draws/
    restart_pos from `create_authoritative_rng(seed)` using the EXACT same
    call sequence and shapes the CPU/Numba core (`_block_bootstrap_core`)
    consumes, and passes them in here — guaranteeing byte-identical resample
    indices whether the walk below executes on CPU or GPU. If called standalone
    without those arrays (e.g. from a test), this function derives them itself
    from `seed` so it is never silently non-deterministic across devices.

    Only the (cheap) integer/float index arrays cross the CPU->GPU boundary;
    the heavy gather + cumsum still run on device.
    """
    n_trades = len(trades)
    if n_trades == 0:
        raise ValueError("Cannot bootstrap empty trades array")

    if start_pos is None or block_draws is None or restart_pos is None:
        # Local import: avoids any module-load-order coupling with monte_carlo.py.
        from src.engine.monte_carlo import create_authoritative_rng

        _idx_rng = create_authoritative_rng(seed)[0]
        start_pos = _idx_rng.integers(0, n_trades, size=n_sims)
        block_draws = _idx_rng.random(size=(n_sims, n_trades))
        restart_pos = _idx_rng.integers(0, n_trades, size=(n_sims, n_trades))

    if CUPY_AVAILABLE:
        xp = cp
        trades_gpu = cp.asarray(trades)
        start_pos_xp = cp.asarray(start_pos)
        block_draws_xp = cp.asarray(block_draws)
        restart_pos_xp = cp.asarray(restart_pos)
    else:
        xp = np
        trades_gpu = trades
        start_pos_xp = start_pos
        block_draws_xp = block_draws
        restart_pos_xp = restart_pos

    p = 1.0 / max(block_length, 1)

    # Vectorized stationary bootstrap — walk driven entirely by the
    # pre-generated CPU-authoritative index arrays. Recurrence is identical to
    # monte_carlo._block_bootstrap_core's Numba loop (same start_pos/
    # block_draws/restart_pos, same per-step transition), just vectorized
    # across sims per column instead of a per-sim Python loop.
    paths = xp.zeros((n_sims, n_trades), dtype=xp.float64)
    positions = start_pos_xp

    for idx in range(n_trades):
        paths[:, idx] = trades_gpu[positions % n_trades]
        restart_mask = block_draws_xp[:, idx] < p
        positions = xp.where(restart_mask, restart_pos_xp[:, idx], positions + 1)

    cum_paths = xp.cumsum(paths, axis=1)

    if CUPY_AVAILABLE:
        return cp.asnumpy(cum_paths)
    return cum_paths


def gpu_risk_metrics(paths: np.ndarray) -> dict:
    """GPU-accelerated risk metrics on equity paths. Falls back to numpy."""
    if CUPY_AVAILABLE:
        xp = cp
        paths_xp = cp.asarray(paths)
    else:
        xp = np
        paths_xp = paths

    # Peak equity (running max) — CuPy doesn't support maximum.accumulate yet
    # Use numpy for this operation even on GPU (transfer back, compute, transfer)
    if CUPY_AVAILABLE:
        paths_cpu = cp.asnumpy(paths_xp)
    else:
        paths_cpu = paths_xp
    peak = np.maximum.accumulate(paths_cpu, axis=1)
    drawdown = paths_cpu - peak
    max_dd = np.min(drawdown, axis=1)
    # Percentiles (always on CPU — small array after reduction)
    dd_p5 = float(np.percentile(max_dd, 5))
    dd_p50 = float(np.percentile(max_dd, 50))
    dd_p95 = float(np.percentile(max_dd, 95))

    # Terminal values
    terminal = paths_xp[:, -1] if paths_xp.shape[1] > 0 else paths_xp[:, 0]
    survival = float(xp.mean(terminal > 0))

    result = {
        "max_drawdown_p5": dd_p5,
        "max_drawdown_p50": dd_p50,
        "max_drawdown_p95": dd_p95,
        "survival_rate": survival,
        "gpu_accelerated": CUPY_AVAILABLE,
    }

    return result
