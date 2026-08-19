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

# The frozen, shared Set-A control block (AR-1340A single-rater control gate, identical across
# every video's Stage-1 packet by design) -- embedded here once so `cmd_adjudication_emit` can
# build a self-contained Stage-1 task without re-deriving it from anywhere.
_SET_A_ITEMS = [
    ("W1-0001", "only once you see that evidence confirmation that turn is happening should you take a trade"),
    ("W1-0002", "today I'll share our 4-Hour chart strategy that I use every day"),
    ("W1-0003", "wait for a retrace back to the 5 SMA"),
    ("W1-0004", "now back to the euro dollar chart here"),
    ("W1-0005", "again you have to know what time frames you're trading again I only trade us session"),
    ("W1-0006", "let's kind of go back up here and let's kind of fix this thing here because we kind of messed it up"),
    ("W1-0007", "so that's rule number one wait for it to close below the third standard deviation Binger band"),
    ("W1-0008", "now you want to go ahead and exit"),
    ("W1-0009", "we are waiting for price to break below, come back and retest it as resistance before we can look for a short entry"),
    ("W1-0010", "this time I'm going to remove the bases we don't need it we're keeping the bases from the original one"),
]


def _adjudication_paths(video_id: str, strategy_index: int, stage: int) -> dict:
    base = os.path.join(REPO_ROOT, PREP_DIR, f"{video_id}__s{strategy_index}")
    return {
        "packet": f"{base}.tier3_packet.json",
        "task": f"{base}.stage{stage}_task.txt",
        "task_index": f"{base}.stage{stage}_task_index.json",
        "raw": f"{base}.stage{stage}_raw_response.txt",
        "answers": f"{base}.stage{stage}_answers.json",
        "receipt": f"{base}.stage{stage}_receipt.json",
    }


def cmd_adjudication_emit(video_id: str, strategy_index: int, stage: int) -> int:
    """AR-1350A SS8.A: build the self-contained Stage-1/Stage-2 task from the FROZEN tier3_packet
    for this unit, and record the exact packet hash, task hash, and expected item-ID set BEFORE
    any dispatch happens -- mirroring `strategy_factory_opus_batch_locator.py::cmd_emit`. This is
    the binding `cmd_adjudication_ingest` later verifies against, so a raw response can no longer
    be accepted merely for using valid taxonomy strings; it must answer EXACTLY this unit's item
    set, derived from THIS unit's own packet, hashed at emission time.
    """
    paths = _adjudication_paths(video_id, strategy_index, stage)
    if not os.path.exists(paths["packet"]):
        print(json.dumps({"video_id": video_id, "strategy_index": strategy_index, "stage": stage,
                           "status": "NO_TIER3_PACKET"}))
        return 1
    with open(paths["packet"], "r", encoding="utf-8") as f:
        packet_text = f.read()
    packet_sha256 = hashlib.sha256(packet_text.encode("utf-8")).hexdigest()
    packet = json.loads(packet_text)

    set_b_items = packet["sections"][1]["items"]  # SET-B, per the packet's own fixed layout
    if stage == 1:
        lines = [f"{i+1}. item_id: {iid}\n   quote: {q!r}" for i, (iid, q) in enumerate(_SET_A_ITEMS)]
        offset = len(_SET_A_ITEMS)
        for i, item in enumerate(set_b_items):
            lines.append(f"{offset+i+1}. item_id: {item['item_id']}\n   quote: {item['quote_anchor']['verbatim']!r}")
        expected_item_ids = [iid for iid, _ in _SET_A_ITEMS] + [item["item_id"] for item in set_b_items]
        task_text = (
            "Blind role classification. Classify each item into exactly one of: "
            "gate-strength, context, cannot-determine, using ONLY the verbatim quote.\n\n"
            + "\n".join(lines)
            + "\n\nReturn ONLY a JSON object mapping every item_id above to your chosen role."
        )
    else:
        stage2_items = packet["stage2"]["items"]
        quote_by_id = {item["item_id"]: item["quote_anchor"]["verbatim"] for item in set_b_items}
        lines = [
            f"{i+1}. item_id: {item['item_id']}\n   extracted_condition: {item['extracted_condition_text']!r}\n   quote: {quote_by_id[item['item_id']]!r}"
            for i, item in enumerate(stage2_items)
        ]
        expected_item_ids = [item["item_id"] for item in stage2_items]
        task_text = (
            "Revealed support judgment. Does the quote express the condition? Choose one of: "
            "confirmed, partial, denied.\n\n"
            + "\n".join(lines)
            + "\n\nReturn ONLY a JSON object mapping every item_id above to "
              "{\"support\": ..., \"justification\": ...}."
        )

    task_sha256 = hashlib.sha256(task_text.encode("utf-8")).hexdigest()
    expected_ids_sorted = sorted(expected_item_ids)
    expected_ids_sha256 = hashlib.sha256(json.dumps(expected_ids_sorted).encode("utf-8")).hexdigest()

    with open(paths["task"], "w", encoding="utf-8", newline="\n") as f:
        f.write(task_text)
    index = {
        "video_id": video_id, "strategy_index": strategy_index, "stage": stage,
        "packet_sha256": packet_sha256,
        "task_sha256": task_sha256,
        "expected_item_ids": expected_ids_sorted,
        "expected_item_ids_sha256": expected_ids_sha256,
        "authority": "AR-1350A SS8.A -- Stage-1/2 provenance binding",
    }
    with open(paths["task_index"], "w", encoding="utf-8", newline="\n") as f:
        json.dump(index, f, indent=2)

    print(json.dumps({
        "video_id": video_id, "strategy_index": strategy_index, "stage": stage,
        "status": "EMITTED", "task_path": paths["task"], "task_index_path": paths["task_index"],
        "item_count": len(expected_ids_sorted),
    }, indent=2))
    return 0


def cmd_adjudication_ingest(
    video_id: str, strategy_index: int, stage: int, raw_path: str, model_declared: str,
) -> int:
    """AR-1351 F-1 / AR-1350A SS8.A: bind a Stage-1/Stage-2 raw response to the EXACT unit,
    packet, task, and expected item-ID set `cmd_adjudication_emit` recorded before dispatch --
    not merely "a hash exists". AR-1350A's own critique of the first F-1 fix: a receipt can be
    locally well-formed while still describing the wrong semantic call (Unit A's answer ingested
    under Unit B, using valid taxonomy strings, would have passed the old check). This version
    fails closed on every one of AR-1350A SS4's named attack shapes:
      - `cmd_adjudication_emit` must have run for this exact unit/stage first (no task_index ->
        refuse rather than silently skip binding);
      - the CURRENT tier3_packet.json must re-hash to the packet_sha256 the index recorded (a
        packet mutated between emit and ingest is caught, not silently trusted);
      - the raw response's answer-key set must be EXACTLY the expected_item_ids set from the
        index -- missing, extra, AND cross-unit-wrong ids are all refused (item_ids are video-
        prefixed by construction except the shared W1-000x controls, so Unit A's response ingested
        as Unit B fails this check automatically: the two units' Set-B/stage2 ids never match).

    `raw_path` names a file holding the adjudicating agent's raw JSON response, BEFORE any
    parsing. `model_declared` records the CALLER's own statement of which model/backend produced
    it (e.g. "opus") -- this is a DECLARED identity, not independently attested; the harness this
    driver runs under does not expose a per-call model-identity witness, and this receipt does
    not claim otherwise (AR-1351's own coverage statement already disclosed this limit).
    """
    if stage not in (1, 2):
        raise ValueError(f"stage must be 1 or 2, got {stage!r}")
    paths = _adjudication_paths(video_id, strategy_index, stage)

    if not os.path.exists(paths["task_index"]):
        print(json.dumps({
            "video_id": video_id, "strategy_index": strategy_index, "stage": stage,
            "status": "NOT_EMITTED", "error": (
                "no stage task_index found -- run adjudication-emit for this exact unit/stage "
                "before ingest; a response cannot be bound to a task that was never recorded"
            ),
        }, indent=2))
        return 1
    with open(paths["task_index"], "r", encoding="utf-8") as f:
        task_index = json.load(f)

    # Stage-identity control: the task_index was emitted for a SPECIFIC stage; ingesting it under
    # a different --stage would silently apply stage-1's taxonomy validation to a stage-2 answer
    # (or vice versa) despite reading the right files, because paths are stage-parameterized but
    # this check is the only thing that catches a caller passing the wrong --stage value.
    if task_index.get("stage") != stage:
        print(json.dumps({
            "video_id": video_id, "strategy_index": strategy_index, "stage": stage,
            "status": "STAGE_IDENTITY_MISMATCH",
            "emitted_for_stage": task_index.get("stage"), "ingest_called_with_stage": stage,
        }, indent=2))
        return 1

    # Task-mutation control: re-hash the CURRENT task.txt and compare against what emit recorded,
    # independent of the packet check above -- the task file could be hand-edited after emission
    # without touching the packet it was built from.
    with open(paths["task"], "r", encoding="utf-8") as f:
        current_task_text = f.read()
    current_task_sha256 = hashlib.sha256(current_task_text.encode("utf-8")).hexdigest()
    if current_task_sha256 != task_index["task_sha256"]:
        print(json.dumps({
            "video_id": video_id, "strategy_index": strategy_index, "stage": stage,
            "status": "TASK_MUTATED_SINCE_EMIT",
            "emitted_task_sha256": task_index["task_sha256"],
            "current_task_sha256": current_task_sha256,
        }, indent=2))
        return 1

    # Packet-mutation control: re-hash the CURRENT packet file and compare against what emit
    # recorded. A packet edited between emit and ingest invalidates the binding.
    with open(paths["packet"], "r", encoding="utf-8") as f:
        current_packet_text = f.read()
    current_packet_sha256 = hashlib.sha256(current_packet_text.encode("utf-8")).hexdigest()
    if current_packet_sha256 != task_index["packet_sha256"]:
        print(json.dumps({
            "video_id": video_id, "strategy_index": strategy_index, "stage": stage,
            "status": "PACKET_MUTATED_SINCE_EMIT",
            "emitted_packet_sha256": task_index["packet_sha256"],
            "current_packet_sha256": current_packet_sha256,
        }, indent=2))
        return 1

    with open(raw_path, "r", encoding="utf-8") as f:
        raw_text = f.read()
    # raw is sacred (same discipline as the locator's cmd_ingest): hash BEFORE any parsing.
    raw_sha256 = hashlib.sha256(raw_text.encode("utf-8")).hexdigest()
    with open(paths["raw"], "w", encoding="utf-8", newline="\n") as f:
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

    # Exact answer-key-set equality against the emit-time expected set -- catches missing ids,
    # extra ids, AND cross-unit contamination (a different unit's ids never equal this unit's).
    expected = set(task_index["expected_item_ids"])
    actual = set(parsed.keys())
    if actual != expected:
        print(json.dumps({
            "video_id": video_id, "strategy_index": strategy_index, "stage": stage,
            "status": "ITEM_ID_SET_MISMATCH",
            "missing": sorted(expected - actual),
            "extra": sorted(actual - expected),
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

    with open(paths["answers"], "w", encoding="utf-8", newline="\n") as f:
        json.dump(parsed, f, indent=2)
    parsed_answer_sha256 = hashlib.sha256(
        json.dumps(parsed, sort_keys=True).encode("utf-8")
    ).hexdigest()

    receipt = {
        "video_id": video_id,
        "strategy_index": strategy_index,
        "stage": stage,
        "packet_sha256": task_index["packet_sha256"],
        "task_sha256": task_index["task_sha256"],
        "expected_item_ids_sha256": task_index["expected_item_ids_sha256"],
        "raw_response_sha256": raw_sha256,
        "raw_response_path": os.path.relpath(paths["raw"], REPO_ROOT),
        "raw_response_char_len": len(raw_text),
        "answer_count": len(parsed),
        "parsed_answer_sha256": parsed_answer_sha256,
        "answers_path": os.path.relpath(paths["answers"], REPO_ROOT),
        "model_declared": model_declared,
        "invocation": (
            "Agent tool, subagent_type=general-purpose, model override="
            f"{model_declared}, given the stage task text as its prompt"
        ),
        "authority": "AR-1350A SS8.A -- full provenance chain: packet/task/item-set binding",
    }
    with open(paths["receipt"], "w", encoding="utf-8", newline="\n") as f:
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
    p3 = sub.add_parser("adjudication-emit")
    p3.add_argument("video_id")
    p3.add_argument("--strategy-index", type=int, default=0)
    p3.add_argument("--stage", type=int, required=True, choices=(1, 2))
    p4 = sub.add_parser("adjudication-ingest")
    p4.add_argument("video_id")
    p4.add_argument("--strategy-index", type=int, default=0)
    p4.add_argument("--stage", type=int, required=True, choices=(1, 2))
    p4.add_argument("--raw", required=True)
    p4.add_argument("--model-declared", default="opus")
    args = ap.parse_args()

    if args.cmd == "prep":
        return cmd_prep(args.video_id, args.strategy_index)
    if args.cmd == "adjudication-emit":
        return cmd_adjudication_emit(args.video_id, args.strategy_index, args.stage)
    if args.cmd == "adjudication-ingest":
        return cmd_adjudication_ingest(
            args.video_id, args.strategy_index, args.stage, args.raw, args.model_declared
        )
    return cmd_finalize(args.video_id, args.strategy_index, args.stage1, args.stage2)


if __name__ == "__main__":
    raise SystemExit(main())
