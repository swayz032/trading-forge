"""Ordered-path research metrics for real lower-timeframe NQ/MNQ data.

This module intentionally requires an ordered price path. It must not be used to infer
stop-first/target-first from an ambiguous 5-minute OHLC bar.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from math import isfinite
from typing import Iterable, Optional, Tuple


class TradeSide(str, Enum):
    LONG = "LONG"
    SHORT = "SHORT"


class FirstHit(str, Enum):
    STOP_FIRST = "STOP_FIRST"
    TARGET_FIRST = "TARGET_FIRST"
    NEITHER = "NEITHER"


@dataclass(frozen=True)
class TradePathSpec:
    side: TradeSide
    entry_price: float
    stop_price: float
    target_price: float
    tick_size: float = 0.25

    def __post_init__(self) -> None:
        vals = (self.entry_price, self.stop_price, self.target_price, self.tick_size)
        if not all(isfinite(v) for v in vals):
            raise ValueError("trade path values must be finite")
        if self.tick_size <= 0:
            raise ValueError("tick_size must be > 0")
        if self.side == TradeSide.LONG:
            if not self.stop_price < self.entry_price < self.target_price:
                raise ValueError("LONG requires stop < entry < target")
        else:
            if not self.target_price < self.entry_price < self.stop_price:
                raise ValueError("SHORT requires target < entry < stop")


@dataclass(frozen=True)
class PathOutcome:
    first_hit: FirstHit
    first_hit_index: Optional[int]
    mae_points: float
    mfe_points: float
    mae_ticks: float
    mfe_ticks: float
    min_price: float
    max_price: float


def evaluate_ordered_path(spec: TradePathSpec, prices: Iterable[float]) -> PathOutcome:
    path = tuple(float(p) for p in prices)
    if not path:
        raise ValueError("ordered path required")
    if not all(isfinite(p) and p > 0 for p in path):
        raise ValueError("path prices must be finite and positive")

    first_hit = FirstHit.NEITHER
    hit_index = None

    for i, p in enumerate(path):
        if spec.side == TradeSide.LONG:
            if p <= spec.stop_price:
                first_hit = FirstHit.STOP_FIRST
                hit_index = i
                break
            if p >= spec.target_price:
                first_hit = FirstHit.TARGET_FIRST
                hit_index = i
                break
        else:
            if p >= spec.stop_price:
                first_hit = FirstHit.STOP_FIRST
                hit_index = i
                break
            if p <= spec.target_price:
                first_hit = FirstHit.TARGET_FIRST
                hit_index = i
                break

    min_p = min(path)
    max_p = max(path)
    if spec.side == TradeSide.LONG:
        mae = max(0.0, spec.entry_price - min_p)
        mfe = max(0.0, max_p - spec.entry_price)
    else:
        mae = max(0.0, max_p - spec.entry_price)
        mfe = max(0.0, spec.entry_price - min_p)

    return PathOutcome(
        first_hit=first_hit,
        first_hit_index=hit_index,
        mae_points=mae,
        mfe_points=mfe,
        mae_ticks=mae / spec.tick_size,
        mfe_ticks=mfe / spec.tick_size,
        min_price=min_p,
        max_price=max_p,
    )


def stop_price_from_ticks(entry_price: float, side: TradeSide, stop_ticks: int, tick_size: float = 0.25) -> float:
    if stop_ticks <= 0:
        raise ValueError("stop_ticks must be > 0")
    distance = stop_ticks * tick_size
    return entry_price - distance if side == TradeSide.LONG else entry_price + distance


def zone_penetration_fraction(
    side: TradeSide,
    zone_lower: float,
    zone_upper: float,
    observed_prices: Iterable[float],
) -> float:
    """Maximum near-edge -> far-extreme penetration into a target zone, clamped [0,1]."""
    if not (isfinite(zone_lower) and isfinite(zone_upper) and zone_lower < zone_upper):
        raise ValueError("invalid zone")
    path = tuple(float(p) for p in observed_prices)
    if not path or not all(isfinite(p) for p in path):
        raise ValueError("finite observed path required")
    width = zone_upper - zone_lower
    if side == TradeSide.LONG:
        # Long approaches an upper target from below; near edge = lower bound.
        penetration = (max(path) - zone_lower) / width
    else:
        # Short approaches a lower target from above; near edge = upper bound.
        penetration = (zone_upper - min(path)) / width
    return max(0.0, min(1.0, penetration))
