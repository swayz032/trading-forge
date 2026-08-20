#!/usr/bin/env python3
"""Freeze the three genuinely fresh, file-first Opus reader candidates per AR-1375A.

Each was produced by a freshly-dispatched, isolated Agent (model override=opus, subagent_type=
general-purpose), given only its task file (transcript + AR-1374A atomic law + case hazards, no
prior candidate JSON, no report prose, no legacy semantics). Result transport was file-first: the
agent used its own Write tool to persist raw_opus_response.txt directly to a designated path;
the parent (this script) reads those bytes from disk rather than depending on chat/message
delivery, per AR-1375A Sec2.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

REPO_ROOT = Path(r"C:\Users\tonio\Projects\wt-claude-worker1-20260815")
REPAIR_SCRIPTS = Path(r"C:/Users/tonio/Projects/wt-lanetest-repair-8acb6b0f/scripts")
RUNS_ROOT = REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/reconstruction-round-2-fresh-opus"

spec = importlib.util.spec_from_file_location("opus_diag_freeze2",
                                                REPAIR_SCRIPTS / "strategy_factory_opus_transcript_first_diagnostic.py")
D = importlib.util.module_from_spec(spec)
spec.loader.exec_module(D)

VIDEO_IDS = ["E8Wg6tFPYjo", "7ieYBa7Z-Hg", "1HFoStW_wsc"]


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def main() -> None:
    for video_id in VIDEO_IDS:
        out_dir = RUNS_ROOT / video_id
        case = D.get_case(video_id)
        _, transcript = D.transcript_for(case)
        transcript_sha = sha256_text(transcript)

        raw_path = out_dir / "raw_opus_response.txt"
        raw_text = raw_path.read_text(encoding="utf-8")
        candidate = json.loads(raw_text)

        validation = D.validate_candidate(candidate, transcript, video_id)
        if validation["literal_quote_failures"]:
            raise SystemExit(f"[{video_id}] literal quote failures: {validation}")

        candidate_text = json.dumps(candidate, indent=2, ensure_ascii=False) + "\n"
        raw_sha = sha256_text(raw_text)
        candidate_sha = sha256_text(candidate_text)

        (out_dir / "fresh_source_candidate.json").write_text(candidate_text, encoding="utf-8", newline="\n")

        frozen = {
            "artifact": "opus-transcript-first-candidate-receipt-v2-file-first",
            "status": D.STATUS_FRESH,
            "video_id": video_id,
            "diagnostic_category": case["category"],
            "reconstruction_round": 2,
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
                "file-first (AR-1375A Sec2): the dispatched agent used its own Write tool to persist "
                f"raw_opus_response.txt directly to {raw_path.relative_to(REPO_ROOT).as_posix()}. "
                "The parent worker session read those bytes from disk; teammate chat/message delivery "
                "was NOT the load-bearing return path for the candidate bytes (it had failed to deliver "
                "at all for the prior dispatch round and was abandoned as load-bearing transport)."
            ),
            "transcript_sha256": transcript_sha,
            "raw_response_sha256": raw_sha,
            "candidate_sha256": candidate_sha,
            "validation": validation,
            "factory_authority": False,
            "certification_required": True,
            "next_step": (
                "Independent grader (GPT-5.6 Sol semantic audit) attacks candidate against the same "
                "transcript. Do not compare to legacy extraction until that grade is frozen."
            ),
        }
        (out_dir / "candidate_receipt.json").write_text(
            json.dumps(frozen, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        print(f"[{video_id}] FROZEN (genuine fresh Opus, file-first transport): "
              f"candidate_sha256={candidate_sha} strategy_count={validation['strategy_count']} "
              f"literal_quote_count={validation['literal_quote_count']}")


if __name__ == "__main__":
    main()
