#!/usr/bin/env python3
"""Locally signed TopstepX API automation-promotion receipt for MNQ v2.3.

A production receipt is derived ONLY from immutable evidence artifacts. Callers
cannot pass a hand-constructed Evidence object to manufacture eligibility. The
HMAC key is local-only and never stored in GitHub.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from research.current_mnq_strategy_v2_3_evidence import build_evidence
from research.current_mnq_strategy_v2_3_local_runtime import require_personal_device
from research.current_mnq_strategy_v2_3_policy import live_gate, load_spec, semantics_hash

KEY_ENV = "MNQ_V23_RELEASE_HMAC_KEY"


def _key(env: dict[str, str] | None = None) -> bytes:
    e = os.environ if env is None else env
    key = str(e.get(KEY_ENV, "")).encode()
    if len(key) < 32:
        raise RuntimeError("RELEASE_HMAC_KEY_MISSING_OR_TOO_SHORT")
    return key


def _canonical(obj: dict) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str).encode()


def _sign_payload(payload: dict, env: dict[str, str] | None = None) -> str:
    return hmac.new(_key(env), _canonical(payload), hashlib.sha256).hexdigest()


def file_sha256(path: str | Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def create_receipt_from_artifacts(*, account_id: int,
                                  architecture_receipt: str | Path,
                                  sealed_report: str | Path,
                                  shadow_journal: str | Path,
                                  operations_drill_receipt: str | Path,
                                  output: str | Path,
                                  env: dict[str, str] | None = None) -> dict:
    """Create an automation receipt only when the actual artifacts pass every gate."""
    require_personal_device("CREATE_AUTOMATION_PROMOTION_RECEIPT", env)
    required_paths = {
        "architecture_receipt": Path(architecture_receipt),
        "sealed_report": Path(sealed_report),
        "shadow_journal": Path(shadow_journal),
        "operations_drill_receipt": Path(operations_drill_receipt),
    }
    for name, p in required_paths.items():
        if not p.exists() or not p.is_file():
            raise RuntimeError(f"PROMOTION_ARTIFACT_MISSING:{name}")

    evidence = build_evidence(
        architecture_receipt=required_paths["architecture_receipt"],
        sealed_report=required_paths["sealed_report"],
        shadow_journal=required_paths["shadow_journal"],
        operations_drill_receipt=required_paths["operations_drill_receipt"],
    )
    gate = live_gate(evidence)
    if not gate.approved:
        raise RuntimeError("AUTOMATION_PROMOTION_REFUSE:" + "|".join(gate.reasons))

    payload = {
        "schema_version": 2,
        "release": "MNQ-V2.3-PC1",
        "stage": gate.stage,
        "account_id": int(account_id),
        "semantics_sha256": semantics_hash(),
        "architecture_receipt_sha256": file_sha256(required_paths["architecture_receipt"]),
        "sealed_report_sha256": file_sha256(required_paths["sealed_report"]),
        "shadow_journal_sha256": file_sha256(required_paths["shadow_journal"]),
        "operations_drill_receipt_sha256": file_sha256(required_paths["operations_drill_receipt"]),
        "evidence": asdict(evidence),
        "created_utc": datetime.now(timezone.utc).isoformat(),
    }
    wrapper = {"payload": payload, "hmac_sha256": _sign_payload(payload, env)}
    out = Path(output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(wrapper, indent=2, sort_keys=True))
    return wrapper


def verify_receipt(path: str | Path, account_id: int,
                   env: dict[str, str] | None = None) -> dict:
    require_personal_device("VERIFY_AUTOMATION_PROMOTION_RECEIPT", env)
    wrapper = json.loads(Path(path).read_text())
    payload = wrapper.get("payload")
    if not isinstance(payload, dict):
        raise RuntimeError("PROMOTION_RECEIPT_PAYLOAD_MISSING")
    expected = _sign_payload(payload, env)
    if not hmac.compare_digest(str(wrapper.get("hmac_sha256", "")), expected):
        raise RuntimeError("PROMOTION_RECEIPT_SIGNATURE_INVALID")
    if int(payload.get("schema_version", -1)) != 2:
        raise RuntimeError("PROMOTION_RECEIPT_SCHEMA_MISMATCH")
    if payload.get("semantics_sha256") != semantics_hash():
        raise RuntimeError("PROMOTION_RECEIPT_SEMANTICS_STALE")
    if int(payload.get("account_id", -1)) != int(account_id):
        raise RuntimeError("PROMOTION_RECEIPT_ACCOUNT_MISMATCH")
    required_stage = load_spec()["deployment"]["promotion_stage_name"]
    if payload.get("stage") != required_stage:
        raise RuntimeError("PROMOTION_RECEIPT_NOT_AUTOMATION_ELIGIBLE")
    required_hash_fields = (
        "architecture_receipt_sha256", "sealed_report_sha256",
        "shadow_journal_sha256", "operations_drill_receipt_sha256",
    )
    if any(len(str(payload.get(k, ""))) != 64 for k in required_hash_fields):
        raise RuntimeError("PROMOTION_RECEIPT_EVIDENCE_HASH_MISSING")
    return payload
