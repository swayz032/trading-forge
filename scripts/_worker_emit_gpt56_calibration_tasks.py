#!/usr/bin/env python3
"""Emit the three real GPT-5.6 Sol semantic-audit calibration tasks per AR-1370A/AR-1371A Sec5/6,
using the REPAIRED harness at exact GPT-engineering SHA 8acb6b0fc63e0b38595a9e64c2f61a77885e9f9b,
against the real frozen Opus candidates and real transcripts already committed on this worker
branch. No substitute model. No fabricated response. Emission only.
"""
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

spec = importlib.util.spec_from_file_location("gpt56_audit_repaired_emit",
                                                REPAIR_SCRIPTS / "strategy_factory_gpt56_semantic_audit.py")
G = importlib.util.module_from_spec(spec)
spec.loader.exec_module(G)

CASES = {
    "1HFoStW_wsc": {
        "transcript": REPO_ROOT / "src/engine/extraction/fixtures/source-evidence/1HFoStW_wsc.transcript.txt",
        "candidate": REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/runs/1HFoStW_wsc/fresh_source_candidate.json",
        "receipt": REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/runs/1HFoStW_wsc/candidate_receipt.json",
    },
    "E8Wg6tFPYjo": {
        "transcript": REPO_ROOT / "src/engine/extraction/fixtures/source-evidence/E8Wg6tFPYjo.transcript.txt",
        "candidate": REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/runs/E8Wg6tFPYjo/fresh_source_candidate.json",
        "receipt": REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/runs/E8Wg6tFPYjo/candidate_receipt.json",
    },
    "7ieYBa7Z-Hg": {
        "transcript": REPO_ROOT / "src/engine/extraction/fixtures/source-evidence/7ieYBa7Z-Hg.transcript.txt",
        "candidate": REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/runs/7ieYBa7Z-Hg/fresh_source_candidate.json",
        "receipt": REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/runs/7ieYBa7Z-Hg/candidate_receipt.json",
    },
}

OUT_ROOT = REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/gpt56-semantic-tasks"


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    results = {}
    for video_id, paths in CASES.items():
        transcript_sha = sha256_of(paths["transcript"])
        candidate_sha = sha256_of(paths["candidate"])
        receipt = json.loads(paths["receipt"].read_text(encoding="utf-8"))

        freshness_ok = (
            receipt.get("transcript_sha256") == transcript_sha
            and receipt.get("candidate_sha256") == candidate_sha
        )
        print(f"[{video_id}] live transcript_sha256={transcript_sha}")
        print(f"[{video_id}] live candidate_sha256={candidate_sha}")
        print(f"[{video_id}] receipt transcript_sha256={receipt.get('transcript_sha256')} "
              f"candidate_sha256={receipt.get('candidate_sha256')} FRESH={freshness_ok}")
        if not freshness_ok:
            raise SystemExit(f"[{video_id}] STALE: live bytes no longer match the frozen receipt hashes")

        out_dir = OUT_ROOT / video_id
        G.emit(argparse.Namespace(
            video_id=video_id, transcript=str(paths["transcript"]),
            candidate=str(paths["candidate"]), out_dir=str(out_dir)))

        task_path = out_dir / "gpt56_semantic_audit_task.json"
        task = json.loads(task_path.read_text(encoding="utf-8"))
        task_sha = sha256_of(task_path)

        # emit() already writes the real prompt artifact -- read it, do not reconstruct it.
        prompt_path = out_dir / "gpt56_semantic_audit_prompt.txt"
        prompt_sha = sha256_of(prompt_path)

        results[video_id] = {
            "video_id": video_id,
            "transcript_path": str(paths["transcript"].relative_to(REPO_ROOT)).replace(os.sep, "/"),
            "transcript_sha256": transcript_sha,
            "candidate_path": str(paths["candidate"].relative_to(REPO_ROOT)).replace(os.sep, "/"),
            "candidate_sha256": candidate_sha,
            "semantic_task_path": str(task_path.relative_to(REPO_ROOT)).replace(os.sep, "/"),
            "semantic_task_sha256": task_sha,
            "audit_nonce": task["audit_nonce"],
            "gpt56_prompt_path": str(prompt_path.relative_to(REPO_ROOT)).replace(os.sep, "/"),
            "gpt56_prompt_sha256": prompt_sha,
            "claim_count": len(task["required_claims"]),
            "strategy_count": len(task["strategy_ids"]),
            "repaired_gpt_engineering_sha": REPAIR_SHA,
        }
        print(json.dumps(results[video_id], indent=2))

    index_path = OUT_ROOT / "index.json"
    index_path.write_text(json.dumps({
        "artifact": "gpt56-semantic-audit-calibration-task-index-v1",
        "repaired_gpt_engineering_sha": REPAIR_SHA,
        "emitted_by": "worker-1",
        "cases": results,
    }, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"\nINDEX WRITTEN: {index_path.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
