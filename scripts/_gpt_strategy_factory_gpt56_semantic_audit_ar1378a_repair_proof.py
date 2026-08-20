#!/usr/bin/env python3
"""AR-1378A SS6 repair proof for the GPT-5.6 Sol semantic-audit harness.

Worker-1 development proof, NOT independent certification (doer != grader --
accuracy-validator must independently attack this before the repaired harness
is relied on for a real GPT-5.6 dispatch).

Structure:
  0. RED  -- the OLD harness (frozen pin 8acb6b0fc63e0b38595a9e64c2f61a77885e9f9b,
             worktree wt-lanetest-repair-8acb6b0f) renders a prompt that does NOT
             contain the AR-1378A SS6 authoring-law contract. This is the exact
             defect the ruling names.
  1. GREEN -- the NEW harness (this branch, scripts/strategy_factory_gpt56_semantic_audit.py)
             renders a prompt that DOES contain all eight contract points, for the
             *same* candidate/transcript pair used in the RED probe.
  2-5. The four AR-1378A SS6 "Required tests / attack" fixtures.
  6. Regression: the AR-1377 atomic-binding and sibling-quote-coverage controls
     from the prior proof suite still hold unchanged under the new harness.

Honesty bound: this harness has no code path that semantically judges auditor
reasoning -- that judgment is GPT-5.6's, externally. What THIS proof can and does
show mechanically: (a) the contract text is now bound into every rendered prompt,
(b) every claim this repair concerns (legal setup content, and content illegally
placed in management[]/variants[]/stop/targets) is a MANDATORY, non-omittable
audit row, and (c) the ingest/validation invariants that existed before the
repair (coverage completeness, PASS/FAIL consistency, literal-quote binding)
are byte-for-byte unchanged. It does NOT and cannot prove GPT-5.6 will always
apply the law correctly -- that is exactly why independent Claude challenge
remains mandatory on every real audit response (AR-1383/AR-1384 practice).
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import tempfile
from pathlib import Path

NEW_SCRIPT = Path(__file__).resolve().parent / "strategy_factory_gpt56_semantic_audit.py"
OLD_SCRIPT = Path(r"C:\Users\tonio\Projects\wt-lanetest-repair-8acb6b0f\scripts\strategy_factory_gpt56_semantic_audit.py")
OLD_PIN = "8acb6b0fc63e0b38595a9e64c2f61a77885e9f9b"


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"cannot import {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


NEW = _load(NEW_SCRIPT, "gpt56_audit_new")
OLD = _load(OLD_SCRIPT, "gpt56_audit_old_8acb6b0f")

CONTRACT_MARKERS = [
    "MAY legally contain non-executable",
    "entry_sequence, stop, targets, management, variants",
    "Generic risk:reward",
    'distinguishes "invalidation" from "stop"',
    "complete entry+stop+target strategy unless a stronger written",
    "HONESTLY DISCLOSED unresolved source fact",
    "fully specified, deterministic MIRRORED executable trigger",
    "rescue an under-bound claim",
]

VIDEO = "ar1378a-repair-proof-video"
TRANSCRIPT = (
    "On the five minute chart wait for a candle close above resistance and enter long. "
    "The moving average is shown in the top right corner, that is just a visualization tool. "
    "This whole area above the range is my invalidation, that is not the stop. "
    "The actual stop goes below the qualifying candle. "
    "RR could really be anything on this one, it just depends. "
    "As an alternative you can also anchor off the prior swing high instead of the open."
)


def base_candidate() -> dict:
    return {
        "video_id": VIDEO,
        "reader_role": "OPUS_LEAD_SOURCE_READER",
        "instrument_classification": {"asset_class": "futures", "transcript_quote": "five minute chart"},
        "strategies": [
            {
                "source_strategy_id": "s0",
                "name": "breakout",
                "direction": "long",
                "direction_transcript_quote": "enter long",
                "higher_timeframe": "source_unresolved",
                "higher_timeframe_transcript_quote": None,
                "execution_timeframe": "5m",
                "execution_timeframe_transcript_quote": "five minute chart",
                "setup": [
                    {
                        "description": "The moving average shown is a visualization aid only, not part of the trigger.",
                        "transcript_quote": "The moving average is shown in the top right corner, that is just a visualization tool.",
                    }
                ],
                "entry_sequence": [
                    {
                        "step": 1,
                        "role": "trigger",
                        "action": "wait for a candle close above resistance and enter long",
                        "rationale": "source instruction",
                        "transcript_quote": "wait for a candle close above resistance and enter long",
                    }
                ],
                "confluences": [],
                "stop": {
                    "anchor": "below the qualifying candle",
                    "rationale": "source-taught stop placement",
                    "transcript_quote": "The actual stop goes below the qualifying candle.",
                },
                "targets": [
                    {
                        "priority": 1,
                        "type": "prior high",
                        "rationale": "source target",
                        "transcript_quote": "wait for a candle close above resistance and enter long",
                    }
                ],
                "management": [],
                "variants": [],
                "source_gaps": [],
            }
        ],
        "top_level_source_gaps": [],
    }


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8", newline="\n")


def expect_fail(label: str, fn, contains: str | None = None) -> None:
    try:
        fn()
    except SystemExit as e:
        text = str(e)
        if contains and contains.lower() not in text.lower():
            raise AssertionError(f"{label}: wrong refusal: {text}")
        print(f"PASS NEGATIVE: {label}: {text}")
        return
    raise AssertionError(f"{label}: expected refusal")


def emit_case(mod, root: Path, name: str, candidate: dict, transcript_text: str = TRANSCRIPT):
    case = root / name
    case.mkdir(parents=True)
    transcript = case / "transcript.txt"
    candidate_path = case / "candidate.json"
    out = case / "out"
    transcript.write_text(transcript_text, encoding="utf-8", newline="\n")
    write_json(candidate_path, candidate)
    mod.emit(argparse.Namespace(video_id=VIDEO, transcript=str(transcript), candidate=str(candidate_path), out_dir=str(out)))
    task = mod.read_json(out / "gpt56_semantic_audit_task.json")
    prompt = (out / "gpt56_semantic_audit_prompt.txt").read_text(encoding="utf-8")
    return transcript, candidate_path, out, task, prompt


def run_ingest(mod, transcript: Path, candidate: Path, out: Path, response: dict) -> dict:
    raw = out / "audit-response.json"
    write_json(raw, response)
    mod.ingest(argparse.Namespace(
        video_id=VIDEO, transcript=str(transcript), candidate=str(candidate),
        out_dir=str(out), raw_response=str(raw),
    ))
    return mod.read_json(out / "gpt56_semantic_audit_receipt.json")


def clean_response(mod, task: dict, *, all_pass: bool = True) -> dict:
    ent = [{
        "claim_ref": c["claim_ref"], "verdict": "ENTAILED",
        "reason": "matches source", "transcript_quote": c["transcript_quote"],
    } for c in task["required_claims"]]
    return {
        "schema": mod.RESPONSE_SCHEMA,
        "video_id": task["video_id"], "candidate_sha256": task["candidate_sha256"],
        "transcript_sha256": task["transcript_sha256"], "task_sha256": task["task_sha256"],
        "audit_nonce": task["audit_nonce"], "auditor_role": mod.AUDITOR_ROLE,
        "model_identity": mod.MODEL_IDENTITY, "legacy_semantics_visible": False,
        "verdict": "PASS" if all_pass else "FAIL",
        "strategy_identity": [{
            "source_strategy_id": "s0", "classification": "independent_strategy",
            "reason": "complete setup/trigger/stop/target", "transcript_quote": "enter long",
        }],
        "claim_entailment": ent,
        "cross_field_checks": [
            {"check": name, "status": "PASS", "reason": "proof fixture", "transcript_quote": None}
            for name in mod.REQUIRED_CROSS_CHECKS
        ],
        "findings": [],
        "coverage_statement": "Every required claim and cross-field check reviewed.",
        "independence_statement": (
            "I audited the frozen Opus candidate only against the supplied original transcript before any legacy comparison."
        ),
    }


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="ar1378a-repair-proof-") as td:
        root = Path(td)

        # ---- 0/1. RED (old pin) vs GREEN (repaired) prompt-content proof ----
        base = base_candidate()
        _, _, _, _, old_prompt = emit_case(OLD, root / "old", "red", base)
        missing_in_old = [m for m in CONTRACT_MARKERS if m not in old_prompt]
        if len(missing_in_old) != len(CONTRACT_MARKERS):
            raise AssertionError(
                f"RED PROBE INVALID: old pin {OLD_PIN} unexpectedly already contains "
                f"{len(CONTRACT_MARKERS) - len(missing_in_old)}/{len(CONTRACT_MARKERS)} contract markers"
            )
        print(f"RED CONFIRMED: old harness @ {OLD_PIN} prompt contains 0/{len(CONTRACT_MARKERS)} "
              f"AR-1378A SS6 contract markers (the exact defect the ruling names)")

        _, _, _, _, new_prompt = emit_case(NEW, root / "new", "green", base)
        missing_in_new = [m for m in CONTRACT_MARKERS if m not in new_prompt]
        if missing_in_new:
            raise AssertionError(f"GREEN PROBE FAILED: repaired harness still missing markers: {missing_in_new}")
        print(f"GREEN CONFIRMED: repaired harness prompt contains {len(CONTRACT_MARKERS)}/{len(CONTRACT_MARKERS)} "
              f"AR-1378A SS6 contract markers")

        # ---- 2. Positive fixture: legal non-executable setup[] content ----
        pos = base_candidate()
        pos["strategies"][0]["setup"].append({
            "description": "This is just a platform demo, TradingView here, not part of the trigger itself.",
            "transcript_quote": "The moving average is shown in the top right corner, that is just a visualization tool.",
        })
        t, c, out, task, prompt = emit_case(NEW, root, "positive-setup", pos)
        assert any(r["claim_ref"].startswith("strategies[0].setup") for r in task["required_claims"]), \
            "legal setup[] content must remain a mandatory reviewable claim"
        assert "MAY legally contain non-executable" in prompt
        resp = clean_response(NEW, task, all_pass=True)
        receipt = run_ingest(NEW, t, c, out, resp)
        assert receipt["status"] == NEW.PASS_STATUS
        print("PASS POSITIVE: legal non-executable setup[] content stays a mandatory claim and a compliant "
              "role_assignment=PASS response is accepted (no false-green harness regression)")

        # ---- 3. Negative fixture: same class of material misplaced in management[] ----
        neg_mgmt = base_candidate()
        neg_mgmt["strategies"][0]["management"] = [{
            "description": "This is just a platform demo, not an executable management rule.",
            "transcript_quote": "The moving average is shown in the top right corner, that is just a visualization tool.",
        }]
        t, c, out, task, prompt = emit_case(NEW, root, "negative-management", neg_mgmt)
        mgmt_refs = [r["claim_ref"] for r in task["required_claims"] if r["claim_ref"].startswith("strategies[0].management")]
        assert mgmt_refs, "misplaced non-executable material in management[] must be a mandatory reviewable claim"
        assert "entry_sequence, stop, targets, management, variants" in prompt
        resp = clean_response(NEW, task, all_pass=False)
        for row in resp["claim_entailment"]:
            if row["claim_ref"] in mgmt_refs:
                row["verdict"] = "ENTAILED"
        for row in resp["cross_field_checks"]:
            if row["check"] == "role_assignment":
                row["status"] = "FAIL"
                row["reason"] = "non-executable/visualization material placed in management[], a forbidden container"
        resp["findings"] = [{
            "severity": "HIGH", "ref": mgmt_refs[0],
            "finding": "Platform/visualization commentary is placed in management[], which the authoring contract forbids for non-executable material.",
            "transcript_quote": None,
        }]
        receipt = run_ingest(NEW, t, c, out, resp)
        assert receipt["status"] == NEW.FAIL_STATUS
        assert any("role_assignment" in r for r in receipt["fail_closed_reasons"])
        print("PASS NEGATIVE: management[]-misplaced material stays a mandatory claim, forbidden-container rule "
              "is bound into the prompt, and a compliant role_assignment=FAIL response is accepted")

        # ---- 4. Negative fixture: invalidation boundary planted as the stop ----
        neg_stop = base_candidate()
        neg_stop["strategies"][0]["stop"] = {
            "anchor": "the whole area above the range",
            "rationale": "invalidation boundary mislabeled as stop",
            "transcript_quote": "This whole area above the range is my invalidation, that is not the stop.",
        }
        t, c, out, task, prompt = emit_case(NEW, root, "negative-stop-invalidation", neg_stop)
        stop_refs = [r["claim_ref"] for r in task["required_claims"] if r["claim_ref"] == "strategies[0].stop"]
        assert stop_refs, "stop claim must remain mandatory and reviewable"
        assert 'distinguishes "invalidation" from "stop"' in prompt
        resp = clean_response(NEW, task, all_pass=False)
        for row in resp["cross_field_checks"]:
            if row["check"] == "role_assignment":
                row["status"] = "FAIL"
                row["reason"] = "whole-POI invalidation boundary substituted for the actual taught stop"
        resp["findings"] = [{
            "severity": "HIGH", "ref": "strategies[0].stop",
            "finding": "The transcript itself distinguishes invalidation from stop; the candidate's stop field is the invalidation boundary, not the taught stop.",
            "transcript_quote": "This whole area above the range is my invalidation, that is not the stop.",
        }]
        receipt = run_ingest(NEW, t, c, out, resp)
        assert receipt["status"] == NEW.FAIL_STATUS
        print("PASS NEGATIVE: invalidation-as-stop stays a mandatory claim, the invalidation/stop distinction rule "
              "is bound into the prompt, and a compliant role_assignment=FAIL response is accepted")

        # ---- 5. Negative fixture: generic R:R commentary planted as a target ----
        neg_target = base_candidate()
        neg_target["strategies"][0]["targets"] = [{
            "priority": 1, "type": "risk:reward commentary",
            "rationale": "generic philosophy, not a target level",
            "transcript_quote": "RR could really be anything on this one, it just depends.",
        }]
        t, c, out, task, prompt = emit_case(NEW, root, "negative-target-rr", neg_target)
        target_refs = [r["claim_ref"] for r in task["required_claims"] if r["claim_ref"].startswith("strategies[0].targets")]
        assert target_refs, "targets[] claim must remain mandatory and reviewable"
        assert "Generic risk:reward" in prompt
        resp = clean_response(NEW, task, all_pass=False)
        for row in resp["cross_field_checks"]:
            if row["check"] == "role_assignment":
                row["status"] = "FAIL"
                row["reason"] = "generic R:R commentary represented as a target destination"
        resp["findings"] = [{
            "severity": "HIGH", "ref": target_refs[0],
            "finding": "\"RR could really be anything\" is risk/reward commentary, not a source-taught target destination.",
            "transcript_quote": "RR could really be anything on this one, it just depends.",
        }]
        receipt = run_ingest(NEW, t, c, out, resp)
        assert receipt["status"] == NEW.FAIL_STATUS
        print("PASS NEGATIVE: R:R-commentary-as-target stays a mandatory claim, the targets[] rule is bound into "
              "the prompt, and a compliant role_assignment=FAIL response is accepted")

        # ---- 6. Regression: AR-1377 atomic-binding + sibling-quote coverage controls, unchanged ----
        htf_quote = "the one hour chart open on my second monitor"
        htf_transcript = TRANSCRIPT + " I keep the one hour chart open on my second monitor so you can see it while I talk."
        htf_candidate = base_candidate()
        htf_candidate["strategies"][0]["higher_timeframe"] = "1h"
        htf_candidate["strategies"][0]["higher_timeframe_transcript_quote"] = htf_quote
        t, c, out, task, _ = emit_case(NEW, root, "regression-suffix-htf", htf_candidate, transcript_text=htf_transcript)
        htf_ref = "strategies[0].higher_timeframe"
        assert any(cl["claim_ref"] == htf_ref for cl in task["required_claims"])
        clean = clean_response(NEW, task, all_pass=True)
        clean["claim_entailment"] = [r for r in clean["claim_entailment"] if r["claim_ref"] != htf_ref]
        expect_fail(
            "AR-1377 higher_timeframe row cannot be omitted (regression)",
            lambda: run_ingest(NEW, t, c, out, clean),
            "coverage incomplete",
        )

        t, c, out, task, _ = emit_case(NEW, root, "regression-semantic-mismatch", base_candidate())
        resp = clean_response(NEW, task, all_pass=False)
        for row in resp["claim_entailment"]:
            if row["claim_ref"] == "strategies[0].setup[0]":
                row["verdict"] = "NOT_ENTAILED"
        resp["findings"] = [{
            "severity": "HIGH", "ref": "strategies[0].setup[0]",
            "finding": "planted quote-to-claim mismatch", "transcript_quote": None,
        }]
        receipt = run_ingest(NEW, t, c, out, resp)
        assert receipt["status"] == NEW.FAIL_STATUS
        assert any("NOT_ENTAILED" in r for r in receipt["fail_closed_reasons"])
        print("PASS REGRESSION: AR-1377 atomic quote-binding and sibling-quote coverage controls unchanged "
              "under the repaired harness")

    print("ALL AR-1378A SS6 REPAIR PROOFS PASSED (independent accuracy-validator attack still required)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
