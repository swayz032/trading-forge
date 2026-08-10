"""Deterministic top-down trendline-family reference engine for Slumdawg.

This module encodes the *drawing and lifecycle* semantics only.  It does not claim
trading edge and it deliberately keeps calibration values outside the selector.

Source-derived drawing rules implemented here:
- bullish rays connect higher swing lows; bearish rays connect lower swing highs;
- analysis proceeds top-down;
- Point A/Point B establish a ray; lower-timeframe lines inherit the previous
  accepted Point B as their Point A;
- a line is not allowed to chase price after acceptance.

Slumdawg robustness overlay (not attributed to the source strategy):
- confirmed-swing / as-of gating to prevent future leak;
- parent/child lineage, duplicate-path rejection, immutable anchors;
- ACTIVE -> BREACHED -> VIOLATED close-confirmation state machine;
- operator repair changes VIOLATED slots only; untouched slots are byte-for-byte
  value-equal, and no replacement is forced when no qualified structure exists.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from enum import Enum
from math import isfinite
from typing import Iterable, Mapping, Optional, Sequence, Tuple


class TrendDirection(str, Enum):
    BULLISH = "BULLISH"
    BEARISH = "BEARISH"


class SwingKind(str, Enum):
    LOW = "LOW"
    HIGH = "HIGH"


class TrendTimeframe(str, Enum):
    DAILY = "1D"
    H4 = "4H"
    H1 = "1H"
    M15 = "15M"
    M5 = "5M"


TIMEFRAME_ORDER: Tuple[TrendTimeframe, ...] = (
    TrendTimeframe.DAILY,
    TrendTimeframe.H4,
    TrendTimeframe.H1,
    TrendTimeframe.M15,
    TrendTimeframe.M5,
)


class LineState(str, Enum):
    ACTIVE = "ACTIVE"
    BREACHED = "BREACHED"
    VIOLATED = "VIOLATED"
    REPLACED = "REPLACED"


def _finite_positive(name: str, value: float) -> None:
    if not isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be finite and > 0")


@dataclass(frozen=True)
class TrendSwing:
    timeframe: TrendTimeframe
    kind: SwingKind
    event_time: int
    confirmed_time: int
    price: float

    def __post_init__(self) -> None:
        if self.event_time < 0 or self.confirmed_time < self.event_time:
            raise ValueError("swing times must satisfy 0 <= event_time <= confirmed_time")
        _finite_positive("swing price", self.price)


@dataclass(frozen=True)
class TrendAnchor:
    source_timeframe: TrendTimeframe
    kind: SwingKind
    event_time: int
    confirmed_time: int
    price: float

    @classmethod
    def from_swing(cls, swing: TrendSwing) -> "TrendAnchor":
        return cls(
            source_timeframe=swing.timeframe,
            kind=swing.kind,
            event_time=swing.event_time,
            confirmed_time=swing.confirmed_time,
            price=swing.price,
        )

    def __post_init__(self) -> None:
        if self.event_time < 0 or self.confirmed_time < self.event_time:
            raise ValueError("anchor times must satisfy 0 <= event_time <= confirmed_time")
        _finite_positive("anchor price", self.price)


@dataclass(frozen=True)
class Trendline:
    line_id: str
    direction: TrendDirection
    timeframe: TrendTimeframe
    anchor_a: TrendAnchor
    anchor_b: TrendAnchor
    parent_line_id: Optional[str] = None
    parent_revision: Optional[int] = None
    revision: int = 1
    state: LineState = LineState.ACTIVE
    breach_streak: int = 0
    last_evaluated_time: Optional[int] = None

    def __post_init__(self) -> None:
        if not self.line_id:
            raise ValueError("line_id required")
        if self.anchor_b.event_time <= self.anchor_a.event_time:
            raise ValueError("Point B must occur after Point A")
        expected_kind = SwingKind.LOW if self.direction == TrendDirection.BULLISH else SwingKind.HIGH
        if self.anchor_a.kind != expected_kind or self.anchor_b.kind != expected_kind:
            raise ValueError("anchor kind does not match trendline direction")
        if self.direction == TrendDirection.BULLISH and self.anchor_b.price <= self.anchor_a.price:
            raise ValueError("bullish Point B must be a higher low than Point A")
        if self.direction == TrendDirection.BEARISH and self.anchor_b.price >= self.anchor_a.price:
            raise ValueError("bearish Point B must be a lower high than Point A")
        if self.parent_line_id is None and self.parent_revision is not None:
            raise ValueError("parent_revision requires parent_line_id")
        if self.parent_line_id == self.line_id:
            raise ValueError("trendline cannot parent itself")
        if self.revision < 1 or self.breach_streak < 0:
            raise ValueError("revision must be >=1 and breach_streak non-negative")

    def price_at(self, event_time: int) -> float:
        dt = self.anchor_b.event_time - self.anchor_a.event_time
        return self.anchor_a.price + (
            (event_time - self.anchor_a.event_time) / dt
        ) * (self.anchor_b.price - self.anchor_a.price)

    @property
    def signature(self) -> tuple:
        return (
            self.direction,
            self.timeframe,
            self.anchor_a.event_time,
            self.anchor_a.price,
            self.anchor_b.event_time,
            self.anchor_b.price,
        )


@dataclass(frozen=True)
class TrendlineSelectorConfig:
    root_swing_window: int
    touch_tolerance: float
    min_parent_separation: float

    def __post_init__(self) -> None:
        if self.root_swing_window < 2:
            raise ValueError("root_swing_window must be >= 2")
        if not isfinite(self.touch_tolerance) or self.touch_tolerance < 0:
            raise ValueError("touch_tolerance must be finite and >= 0")
        if not isfinite(self.min_parent_separation) or self.min_parent_separation < 0:
            raise ValueError("min_parent_separation must be finite and >= 0")


@dataclass(frozen=True)
class ViolationConfig:
    penetration: float
    required_consecutive_closes: int = 2

    def __post_init__(self) -> None:
        if not isfinite(self.penetration) or self.penetration < 0:
            raise ValueError("penetration must be finite and >= 0")
        if self.required_consecutive_closes < 1:
            raise ValueError("required_consecutive_closes must be >= 1")


@dataclass(frozen=True)
class TrendlineBoard:
    lines: Tuple[Trendline, ...]
    hidden_line_ids: Tuple[str, ...] = ()
    history: Tuple[Trendline, ...] = ()

    def __post_init__(self) -> None:
        ids = [line.line_id for line in self.lines]
        if len(ids) != len(set(ids)):
            raise ValueError("active board line_id values must be unique")
        unknown_hidden = set(self.hidden_line_ids) - set(ids)
        if unknown_hidden:
            raise ValueError(f"hidden line ids not on board: {sorted(unknown_hidden)}")

    def line(self, line_id: str) -> Optional[Trendline]:
        return next((line for line in self.lines if line.line_id == line_id), None)

    def visible_lines(self) -> Tuple[Trendline, ...]:
        hidden = set(self.hidden_line_ids)
        return tuple(line for line in self.lines if line.line_id not in hidden)

    def set_visible(self, line_id: str, visible: bool) -> "TrendlineBoard":
        if self.line(line_id) is None:
            raise KeyError(line_id)
        hidden = set(self.hidden_line_ids)
        if visible:
            hidden.discard(line_id)
        else:
            hidden.add(line_id)
        return replace(self, hidden_line_ids=tuple(sorted(hidden)))


def _kind_for(direction: TrendDirection) -> SwingKind:
    return SwingKind.LOW if direction == TrendDirection.BULLISH else SwingKind.HIGH


def _slot_id(direction: TrendDirection, timeframe: TrendTimeframe) -> str:
    side = "G" if direction == TrendDirection.BULLISH else "R"
    return f"{side}-{timeframe.value}"


def _eligible(
    swings: Iterable[TrendSwing],
    timeframe: TrendTimeframe,
    direction: TrendDirection,
    as_of_time: int,
) -> list[TrendSwing]:
    kind = _kind_for(direction)
    out = [
        s
        for s in swings
        if s.timeframe == timeframe and s.kind == kind and s.confirmed_time <= as_of_time
    ]
    return sorted(out, key=lambda s: (s.event_time, s.confirmed_time, s.price))


def _line_value(a: TrendAnchor, b: TrendAnchor, event_time: int) -> float:
    dt = b.event_time - a.event_time
    if dt <= 0:
        raise ValueError("B must be after A")
    return a.price + ((event_time - a.event_time) / dt) * (b.price - a.price)


def _clean_pair(
    a: TrendAnchor,
    b: TrendAnchor,
    intervening: Sequence[TrendSwing],
    direction: TrendDirection,
    tolerance: float,
) -> bool:
    for swing in intervening:
        if not a.event_time < swing.event_time < b.event_time:
            continue
        line_price = _line_value(a, b, swing.event_time)
        if direction == TrendDirection.BULLISH and swing.price < line_price - tolerance:
            return False
        if direction == TrendDirection.BEARISH and swing.price > line_price + tolerance:
            return False
    return True


def _directional_b(a: TrendAnchor, swing: TrendSwing, direction: TrendDirection) -> bool:
    if swing.event_time <= a.event_time:
        return False
    if direction == TrendDirection.BULLISH:
        return swing.price > a.price
    return swing.price < a.price


def build_root_line(
    swings: Iterable[TrendSwing],
    direction: TrendDirection,
    timeframe: TrendTimeframe,
    as_of_time: int,
    config: TrendlineSelectorConfig,
    *,
    line_id: Optional[str] = None,
    min_b_time_exclusive: Optional[int] = None,
) -> Optional[Trendline]:
    """Build the highest-timeframe line from an extreme A and clean latest B.

    The bounded root window is an explicit platform approximation for the human
    phrase "lowest/highest visible point".  The window is calibration, not hidden
    certainty.
    """
    points = _eligible(swings, timeframe, direction, as_of_time)
    points = points[-config.root_swing_window :]
    if len(points) < 2:
        return None

    if direction == TrendDirection.BULLISH:
        a_swing = min(points, key=lambda p: (p.price, p.event_time, p.confirmed_time))
    else:
        a_swing = max(points, key=lambda p: (p.price, -p.event_time, -p.confirmed_time))
    a = TrendAnchor.from_swing(a_swing)

    candidates = [p for p in points if _directional_b(a, p, direction)]
    if min_b_time_exclusive is not None:
        candidates = [p for p in candidates if p.event_time > min_b_time_exclusive]

    for b_swing in sorted(candidates, key=lambda p: (p.event_time, p.confirmed_time), reverse=True):
        b = TrendAnchor.from_swing(b_swing)
        if _clean_pair(a, b, points, direction, config.touch_tolerance):
            return Trendline(
                line_id=line_id or _slot_id(direction, timeframe),
                direction=direction,
                timeframe=timeframe,
                anchor_a=a,
                anchor_b=b,
            )
    return None


def build_child_line(
    parent: Trendline,
    swings: Iterable[TrendSwing],
    timeframe: TrendTimeframe,
    as_of_time: int,
    config: TrendlineSelectorConfig,
    *,
    line_id: Optional[str] = None,
    min_b_time_exclusive: Optional[int] = None,
) -> Optional[Trendline]:
    """Build a child whose Point A is *exactly* the accepted parent's Point B."""
    if TIMEFRAME_ORDER.index(timeframe) <= TIMEFRAME_ORDER.index(parent.timeframe):
        raise ValueError("child timeframe must be lower than parent timeframe")

    direction = parent.direction
    points = _eligible(swings, timeframe, direction, as_of_time)
    a = parent.anchor_b  # exact identity is intentional: B(parent) -> A(child)
    candidates = [p for p in points if _directional_b(a, p, direction)]
    if min_b_time_exclusive is not None:
        candidates = [p for p in candidates if p.event_time > min_b_time_exclusive]

    for b_swing in sorted(candidates, key=lambda p: (p.event_time, p.confirmed_time), reverse=True):
        b = TrendAnchor.from_swing(b_swing)
        if not _clean_pair(a, b, points, direction, config.touch_tolerance):
            continue
        parent_price_at_b = parent.price_at(b.event_time)
        if abs(b.price - parent_price_at_b) < config.min_parent_separation:
            continue
        return Trendline(
            line_id=line_id or _slot_id(direction, timeframe),
            direction=direction,
            timeframe=timeframe,
            anchor_a=a,
            anchor_b=b,
            parent_line_id=parent.line_id,
            parent_revision=parent.revision,
        )
    return None


def build_family(
    swings_by_timeframe: Mapping[TrendTimeframe, Sequence[TrendSwing]],
    direction: TrendDirection,
    as_of_time: int,
    config: TrendlineSelectorConfig,
) -> Tuple[Trendline, ...]:
    """Build Daily -> 4H -> 1H -> 15M -> 5M, skipping unavailable layers."""
    daily = build_root_line(
        swings_by_timeframe.get(TrendTimeframe.DAILY, ()),
        direction,
        TrendTimeframe.DAILY,
        as_of_time,
        config,
    )
    if daily is None:
        return ()

    accepted = [daily]
    parent = daily
    for timeframe in TIMEFRAME_ORDER[1:]:
        child = build_child_line(
            parent,
            swings_by_timeframe.get(timeframe, ()),
            timeframe,
            as_of_time,
            config,
        )
        if child is not None:
            accepted.append(child)
            parent = child
    return tuple(accepted)


def build_board(
    swings_by_timeframe: Mapping[TrendTimeframe, Sequence[TrendSwing]],
    as_of_time: int,
    config: TrendlineSelectorConfig,
) -> TrendlineBoard:
    bullish = build_family(swings_by_timeframe, TrendDirection.BULLISH, as_of_time, config)
    bearish = build_family(swings_by_timeframe, TrendDirection.BEARISH, as_of_time, config)
    return TrendlineBoard(lines=tuple((*bullish, *bearish)))


def observe_completed_close(
    line: Trendline,
    close_time: int,
    close_price: float,
    config: ViolationConfig,
) -> Trendline:
    """Advance the line's source-timeframe close-confirmation state."""
    _finite_positive("close_price", close_price)
    if close_time < 0:
        raise ValueError("close_time must be >= 0")
    if line.last_evaluated_time is not None and close_time <= line.last_evaluated_time:
        return line
    if close_time <= line.anchor_b.confirmed_time:
        return line
    if line.state in (LineState.VIOLATED, LineState.REPLACED):
        return replace(line, last_evaluated_time=close_time)

    projected = line.price_at(close_time)
    beyond = (
        close_price < projected - config.penetration
        if line.direction == TrendDirection.BULLISH
        else close_price > projected + config.penetration
    )
    if beyond:
        streak = line.breach_streak + 1
        state = (
            LineState.VIOLATED
            if streak >= config.required_consecutive_closes
            else LineState.BREACHED
        )
        return replace(
            line,
            state=state,
            breach_streak=streak,
            last_evaluated_time=close_time,
        )

    return replace(
        line,
        state=LineState.ACTIVE,
        breach_streak=0,
        last_evaluated_time=close_time,
    )


def _nearest_parent(
    lines_by_id: Mapping[str, Trendline],
    direction: TrendDirection,
    timeframe: TrendTimeframe,
) -> Optional[Trendline]:
    idx = TIMEFRAME_ORDER.index(timeframe)
    for parent_tf in reversed(TIMEFRAME_ORDER[:idx]):
        parent = lines_by_id.get(_slot_id(direction, parent_tf))
        if parent is not None and parent.state not in (LineState.VIOLATED, LineState.REPLACED):
            return parent
    return None


def repair_violated(
    board: TrendlineBoard,
    swings_by_timeframe: Mapping[TrendTimeframe, Sequence[TrendSwing]],
    as_of_time: int,
    config: TrendlineSelectorConfig,
) -> TrendlineBoard:
    """Repair only violated slots, top-down, without moving valid geometry."""
    by_id = {line.line_id: line for line in board.lines}
    history = list(board.history)

    for direction in (TrendDirection.BULLISH, TrendDirection.BEARISH):
        for timeframe in TIMEFRAME_ORDER:
            slot = _slot_id(direction, timeframe)
            old = by_id.get(slot)
            if old is None or old.state != LineState.VIOLATED:
                continue

            if timeframe == TrendTimeframe.DAILY:
                candidate = build_root_line(
                    swings_by_timeframe.get(timeframe, ()),
                    direction,
                    timeframe,
                    as_of_time,
                    config,
                    line_id=slot,
                    min_b_time_exclusive=old.anchor_b.event_time,
                )
            else:
                parent = _nearest_parent(by_id, direction, timeframe)
                candidate = None if parent is None else build_child_line(
                    parent,
                    swings_by_timeframe.get(timeframe, ()),
                    timeframe,
                    as_of_time,
                    config,
                    line_id=slot,
                    min_b_time_exclusive=old.anchor_b.event_time,
                )

            if candidate is None or candidate.signature == old.signature:
                continue

            history.append(replace(old, state=LineState.REPLACED))
            by_id[slot] = replace(
                candidate,
                revision=old.revision + 1,
                state=LineState.ACTIVE,
                breach_streak=0,
                last_evaluated_time=None,
            )

    original_order = [line.line_id for line in board.lines]
    repaired_lines = tuple(by_id[line_id] for line_id in original_order)
    return TrendlineBoard(
        lines=repaired_lines,
        hidden_line_ids=board.hidden_line_ids,
        history=tuple(history),
    )
