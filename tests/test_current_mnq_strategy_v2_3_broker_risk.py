from __future__ import annotations

from types import SimpleNamespace

import pytest

from research import current_mnq_strategy_v2_3_broker as b
from research.current_mnq_strategy_v2_3_account_risk import AccountRiskConfig, AccountRiskStore
from research.current_mnq_strategy_v2_3_state import PersistentSessionLedger


class FakeBroker(b.V23ProjectXBroker):
    def __init__(self, account):
        self.account_id = 123
        self.market_live = False
        self._fake_account = account
        self.api = SimpleNamespace()
    def _account(self):
        return dict(self._fake_account)
    def _contract(self, contract_id):
        return {"id": contract_id, "tickSize": 0.25, "activeContract": True}
    def _flat_reconciled(self):
        return None


def patch_safety(monkeypatch):
    monkeypatch.setattr(b, "require_personal_device", lambda *a, **k: None)
    monkeypatch.setattr(b, "require_live_arming_phrase", lambda *a, **k: None)
    monkeypatch.setattr(b, "verify_receipt", lambda *a, **k: {})
    monkeypatch.setattr(b, "projectx_contract_id", lambda d: "CON.F.US.MNQ.U26")


def store(tmp_path):
    return AccountRiskStore(AccountRiskConfig(
        account_id=123, account_size_label="50K", starting_balance=50000.0,
        max_loss_distance=2000.0, platform_max_micros=50,
        min_same_stop_survival=3,
    ), tmp_path / "risk.json")


def signal():
    return {
        "session": "2026-08-17", "side": "LONG",
        "signal_time": "x", "confirmed_time": "y",
        "entry": 23000.0, "stop": 22982.75, "target": 23040.0,
        "contract_id": "CON.F.US.MNQ.U26",
    }


def test_balance_witness_mismatch_refuses_before_daily_bullet(monkeypatch, tmp_path):
    patch_safety(monkeypatch)
    broker = FakeBroker({"id": 123, "canTrade": True, "balance": 50000.0})
    ledger = PersistentSessionLedger(tmp_path / "ledger.json")
    with pytest.raises(RuntimeError, match="ACCOUNT_BALANCE_WITNESS_MISMATCH"):
        broker.submit_signal(
            signal(), b.FeedHealth(True, True, 1.0),
            realtime_account_balance=49999.0,
            risk_store=store(tmp_path), ledger=ledger,
            promotion_receipt="unused",
        )
    assert not ledger.load("2026-08-17").bullet_consumed


def test_risk_store_account_mismatch_refuses(monkeypatch, tmp_path):
    patch_safety(monkeypatch)
    broker = FakeBroker({"id": 123, "canTrade": True, "balance": 50000.0})
    wrong = AccountRiskStore(AccountRiskConfig(
        account_id=999, account_size_label="50K", starting_balance=50000.0,
        max_loss_distance=2000.0,
    ), tmp_path / "wrong.json")
    ledger = PersistentSessionLedger(tmp_path / "ledger.json")
    with pytest.raises(RuntimeError, match="RISK_STORE_ACCOUNT_MISMATCH"):
        broker.submit_signal(
            signal(), b.FeedHealth(True, True, 1.0),
            realtime_account_balance=50000.0,
            risk_store=wrong, ledger=ledger,
            promotion_receipt="unused",
        )
