"""Cosine similarity search for strategy graveyard.

Uses GPU-accelerated batch matmul when CuPy available (10-100x faster),
falls back to pure Python loops otherwise.
"""
import math

import numpy as np


def cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def find_similar(
    query_vector: list[float],
    corpus: list[dict],  # [{id, vector, metadata}]
    top_k: int = 5,
    threshold: float = 0.80,
) -> list[dict]:
    """
    Find top-K similar strategies from the graveyard.
    Returns matches above threshold, sorted by similarity descending.

    Uses GPU batch matmul when corpus > 50 entries and CuPy available.
    """
    if not corpus:
        return []

    # GPU fast-path for larger corpuses
    if len(corpus) >= 50:
        try:
            from src.engine.gpu_pipeline import find_similar_gpu
            q = np.array(query_vector, dtype=np.float32)
            C = np.array([e["vector"] for e in corpus], dtype=np.float32)
            top_indices, top_sims = find_similar_gpu(q, C, top_k=top_k)

            results = []
            for idx, sim in zip(top_indices, top_sims):
                if sim >= threshold:
                    entry = corpus[int(idx)]
                    results.append({
                        "id": entry["id"],
                        "similarity": round(float(sim), 6),
                        "metadata": entry.get("metadata", {}),
                    })
            return results
        except Exception:
            pass  # Fall through to CPU

    # CPU fallback: Python loop
    scored: list[dict] = []
    for entry in corpus:
        sim = cosine_similarity(query_vector, entry["vector"])
        if sim >= threshold:
            scored.append(
                {
                    "id": entry["id"],
                    "similarity": round(sim, 6),
                    "metadata": entry.get("metadata", {}),
                }
            )

    scored.sort(key=lambda x: x["similarity"], reverse=True)
    return scored[:top_k]
