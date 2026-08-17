from __future__ import annotations

import json

import pytest

from research.current_mnq_strategy_v2_3_account_risk import AccountRiskConfig, AccountRiskStore


def make_store(tmp_path):
    cfg = AccountRiskConfig(
        account_id=123,
        account_size_label="50K",
        starting_balance=50000.0,
        max_loss_distance=2000.0,
        platform_max_micros=50,
        min_same_stop_survival=3,
    )
    return AccountRiskStore(cfg, tmp_path / "risk.json")


def test_initial_and_trailing_floor_are_account_bound(tmp_path):
    store = make_store(tmp_path)
    state = store.load()
    assert state.highest_eod_balance == 50000.0
    assert store.trailing_floor(state) == 48000.0
    state = store.record_eod_balance("2026-08-17", 51000.0)
    assert state.highest_eod_balance == 51000.0
    assert store.trailing_floor(state) == 49000.0
    state = store.record_eod_balance("2026-08-18", 53000.0)
    assert store.trailing_floor(state) == 50000.0  # locked at starting balance


def test_eod_loss_never_moves_high_water_down(tmp_path):
    store = make_store(tmp_path)
    store.record_eod_balance("2026-08-17", 51000.0)
    state = store.record_eod_balance("2026-08-18", 50500.0)
    assert state.highest_eod_balance == 51000.0
    assert store.trailing_floor(state) == 49000.0


def test_envelope_uses_broker_balance_not_caller_supplied_number(tmp_path):
    store = make_store(tmp_path)
    env = store.envelope_from_broker_account({"id": 123, "canTrade": True, "balance": 50000.0})
    assert env.current_balance == 50000.0
    assert env.mll_floor == 48000.0
    with pytest.raises(RuntimeError, match="RISK_BROKER_ACCOUNT_MISMATCH"):
        store.envelope_from_broker_account({"id": 999, "canTrade": True, "balance": 50000.0})


def test_exhausted_mll_headroom_refuses(tmp_path):
    store = make_store(tmp_path)
    store.record_eod_balance("2026-08-17", 52000.0)  # floor locks to 50K
    with pytest.raises(RuntimeError, match="RISK_MLL_HEADROOM_EXHAUSTED"):
        store.envelope_from_broker_account({"id": 123, "canTrade": True, "balance": 50000.0})


def test_risk_state_tamper_fails_checksum(tmp_path):
    store = make_store(tmp_path)
    store.load()
    wrapper = json.loads(store.path.read_text())
    wrapper["payload"]["highest_eod_balance"] = 999999.0
    store.path.write_text(json.dumps(wrapper))
    with pytest.raises(RuntimeError, match="RISK_STATE_CHECKSUM_MISMATCH"):
        store.load()
