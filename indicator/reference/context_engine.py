"""Canonical persistent market-context state for Slumdawg V2.

This module is the semantic oracle for BIG DIRECTION and CURRENT MOVE.
It intentionally uses persistent protected structure rather than a weighted
per-bar vote. Numeric pivot extraction remains a platform adapter concern.
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
    """Persistent higher-timeframe direction with a protected structure level.

    A countertrend rally/selloff does not flip BIG DIRECTION. Reversal requires:
    1) the protected structure to be closed through;
    2) opposite 4H structure to be confirmed; and
    3) Daily not to remain clearly opposed.
    """

    def __init__(self) -> None:
        self.direction = Dir.UNKNOWN
        self.protected_level: Optional[float] = None
        self.reason = "BUILDING_STRUCTURE"

    def update(self, h4: StructureSnapshot, daily: Optional[StructureSnapshot] = None) -> Dir:
        h4_dir = h4.clear_direction
        d_dir = daily.clear_direction if daily is not None else Dir.UNKNOWN

        if self.direction == Dir.UNKNOWN:
            if h4_dir != Dir.UNKNOWN and d_dir != -h4_dir:
                self.direction = h4_dir
                self.protected_level = h4.low0 if h4_dir == Dir.UP else h4.high0
                self.reason = "INITIALIZED_FROM_CONFIRMED_4H_STRUCTURE"
            elif h4_dir == Dir.UNKNOWN and d_dir != Dir.UNKNOWN:
                self.direction = d_dir
                self.protected_level = h4.low0 if d_dir == Dir.UP else h4.high0
                self.reason = "INITIALIZED_FROM_DAILY_WITH_4H_UNCLEAR"
            else:
                self.reason = "HTF_CONFLICT_OR_INSUFFICIENT_STRUCTURE"
            return self.direction

        if self.direction == Dir.DOWN:
            # A newly confirmed lower high becomes the bearish protected high.
            if h4_dir == Dir.DOWN:
                self.protected_level = h4.high0
                self.reason = "BEARISH_STRUCTURE_PERSISTS"
                return self.direction
            invalidated = self.protected_level is not None and h4.close > self.protected_level
            if invalidated and h4_dir == Dir.UP and d_dir != Dir.DOWN:
                self.direction = Dir.UP
                self.protected_level = h4.low0
                self.reason = "BEARISH_PROTECTED_HIGH_BROKEN_AND_BULLISH_STRUCTURE_CONFIRMED"
            else:
                self.reason = "BEARISH_STATE_PERSISTS_THROUGH_PULLBACK"
            return self.direction

        # Existing bullish state.
        if h4_dir == Dir.UP:
            self.protected_level = h4.low0
            self.reason = "BULLISH_STRUCTURE_PERSISTS"
            return self.direction
        invalidated = self.protected_level is not None and h4.close < self.protected_level
        if invalidated and h4_dir == Dir.DOWN and d_dir != Dir.UP:
            self.direction = Dir.DOWN
            self.protected_level = h4.high0
            self.reason = "BULLISH_PROTECTED_LOW_BROKEN_AND_BEARISH_STRUCTURE_CONFIRMED"
        else:
            self.reason = "BULLISH_STATE_PERSISTS_THROUGH_PULLBACK"
        return self.direction


class PersistentCurrentMove:
    """15-minute active leg using break-of-structure persistence.

    A small bounce inside a bearish leg does not turn CURRENT MOVE up. The leg
    flips only after price closes beyond the latest confirmed opposing swing.
    """

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
