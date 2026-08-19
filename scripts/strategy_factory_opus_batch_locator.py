#!/usr/bin/env python3
"""AR-1345A recovery, step 1-9 -- general-purpose driver for the AR-1234 SS6 LANE O1
batched-Opus locator, generalized from `scripts/svkm_opus_batch_locator.py` (sVkm-pin-only)
to work for ANY video already in this factory's own vault/transcript conventions.

REUSES, DOES NOT REBUILD (AR-1345A step 1 mandate):
  - `src/engine/extraction/batch_locator.py`     -- AR-1234 SS6 mechanics, unmodified, by import.
  - `src/engine/extraction/anchor_locator._SYSTEM_PROMPT` -- the production rules, verbatim,
    via `batch_locator.build_batch_task`.
  - `src/engine/extraction/pilot_conveyor.extract_spine_condition_texts` -- the SAME pure,
    no-I/O condition extraction `prepare_strategy` itself calls internally. Calling it here
    a second time on the identical strategy dict is safe (and REQUIRED for `emit`'s task to
    describe the right conditions) because the function's own docstring guarantees purity --
    same input, same output, same order, both times.
  - `src/engine/extraction/pilot_conveyor.prepare_strategy` -- completely unmodified. This
    driver's only new code is upstream of it (build task -> real Opus dispatch -> ingest ->
    inject as `propose_fn`); `prepare_strategy`'s internal tier-1 classification, non-drop
    invariant, and leak-scan gate all run exactly as already proven for video 1
    (`75DJN5UVQnw`) of the original 3-video pilot.

THREE STEPS, SPLIT BECAUSE THE REAL OPUS CALL CANNOT HAPPEN INSIDE THIS PROCESS
  emit    <video_id> [--strategy-index N]
          Build the batch task text (brief + all spine conditions + full transcript) and
          write it to disk. Does not call any model.
  ingest  <video_id> [--strategy-index N] --raw <path-to-raw-response-text>
          Validate the shape of a real Opus reader's raw text return (via
          `batch_locator.parse_batch_return`), hash it BEFORE parsing ("raw is sacred" --
          batch_locator.py SS3), and persist the per-condition raw answers + an invocation
          receipt.
  prep    <video_id> [--strategy-index N]
          Build a `propose_fn` that serves each condition's already-ingested raw Opus answer
          IN THE SAME ORDER `prepare_strategy`'s internal `locate_condition_anchors` loop will
          ask for it, then call the REAL, UNMODIFIED `prepare_strategy` with that `propose_fn`.
          `locate_anchor`'s own internal `_verify_and_locate` mechanical fence (the SAME literal
          whitespace-normalized-only verifier `batch_locator.verify_answer` reuses) runs exactly
          as it does for the Gemma path -- this driver never re-implements verification.
          Writes to the CANONICAL prep paths (overwriting a stale Gemma-path prep there is
          correct and intended -- AR-1345A retired that path from load-bearing authority, so a
          prep produced under it is not a valid alternative sitting beside the new one, it is a
          WRONG artifact that must not be trusted), plus a sibling
          `<video>__s<N>.opus_batch_receipt.json` carrying full provenance -- so the EXISTING,
          already-graded `scripts/strategy_factory_prepare_and_finalize.py finalize` subcommand
          consumes the result completely unmodified (AR-1345A step 10: "reusing the exact same
          Agent-dispatch pattern already proven for video 1").

WHAT THIS DRIVER DOES NOT DO
  It does not route through `src/engine/extraction/opus_phase1_route.py` (the AR-1236 SS10
  collision/relevance/fidelity gate stack) -- that module is a separate, later-ruling gate
  system built for a different campaign. Pulling it in here would be scope creep beyond
  AR-1345A's 13 named steps, which map onto THIS pilot's existing prepare_strategy -> tier-1 ->
  tier-3 Stage-1/Stage-2 adjudication pipeline, already proven for video 1. Noted explicitly
  here (never silently) per CLAUDE.md SS0 rule 3 -- if that scope decision is wrong, it is a
  named, correctable choice, not a silent omission.

LEAKAGE SCREEN, HONESTLY SCOPED
  `batch_locator.screen_task_for_leakage` exists to catch a PRIOR answer key bleeding into a
  re-run. For a video's FIRST Opus batch pass there is no prior answer key to leak -- nothing
  to screen against, and `screen_is_live`'s positive-control witness cannot be constructed
  (it needs >=1 real forbidden needle). `emit` records this as an explicit
  `{"applicable": false, "reason": ...}`, never a silent skip that would read like "screened,
  clean" when nothing was actually checked.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pickle  # TRUSTED-LOCAL only, same precedent as strategy_factory_prepare_and_finalize.py:
# this script's own `prep` subcommand writes the pickle; the sibling `finalize` subcommand
# (unmodified, in strategy_factory_prepare_and_finalize.py) reads it back -- never loaded from
# network input, an upload, or any other untrusted source.
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PREP_DIR = "docs/replay-results/strategy-factory-census/extraction-vault/preps"
TRANSCRIPT_DIR = "src/engine/extraction/fixtures/source-evidence"
VAULT_DIR = "docs/replay-results/strategy-factory-census/extraction-vault"
OPUS_BATCH_DIR = "docs/replay-results/strategy-factory-census/extraction-vault/opus-batch"


def _load_strategy(video_id: str, strategy_index: int):
    vault_path = os.path.join(REPO_ROOT, VAULT_DIR, f"{video_id}.json")
    transcript_path = os.path.join(REPO_ROOT, TRANSCRIPT_DIR, f"{video_id}.transcript.txt")
    with open(vault_path, "r", encoding="utf-8") as f:
        vault_record = json.load(f)
    with open(transcript_path, "r", encoding="utf-8") as f:
        transcript = f.read()
    strategies = vault_record["extraction"].get("strategies") or []
    if strategy_index >= len(strategies):
        return None, transcript, strategies
    return strategies[strategy_index], transcript, strategies


def cmd_emit(video_id: str, strategy_index: int) -> int:
    sys.path.insert(0, REPO_ROOT)
    from src.engine.extraction import anchor_locator as al
    from src.engine.extraction import batch_locator as bl
    from src.engine.extraction.pilot_conveyor import extract_spine_condition_texts

    strategy, transcript, strategies = _load_strategy(video_id, strategy_index)
    if strategy is None:
        print(json.dumps({"video_id": video_id, "status": "NO_STRATEGY_AT_INDEX"}))
        return 1

    spine_conditions = extract_spine_condition_texts(strategy, strategy_index)
    if not spine_conditions:
        print(json.dumps({"video_id": video_id, "status": "NO_SPINE_CONDITIONS"}))
        return 1

    conditions_for_batch = [
        {"condition_ref": c.condition_ref, "condition_text": c.text} for c in spine_conditions
    ]

    # AR-1351 F-2: fail closed on duplicate condition_text within one batch. `cmd_prep`'s
    # propose_fn desync guard (below) can only compare condition_text -- the anchor_locator.
    # locate_anchor seam it must match passes `(transcript, condition_text)`, never
    # condition_ref -- so two conditions sharing identical text are structurally indistinguishable
    # to that guard and it cannot catch a same-call misattribution between them. MEASURED: a
    # monkeypatch swap test on a real duplicate-text unit confirmed the guard does NOT fire in
    # this case. Refusing here, at emit time, is the correct fail-closed point -- before any
    # Opus dispatch is spent on a batch this driver cannot safely disambiguate.
    seen_text: dict[str, str] = {}
    dupes = []
    for c in conditions_for_batch:
        prior_ref = seen_text.get(c["condition_text"])
        if prior_ref is not None:
            dupes.append((prior_ref, c["condition_ref"], c["condition_text"]))
        else:
            seen_text[c["condition_text"]] = c["condition_ref"]
    if dupes:
        print(json.dumps({
            "video_id": video_id, "strategy_index": strategy_index,
            "status": "DUPLICATE_CONDITION_TEXT_REFUSED",
            "duplicates": [{"ref_a": a, "ref_b": b, "condition_text": t} for a, b, t in dupes],
            "reason": (
                "two or more conditions share identical condition_text -- the propose_fn desync "
                "guard cannot disambiguate between them by text alone (AR-1351 F-2). Refusing "
                "before spending a dispatch on a batch this driver cannot safely verify."
            ),
        }, indent=2))
        return 1

    task_text = bl.build_batch_task(al._SYSTEM_PROMPT, transcript, conditions_for_batch)
    brief = bl.build_batch_brief(al._SYSTEM_PROMPT)

    screen_result = {
        "applicable": False,
        "reason": (
            "no prior answer key exists for this video's first Opus batch pass -- nothing to "
            "leak, so screen_task_for_leakage has no needle and screen_is_live's positive "
            "control cannot be constructed. This is an honest N/A, not a silent skip."
        ),
    }

    out_dir = os.path.join(REPO_ROOT, OPUS_BATCH_DIR, f"{video_id}__s{strategy_index}")
    os.makedirs(out_dir, exist_ok=True)
    # AR-1351 F-3: newline="\n" so the bytes written to disk are EXACTLY the string task_sha256
    # below was computed from. Without this, Python's text-mode write translates "\n" -> "\r\n"
    # on Windows, so a naive sha256(disk bytes) check would silently disagree with the recorded
    # hash for every unit -- measured: 0/42 raw responses verified under a naive re-hash before
    # this fix, 42/42 after (git's own eol=lf normalization on commit still made the COMMITTED
    # blob hash-correct, which is why this was not caught by production evidence -- only by an
    # independent re-hash of the literal on-disk bytes before commit).
    with open(os.path.join(out_dir, "batch_task.txt"), "w", encoding="utf-8", newline="\n") as f:
        f.write(task_text)
    index = {
        "video_id": video_id,
        "strategy_index": strategy_index,
        "condition_order": [c.condition_ref for c in spine_conditions],
        "conditions": conditions_for_batch,
        "task_sha256": bl.sha256(task_text),
        "task_char_len": len(task_text),
        "transcript_sha256": hashlib.sha256(transcript.encode("utf-8")).hexdigest(),
        "transcript_char_len": len(transcript),
        "brief_version": brief["brief_version"],
        "batch_brief_sha256": brief["batch_brief_sha256"],
        "reused_verbatim_sha256": brief["reused_verbatim_sha256"],
        "production_system_prompt_sha256": brief["production_system_prompt_sha256"],
        "leakage_screen": screen_result,
        "authority": "AR-1345A recovery step 1 (reuse, do not rebuild); AR-1234 SS6 LANE O1 topology",
    }
    with open(os.path.join(out_dir, "batch_task_index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2)

    print(json.dumps({
        "video_id": video_id,
        "strategy_index": strategy_index,
        "status": "EMITTED",
        "task_path": os.path.join(out_dir, "batch_task.txt"),
        "index_path": os.path.join(out_dir, "batch_task_index.json"),
        "condition_count": len(spine_conditions),
        "task_char_len": len(task_text),
        "next_step": (
            "dispatch via Agent tool: subagent_type=general-purpose, model override=opus, ONE "
            "fresh subagent, given ONLY this task file's text as its prompt. Save the "
            "subagent's raw final text verbatim to a file, then run `ingest --raw <path>`."
        ),
    }, indent=2))
    return 0


def cmd_ingest(video_id: str, strategy_index: int, raw_path: str) -> int:
    sys.path.insert(0, REPO_ROOT)
    from src.engine.extraction import batch_locator as bl

    out_dir = os.path.join(REPO_ROOT, OPUS_BATCH_DIR, f"{video_id}__s{strategy_index}")
    index_path = os.path.join(out_dir, "batch_task_index.json")
    with open(index_path, "r", encoding="utf-8") as f:
        index = json.load(f)
    with open(raw_path, "r", encoding="utf-8") as f:
        raw_text = f.read()

    # raw is sacred (batch_locator.py SS3): hash BEFORE any parsing/repair is attempted, and
    # persist the untouched text regardless of whether parsing below succeeds.
    raw_sha256 = hashlib.sha256(raw_text.encode("utf-8")).hexdigest()
    # AR-1351 F-3: newline="\n" -- see the matching note in cmd_emit above. raw_text was read via
    # text-mode open() (universal newlines, always "\n" in memory) and hashed as that string;
    # writing it back with default text-mode translation would silently CRLF the disk copy while
    # the recorded hash stays LF-based, making a naive re-hash of the committed file disagree.
    with open(os.path.join(out_dir, "batch_raw_response.txt"), "w", encoding="utf-8", newline="\n") as f:
        f.write(raw_text)

    expected_refs = index["condition_order"]
    try:
        answers = bl.parse_batch_return(raw_text, expected_refs=expected_refs)
    except (ValueError, json.JSONDecodeError) as e:
        print(json.dumps({
            "video_id": video_id, "strategy_index": strategy_index,
            "status": "PARSE_OR_SHAPE_FAILURE", "error": str(e), "raw_sha256": raw_sha256,
        }, indent=2))
        return 1

    receipt = {
        "video_id": video_id,
        "strategy_index": strategy_index,
        "raw_response_sha256": raw_sha256,
        "raw_response_char_len": len(raw_text),
        "answer_count": len(answers),
        "abstained_count": sum(1 for a in answers if a["raw_output"] is None),
        "candidate": {
            "invocation": (
                "Agent tool, subagent_type=general-purpose, model override=opus, ONE fresh "
                "subagent per video, given only the task text -- no direct Anthropic API "
                "key/SDK spend, uses the Claude Code subscription's own subagent dispatch "
                "(same invocation contract as AR-1234 LANE O1's svkm_opus_batch_locator.py)"
            ),
            "topology": "AR-1234 SS6 LANE O1: ONE fresh reader per video, full transcript once, ALL spine conditions at once",
        },
        "authority": "AR-1345A recovery steps 4/6 (preserve raw output before verify; prove real Opus execution)",
    }
    with open(os.path.join(out_dir, "batch_answers.json"), "w", encoding="utf-8") as f:
        json.dump(answers, f, indent=2)
    with open(os.path.join(out_dir, "receipt.json"), "w", encoding="utf-8") as f:
        json.dump(receipt, f, indent=2)

    print(json.dumps({"video_id": video_id, "strategy_index": strategy_index, "status": "INGESTED", **receipt}, indent=2))
    return 0


def cmd_prep(video_id: str, strategy_index: int) -> int:
    sys.path.insert(0, REPO_ROOT)
    from src.engine.extraction.pilot_conveyor import prepare_strategy

    out_dir = os.path.join(REPO_ROOT, OPUS_BATCH_DIR, f"{video_id}__s{strategy_index}")
    with open(os.path.join(out_dir, "batch_task_index.json"), "r", encoding="utf-8") as f:
        index = json.load(f)
    with open(os.path.join(out_dir, "batch_answers.json"), "r", encoding="utf-8") as f:
        answers = json.load(f)
    with open(os.path.join(out_dir, "receipt.json"), "r", encoding="utf-8") as f:
        ingest_receipt = json.load(f)

    strategy, transcript, _ = _load_strategy(video_id, strategy_index)
    if strategy is None:
        print(json.dumps({"video_id": video_id, "status": "NO_STRATEGY_AT_INDEX"}))
        return 1

    answers_by_ref = {a["condition_ref"]: a["raw_output"] for a in answers}
    condition_order = list(index["condition_order"])
    text_by_ref = {c["condition_ref"]: c["condition_text"] for c in index["conditions"]}
    queue = list(condition_order)  # consumed strictly in call order below

    def opus_batch_propose_fn(transcript_arg: str, condition_text: str):
        # `locate_condition_anchors` calls `al.locate_anchor(full_transcript, cond.text,
        # propose_fn=propose_fn)` once per condition, IN `spine_conditions`' OWN ORDER -- the
        # exact order `condition_order` was built in at `emit` time (both derive from the same
        # pure, no-I/O `extract_spine_condition_texts` call on the same strategy dict). Popping
        # the queue in call order and asserting the condition_text matches what THIS position's
        # ref expects is a same-call desync guard: a silent mismatch here would hand one
        # condition's raw answer to a DIFFERENT condition's disposition.
        if not queue:
            raise RuntimeError(
                "opus_batch_propose_fn called more times than there are batched answers -- "
                "prepare_strategy's condition extraction diverged from this driver's emit-time run"
            )
        ref = queue.pop(0)
        expected_text = text_by_ref[ref]
        if condition_text != expected_text:
            raise RuntimeError(
                f"call-order desync at position for condition_ref {ref!r}: emit-time text "
                f"{expected_text!r} != prepare_strategy's text {condition_text!r}. Refusing to "
                "guess which answer belongs to which condition."
            )
        return answers_by_ref[ref]

    result = prepare_strategy(
        strategy, transcript, video_id,
        extractor_version="minimal-8field-pass-l",
        taxonomy_version="v1",
        strategy_index=strategy_index,
        propose_fn=opus_batch_propose_fn,
    )

    if queue:
        raise RuntimeError(
            f"opus_batch_propose_fn under-called: {len(queue)} batched answers never consumed "
            "-- prepare_strategy's own condition extraction diverged from this driver's"
        )

    os.makedirs(os.path.join(REPO_ROOT, PREP_DIR), exist_ok=True)
    prep_path = os.path.join(REPO_ROOT, PREP_DIR, f"{video_id}__s{strategy_index}.pkl")
    with open(prep_path, "wb") as f:
        pickle.dump(result, f)
    packet_path = os.path.join(REPO_ROOT, PREP_DIR, f"{video_id}__s{strategy_index}.tier3_packet.json")
    with open(packet_path, "w", encoding="utf-8") as f:
        json.dump(result["tier3_packet"], f, indent=2, default=str)

    receipt_path = os.path.join(REPO_ROOT, PREP_DIR, f"{video_id}__s{strategy_index}.opus_batch_receipt.json")
    provenance = {
        "video_id": video_id,
        "strategy_index": strategy_index,
        "locator_backend": "opus_batch (AR-1345A recovery; AR-1234 LANE O1 topology)",
        "batch_task_sha256": index["task_sha256"],
        "batch_task_index_path": os.path.join(out_dir, "batch_task_index.json"),
        "raw_response_sha256": ingest_receipt["raw_response_sha256"],
        "raw_response_path": os.path.join(out_dir, "batch_raw_response.txt"),
        "invocation": ingest_receipt["candidate"]["invocation"],
        "condition_order_consumed_fully": True,
    }
    with open(receipt_path, "w", encoding="utf-8") as f:
        json.dump(provenance, f, indent=2)

    n_fallthrough = len(result["tier1_fallthroughs"])
    print(json.dumps({
        "video_id": video_id,
        "strategy_index": strategy_index,
        "locator": "opus_batch (AR-1345A recovery)",
        "prep_path": prep_path,
        "packet_path": packet_path,
        "receipt_path": receipt_path,
        "spine_condition_count": result["spine_condition_count"],
        "unanchored_count": len(result["unanchored_conditions"]),
        "tier1_classified_count": len(result["tier1_detections"]),
        "tier1_fallthrough_count": n_fallthrough,
        "dispatch_needed": n_fallthrough > 0 and len(result["unanchored_conditions"]) == 0,
        "cert_guaranteed_unclean": len(result["unanchored_conditions"]) > 0,
    }, indent=2))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    p1 = sub.add_parser("emit")
    p1.add_argument("video_id")
    p1.add_argument("--strategy-index", type=int, default=0)

    p2 = sub.add_parser("ingest")
    p2.add_argument("video_id")
    p2.add_argument("--strategy-index", type=int, default=0)
    p2.add_argument("--raw", required=True)

    p3 = sub.add_parser("prep")
    p3.add_argument("video_id")
    p3.add_argument("--strategy-index", type=int, default=0)

    args = ap.parse_args()
    if args.cmd == "emit":
        return cmd_emit(args.video_id, args.strategy_index)
    if args.cmd == "ingest":
        return cmd_ingest(args.video_id, args.strategy_index, args.raw)
    return cmd_prep(args.video_id, args.strategy_index)


if __name__ == "__main__":
    raise SystemExit(main())
