"""KNN-based day archetype predictor from premarket features."""

from __future__ import annotations

import math
from typing import Any

from .classifier import ARCHETYPES
from .feature_extractor import PREMARKET_FEATURES


def _normalize_features(
    features: dict[str, float],
    historical: list[dict],
) -> tuple[list[float], list[list[float]], dict[str, tuple[float, float]]]:
    """
    Min-max normalize features using historical min/max.

    Returns:
        (normalized_target, normalized_historical_list, bounds)
    """
    # Compute min/max for each feature across historical
    bounds: dict[str, tuple[float, float]] = {}
    for fname in PREMARKET_FEATURES:
        vals = [float(h["features"].get(fname, 0)) for h in historical]
        vals.append(float(features.get(fname, 0)))
        mn, mx = min(vals), max(vals)
        bounds[fname] = (mn, mx)

    def norm_vec(feat_dict: dict[str, float]) -> list[float]:
        result = []
        for fname in PREMARKET_FEATURES:
            val = float(feat_dict.get(fname, 0))
            mn, mx = bounds[fname]
            if mx - mn > 0:
                result.append((val - mn) / (mx - mn))
            else:
                result.append(0.0)
        return result

    target_norm = norm_vec(features)
    hist_norm = [norm_vec(h["features"]) for h in historical]
    return target_norm, hist_norm, bounds


def _euclidean_distance(a: list[float], b: list[float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def predict_archetype(
    features: dict[str, float],
    historical_features: list[dict],  # [{features: {...}, actual_archetype: str, date: ...}]
    k: int = 7,
) -> dict[str, Any]:
    """
    KNN prediction of today's archetype from premarket features.
    Uses Euclidean distance on normalized features.

    Args:
        features: Today's 13 premarket features.
        historical_features: List of dicts with 'features' and 'actual_archetype' keys.
        k: Number of nearest neighbors.

    Returns:
        {
            "predicted": str,          # Most likely archetype
            "probabilities": {...},    # All 8 archetypes -> probability
            "confidence": float,
            "nearest_dates": [...],    # K nearest historical dates
        }
    """
    if not historical_features:
        # No history: return uniform distribution
        prob = 1.0 / len(ARCHETYPES)
        return {
            "predicted": "RANGE_DAY",
            "probabilities": {a: prob for a in ARCHETYPES},
            "confidence": prob,
            "nearest_dates": [],
        }

    effective_k = min(k, len(historical_features))

    # Normalize
    target_norm, hist_norm, _ = _normalize_features(features, historical_features)

    # Compute distances
    distances: list[tuple[float, int]] = []
    for i, h_norm in enumerate(hist_norm):
        d = _euclidean_distance(target_norm, h_norm)
        distances.append((d, i))

    distances.sort(key=lambda x: x[0])
    neighbors = distances[:effective_k]

    # Weighted vote (1 / (distance + epsilon))
    eps = 1e-8
    votes: dict[str, float] = {a: 0.0 for a in ARCHETYPES}
    nearest_dates: list[str] = []

    for dist, idx in neighbors:
        arch = historical_features[idx]["actual_archetype"]
        weight = 1.0 / (dist + eps)
        votes[arch] = votes.get(arch, 0.0) + weight
        date = historical_features[idx].get("date", f"idx_{idx}")
        nearest_dates.append(str(date))

    total_weight = sum(votes.values())
    probabilities = {a: round(v / total_weight, 4) if total_weight > 0 else 0.0 for a, v in votes.items()}

    predicted = max(probabilities, key=lambda a: probabilities[a])
    confidence = probabilities[predicted]

    return {
        "predicted": predicted,
        "probabilities": probabilities,
        "confidence": round(confidence, 4),
        "nearest_dates": nearest_dates,
    }


# ─── CLI Entry Point (for Node python-runner bridge / scheduler C2) ─────


if __name__ == "__main__":
    import json
    import os
    import sys

    # Accept config via --config file path (matches calendar_filter.py pattern)
    config_path: str | None = None
    argv = sys.argv[1:]
    for i, arg in enumerate(argv):
        if arg == "--config" and i + 1 < len(argv):
            config_path = argv[i + 1]
            break
        if os.path.isfile(arg):
            config_path = arg
            break

    if config_path:
        with open(config_path, encoding="utf-8") as f:
            config = json.load(f)
    else:
        config = json.load(sys.stdin)

    action = config.get("action", "predict")

    if action == "predict":
        # Predict from pre-computed features + historical labels
        features = config.get("features") or {}
        historical = config.get("historical_features") or []
        k = int(config.get("k", 7))

        result = predict_archetype(features, historical, k=k)
        print(json.dumps(result))

    elif action == "extract_and_predict":
        # Extract features from raw premarket + prev day, then predict.
        # Used by the scheduler when historical features are loaded server-side.
        from .feature_extractor import extract_features

        current_premarket = config.get("current_premarket") or {}
        prev_day = config.get("prev_day") or {}
        historical_context = config.get("historical_context") or {}
        historical_features = config.get("historical_features") or []
        k = int(config.get("k", 7))

        features = extract_features(current_premarket, prev_day, historical_context)
        prediction = predict_archetype(features, historical_features, k=k)

        print(json.dumps({
            "features": features,
            "prediction": prediction,
        }))

    else:
        print(json.dumps({
            "error": f"Unknown action: {action}",
            "supported_actions": ["predict", "extract_and_predict"],
        }))
