#!/usr/bin/env python3
"""Personal-device one-trade automation runtime for Current MNQ v2.4.

No v2.3 strategy decision or promotion receipt can enter this path. The first A+
setup from the shared causal v2.4 kernel is authoritative; if it is missed, the
session is disabled rather than replaced by a later setup.
"""
from __future__ import annotations

from datetime import datetime, time, timezone
from pathlib import Path

import pandas as pd

from research.current_mnq_strategy_v2_2_contracts import projectx_contract_id
from research.current_mnq_strategy_v2_3_account_risk import AccountRiskStore
from research.current_mnq_strategy_v2_3_live_data import LiveContextStore
from research.current_mnq_strategy_v2_3_local_runtime import require_personal_device
from research.current_mnq_strategy_v2_3_realtime import read_realtime_snapshot
from research.current_mnq_strategy_v2_3_state import PersistentSessionLedger, TradePhase
from research.current_mnq_strategy_v2_4_broker import V24ProjectXBroker
from research.current_mnq_strategy_v2_4_engine import Params, load_production_dataset
from research.current_mnq_strategy_v2_4_execution import submit_with_realtime_snapshot
from research.current_mnq_strategy_v2_4_signal import (
    find_first_actionable_signal, prepare_causal, signal_is_fresh,
)

TZ = "America/New_York"
START = time(9, 30)
END = time(12, 0)


def _local(now: datetime | None = None) -> pd.Timestamp:
    ts = pd.Timestamp(now or datetime.now(timezone.utc))
    if ts.tzinfo is None:
        ts = ts.tz_localize("UTC")
    return ts.tz_convert(TZ)


def _broker_signal(decision) -> dict:
    d = decision.to_dict(); d["entry"] = d["reference_entry"]
    return d


class AutomationRuntime:
    def __init__(self, *, account_id: int,
                 realtime_snapshot_path: str | Path,
                 context_root: str | Path,
                 ledger_path: str | Path,
                 risk_store: AccountRiskStore,
                 promotion_receipt: str | Path,
                 broker: V24ProjectXBroker | None = None,
                 context: LiveContextStore | None = None):
        require_personal_device("MNQ_V24_AUTOMATION_RUNTIME")
        self.account_id = int(account_id)
        self.snapshot_path = Path(realtime_snapshot_path)
        self.context_root = Path(context_root)
        self.ledger = PersistentSessionLedger(ledger_path)
        self.risk_store = risk_store
        if risk_store.config.account_id != self.account_id:
            raise RuntimeError("V24_AUTOMATION_RISK_ACCOUNT_MISMATCH")
        self.receipt = Path(promotion_receipt)
        self.broker = broker or V24ProjectXBroker(account_id=self.account_id)
        self.context = context or LiveContextStore(self.context_root)

    def evaluate_once(self, now: datetime | None = None,
                      desired_qty: int = 15,
                      slippage_stress_points: float = 2.0,
                      dll_remaining: float | None = None) -> dict:
        local = _local(now); session_date = local.date(); session = str(session_date)
        if local.time() < START or local.time() > END:
            return {"status": "OUTSIDE_EXECUTION_WINDOW", "session": session}
        state = self.ledger.load(session)
        if state.phase != TradePhase.EMPTY.value or state.bullet_consumed:
            return {"status": "DAILY_BULLET_ALREADY_CONSUMED", "session": session, "phase": state.phase}

        contract_id = projectx_contract_id(session_date)
        rt = read_realtime_snapshot(
            self.snapshot_path, self.account_id, contract_id,
            now=local.tz_convert("UTC").to_pydatetime(),
        )
        if not self.context.manifest_path.exists():
            self.context.bootstrap(session_date, lookback_days=100,
                                   as_of_utc=local.tz_convert("UTC").to_pydatetime())
        else:
            self.context.refresh(session_date, as_of_utc=local.tz_convert("UTC").to_pydatetime())

        raw5, raw1, manifest = load_production_dataset(self.context_root)
        env = prepare_causal(raw5, raw1, manifest, local)
        decision = find_first_actionable_signal(
            env, session_date, Params(), local,
            live_bid_raw=rt.best_bid, live_ask_raw=rt.best_ask,
        )
        if decision is None:
            return {"status": "NO_A_PLUS_YET", "session": session}
        if not signal_is_fresh(decision, local):
            self.ledger.disable(session, "MISSED_FIRST_A_PLUS_SIGNAL", position=0)
            return {"status": "MISSED_FIRST_A_PLUS_SIGNAL_DAY_DISABLED", "session": session,
                    "decision": _broker_signal(decision)}

        result = submit_with_realtime_snapshot(
            broker=self.broker, signal=_broker_signal(decision),
            realtime_snapshot_path=self.snapshot_path,
            risk_store=self.risk_store, ledger=self.ledger,
            promotion_receipt=self.receipt, desired_qty=desired_qty,
            slippage_stress_points=slippage_stress_points,
            dll_remaining=dll_remaining,
        )
        return {"status": "ORDER_SUBMITTED", "session": session,
                "decision": _broker_signal(decision), "order": result}

    def reconcile_restart(self, now: datetime | None = None) -> dict:
        session = str(_local(now).date())
        return self.broker.reconcile_restart(session, self.ledger)
