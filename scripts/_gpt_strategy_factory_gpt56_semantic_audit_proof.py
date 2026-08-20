#!/usr/bin/env python3
"""GPT-authored development proof for the GPT-5.6 Sol semantic-audit harness.

NOT independent certification. Worker-1 / Claude must execute this exact proof and add at least
one novel semantic attack before relying on the harness for Factory authority.

Carried forward unchanged (byte-identical test logic) from frozen pin 8acb6b0fc63e0b38595a9e64c2f61a77885e9f9b
into this branch's tracked scripts/ as an AR-1378A SS6 regression control: it must still pass 10/10
against the repaired harness (scripts/strategy_factory_gpt56_semantic_audit.py) with zero edits to
this file, proving the prompt-completeness repair did not touch enumeration/validation semantics.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "strategy_factory_gpt56_semantic_audit.py"
spec = importlib.util.spec_from_file_location("gpt56_audit", SCRIPT)
if spec is None or spec.loader is None:
    raise SystemExit("cannot import GPT-5.6 semantic audit harness")
G = importlib.util.module_from_spec(spec)
spec.loader.exec_module(G)

VIDEO = "semantic-proof-video"
TRANSCRIPT = (
    "On the five minute chart wait for a candle close above resistance and enter long. "
    "The moving average is shown in the top right corner. "
    "Place the stop below the swing low and target the prior high."
)
CANDIDATE = {
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
                    # Deliberate semantic false-green fixture: quote is literal but does NOT entail
                    # the claim. The harness can require coverage; GPT/Claude reasoning must catch it.
                    "description": "The moving average is optional and can be removed.",
                    "transcript_quote": "The moving average is shown in the top right corner."
                }
            ],
            "entry_sequence": [
                {
                    "step": 1,
                    "role": "trigger",
                    "action": "wait for a candle close above resistance and enter long",
                    "rationale": "source instruction",
                    "transcript_quote": "wait for a candle close above resistance and enter long"
                }
            ],
            "confluences": [],
            "stop": {
                "anchor": "below the swing low",
                "rationale": "source stop",
                "transcript_quote": "Place the stop below the swing low"
            },
            "targets": [
                {
                    "priority": 1,
                    "type": "prior high",
                    "rationale": "source target",
                    "transcript_quote": "target the prior high"
                }
            ],
            "management": [],
            "variants": [],
            "source_gaps": []
        }
    ],
    "top_level_source_gaps": []
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


def make_response(task: dict, *, false_claim_verdict: str = "NOT_ENTAILED", verdict: str = "FAIL") -> dict:
    ent = []
    false_ref = None
    for c in task["required_claims"]:
        is_false = "setup[0]" in c["claim_ref"]
        if is_false:
            false_ref = c["claim_ref"]
        ent.append({
            "claim_ref": c["claim_ref"],
            "verdict": false_claim_verdict if is_false else "ENTAILED",
            "reason": "planted quote-to-claim mismatch" if is_false else "claim matches source",
            "transcript_quote": c["transcript_quote"],
        })
    assert false_ref is not None
    findings = []
    if false_claim_verdict != "ENTAILED":
        findings.append({
            "severity": "HIGH",
            "ref": false_ref,
            "finding": "Literal quote only says where the moving average is displayed; it does not say the indicator is optional.",
            "transcript_quote": "The moving average is shown in the top right corner.",
        })
    return {
        "schema": G.RESPONSE_SCHEMA,
        "video_id": task["video_id"],
        "candidate_sha256": task["candidate_sha256"],
        "transcript_sha256": task["transcript_sha256"],
        "task_sha256": task["task_sha256"],
        "audit_nonce": task["audit_nonce"],
        "auditor_role": G.AUDITOR_ROLE,
        "model_identity": G.MODEL_IDENTITY,
        "legacy_semantics_visible": False,
        "verdict": verdict,
        "strategy_identity": [{
            "source_strategy_id": "s0",
            "classification": "independent_strategy",
            "reason": "complete setup/trigger/stop/target",
            "transcript_quote": "enter long",
        }],
        "claim_entailment": ent,
        "cross_field_checks": [
            {"check": name, "status": "PASS", "reason": "proof fixture", "transcript_quote": None}
            for name in G.REQUIRED_CROSS_CHECKS
        ],
        "findings": findings,
        "coverage_statement": "Every required claim and cross-field check reviewed.",
        "independence_statement": (
            "I audited the frozen Opus candidate only against the supplied original transcript before any legacy comparison."
        ),
    }


def emit_case(
    root: Path,
    name: str,
    *,
    transcript_text: str = TRANSCRIPT,
    candidate_obj: dict | None = None,
) -> tuple[Path, Path, Path, dict]:
    case = root / name
    case.mkdir(parents=True)
    transcript = case / "transcript.txt"
    candidate = case / "candidate.json"
    out = case / "out"
    transcript.write_text(transcript_text, encoding="utf-8", newline="\n")
    write_json(candidate, CANDIDATE if candidate_obj is None else candidate_obj)
    G.emit(argparse.Namespace(video_id=VIDEO, transcript=str(transcript), candidate=str(candidate), out_dir=str(out)))
    return transcript, candidate, out, G.read_json(out / "gpt56_semantic_audit_task.json")


def run_ingest(transcript: Path, candidate: Path, out: Path, response: dict) -> dict:
    raw = out / "audit-response.json"
    write_json(raw, response)
    G.ingest(argparse.Namespace(
        video_id=VIDEO,
        transcript=str(transcript),
        candidate=str(candidate),
        out_dir=str(out),
        raw_response=str(raw),
    ))
    return G.read_json(out / "gpt56_semantic_audit_receipt.json")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="gpt56-semantic-proof-") as td:
        root = Path(td)

        # AR-1377 generic suffix-field coverage: the base fixture itself proves direction and
        # execution_timeframe are now first-class obligations rather than accidental prompt text.
        base_claims = {c["claim_ref"]: c for c in G.enumerate_claims(CANDIDATE)}
        assert base_claims["strategies[0].direction"]["claim"] == "direction=long"
        assert base_claims["strategies[0].direction"]["transcript_quote"] == "enter long"
        assert base_claims["strategies[0].execution_timeframe"]["claim"] == "execution_timeframe=5m"
        assert base_claims["strategies[0].execution_timeframe"]["transcript_quote"] == "five minute chart"
        print("PASS POSITIVE: generic *_transcript_quote coverage includes direction + execution_timeframe")

        # Exact AR-1377 higher-timeframe class: a literal-but-non-entailing HTF quote must become
        # an explicit audit obligation; omission is impossible and NOT_ENTAILED must block PASS.
        htf_quote = "the one hour chart open on my second monitor"
        htf_transcript = TRANSCRIPT + " I keep the one hour chart open on my second monitor so you can see it while I talk."
        htf_candidate = json.loads(json.dumps(CANDIDATE))
        htf_candidate["strategies"][0]["higher_timeframe"] = "1h"
        htf_candidate["strategies"][0]["higher_timeframe_transcript_quote"] = htf_quote
        htf_claims = {c["claim_ref"]: c for c in G.enumerate_claims(htf_candidate)}
        htf_ref = "strategies[0].higher_timeframe"
        assert htf_claims[htf_ref]["claim"] == "higher_timeframe=1h"
        assert htf_claims[htf_ref]["transcript_quote"] == htf_quote
        print("PASS POSITIVE: AR-1377 fabricated higher_timeframe now adds a mandatory claim row")

        t, c, out, task = emit_case(
            root, "suffix-htf-regression", transcript_text=htf_transcript, candidate_obj=htf_candidate
        )
        clean = make_response(task, false_claim_verdict="ENTAILED", verdict="PASS")
        clean["claim_entailment"] = [r for r in clean["claim_entailment"] if r["claim_ref"] != htf_ref]
        expect_fail(
            "AR-1377 higher_timeframe row cannot be omitted",
            lambda: run_ingest(t, c, out, clean),
            "coverage incomplete",
        )

        not_entailed = make_response(task, false_claim_verdict="ENTAILED", verdict="FAIL")
        for row in not_entailed["claim_entailment"]:
            if row["claim_ref"] == htf_ref:
                row["verdict"] = "NOT_ENTAILED"
                row["reason"] = "quote says the 1h chart is displayed, not that it gates entry"
        not_entailed["findings"] = [{
            "severity": "HIGH",
            "ref": htf_ref,
            "finding": "Displayed 1h chart does not entail a 1h confirmation rule.",
            "transcript_quote": htf_quote,
        }]
        receipt = run_ingest(t, c, out, not_entailed)
        assert receipt["status"] == G.FAIL_STATUS
        assert receipt["semantic_pass"] is False
        assert any(htf_ref in reason and "NOT_ENTAILED" in reason for reason in receipt["fail_closed_reasons"])
        print("PASS NEGATIVE: AR-1377 higher_timeframe NOT_ENTAILED produces semantic FAIL")

        # 1. The core semantic false-green is represented honestly as FAIL even though the quote
        # itself is a perfect literal substring. This is the exact class a substring gate misses.
        t, c, out, task = emit_case(root, "semantic-mismatch")
        resp = make_response(task)
        receipt = run_ingest(t, c, out, resp)
        assert receipt["status"] == G.FAIL_STATUS
        assert any("NOT_ENTAILED" in r for r in receipt["fail_closed_reasons"])
        print("PASS POSITIVE: literal-but-wrong quote is representable as semantic NOT_ENTAILED and blocks authority")

        # 2. A model cannot call the same non-entailed response PASS.
        t, c, out, task = emit_case(root, "fake-pass")
        resp = make_response(task, false_claim_verdict="NOT_ENTAILED", verdict="PASS")
        expect_fail("PASS cannot coexist with NOT_ENTAILED claim", lambda: run_ingest(t, c, out, resp), "claims PASS")

        # 3. Missing one awkward claim from coverage is a hard refusal.
        t, c, out, task = emit_case(root, "missing-claim")
        resp = make_response(task)
        resp["claim_entailment"] = resp["claim_entailment"][:-1]
        expect_fail("missing claim coverage", lambda: run_ingest(t, c, out, resp), "coverage incomplete")

        # 4. Strategy segmentation cannot PASS if a top-level object is really a filter/qualifier.
        t, c, out, task = emit_case(root, "strategy-filter")
        resp = make_response(task, false_claim_verdict="ENTAILED", verdict="PASS")
        resp["strategy_identity"][0]["classification"] = "filter_or_qualifier"
        expect_fail("filter promoted to strategy", lambda: run_ingest(t, c, out, resp), "classified filter_or_qualifier")

        # 5. Any required cross-field check left FAIL/UNRESOLVED blocks PASS.
        t, c, out, task = emit_case(root, "cross-field")
        resp = make_response(task, false_claim_verdict="ENTAILED", verdict="PASS")
        resp["cross_field_checks"][0]["status"] = "UNRESOLVED"
        expect_fail("unresolved trigger-vs-gap check", lambda: run_ingest(t, c, out, resp), "cross-field")

        # 6. Wrong model/role cannot impersonate this seat.
        t, c, out, task = emit_case(root, "wrong-model")
        resp = make_response(task)
        resp["model_identity"] = "some-other-model"
        expect_fail("wrong model identity", lambda: run_ingest(t, c, out, resp), "model_identity")

        # 7. Audit evidence itself must be literal transcript evidence.
        t, c, out, task = emit_case(root, "invented-audit-quote")
        resp = make_response(task)
        resp["findings"][0]["transcript_quote"] = "THIS QUOTE DOES NOT EXIST"
        expect_fail("invented semantic-audit quote", lambda: run_ingest(t, c, out, resp), "not a literal")

        # 8. Candidate substitution after task freeze kills the audit binding.
        t, c, out, task = emit_case(root, "candidate-swap")
        resp = make_response(task)
        with c.open("a", encoding="utf-8") as f:
            f.write(" ")
        expect_fail("candidate mutation after audit task", lambda: run_ingest(t, c, out, resp), "candidate changed")

        # 9. Task mutation after emission kills the audit binding.
        t, c, out, task = emit_case(root, "task-mutation")
        resp = make_response(task)
        task_path = out / "gpt56_semantic_audit_task.json"
        mutated = G.read_json(task_path)
        mutated["legacy_semantics_visible"] = True
        write_json(task_path, mutated)
        expect_fail("semantic task mutation", lambda: run_ingest(t, c, out, resp), "task changed")

        # 10. Clean synthetic candidate can mechanically freeze a GPT56 PASS, but the status itself
        # explicitly says independent certification is still required.
        t, c, out, task = emit_case(root, "clean-positive")
        resp = make_response(task, false_claim_verdict="ENTAILED", verdict="PASS")
        receipt = run_ingest(t, c, out, resp)
        assert receipt["status"] == G.PASS_STATUS
        assert receipt["explicitly_not_factory_authority"] is True
        assert receipt["next_authority"] == "INDEPENDENT_CLAUDE_ACCURACY_VALIDATOR_REQUIRED"
        print("PASS POSITIVE: clean GPT56 audit freezes only as NOT independently certified")

    print("ALL GPT-5.6 SEMANTIC-AUDIT DEVELOPMENT PROOFS PASSED (Worker independent rerun required)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
