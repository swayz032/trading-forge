"""Pre-backtest corpse check -- is this strategy too similar to something already dead?"""

from .similarity import find_similar
from .embedder import embed_strategy


def corpse_check(
    candidate_dsl: dict,
    graveyard_corpus: list[dict],
    similarity_threshold: float = 0.85,
) -> dict:
    """
    Check if a candidate strategy is too similar to a dead one.

    Returns:
        {
            "pass": bool,  # True if no corpse match found
            "matches": [
                {
                    "graveyard_id": str,
                    "similarity": float,
                    "name": str,
                    "failure_modes": [...],
                    "death_date": str,
                }
            ],
            "recommendation": "PROCEED" | "REVIEW" | "REJECT",
            "reason": str,
        }

    Rules:
    - similarity >= 0.90 -> REJECT (nearly identical to dead strategy)
    - similarity >= 0.85 -> REVIEW (similar, check if approach differs enough)
    - similarity < 0.85 -> PROCEED
    """
    # If no graveyard entries, always proceed
    if not graveyard_corpus:
        return {
            "pass": True,
            "matches": [],
            "recommendation": "PROCEED",
            "reason": "No strategies in graveyard to compare against",
        }

    # Embed the candidate
    query_vector = embed_strategy(candidate_dsl)

    # Search the graveyard — use a low threshold to catch anything worth reporting
    raw_matches = find_similar(
        query_vector,
        graveyard_corpus,
        top_k=5,
        threshold=similarity_threshold,
    )

    if not raw_matches:
        return {
            "pass": True,
            "matches": [],
            "recommendation": "PROCEED",
            "reason": f"No graveyard strategies above {similarity_threshold} similarity",
        }

    # Build enriched match list
    matches: list[dict] = []
    for m in raw_matches:
        meta = m.get("metadata", {})
        matches.append(
            {
                "graveyard_id": m["id"],
                "similarity": m["similarity"],
                "name": meta.get("name", "unknown"),
                "failure_modes": meta.get("failure_modes", []),
                "death_date": meta.get("death_date", "unknown"),
            }
        )

    # Determine recommendation from the highest similarity match
    top_sim = matches[0]["similarity"]
    if top_sim >= 0.90:
        recommendation = "REJECT"
        reason = (
            f"Nearly identical to dead strategy '{matches[0]['name']}' "
            f"(similarity {top_sim:.2%}). "
            f"Failure modes: {', '.join(matches[0]['failure_modes'])}"
        )
        passed = False
    elif top_sim >= similarity_threshold:
        recommendation = "REVIEW"
        reason = (
            f"Similar to dead strategy '{matches[0]['name']}' "
            f"(similarity {top_sim:.2%}). "
            f"Review if approach differs enough to warrant backtesting."
        )
        passed = False
    else:
        recommendation = "PROCEED"
        reason = "No close matches in graveyard"
        passed = True

    return {
        "pass": passed,
        "matches": matches,
        "recommendation": recommendation,
        "reason": reason,
    }
