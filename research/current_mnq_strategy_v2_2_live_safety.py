#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Protocol

TZ = "America/New_York"


class BrokerAdapter(Protocol):
    def get_open_position(self) -> int: ...
    def get_working_orders(self) -> list[dict]: ...
    def cancel_all(self) -> None: ...
    def flatten(self) -> None: ...


@dataclass
class SessionState:
    session: str
    traded: bool = False
    entry_order_id: str | None = None
    filled_qty: int = 0
    last_position: int = 0
    disabled: bool = False
    disable_reason: str | None = None


@dataclass(frozen=True)
class RiskLimits:
    max_contracts: int = 15
    max_daily_realized_unrealized_loss: float = 1200.0
    max_entry_slippage_points: float = 4.0
    max_data_age_seconds: float = 15.0


class PersistentOneTradeLock:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def load(self, session: str) -> SessionState:
        if not self.path.exists():
            return SessionState(session=session)
        data = json.loads(self.path.read_text())
        if data.get("session") != session:
            return SessionState(session=session)
        return SessionState(**data)

    def save(self, state: SessionState) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=self.path.name, dir=str(self.path.parent))
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(asdict(state), f, indent=2)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self.path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    def mark_trade(self, state: SessionState, order_id: str, qty: int) -> SessionState:
        if state.traded:
            raise RuntimeError("REFUSE_SECOND_TRADE")
        state.traded = True
        state.entry_order_id = order_id
        state.filled_qty = qty
        self.save(state)
        return state


def deterministic_client_order_id(session: str, side: str, signal_epoch_ms: int) -> str:
    return f"MNQV22-{session}-{side}-{signal_epoch_ms}"


def preflight_refuse_reasons(
    state: SessionState,
    broker_position: int,
    requested_qty: int,
    daily_realized_unrealized: float,
    feed_age_seconds: float,
    estimated_slippage_points: float,
    contract_identity_confirmed: bool,
    limits: RiskLimits = RiskLimits(),
) -> list[str]:
    reasons = []
    if state.disabled:
        reasons.append(f"DISABLED:{state.disable_reason}")
    if state.traded:
        reasons.append("ONE_TRADE_ALREADY_USED")
    if broker_position != 0:
        reasons.append("UNEXPECTED_OPEN_POSITION")
    if requested_qty <= 0 or requested_qty > limits.max_contracts:
        reasons.append("SIZE_LIMIT")
    if daily_realized_unrealized <= -abs(limits.max_daily_realized_unrealized_loss):
        reasons.append("DAILY_LOSS_KILL")
    if feed_age_seconds > limits.max_data_age_seconds:
        reasons.append("STALE_DATA")
    if estimated_slippage_points > limits.max_entry_slippage_points:
        reasons.append("SLIPPAGE_CIRCUIT_BREAKER")
    if not contract_identity_confirmed:
        reasons.append("CONTRACT_IDENTITY_AMBIGUOUS")
    return reasons


def reconcile_after_restart(lock: PersistentOneTradeLock, session: str, broker: BrokerAdapter) -> SessionState:
    state = lock.load(session)
    pos = int(broker.get_open_position())
    orders = broker.get_working_orders()
    if pos != 0:
        state.last_position = pos
        state.traded = True
        state.disabled = True
        state.disable_reason = "RESTART_WITH_OPEN_POSITION_REQUIRES_MANUAL_RECONCILIATION"
        lock.save(state)
        return state
    if state.traded and orders:
        state.disabled = True
        state.disable_reason = "RESTART_WITH_WORKING_ORDERS"
        lock.save(state)
    return state


def emergency_disable(lock: PersistentOneTradeLock, state: SessionState, reason: str, broker: BrokerAdapter | None = None) -> SessionState:
    state.disabled = True
    state.disable_reason = reason
    lock.save(state)
    if broker is not None:
        broker.cancel_all()
        broker.flatten()
    return state


class RefuseLiveWithoutBrokerAdapter:
    """Default production behavior: research code cannot place a live order."""

    def submit(self, *args, **kwargs):
        raise RuntimeError("LIVE_ORDER_REFUSED_NO_VALIDATED_BROKER_ADAPTER")
