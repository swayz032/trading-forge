"""Strict price-grid semantics for NQ/MNQ indicator calculations.

Never compare, store, or emit a tradable level without making the tick-grid policy
explicit. Decimal arithmetic avoids binary-float edge cases near 0.25-point ticks.

CME contract specification source (checked 2026-08-09): NQ and MNQ minimum tick
is 0.25 index points. Contract multipliers/tick values are intentionally kept out of
entry logic; this module is about price validity, not P&L.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_EVEN
from enum import Enum
from math import isfinite


class GridPolicy(str, Enum):
    REJECT = "REJECT"
    SNAP_HALF_EVEN = "SNAP_HALF_EVEN"


@dataclass(frozen=True)
class InstrumentPriceGrid:
    symbol_root: str
    tick_size: Decimal

    def __post_init__(self) -> None:
        if not self.symbol_root:
            raise ValueError("symbol_root required")
        if self.tick_size <= 0:
            raise ValueError("tick_size must be > 0")


NQ_GRID = InstrumentPriceGrid("NQ", Decimal("0.25"))
MNQ_GRID = InstrumentPriceGrid("MNQ", Decimal("0.25"))


def _d(value: float | str | Decimal) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):
        if not isfinite(value):
            raise ValueError("price must be finite")
        # str(value) is deliberate: preserve the human/feed decimal representation
        # rather than Decimal(float)'s binary expansion.
        return Decimal(str(value))
    return Decimal(str(value))


def is_on_grid(price: float | str | Decimal, grid: InstrumentPriceGrid) -> bool:
    p = _d(price)
    ticks = p / grid.tick_size
    return ticks == ticks.to_integral_value()


def snap_to_grid(price: float | str | Decimal, grid: InstrumentPriceGrid) -> Decimal:
    p = _d(price)
    ticks = (p / grid.tick_size).quantize(Decimal("1"), rounding=ROUND_HALF_EVEN)
    return ticks * grid.tick_size


def normalize_price(
    price: float | str | Decimal,
    grid: InstrumentPriceGrid,
    policy: GridPolicy = GridPolicy.REJECT,
) -> Decimal:
    p = _d(price)
    if is_on_grid(p, grid):
        return p
    if policy == GridPolicy.SNAP_HALF_EVEN:
        return snap_to_grid(p, grid)
    raise ValueError(f"OFF_TICK_GRID:{grid.symbol_root}:{p}")


def ticks_between(
    a: float | str | Decimal,
    b: float | str | Decimal,
    grid: InstrumentPriceGrid,
) -> int:
    pa = normalize_price(a, grid, GridPolicy.REJECT)
    pb = normalize_price(b, grid, GridPolicy.REJECT)
    ticks = (pb - pa) / grid.tick_size
    return int(ticks)
