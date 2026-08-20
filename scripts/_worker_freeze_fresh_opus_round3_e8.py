#!/usr/bin/env python3
"""Freeze the round-3 genuinely fresh, file-first Opus reader candidate for E8Wg6tFPYjo, per
AR-1378A Section7 Lane B. Adapted from _worker_freeze_fresh_opus_file_first.py (round 2, all three
videos) -- same validator, same file-first transport discipline, scoped to this one video/round.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

REPO_ROOT = Path(r"C:\Users\tonio\Projects\wt-claude-worker1-20260815")
REPAIR_SCRIPTS = Path(r"C:/Users/tonio/Projects/wt-lanetest-repair-8acb6b0f/scripts")
OUT_DIR = REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/reconstruction-round-3-fresh-opus/E8Wg6tFPYjo"

spec = importlib.util.spec_from_file_location("opus_diag_freeze3",
                                                REPAIR_SCRIPTS / "strategy_factory_opus_transcript_first_diagnostic.py")
D = importlib.util.module_from_spec(spec)
spec.loader.exec_module(D)

VIDEO_ID = "E8Wg6tFPYjo"


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def main() -> None:
    case = D.get_case(VIDEO_ID)
    _, transcript = D.transcript_for(case)
    transcript_sha = sha256_text(transcript)

    raw_path = OUT_DIR / "raw_opus_response.txt"
    raw_text = raw_path.read_text(encoding="utf-8")
    candidate = json.loads(raw_text)

    validation = D.validate_candidate(candidate, transcript, VIDEO_ID)
    if validation["literal_quote_failures"]:
        raise SystemExit(f"[{VIDEO_ID}] literal quote failures: {validation}")

    candidate_text = json.dumps(candidate, indent=2, ensure_ascii=False) + "\n"
    raw_sha = sha256_text(raw_text)
    candidate_sha = sha256_text(candidate_text)

    (OUT_DIR / "fresh_source_candidate.json").write_text(candidate_text, encoding="utf-8", newline="\n")

    round2_candidate_sha = sha256_text(
        (REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/"
         "reconstruction-round-2-fresh-opus/E8Wg6tFPYjo/fresh_source_candidate.json"
         ).read_text(encoding="utf-8")
    )

    frozen = {
        "artifact": "opus-transcript-first-candidate-receipt-v2-file-first",
        "status": D.STATUS_FRESH,
        "video_id": VIDEO_ID,
        "diagnostic_category": case["category"],
        "reconstruction_round": 3,
        "reader_role": D.REQUIRED_READER_ROLE,
        "model_override": D.REQUIRED_MODEL_OVERRIDE,
        "actual_model_identity": "override=opus; exact runtime model identity not independently surfaced to the dispatcher (Agent tool model override accepted, no separate attestation channel available)",
        "invocation_declared": True,
        "invocation_independently_attested": False,
        "fresh_reader": True,
        "prompt_source": "task_file_only",
        "legacy_semantics_visible": False,
        "prior_candidate_json_visible": False,
        "prior_report_prose_visible": False,
        "delivery_mechanism": (
            "file-first (AR-1375A Sec2 pattern, reused for round 3): the dispatched agent used its own "
            f"Write tool to persist raw_opus_response.txt directly to {raw_path.relative_to(REPO_ROOT).as_posix()}. "
            "The parent worker session read those bytes from disk; teammate chat/message delivery was not "
            "load-bearing transport."
        ),
        "transcript_sha256": transcript_sha,
        "raw_response_sha256": raw_sha,
        "candidate_sha256": candidate_sha,
        "distinct_from_round2_candidate": candidate_sha != round2_candidate_sha,
        "round2_candidate_sha256_for_comparison": round2_candidate_sha,
        "authorizing_ruling": "AR-1378A @ 47aeefa916d34c08e8a9c76d6d7f488e2e4fb71f, Section3/Section7 Lane B",
        "validation": validation,
        "factory_authority": False,
        "certification_required": True,
        "next_step": (
            "Emit a GPT-5.6 semantic task from the AR-1378A-repaired harness "
            "(scripts/strategy_factory_gpt56_semantic_audit.py @ commit 0cfb3bd9), then independent "
            "Claude challenge on the audit response. Do not compare to legacy extraction until graded."
        ),
    }
    (OUT_DIR / "candidate_receipt.json").write_text(
        json.dumps(frozen, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(f"[{VIDEO_ID}] ROUND 3 FROZEN (genuine fresh Opus, file-first transport): "
          f"candidate_sha256={candidate_sha} distinct_from_round2={frozen['distinct_from_round2_candidate']} "
          f"strategy_count={validation['strategy_count']} literal_quote_count={validation['literal_quote_count']}")


if __name__ == "__main__":
    main()
