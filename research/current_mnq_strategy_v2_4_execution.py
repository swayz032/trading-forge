#!/usr/bin/env python3
"""Production orchestration for Current MNQ v2.4."""
from __future__ import annotations

from pathlib import Path

from research.current_mnq_strategy_v2_3_account_risk import AccountRiskStore
from research.current_mnq_strategy_v2_3_realtime import read_realtime_snapshot
from research.current_mnq_strategy_v2_3_state import PersistentSessionLedger
from research.current_mnq_strategy_v2_4_broker import FeedHealth, V24ProjectXBroker


def submit_with_realtime_snapshot(
    broker: V24ProjectXBroker,
    signal: dict,
    realtime_snapshot_path: str | Path,
    risk_store: AccountRiskStore,
    ledger: PersistentSessionLedger,
    promotion_receipt: str | Path,
    desired_qty: int = 15,
    slippage_stress_points: float = 2.0,
    dll_remaining: float | None = None,
) -> dict:
    snapshot = read_realtime_snapshot(
        realtime_snapshot_path,
        expected_account_id=broker.account_id,
        expected_contract_id=str(signal["contract_id"]),
    )
    health = FeedHealth(
        user_hub_connected=snapshot.user_hub_connected,
        market_hub_connected=snapshot.market_hub_connected,
        feed_age_seconds=snapshot.feed_age_seconds,
        best_bid=snapshot.best_bid,
        best_ask=snapshot.best_ask,
    )
    return broker.submit_signal(
        signal=signal, health=health,
        realtime_account_balance=snapshot.account_balance,
        risk_store=risk_store, ledger=ledger,
        promotion_receipt=str(promotion_receipt),
        desired_qty=desired_qty,
        slippage_stress_points=slippage_stress_points,
        dll_remaining=dll_remaining,
    )
