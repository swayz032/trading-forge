#!/usr/bin/env python3
"""Worker-authored novel semantic false-green attack (Lane B) against
scripts/strategy_factory_gpt56_semantic_audit.py.

SEAM UNDER ATTACK: claim-enumeration under-inclusion.

`enumerate_claims()` creates a semantic-review obligation ONLY for dict nodes that carry a key
named exactly "transcript_quote". The candidate schema (see GPT's own proof fixture) ALSO uses
sibling-suffix quote fields on the strategy object itself:
    direction / direction_transcript_quote
    higher_timeframe / higher_timeframe_transcript_quote
    execution_timeframe / execution_timeframe_transcript_quote
The strategy object has no bare "transcript_quote" key, so NONE of those quote-bearing claims
becomes a claim_ref. They are never entailment-reviewed, never literal-checked, and never
appear in required_claims.

The harness itself proves it regards these as claim content: `_claim_text_for_dict()` lists
"direction", "higher_timeframe" and "execution_timeframe" among its preferred claim keys.

ATTACK: forge a multi-timeframe gating rule ("higher_timeframe": "1h"). The upstream harness
`strategy_factory_opus_transcript_first_diagnostic.py` DOES literal-check
`higher_timeframe_transcript_quote` (lines 334-344), so the payload uses a quote that is a real
literal transcript substring but does NOT entail the gate -- the educator says the 1h chart is
merely displayed on a monitor, never that it confirms an entry. That is precisely the class this
semantic harness exists to catch ("Literal substring presence is already checked. Your job is
semantic entailment"). It survives the upstream literal gate and is then never enumerated here.
Every enumerated claim is left genuinely literal and genuinely entailed, so a perfectly HONEST
auditor answering exactly the obligations it was handed returns a clean PASS.

This is NOT a variant of any GPT proof case. It is not the literal-but-wrong-quote fixture
(case 1 / 2), not missing-claim coverage (case 3 -- there is nothing missing; the row was never
required), not filter-promoted-to-strategy (case 4), not an unresolved cross-field check
(case 5), not model-identity spoofing (case 6), not an invented AUDIT-RESPONSE quote (case 7 --
here the invented quote lives in the frozen CANDIDATE, which `_literal_or_null` never inspects),
not candidate mutation (case 8), not task mutation (case 9), not the clean positive (case 10).
"""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import tempfile
from pathlib import Path

SCRIPTS = Path(r"C:\Users\tonio\Projects\wt-lanetest-scratch-probe\scripts")


def _load(mod_name: str, filename: str):
    spec = importlib.util.spec_from_file_location(mod_name, SCRIPTS / filename)
    if spec is None or spec.loader is None:
        raise SystemExit(f"cannot import {filename}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


G = _load("gpt56_audit", "strategy_factory_gpt56_semantic_audit.py")
D = _load("opus_diag", "strategy_factory_opus_transcript_first_diagnostic.py")

VIDEO = "lane-b-ht-fabrication"

# Educator teaches a purely single-timeframe, long-only breakout. The one hour chart is mentioned
# ONLY as something displayed on a monitor -- it is never a confirmation or gating condition.
TRANSCRIPT = (
    "On the five minute chart wait for a candle close above resistance and enter long. "
    "I keep the one hour chart open on my second monitor so you can see it while I talk. "
    "Place the stop below the swing low and target the prior high."
)

# Literal transcript substring, but it does NOT mean the 1h chart gates the entry.
NON_ENTAILING_HTF_QUOTE = "the one hour chart open on my second monitor"

BASE_STRATEGY = {
    "source_strategy_id": "s0",
    "name": "resistance breakout",
    "direction": "long",
    "direction_transcript_quote": "enter long",
    "execution_timeframe": "5m",
    "execution_timeframe_transcript_quote": "five minute chart",
    "higher_timeframe": "source_unresolved",
    "higher_timeframe_transcript_quote": None,
    "setup": [],
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
        "anchor": "below the swing low",
        "rationale": "source stop",
        "transcript_quote": "Place the stop below the swing low",
    },
    "targets": [
        {
            "priority": 1,
            "type": "prior high",
            "rationale": "source target",
            "transcript_quote": "target the prior high",
        }
    ],
    "management": [],
    "variants": [],
    "source_gaps": [],
}


def make_candidate(*, fabricate_htf: bool) -> dict:
    strategy = copy.deepcopy(BASE_STRATEGY)
    if fabricate_htf:
        # The whole attack payload. Schema-conformant, quote-bearing, execution-relevant --
        # and invisible to enumerate_claims().
        strategy["higher_timeframe"] = "1h"
        strategy["higher_timeframe_transcript_quote"] = NON_ENTAILING_HTF_QUOTE
    return {
        "video_id": VIDEO,
        "reader_role": "OPUS_LEAD_SOURCE_READER",
        "strategies": [strategy],
        "top_level_source_gaps": [],
    }


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8", newline="\n")


def emit_case(root: Path, name: str, candidate: dict) -> tuple[Path, Path, Path, dict]:
    case = root / name
    case.mkdir(parents=True)
    transcript = case / "transcript.txt"
    cand_path = case / "candidate.json"
    out = case / "out"
    transcript.write_text(TRANSCRIPT, encoding="utf-8", newline="\n")
    write_json(cand_path, candidate)
    G.emit(argparse.Namespace(
        video_id=VIDEO, transcript=str(transcript), candidate=str(cand_path), out_dir=str(out)
    ))
    return transcript, cand_path, out, G.read_json(out / "gpt56_semantic_audit_task.json")


def honest_response(task: dict) -> dict:
    """A MAXIMALLY HONEST auditor response.

    Every enumerated claim really is entailed by its literal quote, so every ENTAILED verdict here
    is truthful. The auditor is not lying about anything it was asked to review. The fabricated
    higher-timeframe rule was simply never placed on its review list.
    """
    ent = [
        {
            "claim_ref": c["claim_ref"],
            "verdict": "ENTAILED",
            "reason": "quote states exactly this instruction",
            "transcript_quote": c["transcript_quote"],
        }
        for c in task["required_claims"]
    ]
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
        "verdict": "PASS",
        "strategy_identity": [{
            "source_strategy_id": "s0",
            "classification": "independent_strategy",
            "reason": "complete trigger/stop/target",
            "transcript_quote": "enter long",
        }],
        "claim_entailment": ent,
        "cross_field_checks": [
            {"check": name, "status": "PASS", "reason": "reviewed every enumerated obligation",
             "transcript_quote": None}
            for name in G.REQUIRED_CROSS_CHECKS
        ],
        "findings": [],
        "coverage_statement": "Every required claim and cross-field check reviewed.",
        "independence_statement": (
            "I audited the frozen Opus candidate only against the supplied original transcript "
            "before any legacy comparison."
        ),
    }


def run_ingest(transcript: Path, candidate: Path, out: Path, response: dict) -> dict:
    raw = out / "audit-response.json"
    write_json(raw, response)
    G.ingest(argparse.Namespace(
        video_id=VIDEO, transcript=str(transcript), candidate=str(candidate),
        out_dir=str(out), raw_response=str(raw),
    ))
    return G.read_json(out / "gpt56_semantic_audit_receipt.json")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="lane-b-ht-attack-") as td:
        root = Path(td)

        clean = make_candidate(fabricate_htf=False)
        attack = make_candidate(fabricate_htf=True)

        # Step 0: the payload quote is a genuine literal transcript substring, so the UPSTREAM
        # literal gate (opus transcript-first diagnostic) accepts the attack candidate.
        assert G.transcript_contains(TRANSCRIPT, NON_ENTAILING_HTF_QUOTE) is True
        upstream = D.validate_candidate(attack, TRANSCRIPT, VIDEO)
        print(f"STEP 0  upstream literal gate on attack candidate: {json.dumps(upstream, sort_keys=True)}")
        assert not upstream.get("quote_failures"), "upstream literal gate rejected the payload"
        print("STEP 0  payload survives the upstream literal-quote gate (quote is literal, meaning is not)")

        # Step 1: baseline (honest) vs attack (forged HTF) claim enumeration, via the real
        # enumerate_claims().
        clean_refs = [c["claim_ref"] for c in G.enumerate_claims(clean)]
        attack_refs = [c["claim_ref"] for c in G.enumerate_claims(attack)]
        print(f"STEP 1  clean  claim_refs ({len(clean_refs)}): {clean_refs}")
        print(f"STEP 1  attack claim_refs ({len(attack_refs)}): {attack_refs}")
        assert clean_refs == attack_refs, "enumeration differed -- attack premise wrong"
        assert not any("higher_timeframe" in r for r in attack_refs)
        print("STEP 1  fabricated higher_timeframe rule adds ZERO review obligations")

        # Step 2: emit the real task for the attack candidate.
        t, c, out, task = emit_case(root, "attack", attack)
        task_text = (out / "gpt56_semantic_audit_task.json").read_text(encoding="utf-8")
        assert NON_ENTAILING_HTF_QUOTE not in task_text
        assert not any("higher_timeframe" in cl["claim"] for cl in task["required_claims"])
        print(f"STEP 2  emitted task required_claims={len(task['required_claims'])}; "
              "fabricated quote absent from the task the auditor is bound to")

        # Step 3: ingest a fully honest auditor response through the real ingest()/_validate_response().
        receipt = run_ingest(t, c, out, honest_response(task))

        print("\n--- RECEIPT ---")
        print(json.dumps(receipt, indent=2))
        print("--- END RECEIPT ---\n")

        false_green = (
            receipt["semantic_pass"] is True
            and receipt["status"] == G.PASS_STATUS
            and not receipt["fail_closed_reasons"]
        )
        if false_green:
            print("VERDICT: FALSE GREEN -- Lane B FINDING (HIGH).")
            print("  A forged 1h multi-timeframe entry gate, backed by a literal quote that only")
            print("  says the 1h chart is displayed on a monitor, rode a clean")
            print(f"  {G.PASS_STATUS}")
            print("  receipt with semantic_pass=true and fail_closed_reasons=[] -- while every")
            print("  auditor row returned was truthful. The claim was never enumerated.")
            return 1
        print("VERDICT: gate held -- harness fail-closed on the attack. Lane B PASS.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
