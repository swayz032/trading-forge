"""Research-gated candle-quality and early-momentum classification for Slumdawg V2.

Pattern names are presentation labels only. Decisions are based on measurable
candle geometry, structure crossing, and room to the next qualified target.
"""
from __future__ import annotations

from dataclasses import dataclass
from math import isfinite
from typing import Optional

from indicator.reference.candle_features import Candle, candle_features


@dataclass(frozen=True)
class CandleQualityConfig:
    doji_max_body_fraction: float
    rejection_min_wick_fraction: float
    strong_body_fraction: float
    strong_displacement_atr: float
    favorable_close_fraction: float
    max_rejection_wick_fraction: float
    min_room_atr: float

    def __post_init__(self) -> None:
        vals = (
            self.doji_max_body_fraction,
            self.rejection_min_wick_fraction,
            self.strong_body_fraction,
            self.strong_displacement_atr,
            self.favorable_close_fraction,
            self.max_rejection_wick_fraction,
            self.min_room_atr,
        )
        if not all(isfinite(v) for v in vals):
            raise ValueError("candle quality config must be finite")
        for name, value in (
            ("doji_max_body_fraction", self.doji_max_body_fraction),
            ("rejection_min_wick_fraction", self.rejection_min_wick_fraction),
            ("strong_body_fraction", self.strong_body_fraction),
            ("favorable_close_fraction", self.favorable_close_fraction),
            ("max_rejection_wick_fraction", self.max_rejection_wick_fraction),
        ):
            if not 0 <= value <= 1:
                raise ValueError(f"{name} must be within [0,1]")
        if self.strong_displacement_atr <= 0 or self.min_room_atr < 0:
            raise ValueError("ATR-normalized thresholds out of range")


@dataclass(frozen=True)
class CandleQualityDecision:
    label: str
    strong_engulf: bool
    rejection_sequence: bool
    momentum_entry_candidate: bool
    reason: str


def _body_engulfs(current: Candle, previous: Candle, side: str) -> bool:
    prev_top = max(previous.open, previous.close)
    prev_bottom = min(previous.open, previous.close)
    if side == "SHORT":
        return current.close < current.open and current.open >= prev_top and current.close <= prev_bottom
    if side == "LONG":
        return current.close > current.open and current.close >= prev_top and current.open <= prev_bottom
    raise ValueError("side must be LONG or SHORT")


def classify_candle_quality(
    *,
    side: str,
    current: Candle,
    previous: Candle,
    two_back: Candle,
    proof_level: float,
    target_price: Optional[float],
    atr: float,
    config: CandleQualityConfig,
) -> CandleQualityDecision:
    if side not in {"LONG", "SHORT"}:
        raise ValueError("side must be LONG or SHORT")
    if not isfinite(proof_level) or proof_level <= 0:
        raise ValueError("proof_level must be finite and positive")
    if not isfinite(atr) or atr <= 0:
        raise ValueError("atr must be finite and positive")

    cf = candle_features(current)
    pf = candle_features(previous)
    tf = candle_features(two_back)

    doji_two_back = tf.range_size == 0 or tf.body_fraction <= config.doji_max_body_fraction
    rejection_previous = max(pf.upper_wick_fraction, pf.lower_wick_fraction) >= config.rejection_min_wick_fraction
    engulf = _body_engulfs(current, previous, side)
    displacement_ok = cf.range_size >= atr * config.strong_displacement_atr
    body_ok = cf.body_fraction >= config.strong_body_fraction

    if side == "SHORT":
        close_quality = (1.0 - cf.close_location_0_to_1) >= config.favorable_close_fraction
        rejection_ok = cf.lower_wick_fraction <= config.max_rejection_wick_fraction
        proof_cross = current.close < proof_level
        sequence_break = current.close < min(previous.low, two_back.low)
        room = proof_level - target_price if target_price is not None else None
    else:
        close_quality = cf.close_location_0_to_1 >= config.favorable_close_fraction
        rejection_ok = cf.upper_wick_fraction <= config.max_rejection_wick_fraction
        proof_cross = current.close > proof_level
        sequence_break = current.close > max(previous.high, two_back.high)
        room = target_price - proof_level if target_price is not None else None

    room_ok = room is not None and room > 0 and room >= atr * config.min_room_atr
    strong_engulf = engulf and displacement_ok and body_ok and close_quality and rejection_ok
    rejection_sequence = doji_two_back and rejection_previous and strong_engulf and sequence_break
    momentum_candidate = strong_engulf and proof_cross and room_ok

    if rejection_sequence and momentum_candidate:
        return CandleQualityDecision(
            "🕯️ REJECTION -> ENGULF",
            True,
            True,
            True,
            "STRUCTURE_CROSS_STRONG_ENGULF_REJECTION_SEQUENCE_AND_ROOM",
        )
    if momentum_candidate:
        return CandleQualityDecision(
            "⚡ STRONG ENGULF",
            True,
            False,
            True,
            "STRUCTURE_CROSS_STRONG_ENGULF_AND_ROOM",
        )
    if rejection_sequence:
        return CandleQualityDecision(
            "🕯️ REJECTION -> ENGULF",
            True,
            True,
            False,
            "PATTERN_PRESENT_BUT_EARLY_ENTRY_GATES_NOT_COMPLETE",
        )
    if strong_engulf:
        return CandleQualityDecision(
            "⚡ STRONG ENGULF",
            True,
            False,
            False,
            "STRONG_ENGULF_PRESENT_BUT_STRUCTURE_OR_ROOM_GATE_FAILED",
        )
    if doji_two_back:
        return CandleQualityDecision("🕯️ DOJI / INDECISION", False, False, False, "DOJI_CONTEXT_ONLY")
    if rejection_previous:
        return CandleQualityDecision("🕯️ REJECTION", False, False, False, "REJECTION_CONTEXT_ONLY")
    return CandleQualityDecision("NONE / WAIT", False, False, False, "NO_QUALIFIED_CANDLE_SEQUENCE")
