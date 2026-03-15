"""Label all historical days with their archetype. Batch processing."""

from __future__ import annotations

from .classifier import classify_day_series, ARCHETYPES


def label_history(
    bars: list[dict],
    atr_period: int = 14,
) -> list[dict]:
    """
    Label all bars in a historical dataset with their day archetype.
    Returns bars with added 'archetype' and 'archetype_confidence' fields.
    """
    return classify_day_series(bars, atr_period)


def archetype_distribution(labeled_bars: list[dict]) -> dict:
    """
    Summary statistics of archetype distribution.
    Returns: {archetype: {count, pct, avg_range, avg_volume}}
    """
    total = len(labeled_bars)
    if total == 0:
        return {a: {"count": 0, "pct": 0.0, "avg_range": 0.0, "avg_volume": 0.0} for a in ARCHETYPES}

    buckets: dict[str, list[dict]] = {a: [] for a in ARCHETYPES}
    for bar in labeled_bars:
        arch = bar.get("archetype", "RANGE_DAY")
        if arch in buckets:
            buckets[arch].append(bar)

    result: dict[str, dict] = {}
    for arch in ARCHETYPES:
        bars_in = buckets[arch]
        count = len(bars_in)
        pct = round(count / total * 100, 2)

        if count > 0:
            avg_range = sum(float(b["high"]) - float(b["low"]) for b in bars_in) / count
            avg_volume = sum(float(b.get("volume", 0)) for b in bars_in) / count
        else:
            avg_range = 0.0
            avg_volume = 0.0

        result[arch] = {
            "count": count,
            "pct": pct,
            "avg_range": round(avg_range, 2),
            "avg_volume": round(avg_volume, 2),
        }

    return result
