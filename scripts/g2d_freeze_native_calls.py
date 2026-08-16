#!/usr/bin/env python3
"""AR-1267 §6.2 / §9C — FREEZE THE EXACT NATIVE-CALL EXECUTION IDENTITY, BEFORE ANY ANSWER EXISTS.

WHAT WAS OPEN
    The frozen queue's `task_input_sha256` binds the LOGICAL task: law version, route version,
    condition ref, condition text, pinned inputs. It says nothing about the BYTES that actually
    reach the model. So a permit for the correct condition could accompany a prompt carrying a
    batch answer, a prior winning quote, a GPT hint or a "correct quote" -- and the pre-call
    guard's only prompt check was that the invocation text CONTAINS the condition ref.

WHAT THIS IS, AND WHAT IT IS NOT
    This is an EXECUTION-LAYER artifact. It does not select, reorder, add to or remove from the
    eight-condition queue (AR-1267 §6: "This is an execution-layer artifact, not a new selection
    law"). It reads the frozen queue and states, for each ref already in it, exactly which native
    call is authorized to be issued.

NOTHING HERE IS AUTHORED EXTRACTION SEMANTICS
    The prompt is REUSED BY IMPORT from `anchor_locator._SYSTEM_PROMPT` and
    `anchor_locator._build_user_message` -- the same fairness contract the frozen benchmark packet
    declares ("reused BY IMPORT and unmodified"). Both are verified against the sha256 values the
    committed benchmark packet pins BEFORE anything is written, so a drifted prompt is a hard stop
    rather than a silently re-frozen new task.

    THE ONE DECLARED DELTA, stated the way AR-1234's batch arm stated its own: a native subagent
    call has a single `prompt` field and no system/user split, so the two frozen strings are
    JOINED with "\\n\\n". No other byte is added, removed or reordered. The G2 permit travels in
    the tool's `description` field, deliberately NOT in the prompt, so the model's task stays
    byte-identical to the frozen locator contract.

ANSWER-INDEPENDENCE IS THE POINT
    Every input here is frozen evidence that predates the eight calls: the queue artifact, the
    benchmark packet, the pinned transcript, and the locator source. Nothing reads an answer, a
    batch candidate, a score or a prior winner -- there is no code path to one.

Usage:
    python scripts/g2d_freeze_native_calls.py --write        # freeze the artifact
    python scripts/g2d_freeze_native_calls.py --verify       # re-derive and compare, write nothing
    python scripts/g2d_freeze_native_calls.py --emit-prompt "entry_sequence[0].rationale"
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.engine.extraction.anchor_locator import _SYSTEM_PROMPT, _build_user_message  # noqa: E402
from src.engine.extraction.isolated_attempt_receipt import _safe_name  # noqa: E402

SCHEMA = "g2d-native-call-identity-v1"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join("docs", "replay-results", "svkm-extraction-certified")
QUEUE_PATH = os.path.join(BASE, "grade", "opus-v2", "isolated_fallback_queue_t1.json")
RECEIPT_DIR = os.path.join(BASE, "grade", "opus-v2", "isolated-receipts-t1")
BENCHMARK_PATH = os.path.join(BASE, "benchmark", "benchmark_packet_v1.json")
OUT_PATH = os.path.join(BASE, "grade", "opus-v2", "native_call_manifest_t1.json")

# AR-1267 §6.1. `subagent_type` is pinned as well as `model`, because the live Agent schema
# documents that `fork` IGNORES the model field and inherits the parent context -- which would
# defeat the model binding and the isolation law in the same call.
APPROVED_MODEL = "opus"
APPROVED_SUBAGENT_TYPE = "general-purpose"
PROMPT_JOINER = "\n\n"


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _sha_file(path: str) -> str:
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def _abs(rel: str) -> str:
    return os.path.join(ROOT, rel)


def build() -> dict:
    """Derive the eight rows. Raises rather than writing anything on any identity mismatch."""
    with open(_abs(QUEUE_PATH), encoding="utf-8") as fh:
        queue = json.load(fh)
    with open(_abs(BENCHMARK_PATH), encoding="utf-8") as fh:
        bench = json.load(fh)

    # --- POSITIVE CONTROLS ON THE INPUTS, before a single row is derived --------------------- #
    # The prompt is only "reused unmodified" if it still hashes to what the packet froze. Reading
    # it by import and TRUSTING it would make this artifact a faithful record of a drifted task.
    if _sha(_SYSTEM_PROMPT) != bench["prompt"]["system_prompt_sha256"]:
        raise SystemExit(
            "STOP: anchor_locator._SYSTEM_PROMPT no longer hashes to the frozen benchmark packet's "
            f"system_prompt_sha256 ({bench['prompt']['system_prompt_sha256']}). The locator prompt "
            "has changed since the benchmark was frozen, so freezing a native call from it would "
            "silently authorize a different task. This is a desk question, not a re-freeze."
        )
    template_probe = _build_user_message("<TRANSCRIPT>", "<CONDITION>")
    if _sha(template_probe) != bench["prompt"]["user_message_template_sha256"]:
        raise SystemExit(
            "STOP: anchor_locator._build_user_message no longer reproduces the frozen benchmark "
            "user-message template. Same reason as above -- refusing to freeze a changed task."
        )

    transcript_path = bench["input"]["transcript_path"]
    if _sha_file(_abs(transcript_path)) != bench["input"]["transcript_sha256"]:
        raise SystemExit(
            f"STOP: {transcript_path} does not hash to the pinned transcript_sha256. The eight "
            "calls are grounded against a specific transcript; a different one is a different task."
        )
    with open(_abs(transcript_path), encoding="utf-8") as fh:
        transcript = fh.read()

    queue_sha = _sha_file(_abs(QUEUE_PATH))
    if queue["pinned_inputs"]["transcript_sha256"] != bench["input"]["transcript_sha256"]:
        raise SystemExit("STOP: the queue and the benchmark packet pin different transcripts.")

    calls = []
    for entry in queue["queue"]:
        ref = entry["condition_ref"]
        user_message = _build_user_message(transcript, entry["condition_text"])
        prompt = _SYSTEM_PROMPT + PROMPT_JOINER + user_message
        permit_path = os.path.join(RECEIPT_DIR, f"{_safe_name(ref)}.permit.json").replace("\\", "/")

        # The canonical hash covers exactly the fields that decide WHAT MODEL runs and WHAT IT IS
        # ASKED. `description` and `isolation` are excluded on purpose: binding a field that does
        # not change the model's task would make the guard brittle without making it stricter.
        canonical = json.dumps(
            {"model": APPROVED_MODEL, "subagent_type": APPROVED_SUBAGENT_TYPE, "prompt": prompt},
            separators=(",", ":"),
        )
        calls.append({
            "condition_ref": ref,
            "task_input_sha256": entry["task_input_sha256"],
            "model": APPROVED_MODEL,
            "subagent_type": APPROVED_SUBAGENT_TYPE,
            "permit_path": permit_path,
            "description_must_contain": [f"G2D-PERMIT: {permit_path}", ref],
            "native_prompt_sha256": _sha(prompt),
            "native_prompt_char_count": len(prompt),
            "native_call_sha256": _sha(canonical),
        })

    return {
        "schema": SCHEMA,
        "authority": "AR-1267 §6.2 + §9C (freeze the native-call execution identity before answers exist)",
        "frozen_before_any_answer": True,
        "queue_artifact_path": QUEUE_PATH.replace("\\", "/"),
        "queue_artifact_sha256": queue_sha,
        "law_version": queue["law_version"],
        "input_route_version": queue["input_route_version"],
        "pinned_inputs": queue["pinned_inputs"],
        "benchmark_packet_sha256": bench["packet_sha256"],
        "prompt_provenance": {
            "system_prompt_source": "src/engine/extraction/anchor_locator.py::_SYSTEM_PROMPT",
            "system_prompt_sha256": bench["prompt"]["system_prompt_sha256"],
            "user_message_source": "src/engine/extraction/anchor_locator.py::_build_user_message",
            "user_message_template_sha256": bench["prompt"]["user_message_template_sha256"],
            "transcript_path": transcript_path,
            "transcript_sha256": bench["input"]["transcript_sha256"],
            "reuse_contract": "reused BY IMPORT and unmodified (benchmark_packet_v1 fairness_contract)",
            "declared_delta": (
                "A native subagent call has ONE `prompt` field and no system/user split, so the two "
                "frozen strings are joined with a literal \\n\\n. That joiner is the ONLY authored "
                "byte in the prompt. The G2 permit marker travels in the tool's `description` "
                "field, NOT in the prompt, so the model's task stays byte-identical to the frozen "
                "locator contract. Declared here for the same reason AR-1234's batch arm declared "
                "its own delta: an undeclared framing change is a different task wearing the old "
                "task's hash."
            ),
            "isolation": (
                "No batch answer, prior winner, GPT hint, expected answer, score or 'correct quote' "
                "is reachable from this derivation. Every input predates the eight calls."
            ),
        },
        "canonical_hash_fields": ["model", "subagent_type", "prompt"],
        "canonical_hash_note": (
            "sha256 over json.dumps({model, subagent_type, prompt}, separators=(',',':')) with that "
            "exact key order. The JS guard's canonicalNativeCallSha256 builds the same object "
            "literal in the same order, and the cross-language agreement is asserted by a control."
        ),
        "call_count": len(calls),
        "calls": calls,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--emit-prompt", metavar="CONDITION_REF")
    args = ap.parse_args()

    if args.emit_prompt:
        with open(_abs(QUEUE_PATH), encoding="utf-8") as fh:
            queue = json.load(fh)
        with open(_abs(BENCHMARK_PATH), encoding="utf-8") as fh:
            bench = json.load(fh)
        with open(_abs(bench["input"]["transcript_path"]), encoding="utf-8") as fh:
            transcript = fh.read()
        match = [e for e in queue["queue"] if e["condition_ref"] == args.emit_prompt]
        if not match:
            print(f"{args.emit_prompt!r} is not a member of the frozen queue", file=sys.stderr)
            return 2
        # BYTES, NOT TEXT. `sys.stdout` is in text mode on Windows, so writing the prompt as a
        # str turned all 15 newlines into CRLF: 25948 chars in, 25963 bytes out. The JS guard
        # then hashed a prompt this process had never authorized.
        #
        # It stayed invisible for exactly one reason: reading it back in PYTHON with text=True
        # applies universal newlines and translates CRLF straight back to LF, so the round-trip
        # said "equal" while the bytes on the wire disagreed. THE INSTRUMENT HID THE DEFECT FROM
        # ITSELF, and only the cross-language control saw it.
        sys.stdout.buffer.write(
            (_SYSTEM_PROMPT + PROMPT_JOINER + _build_user_message(transcript, match[0]["condition_text"]))
            .encode("utf-8")
        )
        sys.stdout.buffer.flush()
        return 0

    doc = build()

    if args.verify:
        if not os.path.exists(_abs(OUT_PATH)):
            print(f"MISSING: {OUT_PATH}", file=sys.stderr)
            return 1
        with open(_abs(OUT_PATH), encoding="utf-8") as fh:
            on_disk = json.load(fh)
        if on_disk == doc:
            print(f"VERIFIED: {OUT_PATH} re-derives byte-identically from the frozen inputs.")
            return 0
        print(f"DRIFT: {OUT_PATH} does not match a fresh derivation.", file=sys.stderr)
        return 1

    if args.write:
        os.makedirs(os.path.dirname(_abs(OUT_PATH)), exist_ok=True)
        with open(_abs(OUT_PATH), "w", encoding="utf-8", newline="\n") as fh:
            json.dump(doc, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        print(f"WROTE {OUT_PATH} — {doc['call_count']} frozen native calls")
        for c in doc["calls"]:
            print(f"  {c['condition_ref']:<34} {c['native_call_sha256'][:16]}  prompt {c['native_prompt_char_count']} chars")
        return 0

    ap.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
