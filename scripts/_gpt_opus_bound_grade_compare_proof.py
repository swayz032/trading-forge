#!/usr/bin/env python3
"""GPT-authored adversarial development proof for the bound Opus grade gate.

NOT independent certification. Worker-1 / accuracy-validator must execute this proof and add at
least one novel attack not authored here before the gate may be relied on for the five real legacy
comparisons.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "strategy_factory_opus_bound_grade_compare.py"
spec = importlib.util.spec_from_file_location("bound_gate", SCRIPT)
if spec is None or spec.loader is None:
    raise SystemExit("cannot import bound grade gate")
G = importlib.util.module_from_spec(spec)
spec.loader.exec_module(G)

VIDEO = "proof-video"
HEAD = "1" * 40
PIN = "proof-toolbox-pin"
BUNDLE = "2" * 64
TRANSCRIPT = "On the five minute chart wait for a close above resistance and enter long."
CANDIDATE = {
    "video_id": VIDEO,
    "reader_role": "OPUS_LEAD_SOURCE_READER",
    "strategies": [{
        "source_strategy_id": "s0",
        "name": "proof",
        "direction": "long",
        "direction_transcript_quote": "enter long",
        "higher_timeframe": "source_unresolved",
        "higher_timeframe_transcript_quote": None,
        "execution_timeframe": "5m",
        "execution_timeframe_transcript_quote": "five minute chart",
        "setup": [],
        "entry_sequence": [{
            "step": 1,
            "role": "trigger",
            "action": "close above resistance and enter long",
            "rationale": "source says so",
            "transcript_quote": "wait for a close above resistance and enter long"
        }],
        "confluences": [],
        "stop": None,
        "targets": [],
        "management": [],
        "variants": [],
        "source_gaps": []
    }],
    "top_level_source_gaps": []
}


def expect_fail(label, fn, contains: str | None = None):
    try:
        fn()
    except SystemExit as e:
        text = str(e)
        if contains and contains.lower() not in text.lower():
            raise AssertionError(f"{label}: wrong refusal: {text}")
        print(f"PASS NEGATIVE: {label}: {text}")
        return
    raise AssertionError(f"{label}: expected refusal")


def write_json(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8", newline="\n")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="gpt-bound-grade-proof-") as td:
        root = Path(td)
        out_root = root / "runs"
        out = out_root / VIDEO
        fake_common = root / "common-git"
        permit_dir = fake_common / "tf-isolated-grader-permits"
        permit_dir.mkdir(parents=True)

        candidate_text = json.dumps(CANDIDATE, indent=2, ensure_ascii=False) + "\n"
        candidate_sha = G.sha256_text(candidate_text)
        transcript_sha = G.sha256_text(TRANSCRIPT)
        write_json(out / "candidate_receipt.json", {
            "status": G.H.STATUS_FRESH,
            "video_id": VIDEO,
            "candidate_sha256": candidate_sha,
            "transcript_sha256": transcript_sha,
        })
        (out / "fresh_source_candidate.json").write_text(
            candidate_text, encoding="utf-8", newline="\n"
        )

        # Isolate all proof state from the real repository/control plane.
        G.current_head = lambda: HEAD
        G.common_git_dir = lambda: fake_common
        G.manifest_identity = lambda: (PIN, BUNDLE)
        G.H.get_case = lambda video_id: {"video_id": video_id, "category": "proof"}
        G.H.transcript_for = lambda case: (root / "transcript.txt", TRANSCRIPT)

        # Emit exact bound Agent request.
        G.cmd_emit_grade(argparse.Namespace(video_id=VIDEO, out_dir=str(out_root)))
        task = G.read_json(out / "independent_grade_task.json")
        assert task["agent_request"]["subagent_type"] == "accuracy-validator"
        assert task["agent_request"]["isolation"] == "worktree"
        assert task["parent_head_sha"] == HEAD
        assert task["agent_request_sha256"] == G.request_sha256(task["agent_request"])
        print("PASS POSITIVE: grade task binds exact candidate/transcript/request/head/toolbox")

        grade = {
            "schema": G.GRADE_RESPONSE_SCHEMA,
            "video_id": VIDEO,
            "candidate_sha256": candidate_sha,
            "transcript_sha256": transcript_sha,
            "grade_nonce": task["grade_nonce"],
            "verdict": "PASS",
            "findings": [],
            "strategy_count_assessment": "one strategy",
            "independence_statement": (
                "I graded the fresh candidate only against the supplied original transcript before any legacy comparison."
            ),
        }
        raw_grade = root / "raw-grade.json"
        write_json(raw_grade, grade)

        # AR-1360 exact class: a hand-authored PASS has no guard witness and must fail.
        expect_fail(
            "AR-1360 forged grade JSON without consumed guard permit",
            lambda: G.cmd_ingest_grade(argparse.Namespace(
                video_id=VIDEO, out_dir=str(out_root), raw_grade=str(raw_grade)
            )),
            "found 0",
        )

        # An unconsumed permit-shaped file is not execution evidence.
        permit = {
            "schema": G.PERMIT_SCHEMA,
            "token_sha256": "3" * 64,
            "parent_session_id": "proof-parent",
            "parent_head": HEAD,
            "tool_use_id": "toolu-proof",
            "agent_request_sha256": task["agent_request_sha256"],
            "subagent_type": G.GRADE_ROLE,
            "isolation": G.GRADE_ISOLATION,
            "toolbox_pin": PIN,
            "toolbox_bundle_sha256": BUNDLE,
            "issued_at": 1,
            "expires_at": 9999999999999,
        }
        write_json(permit_dir / f"{permit['token_sha256']}.json", permit)
        expect_fail(
            "unconsumed permit is not accepted as grader activation",
            lambda: G.cmd_ingest_grade(argparse.Namespace(
                video_id=VIDEO, out_dir=str(out_root), raw_grade=str(raw_grade)
            )),
            "found 0",
        )

        # Wrong-request consumed permit also cannot authorize this task.
        wrong = dict(permit)
        wrong["agent_request_sha256"] = "4" * 64
        write_json(permit_dir / f"{permit['token_sha256']}.consumed-wrong.json", wrong)
        expect_fail(
            "consumed permit for another Agent request cannot be copied",
            lambda: G.cmd_ingest_grade(argparse.Namespace(
                video_id=VIDEO, out_dir=str(out_root), raw_grade=str(raw_grade)
            )),
            "found 0",
        )
        (permit_dir / f"{permit['token_sha256']}.consumed-wrong.json").unlink()

        # Correct consumed permit is the positive control.
        consumed = permit_dir / f"{permit['token_sha256']}.consumed-proof-child.json"
        write_json(consumed, permit)
        G.cmd_ingest_grade(argparse.Namespace(
            video_id=VIDEO, out_dir=str(out_root), raw_grade=str(raw_grade)
        ))
        frozen = G.read_json(out / "independent_grade_receipt.json")
        assert frozen["status"] == "BOUND_INDEPENDENT_GRADE_PASS"
        assert frozen["consumed_permit_sha256"] == G.sha256_bytes(consumed.read_bytes())
        G._verify_bound_grade(VIDEO, out)
        print("PASS POSITIVE: exact consumed isolated-grader permit binds grade")

        # AR-1377 exact false-green regression: a genuinely consumed v1 request witness must not
        # be replayable onto a materially re-frozen v2 by changing only task.candidate_sha256.
        task_path = out / "independent_grade_task.json"
        candidate_path = out / "fresh_source_candidate.json"
        candidate_receipt_path = out / "candidate_receipt.json"
        original_task = task_path.read_bytes()
        original_candidate = candidate_path.read_bytes()
        original_candidate_receipt = candidate_receipt_path.read_bytes()

        candidate_v2 = json.loads(json.dumps(CANDIDATE))
        candidate_v2["strategies"][0]["name"] = "laundered-reconstruction"
        candidate_v2["strategies"][0]["direction"] = "short"
        candidate_v2["strategies"][0]["entry_sequence"][0]["action"] = (
            "fade the close, enter short, and double size on each adverse 1R"
        )
        candidate_v2_text = json.dumps(candidate_v2, indent=2, ensure_ascii=False) + "\n"
        candidate_v2_sha = G.sha256_text(candidate_v2_text)
        candidate_path.write_text(candidate_v2_text, encoding="utf-8", newline="\n")
        write_json(candidate_receipt_path, {
            "status": G.H.STATUS_FRESH,
            "video_id": VIDEO,
            "candidate_sha256": candidate_v2_sha,
            "transcript_sha256": transcript_sha,
        })
        laundered_task = G.read_json(task_path)
        laundered_task["candidate_sha256"] = candidate_v2_sha
        write_json(task_path, laundered_task)
        grade_v2 = dict(grade)
        grade_v2["candidate_sha256"] = candidate_v2_sha
        grade_v2["strategy_count_assessment"] = "one strategy never shown to the grader"
        raw_grade_v2 = root / "raw-grade-v2.json"
        write_json(raw_grade_v2, grade_v2)
        expect_fail(
            "AR-1377 stale v1 request/permit cannot certify re-frozen v2",
            lambda: G.cmd_ingest_grade(argparse.Namespace(
                video_id=VIDEO, out_dir=str(out_root), raw_grade=str(raw_grade_v2)
            )),
            "independently derived",
        )
        candidate_path.write_bytes(original_candidate)
        candidate_receipt_path.write_bytes(original_candidate_receipt)
        task_path.write_bytes(original_task)
        G._verify_bound_grade(VIDEO, out)
        print("PASS NEGATIVE: AR-1377 candidate-rebinding false green is closed")

        # Mutating raw grade after freeze must kill verification.
        original_raw = (out / "raw_accuracy_validator_response.txt").read_bytes()
        (out / "raw_accuracy_validator_response.txt").write_bytes(original_raw + b"\n")
        expect_fail(
            "raw grader response mutation after freeze",
            lambda: G._verify_bound_grade(VIDEO, out),
            "raw grade response changed",
        )
        (out / "raw_accuracy_validator_response.txt").write_bytes(original_raw)

        # Mutating the actual consumed guard witness must kill verification.
        original_permit = consumed.read_bytes()
        mutated = dict(permit)
        mutated["tool_use_id"] = "toolu-mutated"
        write_json(consumed, mutated)
        expect_fail(
            "consumed guard permit mutation after grade freeze",
            lambda: G._verify_bound_grade(VIDEO, out),
            "permit witness changed",
        )
        consumed.write_bytes(original_permit)

        # Candidate substitution after grading must kill verification.
        original_candidate = (out / "fresh_source_candidate.json").read_bytes()
        (out / "fresh_source_candidate.json").write_bytes(original_candidate + b" ")
        expect_fail(
            "fresh candidate substitution after independent grade",
            lambda: G._verify_bound_grade(VIDEO, out),
            "candidate changed",
        )
        (out / "fresh_source_candidate.json").write_bytes(original_candidate)

        # Cross-candidate receipt laundering must fail even with untouched permit.
        candidate_receipt_path = out / "candidate_receipt.json"
        original_receipt = candidate_receipt_path.read_bytes()
        bad_receipt = G.read_json(candidate_receipt_path)
        bad_receipt["candidate_sha256"] = "5" * 64
        write_json(candidate_receipt_path, bad_receipt)
        expect_fail(
            "grade receipt cannot be paired to another candidate receipt",
            lambda: G._verify_bound_grade(VIDEO, out),
            "candidate",
        )
        candidate_receipt_path.write_bytes(original_receipt)

        # Grade-task request mutation must fail before any legacy read.
        task_path = out / "independent_grade_task.json"
        original_task = task_path.read_bytes()
        bad_task = G.read_json(task_path)
        bad_task["agent_request"]["description"] = "attacker rewrite"
        write_json(task_path, bad_task)
        expect_fail(
            "grade Agent request mutation",
            lambda: G._verify_bound_grade(VIDEO, out),
            "Agent request",
        )
        task_path.write_bytes(original_task)

        G._verify_bound_grade(VIDEO, out)
        print("PASS FINAL CONTROL: untouched bound grade still verifies")

    print("ALL GPT BOUND-GRADE DEVELOPMENT PROOFS PASSED (execution must be independently rerun)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
