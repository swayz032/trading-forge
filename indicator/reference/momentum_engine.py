"""Reference 5-minute momentum state machine.

Platform-agnostic semantic oracle for Pine/FXR parity.
This is not a broker/execution engine and not a profitability claim.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from enum import Enum
from math import isfinite
from typing import Optional, List, Tuple, Any, Dict


class Side(str, Enum):
    LONG = "LONG"
    SHORT = "SHORT"


class Stage(str, Enum):
    WAIT_BREAK = "WAIT_BREAK"
    BREAK = "BREAK"
    PUSH_1 = "PUSH_1"
    ENTRY_READY = "ENTRY_READY"


@dataclass(frozen=True)
class MomentumConfig:
    # Engine units only. Production values MUST come from calibration.
    min_break: float
    min_push: float
    max_recoil: float
    max_push_seconds: float


@dataclass(frozen=True)
class TickEvent:
    bar_id: int
    event_id: int
    event_time: float
    price: float


@dataclass
class Transition:
    code: str
    bar_id: int
    event_id: Optional[int]
    price: Optional[float]
    detail: str = ""


class MomentumEngine:
    """Deterministic reference engine.

    Invariants:
    - one event -> at most one stage advance
    - stale/duplicate/out-of-order events fail closed
    - new bar promotes prior completed extreme to reference and resets live chain
    - a single giant price jump cannot manufacture multiple confirmations
    """

    def __init__(self, side: Side, config: MomentumConfig):
        self.side = Side(side)
        self.config = config
        self.stage = Stage.WAIT_BREAK
        self.bar_id: Optional[int] = None
        self.reference: Optional[float] = None
        self.anchor: Optional[float] = None
        self.current_low = float("inf")
        self.current_high = float("-inf")
        self.last_event_id: Optional[int] = None
        self.last_event_time: Optional[float] = None
        self.last_stage_time: Optional[float] = None
        self.symbol: Optional[str] = None
        self.transitions: List[Transition] = []
        self.errors: List[Tuple[str, Optional[int]]] = []
        self.entry_count = 0

    @property
    def direction(self) -> int:
        return 1 if self.side == Side.LONG else -1

    def _fav(self, price: float) -> float:
        return self.direction * price

    def arm_reference(self, reference_price: float, bar_id: int, symbol: str) -> None:
        if not isfinite(reference_price) or reference_price <= 0:
            raise ValueError("reference_price must be finite and positive")
        self.reference = reference_price
        self.anchor = reference_price
        self.bar_id = bar_id
        self.symbol = symbol
        self.stage = Stage.WAIT_BREAK
        self.current_low = float("inf")
        self.current_high = float("-inf")
        self.last_event_id = None
        self.last_event_time = None
        self.last_stage_time = None
        self.transitions.append(Transition("REFERENCE_ARMED", bar_id, None, reference_price))

    def on_symbol_change(self, symbol: str) -> None:
        if self.symbol is not None and symbol == self.symbol:
            return
        self.symbol = symbol
        self.stage = Stage.WAIT_BREAK
        self.reference = None
        self.anchor = None
        self.current_low = float("inf")
        self.current_high = float("-inf")
        self.last_event_id = None
        self.last_event_time = None
        self.last_stage_time = None
        self.transitions.append(Transition("SYMBOL_RESET", self.bar_id or -1, None, None, symbol))

    def _promote_finished_bar(self, new_bar_id: int) -> None:
        if self.current_low != float("inf"):
            self.reference = self.current_high if self.side == Side.LONG else self.current_low
            self.anchor = self.reference
        self.stage = Stage.WAIT_BREAK
        self.bar_id = new_bar_id
        self.current_low = float("inf")
        self.current_high = float("-inf")
        self.last_stage_time = None
        self.transitions.append(
            Transition("BAR_RESET", new_bar_id, None, self.reference, "finished-bar extreme promoted")
        )

    def on_tick(self, event: TickEvent) -> Optional[str]:
        if not isfinite(event.price) or event.price <= 0:
            self.errors.append(("BAD_PRICE", event.event_id))
            return None

        if self.bar_id is None:
            self.bar_id = event.bar_id

        if event.bar_id < self.bar_id:
            self.errors.append(("OLD_BAR", event.event_id))
            return None

        if event.bar_id > self.bar_id:
            self._promote_finished_bar(event.bar_id)

        if self.last_event_time is not None and event.event_time < self.last_event_time:
            self.errors.append(("OUT_OF_ORDER_TIME", event.event_id))
            return None

        if self.last_event_id is not None and event.event_id <= self.last_event_id:
            self.errors.append(("DUP_OR_OLD_EVENT", event.event_id))
            return None

        self.last_event_time = event.event_time
        self.last_event_id = event.event_id
        self.current_low = min(self.current_low, event.price)
        self.current_high = max(self.current_high, event.price)

        if self.reference is None or self.anchor is None:
            return None

        favorable = self._fav(event.price)
        reference_favorable = self._fav(self.reference)
        anchor_favorable = self._fav(self.anchor)

        if self.stage in (Stage.BREAK, Stage.PUSH_1):
            recoil = anchor_favorable - favorable
            if recoil >= self.config.max_recoil:
                self.stage = Stage.WAIT_BREAK
                self.anchor = self.reference
                self.last_stage_time = None
                self.transitions.append(
                    Transition("RECOIL_RESET", event.bar_id, event.event_id, event.price)
                )
                return "RECOIL_RESET"

        # Critical invariant: exactly one branch may advance per input event.
        if self.stage == Stage.WAIT_BREAK:
            if favorable >= reference_favorable + self.config.min_break:
                self.stage = Stage.BREAK
                self.anchor = event.price
                self.last_stage_time = event.event_time
                self.transitions.append(Transition("BREAK", event.bar_id, event.event_id, event.price))
                return "BREAK"
            return None

        if self.stage == Stage.BREAK:
            if favorable >= anchor_favorable + self.config.min_push:
                elapsed = event.event_time - (
                    self.last_stage_time if self.last_stage_time is not None else event.event_time
                )
                if elapsed > self.config.max_push_seconds:
                    self.transitions.append(
                        Transition("SLOW_PUSH", event.bar_id, event.event_id, event.price)
                    )
                    return "SLOW_PUSH"
                self.stage = Stage.PUSH_1
                self.anchor = event.price
                self.last_stage_time = event.event_time
                self.transitions.append(Transition("PUSH_1", event.bar_id, event.event_id, event.price))
                return "PUSH_1"
            return None

        if self.stage == Stage.PUSH_1:
            if favorable >= anchor_favorable + self.config.min_push:
                elapsed = event.event_time - (
                    self.last_stage_time if self.last_stage_time is not None else event.event_time
                )
                if elapsed > self.config.max_push_seconds:
                    self.transitions.append(
                        Transition("SLOW_PUSH_2", event.bar_id, event.event_id, event.price)
                    )
                    return "SLOW_PUSH_2"
                self.stage = Stage.ENTRY_READY
                self.anchor = event.price
                self.last_stage_time = event.event_time
                self.entry_count += 1
                self.transitions.append(
                    Transition("ENTRY_READY", event.bar_id, event.event_id, event.price)
                )
                return "ENTRY_READY"
            return None

        return None

    def snapshot(self) -> Dict[str, Any]:
        return {
            "side": self.side.value,
            "config": asdict(self.config),
            "stage": self.stage.value,
            "bar_id": self.bar_id,
            "reference": self.reference,
            "anchor": self.anchor,
            "current_low": self.current_low,
            "current_high": self.current_high,
            "last_event_id": self.last_event_id,
            "last_event_time": self.last_event_time,
            "last_stage_time": self.last_stage_time,
            "symbol": self.symbol,
            "transitions": [asdict(t) for t in self.transitions],
            "errors": list(self.errors),
            "entry_count": self.entry_count,
        }

    @classmethod
    def restore(cls, payload: Dict[str, Any]) -> "MomentumEngine":
        engine = cls(Side(payload["side"]), MomentumConfig(**payload["config"]))
        engine.stage = Stage(payload["stage"])
        engine.bar_id = payload["bar_id"]
        engine.reference = payload["reference"]
        engine.anchor = payload["anchor"]
        engine.current_low = payload["current_low"]
        engine.current_high = payload["current_high"]
        engine.last_event_id = payload["last_event_id"]
        engine.last_event_time = payload["last_event_time"]
        engine.last_stage_time = payload["last_stage_time"]
        engine.symbol = payload["symbol"]
        engine.transitions = [Transition(**t) for t in payload["transitions"]]
        engine.errors = [tuple(x) for x in payload["errors"]]
        engine.entry_count = payload["entry_count"]
        return engine
