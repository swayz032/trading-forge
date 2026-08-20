#!/usr/bin/env python3
"""Worker-1 independent re-attack of the AR-1370A/AR-1371A Lane-B repair.

Target (repaired): scripts/strategy_factory_gpt56_semantic_audit.py
Repair commit: 8acb6b0fc63e0b38595a9e64c2f61a77885e9f9b (external-advisor/gpt-engineering)

Checks against the real, unmodified repaired module:
  1. Original AR-1377 HTF fabrication -- confirm higher_timeframe is NOW enumerated,
     and confirm an honest-but-incomplete response (omitting that row) is REFUSED.
  2. Confirm a response that answers the HTF row NOT_ENTAILED produces semantic_pass=false.
  3. NEW suffix-field attack (not HTF): fabricate `direction` (flip long->short) backed by a
     literal-but-irrelevant transcript quote. Confirm it is enumerated, an omitting response
     is refused, and a NOT_ENTAILED answer blocks semantic PASS.
  4. Clean positive control: an honest, fully-covered, all-ENTAILED response on an HONEST
     candidate (no fabrication) must still freeze as PASS_NOT_INDEPENDENTLY_CERTIFIED --
     proves the generic coverage law does not brick valid candidates.

Exit 0 = repair holds on all checks. Exit 1 = a false green survives.
"""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import os
from pathlib import Path

SCRIPTS = Path(os.environ.get(
    "REPAIRED_SCRIPTS_DIR",
    r"C:/Users/tonio/Projects/wt-lanetest-repair-8acb6b0f/scripts",
))


def _load(mod_name: str, filename: str):
    spec = importlib.util.spec_from_file_location(mod_name, SCRIPTS / filename)
    if spec is None or spec.loader is None:
        raise SystemExit(f"cannot import {filename}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


G = _load("gpt56_audit_repaired", "strategy_factory_gpt56_semantic_audit.py")
D = _load("opus_diag_repaired", "strategy_factory_opus_transcript_first_diagnostic.py")

VIDEO = "reattack-lane-b"
TRANSCRIPT = (
    "On the five minute chart wait for a candle close above resistance and enter long. "
    "I keep the one hour chart open on my second monitor so you can see it while I talk. "
    "Place the stop below the swing low and target the prior high."
)
NON_ENTAILING_HTF_QUOTE = "the one hour chart open on my second monitor"
# A real, literal transcript substring that does NOT support a direction flip.
NON_ENTAILING_DIRECTION_QUOTE = "so you can see it while I talk"

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
    "entry_sequence": [{
        "step": 1, "role": "trigger",
        "action": "wait for a candle close above resistance and enter long",
        "rationale": "source instruction",
        "transcript_quote": "wait for a candle close above resistance and enter long",
    }],
    "confluences": [],
    "stop": {"anchor": "below the swing low", "rationale": "source stop",
              "transcript_quote": "Place the stop below the swing low"},
    "targets": [{"priority": 1, "type": "prior high", "rationale": "source target",
                  "transcript_quote": "target the prior high"}],
    "management": [], "variants": [], "source_gaps": [],
}


def make_candidate(*, fabricate_htf: bool = False, fabricate_direction: bool = False) -> dict:
    strategy = copy.deepcopy(BASE_STRATEGY)
    if fabricate_htf:
        strategy["higher_timeframe"] = "1h"
        strategy["higher_timeframe_transcript_quote"] = NON_ENTAILING_HTF_QUOTE
    if fabricate_direction:
        strategy["direction"] = "short"
        strategy["direction_transcript_quote"] = NON_ENTAILING_DIRECTION_QUOTE
    return {"video_id": VIDEO, "reader_role": "OPUS_LEAD_SOURCE_READER",
            "strategies": [strategy], "top_level_source_gaps": []}


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8", newline="\n")


def emit_case(root: Path, name: str, candidate: dict):
    case = root / name
    case.mkdir(parents=True)
    transcript = case / "transcript.txt"
    cand_path = case / "candidate.json"
    out = case / "out"
    transcript.write_text(TRANSCRIPT, encoding="utf-8", newline="\n")
    write_json(cand_path, candidate)
    G.emit(argparse.Namespace(video_id=VIDEO, transcript=str(transcript),
                               candidate=str(cand_path), out_dir=str(out)))
    return transcript, cand_path, out, G.read_json(out / "gpt56_semantic_audit_task.json")


def response_all_entailed(task: dict) -> dict:
    ent = [{"claim_ref": c["claim_ref"], "verdict": "ENTAILED",
            "reason": "quote states exactly this instruction",
            "transcript_quote": c["transcript_quote"]} for c in task["required_claims"]]
    return {
        "schema": G.RESPONSE_SCHEMA, "video_id": task["video_id"],
        "candidate_sha256": task["candidate_sha256"], "transcript_sha256": task["transcript_sha256"],
        "task_sha256": task["task_sha256"], "audit_nonce": task["audit_nonce"],
        "auditor_role": G.AUDITOR_ROLE, "model_identity": G.MODEL_IDENTITY,
        "legacy_semantics_visible": False, "verdict": "PASS",
        "strategy_identity": [{"source_strategy_id": "s0", "classification": "independent_strategy",
                                "reason": "complete trigger/stop/target", "transcript_quote": "enter long"}],
        "claim_entailment": ent,
        "cross_field_checks": [{"check": name, "status": "PASS",
                                  "reason": "reviewed every enumerated obligation", "transcript_quote": None}
                                 for name in G.REQUIRED_CROSS_CHECKS],
        "findings": [], "coverage_statement": "Every required claim and cross-field check reviewed.",
        "independence_statement": ("I audited the frozen Opus candidate only against the supplied "
                                    "original transcript before any legacy comparison."),
    }


def response_omit_ref(task: dict, omit_ref: str) -> dict:
    resp = response_all_entailed(task)
    resp["claim_entailment"] = [e for e in resp["claim_entailment"] if e["claim_ref"] != omit_ref]
    return resp


def response_not_entailed(task: dict, target_ref: str) -> dict:
    """A genuinely honest auditor that FOUND the fabricated field: marks it NOT_ENTAILED,
    files a blocking finding, and correctly flips its own overall verdict to FAIL (an
    auditor cannot truthfully claim PASS while holding a NOT_ENTAILED claim -- the harness
    enforces that combination is invalid, matching one of GPT's own existing fixtures)."""
    resp = response_all_entailed(task)
    resp["verdict"] = "FAIL"
    for e in resp["claim_entailment"]:
        if e["claim_ref"] == target_ref:
            e["verdict"] = "NOT_ENTAILED"
            e["reason"] = "quote does not support this rule"
    resp["findings"] = [{"severity": "HIGH", "ref": target_ref,
                          "finding": "fabricated/unsupported rule", "transcript_quote": e["transcript_quote"]}]
    return resp


def run_ingest(transcript: Path, candidate: Path, out: Path, response: dict) -> dict:
    raw = out / "audit-response.json"
    write_json(raw, response)
    try:
        G.ingest(argparse.Namespace(video_id=VIDEO, transcript=str(transcript),
                                      candidate=str(candidate), out_dir=str(out), raw_response=str(raw)))
    except SystemExit as e:
        return {"_refused": str(e)}
    return G.read_json(out / "gpt56_semantic_audit_receipt.json")


def check_field_generic(root: Path, name: str, candidate: dict, field_ref: str) -> bool:
    """Full cycle for one fabricated field: enumerated? omission refused? NOT_ENTAILED -> FAIL?"""
    ok = True
    t, c, out, task = emit_case(root, name, candidate)
    refs = [cl["claim"] for cl in task["required_claims"]]
    present = any(cl["claim_ref"] == field_ref for cl in task["required_claims"])
    print(f"[{name}] field_ref={field_ref} enumerated={present}")
    if not present:
        print(f"[{name}] FALSE GREEN -- fabricated field never enumerated")
        return False

    omit_result = run_ingest(t, c, out, response_omit_ref(task, field_ref))
    omit_refused = "_refused" in omit_result
    print(f"[{name}] omission-of-{field_ref} refused={omit_refused} "
          f"({omit_result.get('_refused', omit_result.get('status'))})")
    if not omit_refused:
        print(f"[{name}] FALSE GREEN -- omitting the fabricated field's review row was accepted")
        ok = False

    t2, c2, out2, task2 = emit_case(root, name + "-notentailed", candidate)
    ne_receipt = run_ingest(t2, c2, out2, response_not_entailed(task2, field_ref))
    ne_pass = ne_receipt.get("semantic_pass")
    print(f"[{name}] NOT_ENTAILED-on-{field_ref} semantic_pass={ne_pass} status={ne_receipt.get('status')}")
    if ne_pass is not False:
        print(f"[{name}] FALSE GREEN -- NOT_ENTAILED on fabricated field did not block semantic PASS")
        ok = False
    return ok


def check_clean_positive(root: Path) -> bool:
    honest = make_candidate()
    t, c, out, task = emit_case(root, "clean-positive", honest)
    receipt = run_ingest(t, c, out, response_all_entailed(task))
    ok = (receipt.get("status") == G.PASS_STATUS and receipt.get("semantic_pass") is True)
    print(f"[clean-positive] status={receipt.get('status')} semantic_pass={receipt.get('semantic_pass')} "
          f"held={ok}")
    if not ok:
        print("[clean-positive] REGRESSION -- generic coverage law bricked a valid honest candidate")
    return ok


def main() -> int:
    import tempfile
    with tempfile.TemporaryDirectory(prefix="lane-b-reattack-") as td:
        root = Path(td)
        r_htf = check_field_generic(root, "htf-fabrication", make_candidate(fabricate_htf=True),
                                      "strategies[0].higher_timeframe")
        r_dir = check_field_generic(root, "direction-fabrication", make_candidate(fabricate_direction=True),
                                      "strategies[0].direction")
        r_clean = check_clean_positive(root)
        all_held = r_htf and r_dir and r_clean
        print(json.dumps({"htf_held": r_htf, "direction_held": r_dir, "clean_positive_held": r_clean,
                           "ALL_HELD": all_held}, indent=2))
        if all_held:
            print("LANE B RE-ATTACK VERDICT: GATE HOLDS -- Lane B PASS (post-repair)")
            return 0
        print("LANE B RE-ATTACK VERDICT: FALSE GREEN OR REGRESSION SURVIVES REPAIR")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
