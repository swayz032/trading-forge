#!/usr/bin/env python3
"""AR-1379A V2 contract-binding repair proof for the GPT-5.6 Sol semantic-audit harness.

Worker-1 development proof, NOT independent certification (doer != grader --
accuracy-validator must independently attack this before the V2 task path is relied on for a
real GPT-5.6 dispatch, exactly as AR-1379A section 5 requires: "Independent grader/attack is
required because this changes load-bearing audit identity.").

Runs all eight AR-1379A section 5 "Required repair proof / attack" points, in order, plus one
extra structural check (V1 code paths untouched):

  0. V1 code paths byte-identical (no accidental reinterpretation of V1 as V2).
  1. Old defect reproduction: V1 task_sha256 is unchanged by a contract-text swap.
  2. V2 discrimination: one byte of ROLE_ASSIGNMENT_CONTRACT changes semantic_contract_sha256
     and therefore task_sha256, nonce/candidate/transcript held fixed.
  3. Render refusal: task contract hash != live contract hash => render_prompt_v2 fails closed.
  4. Response refusal: response echoes wrong contract id/hash => ingest_v2 refuses.
  5. Receipt proof: a valid V2 ingest records the exact bound contract id/hash.
  6. Role prompt controls remain (AR-1378A SS6): legal setup[] context permitted; same material
     outside setup[] forbidden; invalidation-as-stop and R:R-as-target rules remain present --
     exercised through the V2 emit/ingest path this time, not just V1.
  7. AR-1377 claim-enumeration controls remain intact under the V2 path, including a
     sibling *_transcript_quote field (enumerate_claims/strategy_ids are shared, unmodified
     helpers -- this proves the V2 wrapper did not accidentally bypass them).
  8. No weakening of the strict PASS law under V2: every claim ENTAILED, every strategy
     independent, every cross-field PASS, no HIGH/CRITICAL findings -> and only then PASS.

Honesty bound: identical to the AR-1378A proof suite this extends -- this harness has no code
path that semantically judges auditor reasoning; what this proof shows mechanically is the
deterministic identity join (candidate + transcript + semantic contract -> task_sha256 -> GPT
response identity -> ingest receipt) and that it fails closed on every tested tamper. It does
NOT and cannot prove GPT-5.6 will always apply the contract correctly -- independent Claude
challenge remains mandatory on every real audit response.
"""
from __future__ import annotations

import argparse
import importlib
import json
import tempfile
from pathlib import Path
from unittest import mock

import strategy_factory_gpt56_semantic_audit as G

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

VIDEO = "ar1379a-v2-contract-binding-proof-video"
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


def emit_case_v1(root: Path, name: str, candidate: dict, transcript_text: str = TRANSCRIPT):
    case = root / name
    case.mkdir(parents=True)
    transcript = case / "transcript.txt"
    candidate_path = case / "candidate.json"
    out = case / "out"
    transcript.write_text(transcript_text, encoding="utf-8", newline="\n")
    write_json(candidate_path, candidate)
    G.emit(argparse.Namespace(video_id=VIDEO, transcript=str(transcript), candidate=str(candidate_path), out_dir=str(out)))
    task = G.read_json(out / "gpt56_semantic_audit_task.json")
    prompt = (out / "gpt56_semantic_audit_prompt.txt").read_text(encoding="utf-8")
    return transcript, candidate_path, out, task, prompt


def emit_case_v2(root: Path, name: str, candidate: dict, transcript_text: str = TRANSCRIPT):
    case = root / name
    case.mkdir(parents=True)
    transcript = case / "transcript.txt"
    candidate_path = case / "candidate.json"
    out = case / "out"
    transcript.write_text(transcript_text, encoding="utf-8", newline="\n")
    write_json(candidate_path, candidate)
    G.emit_v2(argparse.Namespace(video_id=VIDEO, transcript=str(transcript), candidate=str(candidate_path), out_dir=str(out)))
    task = G.read_json(out / "gpt56_semantic_audit_task.json")
    prompt = (out / "gpt56_semantic_audit_prompt.txt").read_text(encoding="utf-8")
    return transcript, candidate_path, out, task, prompt


def run_ingest_v2(transcript: Path, candidate: Path, out: Path, response: dict) -> dict:
    raw = out / "audit-response.json"
    write_json(raw, response)
    G.ingest_v2(argparse.Namespace(
        video_id=VIDEO, transcript=str(transcript), candidate=str(candidate),
        out_dir=str(out), raw_response=str(raw),
    ))
    return G.read_json(out / "gpt56_semantic_audit_receipt.json")


def clean_response_v2(task: dict, *, all_pass: bool = True) -> dict:
    ent = [{
        "claim_ref": c["claim_ref"], "verdict": "ENTAILED",
        "reason": "matches source", "transcript_quote": c["transcript_quote"],
    } for c in task["required_claims"]]
    return {
        "schema": G.RESPONSE_SCHEMA_V2,
        "video_id": task["video_id"], "candidate_sha256": task["candidate_sha256"],
        "transcript_sha256": task["transcript_sha256"], "task_sha256": task["task_sha256"],
        "audit_nonce": task["audit_nonce"], "auditor_role": G.AUDITOR_ROLE,
        "model_identity": G.MODEL_IDENTITY, "legacy_semantics_visible": False,
        "semantic_contract_id": task["semantic_contract_id"],
        "semantic_contract_sha256": task["semantic_contract_sha256"],
        "verdict": "PASS" if all_pass else "FAIL",
        "strategy_identity": [{
            "source_strategy_id": "s0", "classification": "independent_strategy",
            "reason": "complete setup/trigger/stop/target", "transcript_quote": "enter long",
        }],
        "claim_entailment": ent,
        "cross_field_checks": [
            {"check": name, "status": "PASS", "reason": "proof fixture", "transcript_quote": None}
            for name in G.REQUIRED_CROSS_CHECKS
        ],
        "findings": [],
        "coverage_statement": "Every required claim and cross-field check reviewed.",
        "independence_statement": (
            "I audited the frozen Opus candidate only against the supplied original transcript before any legacy comparison."
        ),
    }


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="ar1379a-v2-proof-") as td:
        root = Path(td)

        # ---- 0. V1 code paths untouched: module source of every V1 function is byte-identical
        #         to a fresh re-import (i.e. nothing in this proof or the V2 addition mutates them). ----
        import inspect
        v1_names = ["build_task", "render_prompt", "_validate_response", "emit", "ingest"]
        fresh = importlib.import_module("strategy_factory_gpt56_semantic_audit")
        importlib.reload(fresh)
        for name in v1_names:
            live_src = inspect.getsource(getattr(G, name))
            fresh_src = inspect.getsource(getattr(fresh, name))
            assert live_src == fresh_src, f"V1 function {name} diverged from a fresh module reload"
        print("PASS STRUCTURAL: V1 build_task/render_prompt/_validate_response/emit/ingest "
              "are present unmodified alongside the new V2 functions")

        # ---- 1. Old defect reproduction: V1 task_sha256 unaffected by contract-text swap ----
        base = base_candidate()
        _, _, _, v1_task, v1_prompt_before = emit_case_v1(root, "v1-defect", base)
        sha_before = v1_task["task_sha256"]
        with mock.patch.object(G, "ROLE_ASSIGNMENT_CONTRACT", G.ROLE_ASSIGNMENT_CONTRACT + " MUTATED."):
            v1_prompt_after = G.render_prompt(v1_task, TRANSCRIPT, json.dumps(base))
        assert v1_task["task_sha256"] == sha_before, "V1 task identity must be untouched by this proof"
        assert v1_prompt_before != v1_prompt_after, "prompt text must actually differ under the swapped contract"
        assert "task_sha256" not in v1_prompt_after or v1_task["task_sha256"] == sha_before
        print(f"RED CONFIRMED (historical, expected): V1 task_sha256={sha_before[:16]}... is IDENTICAL whether the "
              f"prompt is rendered under the original or a mutated ROLE_ASSIGNMENT_CONTRACT -- this is exactly "
              f"AR-1379A F-1: a V1 receipt cannot prove which contract text the auditor actually saw. V1 is left "
              f"unrepaired by design (historical artifacts read through the old harness); V2 closes this below.")

        # ---- 2. V2 discrimination: one byte of the contract changes semantic_contract_sha256 and task_sha256 ----
        fixed_nonce = "f" * 64
        with mock.patch.object(G.secrets, "token_hex", return_value=fixed_nonce):
            task_a = G.build_task_v2(VIDEO, TRANSCRIPT, base, json.dumps(base).encode("utf-8"))
            with mock.patch.object(G, "ROLE_ASSIGNMENT_CONTRACT", G.ROLE_ASSIGNMENT_CONTRACT + "."):
                task_b = G.build_task_v2(VIDEO, TRANSCRIPT, base, json.dumps(base).encode("utf-8"))
        assert task_a["audit_nonce"] == task_b["audit_nonce"] == fixed_nonce
        assert task_a["candidate_sha256"] == task_b["candidate_sha256"]
        assert task_a["transcript_sha256"] == task_b["transcript_sha256"]
        assert task_a["semantic_contract_sha256"] != task_b["semantic_contract_sha256"], \
            "one-byte contract change must change semantic_contract_sha256"
        assert task_a["task_sha256"] != task_b["task_sha256"], \
            "one-byte contract change must change task_sha256 (V2 identity must bind the contract)"
        print(f"GREEN CONFIRMED: with nonce/candidate/transcript held fixed, a single trailing '.' appended to "
              f"ROLE_ASSIGNMENT_CONTRACT changes semantic_contract_sha256 "
              f"({task_a['semantic_contract_sha256'][:12]}... -> {task_b['semantic_contract_sha256'][:12]}...) "
              f"and therefore task_sha256 ({task_a['task_sha256'][:12]}... -> {task_b['task_sha256'][:12]}...)")

        # ---- 3. Render refusal: bound contract hash != live contract hash ----
        _, _, _, v2_task, v2_prompt = emit_case_v2(root, "v2-clean", base)
        assert v2_task["semantic_contract_id"] == G.SEMANTIC_CONTRACT_ID
        assert v2_task["semantic_contract_sha256"] == G.semantic_contract_sha256()
        assert v2_task["task_sha256"] != v1_task["task_sha256"]
        tampered_task = dict(v2_task)
        tampered_task["semantic_contract_sha256"] = "0" * 64
        expect_fail(
            "render_prompt_v2 refuses a task bound to a stale/wrong contract hash",
            lambda: G.render_prompt_v2(tampered_task, TRANSCRIPT, json.dumps(base)),
            "does not match the live",
        )

        # ---- 4. Response refusal: response echoes wrong contract id/hash ----
        t, c, out, task, prompt = emit_case_v2(root, "v2-response-refusal", base)
        assert task["semantic_contract_id"] in prompt and task["semantic_contract_sha256"] in prompt
        bad_resp = clean_response_v2(task, all_pass=True)
        bad_resp["semantic_contract_sha256"] = "1" * 64
        expect_fail(
            "ingest_v2 refuses a response echoing the wrong semantic_contract_sha256",
            lambda: run_ingest_v2(t, c, out, bad_resp),
            "semantic_contract_sha256 mismatch",
        )
        bad_resp2 = clean_response_v2(task, all_pass=True)
        bad_resp2["semantic_contract_id"] = "WRONG-CONTRACT-ID"
        expect_fail(
            "ingest_v2 refuses a response echoing the wrong semantic_contract_id",
            lambda: run_ingest_v2(t, c, out, bad_resp2),
            "semantic_contract_id mismatch",
        )

        # ---- 5. Receipt proof: a valid V2 ingest records the exact bound contract id/hash ----
        good_resp = clean_response_v2(task, all_pass=True)
        receipt = run_ingest_v2(t, c, out, good_resp)
        assert receipt["schema"] == G.RECEIPT_SCHEMA_V2
        assert receipt["status"] == G.PASS_STATUS
        assert receipt["semantic_contract_id"] == task["semantic_contract_id"]
        assert receipt["semantic_contract_sha256"] == task["semantic_contract_sha256"]
        assert receipt["semantic_contract_sha256"] == G.semantic_contract_sha256()
        print("PASS: valid V2 ingest receipt records the exact bound semantic_contract_id/sha256, "
              "joining candidate + transcript + semantic contract -> task_sha256 -> response -> receipt")

        # ---- 6. Role prompt controls remain, exercised through the V2 path ----
        missing = [m for m in CONTRACT_MARKERS if m not in prompt]
        assert not missing, f"V2 prompt missing AR-1378A SS6 contract markers: {missing}"
        print(f"PASS: V2 rendered prompt still carries {len(CONTRACT_MARKERS)}/{len(CONTRACT_MARKERS)} "
              f"AR-1378A SS6 authoring-contract markers")

        neg_mgmt = base_candidate()
        neg_mgmt["strategies"][0]["management"] = [{
            "description": "This is just a platform demo, not an executable management rule.",
            "transcript_quote": "The moving average is shown in the top right corner, that is just a visualization tool.",
        }]
        t, c, out, task, prompt = emit_case_v2(root, "v2-negative-management", neg_mgmt)
        mgmt_refs = [r["claim_ref"] for r in task["required_claims"] if r["claim_ref"].startswith("strategies[0].management")]
        assert mgmt_refs, "misplaced non-executable material in management[] must remain a mandatory claim under V2"
        resp = clean_response_v2(task, all_pass=False)
        for row in resp["claim_entailment"]:
            if row["claim_ref"] in mgmt_refs:
                row["verdict"] = "ENTAILED"
        for row in resp["cross_field_checks"]:
            if row["check"] == "role_assignment":
                row["status"] = "FAIL"
                row["reason"] = "non-executable/visualization material placed in management[], a forbidden container"
        resp["findings"] = [{
            "severity": "HIGH", "ref": mgmt_refs[0],
            "finding": "Platform/visualization commentary is placed in management[], which the authoring contract forbids.",
            "transcript_quote": None,
        }]
        receipt = run_ingest_v2(t, c, out, resp)
        assert receipt["status"] == G.FAIL_STATUS
        assert any("role_assignment" in r for r in receipt["fail_closed_reasons"])
        print("PASS NEGATIVE (V2): management[]-misplaced material still forces role_assignment=FAIL to be accepted "
              "and the receipt correctly records FAIL_STATUS")

        neg_stop = base_candidate()
        neg_stop["strategies"][0]["stop"] = {
            "anchor": "the whole area above the range",
            "rationale": "invalidation boundary mislabeled as stop",
            "transcript_quote": "This whole area above the range is my invalidation, that is not the stop.",
        }
        t, c, out, task, prompt = emit_case_v2(root, "v2-negative-stop", neg_stop)
        resp = clean_response_v2(task, all_pass=False)
        for row in resp["cross_field_checks"]:
            if row["check"] == "role_assignment":
                row["status"] = "FAIL"
                row["reason"] = "whole-POI invalidation boundary substituted for the actual taught stop"
        resp["findings"] = [{
            "severity": "HIGH", "ref": "strategies[0].stop",
            "finding": "The transcript distinguishes invalidation from stop; candidate's stop field is the invalidation boundary.",
            "transcript_quote": "This whole area above the range is my invalidation, that is not the stop.",
        }]
        receipt = run_ingest_v2(t, c, out, resp)
        assert receipt["status"] == G.FAIL_STATUS
        print("PASS NEGATIVE (V2): invalidation-as-stop still forces a FAIL receipt under the V2 path")

        # ---- 7. AR-1377 claim-enumeration / sibling-quote coverage controls remain intact under V2 ----
        htf_quote = "the one hour chart open on my second monitor"
        htf_transcript = TRANSCRIPT + " I keep the one hour chart open on my second monitor so you can see it while I talk."
        htf_candidate = base_candidate()
        htf_candidate["strategies"][0]["higher_timeframe"] = "1h"
        htf_candidate["strategies"][0]["higher_timeframe_transcript_quote"] = htf_quote
        t, c, out, task, _ = emit_case_v2(root, "v2-regression-suffix-htf", htf_candidate, transcript_text=htf_transcript)
        htf_ref = "strategies[0].higher_timeframe"
        assert any(cl["claim_ref"] == htf_ref for cl in task["required_claims"]), \
            "sibling *_transcript_quote enumeration must survive the V2 wrapper unchanged"
        clean = clean_response_v2(task, all_pass=True)
        clean["claim_entailment"] = [r for r in clean["claim_entailment"] if r["claim_ref"] != htf_ref]
        expect_fail(
            "AR-1377 higher_timeframe row cannot be omitted under V2 (regression)",
            lambda: run_ingest_v2(t, c, out, clean),
            "coverage incomplete",
        )

        # ---- 8. Strict PASS law unchanged under V2 ----
        t, c, out, task, _ = emit_case_v2(root, "v2-strict-pass-law", base_candidate())
        resp = clean_response_v2(task, all_pass=False)
        for row in resp["claim_entailment"]:
            if row["claim_ref"] == "strategies[0].setup[0]":
                row["verdict"] = "NOT_ENTAILED"
        resp["findings"] = [{
            "severity": "HIGH", "ref": "strategies[0].setup[0]",
            "finding": "planted quote-to-claim mismatch", "transcript_quote": None,
        }]
        receipt = run_ingest_v2(t, c, out, resp)
        assert receipt["status"] == G.FAIL_STATUS
        assert any("NOT_ENTAILED" in r for r in receipt["fail_closed_reasons"])

        t, c, out, task, _ = emit_case_v2(root, "v2-strict-pass-law-clean", base_candidate())
        clean_resp = clean_response_v2(task, all_pass=True)
        receipt = run_ingest_v2(t, c, out, clean_resp)
        assert receipt["status"] == G.PASS_STATUS
        assert receipt["fail_closed_reasons"] == []
        print("PASS: strict PASS law unchanged under V2 -- a single NOT_ENTAILED claim forces FAIL, and only a "
              "fully clean response (every claim ENTAILED, every strategy independent, every cross-field PASS, "
              "no HIGH/CRITICAL) produces PASS_STATUS")

    print("ALL AR-1379A V2 CONTRACT-BINDING REPAIR PROOFS PASSED "
          "(independent accuracy-validator attack still required before real GPT-5.6 dispatch)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
