#!/usr/bin/env python3
"""Local-only shadow journal and verification for MNQ v2.3.

Shadow mode never submits an order. A session counts as a full proof session only
when health/reconciliation heartbeats continuously cover the execution window.
Each would-trade decision preserves the contemporaneous BBO + decision payload so
end-of-day replay can reproduce the exact causal question without future bars.
"""
from __future__ import annotations

import hashlib
import json
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from research.current_mnq_strategy_v2_3_local_runtime import require_personal_device
from research.current_mnq_strategy_v2_3_policy import semantics_hash

TZ = "America/New_York"
COVERAGE_START = pd.Timestamp("09:30").time()
COVERAGE_END = pd.Timestamp("12:00").time()
MAX_HEARTBEAT_GAP_SECONDS = 90.0
MISSED_FIRST_NOTE = "MISSED_FIRST_A_PLUS_SIGNAL"


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
    best_bid: float | None = None
    best_ask: float | None = None
    signal_fingerprint: str | None = None
    replay_signal_fingerprint: str | None = None
    execution_fingerprint: str | None = None
    replay_execution_fingerprint: str | None = None
    decision_payload: dict | None = None
    note: str | None = None


def signal_fingerprint(payload: dict) -> str:
    """Semantic/setup identity, independent of BBO fill and evolving dataset hash."""
    keys = (
        "session", "signal_time", "confirmed_time", "actionable_time", "side", "setup",
        "reason", "premarket_primary", "premarket_structure", "premarket_location",
        "entry_location", "location_id", "target_source", "path_reason", "contract_id",
        "engine_version", "semantics_sha256",
    )
    normalized = {k: payload.get(k) for k in keys}
    raw = json.dumps(normalized, sort_keys=True, separators=(",", ":"), default=str).encode()
    return hashlib.sha256(raw).hexdigest()


def execution_fingerprint(payload: dict) -> str:
    """Execution binding identity; replay matches it using the recorded BBO."""
    keys = (
        "session", "side", "setup", "reference_entry", "stop", "target",
        "target_points", "reference_source", "contract_id", "semantics_sha256",
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

    def record_heartbeat(self, session: str, *, contract_id: str,
                         account_simulated: bool, feed_age_seconds: float,
                         user_hub_connected: bool, market_hub_connected: bool,
                         broker_position: int, working_orders: int,
                         best_bid: float | None = None, best_ask: float | None = None,
                         note: str | None = None) -> None:
        if account_simulated is not True:
            raise RuntimeError("SHADOW_TOPSTEP_NON_SIMULATED_ACCOUNT_REFUSE")
        self.append(ShadowEvent(
            timestamp_utc=datetime.now(timezone.utc).isoformat(), session=session,
            semantics_sha256=semantics_hash(), event_type="HEARTBEAT",
            contract_id=contract_id, account_simulated=True,
            feed_age_seconds=float(feed_age_seconds),
            user_hub_connected=bool(user_hub_connected),
            market_hub_connected=bool(market_hub_connected),
            broker_position=int(broker_position), working_orders=int(working_orders),
            best_bid=best_bid, best_ask=best_ask, note=note,
        ))

    def record_snapshot(self, session: str, *, would_trade: bool, decision: dict | None,
                        contract_id: str, account_simulated: bool,
                        feed_age_seconds: float, user_hub_connected: bool,
                        market_hub_connected: bool, broker_position: int,
                        working_orders: int, best_bid: float | None = None,
                        best_ask: float | None = None,
                        note: str | None = None) -> None:
        if account_simulated is not True:
            raise RuntimeError("SHADOW_TOPSTEP_NON_SIMULATED_ACCOUNT_REFUSE")
        setup_fp = signal_fingerprint(decision) if decision else None
        exec_fp = execution_fingerprint(decision) if decision else None
        self.append(ShadowEvent(
            timestamp_utc=datetime.now(timezone.utc).isoformat(), session=session,
            semantics_sha256=semantics_hash(), event_type="DECISION",
            would_trade=would_trade, side=(decision or {}).get("side"),
            setup=(decision or {}).get("setup"), contract_id=contract_id,
            account_simulated=True, feed_age_seconds=float(feed_age_seconds),
            user_hub_connected=bool(user_hub_connected),
            market_hub_connected=bool(market_hub_connected),
            broker_position=int(broker_position), working_orders=int(working_orders),
            best_bid=best_bid, best_ask=best_ask,
            signal_fingerprint=setup_fp, execution_fingerprint=exec_fp,
            decision_payload=dict(decision) if decision else None, note=note,
        ))

    def record_replay_parity(self, session: str, live_fingerprint: str | None,
                             replay_fingerprint: str | None,
                             live_execution_fingerprint: str | None = None,
                             replay_execution_fingerprint: str | None = None) -> None:
        self.append(ShadowEvent(
            timestamp_utc=datetime.now(timezone.utc).isoformat(), session=session,
            semantics_sha256=semantics_hash(), event_type="REPLAY_PARITY",
            signal_fingerprint=live_fingerprint,
            replay_signal_fingerprint=replay_fingerprint,
            execution_fingerprint=live_execution_fingerprint,
            replay_execution_fingerprint=replay_execution_fingerprint,
            note="MATCH" if (
                live_fingerprint == replay_fingerprint and
                (live_execution_fingerprint is None or
                 live_execution_fingerprint == replay_execution_fingerprint)
            ) else "MISMATCH",
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


def _event_time(row: dict) -> pd.Timestamp:
    try:
        t = pd.Timestamp(row["timestamp_utc"])
    except Exception as exc:
        raise RuntimeError("SHADOW_EVENT_TIMESTAMP_INVALID") from exc
    if t.tzinfo is None:
        raise RuntimeError("SHADOW_EVENT_TIMESTAMP_NAIVE")
    return t.tz_convert(TZ)


def _session_has_full_coverage(events: list[dict]) -> bool:
    health = [r for r in events if r.get("event_type") in {"HEARTBEAT", "DECISION"}]
    if len(health) < 2:
        return False
    times = sorted(_event_time(r) for r in health)
    first, last = times[0], times[-1]
    if first.time() > COVERAGE_START or last.time() < COVERAGE_END:
        return False
    relevant = [t for t in times if COVERAGE_START <= t.time() <= COVERAGE_END]
    if len(relevant) < 2:
        return False
    gaps = [(b - a).total_seconds() for a, b in zip(relevant, relevant[1:])]
    return bool(gaps and max(gaps) <= MAX_HEARTBEAT_GAP_SECONDS)


def summarize_shadow(path: str | Path) -> dict:
    rows = read_events(path)
    if not rows:
        return {
            "full_sessions": 0, "would_trade_sessions": 0, "rule_changes": 0,
            "duplicate_order_events": 0, "unreconciled_state_events": 0,
            "missed_first_signal_events": 0, "signal_parity_mismatches": 0,
            "user_hub_all_healthy": False, "market_hub_all_healthy": False,
            "simulated_account_all_verified": False,
        }
    hashes = {r.get("semantics_sha256") for r in rows}
    health = [r for r in rows if r.get("event_type") in {"HEARTBEAT", "DECISION"}]
    decisions = [r for r in rows if r.get("event_type") == "DECISION"]
    parity = [r for r in rows if r.get("event_type") == "REPLAY_PARITY"]
    by_session: dict[str, list[dict]] = {}
    for r in health:
        by_session.setdefault(str(r.get("session")), []).append(r)
    full = {s for s, evs in by_session.items() if _session_has_full_coverage(evs)}
    traded_sessions = {
        str(r.get("session")) for r in decisions
        if r.get("would_trade") and str(r.get("session")) in full
    }
    unreconciled = sum(
        1 for r in health
        if int(r.get("working_orders") or 0) != 0 or int(r.get("broker_position") or 0) != 0
    )
    missed_first = sum(1 for r in decisions if r.get("note") == MISSED_FIRST_NOTE)
    parity_mismatch = 0
    for r in parity:
        setup_bad = r.get("signal_fingerprint") != r.get("replay_signal_fingerprint")
        live_exec = r.get("execution_fingerprint")
        replay_exec = r.get("replay_execution_fingerprint")
        exec_bad = live_exec is not None and live_exec != replay_exec
        parity_mismatch += int(setup_bad or exec_bad)
    return {
        "full_sessions": len(full),
        "would_trade_sessions": len(traded_sessions),
        "rule_changes": max(0, len(hashes) - 1),
        "duplicate_order_events": 0,
        "unreconciled_state_events": unreconciled,
        "missed_first_signal_events": missed_first,
        "signal_parity_mismatches": parity_mismatch,
        "user_hub_all_healthy": bool(health) and all(bool(r.get("user_hub_connected")) for r in health),
        "market_hub_all_healthy": bool(health) and all(bool(r.get("market_hub_connected")) for r in health),
        "simulated_account_all_verified": bool(health) and all(r.get("account_simulated") is True for r in health),
    }
