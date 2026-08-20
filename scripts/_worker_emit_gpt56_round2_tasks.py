#!/usr/bin/env python3
"""Emit the three GPT-5.6 Sol semantic-audit tasks for the round-2 GENUINE fresh-Opus candidates,
using the repaired harness at exact SHA 8acb6b0fc63e0b38595a9e64c2f61a77885e9f9b."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path

REPO_ROOT = Path(r"C:\Users\tonio\Projects\wt-claude-worker1-20260815")
REPAIR_SHA = "8acb6b0fc63e0b38595a9e64c2f61a77885e9f9b"
REPAIR_SCRIPTS = Path(os.environ.get(
    "REPAIRED_SCRIPTS_DIR", r"C:/Users/tonio/Projects/wt-lanetest-repair-8acb6b0f/scripts"))

spec = importlib.util.spec_from_file_location("gpt56_audit_round2_emit",
                                                REPAIR_SCRIPTS / "strategy_factory_gpt56_semantic_audit.py")
G = importlib.util.module_from_spec(spec)
spec.loader.exec_module(G)

VIDEO_IDS = ["E8Wg6tFPYjo", "7ieYBa7Z-Hg", "1HFoStW_wsc"]
RUNS_ROOT = REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/reconstruction-round-2-fresh-opus"
TASK_OUT_ROOT = REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/gpt56-semantic-tasks-round2"


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    results = {}
    for video_id in VIDEO_IDS:
        transcript_path = REPO_ROOT / f"src/engine/extraction/fixtures/source-evidence/{video_id}.transcript.txt"
        candidate_path = RUNS_ROOT / video_id / "fresh_source_candidate.json"
        receipt_path = RUNS_ROOT / video_id / "candidate_receipt.json"

        transcript_sha = sha256_of(transcript_path)
        candidate_sha = sha256_of(candidate_path)
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))

        freshness_ok = (
            receipt.get("transcript_sha256") == transcript_sha
            and receipt.get("candidate_sha256") == candidate_sha
        )
        print(f"[{video_id}] FRESH={freshness_ok} (live transcript={transcript_sha[:16]}... "
              f"candidate={candidate_sha[:16]}...)")
        if not freshness_ok:
            raise SystemExit(f"[{video_id}] STALE: live bytes no longer match the frozen receipt hashes")

        out_dir = TASK_OUT_ROOT / video_id
        G.emit(argparse.Namespace(
            video_id=video_id, transcript=str(transcript_path),
            candidate=str(candidate_path), out_dir=str(out_dir)))

        task_path = out_dir / "gpt56_semantic_audit_task.json"
        task = json.loads(task_path.read_text(encoding="utf-8"))
        task_sha = sha256_of(task_path)
        prompt_path = out_dir / "gpt56_semantic_audit_prompt.txt"
        prompt_sha = sha256_of(prompt_path)

        results[video_id] = {
            "video_id": video_id,
            "transcript_path": str(transcript_path.relative_to(REPO_ROOT)).replace(os.sep, "/"),
            "transcript_sha256": transcript_sha,
            "candidate_path": str(candidate_path.relative_to(REPO_ROOT)).replace(os.sep, "/"),
            "candidate_sha256": candidate_sha,
            "semantic_task_path": str(task_path.relative_to(REPO_ROOT)).replace(os.sep, "/"),
            "semantic_task_sha256": task_sha,
            "audit_nonce": task["audit_nonce"],
            "gpt56_prompt_path": str(prompt_path.relative_to(REPO_ROOT)).replace(os.sep, "/"),
            "gpt56_prompt_sha256": prompt_sha,
            "claim_count": len(task["required_claims"]),
            "strategy_count": len(task["strategy_ids"]),
            "repaired_gpt_engineering_sha": REPAIR_SHA,
            "candidate_provenance": "genuine fresh isolated Opus reader, file-first transport (AR-1375A)",
        }
        print(json.dumps(results[video_id], indent=2))

    index_path = TASK_OUT_ROOT / "index.json"
    index_path.write_text(json.dumps({
        "artifact": "gpt56-semantic-audit-round2-task-index-v1",
        "repaired_gpt_engineering_sha": REPAIR_SHA,
        "emitted_by": "worker-1",
        "cases": results,
    }, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"\nINDEX WRITTEN: {index_path.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
