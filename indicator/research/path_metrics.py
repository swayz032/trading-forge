"""Ordered-path research metrics for real lower-timeframe NQ/MNQ data.

This module intentionally requires an ordered price path. It must not be used to infer
stop-first/target-first from an ambiguous 5-minute OHLC bar.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from math import isfinite
from typing import Iterable, Optional


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
    # MAE/MFE through the first exit event (or through full path if neither is hit).
    mae_points: float
    mfe_points: float
    mae_ticks: float
    mfe_ticks: float
    # Full-horizon excursion is kept separately for research such as opportunity cost.
    horizon_mae_points: float
    horizon_mfe_points: float
    min_price_to_exit: float
    max_price_to_exit: float
    horizon_min_price: float
    horizon_max_price: float


def _excursions(spec: TradePathSpec, path: tuple[float, ...]) -> tuple[float, float, float, float]:
    min_p = min(path)
    max_p = max(path)
    if spec.side == TradeSide.LONG:
        mae = max(0.0, spec.entry_price - min_p)
        mfe = max(0.0, max_p - spec.entry_price)
    else:
        mae = max(0.0, max_p - spec.entry_price)
        mfe = max(0.0, spec.entry_price - min_p)
    return mae, mfe, min_p, max_p


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

    to_exit = path if hit_index is None else path[: hit_index + 1]
    mae, mfe, min_exit, max_exit = _excursions(spec, to_exit)
    h_mae, h_mfe, h_min, h_max = _excursions(spec, path)

    return PathOutcome(
        first_hit=first_hit,
        first_hit_index=hit_index,
        mae_points=mae,
        mfe_points=mfe,
        mae_ticks=mae / spec.tick_size,
        mfe_ticks=mfe / spec.tick_size,
        horizon_mae_points=h_mae,
        horizon_mfe_points=h_mfe,
        min_price_to_exit=min_exit,
        max_price_to_exit=max_exit,
        horizon_min_price=h_min,
        horizon_max_price=h_max,
    )


def stop_price_from_ticks(entry_price: float, side: TradeSide, stop_ticks: int, tick_size: float = 0.25) -> float:
    if not (isfinite(entry_price) and entry_price > 0 and isfinite(tick_size) and tick_size > 0):
        raise ValueError("valid positive entry/tick_size required")
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
    if not (isfinite(zone_lower) and isfinite(zone_upper) and 0 < zone_lower < zone_upper):
        raise ValueError("invalid zone")
    path = tuple(float(p) for p in observed_prices)
    if not path or not all(isfinite(p) and p > 0 for p in path):
        raise ValueError("finite positive observed path required")
    width = zone_upper - zone_lower
    if side == TradeSide.LONG:
        # Long approaches an upper target from below; near edge = lower bound.
        penetration = (max(path) - zone_lower) / width
    else:
        # Short approaches a lower target from above; near edge = upper bound.
        penetration = (zone_upper - min(path)) / width
    return max(0.0, min(1.0, penetration))
