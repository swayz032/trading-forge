#!/usr/bin/env python3
"""Re-verify a Strategy Factory faithful-compile handoff immediately before onboarding/backtest.

The handoff receipt is not trusted because it exists. This verifier re-hashes the spec, source
extraction, transcript and certificate, re-runs the current Factory admission predicate, and
checks the receipt's own identity digest. A stale or copied receipt fails closed.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
HANDOFF_MODULE = os.path.join(REPO_ROOT, "scripts", "strategy_factory_faithful_compile_handoff.py")
spec = importlib.util.spec_from_file_location("factory_handoff", HANDOFF_MODULE)
h = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = h
spec.loader.exec_module(h)


class VerificationRefusal(RuntimeError):
    def __init__(self, reason: str, detail: str = "") -> None:
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason = reason
        self.detail = detail


def _load(path: str) -> dict:
    if not os.path.isfile(path):
        raise VerificationRefusal("MISSING_ARTIFACT", path)
    try:
        with open(path, "r", encoding="utf-8") as f:
            value = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        raise VerificationRefusal("MALFORMED_ARTIFACT", f"{path}: {exc}") from exc
    if not isinstance(value, dict):
        raise VerificationRefusal("MALFORMED_ARTIFACT", f"{path}: expected object")
    return value


def _sha(path: str) -> str:
    if not os.path.isfile(path):
        raise VerificationRefusal("MISSING_ARTIFACT", path)
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _repo_path(rel: str) -> str:
    path = os.path.normpath(os.path.join(REPO_ROOT, rel))
    root = os.path.normpath(REPO_ROOT)
    if os.path.commonpath([root, path]) != root:
        raise VerificationRefusal("PATH_ESCAPES_REPOSITORY", rel)
    return path


def verify(receipt_path: str, spec_path: str) -> dict:
    receipt_path = os.path.abspath(receipt_path)
    spec_path = os.path.abspath(spec_path)
    receipt = _load(receipt_path)
    artifact = _load(spec_path)

    if receipt.get("status") != h.READY:
        raise VerificationRefusal("HANDOFF_STATUS_NOT_READY", repr(receipt.get("status")))
    if receipt.get("source_mode_required") != h.SOURCE_FAITHFUL:
        raise VerificationRefusal("SOURCE_MODE_NOT_SOURCE_FAITHFUL", repr(receipt.get("source_mode_required")))

    identity_payload = {
        "status": receipt.get("status"),
        "identity": receipt.get("identity"),
        "source_authority": receipt.get("source_authority"),
        "certificate_authority": receipt.get("certificate_authority"),
        "compiled_artifact": receipt.get("compiled_artifact"),
        "runtime_contract": receipt.get("runtime_contract"),
    }
    expected_identity_sha = h._canonical_json_sha(identity_payload)
    if receipt.get("handoff_identity_sha256") != expected_identity_sha:
        raise VerificationRefusal(
            "HANDOFF_RECEIPT_IDENTITY_HASH_MISMATCH",
            f"receipt={receipt.get('handoff_identity_sha256')} recomputed={expected_identity_sha}",
        )

    spec_sha = _sha(spec_path)
    claimed_spec_sha = (receipt.get("compiled_artifact") or {}).get("spec_file_sha256")
    if spec_sha != claimed_spec_sha:
        raise VerificationRefusal(
            "SPEC_FILE_HASH_MISMATCH",
            f"receipt={claimed_spec_sha} actual={spec_sha}",
        )

    identity = receipt.get("identity") or {}
    video_id = identity.get("video_id")
    strategy_index = identity.get("strategy_index")
    spec_id = identity.get("spec_id")
    if not isinstance(video_id, str) or not isinstance(strategy_index, int) or not isinstance(spec_id, str):
        raise VerificationRefusal("HANDOFF_IDENTITY_MALFORMED")
    if artifact.get("video") != spec_id:
        raise VerificationRefusal(
            "SPEC_IDENTITY_MISMATCH",
            f"artifact.video={artifact.get('video')!r} receipt.spec_id={spec_id!r}",
        )
    if artifact.get("spec_hash") != (receipt.get("compiled_artifact") or {}).get("spec_hash"):
        raise VerificationRefusal("SPEC_HASH_FIELD_MISMATCH")

    source = receipt.get("source_authority") or {}
    cert_auth = receipt.get("certificate_authority") or {}
    extraction_path = _repo_path(source.get("extraction_path") or "")
    transcript_path = _repo_path(source.get("transcript_path") or "")
    certificate_path = _repo_path(cert_auth.get("certificate_path") or "")
    if _sha(extraction_path) != source.get("extraction_sha256"):
        raise VerificationRefusal("CURRENT_EXTRACTION_NO_LONGER_MATCHES_HANDOFF")
    if _sha(transcript_path) != source.get("transcript_sha256"):
        raise VerificationRefusal("CURRENT_TRANSCRIPT_NO_LONGER_MATCHES_HANDOFF")
    if _sha(certificate_path) != cert_auth.get("certificate_sha256"):
        raise VerificationRefusal("CURRENT_CERTIFICATE_NO_LONGER_MATCHES_HANDOFF")

    # Re-run the current admission law, rather than assuming it has not changed since compile.
    projection = _load(h.PROJECTION_PATH)
    inventory = _load(h.INVENTORY_PATH)
    vault = _load(extraction_path)
    certificate = _load(certificate_path)
    try:
        admission = h.admit_loaded(
            video_id=video_id,
            strategy_index=strategy_index,
            projection=projection,
            inventory=inventory,
            vault_record=vault,
            certificate=certificate,
            actual_extraction_sha256=_sha(extraction_path),
            actual_transcript_sha256=_sha(transcript_path),
        )
    except h.HandoffRefusal as exc:
        raise VerificationRefusal(
            "CURRENT_FACTORY_ADMISSION_NO_LONGER_VALID",
            f"{exc.reason}: {exc.detail}",
        ) from exc

    if sorted(identity.get("manifest_strategy_ids") or []) != sorted(
        r.get("strategy_id") for r in admission.manifest_rows
    ):
        raise VerificationRefusal("MANIFEST_ROW_IDENTITY_DRIFT")

    runtime = receipt.get("runtime_contract") or {}
    if runtime.get("source_mode") != h.SOURCE_FAITHFUL:
        raise VerificationRefusal("RUNTIME_CONTRACT_SOURCE_MODE_MISMATCH")
    if runtime.get("strategy_class") != "src.engine.spec_condition_compiler.SpecConditionStrategy":
        raise VerificationRefusal("RUNTIME_STRATEGY_CLASS_MISMATCH")
    if runtime.get("backtest_entrypoint") != "src.engine.backtester.run_class_backtest":
        raise VerificationRefusal("RUNTIME_BACKTEST_ENTRYPOINT_MISMATCH")

    return {
        "status": "VERIFIED_FACTORY_FAITHFUL_HANDOFF",
        "video_id": video_id,
        "strategy_index": strategy_index,
        "spec_id": spec_id,
        "spec_file_sha256": spec_sha,
        "spec_hash": artifact.get("spec_hash"),
        "handoff_identity_sha256": expected_identity_sha,
        "source_mode": h.SOURCE_FAITHFUL,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify one factory faithful handoff")
    parser.add_argument("--receipt", required=True)
    parser.add_argument("--spec", required=True)
    args = parser.parse_args(argv)
    try:
        result = verify(args.receipt, args.spec)
    except VerificationRefusal as exc:
        print(json.dumps({"status": "REFUSED", "reason": exc.reason, "detail": exc.detail}, indent=2))
        return 1
    except Exception as exc:
        print(json.dumps({"status": "REFUSED", "reason": type(exc).__name__, "detail": str(exc)}, indent=2))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
