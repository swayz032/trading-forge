#!/usr/bin/env python3
"""Proof for the three grader findings closed same-round after the independent accuracy-validator
attack on the AR-1378A SS6 harness repair (commit 2a60eee7):

  F-2: rule 6 had dropped the ruling's "never permission to invent" clause -- restored.
  F-3: rule 5's trailing clause was unconditional where the ruling conditioned it -- re-conditioned.
  A1 (novel attack): a candidate could park non-executable material in an invented container name
      (e.g. management_notes[]) that is neither setup[] nor one of the five named-forbidden
      containers, escaping rule 2's closed list -- rule 2 is now a default-deny naming setup[] as
      the ONLY legal home, so ANY other container is covered, named or not.
  F-4 (non-schema half): the prompt's cross-field-checks framing claimed all six checks are graded
      against the contract, but the contract only defines three -- narrowed to name exactly which
      three are contract-governed and which three are graded on ordinary semantic grounds instead.

F-1 (task_sha256 carries no prompt/contract hash, so a receipt cannot prove which prompt version
produced it) and the schema-validated "contract_points_applied" half of the reason-field gap are
NOT fixed here -- both require a RESPONSE_SCHEMA/TASK_SCHEMA change, which exceeds AR-1378A SS6's
prompt-only scope-lock and needs a new GPT authorization before it can be built.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "strategy_factory_gpt56_semantic_audit.py"
spec = importlib.util.spec_from_file_location("gpt56_audit_grader_response", SCRIPT)
G = importlib.util.module_from_spec(spec)
spec.loader.exec_module(G)

VIDEO = "grader-response-proof-video"
TRANSCRIPT = (
    "On the five minute chart wait for a candle close above resistance and enter long. "
    "By the way this is just a TradingView demo account, not investment advice. "
    "Place the stop below the swing low and target the prior high."
)


def base_candidate() -> dict:
    return {
        "video_id": VIDEO,
        "reader_role": "OPUS_LEAD_SOURCE_READER",
        "instrument_classification": {"asset_class": "futures", "transcript_quote": "five minute chart"},
        "strategies": [{
            "source_strategy_id": "s0",
            "name": "breakout",
            "direction": "long",
            "direction_transcript_quote": "enter long",
            "higher_timeframe": "source_unresolved",
            "higher_timeframe_transcript_quote": None,
            "execution_timeframe": "5m",
            "execution_timeframe_transcript_quote": "five minute chart",
            "setup": [],
            "entry_sequence": [{
                "step": 1, "role": "trigger",
                "action": "wait for a candle close above resistance and enter long",
                "rationale": "source instruction",
                "transcript_quote": "wait for a candle close above resistance and enter long",
            }],
            "confluences": [],
            "stop": {
                "anchor": "below the swing low", "rationale": "source stop",
                "transcript_quote": "Place the stop below the swing low",
            },
            "targets": [{
                "priority": 1, "type": "prior high", "rationale": "source target",
                "transcript_quote": "target the prior high",
            }],
            "management": [],
            "variants": [],
            "source_gaps": [],
        }],
        "top_level_source_gaps": [],
    }


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8", newline="\n")


def emit_case(root: Path, name: str, candidate: dict):
    case = root / name
    case.mkdir(parents=True)
    transcript = case / "transcript.txt"
    candidate_path = case / "candidate.json"
    out = case / "out"
    transcript.write_text(TRANSCRIPT, encoding="utf-8", newline="\n")
    write_json(candidate_path, candidate)
    G.emit(argparse.Namespace(video_id=VIDEO, transcript=str(transcript), candidate=str(candidate_path), out_dir=str(out)))
    task = G.read_json(out / "gpt56_semantic_audit_task.json")
    prompt = (out / "gpt56_semantic_audit_prompt.txt").read_text(encoding="utf-8")
    return task, prompt


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="grader-response-proof-") as td:
        root = Path(td)

        # F-2: "never permission to invent" restored in rule 6.
        _, prompt = emit_case(root, "f2", base_candidate())
        assert "never permission to invent the" in prompt, "F-2 not restored: anti-invention clause missing"
        print("PASS F-2: rule 6 restores the ruling's 'never permission to invent' clause")

        # F-3: rule 5's exemption is now conditioned, not absolute.
        assert "UNLESS such a stronger written authority exists" in prompt, "F-3 not fixed: rule 5 still unconditional"
        print("PASS F-3: rule 5's completeness exemption is re-conditioned on no stronger authority existing")

        # A1: an invented, non-standard container name must still be caught by rule 2's default-deny.
        a1 = base_candidate()
        a1["strategies"][0]["management_notes"] = [{
            "description": "This is just a TradingView demo account, not investment advice.",
            "transcript_quote": "By the way this is just a TradingView demo account, not investment advice.",
        }]
        task, prompt = emit_case(root, "a1", a1)
        planted_refs = [c["claim_ref"] for c in task["required_claims"] if "management_notes" in c["claim_ref"]]
        assert planted_refs, "A1 regression: invented container content must remain a mandatory reviewable claim"
        flat_prompt = " ".join(prompt.split())
        assert "ANY container other than setup[]" in flat_prompt, "A1 not fixed: rule 2 is not default-deny"
        assert "named here or not" in prompt
        print(f"PASS A1: invented container {planted_refs} stays mandatory, and rule 2's default-deny "
              f"language ('ANY container other than setup[], named here or not') now covers it")

        # F-4: the cross-field-checks framing must not overclaim contract coverage for the three
        # checks the contract does not define, and must not tell the auditor to skip them either.
        flat_prompt2 = " ".join(prompt.split())
        assert "role_assignment, trigger_vs_source_gaps, and directional_symmetry are graded against" in flat_prompt2
        assert "NOT defined by the contract above" in flat_prompt2
        assert "is not itself license to invent one, and it is not license to skip the check either." in flat_prompt2
        print("PASS F-4: cross-field-checks framing now names exactly which three checks are "
              "contract-governed and instructs ordinary (not invented, not skipped) grading for the other three")

    print("ALL GRADER-RESPONSE FIXES PROVEN (F-2, F-3, A1 closed; F-1 and F-4's schema half remain "
          "open pending new GPT authorization -- reported, not silently fixed)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
