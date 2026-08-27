#!/usr/bin/env python3
"""Personal-device shadow runtime for Current MNQ v2.4."""
from __future__ import annotations

import time as walltime
from datetime import date, datetime, time, timezone
from pathlib import Path

import pandas as pd

from research.current_mnq_strategy_v2_2_contracts import projectx_contract_id
from research.current_mnq_strategy_v2_2_projectx_broker import ProjectXBroker
from research.current_mnq_strategy_v2_3_live_data import LiveContextStore
from research.current_mnq_strategy_v2_3_local_runtime import require_personal_device
from research.current_mnq_strategy_v2_3_realtime import read_realtime_snapshot
from research.current_mnq_strategy_v2_4_engine import Params, load_production_dataset
from research.current_mnq_strategy_v2_4_shadow import (
    MISSED_FIRST_NOTE, ShadowJournal, execution_fingerprint, read_events,
    signal_fingerprint,
)
from research.current_mnq_strategy_v2_4_signal import (
    find_first_actionable_signal, prepare_causal, signal_is_fresh,
)

TZ = "America/New_York"
EXECUTION_START = time(9, 30)
EXECUTION_END = time(12, 0)
BOOTSTRAP_LOOKBACK_DAYS = 100
CONTEXT_REFRESH_SECONDS = 5.0
HEARTBEAT_SECONDS = 60.0


def _local_now(now: datetime | None = None) -> pd.Timestamp:
    ts = pd.Timestamp(now or datetime.now(timezone.utc))
    if ts.tzinfo is None:
        ts = ts.tz_localize("UTC")
    return ts.tz_convert(TZ)


def _decision_alias(decision: dict) -> dict:
    out = dict(decision)
    if "entry" not in out and "reference_entry" in out:
        out["entry"] = out["reference_entry"]
    return out


class ShadowRuntime:
    def __init__(self, *, account_id: int, realtime_snapshot_path: str | Path,
                 context_root: str | Path, journal_path: str | Path,
                 rest: ProjectXBroker | None = None,
                 context: LiveContextStore | None = None):
        require_personal_device("MNQ_V24_SHADOW_RUNTIME")
        self.account_id = int(account_id)
        self.realtime_snapshot_path = Path(realtime_snapshot_path)
        self.context_root = Path(context_root)
        self.journal = ShadowJournal(journal_path)
        self.rest = rest or ProjectXBroker(account_id=self.account_id)
        self.context = context or LiveContextStore(self.context_root)
        self._last_context_refresh: pd.Timestamp | None = None
        self._last_heartbeat: pd.Timestamp | None = None

    def _session_consumed(self, session: str) -> bool:
        for row in read_events(self.journal.path):
            if str(row.get("session")) != session or row.get("event_type") != "DECISION":
                continue
            if row.get("would_trade") or row.get("note") == MISSED_FIRST_NOTE:
                return True
        return False

    def _rest_state(self, realtime_balance: float) -> tuple[dict, list, list]:
        account = self.rest.account_snapshot()
        if int(account.get("id", -1)) != self.account_id:
            raise RuntimeError("SHADOW_REST_ACCOUNT_MISMATCH")
        if "balance" not in account:
            raise RuntimeError("SHADOW_REST_BALANCE_MISSING")
        if abs(float(account["balance"]) - float(realtime_balance)) > 0.01:
            raise RuntimeError("SHADOW_BALANCE_WITNESS_MISMATCH")
        return account, self.rest.get_working_orders(), self.rest.get_open_positions()

    def _ensure_context(self, session: date, now_utc: datetime) -> dict:
        if not self.context.manifest_path.exists():
            manifest = self.context.bootstrap(session, lookback_days=BOOTSTRAP_LOOKBACK_DAYS, as_of_utc=now_utc)
            self._last_context_refresh = pd.Timestamp(now_utc)
            return manifest
        now_ts = pd.Timestamp(now_utc)
        due = self._last_context_refresh is None or (
            now_ts - self._last_context_refresh
        ).total_seconds() >= CONTEXT_REFRESH_SECONDS
        if due:
            manifest = self.context.refresh(session, as_of_utc=now_utc)
            self._last_context_refresh = now_ts
            return manifest
        return self.context._load_manifest()

    def step(self, now: datetime | None = None) -> dict:
        local = _local_now(now); session_date = local.date(); session = str(session_date)
        contract_id = projectx_contract_id(session_date)
        rt = read_realtime_snapshot(
            self.realtime_snapshot_path, self.account_id, contract_id,
            now=local.tz_convert("UTC").to_pydatetime(),
        )
        _account, orders, positions = self._rest_state(rt.account_balance)
        position = sum(
            (1 if int(p.get("type", 0)) == 1 else -1) * int(p.get("size", 0))
            for p in positions
        )

        heartbeat_due = self._last_heartbeat is None or (
            local - self._last_heartbeat
        ).total_seconds() >= HEARTBEAT_SECONDS - 1.0
        if heartbeat_due:
            self.journal.record_heartbeat(
                session, contract_id=contract_id, account_simulated=rt.account_simulated,
                feed_age_seconds=rt.feed_age_seconds, user_hub_connected=rt.user_hub_connected,
                market_hub_connected=rt.market_hub_connected, broker_position=position,
                working_orders=len(orders), best_bid=rt.best_bid, best_ask=rt.best_ask,
            )
            self._last_heartbeat = local

        if local.time() < EXECUTION_START or local.time() > EXECUTION_END:
            return {"status": "OUTSIDE_EXECUTION_WINDOW", "session": session}
        if orders or positions:
            return {"status": "BROKER_STATE_NOT_FLAT", "session": session,
                    "working_orders": len(orders), "position": position}
        if self._session_consumed(session):
            return {"status": "DAILY_BULLET_ALREADY_RESOLVED", "session": session}

        self._ensure_context(session_date, local.tz_convert("UTC").to_pydatetime())
        raw5, raw1, manifest = load_production_dataset(self.context_root)
        env = prepare_causal(raw5, raw1, manifest, local)
        decision = find_first_actionable_signal(
            env, session_date, Params(), local, live_bid_raw=rt.best_bid, live_ask_raw=rt.best_ask,
        )
        if decision is None:
            return {"status": "NO_A_PLUS_YET", "session": session}

        payload = _decision_alias(decision.to_dict())
        if not signal_is_fresh(decision, local):
            self.journal.record_snapshot(
                session, would_trade=False, decision=payload, contract_id=contract_id,
                account_simulated=rt.account_simulated, feed_age_seconds=rt.feed_age_seconds,
                user_hub_connected=rt.user_hub_connected, market_hub_connected=rt.market_hub_connected,
                broker_position=0, working_orders=0, best_bid=rt.best_bid, best_ask=rt.best_ask,
                note=MISSED_FIRST_NOTE,
            )
            return {"status": MISSED_FIRST_NOTE, "session": session, "decision": payload}

        self.journal.record_snapshot(
            session, would_trade=True, decision=payload, contract_id=contract_id,
            account_simulated=rt.account_simulated, feed_age_seconds=rt.feed_age_seconds,
            user_hub_connected=rt.user_hub_connected, market_hub_connected=rt.market_hub_connected,
            broker_position=0, working_orders=0, best_bid=rt.best_bid, best_ask=rt.best_ask,
            note="WOULD_SUBMIT_ONE_TRADE",
        )
        return {"status": "WOULD_TRADE", "session": session, "decision": payload}

    def replay_session(self, session_date: date) -> dict:
        session = str(session_date)
        events = [r for r in read_events(self.journal.path) if str(r.get("session")) == session]
        decisions = [r for r in events if r.get("event_type") == "DECISION"]
        original = next((r for r in decisions if r.get("would_trade") or r.get("note") == MISSED_FIRST_NOTE), None)
        if original is None:
            as_of = pd.Timestamp(f"{session} 12:00", tz=TZ); bid = ask = None
        else:
            as_of = pd.Timestamp(original["timestamp_utc"]).tz_convert(TZ)
            bid, ask = original.get("best_bid"), original.get("best_ask")

        raw5, raw1, manifest = load_production_dataset(self.context_root)
        env = prepare_causal(raw5, raw1, manifest, as_of)
        replay = find_first_actionable_signal(env, session_date, Params(), as_of,
                                               live_bid_raw=bid, live_ask_raw=ask)
        replay_payload = _decision_alias(replay.to_dict()) if replay is not None else None
        live_payload = original.get("decision_payload") if original else None
        live_setup_fp = original.get("signal_fingerprint") if original else None
        live_exec_fp = original.get("execution_fingerprint") if original else None
        replay_setup_fp = signal_fingerprint(replay_payload) if replay_payload else None
        replay_exec_fp = execution_fingerprint(replay_payload) if replay_payload else None
        self.journal.record_replay_parity(session, live_setup_fp, replay_setup_fp, live_exec_fp, replay_exec_fp)
        return {"session": session, "live_decision": live_payload, "replay_decision": replay_payload,
                "setup_match": live_setup_fp == replay_setup_fp,
                "execution_match": live_exec_fp == replay_exec_fp}

    def run_until_window_end(self, poll_seconds: float = 1.0) -> None:
        while True:
            local = _local_now(); self.step(local.to_pydatetime())
            if local.time() > EXECUTION_END:
                self.replay_session(local.date()); return
            walltime.sleep(max(0.25, float(poll_seconds)))
