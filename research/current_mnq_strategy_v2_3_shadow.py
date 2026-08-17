#!/usr/bin/env python3
"""Local-only shadow journal and verification for MNQ v2.3.

Shadow mode never submits an order. It records the exact production-candidate
signal decision, broker/account reconciliation state, realtime feed health and a
later replay-parity result. A changed semantics hash during the shadow campaign
invalidates the campaign instead of quietly mixing versions.
"""
from __future__ import annotations

import hashlib
import json
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from research.current_mnq_strategy_v2_3_local_runtime import require_personal_device
from research.current_mnq_strategy_v2_3_policy import semantics_hash


@dataclass(frozen=True)
class ShadowEvent:
    timestamp_utc: str
    session: str
    semantics_sha256: str
    event_type: str
    would_trade: bool = False
    side: str | None = None
    setup: str | None = None
    contract_id: str | None = None
    account_simulated: bool | None = None
    feed_age_seconds: float | None = None
    user_hub_connected: bool | None = None
    market_hub_connected: bool | None = None
    broker_position: int | None = None
    working_orders: int | None = None
    signal_fingerprint: str | None = None
    replay_signal_fingerprint: str | None = None
    note: str | None = None


def signal_fingerprint(payload: dict) -> str:
    keys = (
        "session", "signal_time", "confirmed_time", "entry_time", "side", "setup",
        "entry_location", "entry", "stop", "target", "target_source", "contract_id",
        "engine_version", "semantics_sha256",
    )
    normalized = {k: payload.get(k) for k in keys}
    raw = json.dumps(normalized, sort_keys=True, separators=(",", ":"), default=str).encode()
    return hashlib.sha256(raw).hexdigest()


class ShadowJournal:
    def __init__(self, path: str | Path):
        require_personal_device("MNQ_SHADOW_JOURNAL")
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, event: ShadowEvent) -> None:
        if event.semantics_sha256 != semantics_hash():
            raise RuntimeError("SHADOW_SEMANTICS_HASH_MISMATCH")
        line = json.dumps(asdict(event), sort_keys=True, separators=(",", ":"), default=str)
        fd = os.open(self.path, os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600)
        try:
            os.write(fd, (line + "\n").encode())
            os.fsync(fd)
        finally:
            os.close(fd)

    def record_snapshot(self, session: str, *, would_trade: bool, decision: dict | None,
                        contract_id: str, account_simulated: bool,
                        feed_age_seconds: float, user_hub_connected: bool,
                        market_hub_connected: bool, broker_position: int,
                        working_orders: int, note: str | None = None) -> None:
        if account_simulated is not True:
            raise RuntimeError("SHADOW_TOPSTEP_NON_SIMULATED_ACCOUNT_REFUSE")
        fp = signal_fingerprint(decision) if decision else None
        self.append(ShadowEvent(
            timestamp_utc=datetime.now(timezone.utc).isoformat(), session=session,
            semantics_sha256=semantics_hash(), event_type="DECISION",
            would_trade=would_trade, side=(decision or {}).get("side"),
            setup=(decision or {}).get("setup"), contract_id=contract_id,
            account_simulated=True, feed_age_seconds=float(feed_age_seconds),
            user_hub_connected=user_hub_connected,
            market_hub_connected=market_hub_connected, broker_position=int(broker_position),
            working_orders=int(working_orders), signal_fingerprint=fp, note=note,
        ))

    def record_replay_parity(self, session: str, live_fingerprint: str | None,
                             replay_fingerprint: str | None) -> None:
        self.append(ShadowEvent(
            timestamp_utc=datetime.now(timezone.utc).isoformat(), session=session,
            semantics_sha256=semantics_hash(), event_type="REPLAY_PARITY",
            signal_fingerprint=live_fingerprint,
            replay_signal_fingerprint=replay_fingerprint,
            note="MATCH" if live_fingerprint == replay_fingerprint else "MISMATCH",
        ))


def read_events(path: str | Path) -> list[dict]:
    p = Path(path)
    if not p.exists():
        return []
    rows = []
    for n, line in enumerate(p.read_text().splitlines(), 1):
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except Exception as exc:
            raise RuntimeError(f"SHADOW_JOURNAL_CORRUPT_LINE:{n}") from exc
    return rows


def summarize_shadow(path: str | Path) -> dict:
    rows = read_events(path)
    if not rows:
        return {
            "full_sessions": 0, "would_trade_sessions": 0, "rule_changes": 0,
            "duplicate_order_events": 0, "unreconciled_state_events": 0,
            "signal_parity_mismatches": 0, "user_hub_all_healthy": False,
            "market_hub_all_healthy": False, "simulated_account_all_verified": False,
        }
    hashes = {r.get("semantics_sha256") for r in rows}
    decisions = [r for r in rows if r.get("event_type") == "DECISION"]
    parity = [r for r in rows if r.get("event_type") == "REPLAY_PARITY"]
    sessions = {r.get("session") for r in decisions}
    traded_sessions = {r.get("session") for r in decisions if r.get("would_trade")}
    unreconciled = sum(
        1 for r in decisions
        if int(r.get("working_orders") or 0) != 0 or int(r.get("broker_position") or 0) != 0
    )
    return {
        "full_sessions": len(sessions),
        "would_trade_sessions": len(traded_sessions),
        "rule_changes": max(0, len(hashes) - 1),
        "duplicate_order_events": 0,
        "unreconciled_state_events": unreconciled,
        "signal_parity_mismatches": sum(
            1 for r in parity
            if r.get("signal_fingerprint") != r.get("replay_signal_fingerprint")
        ),
        "user_hub_all_healthy": bool(decisions) and all(bool(r.get("user_hub_connected")) for r in decisions),
        "market_hub_all_healthy": bool(decisions) and all(bool(r.get("market_hub_connected")) for r in decisions),
        "simulated_account_all_verified": bool(decisions) and all(r.get("account_simulated") is True for r in decisions),
    }
