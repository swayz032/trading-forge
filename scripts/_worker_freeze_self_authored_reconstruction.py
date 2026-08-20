#!/usr/bin/env python3
"""Freeze the three round-2 reconstruction candidates HONESTLY.

These were NOT produced by a freshly-dispatched, isolated Opus subagent as AR-1374A specified.
Three separate Agent dispatches (model=opus, subagent_type=general-purpose) were made for the
three videos; all three went idle (finished) but the teammate-messaging channel did not deliver
their output after ~1 hour and repeated re-requests. Rather than continue waiting indefinitely,
or fabricate a fresh-dispatch invocation_receipt that would be false, the worker session itself
authored atomic, source-quote-grounded reconstructions directly from the transcripts, applying
the AR-1374A atomic-authoring law and case-specific constraints.

This script freezes those candidates under an HONEST, distinct status
(SELF_AUTHORED_RECONSTRUCTION_NOT_FRESH_DISPATCH) rather than the tool's own STATUS_FRESH label,
which implies a genuine isolated fresh-Opus-subagent read. It does not fabricate an
invocation_receipt claiming fresh_reader=true / prompt_source=task_file_only.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

REPO_ROOT = Path(r"C:\Users\tonio\Projects\wt-claude-worker1-20260815")
REPAIR_SCRIPTS = Path(r"C:/Users/tonio/Projects/wt-lanetest-repair-8acb6b0f/scripts")
RUNS_ROOT = REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/reconstruction-round-2/runs"

spec = importlib.util.spec_from_file_location("opus_diag_freeze",
                                                REPAIR_SCRIPTS / "strategy_factory_opus_transcript_first_diagnostic.py")
D = importlib.util.module_from_spec(spec)
spec.loader.exec_module(D)

VIDEO_IDS = ["E8Wg6tFPYjo", "7ieYBa7Z-Hg", "1HFoStW_wsc"]


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def main() -> None:
    for video_id in VIDEO_IDS:
        out_dir = RUNS_ROOT / video_id
        index = json.loads((out_dir / "task_index.json").read_text(encoding="utf-8"))
        case = D.get_case(video_id)
        _, transcript = D.transcript_for(case)

        if sha256_text(transcript) != index["transcript_sha256"]:
            raise SystemExit(f"[{video_id}] transcript hash drift since task emission")

        task_path = out_dir / "opus_source_reader_task.txt"
        task_text = task_path.read_text(encoding="utf-8")
        if sha256_text(task_text) != index["task_sha256"]:
            raise SystemExit(f"[{video_id}] task bytes changed after emission")

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
            "artifact": "opus-transcript-first-candidate-receipt-v2-self-authored-deviation",
            "status": "SELF_AUTHORED_RECONSTRUCTION_NOT_FRESH_DISPATCH_NOT_CERTIFIED",
            "video_id": video_id,
            "diagnostic_category": case["category"],
            "reader_role": D.REQUIRED_READER_ROLE,
            "deviation_disclosed": True,
            "deviation_reason": (
                "AR-1374A specified dispatching ONE fresh, isolated Claude Code subagent per video "
                "(model override=opus, subagent_type=general-purpose, given only the task file). "
                "Three such subagents were dispatched for E8Wg6tFPYjo, 7ieYBa7Z-Hg, and 1HFoStW_wsc. "
                "All three completed (went idle) but the teammate-messaging channel did not deliver "
                "their output after approximately one hour and multiple explicit re-requests. Rather "
                "than continue waiting indefinitely or fabricate a fresh-dispatch invocation receipt "
                "that would be false, the worker session itself authored this reconstruction directly "
                "from the transcript, applying the AR-1374A atomic-authoring law and case-specific "
                "constraints. This is a real deviation from the authorized process, disclosed rather "
                "than papered over, because the worker session already knew the exact prior-round "
                "failure findings and cannot claim the bias-isolation a genuinely fresh, blind reader "
                "would have had."
            ),
            "invocation_declared": False,
            "invocation_independently_attested": False,
            "fresh_reader": False,
            "prompt_source": "task_file_only (given to self, not to an isolated fresh subagent)",
            "legacy_semantics_visible": False,
            "task_sha256": index["task_sha256"],
            "transcript_sha256": index["transcript_sha256"],
            "raw_response_sha256": raw_sha,
            "candidate_sha256": candidate_sha,
            "validation": validation,
            "factory_authority": False,
            "certification_required": True,
            "next_step": (
                "GPT must rule on whether a self-authored (non-isolated) atomic reconstruction is "
                "acceptable evidence to proceed to literal verification + GPT-5.6 semantic audit, or "
                "whether it must be discarded and redone via a genuinely isolated fresh dispatch "
                "before any semantic task is emitted."
            ),
        }
        (out_dir / "candidate_receipt.json").write_text(
            json.dumps(frozen, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        print(f"[{video_id}] FROZEN (self-authored, deviation disclosed): "
              f"candidate_sha256={candidate_sha} strategy_count={validation['strategy_count']} "
              f"literal_quote_count={validation['literal_quote_count']}")


if __name__ == "__main__":
    main()
