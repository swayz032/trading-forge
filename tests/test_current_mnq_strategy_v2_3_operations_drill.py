from __future__ import annotations

from types import SimpleNamespace

import pytest

from research import current_mnq_strategy_v2_3_operations_drill as drill


class FakeRest:
    def __init__(self, *, balance=50000.0, orders=None, positions=None):
        self.balance = balance
        self.orders = list(orders or [])
        self.positions = list(positions or [])
        self.cancel_calls = 0
        self.flatten_calls = 0

    def account_snapshot(self):
        return {"id": 123, "balance": self.balance, "canTrade": True}

    def get_working_orders(self):
        return list(self.orders)

    def get_open_positions(self):
        return list(self.positions)

    def cancel_all(self):
        self.cancel_calls += 1
        self.orders = []

    def flatten(self):
        self.flatten_calls += 1
        self.positions = []


def make(monkeypatch, rest):
    monkeypatch.setattr(drill, "require_personal_device", lambda *a, **k: None)
    monkeypatch.setattr(drill, "read_realtime_snapshot", lambda *a, **k: SimpleNamespace(
        account_simulated=True, account_balance=50000.0
    ))
    return drill.OperationsDrill(123, "rt.json", rest=rest)


def test_reconciliation_check_uses_rest_and_realtime_balance_witnesses(monkeypatch):
    r = FakeRest()
    d = make(monkeypatch, r)
    out = d.reconciliation_check("CON.F.US.MNQ.U26")
    assert out["broker_reconciliation_verified"] is True
    assert out["account_simulated_verified"] is True
    assert out["working_orders"] == 0
    assert out["open_positions"] == 0


def test_reconciliation_refuses_balance_witness_mismatch(monkeypatch):
    r = FakeRest(balance=49999.0)
    d = make(monkeypatch, r)
    with pytest.raises(RuntimeError, match="DRILL_BALANCE_WITNESS_MISMATCH"):
        d.reconciliation_check("CON.F.US.MNQ.U26")


def test_emergency_drill_refuses_when_there_is_nothing_to_flatten(monkeypatch):
    d = make(monkeypatch, FakeRest())
    with pytest.raises(RuntimeError, match="DRILL_NO_EXISTING_SIM_STATE_TO_FLATTEN"):
        d.emergency_flatten_existing_state("CON.F.US.MNQ.U26")


def test_emergency_drill_must_act_on_existing_state_and_prove_flat_after(monkeypatch):
    r = FakeRest(orders=[{"id": 1}], positions=[{"id": 2, "size": 1}])
    d = make(monkeypatch, r)
    out = d.emergency_flatten_existing_state("CON.F.US.MNQ.U26")
    assert out["emergency_flatten_drill_passed"] is True
    assert out["before_working_orders"] == 1
    assert out["before_open_positions"] == 1
    assert out["after_working_orders"] == 0
    assert out["after_open_positions"] == 0
    assert r.cancel_calls == 1 and r.flatten_calls == 1
