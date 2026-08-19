#!/usr/bin/env python3
"""Fail-closed ProjectX/TopstepX execution path for MNQ v2.3.

Before an automation order call this path requires: a locally signed evidence
receipt, exact arming phrase, correct contract, healthy realtime state, flat
broker state, dual-witness account balance, account-bound MLL risk state, and a
crash-safe RESERVED daily bullet.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import date

from research.current_mnq_strategy_v2_2_contracts import projectx_contract_id
from research.current_mnq_strategy_v2_2_projectx_broker import ProjectXBroker
from research.current_mnq_strategy_v2_3_account_risk import AccountRiskStore
from research.current_mnq_strategy_v2_3_local_runtime import require_live_arming_phrase, require_personal_device
from research.current_mnq_strategy_v2_3_receipt import verify_receipt
from research.current_mnq_strategy_v2_3_state import PersistentSessionLedger, TradePhase
from research.current_mnq_strategy_v2_3_topstep_risk import survival_safe_qty

ORDER_LIMIT = 1
ORDER_MARKET = 2
ORDER_STOP = 4
SIDE_BUY = 0
SIDE_SELL = 1


@dataclass(frozen=True)
class FeedHealth:
    user_hub_connected: bool
    market_hub_connected: bool
    feed_age_seconds: float
    best_bid: float | None = None
    best_ask: float | None = None

    @property
    def healthy(self) -> bool:
        return self.user_hub_connected and self.market_hub_connected and self.feed_age_seconds <= 15.0


def client_tag(signal: dict) -> str:
    raw = "|".join(str(signal.get(k)) for k in (
        "session", "side", "signal_time", "confirmed_time", "contract_id"
    ))
    return "MNQV23-" + hashlib.sha256(raw.encode()).hexdigest()[:24]


class V23ProjectXBroker:
    def __init__(self, account_id: int, *, market_live: bool = False, **kwargs):
        require_personal_device("PROJECTX_BROKER_AUTH")
        self.account_id = int(account_id)
        self.market_live = bool(market_live)
        self.api = ProjectXBroker(account_id=self.account_id, **kwargs)

    def _contract(self, contract_id: str) -> dict:
        data = self.api._post("/Contract/searchById", {"contractId": contract_id})
        c = data.get("contract")
        if not c or c.get("id") != contract_id:
            raise RuntimeError("PROJECTX_CONTRACT_ID_LOOKUP_MISMATCH")
        if not c.get("activeContract", False):
            raise RuntimeError("PROJECTX_CONTRACT_NOT_ACTIVE")
        return c

    def _account(self) -> dict:
        return self.api.account_snapshot()

    def _flat_reconciled(self) -> None:
        if self.api.get_working_orders():
            raise RuntimeError("WORKING_ORDERS_EXIST")
        if self.api.get_open_positions():
            raise RuntimeError("OPEN_POSITION_EXISTS")

    @staticmethod
    def _ticks(points: float, tick_size: float) -> int:
        n = points / tick_size
        if points <= 0 or abs(n - round(n)) > 1e-9:
            raise RuntimeError("BRACKET_DISTANCE_NOT_TICK_ALIGNED")
        return int(round(n))

    def build_order(self, signal: dict, qty: int, contract: dict, tag: str) -> dict:
        entry = float(signal["entry"])
        stop = float(signal["stop"])
        target = float(signal["target"])
        side = str(signal["side"]).upper()
        if side not in {"LONG", "SHORT"}:
            raise RuntimeError("SIGNAL_SIDE_INVALID")
        stop_points = abs(entry - stop)
        target_points = abs(target - entry)
        tick = float(contract["tickSize"])
        if side == "LONG" and not (stop < entry < target):
            raise RuntimeError("LONG_BRACKET_GEOMETRY_INVALID")
        if side == "SHORT" and not (target < entry < stop):
            raise RuntimeError("SHORT_BRACKET_GEOMETRY_INVALID")
        return {
            "accountId": self.account_id,
            "contractId": signal["contract_id"],
            "type": ORDER_MARKET,
            "side": SIDE_BUY if side == "LONG" else SIDE_SELL,
            "size": int(qty),
            "customTag": tag,
            "stopLossBracket": {"ticks": self._ticks(stop_points, tick), "type": ORDER_STOP},
            "takeProfitBracket": {"ticks": self._ticks(target_points, tick), "type": ORDER_LIMIT},
        }

    def submit_signal(self, signal: dict, health: FeedHealth,
                      realtime_account_balance: float,
                      risk_store: AccountRiskStore,
                      ledger: PersistentSessionLedger, promotion_receipt: str,
                      desired_qty: int = 15,
                      slippage_stress_points: float = 2.0,
                      dll_remaining: float | None = None) -> dict:
        require_personal_device("PROJECTX_ORDER_SUBMISSION")
        require_live_arming_phrase()
        verify_receipt(promotion_receipt, self.account_id)
        if not health.healthy:
            raise RuntimeError("REALTIME_HEALTH_REFUSE")
        if risk_store.config.account_id != self.account_id:
            raise RuntimeError("RISK_STORE_ACCOUNT_MISMATCH")

        session = str(signal["session"])
        expected = projectx_contract_id(date.fromisoformat(session))
        if signal.get("contract_id") != expected:
            raise RuntimeError(f"CONTRACT_MISMATCH:{signal.get('contract_id')}!={expected}")
        account = self._account()
        if not account.get("canTrade", False):
            raise RuntimeError("ACCOUNT_CANNOT_TRADE")
        if "balance" not in account:
            raise RuntimeError("BROKER_BALANCE_MISSING")
        broker_balance = float(account["balance"])
        rt_balance = float(realtime_account_balance)
        # REST + SignalR are independent current-balance witnesses. A mismatch
        # larger than a cent means state is not synchronized enough to size risk.
        if abs(broker_balance - rt_balance) > 0.01:
            raise RuntimeError(
                f"ACCOUNT_BALANCE_WITNESS_MISMATCH:REST={broker_balance:.2f}:RT={rt_balance:.2f}"
            )
        envelope = risk_store.envelope_from_broker_account(
            account, dll_remaining=dll_remaining
        )
        contract = self._contract(expected)
        self._flat_reconciled()

        stop_points = abs(float(signal["entry"]) - float(signal["stop"]))
        size = survival_safe_qty(
            desired_qty=desired_qty, envelope=envelope, stop_points=stop_points,
            slippage_points=slippage_stress_points,
            min_same_stop_survival=risk_store.config.min_same_stop_survival,
        )
        if not size.approved:
            raise RuntimeError("TOPSTEP_SIZE_REFUSE:" + "|".join(size.reasons))
        qty = size.safe_qty
        tag = client_tag(signal)
        ledger.reserve(session, tag, qty)
        self._flat_reconciled()
        payload = self.build_order(signal, qty, contract, tag)
        try:
            data = self.api._post("/Order/place", payload)
            order_id = str(data["orderId"])
        except Exception:
            ledger.disable(session, "ORDER_API_OUTCOME_UNCERTAIN")
            raise
        ledger.mark_submitted(session, tag, order_id)
        return {
            "order_id": order_id, "custom_tag": tag, "qty": qty,
            "desired_qty": desired_qty, "size_reasons": list(size.reasons),
            "broker_balance": broker_balance, "mll_floor": envelope.mll_floor,
            "payload": payload,
        }

    def reconcile_restart(self, session: str, ledger: PersistentSessionLedger) -> dict:
        require_personal_device("PROJECTX_RESTART_RECONCILIATION")
        state = ledger.load(session)
        positions = self.api.get_open_positions()
        working = self.api.get_working_orders()
        if state.phase == TradePhase.EMPTY.value:
            if positions or working:
                ledger.disable(
                    session, "BROKER_STATE_EXISTS_WITHOUT_LOCAL_BULLET",
                    position=sum(int(p.get("size", 0)) for p in positions),
                )
                raise RuntimeError("BROKER_STATE_EXISTS_WITHOUT_LOCAL_BULLET")
            return {"status": "CLEAN_EMPTY"}
        if state.phase == TradePhase.RESERVED.value:
            ledger.disable(session, "RESERVED_OUTCOME_REQUIRES_MANUAL_RECONCILIATION")
            return {"status": "DISABLED_RESERVED_UNKNOWN", "custom_tag": state.custom_tag}
        if positions:
            pos = sum(
                (1 if int(p.get("type", 0)) == 1 else -1) * int(p.get("size", 0))
                for p in positions
            )
            return {"status": "OPEN_POSITION", "position": pos, "working_orders": len(working)}
        if working:
            return {"status": "WORKING_ORDERS", "working_orders": len(working)}
        return {"status": "BULLET_CONSUMED_FLAT", "phase": state.phase}

    def emergency_flatten(self, session: str, ledger: PersistentSessionLedger, reason: str) -> None:
        require_personal_device("PROJECTX_EMERGENCY_FLATTEN")
        self.api.cancel_all()
        self.api.flatten()
        ledger.disable(session, f"EMERGENCY:{reason}", position=0)
