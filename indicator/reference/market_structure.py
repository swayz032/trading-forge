"""Deterministic market-structure selectors for the Slumdawg indicator.

This module deliberately separates *selection semantics* from calibration.
Thresholds are supplied through config; production values must be discovered and frozen
through real NQ/MNQ research. The selectors do not invent missing values.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Iterable, Optional, Tuple


class Direction(str, Enum):
    LONG = "LONG"
    SHORT = "SHORT"


class OverallDirection(str, Enum):
    BULLISH = "BULLISH"
    BEARISH = "BEARISH"
    UNKNOWN = "UNKNOWN"


class Timeframe(str, Enum):
    M5 = "5m"
    M15 = "15m"
    H4 = "4h"
    DAILY = "1d"
    WEEKLY = "1w"


TIMEFRAME_RANK = {
    Timeframe.M5: 1,
    Timeframe.M15: 2,
    Timeframe.H4: 3,
    Timeframe.DAILY: 4,
    Timeframe.WEEKLY: 5,
}


@dataclass(frozen=True)
class ReactionZone:
    zone_id: str
    timeframe: Timeframe
    lower_bound: float
    upper_bound: float
    reaction_score: float
    reaction_count: int
    confluence_count: int
    age_bars: int

    def __post_init__(self):
        if not self.zone_id:
            raise ValueError("zone_id required")
        if self.lower_bound >= self.upper_bound:
            raise ValueError("lower_bound must be < upper_bound")
        if self.reaction_count < 0 or self.confluence_count < 0 or self.age_bars < 0:
            raise ValueError("counts/age must be non-negative")

    @property
    def width(self) -> float:
        return self.upper_bound - self.lower_bound

    def near_edge(self, direction: Direction) -> float:
        # Moving LONG toward an upper zone first reaches lower_bound.
        # Moving SHORT toward a lower zone first reaches upper_bound.
        return self.lower_bound if direction == Direction.LONG else self.upper_bound

    def far_extreme(self, direction: Direction) -> float:
        return self.upper_bound if direction == Direction.LONG else self.lower_bound


@dataclass(frozen=True)
class ProofCandidate:
    candidate_id: str
    level_price: float
    source_zone: ReactionZone
    distance_normalized: float
    room_to_target_normalized: float
    structural_score: float
    selection_score: float


@dataclass(frozen=True)
class ProofSelectorConfig:
    min_distance_normalized: float
    max_distance_normalized: float
    min_room_to_target_normalized: float
    min_countertrend_structural_score: float
    min_withtrend_structural_score: float

    def __post_init__(self):
        if self.min_distance_normalized < 0:
            raise ValueError("min distance must be >= 0")
        if self.max_distance_normalized <= self.min_distance_normalized:
            raise ValueError("max distance must exceed min distance")


@dataclass(frozen=True)
class ProofDecision:
    selected: Optional[ProofCandidate]
    rejected: Tuple[Tuple[str, str], ...]
    reason: str


def is_countertrend(trade_direction: Direction, overall: OverallDirection) -> bool:
    return (
        (trade_direction == Direction.LONG and overall == OverallDirection.BEARISH)
        or (trade_direction == Direction.SHORT and overall == OverallDirection.BULLISH)
    )


def _proof_sort_key(candidate: ProofCandidate):
    """Highest calibrated score wins; fixed rulebook order resolves only exact ties."""
    z = candidate.source_zone
    return (
        -candidate.selection_score,
        -TIMEFRAME_RANK[z.timeframe],
        -candidate.structural_score,
        -z.reaction_score,
        -z.reaction_count,
        -z.confluence_count,
        -candidate.room_to_target_normalized,
        z.age_bars,
        z.zone_id,
        candidate.candidate_id,
    )


def select_proof_level(
    candidates: Iterable[ProofCandidate],
    trade_direction: Direction,
    overall_direction: OverallDirection,
    config: ProofSelectorConfig,
) -> ProofDecision:
    """Filter fakeout-prone/late candidates, then select deterministically."""
    rejected = []
    qualified = []
    countertrend = is_countertrend(trade_direction, overall_direction)

    for c in candidates:
        if c.distance_normalized < config.min_distance_normalized:
            rejected.append((c.candidate_id, "TOO_CLOSE_NOISE_RISK"))
            continue
        if c.distance_normalized > config.max_distance_normalized:
            rejected.append((c.candidate_id, "TOO_FAR_LATE_RISK"))
            continue
        if c.room_to_target_normalized < config.min_room_to_target_normalized:
            rejected.append((c.candidate_id, "INSUFFICIENT_ROOM_TO_TARGET"))
            continue

        min_structure = (
            config.min_countertrend_structural_score
            if countertrend
            else config.min_withtrend_structural_score
        )
        if c.structural_score < min_structure:
            rejected.append(
                (
                    c.candidate_id,
                    "COUNTERTREND_STRUCTURE_TOO_WEAK" if countertrend else "STRUCTURE_TOO_WEAK",
                )
            )
            continue
        qualified.append(c)

    if not qualified:
        return ProofDecision(None, tuple(rejected), "NO_QUALIFIED_PROOF_LEVEL")

    selected = sorted(qualified, key=_proof_sort_key)[0]
    return ProofDecision(selected, tuple(rejected), "QUALIFIED_BY_STRUCTURE_AND_DISTANCE")


@dataclass(frozen=True)
class TargetSelectorConfig:
    conservative_penetration_fraction: float
    close_distance_normalized: float
    major_zone_reaction_score: float
    strong_momentum_threshold: float

    def __post_init__(self):
        if not 0.0 <= self.conservative_penetration_fraction <= 1.0:
            raise ValueError("penetration fraction must be within [0, 1]")
        if self.close_distance_normalized < 0:
            raise ValueError("close distance must be >= 0")


@dataclass(frozen=True)
class TargetCandidate:
    zone: ReactionZone
    distance_normalized: float


@dataclass(frozen=True)
class TargetDecision:
    zone: Optional[ReactionZone]
    target_price: Optional[float]
    reason: str


def conservative_target_price(
    zone: ReactionZone,
    direction: Direction,
    penetration_fraction: float,
) -> float:
    if not 0.0 <= penetration_fraction <= 1.0:
        raise ValueError("penetration_fraction must be within [0, 1]")
    if direction == Direction.LONG:
        return zone.lower_bound + zone.width * penetration_fraction
    return zone.upper_bound - zone.width * penetration_fraction


def select_target(
    candidates: Iterable[TargetCandidate],
    trade_direction: Direction,
    overall_direction: OverallDirection,
    momentum_score: float,
    config: TargetSelectorConfig,
) -> TargetDecision:
    ordered = sorted(candidates, key=lambda x: (x.distance_normalized, x.zone.zone_id))
    if not ordered:
        return TargetDecision(None, None, "NO_TARGET_ZONE")

    countertrend = is_countertrend(trade_direction, overall_direction)

    if countertrend:
        chosen = ordered[0]
        reason = "COUNTERTREND_CONSERVATIVE_NEAREST_ZONE"
    elif momentum_score < config.strong_momentum_threshold:
        chosen = ordered[0]
        reason = "NON_STRONG_MOMENTUM_NEAREST_ZONE"
    else:
        first = ordered[0]
        first_is_close_minor = (
            first.distance_normalized <= config.close_distance_normalized
            and first.zone.reaction_score < config.major_zone_reaction_score
        )
        if first_is_close_minor and len(ordered) > 1:
            chosen = ordered[1]
            reason = "STRONG_WITHTREND_SKIP_CLOSE_MINOR_ZONE"
        else:
            chosen = first
            reason = "STRONG_WITHTREND_USE_FIRST_MAJOR_OR_NONCLOSE_ZONE"

    price = conservative_target_price(
        chosen.zone,
        trade_direction,
        config.conservative_penetration_fraction,
    )
    return TargetDecision(chosen.zone, price, reason)
