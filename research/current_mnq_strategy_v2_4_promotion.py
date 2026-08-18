#!/usr/bin/env python3
"""Canonical artifact-only promotion signer for Current MNQ v2.4."""
from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from research.current_mnq_strategy_v2_3_local_runtime import require_personal_device
from research.current_mnq_strategy_v2_3_shadow import read_events
from research.current_mnq_strategy_v2_4_evidence import build_evidence
from research.current_mnq_strategy_v2_4_policy import live_gate, load_spec, semantics_hash
from research.current_mnq_strategy_v2_4_receipt import file_sha256, sign_payload


def _load(path: str | Path, name: str) -> dict:
    p = Path(path)
    if not p.exists() or not p.is_file():
        raise RuntimeError(f"V24_PROMOTION_ARTIFACT_MISSING:{name}")
    try:
        return json.loads(p.read_text())
    except Exception as exc:
        raise RuntimeError(f"V24_PROMOTION_ARTIFACT_CORRUPT:{name}") from exc


def _require_current_hash(value: str | None, name: str) -> None:
    if value != semantics_hash():
        raise RuntimeError(f"V24_PROMOTION_STALE_SEMANTICS:{name}")


def validate_artifact_identity(*, account_id: int,
                               architecture_receipt: str | Path,
                               sealed_report: str | Path,
                               shadow_journal: str | Path,
                               operations_drill_receipt: str | Path) -> dict:
    arch = _load(architecture_receipt, "architecture_receipt")
    sealed = _load(sealed_report, "sealed_report")
    drill = _load(operations_drill_receipt, "operations_drill_receipt")
    _require_current_hash(arch.get("semantics_sha256"), "architecture_receipt")
    _require_current_hash(sealed.get("seal", {}).get("semantics_sha256"), "sealed_report")
    _require_current_hash(drill.get("semantics_sha256"), "operations_drill_receipt")
    if sealed.get("edge_certificate", {}).get("certified_edge") is not True:
        raise RuntimeError("V24_PROMOTION_SEALED_EDGE_NOT_CERTIFIED")
    if int(drill.get("account_id", -1)) != int(account_id):
        raise RuntimeError("V24_PROMOTION_DRILL_ACCOUNT_MISMATCH")
    if drill.get("account_simulated_verified") is not True:
        raise RuntimeError("V24_PROMOTION_DRILL_NOT_SIMULATED")

    shadow_path = Path(shadow_journal)
    if not shadow_path.exists() or not shadow_path.is_file():
        raise RuntimeError("V24_PROMOTION_ARTIFACT_MISSING:shadow_journal")
    events = read_events(shadow_path)
    if not events:
        raise RuntimeError("V24_PROMOTION_SHADOW_EMPTY")
    stale = [x for x in events if x.get("semantics_sha256") != semantics_hash()]
    if stale:
        raise RuntimeError(f"V24_PROMOTION_STALE_SEMANTICS:shadow_journal:{len(stale)}")
    return {"arch": arch, "sealed": sealed, "drill": drill, "shadow_events": len(events)}


def create_strict_receipt(*, account_id: int,
                          architecture_receipt: str | Path,
                          sealed_report: str | Path,
                          shadow_journal: str | Path,
                          operations_drill_receipt: str | Path,
                          output: str | Path,
                          env: dict[str, str] | None = None) -> dict:
    require_personal_device("CREATE_V24_STRICT_AUTOMATION_PROMOTION_RECEIPT", env)
    validate_artifact_identity(
        account_id=account_id, architecture_receipt=architecture_receipt,
        sealed_report=sealed_report, shadow_journal=shadow_journal,
        operations_drill_receipt=operations_drill_receipt,
    )
    evidence = build_evidence(
        architecture_receipt=architecture_receipt, sealed_report=sealed_report,
        shadow_journal=shadow_journal, operations_drill_receipt=operations_drill_receipt,
    )
    gate = live_gate(evidence)
    if not gate.approved:
        raise RuntimeError("V24_STRICT_AUTOMATION_PROMOTION_REFUSE:" + "|".join(gate.reasons))
    payload = {
        "schema_version": 1,
        "release": load_spec()["release_id"],
        "stage": gate.stage,
        "account_id": int(account_id),
        "semantics_sha256": semantics_hash(),
        "edge_certified": True,
        "robust_edge_expectancy": evidence.robust_edge_expectancy,
        "architecture_receipt_sha256": file_sha256(architecture_receipt),
        "sealed_report_sha256": file_sha256(sealed_report),
        "shadow_journal_sha256": file_sha256(shadow_journal),
        "operations_drill_receipt_sha256": file_sha256(operations_drill_receipt),
        "evidence": asdict(evidence),
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "creator": "current_mnq_strategy_v2_4_promotion.create_strict_receipt",
    }
    wrapper = {"payload": payload, "hmac_sha256": sign_payload(payload, env)}
    out = Path(output); out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(wrapper, indent=2, sort_keys=True))
    return wrapper
