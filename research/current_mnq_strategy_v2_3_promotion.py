#!/usr/bin/env python3
"""Canonical artifact-only promotion signer for MNQ v2.3.

This is the ONLY operator-facing path that should create a ProjectX automation
receipt. It independently proves that every evidence artifact belongs to the
CURRENT semantic hash and intended account before evaluating the promotion gate.
"""
from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from research.current_mnq_strategy_v2_3_evidence import build_evidence
from research.current_mnq_strategy_v2_3_local_runtime import require_personal_device
from research.current_mnq_strategy_v2_3_policy import live_gate, semantics_hash
from research.current_mnq_strategy_v2_3_receipt import _sign_payload, file_sha256
from research.current_mnq_strategy_v2_3_shadow import read_events


def _load(path: str | Path, name: str) -> dict:
    p = Path(path)
    if not p.exists() or not p.is_file():
        raise RuntimeError(f"PROMOTION_ARTIFACT_MISSING:{name}")
    try:
        return json.loads(p.read_text())
    except Exception as exc:
        raise RuntimeError(f"PROMOTION_ARTIFACT_CORRUPT:{name}") from exc


def _require_current_semantics(value: str | None, name: str) -> None:
    if value != semantics_hash():
        raise RuntimeError(f"PROMOTION_STALE_SEMANTICS:{name}")


def validate_artifact_identity(*, account_id: int,
                               architecture_receipt: str | Path,
                               sealed_report: str | Path,
                               shadow_journal: str | Path,
                               operations_drill_receipt: str | Path) -> dict:
    arch = _load(architecture_receipt, "architecture_receipt")
    sealed = _load(sealed_report, "sealed_report")
    drill = _load(operations_drill_receipt, "operations_drill_receipt")
    _require_current_semantics(arch.get("semantics_sha256"), "architecture_receipt")
    _require_current_semantics(sealed.get("seal", {}).get("semantics_sha256"), "sealed_report")
    _require_current_semantics(drill.get("semantics_sha256"), "operations_drill_receipt")
    if int(drill.get("account_id", -1)) != int(account_id):
        raise RuntimeError("PROMOTION_DRILL_ACCOUNT_MISMATCH")
    if drill.get("account_simulated_verified") is not True:
        raise RuntimeError("PROMOTION_DRILL_NOT_SIMULATED")

    shadow_path = Path(shadow_journal)
    if not shadow_path.exists() or not shadow_path.is_file():
        raise RuntimeError("PROMOTION_ARTIFACT_MISSING:shadow_journal")
    events = read_events(shadow_path)
    if not events:
        raise RuntimeError("PROMOTION_SHADOW_EMPTY")
    bad = [r for r in events if r.get("semantics_sha256") != semantics_hash()]
    if bad:
        raise RuntimeError(f"PROMOTION_STALE_SEMANTICS:shadow_journal:{len(bad)}")
    return {"arch": arch, "sealed": sealed, "drill": drill, "shadow_events": len(events)}


def create_strict_receipt(*, account_id: int,
                          architecture_receipt: str | Path,
                          sealed_report: str | Path,
                          shadow_journal: str | Path,
                          operations_drill_receipt: str | Path,
                          output: str | Path,
                          env: dict[str, str] | None = None) -> dict:
    require_personal_device("CREATE_STRICT_AUTOMATION_PROMOTION_RECEIPT", env)
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
        raise RuntimeError("STRICT_AUTOMATION_PROMOTION_REFUSE:" + "|".join(gate.reasons))
    payload = {
        "schema_version": 2,
        "release": "MNQ-V2.3-PC1",
        "stage": gate.stage,
        "account_id": int(account_id),
        "semantics_sha256": semantics_hash(),
        "architecture_receipt_sha256": file_sha256(architecture_receipt),
        "sealed_report_sha256": file_sha256(sealed_report),
        "shadow_journal_sha256": file_sha256(shadow_journal),
        "operations_drill_receipt_sha256": file_sha256(operations_drill_receipt),
        "evidence": asdict(evidence),
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "creator": "current_mnq_strategy_v2_3_promotion.create_strict_receipt",
    }
    wrapper = {"payload": payload, "hmac_sha256": _sign_payload(payload, env)}
    out = Path(output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(wrapper, indent=2, sort_keys=True))
    return wrapper
