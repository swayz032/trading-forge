"""Deterministic structural entry/proof selector for Slumdawg.

This module models the user-approved visual rule used for the yellow entry lines:
- LONG proof is the highest price among the recent confirmed swing-high candidates.
- SHORT proof is the lowest price among the recent confirmed swing-low candidates.
- Only confirmed swings are eligible; the detector is responsible for no-future-leak confirmation.
- The number of recent swings remembered per side is an explicit calibration input.

This is a structural candidate selector, not an edge claim and not a complete entry signal.
The 5-minute reference/BREAK/PUSH sequence still owns actual ENTRY_READY semantics.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional, Sequence, Tuple

from indicator.reference.price_grid import InstrumentPriceGrid, MNQ_GRID, proof_level_to_grid
from indicator.reference.swing_detector import SwingKind, SwingPoint


@dataclass(frozen=True)
class EntrySelectorConfig:
    swing_memory_per_side: int = 8

    def __post_init__(self) -> None:
        if self.swing_memory_per_side < 1:
            raise ValueError("swing_memory_per_side must be >= 1")


@dataclass(frozen=True)
class EntryProofPair:
    long_raw: Optional[float]
    short_raw: Optional[float]
    long_price: Optional[float]
    short_price: Optional[float]
    long_source_bar_id: Optional[int]
    short_source_bar_id: Optional[int]
    reason: str


def _recent_by_kind(
    points: Iterable[SwingPoint],
    kind: SwingKind,
    memory: int,
) -> Sequence[SwingPoint]:
    eligible = [p for p in points if p.kind == kind]
    eligible.sort(key=lambda p: (p.confirmed_bar_id, p.pivot_bar_id), reverse=True)
    return eligible[:memory]


def select_outer_swing_entry_pair(
    points: Iterable[SwingPoint],
    config: EntrySelectorConfig = EntrySelectorConfig(),
    price_grid: InstrumentPriceGrid = MNQ_GRID,
) -> EntryProofPair:
    """Select the outer structural swing boundaries from recent confirmed pivots.

    The rule intentionally does *not* use the nearest wick. It takes the highest
    confirmed swing-high candidate and the lowest confirmed swing-low candidate from
    the recent structural memory. This mirrors the user's approved examples where
    price is bracketed by a meaningful upper swing-high wick and lower swing-low wick.
    """
    pts = tuple(points)
    highs = _recent_by_kind(pts, SwingKind.HIGH, config.swing_memory_per_side)
    lows = _recent_by_kind(pts, SwingKind.LOW, config.swing_memory_per_side)

    long_point = max(highs, key=lambda p: (p.price, -p.pivot_bar_id), default=None)
    short_point = min(lows, key=lambda p: (p.price, p.pivot_bar_id), default=None)

    long_raw = None if long_point is None else float(long_point.price)
    short_raw = None if short_point is None else float(short_point.price)

    long_price = (
        None
        if long_raw is None
        else float(proof_level_to_grid(long_raw, price_grid, trade_side="LONG"))
    )
    short_price = (
        None
        if short_raw is None
        else float(proof_level_to_grid(short_raw, price_grid, trade_side="SHORT"))
    )

    if long_point is None and short_point is None:
        reason = "NO_CONFIRMED_SWINGS"
    elif long_point is None:
        reason = "SHORT_ONLY_CONFIRMED"
    elif short_point is None:
        reason = "LONG_ONLY_CONFIRMED"
    else:
        reason = "OUTER_CONFIRMED_SWING_PAIR"

    return EntryProofPair(
        long_raw=long_raw,
        short_raw=short_raw,
        long_price=long_price,
        short_price=short_price,
        long_source_bar_id=None if long_point is None else long_point.pivot_bar_id,
        short_source_bar_id=None if short_point is None else short_point.pivot_bar_id,
        reason=reason,
    )
