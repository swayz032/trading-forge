#!/usr/bin/env python3
"""Emit the round-3 GPT-5.6 Sol semantic-audit task for E8Wg6tFPYjo, using the AR-1378A SS6
REPAIRED harness on this branch (scripts/strategy_factory_gpt56_semantic_audit.py), not the old
frozen pin 8acb6b0f -- unlike round 2, this round's harness lives in this repo's tracked tree."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

REPO_ROOT = Path(r"C:\Users\tonio\Projects\wt-claude-worker1-20260815")
HARNESS_PATH = REPO_ROOT / "scripts/strategy_factory_gpt56_semantic_audit.py"

spec = importlib.util.spec_from_file_location("gpt56_audit_round3", HARNESS_PATH)
G = importlib.util.module_from_spec(spec)
spec.loader.exec_module(G)

VIDEO_ID = "E8Wg6tFPYjo"
TRANSCRIPT_PATH = REPO_ROOT / f"src/engine/extraction/fixtures/source-evidence/{VIDEO_ID}.transcript.txt"
CANDIDATE_PATH = REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/reconstruction-round-3-fresh-opus/E8Wg6tFPYjo/fresh_source_candidate.json"
RECEIPT_PATH = REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/reconstruction-round-3-fresh-opus/E8Wg6tFPYjo/candidate_receipt.json"
OUT_DIR = REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/gpt56-semantic-tasks-round3/E8Wg6tFPYjo"


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    transcript_sha = sha256_of(TRANSCRIPT_PATH)
    candidate_sha = sha256_of(CANDIDATE_PATH)
    receipt = json.loads(RECEIPT_PATH.read_text(encoding="utf-8"))

    freshness_ok = (
        receipt.get("transcript_sha256") == transcript_sha
        and receipt.get("candidate_sha256") == candidate_sha
    )
    print(f"[{VIDEO_ID}] FRESH={freshness_ok} (live transcript={transcript_sha[:16]}... "
          f"candidate={candidate_sha[:16]}...)")
    if not freshness_ok:
        raise SystemExit(f"[{VIDEO_ID}] STALE: live bytes no longer match the frozen receipt hashes")

    G.emit(argparse.Namespace(
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
        "harness_source": "scripts/strategy_factory_gpt56_semantic_audit.py (this branch, AR-1378A SS6 repaired, commit 0cfb3bd9 + grader-response fixes at 59043cfe)",
        "transcript_path": str(TRANSCRIPT_PATH.relative_to(REPO_ROOT)).replace("\\", "/"),
        "transcript_sha256": transcript_sha,
        "candidate_path": str(CANDIDATE_PATH.relative_to(REPO_ROOT)).replace("\\", "/"),
        "candidate_sha256": candidate_sha,
        "semantic_task_path": str(task_path.relative_to(REPO_ROOT)).replace("\\", "/"),
        "semantic_task_sha256": task_sha,
        "audit_nonce": task["audit_nonce"],
        "gpt56_prompt_path": str(prompt_path.relative_to(REPO_ROOT)).replace("\\", "/"),
        "gpt56_prompt_sha256": prompt_sha,
        "claim_count": len(task["required_claims"]),
        "strategy_count": len(task["strategy_ids"]),
        "candidate_provenance": "genuine fresh isolated Opus reader, file-first transport, round-3 attempt 2 (attempt 1 failed literal-quote binding, preserved not deleted)",
    }
    write_path = OUT_DIR / "index.json"
    write_path.write_text(json.dumps({
        "artifact": "gpt56-semantic-audit-round3-task-index-v1",
        "emitted_by": "worker-1",
        "case": result,
    }, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(result, indent=2))
    print(f"\nINDEX WRITTEN: {write_path.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
