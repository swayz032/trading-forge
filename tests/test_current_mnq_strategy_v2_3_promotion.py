from __future__ import annotations

import json

import pytest

from research import current_mnq_strategy_v2_3_promotion as promo
from research.current_mnq_strategy_v2_3_policy import semantics_hash


def artifacts(tmp_path, *, shadow_hash=None, drill_account=123):
    h = semantics_hash()
    arch = tmp_path / "arch.json"
    sealed = tmp_path / "sealed.json"
    shadow = tmp_path / "shadow.jsonl"
    drill = tmp_path / "drill.json"
    arch.write_text(json.dumps({"semantics_sha256": h, "tests": 99, "failures": 0}))
    sealed.write_text(json.dumps({"seal": {"semantics_sha256": h}, "evidence": {}}))
    shadow.write_text(json.dumps({
        "timestamp_utc": "2026-08-17T13:30:00+00:00",
        "session": "2026-08-17",
        "semantics_sha256": shadow_hash or h,
        "event_type": "HEARTBEAT",
        "account_simulated": True,
        "user_hub_connected": True,
        "market_hub_connected": True,
        "working_orders": 0,
        "broker_position": 0,
    }) + "\n")
    drill.write_text(json.dumps({
        "semantics_sha256": h,
        "account_id": drill_account,
        "account_simulated_verified": True,
        "broker_reconciliation_verified": True,
        "emergency_flatten_drill_passed": True,
    }))
    return arch, sealed, shadow, drill


def test_artifact_identity_accepts_current_semantics_and_account(tmp_path):
    arch, sealed, shadow, drill = artifacts(tmp_path)
    out = promo.validate_artifact_identity(
        account_id=123, architecture_receipt=arch, sealed_report=sealed,
        shadow_journal=shadow, operations_drill_receipt=drill,
    )
    assert out["shadow_events"] == 1


def test_artifact_identity_refuses_stale_shadow_semantics(tmp_path):
    arch, sealed, shadow, drill = artifacts(tmp_path, shadow_hash="0" * 64)
    with pytest.raises(RuntimeError, match="PROMOTION_STALE_SEMANTICS:shadow_journal"):
        promo.validate_artifact_identity(
            account_id=123, architecture_receipt=arch, sealed_report=sealed,
            shadow_journal=shadow, operations_drill_receipt=drill,
        )


def test_artifact_identity_refuses_wrong_drill_account(tmp_path):
    arch, sealed, shadow, drill = artifacts(tmp_path, drill_account=999)
    with pytest.raises(RuntimeError, match="PROMOTION_DRILL_ACCOUNT_MISMATCH"):
        promo.validate_artifact_identity(
            account_id=123, architecture_receipt=arch, sealed_report=sealed,
            shadow_journal=shadow, operations_drill_receipt=drill,
        )


def test_strict_receipt_cannot_pass_with_incomplete_real_evidence(tmp_path, monkeypatch):
    arch, sealed, shadow, drill = artifacts(tmp_path)
    monkeypatch.setattr(promo, "require_personal_device", lambda *a, **k: None)
    with pytest.raises(RuntimeError, match="STRICT_AUTOMATION_PROMOTION_REFUSE"):
        promo.create_strict_receipt(
            account_id=123, architecture_receipt=arch, sealed_report=sealed,
            shadow_journal=shadow, operations_drill_receipt=drill,
            output=tmp_path / "receipt.json",
            env={"MNQ_V23_RELEASE_HMAC_KEY": "x" * 64},
        )
