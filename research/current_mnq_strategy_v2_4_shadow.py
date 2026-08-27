#!/usr/bin/env python3
"""Shadow evidence journal bound to Current MNQ v2.4 semantics."""
from __future__ import annotations

import json
import os
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from research.current_mnq_strategy_v2_3_local_runtime import require_personal_device
from research.current_mnq_strategy_v2_3_shadow import (
    MISSED_FIRST_NOTE, ShadowEvent, execution_fingerprint, read_events,
    signal_fingerprint, summarize_shadow,
)
from research.current_mnq_strategy_v2_4_policy import semantics_hash


class ShadowJournal:
    def __init__(self, path: str | Path):
        require_personal_device("MNQ_V24_SHADOW_JOURNAL")
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, event: ShadowEvent) -> None:
        if event.semantics_sha256 != semantics_hash():
            raise RuntimeError("SHADOW_SEMANTICS_HASH_MISMATCH")
        line = json.dumps(asdict(event), sort_keys=True, separators=(",", ":"), default=str)
        fd = os.open(self.path, os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600)
        try:
            os.write(fd, (line + "\n").encode()); os.fsync(fd)
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
            user_hub_connected=bool(user_hub_connected), market_hub_connected=bool(market_hub_connected),
            broker_position=int(broker_position), working_orders=int(working_orders),
            best_bid=best_bid, best_ask=best_ask, note=note,
        ))

    def record_snapshot(self, session: str, *, would_trade: bool, decision: dict | None,
                        contract_id: str, account_simulated: bool,
                        feed_age_seconds: float, user_hub_connected: bool,
                        market_hub_connected: bool, broker_position: int,
                        working_orders: int, best_bid: float | None = None,
                        best_ask: float | None = None, note: str | None = None) -> None:
        if account_simulated is not True:
            raise RuntimeError("SHADOW_TOPSTEP_NON_SIMULATED_ACCOUNT_REFUSE")
        setup_fp = signal_fingerprint(decision) if decision else None
        exec_fp = execution_fingerprint(decision) if decision else None
        self.append(ShadowEvent(
            timestamp_utc=datetime.now(timezone.utc).isoformat(), session=session,
            semantics_sha256=semantics_hash(), event_type="DECISION", would_trade=would_trade,
            side=(decision or {}).get("side"), setup=(decision or {}).get("setup"),
            contract_id=contract_id, account_simulated=True, feed_age_seconds=float(feed_age_seconds),
            user_hub_connected=bool(user_hub_connected), market_hub_connected=bool(market_hub_connected),
            broker_position=int(broker_position), working_orders=int(working_orders),
            best_bid=best_bid, best_ask=best_ask, signal_fingerprint=setup_fp,
            execution_fingerprint=exec_fp, decision_payload=dict(decision) if decision else None,
            note=note,
        ))

    def record_replay_parity(self, session: str, live_fingerprint: str | None,
                             replay_fingerprint: str | None,
                             live_execution_fingerprint: str | None = None,
                             replay_execution_fingerprint: str | None = None) -> None:
        self.append(ShadowEvent(
            timestamp_utc=datetime.now(timezone.utc).isoformat(), session=session,
            semantics_sha256=semantics_hash(), event_type="REPLAY_PARITY",
            signal_fingerprint=live_fingerprint, replay_signal_fingerprint=replay_fingerprint,
            execution_fingerprint=live_execution_fingerprint,
            replay_execution_fingerprint=replay_execution_fingerprint,
            note="MATCH" if (
                live_fingerprint == replay_fingerprint and
                (live_execution_fingerprint is None or live_execution_fingerprint == replay_execution_fingerprint)
            ) else "MISMATCH",
        ))
