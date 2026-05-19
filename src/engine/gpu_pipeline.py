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


def block_bootstrap_gpu(trades: np.ndarray, n_sims: int, block_length: int, seed: int = 42) -> np.ndarray:
    """GPU block bootstrap using CuPy. Falls back to CPU numpy."""
    n_trades = len(trades)
    if n_trades == 0:
        raise ValueError("Cannot bootstrap empty trades array")

    if CUPY_AVAILABLE:
        xp = cp
        trades_gpu = cp.asarray(trades)
    else:
        xp = np
        trades_gpu = trades

    rng = xp.random.default_rng(seed)
    p = 1.0 / max(block_length, 1)

    # Vectorized stationary bootstrap on GPU
    paths = xp.zeros((n_sims, n_trades), dtype=xp.float64)
    positions = rng.integers(0, n_trades, size=n_sims)  # start positions

    for idx in range(n_trades):
        paths[:, idx] = trades_gpu[positions % n_trades]
        # Geometric restart: with probability p, jump to random position
        restart_mask = rng.random(n_sims) < p
        new_positions = rng.integers(0, n_trades, size=n_sims)
        positions = xp.where(restart_mask, new_positions, positions + 1)

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
