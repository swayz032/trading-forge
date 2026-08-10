"""Reference reaction-cluster take-profit selector for Slumdawg.

This is a deterministic semantic oracle for Pine/FXR parity. It does not claim edge.
Production calibration values remain external to this module.
"""
from __future__ import annotations

from dataclasses import dataclass
from math import ceil, floor, isfinite
from typing import Iterable, Optional, Sequence, Tuple


@dataclass(frozen=True)
class ReactionInterval:
    lower: float
    upper: float
    source_id: str

    def __post_init__(self) -> None:
        if not self.source_id:
            raise ValueError("source_id required")
        if not isfinite(self.lower) or not isfinite(self.upper):
            raise ValueError("reaction interval prices must be finite")
        if self.lower <= 0 or self.upper <= 0 or self.lower >= self.upper:
            raise ValueError("reaction interval must have positive lower < upper")


@dataclass(frozen=True)
class ReactionCluster:
    lower: float
    upper: float
    touches: int
    member_ids: Tuple[str, ...]

    def __post_init__(self) -> None:
        if not isfinite(self.lower) or not isfinite(self.upper):
            raise ValueError("cluster prices must be finite")
        if self.lower <= 0 or self.upper <= 0 or self.lower >= self.upper:
            raise ValueError("cluster must have positive lower < upper")
        if self.touches < 1:
            raise ValueError("cluster touches must be >= 1")
        if not self.member_ids:
            raise ValueError("cluster member_ids required")

    @property
    def width(self) -> float:
        return self.upper - self.lower


@dataclass(frozen=True)
class TargetLevel:
    cluster: ReactionCluster
    raw_price: float
    price: float

    def __post_init__(self) -> None:
        if not isfinite(self.raw_price) or not isfinite(self.price):
            raise ValueError("target prices must be finite")
        if not self.cluster.lower <= self.raw_price <= self.cluster.upper:
            raise ValueError("raw target must sit inside its cluster")


def _round_long_target(price: float, tick: float) -> float:
    return floor((price + 1e-12) / tick) * tick


def _round_short_target(price: float, tick: float) -> float:
    return ceil((price - 1e-12) / tick) * tick


def _cluster_at_seed(
    intervals: Sequence[ReactionInterval], *, seed_index: int, side: str, tolerance: float
) -> ReactionCluster:
    seed = intervals[seed_index]
    seed_edge = seed.lower if side == "LONG" else seed.upper
    members = []
    lower = float("inf")
    upper = float("-inf")
    for interval in intervals:
        edge = interval.lower if side == "LONG" else interval.upper
        if abs(edge - seed_edge) <= tolerance:
            members.append(interval.source_id)
            lower = min(lower, interval.lower)
            upper = max(upper, interval.upper)
    return ReactionCluster(lower, upper, len(members), tuple(sorted(members)))


def _pick_cluster(
    intervals: Sequence[ReactionInterval],
    *,
    side: str,
    boundary: float,
    required_gap: float,
    tolerance: float,
    min_touches: int,
) -> Optional[ReactionCluster]:
    if side not in {"LONG", "SHORT"}:
        raise ValueError("side must be LONG or SHORT")
    best: Optional[ReactionCluster] = None
    best_distance = float("inf")
    for index in range(len(intervals)):
        cluster = _cluster_at_seed(intervals, seed_index=index, side=side, tolerance=tolerance)
        if cluster.touches < min_touches:
            continue
        if side == "LONG":
            if cluster.lower < boundary + required_gap:
                continue
            distance = cluster.lower - boundary
        else:
            if cluster.upper > boundary - required_gap:
                continue
            distance = boundary - cluster.upper
        if distance < best_distance - 1e-12:
            best, best_distance = cluster, distance
        elif abs(distance - best_distance) <= 1e-12 and best is not None:
            if cluster.touches > best.touches:
                best = cluster
    return best


def _target_from_cluster(
    cluster: ReactionCluster, *, side: str, penetration_fraction: float, tick: float
) -> TargetLevel:
    if not 0.0 < penetration_fraction < 0.5:
        raise ValueError("penetration_fraction must be in (0, 0.5)")
    if not isfinite(tick) or tick <= 0:
        raise ValueError("tick must be finite and positive")
    if side == "LONG":
        raw = cluster.lower + cluster.width * penetration_fraction
        rounded = _round_long_target(raw, tick)
    else:
        raw = cluster.upper - cluster.width * penetration_fraction
        rounded = _round_short_target(raw, tick)
    return TargetLevel(cluster, raw, rounded)


def select_target_ladder(
    intervals: Iterable[ReactionInterval],
    *,
    side: str,
    entry: float,
    entry_gap: float,
    zone_gap: float,
    tolerance: float,
    min_touches: int,
    penetration_fraction: float,
    tick: float,
    max_targets: int = 3,
) -> Tuple[TargetLevel, ...]:
    """Select ordered, structurally separate reaction-cluster targets.

    Both swing-high and swing-low reaction intervals may be supplied. The selector
    groups them by the near edge for the requested side. A lone isolated pivot cannot
    qualify when ``min_touches >= 2``.
    """
    rows = tuple(intervals)
    if side not in {"LONG", "SHORT"}:
        raise ValueError("side must be LONG or SHORT")
    if not isfinite(entry) or entry <= 0:
        raise ValueError("entry must be finite and positive")
    if entry_gap < 0 or zone_gap < 0 or tolerance < 0:
        raise ValueError("gaps/tolerance must be non-negative")
    if min_touches < 2:
        raise ValueError("min_touches must be >= 2")
    if max_targets < 1:
        raise ValueError("max_targets must be >= 1")

    out = []
    boundary = entry
    required_gap = entry_gap
    for _ in range(max_targets):
        cluster = _pick_cluster(
            rows,
            side=side,
            boundary=boundary,
            required_gap=required_gap,
            tolerance=tolerance,
            min_touches=min_touches,
        )
        if cluster is None:
            break
        out.append(
            _target_from_cluster(
                cluster,
                side=side,
                penetration_fraction=penetration_fraction,
                tick=tick,
            )
        )
        boundary = cluster.upper if side == "LONG" else cluster.lower
        required_gap = zone_gap
    return tuple(out)


def merge_distinct_target_ladders(
    ladders: Iterable[Iterable[TargetLevel]],
    *,
    side: str,
    entry: float,
    entry_gap: float,
    zone_gap: float,
    fusion_gap: float,
    max_targets: int = 3,
) -> Tuple[TargetLevel, ...]:
    """Merge platform/timeframe ladders by *zone identity*, not target price.

    Different lanes can describe the same physical reaction shelf with different
    bounds and different inside-zone target prices. After the first destination is
    selected, another candidate must put its *entire cluster* beyond the previous
    cluster plus ``max(zone_gap, fusion_gap)``. This prevents a 5m sub-zone and a
    15m/1H view of the same shelf from becoming TP1 and TP2.
    """
    if side not in {"LONG", "SHORT"}:
        raise ValueError("side must be LONG or SHORT")
    if not isfinite(entry) or entry <= 0:
        raise ValueError("entry must be finite and positive")
    if min(entry_gap, zone_gap, fusion_gap) < 0:
        raise ValueError("gaps must be non-negative")
    if max_targets < 1:
        raise ValueError("max_targets must be >= 1")

    candidates = tuple(level for ladder in ladders for level in ladder)
    out = []
    boundary = entry
    required_gap = entry_gap

    for _ in range(max_targets):
        best: Optional[TargetLevel] = None
        best_distance = float("inf")
        for candidate in candidates:
            cluster = candidate.cluster
            if side == "LONG":
                if cluster.lower < boundary + required_gap:
                    continue
                distance = cluster.lower - boundary
            else:
                if cluster.upper > boundary - required_gap:
                    continue
                distance = boundary - cluster.upper

            if distance < best_distance - 1e-12:
                best = candidate
                best_distance = distance
            elif abs(distance - best_distance) <= 1e-12 and best is not None:
                # Prefer stronger evidence when two lanes arrive at the same shelf edge.
                if cluster.touches > best.cluster.touches:
                    best = candidate

        if best is None:
            break

        out.append(best)
        boundary = best.cluster.upper if side == "LONG" else best.cluster.lower
        required_gap = max(zone_gap, fusion_gap)

    return tuple(out)
