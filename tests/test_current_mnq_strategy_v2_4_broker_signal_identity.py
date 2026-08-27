from __future__ import annotations

from types import SimpleNamespace

import pytest

from research import current_mnq_strategy_v2_4_broker as b
from research.current_mnq_strategy_v2_4_engine import ENGINE_VERSION
from research.current_mnq_strategy_v2_4_policy import semantics_hash


def signal(**overrides):
    x = {
        "session": "2026-08-18",
        "side": "LONG",
        "signal_time": "2026-08-18 10:00:00-04:00",
        "confirmed_time": "2026-08-18 10:05:00-04:00",
        "contract_id": "CON.F.US.MNQ.U26",
        "semantics_sha256": semantics_hash(),
        "engine_version": ENGINE_VERSION,
        "reference_source": "LIVE_ASK",
        "entry": 100.0, "stop": 90.0, "target": 130.0,
    }
    x.update(overrides)
    return x


def test_signal_identity_rejects_stale_fingerprint():
    with pytest.raises(RuntimeError, match="SIGNAL_SEMANTICS_STALE"):
        b.validate_signal_identity(signal(semantics_sha256="0" * 64))


def test_signal_identity_rejects_wrong_engine_version():
    with pytest.raises(RuntimeError, match="ENGINE_VERSION_MISMATCH"):
        b.validate_signal_identity(signal(engine_version="MNQ-V2.3-PC1"))


def test_signal_identity_binds_live_quote_side():
    with pytest.raises(RuntimeError, match="LONG_SIGNAL_REFERENCE_NOT_LIVE_ASK"):
        b.validate_signal_identity(signal(reference_source="LIVE_BID"))
    b.validate_signal_identity(signal())
    b.validate_signal_identity(signal(side="SHORT", reference_source="LIVE_BID"))


def test_execution_quote_must_equal_quote_used_to_approve_target_room():
    same = SimpleNamespace(best_ask=100.0, best_bid=99.75)
    b.validate_execution_quote(signal(), same)
    with pytest.raises(RuntimeError, match="EXECUTION_QUOTE_DRIFT"):
        b.validate_execution_quote(signal(), SimpleNamespace(best_ask=100.25, best_bid=100.0))
    with pytest.raises(RuntimeError, match="EXECUTION_SIDE_QUOTE_MISSING"):
        b.validate_execution_quote(signal(), SimpleNamespace(best_ask=None, best_bid=99.75))


def test_execution_quote_uses_bid_for_short():
    s = signal(side="SHORT", reference_source="LIVE_BID", entry=99.75,
               stop=109.75, target=70.0)
    b.validate_execution_quote(s, SimpleNamespace(best_ask=100.0, best_bid=99.75))
    with pytest.raises(RuntimeError, match="EXECUTION_QUOTE_DRIFT"):
        b.validate_execution_quote(s, SimpleNamespace(best_ask=100.0, best_bid=99.50))


def test_local_order_validation_happens_before_daily_bullet_reserve(monkeypatch):
    monkeypatch.setattr(b, "require_personal_device", lambda *a, **k: None)
    monkeypatch.setattr(b, "require_live_arming_phrase", lambda *a, **k: None)
    monkeypatch.setattr(b, "verify_receipt", lambda *a, **k: {})
    monkeypatch.setattr(b, "projectx_contract_id", lambda d: "CON.F.US.MNQ.U26")
    monkeypatch.setattr(
        b, "survival_safe_qty",
        lambda **k: SimpleNamespace(approved=True, safe_qty=15, reasons=()),
    )

    broker = object.__new__(b.V24ProjectXBroker)
    broker.account_id = 123
    broker._account = lambda: {"canTrade": True, "balance": 50000.0}
    broker._contract = lambda expected: {"id": expected, "tickSize": .25, "activeContract": True}
    broker._flat_reconciled = lambda: None
    broker.build_order = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("BAD_GEOMETRY"))
    broker.api = SimpleNamespace(_post=lambda *a, **k: {"orderId": 1})

    risk = SimpleNamespace(
        config=SimpleNamespace(account_id=123, min_same_stop_survival=2),
        envelope_from_broker_account=lambda account, dll_remaining=None: SimpleNamespace(mll_floor=48000.0),
    )
    ledger = SimpleNamespace(reserve_calls=0)
    def reserve(*args):
        ledger.reserve_calls += 1
    ledger.reserve = reserve
    ledger.disable = lambda *a, **k: None
    ledger.mark_submitted = lambda *a, **k: None
    health = SimpleNamespace(healthy=True, best_ask=100.0, best_bid=99.75)

    with pytest.raises(RuntimeError, match="BAD_GEOMETRY"):
        broker.submit_signal(
            signal(), health, 50000.0, risk, ledger,
            promotion_receipt="unused.json",
        )
    assert ledger.reserve_calls == 0
