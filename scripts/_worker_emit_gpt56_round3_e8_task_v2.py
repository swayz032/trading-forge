#!/usr/bin/env python3
"""Re-emit the round-3 GPT-5.6 Sol semantic-audit task for E8Wg6tFPYjo as a V2 (contract-bound)
task, per AR-1379A section 8 Lane B: "keep E8 candidate b50729b9... frozen unchanged; re-emit a V2
GPT-5.6 task with fresh nonce from that exact candidate/transcript." The V1 task emitted by
scripts/_worker_emit_gpt56_round3_e8_task.py is HOLD / DO-NOT-AUDIT per that ruling (AR-1385 F-1)
and is left untouched as historical evidence -- this script writes into a SEPARATE out-dir
(gpt56-semantic-tasks-round3-v2/) rather than overwriting it, per the ruling's "Preserve historical
V1 evidence" clause and the AR-1379A grade's F-C finding (emit_v2 has an exists-guard against
cross-schema clobber, but a fresh directory is the operationally simplest way to avoid the question
entirely, as the grade itself recommended)."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

REPO_ROOT = Path(r"C:\Users\tonio\Projects\wt-claude-worker1-20260815")
HARNESS_PATH = REPO_ROOT / "scripts/strategy_factory_gpt56_semantic_audit.py"

spec = importlib.util.spec_from_file_location("gpt56_audit_round3_v2", HARNESS_PATH)
G = importlib.util.module_from_spec(spec)
spec.loader.exec_module(G)

VIDEO_ID = "E8Wg6tFPYjo"
TRANSCRIPT_PATH = REPO_ROOT / f"src/engine/extraction/fixtures/source-evidence/{VIDEO_ID}.transcript.txt"
CANDIDATE_PATH = REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/reconstruction-round-3-fresh-opus/E8Wg6tFPYjo/fresh_source_candidate.json"
RECEIPT_PATH = REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/reconstruction-round-3-fresh-opus/E8Wg6tFPYjo/candidate_receipt.json"
OUT_DIR = REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/gpt56-semantic-tasks-round3-v2/E8Wg6tFPYjo"

EXPECTED_CANDIDATE_SHA256 = "b50729b928e51980088f2e4a73c30771eb3665147443753edcc8be44d5fb0041"


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    transcript_sha = sha256_of(TRANSCRIPT_PATH)
    candidate_sha = sha256_of(CANDIDATE_PATH)
    receipt = json.loads(RECEIPT_PATH.read_text(encoding="utf-8"))

    if candidate_sha != EXPECTED_CANDIDATE_SHA256:
        raise SystemExit(
            f"[{VIDEO_ID}] candidate no longer matches the AR-1379A-frozen sha256 "
            f"{EXPECTED_CANDIDATE_SHA256} (got {candidate_sha}) -- the ruling requires this exact "
            "candidate unchanged; no new Opus reconstruction is authorized"
        )
    freshness_ok = (
        receipt.get("transcript_sha256") == transcript_sha
        and receipt.get("candidate_sha256") == candidate_sha
    )
    print(f"[{VIDEO_ID}] FRESH={freshness_ok} FROZEN_CANDIDATE_MATCH=True "
          f"(live transcript={transcript_sha[:16]}... candidate={candidate_sha[:16]}...)")
    if not freshness_ok:
        raise SystemExit(f"[{VIDEO_ID}] STALE: live bytes no longer match the frozen receipt hashes")

    G.emit_v2(argparse.Namespace(
        video_id=VIDEO_ID, transcript=str(TRANSCRIPT_PATH),
        candidate=str(CANDIDATE_PATH), out_dir=str(OUT_DIR)))

    task_path = OUT_DIR / "gpt56_semantic_audit_task.json"
    task = json.loads(task_path.read_text(encoding="utf-8"))
    task_sha = sha256_of(task_path)
    prompt_path = OUT_DIR / "gpt56_semantic_audit_prompt.txt"
    prompt_sha = sha256_of(prompt_path)

    result = {
        "video_id": VIDEO_ID,
        "reconstruction_round": 3,
        "task_schema_version": "v2",
        "ruling": "AR-1379A section 8 Lane B",
        "harness_source": "scripts/strategy_factory_gpt56_semantic_audit.py (this branch, V2 contract-binding repair, commit 4fe66630)",
        "transcript_path": str(TRANSCRIPT_PATH.relative_to(REPO_ROOT)).replace("\\", "/"),
        "transcript_sha256": transcript_sha,
        "candidate_path": str(CANDIDATE_PATH.relative_to(REPO_ROOT)).replace("\\", "/"),
        "candidate_sha256": candidate_sha,
        "semantic_task_path": str(task_path.relative_to(REPO_ROOT)).replace("\\", "/"),
        "semantic_task_sha256": task_sha,
        "audit_nonce": task["audit_nonce"],
        "semantic_contract_id": task["semantic_contract_id"],
        "semantic_contract_sha256": task["semantic_contract_sha256"],
        "gpt56_prompt_path": str(prompt_path.relative_to(REPO_ROOT)).replace("\\", "/"),
        "gpt56_prompt_sha256": prompt_sha,
        "claim_count": len(task["required_claims"]),
        "strategy_count": len(task["strategy_ids"]),
        "candidate_provenance": "genuine fresh isolated Opus reader, file-first transport, round-3 attempt 2 (attempt 1 failed literal-quote binding, preserved not deleted) -- SAME frozen candidate as the V1 round-3 task; no new Opus reconstruction was performed for this V2 re-emit",
        "v1_task_disposition": "HOLD / DO-NOT-AUDIT per AR-1379A (F-1) -- preserved unchanged at docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/gpt56-semantic-tasks-round3/E8Wg6tFPYjo/, not overwritten",
    }
    write_path = OUT_DIR / "index.json"
    write_path.write_text(json.dumps({
        "artifact": "gpt56-semantic-audit-round3-task-index-v2",
        "emitted_by": "worker-1",
        "case": result,
    }, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(result, indent=2))
    print(f"\nINDEX WRITTEN: {write_path.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
