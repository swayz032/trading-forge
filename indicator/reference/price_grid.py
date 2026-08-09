"""Strict price-grid semantics for NQ/MNQ indicator calculations.

Never compare, store, or emit a tradable level without making the tick-grid policy
explicit. Decimal arithmetic avoids binary-float edge cases near 0.25-point ticks.

CME contract specification source (checked 2026-08-09): NQ and MNQ minimum tick
is 0.25 index points. Contract multipliers/tick values are intentionally kept out of
entry logic; this module is about price validity, not P&L.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_EVEN
from enum import Enum
from math import isfinite


class GridPolicy(str, Enum):
    REJECT = "REJECT"
    SNAP_HALF_EVEN = "SNAP_HALF_EVEN"


class GridRounding(str, Enum):
    FLOOR = "FLOOR"
    CEILING = "CEILING"
    HALF_EVEN = "HALF_EVEN"


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


def round_to_grid(
    price: float | str | Decimal,
    grid: InstrumentPriceGrid,
    rounding: GridRounding,
) -> Decimal:
    p = _d(price)
    mode = {
        GridRounding.FLOOR: ROUND_FLOOR,
        GridRounding.CEILING: ROUND_CEILING,
        GridRounding.HALF_EVEN: ROUND_HALF_EVEN,
    }[GridRounding(rounding)]
    ticks = (p / grid.tick_size).quantize(Decimal("1"), rounding=mode)
    return ticks * grid.tick_size


def snap_to_grid(price: float | str | Decimal, grid: InstrumentPriceGrid) -> Decimal:
    return round_to_grid(price, grid, GridRounding.HALF_EVEN)


def proof_level_to_grid(
    price: float | str | Decimal,
    grid: InstrumentPriceGrid,
    *,
    trade_side: str,
) -> Decimal:
    """Round a proof level conservatively against fakeouts.

    LONG proof sits above current price -> ceil so rounding does not weaken proof.
    SHORT proof sits below current price -> floor so rounding does not weaken proof.
    """
    side = trade_side.upper()
    if side == "LONG":
        return round_to_grid(price, grid, GridRounding.CEILING)
    if side == "SHORT":
        return round_to_grid(price, grid, GridRounding.FLOOR)
    raise ValueError("trade_side must be LONG or SHORT")


def conservative_target_to_grid(
    price: float | str | Decimal,
    grid: InstrumentPriceGrid,
    *,
    trade_side: str,
) -> Decimal:
    """Round a TP toward the approaching trade, never deeper into the target pool.

    LONG approaches an upper pool from below -> floor target.
    SHORT approaches a lower pool from above -> ceil target.
    """
    side = trade_side.upper()
    if side == "LONG":
        return round_to_grid(price, grid, GridRounding.FLOOR)
    if side == "SHORT":
        return round_to_grid(price, grid, GridRounding.CEILING)
    raise ValueError("trade_side must be LONG or SHORT")


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
