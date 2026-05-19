"""
Cluster strategy graveyard embeddings to extract failure patterns.

Called via: python -m src.engine.graveyard.cluster --config <path>
Config JSON: { "entries": [ {id, embedding, failureModes, failureCategory, failureSeverity}, ... ] }
Output JSON: array of clusters with centroids, common failure modes, and counts.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np


def cluster_graveyard(entries: list[dict]) -> list[dict]:
    """Cluster graveyard entries by embedding similarity using DBSCAN."""
    if len(entries) < 3:
        return [
            {
                "cluster_id": 0,
                "cluster_name": "all",
                "count": len(entries),
                "failure_modes": _aggregate_failure_modes(entries),
                "failure_categories": _aggregate_categories(entries),
                "avg_severity": float(
                    np.mean([e.get("failureSeverity", 0.5) for e in entries])
                ),
                "member_ids": [e["id"] for e in entries],
            }
        ]

    embeddings = np.array([e["embedding"] for e in entries])

    # Normalize embeddings for cosine-like distance
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms[norms == 0] = 1
    embeddings_norm = embeddings / norms

    try:
        from sklearn.cluster import DBSCAN

        # eps=0.5 on normalized vectors ≈ cosine similarity threshold ~0.75
        clustering = DBSCAN(eps=0.5, min_samples=2, metric="euclidean").fit(
            embeddings_norm
        )
        labels = clustering.labels_
    except ImportError:
        # Fallback: simple k-means if sklearn not available
        print(
            "WARNING: sklearn not available, falling back to scipy kmeans2",
            file=sys.stderr,
        )
        from scipy.cluster.vq import kmeans2

        k = min(5, len(entries) // 3)
        if k < 2:
            k = 2
        _, labels = kmeans2(embeddings_norm.astype(float), k, minit="points")

    clusters: list[dict] = []
    unique_labels = set(labels)

    for label in sorted(unique_labels):
        mask = labels == label
        cluster_entries = [entries[i] for i in range(len(entries)) if mask[i]]

        if label == -1:
            cluster_name = "unclustered"
        else:
            cluster_name = f"cluster_{label}"

        clusters.append(
            {
                "cluster_id": int(label),
                "cluster_name": cluster_name,
                "count": len(cluster_entries),
                "failure_modes": _aggregate_failure_modes(cluster_entries),
                "failure_categories": _aggregate_categories(cluster_entries),
                "avg_severity": float(
                    np.mean(
                        [e.get("failureSeverity", 0.5) for e in cluster_entries]
                    )
                ),
                "member_ids": [e["id"] for e in cluster_entries],
            }
        )

    # Sort by count descending (largest clusters first)
    clusters.sort(key=lambda c: c["count"], reverse=True)
    return clusters


def _aggregate_failure_modes(entries: list[dict]) -> dict[str, int]:
    """Count occurrences of each failure mode across entries."""
    modes: dict[str, int] = {}
    for e in entries:
        for mode in e.get("failureModes") or []:
            modes[mode] = modes.get(mode, 0) + 1
    return dict(sorted(modes.items(), key=lambda x: x[1], reverse=True))


def _aggregate_categories(entries: list[dict]) -> dict[str, int]:
    """Count occurrences of each failure category."""
    cats: dict[str, int] = {}
    for e in entries:
        cat = e.get("failureCategory", "unknown")
        if cat:
            cats[cat] = cats.get(cat, 0) + 1
    return dict(sorted(cats.items(), key=lambda x: x[1], reverse=True))


# ─── CLI Entry Point ─────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="Graveyard embedding clusterer")
    parser.add_argument(
        "--config",
        required=True,
        help="JSON config string or file path",
    )
    args = parser.parse_args()

    try:
        if os.path.isfile(args.config):
            with open(args.config, "r") as f:
                config = json.load(f)
        else:
            config = json.loads(args.config)
    except Exception as e:
        print(json.dumps({"error": f"Invalid JSON config: {e}"}))
        sys.exit(1)

    entries = config.get("entries", [])
    if not entries:
        print(json.dumps([]))
        sys.exit(0)

    result = cluster_graveyard(entries)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
