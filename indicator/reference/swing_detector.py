"""Confirmed swing detection with explicit no-future-leak semantics."""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Iterable, List, Optional, Sequence, Tuple


class SwingKind(str, Enum):
    HIGH = "HIGH"
    LOW = "LOW"


@dataclass(frozen=True)
class Bar:
    bar_id: int
    high: float
    low: float

    def __post_init__(self):
        if self.high < self.low:
            raise ValueError("high must be >= low")


@dataclass(frozen=True)
class SwingPoint:
    kind: SwingKind
    pivot_bar_id: int
    confirmed_bar_id: int
    price: float


@dataclass(frozen=True)
class SwingDetectorConfig:
    left_bars: int
    right_bars: int

    def __post_init__(self):
        if self.left_bars < 1 or self.right_bars < 1:
            raise ValueError("left_bars and right_bars must both be >= 1")


def detect_confirmed_swings(
    bars: Sequence[Bar],
    config: SwingDetectorConfig,
    as_of_bar_id: Optional[int] = None,
) -> List[SwingPoint]:
    """Return only swings whose right-side confirmation bars already exist.

    Strict inequality is used. Equal highs/lows are not silently tie-broken because that
    would create arbitrary swing identity. A later zone-clustering layer may represent
    equal/near-equal levels without pretending one candle is the unique pivot.
    """
    if not bars:
        return []

    ordered = list(bars)
    if any(ordered[i].bar_id >= ordered[i + 1].bar_id for i in range(len(ordered) - 1)):
        raise ValueError("bars must have strictly increasing bar_id")

    left = config.left_bars
    right = config.right_bars
    out: List[SwingPoint] = []

    for i in range(left, len(ordered) - right):
        pivot = ordered[i]
        left_slice = ordered[i - left : i]
        right_slice = ordered[i + 1 : i + right + 1]
        confirmation_id = ordered[i + right].bar_id

        if as_of_bar_id is not None and confirmation_id > as_of_bar_id:
            continue

        high_ok = all(pivot.high > b.high for b in left_slice) and all(
            pivot.high > b.high for b in right_slice
        )
        low_ok = all(pivot.low < b.low for b in left_slice) and all(
            pivot.low < b.low for b in right_slice
        )

        if high_ok:
            out.append(SwingPoint(SwingKind.HIGH, pivot.bar_id, confirmation_id, pivot.high))
        if low_ok:
            out.append(SwingPoint(SwingKind.LOW, pivot.bar_id, confirmation_id, pivot.low))

    return out


@dataclass(frozen=True)
class RawReactionCluster:
    kind: SwingKind
    lower_bound: float
    upper_bound: float
    point_count: int
    origin_bar_ids: Tuple[int, ...]
    latest_pivot_bar_id: int


@dataclass(frozen=True)
class ClusterConfig:
    merge_distance: float
    min_points: int = 2
    min_zone_width: float = 0.25

    def __post_init__(self):
        if self.merge_distance <= 0:
            raise ValueError("merge_distance must be > 0")
        if self.min_points < 2:
            raise ValueError("automatic reaction clusters require at least 2 points")
        if self.min_zone_width <= 0:
            raise ValueError("min_zone_width must be > 0")


def cluster_swings(
    points: Iterable[SwingPoint],
    kind: SwingKind,
    config: ClusterConfig,
) -> List[RawReactionCluster]:
    """Deterministically cluster confirmed same-kind swings by price proximity.

    `merge_distance` and `min_zone_width` are calibration inputs. This routine is only the
    deterministic clustering mechanism; their production values must be learned elsewhere.
    """
    eligible = sorted(
        (p for p in points if p.kind == kind),
        key=lambda p: (p.price, p.pivot_bar_id, p.confirmed_bar_id),
    )
    if not eligible:
        return []

    groups: List[List[SwingPoint]] = []
    current: List[SwingPoint] = [eligible[0]]

    for p in eligible[1:]:
        if p.price - current[-1].price <= config.merge_distance:
            current.append(p)
        else:
            groups.append(current)
            current = [p]
    groups.append(current)

    out: List[RawReactionCluster] = []
    for group in groups:
        if len(group) < config.min_points:
            continue
        lo = min(p.price for p in group)
        hi = max(p.price for p in group)
        if hi - lo < config.min_zone_width:
            mid = (hi + lo) / 2.0
            lo = mid - config.min_zone_width / 2.0
            hi = mid + config.min_zone_width / 2.0
        ids = tuple(sorted(p.pivot_bar_id for p in group))
        out.append(
            RawReactionCluster(
                kind=kind,
                lower_bound=lo,
                upper_bound=hi,
                point_count=len(group),
                origin_bar_ids=ids,
                latest_pivot_bar_id=max(ids),
            )
        )

    return sorted(out, key=lambda z: (z.lower_bound, z.upper_bound, z.origin_bar_ids))
