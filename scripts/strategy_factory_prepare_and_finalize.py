#!/usr/bin/env python3
"""AR-1338A -- shared prep/finalize helpers for the 40-video modern extraction upgrade factory.

Three subcommands:
  prep <video_id>              -- run prepare_strategy, cache the tier3 dispatch packet + prep
                                   artifact to disk (so Stage-1/Stage-2 dispatch can happen
                                   outside this process, via the Agent tool).
  adjudication-ingest <video_id> --stage {1,2} --raw <path>
                                -- AR-1351 F-1: preserve a Stage-1/Stage-2 dispatch's raw JSON
                                   response, hash it BEFORE parsing (same "raw is sacred"
                                   discipline `strategy_factory_opus_batch_locator.py::cmd_ingest`
                                   already gives the locator dispatch), validate every value
                                   against the closed taxonomy, write the flat answers file
                                   `finalize` consumes, and write a `.stage{1,2}_receipt.json`
                                   binding raw_response_sha256 + answer_count. USE THIS instead of
                                   hand-writing `.stage1_answers.json`/`.stage2_answers.json`
                                   directly for every unit processed after AR-1351 -- it is the
                                   fix for the independent grader's F-1 finding that the number
                                   deciding `pilot_grade` (Stage-2 support) had zero provenance
                                   while the locator's did. The 42 units regenerated under
                                   AR-1348A predate this subcommand and keep their existing,
                                   disclosed limitation (corroborated by independent semantic
                                   re-derivation, not receipted) -- not retroactively rewritten,
                                   since there is no raw dispatch text left to recover for them.
  finalize <video_id> [--stage1 <path>] [--stage2 <path>]
                                -- consume the cached prep + (optional) rater answer files
                                   (normally produced by `adjudication-ingest` above now, though
                                   the flat file SHAPE this reads is unchanged), compute the
                                   single-rater control gate, build Tier3Verdict/
                                   Tier3SupportVerdict, call finalize_certificate, print the
                                   resulting certificate grade + diagnosis. If a video's prep
                                   already has zero anchored fallthrough items needing a verdict
                                   (e.g. all conditions unanchored, or zero fallthroughs), stage1/
                                   stage2 files are optional -- the certificate is fully
                                   determined without dispatch, per AR-1340A ("do not repeat the
                                   correction campaign / do not spend a dispatch the outcome
                                   cannot change").

Same single-rater control-gate logic as the historical `scripts/h1_pilot_phase3_finalize.py`
(GATE_CONTROLS/CONTEXT_CONTROLS item-id sets, >=4/5 each direction), adapted from TWO-rater
agreement to ONE rater's own answer directly, per AR-1340A S3 ("No multi-rater majority vote").
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pickle  # TRUSTED-LOCAL only (same precedent as h1_pilot_phase3_finalize.py): this
# script's own `prep` subcommand writes the pickle, this script's own `finalize` subcommand
# reads it back -- never loaded from network input, an upload, or any other untrusted source.
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PREP_DIR = "docs/replay-results/strategy-factory-census/extraction-vault/preps"
TRANSCRIPT_DIR = "src/engine/extraction/fixtures/source-evidence"
VAULT_DIR = "docs/replay-results/strategy-factory-census/extraction-vault"

GATE_CONTROLS = {"W1-0001", "W1-0003", "W1-0005", "W1-0007", "W1-0009"}
CONTEXT_CONTROLS = {"W1-0002", "W1-0004", "W1-0006", "W1-0008", "W1-0010"}


def control_gate(stage1_answers: dict) -> dict:
    gate_ok = sum(1 for i in GATE_CONTROLS if stage1_answers.get(i) == "gate-strength")
    ctx_ok = sum(1 for i in CONTEXT_CONTROLS if stage1_answers.get(i) == "context")
    return {"gate_ok": gate_ok, "context_ok": ctx_ok, "passed": gate_ok >= 4 and ctx_ok >= 4}


def cmd_prep(video_id: str, strategy_index: int) -> int:
    sys.path.insert(0, REPO_ROOT)
    from src.engine.extraction.pilot_conveyor import prepare_strategy

    vault_path = os.path.join(REPO_ROOT, VAULT_DIR, f"{video_id}.json")
    transcript_path = os.path.join(REPO_ROOT, TRANSCRIPT_DIR, f"{video_id}.transcript.txt")
    with open(vault_path, "r", encoding="utf-8") as f:
        vault_record = json.load(f)
    with open(transcript_path, "r", encoding="utf-8") as f:
        transcript = f.read()

    strategies = vault_record["extraction"].get("strategies") or []
    if strategy_index >= len(strategies):
        print(json.dumps({"video_id": video_id, "status": "NO_STRATEGY_AT_INDEX"}))
        return 1

    result = prepare_strategy(
        strategies[strategy_index],
        transcript,
        video_id,
        extractor_version="minimal-8field-pass-l",
        taxonomy_version="v1",
        strategy_index=strategy_index,
    )
    os.makedirs(os.path.join(REPO_ROOT, PREP_DIR), exist_ok=True)
    prep_path = os.path.join(REPO_ROOT, PREP_DIR, f"{video_id}__s{strategy_index}.pkl")
    with open(prep_path, "wb") as f:
        pickle.dump(result, f)

    packet_path = os.path.join(REPO_ROOT, PREP_DIR, f"{video_id}__s{strategy_index}.tier3_packet.json")
    with open(packet_path, "w", encoding="utf-8") as f:
        json.dump(result["tier3_packet"], f, indent=2, default=str)

    n_fallthrough = len(result["tier1_fallthroughs"])
    print(
        json.dumps(
            {
                "video_id": video_id,
                "strategy_index": strategy_index,
                "prep_path": prep_path,
                "packet_path": packet_path,
                "spine_condition_count": result["spine_condition_count"],
                "unanchored_count": len(result["unanchored_conditions"]),
                "tier1_classified_count": len(result["tier1_detections"]),
                "tier1_fallthrough_count": n_fallthrough,
                "dispatch_needed": n_fallthrough > 0 and len(result["unanchored_conditions"]) == 0,
                "cert_guaranteed_unclean": len(result["unanchored_conditions"]) > 0,
            },
            indent=2,
        )
    )
    return 0


_STAGE1_ROLES = {"gate-strength", "context", "cannot-determine"}
_STAGE2_SUPPORTS = {"confirmed", "partial", "denied"}


def cmd_adjudication_ingest(video_id: str, strategy_index: int, stage: int, raw_path: str) -> int:
    """AR-1351 F-1 fix: give Stage-1/Stage-2 dispatch answers the SAME raw-preserve + hash +
    receipt treatment `strategy_factory_opus_batch_locator.py::cmd_ingest` already gives the
    locator dispatch. The independent grader found the locator's raw response, hash, and receipt
    genuine and load-bearing evidence, but Stage-1/Stage-2 answers were being written directly as
    already-parsed flat JSON with NO raw-preserve step at all -- so the number that actually
    decides `pilot_grade` (Stage-2 support) had zero provenance while the locator's had full
    provenance. This closes that asymmetry for every unit processed FROM THIS POINT FORWARD.
    (The 42 units already regenerated under AR-1348A keep their existing, disclosed limitation --
    this is not applied retroactively, since there is no raw dispatch text to recover for them.)

    `raw_path` names a file holding the adjudicating agent's raw JSON response, BEFORE any
    parsing: for stage 1, `{"<item_id>": "<role>", ...}`; for stage 2,
    `{"<item_id>": {"support": "...", "justification": "..."}, ...}` -- the exact flat shapes
    `cmd_finalize` already consumes, so this ingest step changes nothing about `cmd_finalize`'s
    own contract; it only adds a preservation/validation step before the same file lands at the
    same path `cmd_finalize` already reads.
    """
    if stage not in (1, 2):
        raise ValueError(f"stage must be 1 or 2, got {stage!r}")

    with open(raw_path, "r", encoding="utf-8") as f:
        raw_text = f.read()
    # raw is sacred (same discipline as the locator's cmd_ingest): hash BEFORE any parsing.
    raw_sha256 = hashlib.sha256(raw_text.encode("utf-8")).hexdigest()

    suffix = f"stage{stage}_raw_response.txt"
    raw_out_path = os.path.join(REPO_ROOT, PREP_DIR, f"{video_id}__s{strategy_index}.{suffix}")
    # newline="\n" -- AR-1351 F-3's fix, applied here from the start so this new code path never
    # regresses into the same claimed-hash-vs-disk-bytes mismatch.
    with open(raw_out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(raw_text)

    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError as e:
        print(json.dumps({
            "video_id": video_id, "strategy_index": strategy_index, "stage": stage,
            "status": "PARSE_FAILURE", "error": str(e), "raw_sha256": raw_sha256,
        }, indent=2))
        return 1
    if not isinstance(parsed, dict) or not parsed:
        print(json.dumps({
            "video_id": video_id, "strategy_index": strategy_index, "stage": stage,
            "status": "SHAPE_FAILURE", "error": "expected a non-empty flat JSON object",
            "raw_sha256": raw_sha256,
        }, indent=2))
        return 1

    bad_items = []
    if stage == 1:
        for item_id, role in parsed.items():
            if role not in _STAGE1_ROLES:
                bad_items.append({"item_id": item_id, "value": role})
    else:
        for item_id, ans in parsed.items():
            if not isinstance(ans, dict) or ans.get("support") not in _STAGE2_SUPPORTS:
                bad_items.append({"item_id": item_id, "value": ans})
    if bad_items:
        print(json.dumps({
            "video_id": video_id, "strategy_index": strategy_index, "stage": stage,
            "status": "INVALID_VALUES", "bad_items": bad_items, "raw_sha256": raw_sha256,
        }, indent=2))
        return 1

    answers_suffix = "stage1_answers.json" if stage == 1 else "stage2_answers.json"
    answers_path = os.path.join(REPO_ROOT, PREP_DIR, f"{video_id}__s{strategy_index}.{answers_suffix}")
    with open(answers_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(parsed, f, indent=2)

    receipt = {
        "video_id": video_id,
        "strategy_index": strategy_index,
        "stage": stage,
        "raw_response_sha256": raw_sha256,
        "raw_response_path": os.path.relpath(raw_out_path, REPO_ROOT),
        "raw_response_char_len": len(raw_text),
        "answer_count": len(parsed),
        "answers_path": os.path.relpath(answers_path, REPO_ROOT),
        "authority": "AR-1351 F-1 -- raw-preserve/hash/receipt parity with the locator's cmd_ingest",
    }
    receipt_path = os.path.join(REPO_ROOT, PREP_DIR, f"{video_id}__s{strategy_index}.stage{stage}_receipt.json")
    with open(receipt_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(receipt, f, indent=2)

    print(json.dumps({
        "video_id": video_id, "strategy_index": strategy_index, "stage": stage,
        "status": "INGESTED", **receipt,
    }, indent=2))
    return 0


def cmd_finalize(video_id: str, strategy_index: int, stage1_path: str | None, stage2_path: str | None) -> int:
    sys.path.insert(0, REPO_ROOT)
    from src.engine.extraction.pilot_conveyor import (
        finalize_certificate,
        verdict_from_rater_response,
        support_verdict_from_stage2_response,
    )

    prep_path = os.path.join(REPO_ROOT, PREP_DIR, f"{video_id}__s{strategy_index}.pkl")
    with open(prep_path, "rb") as f:
        prep = pickle.load(f)

    span_map = prep["item_span_map"]
    audit_item_id = prep["axis3_audit"].get("item_id")
    transcript = prep["full_transcript"]

    stage1_answers: dict = {}
    stage2_answers: dict = {}
    if stage1_path:
        with open(stage1_path, "r", encoding="utf-8") as f:
            stage1_answers = json.load(f)
    if stage2_path:
        with open(stage2_path, "r", encoding="utf-8") as f:
            stage2_answers = json.load(f)

    cg = control_gate(stage1_answers) if stage1_answers else {"gate_ok": 0, "context_ok": 0, "passed": False}

    tier3_verdicts = []
    tier3_support = []
    model_calls_consumed = {"stage1_items_answered": 0, "stage2_items_answered": 0}
    for item_id, span in span_map.items():
        s, e = span
        quote = transcript[s:e]
        is_audit = item_id == audit_item_id
        role = stage1_answers.get(item_id)
        if is_audit:
            sup_raw = stage2_answers.get(item_id)
            if sup_raw:
                model_calls_consumed["stage2_items_answered"] += 1
                tier3_support.append(
                    support_verdict_from_stage2_response(
                        char_span=(s, e),
                        support=sup_raw["support"],
                        support_justification=sup_raw["justification"],
                    )
                )
            continue
        if role in ("gate-strength", "context"):
            model_calls_consumed["stage1_items_answered"] += 1
            tier3_verdicts.append(
                verdict_from_rater_response(
                    char_span=(s, e), quote_anchor=quote, role=role, control_gate_passed=cg["passed"]
                )
            )
            sup_raw = stage2_answers.get(item_id)
            if sup_raw:
                model_calls_consumed["stage2_items_answered"] += 1
                tier3_support.append(
                    support_verdict_from_stage2_response(
                        char_span=(s, e),
                        support=sup_raw["support"],
                        support_justification=sup_raw["justification"],
                    )
                )
        # role in (None, "cannot-determine") -> stays an unresolved fall-through, no verdict built.

    cert = finalize_certificate(prep, tier3_verdicts, tier3_support=tier3_support)

    out = {
        "video_id": video_id,
        "strategy_index": strategy_index,
        "control_gate": cg,
        "model_calls_consumed": model_calls_consumed,
        "pilot_grade": cert["pilot_grade"],
        "full_grade": cert["full_grade"],
        "certificate_grade": cert["certificate_grade"],
        "diagnosis": cert["diagnosis"],
        "unanchored_condition_count": cert["unanchored_condition_count"],
        "unanchored_reason_breakdown": cert["unanchored_reason_breakdown"],
    }
    cert_out_path = os.path.join(REPO_ROOT, PREP_DIR, f"{video_id}__s{strategy_index}.certificate.json")
    # AR-1351 F-3: newline="\n" for consistency with the same fix in
    # strategy_factory_opus_batch_locator.py -- no current caller hashes this file, but a future
    # one hashing the in-memory json.dumps output against the disk bytes would hit the identical
    # CRLF-vs-LF mismatch if this were left as default text-mode write.
    with open(cert_out_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(cert, f, indent=2, default=str)
    out["certificate_path"] = cert_out_path
    print(json.dumps(out, indent=2, default=str))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p1 = sub.add_parser("prep")
    p1.add_argument("video_id")
    p1.add_argument("--strategy-index", type=int, default=0)
    p2 = sub.add_parser("finalize")
    p2.add_argument("video_id")
    p2.add_argument("--strategy-index", type=int, default=0)
    p2.add_argument("--stage1", default=None)
    p2.add_argument("--stage2", default=None)
    p3 = sub.add_parser("adjudication-ingest")
    p3.add_argument("video_id")
    p3.add_argument("--strategy-index", type=int, default=0)
    p3.add_argument("--stage", type=int, required=True, choices=(1, 2))
    p3.add_argument("--raw", required=True)
    args = ap.parse_args()

    if args.cmd == "prep":
        return cmd_prep(args.video_id, args.strategy_index)
    if args.cmd == "adjudication-ingest":
        return cmd_adjudication_ingest(args.video_id, args.strategy_index, args.stage, args.raw)
    return cmd_finalize(args.video_id, args.strategy_index, args.stage1, args.stage2)


if __name__ == "__main__":
    raise SystemExit(main())
