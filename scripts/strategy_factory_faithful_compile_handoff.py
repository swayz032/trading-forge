#!/usr/bin/env python3
"""Factory-certified strategy -> faithful compiled-spec handoff.

This is the missing authority join between the Strategy Factory and the already-existing
production compiler/backtester path. It does NOT classify trading semantics. It proves that the
unit the operator is about to compile is the same source unit the Factory measured as clean, then
delegates semantic compilation to the canonical Python producer.

A handoff succeeds only when all of the following are true:
  * the current manifest projection says FAITHFUL_COMPILE_READY_FOR_BACKTEST for this video;
  * no multi-strategy identity/materialization ambiguity remains;
  * exactly one modern strategy identity exists for the video and it is the requested index;
  * the authoritative locator inventory says opus_batch and needs_regeneration=false;
  * current extraction/transcript bytes still match the inventory hashes;
  * the certificate is a non-dry-run clean pilot certificate for the same source/index;
  * the certificate is provenance_binding.status=BOUND (legacy/unreceipted answers never enter);
  * certificate transcript provenance matches the exact transcript being compiled;
  * the canonical producer emits a compiled binding plan with zero approximation.

On success the script writes BOTH the .spec.json and a sibling .factory-handoff.json receipt.
Downstream automation must verify the receipt/spec file hash before onboarding/backtesting; the
receipt's headline status is the only status this script emits for an admitted survivor:
FAITHFUL_COMPILE_READY_FOR_BACKTEST.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from dataclasses import dataclass
from typing import Any

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
VAULT_DIR = os.path.join(REPO_ROOT, "docs/replay-results/strategy-factory-census/extraction-vault")
PREP_DIR = os.path.join(VAULT_DIR, "preps")
PROJECTION_PATH = os.path.join(
    REPO_ROOT, "docs/replay-results/strategy-factory-census/manifest-row-disposition-projection.json"
)
INVENTORY_PATH = os.path.join(VAULT_DIR, "prep-provenance-inventory.json")
TRANSCRIPT_DIR = os.path.join(REPO_ROOT, "src/engine/extraction/fixtures/source-evidence")

READY = "FAITHFUL_COMPILE_READY_FOR_BACKTEST"
BOUND = "BOUND"
SOURCE_FAITHFUL = "SOURCE_FAITHFUL"


class HandoffRefusal(RuntimeError):
    def __init__(self, reason: str, detail: str = "") -> None:
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason = reason
        self.detail = detail


def _load_json(path: str) -> dict:
    if not os.path.isfile(path):
        raise HandoffRefusal("MISSING_ARTIFACT", path)
    try:
        with open(path, "r", encoding="utf-8") as f:
            value = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        raise HandoffRefusal("MALFORMED_ARTIFACT", f"{path}: {exc}") from exc
    if not isinstance(value, dict):
        raise HandoffRefusal("MALFORMED_ARTIFACT", f"{path}: expected JSON object")
    return value


def _sha256_file(path: str) -> str:
    if not os.path.isfile(path):
        raise HandoffRefusal("MISSING_ARTIFACT", path)
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _canonical_json_sha(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Admission:
    video_id: str
    strategy_index: int
    unit: dict
    manifest_rows: tuple[dict, ...]
    certificate: dict


def admit_loaded(
    *,
    video_id: str,
    strategy_index: int,
    projection: dict,
    inventory: dict,
    vault_record: dict,
    certificate: dict,
    actual_extraction_sha256: str,
    actual_transcript_sha256: str,
) -> Admission:
    """Pure admission predicate. It refuses rather than repairing or inferring identity."""
    unresolved = [
        r for r in projection.get("identity_unresolved_rows", [])
        if r.get("spec_video") == video_id
    ]
    if unresolved:
        raise HandoffRefusal(
            "IDENTITY_MATERIALIZATION_UNRESOLVED",
            f"{len(unresolved)} manifest row(s) for {video_id} remain fail-closed",
        )

    rows = [r for r in projection.get("rows", []) if r.get("spec_video") == video_id]
    if not rows:
        raise HandoffRefusal(
            "NO_FACTORY_MANIFEST_ADMISSION",
            "no projected manifest row exists for this source video",
        )
    dispositions = {r.get("disposition") for r in rows}
    if dispositions != {READY}:
        raise HandoffRefusal(
            "FACTORY_DISPOSITION_NOT_COMPILE_READY",
            f"current dispositions={sorted(str(x) for x in dispositions)}",
        )

    units = [u for u in inventory.get("units", []) if u.get("video_id") == video_id]
    distinct_indices = sorted({u.get("strategy_index") for u in units})
    if distinct_indices != [strategy_index]:
        raise HandoffRefusal(
            "SOURCE_STRATEGY_IDENTITY_NOT_UNIQUE",
            f"requested index={strategy_index}; inventory indices={distinct_indices}",
        )
    matching = [u for u in units if u.get("strategy_index") == strategy_index]
    if len(matching) != 1:
        raise HandoffRefusal(
            "SOURCE_STRATEGY_IDENTITY_NOT_UNIQUE",
            f"expected one unit, found {len(matching)}",
        )
    unit = matching[0]
    if unit.get("locator_backend") != "opus_batch" or unit.get("needs_regeneration") is not False:
        raise HandoffRefusal(
            "LOCATOR_AUTHORITY_NOT_CURRENT",
            f"backend={unit.get('locator_backend')!r} needs_regeneration={unit.get('needs_regeneration')!r}",
        )

    if unit.get("extraction_sha256") != actual_extraction_sha256:
        raise HandoffRefusal(
            "EXTRACTION_HASH_DRIFT",
            f"inventory={unit.get('extraction_sha256')} actual={actual_extraction_sha256}",
        )
    if unit.get("transcript_sha256") != actual_transcript_sha256:
        raise HandoffRefusal(
            "TRANSCRIPT_HASH_DRIFT",
            f"inventory={unit.get('transcript_sha256')} actual={actual_transcript_sha256}",
        )

    if vault_record.get("video_id") != video_id:
        raise HandoffRefusal(
            "VAULT_IDENTITY_MISMATCH",
            f"vault claims {vault_record.get('video_id')!r}, expected {video_id!r}",
        )
    extraction = vault_record.get("extraction")
    if not isinstance(extraction, dict):
        raise HandoffRefusal("VAULT_EXTRACTION_MISSING", "vault record has no extraction object")
    strategies = extraction.get("strategies") or []
    if len(strategies) != 1 or strategy_index != 0:
        # Current manifest projection only proves identity automatically for one-strategy videos.
        # A future durable crosswalk may relax this; this wrapper will not invent one today.
        raise HandoffRefusal(
            "COMPILE_IDENTITY_CROSSWALK_REQUIRED",
            f"vault strategy_count={len(strategies)} requested_index={strategy_index}",
        )

    if certificate.get("strategy_index") != strategy_index:
        raise HandoffRefusal(
            "CERTIFICATE_STRATEGY_INDEX_MISMATCH",
            f"certificate={certificate.get('strategy_index')!r} requested={strategy_index}",
        )
    if certificate.get("pilot_grade") is not True:
        raise HandoffRefusal(
            "CERTIFICATE_NOT_PILOT_CLEAN",
            f"pilot_grade={certificate.get('pilot_grade')!r}",
        )
    if certificate.get("certificate_grade") is False:
        raise HandoffRefusal(
            "CERTIFICATE_GRADE_CONTRADICTS_CLEAN_ADMISSION",
            "certificate_grade=false while the projection claims compile-ready",
        )
    if certificate.get("dry_run") is not False:
        raise HandoffRefusal(
            "DRY_RUN_CERTIFICATE_REFUSED",
            f"dry_run={certificate.get('dry_run')!r}",
        )
    binding = certificate.get("provenance_binding") or {}
    if binding.get("status") != BOUND:
        raise HandoffRefusal(
            "UNBOUND_CERTIFICATE_REFUSED",
            f"provenance_binding.status={binding.get('status')!r}",
        )

    provenance = certificate.get("provenance") or {}
    if provenance.get("source_video_id") != video_id:
        raise HandoffRefusal(
            "CERTIFICATE_SOURCE_VIDEO_MISMATCH",
            f"certificate={provenance.get('source_video_id')!r} expected={video_id!r}",
        )
    if provenance.get("full_transcript_sha256") != actual_transcript_sha256:
        raise HandoffRefusal(
            "CERTIFICATE_TRANSCRIPT_HASH_MISMATCH",
            f"certificate={provenance.get('full_transcript_sha256')} actual={actual_transcript_sha256}",
        )

    return Admission(
        video_id=video_id,
        strategy_index=strategy_index,
        unit=unit,
        manifest_rows=tuple(rows),
        certificate=certificate,
    )


def compile_admitted(admission: Admission, *, vault_record: dict, transcript_text: str, out_dir: str) -> dict:
    """Delegate semantics to the canonical producer and emit a hash-bound handoff receipt."""
    sys.path.insert(0, REPO_ROOT)
    from src.engine.extraction.compile_certified_record import parse_spec_id
    from src.engine.extraction.spec_producer import produce_spec_artifact_from_record
    from src.engine.spec_family_bindings import compile_binding_plan

    video_id = admission.video_id
    strategy_index = admission.strategy_index
    spec_id = parse_spec_id(f"{video_id}__s{strategy_index}", strategy_index)
    extraction = vault_record["extraction"]

    result = produce_spec_artifact_from_record(
        extraction,
        video=spec_id,
        certificate=admission.certificate,
        transcript_chars=len(transcript_text),
        strategy_index=strategy_index,
    )
    artifact = result.artifact
    if artifact.get("video") != spec_id:
        raise HandoffRefusal(
            "COMPILED_SPEC_IDENTITY_MISMATCH",
            f"artifact.video={artifact.get('video')!r} expected={spec_id!r}",
        )

    plan = compile_binding_plan(artifact.get("spec") or {})
    if not plan.compiled:
        raise HandoffRefusal(
            "CANONICAL_BINDING_PLAN_REFUSED",
            "compile_binding_plan.compiled=false; no backtest artifact may be admitted",
        )

    metrics = artifact.get("approximation_metrics") or {}
    classifier_rate = float(metrics.get("classifier_approximation_rate", 1.0))
    binding_rate = float(metrics.get("binding_approximation_rate", 1.0))
    if classifier_rate != 0.0 or binding_rate != 0.0:
        raise HandoffRefusal(
            "SEMANTIC_APPROXIMATION_REFUSED_FOR_FAITHFUL_HANDOFF",
            f"classifier_approximation_rate={classifier_rate} binding_approximation_rate={binding_rate}",
        )

    os.makedirs(out_dir, exist_ok=True)
    spec_path = os.path.join(out_dir, f"{spec_id}.spec.json")
    with open(spec_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(artifact, f, indent=2, sort_keys=True, ensure_ascii=False)
        f.write("\n")
    spec_file_sha = _sha256_file(spec_path)

    cert_path = os.path.join(PREP_DIR, f"{spec_id}.certificate.json")
    vault_path = os.path.join(VAULT_DIR, f"{video_id}.json")
    transcript_path = os.path.join(TRANSCRIPT_DIR, f"{video_id}.transcript.txt")
    receipt = {
        "status": READY,
        "source_mode_required": SOURCE_FAITHFUL,
        "identity": {
            "video_id": video_id,
            "strategy_index": strategy_index,
            "spec_id": spec_id,
            "manifest_strategy_ids": [r.get("strategy_id") for r in admission.manifest_rows],
            "manifest_symbols": [r.get("symbol") for r in admission.manifest_rows],
            "manifest_timeframes": sorted({r.get("timeframe") for r in admission.manifest_rows}),
        },
        "source_authority": {
            "extraction_path": os.path.relpath(vault_path, REPO_ROOT),
            "extraction_sha256": admission.unit.get("extraction_sha256"),
            "transcript_path": os.path.relpath(transcript_path, REPO_ROOT),
            "transcript_sha256": admission.unit.get("transcript_sha256"),
            "locator_backend": admission.unit.get("locator_backend"),
            "needs_regeneration": admission.unit.get("needs_regeneration"),
        },
        "certificate_authority": {
            "certificate_path": os.path.relpath(cert_path, REPO_ROOT),
            "certificate_sha256": _sha256_file(cert_path),
            "pilot_grade": admission.certificate.get("pilot_grade"),
            "certificate_grade": admission.certificate.get("certificate_grade"),
            "provenance_binding_status": (admission.certificate.get("provenance_binding") or {}).get("status"),
        },
        "compiled_artifact": {
            "spec_path": os.path.relpath(spec_path, REPO_ROOT) if spec_path.startswith(REPO_ROOT) else spec_path,
            "spec_file_sha256": spec_file_sha,
            "spec_hash": artifact.get("spec_hash"),
            "graph_canonical_hash": artifact.get("graph_canonical_hash"),
            "compiler": "src.engine.extraction.spec_producer.produce_spec_artifact_from_record",
            "binding_plan_compiled": True,
            "classifier_approximation_rate": classifier_rate,
            "binding_approximation_rate": binding_rate,
        },
        "runtime_contract": {
            "strategy_class": "src.engine.spec_condition_compiler.SpecConditionStrategy",
            "backtest_entrypoint": "src.engine.backtester.run_class_backtest",
            "source_mode": SOURCE_FAITHFUL,
            "context_observer_source_events": "src.engine.context.source_entry_events",
        },
    }
    # Bind the receipt itself to the semantic inputs without making the receipt hash recursive.
    receipt["handoff_identity_sha256"] = _canonical_json_sha({
        "status": receipt["status"],
        "identity": receipt["identity"],
        "source_authority": receipt["source_authority"],
        "certificate_authority": receipt["certificate_authority"],
        "compiled_artifact": receipt["compiled_artifact"],
        "runtime_contract": receipt["runtime_contract"],
    })
    receipt_path = os.path.join(out_dir, f"{spec_id}.factory-handoff.json")
    with open(receipt_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(receipt, f, indent=2, sort_keys=True, ensure_ascii=False)
        f.write("\n")
    return {"spec_path": spec_path, "receipt_path": receipt_path, "receipt": receipt}


def run(video_id: str, strategy_index: int, out_dir: str) -> dict:
    projection = _load_json(PROJECTION_PATH)
    inventory = _load_json(INVENTORY_PATH)
    vault_path = os.path.join(VAULT_DIR, f"{video_id}.json")
    cert_path = os.path.join(PREP_DIR, f"{video_id}__s{strategy_index}.certificate.json")
    transcript_path = os.path.join(TRANSCRIPT_DIR, f"{video_id}.transcript.txt")
    vault = _load_json(vault_path)
    cert = _load_json(cert_path)
    extraction_sha = _sha256_file(vault_path)
    transcript_sha = _sha256_file(transcript_path)
    with open(transcript_path, "r", encoding="utf-8") as f:
        transcript_text = f.read()

    admission = admit_loaded(
        video_id=video_id,
        strategy_index=strategy_index,
        projection=projection,
        inventory=inventory,
        vault_record=vault,
        certificate=cert,
        actual_extraction_sha256=extraction_sha,
        actual_transcript_sha256=transcript_sha,
    )
    return compile_admitted(admission, vault_record=vault, transcript_text=transcript_text, out_dir=out_dir)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compile one Strategy Factory survivor, fail closed otherwise")
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--strategy-index", type=int, default=0)
    parser.add_argument("--out-dir", required=True)
    args = parser.parse_args(argv)
    try:
        result = run(args.video_id, args.strategy_index, os.path.abspath(args.out_dir))
    except HandoffRefusal as exc:
        print(json.dumps({
            "status": "REFUSED",
            "reason": exc.reason,
            "detail": exc.detail,
            "video_id": args.video_id,
            "strategy_index": args.strategy_index,
        }, indent=2))
        return 1
    except Exception as exc:
        print(json.dumps({
            "status": "REFUSED",
            "reason": f"{type(exc).__name__}",
            "detail": str(exc),
            "video_id": args.video_id,
            "strategy_index": args.strategy_index,
        }, indent=2))
        return 1

    print(json.dumps(result["receipt"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
