#!/usr/bin/env python3
"""Canonical device-bound production surface for MNQ v2.3.

Operator code should import THIS module, not assemble lower-level research pieces.
It binds the signed promotion receipt to the enrolled personal machine and checks
that binding again before any automation runtime is constructed.
"""
from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from research.current_mnq_strategy_v2_3_account_risk import AccountRiskStore
from research.current_mnq_strategy_v2_3_automation_runtime import AutomationRuntime
from research.current_mnq_strategy_v2_3_device import verify_device
from research.current_mnq_strategy_v2_3_evidence import build_evidence
from research.current_mnq_strategy_v2_3_policy import live_gate, semantics_hash
from research.current_mnq_strategy_v2_3_promotion import validate_artifact_identity
from research.current_mnq_strategy_v2_3_receipt import (
    _sign_payload, file_sha256, verify_receipt,
)
from research.current_mnq_strategy_v2_3_shadow_runtime import ShadowRuntime


def create_device_bound_promotion_receipt(*, account_id: int,
                                          device_enrollment: str | Path,
                                          architecture_receipt: str | Path,
                                          sealed_report: str | Path,
                                          shadow_journal: str | Path,
                                          operations_drill_receipt: str | Path,
                                          output: str | Path) -> dict:
    verify_device(device_enrollment)
    validate_artifact_identity(
        account_id=account_id,
        architecture_receipt=architecture_receipt,
        sealed_report=sealed_report,
        shadow_journal=shadow_journal,
        operations_drill_receipt=operations_drill_receipt,
    )
    evidence = build_evidence(
        architecture_receipt=architecture_receipt,
        sealed_report=sealed_report,
        shadow_journal=shadow_journal,
        operations_drill_receipt=operations_drill_receipt,
    )
    gate = live_gate(evidence)
    if not gate.approved:
        raise RuntimeError("DEVICE_BOUND_PROMOTION_REFUSE:" + "|".join(gate.reasons))
    payload = {
        "schema_version": 2,
        "release": "MNQ-V2.3-PC1",
        "stage": gate.stage,
        "account_id": int(account_id),
        "semantics_sha256": semantics_hash(),
        "device_enrollment_sha256": file_sha256(device_enrollment),
        "architecture_receipt_sha256": file_sha256(architecture_receipt),
        "sealed_report_sha256": file_sha256(sealed_report),
        "shadow_journal_sha256": file_sha256(shadow_journal),
        "operations_drill_receipt_sha256": file_sha256(operations_drill_receipt),
        "evidence": asdict(evidence),
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "creator": "current_mnq_strategy_v2_3_production.create_device_bound_promotion_receipt",
    }
    wrapper = {"payload": payload, "hmac_sha256": _sign_payload(payload, None)}
    out = Path(output); out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(wrapper, indent=2, sort_keys=True))
    return wrapper


def verify_device_bound_receipt(path: str | Path, *, account_id: int,
                                device_enrollment: str | Path) -> dict:
    verify_device(device_enrollment)
    payload = verify_receipt(path, account_id)
    expected = file_sha256(device_enrollment)
    if payload.get("device_enrollment_sha256") != expected:
        raise RuntimeError("PROMOTION_RECEIPT_DEVICE_BINDING_MISMATCH")
    return payload


class ProductionAutomation:
    def __init__(self, *, account_id: int, device_enrollment: str | Path,
                 promotion_receipt: str | Path, risk_store: AccountRiskStore,
                 **runtime_kwargs):
        verify_device_bound_receipt(
            promotion_receipt, account_id=account_id,
            device_enrollment=device_enrollment,
        )
        self.runtime = AutomationRuntime(
            account_id=account_id,
            risk_store=risk_store,
            promotion_receipt=promotion_receipt,
            **runtime_kwargs,
        )

    def evaluate_once(self, *args, **kwargs):
        return self.runtime.evaluate_once(*args, **kwargs)

    def reconcile_restart(self, *args, **kwargs):
        return self.runtime.reconcile_restart(*args, **kwargs)


class ProductionShadow:
    def __init__(self, *, device_enrollment: str | Path, **runtime_kwargs):
        verify_device(device_enrollment)
        self.runtime = ShadowRuntime(**runtime_kwargs)

    def step(self, *args, **kwargs):
        return self.runtime.step(*args, **kwargs)

    def replay_session(self, *args, **kwargs):
        return self.runtime.replay_session(*args, **kwargs)

    def run_until_window_end(self, *args, **kwargs):
        return self.runtime.run_until_window_end(*args, **kwargs)
