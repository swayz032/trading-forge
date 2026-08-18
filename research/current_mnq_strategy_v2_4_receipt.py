#!/usr/bin/env python3
"""Cryptographically signed promotion receipt for Current MNQ v2.4."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path

from research.current_mnq_strategy_v2_3_local_runtime import require_personal_device
from research.current_mnq_strategy_v2_4_policy import load_spec, semantics_hash

KEY_ENV = "MNQ_V24_RELEASE_HMAC_KEY"


def _key(env: dict[str, str] | None = None) -> bytes:
    e = os.environ if env is None else env
    key = str(e.get(KEY_ENV, "")).encode()
    if len(key) < 32:
        raise RuntimeError("V24_RELEASE_HMAC_KEY_MISSING_OR_TOO_SHORT")
    return key


def _canonical(obj: dict) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str).encode()


def sign_payload(payload: dict, env: dict[str, str] | None = None) -> str:
    return hmac.new(_key(env), _canonical(payload), hashlib.sha256).hexdigest()


def file_sha256(path: str | Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def verify_receipt(path: str | Path, account_id: int,
                   env: dict[str, str] | None = None) -> dict:
    require_personal_device("VERIFY_V24_AUTOMATION_PROMOTION_RECEIPT", env)
    try:
        wrapper = json.loads(Path(path).read_text())
    except Exception as exc:
        raise RuntimeError("V24_PROMOTION_RECEIPT_CORRUPT") from exc
    payload = wrapper.get("payload")
    if not isinstance(payload, dict):
        raise RuntimeError("V24_PROMOTION_RECEIPT_PAYLOAD_MISSING")
    expected = sign_payload(payload, env)
    if not hmac.compare_digest(str(wrapper.get("hmac_sha256", "")), expected):
        raise RuntimeError("V24_PROMOTION_RECEIPT_SIGNATURE_INVALID")
    if int(payload.get("schema_version", -1)) != 1:
        raise RuntimeError("V24_PROMOTION_RECEIPT_SCHEMA_MISMATCH")
    if payload.get("release") != load_spec()["release_id"]:
        raise RuntimeError("V24_PROMOTION_RECEIPT_RELEASE_MISMATCH")
    if payload.get("semantics_sha256") != semantics_hash():
        raise RuntimeError("V24_PROMOTION_RECEIPT_SEMANTICS_STALE")
    if int(payload.get("account_id", -1)) != int(account_id):
        raise RuntimeError("V24_PROMOTION_RECEIPT_ACCOUNT_MISMATCH")
    required_stage = load_spec()["deployment"]["promotion_stage_name"]
    if payload.get("stage") != required_stage:
        raise RuntimeError("V24_PROMOTION_RECEIPT_NOT_AUTOMATION_ELIGIBLE")
    if payload.get("edge_certified") is not True:
        raise RuntimeError("V24_PROMOTION_RECEIPT_EDGE_NOT_CERTIFIED")
    for k in (
        "architecture_receipt_sha256", "sealed_report_sha256",
        "shadow_journal_sha256", "operations_drill_receipt_sha256",
    ):
        if len(str(payload.get(k, ""))) != 64:
            raise RuntimeError(f"V24_PROMOTION_RECEIPT_EVIDENCE_HASH_MISSING:{k}")
    return payload
