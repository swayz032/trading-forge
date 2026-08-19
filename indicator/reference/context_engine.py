"""Canonical persistent market-context state for Slumdawg V2.

This module is the semantic oracle for BIG DIRECTION and CURRENT MOVE.
BIG DIRECTION means the persistent larger-market regime, not the strongest recent
countertrend leg. Platform adapters are responsible for feeding a *major* 4H
snapshot (slower pivots than the 15m execution structure) plus Daily structure.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum
from math import isfinite
from typing import Optional


class Dir(IntEnum):
    DOWN = -1
    UNKNOWN = 0
    UP = 1


@dataclass(frozen=True)
class StructureSnapshot:
    close: float
    high0: float
    high1: float
    low0: float
    low1: float

    def __post_init__(self) -> None:
        values = (self.close, self.high0, self.high1, self.low0, self.low1)
        if not all(isfinite(v) and v > 0 for v in values):
            raise ValueError("structure snapshot prices must be finite and positive")
        if self.low0 >= self.high0 or self.low1 >= self.high1:
            raise ValueError("each swing low must be below its paired swing high")

    @property
    def clear_direction(self) -> Dir:
        if self.high0 > self.high1 and self.low0 > self.low1:
            return Dir.UP
        if self.high0 < self.high1 and self.low0 < self.low1:
            return Dir.DOWN
        return Dir.UNKNOWN


@dataclass(frozen=True)
class ContextState:
    big_direction: Dir
    current_move: Dir
    protected_level: Optional[float]
    big_reason: str
    move_reason: str


class PersistentBigDirection:
    """Persistent macro regime with protected higher-timeframe structure.

    Hierarchy:
    - clear Daily structure is the macro authority;
    - major 4H structure is the fallback when Daily is not yet clear;
    - a countertrend 4H rally/selloff never flips a clear Daily macro regime;
    - once initialized, reversal requires a protected-level close-through *and*
      confirmed opposite macro structure. A PWH/PDH touch may be context, but it
      is never by itself a direction flip.
    """

    def __init__(self) -> None:
        self.direction = Dir.UNKNOWN
        self.protected_level: Optional[float] = None
        self.authority = "NONE"
        self.reason = "BUILDING_STRUCTURE"

    @staticmethod
    def _protected(snapshot: StructureSnapshot, direction: Dir) -> float:
        return snapshot.low0 if direction == Dir.UP else snapshot.high0

    def update(self, h4: StructureSnapshot, daily: Optional[StructureSnapshot] = None) -> Dir:
        h4_dir = h4.clear_direction
        d_dir = daily.clear_direction if daily is not None else Dir.UNKNOWN

        # Seed from the slowest clear structure. This is the key distinction
        # between "big bullish pullback" and "bullish macro market".
        if self.direction == Dir.UNKNOWN:
            if d_dir != Dir.UNKNOWN and daily is not None:
                self.direction = d_dir
                self.protected_level = self._protected(daily, d_dir)
                self.authority = "DAILY"
                self.reason = "INITIALIZED_FROM_DAILY_MACRO_STRUCTURE"
            elif h4_dir != Dir.UNKNOWN:
                self.direction = h4_dir
                self.protected_level = self._protected(h4, h4_dir)
                self.authority = "4H_MAJOR"
                self.reason = "INITIALIZED_FROM_MAJOR_4H_STRUCTURE"
            else:
                self.reason = "HTF_STRUCTURE_BUILDING"
            return self.direction

        if self.direction == Dir.DOWN:
            # A still-bearish Daily structure is authoritative even if 4H is
            # temporarily HH/HL during a large countertrend rally.
            if d_dir == Dir.DOWN and daily is not None:
                self.protected_level = daily.high0
                self.authority = "DAILY"
                self.reason = "BEARISH_DAILY_MACRO_PERSISTS"
                return self.direction

            # If Daily is unclear, a major 4H lower-high/lower-low sequence may
            # refresh protection, but a local bullish 4H leg cannot flip alone.
            if d_dir == Dir.UNKNOWN and h4_dir == Dir.DOWN:
                self.protected_level = h4.high0
                self.authority = "4H_MAJOR"
                self.reason = "BEARISH_MAJOR_4H_STRUCTURE_PERSISTS"
                return self.direction

            invalidated = self.protected_level is not None and (
                (daily is not None and d_dir == Dir.UP and daily.close > self.protected_level)
                or (d_dir == Dir.UNKNOWN and h4_dir == Dir.UP and h4.close > self.protected_level)
            )
            opposite_confirmed = d_dir == Dir.UP or (d_dir == Dir.UNKNOWN and h4_dir == Dir.UP)
            if invalidated and opposite_confirmed:
                self.direction = Dir.UP
                source = daily if d_dir == Dir.UP and daily is not None else h4
                self.protected_level = source.low0
                self.authority = "DAILY" if d_dir == Dir.UP else "4H_MAJOR"
                self.reason = "BEARISH_MACRO_INVALIDATED_AND_BULLISH_STRUCTURE_CONFIRMED"
            else:
                self.reason = "BEARISH_MACRO_PERSISTS_THROUGH_BULLISH_PULLBACK"
            return self.direction

        # Existing bullish macro state.
        if d_dir == Dir.UP and daily is not None:
            self.protected_level = daily.low0
            self.authority = "DAILY"
            self.reason = "BULLISH_DAILY_MACRO_PERSISTS"
            return self.direction

        if d_dir == Dir.UNKNOWN and h4_dir == Dir.UP:
            self.protected_level = h4.low0
            self.authority = "4H_MAJOR"
            self.reason = "BULLISH_MAJOR_4H_STRUCTURE_PERSISTS"
            return self.direction

        invalidated = self.protected_level is not None and (
            (daily is not None and d_dir == Dir.DOWN and daily.close < self.protected_level)
            or (d_dir == Dir.UNKNOWN and h4_dir == Dir.DOWN and h4.close < self.protected_level)
        )
        opposite_confirmed = d_dir == Dir.DOWN or (d_dir == Dir.UNKNOWN and h4_dir == Dir.DOWN)
        if invalidated and opposite_confirmed:
            self.direction = Dir.DOWN
            source = daily if d_dir == Dir.DOWN and daily is not None else h4
            self.protected_level = source.high0
            self.authority = "DAILY" if d_dir == Dir.DOWN else "4H_MAJOR"
            self.reason = "BULLISH_MACRO_INVALIDATED_AND_BEARISH_STRUCTURE_CONFIRMED"
        else:
            self.reason = "BULLISH_MACRO_PERSISTS_THROUGH_BEARISH_PULLBACK"
        return self.direction


class PersistentCurrentMove:
    """15-minute active leg using break-of-structure persistence."""

    def __init__(self) -> None:
        self.direction = Dir.UNKNOWN
        self.reason = "BUILDING_15M_MOVE"

    def update(self, m15: StructureSnapshot) -> Dir:
        structural = m15.clear_direction
        if self.direction == Dir.UNKNOWN:
            if structural != Dir.UNKNOWN:
                self.direction = structural
                self.reason = "INITIALIZED_FROM_CONFIRMED_15M_STRUCTURE"
            elif m15.close > m15.high0:
                self.direction = Dir.UP
                self.reason = "INITIALIZED_FROM_BULLISH_15M_BOS"
            elif m15.close < m15.low0:
                self.direction = Dir.DOWN
                self.reason = "INITIALIZED_FROM_BEARISH_15M_BOS"
            return self.direction

        if self.direction == Dir.DOWN:
            if m15.close > m15.high0:
                self.direction = Dir.UP
                self.reason = "BULLISH_15M_BOS"
            else:
                self.reason = "BEARISH_LEG_PERSISTS_BELOW_LOWER_HIGH"
            return self.direction

        if m15.close < m15.low0:
            self.direction = Dir.DOWN
            self.reason = "BEARISH_15M_BOS"
        else:
            self.reason = "BULLISH_LEG_PERSISTS_ABOVE_HIGHER_LOW"
        return self.direction


class CanonicalContextEngine:
    def __init__(self) -> None:
        self.big = PersistentBigDirection()
        self.move = PersistentCurrentMove()

    def update(
        self,
        *,
        h4: StructureSnapshot,
        m15: StructureSnapshot,
        daily: Optional[StructureSnapshot] = None,
    ) -> ContextState:
        big_dir = self.big.update(h4, daily)
        move_dir = self.move.update(m15)
        return ContextState(
            big_direction=big_dir,
            current_move=move_dir,
            protected_level=self.big.protected_level,
            big_reason=self.big.reason,
            move_reason=self.move.reason,
        )


def relationship_label(big: Dir, move: Dir) -> str:
    if move == Dir.UNKNOWN:
        return "BUILDING 15M MOVE"
    if big == Dir.UNKNOWN:
        return "📈 UP MOVE" if move == Dir.UP else "📉 DOWN MOVE"
    if big == move:
        return "📈 UP WITH DIRECTION" if move == Dir.UP else "📉 DOWN WITH DIRECTION"
    return "📈 UP PULLBACK" if move == Dir.UP else "📉 DOWN PULLBACK"
