"""Cosine similarity search for strategy graveyard."""
import math


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
    """
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
