#!/usr/bin/env python3
"""ProjectX execution path bound specifically to Current MNQ v2.4 receipts/signals."""
from __future__ import annotations

import hashlib
from datetime import date

from research.current_mnq_strategy_v2_2_contracts import projectx_contract_id
from research.current_mnq_strategy_v2_3_account_risk import AccountRiskStore
from research.current_mnq_strategy_v2_3_broker import FeedHealth, V23ProjectXBroker
from research.current_mnq_strategy_v2_3_local_runtime import require_live_arming_phrase, require_personal_device
from research.current_mnq_strategy_v2_3_state import PersistentSessionLedger
from research.current_mnq_strategy_v2_3_topstep_risk import survival_safe_qty
from research.current_mnq_strategy_v2_4_engine import ENGINE_VERSION, TICK
from research.current_mnq_strategy_v2_4_policy import semantics_hash
from research.current_mnq_strategy_v2_4_receipt import verify_receipt


def client_tag(signal: dict) -> str:
    raw = "|".join(str(signal.get(k)) for k in (
        "session", "side", "signal_time", "confirmed_time", "contract_id",
        "semantics_sha256",
    ))
    return "MNQV24-" + hashlib.sha256(raw.encode()).hexdigest()[:24]


def validate_signal_identity(signal: dict) -> None:
    """Reject stale/mismatched strategy decisions before any daily-bullet mutation."""
    if signal.get("semantics_sha256") != semantics_hash():
        raise RuntimeError("V24_SIGNAL_SEMANTICS_STALE")
    if signal.get("engine_version") != ENGINE_VERSION:
        raise RuntimeError("V24_SIGNAL_ENGINE_VERSION_MISMATCH")
    side = str(signal.get("side", "")).upper()
    source = str(signal.get("reference_source", ""))
    if side == "LONG" and source != "LIVE_ASK":
        raise RuntimeError("V24_LONG_SIGNAL_REFERENCE_NOT_LIVE_ASK")
    if side == "SHORT" and source != "LIVE_BID":
        raise RuntimeError("V24_SHORT_SIGNAL_REFERENCE_NOT_LIVE_BID")
    if side not in {"LONG", "SHORT"}:
        raise RuntimeError("V24_SIGNAL_SIDE_INVALID")


def validate_execution_quote(signal: dict, health: FeedHealth) -> None:
    """Require the final broker quote to equal the quote that approved geometry.

    ProjectX attached brackets are tick distances from the eventual market fill.
    If the executable quote moves after target/room approval, submitting the old
    tick geometry would silently move the absolute TP/SL relationship. Refuse and
    let the strategy recalculate from the new quote instead.
    """
    side = str(signal.get("side", "")).upper()
    quote = health.best_ask if side == "LONG" else health.best_bid if side == "SHORT" else None
    if quote is None:
        raise RuntimeError("V24_EXECUTION_SIDE_QUOTE_MISSING")
    entry = float(signal["entry"])
    q = float(quote)
    if abs(q / TICK - round(q / TICK)) > 1e-9:
        raise RuntimeError("V24_EXECUTION_QUOTE_OFF_TICK")
    if abs(q - entry) > 1e-9:
        raise RuntimeError(f"V24_EXECUTION_QUOTE_DRIFT:{entry:.2f}->{q:.2f}")


class V24ProjectXBroker(V23ProjectXBroker):
    """Reuse proven v2.3 broker mechanics but require v2.4 receipt + signal identity."""

    def submit_signal(self, signal: dict, health: FeedHealth,
                      realtime_account_balance: float,
                      risk_store: AccountRiskStore,
                      ledger: PersistentSessionLedger, promotion_receipt: str,
                      desired_qty: int = 15,
                      slippage_stress_points: float = 2.0,
                      dll_remaining: float | None = None) -> dict:
        require_personal_device("PROJECTX_V24_ORDER_SUBMISSION")
        require_live_arming_phrase()
        # Critical version boundary: a perfectly valid v2.3 receipt MUST fail here.
        verify_receipt(promotion_receipt, self.account_id)
        validate_signal_identity(signal)
        if not health.healthy:
            raise RuntimeError("REALTIME_HEALTH_REFUSE")
        validate_execution_quote(signal, health)
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
        if abs(broker_balance - rt_balance) > 0.01:
            raise RuntimeError(
                f"ACCOUNT_BALANCE_WITNESS_MISMATCH:REST={broker_balance:.2f}:RT={rt_balance:.2f}"
            )
        envelope = risk_store.envelope_from_broker_account(account, dll_remaining=dll_remaining)
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

        # Pure local bracket/geometry validation must happen BEFORE mutating the
        # crash-safe daily bullet. Only an order that is locally constructible is
        # allowed to reserve today's one-shot execution state.
        payload = self.build_order(signal, qty, contract, tag)
        ledger.reserve(session, tag, qty)
        self._flat_reconciled()
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
