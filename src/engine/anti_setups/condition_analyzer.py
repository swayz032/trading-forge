"""Analyze and cluster losing trade conditions to discover patterns."""

from __future__ import annotations

import statistics
from typing import Any


def cluster_losing_conditions(
    losing_trades: list[dict],
    context_features: list[str] | None = None,
) -> list[dict]:
    """
    Cluster losing trades by their environmental conditions.
    Uses simple binning + frequency analysis (no ML needed).

    Default context features: hour, day_of_week, atr_percentile,
    volume_percentile, regime, archetype, days_to_event

    Returns clusters with their characteristics.
    """
    if not losing_trades:
        return []

    if context_features is None:
        context_features = [
            "hour", "day_of_week", "atr_percentile",
            "volume_percentile", "regime", "archetype", "days_to_event",
        ]

    clusters: list[dict] = []

    for feature in context_features:
        feature_clusters = _bin_by_feature(losing_trades, feature)
        clusters.extend(feature_clusters)

    # Sort by cluster size descending
    clusters.sort(key=lambda c: c["count"], reverse=True)
    return clusters


def _bin_by_feature(trades: list[dict], feature: str) -> list[dict]:
    """Bin trades by a single feature and return cluster summaries."""
    clusters: list[dict] = []

    # Collect values
    valued_trades: list[tuple[Any, dict]] = []
    for t in trades:
        val = t.get(feature)
        if val is not None:
            valued_trades.append((val, t))

    if not valued_trades:
        return []

    # Determine if numeric or categorical
    sample_val = valued_trades[0][0]
    is_numeric = isinstance(sample_val, (int, float))

    if is_numeric:
        values = [v for v, _ in valued_trades]
        # Create percentile bins: low (0-33), medium (33-66), high (66-100)
        sorted_vals = sorted(values)
        n = len(sorted_vals)
        if n < 3:
            return []

        p33 = sorted_vals[n // 3]
        p66 = sorted_vals[2 * n // 3]

        bins = {
            "low": [],
            "medium": [],
            "high": [],
        }

        for val, trade in valued_trades:
            if val <= p33:
                bins["low"].append(trade)
            elif val <= p66:
                bins["medium"].append(trade)
            else:
                bins["high"].append(trade)

        for bin_name, bin_trades in bins.items():
            if not bin_trades:
                continue
            pnls = [t.get("pnl", 0) for t in bin_trades]
            clusters.append({
                "feature": feature,
                "bin": bin_name,
                "count": len(bin_trades),
                "pct_of_total": round(len(bin_trades) / len(trades), 4),
                "avg_pnl": round(statistics.mean(pnls), 2),
                "total_pnl": round(sum(pnls), 2),
                "threshold_low": round(p33, 4) if bin_name != "high" else round(p66, 4),
                "threshold_high": round(p66, 4) if bin_name == "medium" else None,
            })
    else:
        # Categorical binning
        cat_bins: dict[str, list[dict]] = {}
        for val, trade in valued_trades:
            cat_bins.setdefault(str(val), []).append(trade)

        for cat_name, cat_trades in cat_bins.items():
            pnls = [t.get("pnl", 0) for t in cat_trades]
            clusters.append({
                "feature": feature,
                "bin": cat_name,
                "count": len(cat_trades),
                "pct_of_total": round(len(cat_trades) / len(trades), 4),
                "avg_pnl": round(statistics.mean(pnls), 2),
                "total_pnl": round(sum(pnls), 2),
            })

    return clusters
