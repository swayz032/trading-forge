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
import ast
import inspect
import json
import subprocess
import tempfile
from pathlib import Path
from unittest import mock

import strategy_factory_gpt56_semantic_audit as G

REPO_ROOT = Path(__file__).resolve().parent.parent
BASE_COMMIT = "6deba50ef1f5004c9803a436e4ddfdce79430f4a"  # HEAD immediately before this repair
HARNESS_REL_PATH = "scripts/strategy_factory_gpt56_semantic_audit.py"


def _git_show_text(commit: str, rel_path: str) -> str:
    result = subprocess.run(
        ["git", "show", f"{commit}:{rel_path}"],
        cwd=REPO_ROOT, capture_output=True, check=True,
    )
    return result.stdout.decode("utf-8")


def _function_source(source_text: str, name: str) -> str:
    tree = ast.parse(source_text)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            segment = ast.get_source_segment(source_text, node)
            if segment is None:
                raise AssertionError(f"could not extract source segment for {name}")
            return segment
    raise AssertionError(f"function {name!r} not found in supplied source text")

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

        # ---- 0. V1 code paths untouched: live function source is byte-identical to the git blob
        #         at the commit immediately BEFORE this repair. This is a real two-instrument
        #         comparison (git history vs. the loaded module) -- NOT a comparison of the loaded
        #         module against itself, which would trivially pass even if V1 had been rewritten
        #         (an earlier version of this proof made exactly that mistake; see AR-1379A grade
        #         finding F-D, which caught it). If any V1 function had been edited, this asserts
        #         RED against the pre-repair commit. ----
        v1_names = ["build_task", "render_prompt", "_validate_response", "emit", "ingest"]
        pre_repair_text = _git_show_text(BASE_COMMIT, HARNESS_REL_PATH)
        for name in v1_names:
            # inspect.getsource() includes a trailing newline; ast.get_source_segment() does not --
            # rstrip both before comparing so that formatting-extraction artifact isn't mistaken for
            # a real divergence (verified: the only difference for every V1 function is this one
            # trailing "\n", confirmed by direct inspection before adding the rstrip).
            live_src = inspect.getsource(getattr(G, name)).rstrip("\n")
            pre_repair_src = _function_source(pre_repair_text, name).rstrip("\n")
            assert live_src == pre_repair_src, (
                f"V1 function {name} diverged from its source at pre-repair commit {BASE_COMMIT}"
            )
        print(f"PASS STRUCTURAL: V1 build_task/render_prompt/_validate_response/emit/ingest are "
              f"byte-identical to their source at pre-repair commit {BASE_COMMIT[:12]} "
              f"(git blob comparison, not an import-cache artifact)")

        # ---- 1. Old defect reproduction: V1 task_sha256 unaffected by contract-text swap ----
        base = base_candidate()
        _, _, _, v1_task, v1_prompt_before = emit_case_v1(root, "v1-defect", base)
        sha_before = v1_task["task_sha256"]
        with mock.patch.object(G, "ROLE_ASSIGNMENT_CONTRACT", G.ROLE_ASSIGNMENT_CONTRACT + " MUTATED."):
            v1_prompt_after = G.render_prompt(v1_task, TRANSCRIPT, json.dumps(base))
        # Load-bearing assertion: the prompt TEXT must actually change under the swapped contract
        # (otherwise this whole probe would prove nothing). sha_before/v1_task["task_sha256"] are
        # never recomputed anywhere in this block, so asserting them equal to each other would be
        # comparing a value to itself -- deliberately not asserted, per AR-1379A grade finding F-D.
        assert v1_prompt_before != v1_prompt_after, "prompt text must actually differ under the swapped contract"
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
        # F-A fix (independent grade finding): a hash-correct but mislabeled contract id must also
        # be refused at render time, not just at ingest time.
        mislabeled_task = dict(v2_task)
        mislabeled_task["semantic_contract_id"] = "AR-9999-TOTALLY-DIFFERENT-CONTRACT"
        expect_fail(
            "render_prompt_v2 refuses a task with a correct hash but a mislabeled contract id (F-A)",
            lambda: G.render_prompt_v2(mislabeled_task, TRANSCRIPT, json.dumps(base)),
            "semantic_contract_id",
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

        # ---- 5b. Independent-grade follow-up fixes (AR-1379A grade, 2026-08-20): F-A/F-B/F-C/F-E/F-F ----

        # F-A at ingest: a task.json hand-edited to a mislabeled contract id, WITH task_sha256
        # resealed consistently so the pre-existing tamper-evidence check cannot be what catches
        # it -- reproducing the grader's exact attack: hash-correct, resealed, only the label wrong.
        t5, c5, out5, task5, _ = emit_case_v2(root, "v2-fa-ingest-mislabel", base)
        mislabeled_on_disk = dict(task5)
        mislabeled_on_disk["semantic_contract_id"] = "AR-9999-TOTALLY-DIFFERENT-CONTRACT"
        resealed_core = dict(mislabeled_on_disk)
        del resealed_core["task_sha256"]
        mislabeled_on_disk["task_sha256"] = G.sha256_text(G.canonical_json(resealed_core))
        write_json(out5 / "gpt56_semantic_audit_task.json", mislabeled_on_disk)
        expect_fail(
            "ingest_v2 refuses a hash-correct, resealed, but relabelled semantic_contract_id (F-A)",
            lambda: run_ingest_v2(t5, c5, out5, clean_response_v2(task5, all_pass=True)),
            "semantic_contract_id",
        )

        # F-B: the emitted prompt file, if tampered/stripped after emission, must be refused at
        # ingest -- proving the receipt is bound to what was actually DELIVERED, not just to what
        # the task claims. Positive control: an untampered prompt still ingests clean and the
        # receipt now carries prompt_sha256.
        t6, c6, out6, task6, prompt6 = emit_case_v2(root, "v2-fb-prompt-binding", base)
        prompt_path6 = out6 / "gpt56_semantic_audit_prompt.txt"
        original_prompt_bytes = prompt_path6.read_text(encoding="utf-8")
        prompt_path6.write_text(
            original_prompt_bytes.replace(G.ROLE_ASSIGNMENT_CONTRACT, "STRIPPED"), encoding="utf-8"
        )
        expect_fail(
            "ingest_v2 refuses a delivered prompt file that no longer matches the bound task (F-B)",
            lambda: run_ingest_v2(t6, c6, out6, clean_response_v2(task6, all_pass=True)),
            "does not match the prompt",
        )
        prompt_path6.write_text(original_prompt_bytes, encoding="utf-8")
        receipt6 = run_ingest_v2(t6, c6, out6, clean_response_v2(task6, all_pass=True))
        assert receipt6["prompt_sha256"] == G.sha256_text(original_prompt_bytes)
        print("PASS (F-B): tampered delivered-prompt bytes are refused; an untampered prompt ingests "
              "clean and the receipt records the exact prompt_sha256 that was actually delivered")

        # F-C: emit_v2 must refuse to overwrite a differently-schemed (e.g. V1) task in the same
        # out-dir, but must still allow re-emitting into a directory that already holds a V2 task.
        emit_case_v1(root, "v2-fc-overwrite-guard", base)  # writes a V1 task/prompt into .../out
        v1_dir = root / "v2-fc-overwrite-guard" / "out"
        expect_fail(
            "emit_v2 refuses to overwrite an existing V1 task with the same filenames (F-C)",
            lambda: G.emit_v2(argparse.Namespace(
                video_id=VIDEO,
                transcript=str(root / "v2-fc-overwrite-guard" / "transcript.txt"),
                candidate=str(root / "v2-fc-overwrite-guard" / "candidate.json"),
                out_dir=str(v1_dir),
            )),
            "already holds a",
        )
        preserved_v1_task = G.read_json(v1_dir / "gpt56_semantic_audit_task.json")
        assert preserved_v1_task["schema"] == G.TASK_SCHEMA

        # Re-emitting V2 into a directory that ALREADY holds a V2 task must still be allowed
        # (idempotent regeneration is not the hazard; cross-schema clobber is) -- exercised against
        # a fresh directory that genuinely holds a V2 task first, not the V1 directory above.
        v2_dir_case = "v2-fc-idempotent-reemit"
        t10, c10, out10, task10_first, _ = emit_case_v2(root, v2_dir_case, base)
        G.emit_v2(argparse.Namespace(
            video_id=VIDEO, transcript=str(t10), candidate=str(c10), out_dir=str(out10),
        ))
        task10_second = G.read_json(out10 / "gpt56_semantic_audit_task.json")
        assert task10_second["schema"] == G.TASK_SCHEMA_V2
        print("PASS (F-C): emit_v2 refuses to clobber existing V1 evidence with the same filenames, "
              "while re-emitting into an already-V2 directory remains allowed")

        # F-E: _validate_response_v2 must fail closed (SystemExit) rather than crash (KeyError) when
        # a task is missing semantic_contract_id, when called directly (defense in depth beyond the
        # ingest_v2-level check exercised by F-A above).
        t8, c8, out8, task8, _ = emit_case_v2(root, "v2-fe-missing-key", base)
        broken_task = dict(task8)
        del broken_task["semantic_contract_id"]
        try:
            G._validate_response_v2(broken_task, clean_response_v2(task8, all_pass=True), TRANSCRIPT)
        except SystemExit as e:
            print(f"PASS (F-E): _validate_response_v2 fails closed via SystemExit, not KeyError, on a "
                  f"task missing semantic_contract_id: {e}")
        else:
            raise AssertionError("F-E: expected SystemExit, task missing semantic_contract_id was accepted")

        # F-F: a response echoing legacy_semantics_visible as the JSON int 0 (not the JSON bool
        # false) must be refused -- Python's 0 == False previously let this slip through.
        t9, c9, out9, task9, _ = emit_case_v2(root, "v2-ff-bool-laxity", base)
        int_zero_resp = clean_response_v2(task9, all_pass=True)
        int_zero_resp["legacy_semantics_visible"] = 0
        expect_fail(
            "ingest_v2 refuses legacy_semantics_visible=0 (int) where bool false is required (F-F)",
            lambda: run_ingest_v2(t9, c9, out9, int_zero_resp),
            "legacy_semantics_visible mismatch",
        )

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
