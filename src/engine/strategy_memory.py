"""GPU-accelerated strategy memory for critic historical lookup.

Uses cuVS for nearest-neighbor when available, falls back to numpy brute-force.
"""
from __future__ import annotations
from typing import Any

import numpy as np

try:
    import cupy as cp
    from cuvs.neighbors import ivf_flat
    CUVS_AVAILABLE = True
except ImportError:
    cp = None
    CUVS_AVAILABLE = False


class StrategyMemory:
    """Finds similar prior optimization runs for the critic."""

    def __init__(self, embedding_dim: int = 64):
        self.embedding_dim = embedding_dim
        self._index = None
        self._embeddings: np.ndarray | None = None
        self._metadata: list[dict] = []

    def build_index(self, embeddings: np.ndarray, metadata: list[dict]) -> None:
        """Build search index from historical critic runs + graveyard entries."""
        self._metadata = metadata
        if len(embeddings) == 0:
            self._embeddings = np.zeros((0, self.embedding_dim), dtype=np.float32)
            return

        embeddings = np.asarray(embeddings, dtype=np.float32)
        self._embeddings = embeddings

        if CUVS_AVAILABLE and len(embeddings) >= 32:
            try:
                n_lists = min(32, len(embeddings) // 2)
                self._index = ivf_flat.build(
                    cp.asarray(embeddings),
                    n_lists=n_lists,
                )
            except Exception:
                self._index = None  # Fall back to brute-force

    def query(self, query_embedding: np.ndarray, top_k: int = 5) -> list[dict]:
        """Find most similar prior runs. Returns metadata sorted by similarity."""
        if self._embeddings is None or len(self._embeddings) == 0:
            return []

        query_embedding = np.asarray(query_embedding, dtype=np.float32)
        k = min(top_k, len(self._metadata))

        if self._index is not None and CUVS_AVAILABLE:
            try:
                distances, indices = ivf_flat.search(
                    self._index,
                    cp.asarray(query_embedding.reshape(1, -1)),
                    k=k,
                )
                idx = cp.asnumpy(indices[0])
                return [self._metadata[i] for i in idx if i < len(self._metadata)]
            except Exception:
                pass  # Fall through to CPU

        # CPU brute-force cosine similarity
        q = query_embedding.reshape(1, -1)
        q_norm = np.linalg.norm(q)
        if q_norm < 1e-10:
            return self._metadata[:k]

        e_norms = np.linalg.norm(self._embeddings, axis=1, keepdims=True)
        e_norms = np.maximum(e_norms, 1e-10)
        sims = (self._embeddings / e_norms) @ (q / q_norm).T
        sims = sims.flatten()
        top_idx = np.argsort(sims)[-k:][::-1]
        return [self._metadata[i] for i in top_idx]

    @staticmethod
    def embed_strategy(strategy_config: dict, backtest_metrics: dict, dim: int = 64) -> np.ndarray:
        """Create embedding vector from strategy features.

        Numeric features normalized to unit vector.
        """
        features = []

        # Backtest metrics (normalized)
        features.append(float(backtest_metrics.get("sharpe_ratio", 0) or 0) / 5.0)
        features.append(float(backtest_metrics.get("max_drawdown", 0) or 0) / -5000.0)
        features.append(float(backtest_metrics.get("win_rate", 0) or 0))
        features.append(float(backtest_metrics.get("profit_factor", 0) or 0) / 5.0)
        features.append(float(backtest_metrics.get("avg_daily_pnl", 0) or 0) / 1000.0)
        features.append(float(backtest_metrics.get("total_trades", 0) or 0) / 500.0)
        features.append(float(backtest_metrics.get("forge_score", 0) or 0) / 100.0)

        # Strategy config features
        indicators = strategy_config.get("indicators", [])
        features.append(len(indicators) / 5.0)
        for ind in indicators[:5]:
            features.append(float(ind.get("period", 14)) / 200.0)

        # Pad or truncate to dim
        vec = np.array(features[:dim], dtype=np.float32)
        if len(vec) < dim:
            vec = np.pad(vec, (0, dim - len(vec)), constant_values=0)

        # Normalize to unit vector
        norm = np.linalg.norm(vec)
        if norm > 1e-10:
            vec = vec / norm

        return vec
