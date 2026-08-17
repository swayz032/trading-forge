from __future__ import annotations

import json
from dataclasses import replace
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from research import current_mnq_strategy_v2_3_broker as broker
from research import current_mnq_strategy_v2_3_data as data
from research import current_mnq_strategy_v2_3_engine as eng
from research import current_mnq_strategy_v2_3_local_runtime as locality
from research import current_mnq_strategy_v2_3_oos as oos
from research import current_mnq_strategy_v2_3_policy as policy
from research import current_mnq_strategy_v2_3_receipt as receipt
from research import current_mnq_strategy_v2_3_shadow as shadow
from research import current_mnq_strategy_v2_3_state as state
from research import current_mnq_strategy_v2_3_topstep_risk as risk


def green_evidence(**changes):
    spec = policy.load_spec()
    base = policy.Evidence(
        semantics_sha256=policy.semantics_hash(),
        architecture_tests_passed=30,
        architecture_tests_failed=0,
        real_user_positive_gold=spec["evidence_policy"]["real_user_positive_gold_min"],
        semantic_negative_fixtures=spec["evidence_policy"]["semantic_negative_fixture_min"],
        real_user_tempting_no_trade_gold=spec["evidence_policy"]["real_user_tempting_no_trade_gold_min"],
        contract_provenance_pass=True,
        data_quality_pass=True,
        sealed_calendar_years=4.0,
        sealed_sessions=700,
        sealed_trades=150,
        chronological_folds=4,
        positive_folds=4,
        block_bootstrap_mean_lower_95=1.0,
        slippage_stress_net={"0.5": 1000.0, "1": 800.0, "2": 400.0},
        sealed_rules_changed_after_run=False,
        shadow_full_sessions=10,
        shadow_trades=5,
        shadow_rule_changes=0,
        shadow_duplicate_order_events=0,
        shadow_unreconciled_state_events=0,
        shadow_signal_parity_mismatches=0,
        personal_device_verified=True,
        realtime_user_hub_verified=True,
        realtime_market_hub_verified=True,
        broker_reconciliation_verified=True,
        emergency_flatten_drill_passed=True,
    )
    return replace(base, **changes)


def test_spec_freezes_ten_named_negative_semantics():
    spec = policy.load_spec()
    assert spec["release_id"] == "MNQ-V2.3-PC1"
    assert len(spec["negative_semantic_fixtures"]) == 10
    assert len(policy.semantics_hash()) == 64


def test_fidelity_gate_refuses_without_real_user_no_trade_gold():
    ev = green_evidence(real_user_tempting_no_trade_gold=0)
    result = policy.research_gate(ev)
    assert not result.approved
    assert "MISSING_REAL_USER_NO_TRADE_GOLD" in result.reasons


def test_live_gate_requires_every_prior_evidence_layer():
    assert policy.live_gate(green_evidence()).approved
    bad = green_evidence(block_bootstrap_mean_lower_95=-0.01)
    result = policy.live_gate(bad)
    assert not result.approved
    assert "EXPECTANCY_LOWER_95_NOT_POSITIVE" in result.reasons


def test_runtime_refuses_github_actions_for_credentialed_operations():
    with pytest.raises(RuntimeError, match="REMOTE_RUNTIME_REFUSE"):
        locality.require_personal_device("LIVE", {"GITHUB_ACTIONS": "true"})
    assert locality.require_personal_device("LOCAL", {}).personal_device_candidate


def test_live_arming_phrase_is_exact():
    with pytest.raises(RuntimeError, match="LIVE_ARMING_PHRASE_MISSING"):
        locality.require_live_arming_phrase({})
    locality.require_live_arming_phrase({"MNQ_V23_LIVE_ARM": "I_ACCEPT_LIVE_ORDER_RISK"})


def test_two_phase_ledger_reserves_before_submission_and_never_releases_bullet(tmp_path):
    led = state.PersistentSessionLedger(tmp_path / "state.json")
    s = led.reserve("2026-08-17", "tag-a", 15)
    assert s.phase == state.TradePhase.RESERVED.value
    assert s.bullet_consumed
    with pytest.raises(RuntimeError, match="REFUSE_SECOND_TRADE"):
        led.reserve("2026-08-17", "tag-b", 15)
    s = led.mark_submitted("2026-08-17", "tag-a", "123")
    assert s.phase == state.TradePhase.SUBMITTED.value
    s = led.mark_fill("2026-08-17", 7, 7)
    assert s.phase == state.TradePhase.PARTIAL.value
    s = led.mark_fill("2026-08-17", 15, 15)
    assert s.phase == state.TradePhase.FILLED.value
    s = led.mark_closed("2026-08-17")
    assert s.phase == state.TradePhase.CLOSED.value
    with pytest.raises(RuntimeError, match="REFUSE_SECOND_TRADE"):
        led.reserve("2026-08-17", "tag-c", 1)


def test_state_checksum_corruption_fails_closed(tmp_path):
    p = tmp_path / "state.json"
    led = state.PersistentSessionLedger(p)
    led.reserve("2026-08-17", "tag", 1)
    wrapper = json.loads(p.read_text())
    wrapper["payload"]["requested_qty"] = 99
    p.write_text(json.dumps(wrapper))
    with pytest.raises(RuntimeError, match="CHECKSUM_MISMATCH"):
        led.load("2026-08-17")


def test_topstep_survival_sizing_allows_15_only_when_headroom_can_survive_three_stops():
    env = risk.RiskEnvelope("50K", current_balance=50000, mll_floor=48000, platform_max_micros=50)
    d = risk.survival_safe_qty(15, env, stop_points=17.25, slippage_points=2.0)
    assert d.approved and d.safe_qty == 15
    damaged = risk.RiskEnvelope("50K", current_balance=49400, mll_floor=48000, platform_max_micros=50)
    d2 = risk.survival_safe_qty(15, damaged, stop_points=17.25, slippage_points=2.0)
    assert d2.approved and 0 < d2.safe_qty < 15
    assert "SIZE_REDUCED_TO_PRESERVE_SURVIVAL_HEADROOM" in d2.reasons


def test_contract_windows_cross_march_2026_roll_with_overlap():
    wins = data.contract_windows(date(2026, 3, 1), date(2026, 4, 1), overlap_days=7)
    ids = [w.contract_id for w in wins]
    assert "CON.F.US.MNQ.H26" in ids
    assert "CON.F.US.MNQ.M26" in ids
    assert wins[0].end >= date(2026, 3, 20)
    assert wins[1].start <= date(2026, 3, 9)


def _minute_fixture(contract: str, day: str, offset: float) -> pd.DataFrame:
    idx = pd.date_range(f"{day} 19:30:00+00:00", periods=30, freq="1min")  # 15:30 ET in EDT
    base = np.arange(30, dtype=float) * 0.25 + 20000.0 + offset
    return pd.DataFrame({
        "datetime": idx, "open": base, "high": base + 0.25, "low": base - 0.25,
        "close": base, "volume": 10, "contract_id": contract,
    })


def test_roll_bridge_uses_overlap_basis_and_forward_adjust_removes_gap():
    old = _minute_fixture("CON.F.US.MNQ.H26", "2026-03-13", 0.0)
    new = _minute_fixture("CON.F.US.MNQ.M26", "2026-03-13", 10.0)
    br = data.compute_roll_bridge(old, new, date(2026, 3, 16))
    assert br.shared_minutes == 30
    assert br.raw_gap_new_minus_old == 10.0
    lead = pd.concat([
        old.iloc[:1].assign(session=date(2026, 3, 13)),
        new.iloc[:1].assign(datetime=pd.to_datetime(["2026-03-16 13:30:00+00:00"]), session=date(2026, 3, 16)),
    ], ignore_index=True)
    out = data.forward_adjust(lead, [br])
    assert out.iloc[0].price_adjustment == 0.0
    assert out.iloc[1].price_adjustment == -10.0
    assert out.iloc[1].open == out.iloc[1].raw_open - 10.0


def test_derive_5m_is_exact_ohlc_aggregation():
    one = _minute_fixture("CON.F.US.MNQ.M26", "2026-03-13", 0.0).iloc[:5].copy()
    one["price_adjustment"] = 0.0
    five = data.derive_5m(one)
    assert len(five) == 1
    assert five.iloc[0].open == one.iloc[0].open
    assert five.iloc[0].close == one.iloc[-1].close
    assert five.iloc[0].high == one.high.max()
    assert five.iloc[0].low == one.low.min()


def test_block_bootstrap_is_deterministic_and_negative_edge_stays_negative():
    x = np.array([-100.0, -50.0, 20.0, -10.0, 5.0] * 10)
    a = oos.moving_block_bootstrap_mean(x, paths=500, seed=123)
    b = oos.moving_block_bootstrap_mean(x, paths=500, seed=123)
    assert a == b
    assert a["median"] < 0


def test_slippage_stress_is_monotone_and_does_not_add_fake_profit():
    led = pd.DataFrame({"net_pnl": [100.0, -20.0, 50.0]})
    s = oos.slippage_stress(led, [0.5, 1.0, 2.0])
    assert s["0.5"] == 130.0
    assert s["0.5"] > s["1"] > s["2"]


def test_engine_wrapper_restores_raw_contract_prices_and_provenance(monkeypatch):
    d = date(2026, 3, 23)
    base_row = {
        "session": str(d), "entry": 20000.0, "stop": 19982.75, "target": 20040.0,
        "target_raw": 20040.0, "exit_price": 20040.0, "entry_raw_open": 20000.0,
        "side": "LONG", "setup": "BRK5", "net_pnl": 1.0,
    }
    monkeypatch.setattr(eng.core, "run_day", lambda env, dte, p: dict(base_row))
    env = {
        "contract_by_session": {d: "CON.F.US.MNQ.M26"},
        "adjustment_by_session": {d: -10.0},
        "dataset_manifest": {"dataset_sha256": "abc"},
    }
    row = eng.run_day(env, d, eng.Params())
    assert row["entry"] == 20010.0
    assert row["contract_id"] == "CON.F.US.MNQ.M26"
    assert row["analysis_entry"] == 20000.0
    assert row["semantics_sha256"] == policy.semantics_hash()


def test_engine_wrapper_refuses_missing_session_contract(monkeypatch):
    d = date(2026, 3, 23)
    monkeypatch.setattr(eng.core, "run_day", lambda env, dte, p: {"session": str(d), "entry": 1})
    with pytest.raises(RuntimeError, match="SESSION_CONTRACT_PROVENANCE_MISSING"):
        eng.run_day({"contract_by_session": {}, "adjustment_by_session": {}, "dataset_manifest": {}}, d, eng.Params())


def test_broker_payload_has_server_side_stop_and_limit_target():
    obj = object.__new__(broker.V23ProjectXBroker)
    obj.account_id = 7
    sig = {
        "session": "2026-08-17", "side": "LONG", "entry": 23000.0,
        "stop": 22982.75, "target": 23040.0, "contract_id": "CON.F.US.MNQ.U26",
    }
    payload = obj.build_order(sig, 15, {"tickSize": 0.25}, "tag")
    assert payload["stopLossBracket"] == {"ticks": 69, "type": broker.ORDER_STOP}
    assert payload["takeProfitBracket"] == {"ticks": 160, "type": broker.ORDER_LIMIT}
    assert payload["size"] == 15


def test_broker_refuses_bad_long_bracket_geometry():
    obj = object.__new__(broker.V23ProjectXBroker)
    obj.account_id = 7
    sig = {"side": "LONG", "entry": 100.0, "stop": 101.0, "target": 110.0, "contract_id": "x"}
    with pytest.raises(RuntimeError, match="LONG_BRACKET_GEOMETRY_INVALID"):
        obj.build_order(sig, 1, {"tickSize": 0.25}, "tag")


def test_client_tag_is_deterministic_and_changes_with_signal():
    a = {"session": "2026-08-17", "side": "LONG", "signal_time": "x", "confirmed_time": "y", "contract_id": "c"}
    assert broker.client_tag(a) == broker.client_tag(a)
    b = dict(a, side="SHORT")
    assert broker.client_tag(a) != broker.client_tag(b)


def test_shadow_summary_detects_rule_change_and_parity_mismatch(tmp_path):
    p = tmp_path / "shadow.jsonl"
    rows = [
        {"event_type": "DECISION", "session": "2026-08-17", "semantics_sha256": "a", "would_trade": True,
         "user_hub_connected": True, "market_hub_connected": True, "working_orders": 0, "broker_position": 0},
        {"event_type": "DECISION", "session": "2026-08-18", "semantics_sha256": "b", "would_trade": False,
         "user_hub_connected": True, "market_hub_connected": True, "working_orders": 0, "broker_position": 0},
        {"event_type": "REPLAY_PARITY", "session": "2026-08-17", "semantics_sha256": "a",
         "signal_fingerprint": "x", "replay_signal_fingerprint": "y"},
    ]
    p.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    s = shadow.summarize_shadow(p)
    assert s["full_sessions"] == 2
    assert s["rule_changes"] == 1
    assert s["signal_parity_mismatches"] == 1


def test_signed_receipt_is_account_and_semantics_bound(tmp_path):
    sealed = tmp_path / "sealed.json"; sealed.write_text("sealed")
    journal = tmp_path / "shadow.jsonl"; journal.write_text("shadow")
    out = tmp_path / "receipt.json"
    env = {"MNQ_V23_RELEASE_HMAC_KEY": "k" * 64}
    wrapper = receipt.create_receipt(green_evidence(), 123, sealed, journal, out, env=env)
    assert wrapper["payload"]["stage"] == "LIVE_ELIGIBLE"
    assert receipt.verify_receipt(out, 123, env=env)["account_id"] == 123
    with pytest.raises(RuntimeError, match="ACCOUNT_MISMATCH"):
        receipt.verify_receipt(out, 124, env=env)


def test_signed_receipt_tamper_is_detected(tmp_path):
    sealed = tmp_path / "sealed.json"; sealed.write_text("sealed")
    journal = tmp_path / "shadow.jsonl"; journal.write_text("shadow")
    out = tmp_path / "receipt.json"
    env = {"MNQ_V23_RELEASE_HMAC_KEY": "z" * 64}
    receipt.create_receipt(green_evidence(), 123, sealed, journal, out, env=env)
    w = json.loads(out.read_text())
    w["payload"]["account_id"] = 999
    out.write_text(json.dumps(w))
    with pytest.raises(RuntimeError, match="SIGNATURE_INVALID"):
        receipt.verify_receipt(out, 999, env=env)
