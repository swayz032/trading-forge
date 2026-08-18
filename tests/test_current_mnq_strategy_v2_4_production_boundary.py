from __future__ import annotations

import json

import pytest

from research import current_mnq_strategy_v2_4_promotion as promo
from research import current_mnq_strategy_v2_4_receipt as receipt
from research.current_mnq_strategy_v2_4_policy import load_spec, semantics_hash


def _payload(account_id=123, sem=None, edge=True):
    return {
        "schema_version": 1,
        "release": load_spec()["release_id"],
        "stage": load_spec()["deployment"]["promotion_stage_name"],
        "account_id": account_id,
        "semantics_sha256": sem or semantics_hash(),
        "edge_certified": edge,
        "architecture_receipt_sha256": "a" * 64,
        "sealed_report_sha256": "b" * 64,
        "shadow_journal_sha256": "c" * 64,
        "operations_drill_receipt_sha256": "d" * 64,
    }


def test_v24_receipt_verification_requires_current_semantics_and_certified_edge(tmp_path, monkeypatch):
    monkeypatch.setattr(receipt, "require_personal_device", lambda *a, **k: None)
    env = {"MNQ_V24_RELEASE_HMAC_KEY": "x" * 64}
    p = _payload()
    wrapper = {"payload": p, "hmac_sha256": receipt.sign_payload(p, env)}
    path = tmp_path / "r.json"; path.write_text(json.dumps(wrapper))
    assert receipt.verify_receipt(path, 123, env=env)["edge_certified"] is True

    stale = _payload(sem="0" * 64)
    path.write_text(json.dumps({"payload": stale, "hmac_sha256": receipt.sign_payload(stale, env)}))
    with pytest.raises(RuntimeError, match="SEMANTICS_STALE"):
        receipt.verify_receipt(path, 123, env=env)

    no_edge = _payload(edge=False)
    path.write_text(json.dumps({"payload": no_edge, "hmac_sha256": receipt.sign_payload(no_edge, env)}))
    with pytest.raises(RuntimeError, match="EDGE_NOT_CERTIFIED"):
        receipt.verify_receipt(path, 123, env=env)


def _artifacts(tmp_path, *, edge=True, shadow_sem=None):
    h = semantics_hash()
    arch = tmp_path / "arch.json"
    sealed = tmp_path / "sealed.json"
    shadow = tmp_path / "shadow.jsonl"
    drill = tmp_path / "drill.json"
    arch.write_text(json.dumps({"semantics_sha256": h, "tests": 100, "failures": 0}))
    sealed.write_text(json.dumps({
        "seal": {"semantics_sha256": h},
        "edge_certificate": {"certified_edge": edge},
        "evidence": {},
    }))
    shadow.write_text(json.dumps({
        "timestamp_utc": "2026-08-18T13:30:00+00:00",
        "session": "2026-08-18",
        "semantics_sha256": shadow_sem or h,
        "event_type": "HEARTBEAT",
    }) + "\n")
    drill.write_text(json.dumps({
        "semantics_sha256": h,
        "account_id": 123,
        "account_simulated_verified": True,
        "broker_reconciliation_verified": True,
        "emergency_flatten_drill_passed": True,
    }))
    return arch, sealed, shadow, drill


def test_promotion_identity_refuses_noncertified_edge_before_signing(tmp_path):
    arch, sealed, shadow, drill = _artifacts(tmp_path, edge=False)
    with pytest.raises(RuntimeError, match="SEALED_EDGE_NOT_CERTIFIED"):
        promo.validate_artifact_identity(
            account_id=123, architecture_receipt=arch, sealed_report=sealed,
            shadow_journal=shadow, operations_drill_receipt=drill,
        )


def test_promotion_identity_refuses_stale_shadow_version(tmp_path):
    arch, sealed, shadow, drill = _artifacts(tmp_path, edge=True, shadow_sem="1" * 64)
    with pytest.raises(RuntimeError, match="STALE_SEMANTICS:shadow_journal"):
        promo.validate_artifact_identity(
            account_id=123, architecture_receipt=arch, sealed_report=sealed,
            shadow_journal=shadow, operations_drill_receipt=drill,
        )
