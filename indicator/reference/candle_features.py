"""Deterministic candle and intrabar momentum features.

No feature here predicts the market. This module converts visual terms such as
"wick rejection", "body strength", "hold", and "push acceleration" into explicit
measurements so calibration can be performed without hidden discretion.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from math import isfinite
from typing import Optional


class MoveSide(str, Enum):
    LONG = "LONG"
    SHORT = "SHORT"


@dataclass(frozen=True)
class Candle:
    open: float
    high: float
    low: float
    close: float

    def __post_init__(self):
        vals = (self.open, self.high, self.low, self.close)
        if not all(isfinite(x) for x in vals):
            raise ValueError("candle prices must be finite")
        if self.high < self.low:
            raise ValueError("high must be >= low")
        if self.high < max(self.open, self.close):
            raise ValueError("high cannot be below open/close")
        if self.low > min(self.open, self.close):
            raise ValueError("low cannot be above open/close")


@dataclass(frozen=True)
class CandleFeatures:
    range_size: float
    body_size: float
    upper_wick: float
    lower_wick: float
    body_fraction: float
    upper_wick_fraction: float
    lower_wick_fraction: float
    close_location_0_to_1: float


def candle_features(candle: Candle) -> CandleFeatures:
    """Return exact geometric features; close location 0=low, 1=high."""
    r = candle.high - candle.low
    body = abs(candle.close - candle.open)
    upper = candle.high - max(candle.open, candle.close)
    lower = min(candle.open, candle.close) - candle.low
    if r == 0:
        return CandleFeatures(0.0, body, 0.0, 0.0, 0.0, 0.0, 0.0, 0.5)
    return CandleFeatures(
        range_size=r,
        body_size=body,
        upper_wick=upper,
        lower_wick=lower,
        body_fraction=body / r,
        upper_wick_fraction=upper / r,
        lower_wick_fraction=lower / r,
        close_location_0_to_1=(candle.close - candle.low) / r,
    )


@dataclass(frozen=True)
class DojiConfig:
    max_body_fraction: float

    def __post_init__(self):
        if not 0.0 <= self.max_body_fraction <= 1.0:
            raise ValueError("max_body_fraction must be within [0, 1]")


def is_doji_like(candle: Candle, config: DojiConfig) -> bool:
    """Parameterized doji veto. Threshold remains a calibration input."""
    f = candle_features(candle)
    if f.range_size == 0:
        return True
    return f.body_fraction <= config.max_body_fraction


@dataclass(frozen=True)
class MomentumObservation:
    side: MoveSide
    push_distance: float
    elapsed_seconds: float
    recoil_distance: float
    live_candle: Candle
    previous_push_distance: Optional[float] = None

    def __post_init__(self):
        if self.push_distance <= 0 or not isfinite(self.push_distance):
            raise ValueError("push_distance must be finite and > 0")
        if self.elapsed_seconds <= 0 or not isfinite(self.elapsed_seconds):
            raise ValueError("elapsed_seconds must be finite and > 0")
        if self.recoil_distance < 0 or not isfinite(self.recoil_distance):
            raise ValueError("recoil_distance must be finite and >= 0")
        if self.previous_push_distance is not None and (
            self.previous_push_distance <= 0 or not isfinite(self.previous_push_distance)
        ):
            raise ValueError("previous_push_distance must be finite and > 0 when supplied")


@dataclass(frozen=True)
class MomentumFeatures:
    push_distance: float
    speed: float
    recoil_fraction: float
    body_fraction: float
    rejection_wick_fraction: float
    hold_near_favorable_extreme: float
    acceleration_ratio: Optional[float]


def momentum_features(obs: MomentumObservation) -> MomentumFeatures:
    """Translate a live push into direction-normalized measurements.

    Larger `hold_near_favorable_extreme` is better for either side.
    Larger `rejection_wick_fraction` means more wick rejection against continuation.
    """
    cf = candle_features(obs.live_candle)
    recoil_fraction = obs.recoil_distance / obs.push_distance

    if obs.side == MoveSide.LONG:
        rejection = cf.upper_wick_fraction
        hold = cf.close_location_0_to_1
    else:
        rejection = cf.lower_wick_fraction
        hold = 1.0 - cf.close_location_0_to_1

    acceleration = None
    if obs.previous_push_distance is not None:
        acceleration = obs.push_distance / obs.previous_push_distance

    return MomentumFeatures(
        push_distance=obs.push_distance,
        speed=obs.push_distance / obs.elapsed_seconds,
        recoil_fraction=recoil_fraction,
        body_fraction=cf.body_fraction,
        rejection_wick_fraction=rejection,
        hold_near_favorable_extreme=hold,
        acceleration_ratio=acceleration,
    )
