#!/usr/bin/env python3
"""Fetch an exact GPT-5.6 Sol semantic-audit response by git blob ref (byte-exact, no shell
redirection) and ingest it through the repaired harness against the real emitted task/candidate/
transcript for one video. Usage: python scripts/_worker_ingest_gpt56_response.py <video_id> <git_ref>
"""
from __future__ import annotations

import argparse
import importlib.util
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(r"C:\Users\tonio\Projects\wt-claude-worker1-20260815")
REPAIR_SHA = "8acb6b0fc63e0b38595a9e64c2f61a77885e9f9b"
REPAIR_SCRIPTS = Path(r"C:/Users/tonio/Projects/wt-lanetest-repair-8acb6b0f/scripts")

spec = importlib.util.spec_from_file_location("gpt56_audit_repaired_ingest",
                                                REPAIR_SCRIPTS / "strategy_factory_gpt56_semantic_audit.py")
G = importlib.util.module_from_spec(spec)
spec.loader.exec_module(G)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video_id")
    ap.add_argument("git_ref")
    ap.add_argument("blob_path")
    args = ap.parse_args()

    out_dir = REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/gpt56-semantic-tasks" / args.video_id
    transcript_path = REPO_ROOT / f"src/engine/extraction/fixtures/source-evidence/{args.video_id}.transcript.txt"
    candidate_path = out_dir.parent.parent / "runs" / args.video_id / "fresh_source_candidate.json"

    result = subprocess.run(
        ["git", "show", f"{args.git_ref}:{args.blob_path}"],
        cwd=str(REPO_ROOT), capture_output=True, check=True,
    )
    raw_bytes = result.stdout

    raw_path = out_dir / "raw_gpt56_semantic_audit_response.json"
    raw_path.write_bytes(raw_bytes)
    print(f"WROTE exact byte-for-byte response ({len(raw_bytes)} bytes) to {raw_path.relative_to(REPO_ROOT)}")

    import hashlib
    print(f"raw response sha256 = {hashlib.sha256(raw_bytes).hexdigest()}")

    G.ingest(argparse.Namespace(
        video_id=args.video_id, transcript=str(transcript_path), candidate=str(candidate_path),
        out_dir=str(out_dir), raw_response=str(raw_path)))

    receipt_path = out_dir / "gpt56_semantic_audit_receipt.json"
    print("\n--- RECEIPT ---")
    print(receipt_path.read_text(encoding="utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
