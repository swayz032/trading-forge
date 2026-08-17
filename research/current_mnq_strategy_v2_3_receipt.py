#!/usr/bin/env python3
"""Locally signed TopstepX API automation-promotion receipt for MNQ v2.3.

The HMAC key is NEVER stored in GitHub. Automated order arming requires a receipt
whose semantic hash, account id and evidence digests verify under a local secret.
This does not authorize ProjectX API automation on a Topstep Live Funded Account;
the realtime/account gate separately refuses non-simulated accounts.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from research.current_mnq_strategy_v2_3_local_runtime import require_personal_device
from research.current_mnq_strategy_v2_3_policy import Evidence, live_gate, load_spec, semantics_hash

KEY_ENV = "MNQ_V23_RELEASE_HMAC_KEY"


def _key(env: dict[str, str] | None = None) -> bytes:
    e = os.environ if env is None else env
    key = str(e.get(KEY_ENV, "")).encode()
    if len(key) < 32:
        raise RuntimeError("RELEASE_HMAC_KEY_MISSING_OR_TOO_SHORT")
    return key


def _canonical(obj: dict) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str).encode()


def file_sha256(path: str | Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def create_receipt(evidence: Evidence, account_id: int, sealed_report: str | Path,
                   shadow_journal: str | Path, output: str | Path,
                   env: dict[str, str] | None = None) -> dict:
    require_personal_device("CREATE_AUTOMATION_PROMOTION_RECEIPT", env)
    gate = live_gate(evidence)
    if not gate.approved:
        raise RuntimeError("AUTOMATION_PROMOTION_REFUSE:" + "|".join(gate.reasons))
    payload = {
        "schema_version": 1,
        "release": "MNQ-V2.3-PC1",
        "stage": gate.stage,
        "account_id": int(account_id),
        "semantics_sha256": semantics_hash(),
        "sealed_report_sha256": file_sha256(sealed_report),
        "shadow_journal_sha256": file_sha256(shadow_journal),
        "evidence": asdict(evidence),
        "created_utc": datetime.now(timezone.utc).isoformat(),
    }
    signature = hmac.new(_key(env), _canonical(payload), hashlib.sha256).hexdigest()
    wrapper = {"payload": payload, "hmac_sha256": signature}
    Path(output).write_text(json.dumps(wrapper, indent=2, sort_keys=True))
    return wrapper


def verify_receipt(path: str | Path, account_id: int,
                   env: dict[str, str] | None = None) -> dict:
    require_personal_device("VERIFY_AUTOMATION_PROMOTION_RECEIPT", env)
    wrapper = json.loads(Path(path).read_text())
    payload = wrapper.get("payload")
    if not isinstance(payload, dict):
        raise RuntimeError("PROMOTION_RECEIPT_PAYLOAD_MISSING")
    expected = hmac.new(_key(env), _canonical(payload), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(str(wrapper.get("hmac_sha256", "")), expected):
        raise RuntimeError("PROMOTION_RECEIPT_SIGNATURE_INVALID")
    if payload.get("semantics_sha256") != semantics_hash():
        raise RuntimeError("PROMOTION_RECEIPT_SEMANTICS_STALE")
    if int(payload.get("account_id", -1)) != int(account_id):
        raise RuntimeError("PROMOTION_RECEIPT_ACCOUNT_MISMATCH")
    required_stage = load_spec()["deployment"]["promotion_stage_name"]
    if payload.get("stage") != required_stage:
        raise RuntimeError("PROMOTION_RECEIPT_NOT_AUTOMATION_ELIGIBLE")
    return payload
