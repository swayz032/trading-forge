#!/usr/bin/env python3
"""Crash-safe one-trade-per-session state for MNQ v2.3.

The daily bullet is reserved BEFORE an order API call. A crash after reservation
therefore cannot silently create a second order. Restart reconciliation must
resolve the reservation/customTag before anything else can be armed.
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from enum import Enum
from pathlib import Path


class TradePhase(str, Enum):
    EMPTY = "EMPTY"
    RESERVED = "RESERVED"
    SUBMITTED = "SUBMITTED"
    PARTIAL = "PARTIAL"
    FILLED = "FILLED"
    CLOSED = "CLOSED"
    DISABLED = "DISABLED"


@dataclass
class SessionLedger:
    schema_version: int
    session: str
    phase: str = TradePhase.EMPTY.value
    custom_tag: str | None = None
    broker_order_id: str | None = None
    requested_qty: int = 0
    filled_qty: int = 0
    last_position: int = 0
    disabled_reason: str | None = None
    sequence: int = 0

    @property
    def bullet_consumed(self) -> bool:
        return self.phase != TradePhase.EMPTY.value

    @property
    def disabled(self) -> bool:
        return self.phase == TradePhase.DISABLED.value


def _canonical(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def _checksum(payload: dict) -> str:
    return hashlib.sha256(_canonical(payload)).hexdigest()


@contextmanager
def _file_lock(path: Path):
    """Cross-platform advisory lock using a dedicated lock file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    f = path.open("a+b")
    try:
        if os.name == "nt":
            import msvcrt
            f.seek(0)
            if f.tell() == 0:
                f.write(b"0")
                f.flush()
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        try:
            if os.name == "nt":
                import msvcrt
                f.seek(0)
                msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)
        finally:
            f.close()


class PersistentSessionLedger:
    SCHEMA = 1

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.lock_path = self.path.with_suffix(self.path.suffix + ".lock")

    def _empty(self, session: str) -> SessionLedger:
        return SessionLedger(schema_version=self.SCHEMA, session=session)

    def _read_unlocked(self, session: str) -> SessionLedger:
        if not self.path.exists():
            return self._empty(session)
        try:
            wrapper = json.loads(self.path.read_text())
            payload = wrapper["payload"]
            if wrapper.get("sha256") != _checksum(payload):
                raise RuntimeError("SESSION_LEDGER_CHECKSUM_MISMATCH")
            if int(payload.get("schema_version", -1)) != self.SCHEMA:
                raise RuntimeError("SESSION_LEDGER_SCHEMA_MISMATCH")
            if payload.get("session") != session:
                return self._empty(session)
            return SessionLedger(**payload)
        except RuntimeError:
            raise
        except Exception as exc:
            raise RuntimeError(f"SESSION_LEDGER_CORRUPT:{type(exc).__name__}") from exc

    def _write_unlocked(self, state: SessionLedger) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = asdict(state)
        wrapper = {"payload": payload, "sha256": _checksum(payload)}
        fd, tmp = tempfile.mkstemp(prefix=self.path.name + ".", dir=str(self.path.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(wrapper, f, indent=2, sort_keys=True)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self.path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    def load(self, session: str) -> SessionLedger:
        with _file_lock(self.lock_path):
            return self._read_unlocked(session)

    def reserve(self, session: str, custom_tag: str, requested_qty: int) -> SessionLedger:
        if requested_qty <= 0:
            raise RuntimeError("RESERVE_INVALID_QTY")
        with _file_lock(self.lock_path):
            state = self._read_unlocked(session)
            if state.bullet_consumed:
                raise RuntimeError(f"REFUSE_SECOND_TRADE:{state.phase}")
            state.phase = TradePhase.RESERVED.value
            state.custom_tag = custom_tag
            state.requested_qty = int(requested_qty)
            state.sequence += 1
            self._write_unlocked(state)
            return state

    def mark_submitted(self, session: str, custom_tag: str, order_id: str) -> SessionLedger:
        with _file_lock(self.lock_path):
            state = self._read_unlocked(session)
            if state.phase != TradePhase.RESERVED.value or state.custom_tag != custom_tag:
                raise RuntimeError("SUBMIT_STATE_MISMATCH")
            state.phase = TradePhase.SUBMITTED.value
            state.broker_order_id = str(order_id)
            state.sequence += 1
            self._write_unlocked(state)
            return state

    def mark_fill(self, session: str, filled_qty: int, position: int) -> SessionLedger:
        with _file_lock(self.lock_path):
            state = self._read_unlocked(session)
            if state.phase not in {TradePhase.SUBMITTED.value, TradePhase.PARTIAL.value, TradePhase.FILLED.value}:
                raise RuntimeError("FILL_STATE_MISMATCH")
            state.filled_qty = max(int(state.filled_qty), int(filled_qty))
            state.last_position = int(position)
            state.phase = (TradePhase.FILLED.value if state.filled_qty >= state.requested_qty
                           else TradePhase.PARTIAL.value)
            state.sequence += 1
            self._write_unlocked(state)
            return state

    def mark_closed(self, session: str) -> SessionLedger:
        with _file_lock(self.lock_path):
            state = self._read_unlocked(session)
            if state.phase == TradePhase.EMPTY.value:
                raise RuntimeError("CLOSE_WITHOUT_DAILY_BULLET")
            state.phase = TradePhase.CLOSED.value
            state.last_position = 0
            state.sequence += 1
            self._write_unlocked(state)
            return state

    def disable(self, session: str, reason: str, position: int | None = None) -> SessionLedger:
        with _file_lock(self.lock_path):
            state = self._read_unlocked(session)
            state.phase = TradePhase.DISABLED.value
            state.disabled_reason = str(reason)
            if position is not None:
                state.last_position = int(position)
            state.sequence += 1
            self._write_unlocked(state)
            return state
