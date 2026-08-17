from pathlib import Path

import pytest

from research import current_mnq_strategy_v2_2_live_safety as s


class FakeBroker:
    def __init__(self, pos=0, orders=None):
        self.pos = pos
        self.orders = orders or []
        self.cancelled = False
        self.flattened = False
    def get_open_position(self): return self.pos
    def get_working_orders(self): return self.orders
    def cancel_all(self): self.cancelled = True
    def flatten(self): self.flattened = True


def test_persistent_one_trade_lock_survives_restart(tmp_path):
    path = tmp_path / "state.json"
    lock = s.PersistentOneTradeLock(path)
    st = lock.load("2026-08-17")
    lock.mark_trade(st, "id1", 15)
    lock2 = s.PersistentOneTradeLock(path)
    recovered = lock2.load("2026-08-17")
    assert recovered.traded
    with pytest.raises(RuntimeError, match="REFUSE_SECOND_TRADE"):
        lock2.mark_trade(recovered, "id2", 15)


def test_restart_with_open_position_disables(tmp_path):
    lock = s.PersistentOneTradeLock(tmp_path / "state.json")
    broker = FakeBroker(pos=15)
    st = s.reconcile_after_restart(lock, "2026-08-17", broker)
    assert st.traded and st.disabled


def test_preflight_kill_switches():
    st = s.SessionState("2026-08-17")
    reasons = s.preflight_refuse_reasons(st, broker_position=0, requested_qty=16,
        daily_realized_unrealized=-1500, feed_age_seconds=30,
        estimated_slippage_points=5, contract_identity_confirmed=False)
    assert {"SIZE_LIMIT","DAILY_LOSS_KILL","STALE_DATA","SLIPPAGE_CIRCUIT_BREAKER","CONTRACT_IDENTITY_AMBIGUOUS"}.issubset(reasons)


def test_emergency_disable_cancels_and_flattens(tmp_path):
    lock = s.PersistentOneTradeLock(tmp_path / "state.json")
    st = s.SessionState("2026-08-17")
    b = FakeBroker(pos=1)
    s.emergency_disable(lock, st, "MANUAL", b)
    assert b.cancelled and b.flattened
    assert lock.load("2026-08-17").disabled


def test_live_orders_refused_without_validated_adapter():
    with pytest.raises(RuntimeError, match="LIVE_ORDER_REFUSED"):
        s.RefuseLiveWithoutBrokerAdapter().submit()
