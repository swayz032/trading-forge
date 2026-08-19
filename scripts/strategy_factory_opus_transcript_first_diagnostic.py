#!/usr/bin/env python3
"""Transcript-first Opus diagnostic for the frozen 40-video Strategy Factory corpus.

This tool is deliberately separate from the canonical extraction vault. It exists to answer one
question without contaminating production artifacts:

    did the modern Factory refuse the SOURCE, or did it refuse a legacy model's interpretation?

The `emit` command reads ONLY the frozen transcript for the selected video plus this file's static
source-reader contract. It does not read the legacy extraction JSON. The legacy artifact is not
opened until `compare`, after a fresh Opus candidate has already been ingested, hash-frozen, and
independently graded.

No output from this script is Factory authority. A candidate must still survive the normal
certified compile path before it can become FAITHFUL_COMPILE_READY_FOR_BACKTEST.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
SELECTION_PATH = REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/selection.json"
DEFAULT_OUT = REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/runs"
CANONICAL_VAULT = REPO_ROOT / "docs/replay-results/strategy-factory-census/extraction-vault"

REQUIRED_MODEL_OVERRIDE = "opus"
REQUIRED_READER_ROLE = "OPUS_LEAD_SOURCE_READER"
STATUS_FRESH = "FRESH_OPUS_SOURCE_CANDIDATE_NOT_CERTIFIED"

TASK_PREAMBLE = """You are the LEAD SOURCE READER for a controlled Trading Forge diagnostic.

MISSION
Read the ORIGINAL transcript below from scratch and reconstruct exactly the executable trading
strategy or strategies the educator actually teaches. Do not repair, defend, imitate, or infer from
any prior extraction. You are intentionally not being shown any legacy strategy JSON.

SOURCE-FIDELITY LAW
- The transcript is source authority. Your interpretation is not.
- Do not invent missing rules, defaults, indicator settings, direction, timeframes, stops, targets,
  sequencing, or variants.
- If the source does not settle a load-bearing field, record the gap in source_gaps instead of guessing.
- Distinguish education/context from executable trade requirements.
- Preserve every separately taught strategy. Do not merge multiple strategies into one.
- Preserve alternatives/variants without choosing a favorite for the educator.
- Every load-bearing statement you emit MUST carry a transcript_quote copied from the transcript.
- transcript_quote may normalize whitespace only; do not paraphrase inside the quote.
- Return strict JSON only. No Markdown fence and no prose before/after the JSON.

OUTPUT SHAPE
{
  "video_id": "<exact supplied video id>",
  "reader_role": "OPUS_LEAD_SOURCE_READER",
  "instrument_classification": {
    "asset_class": "<source-grounded value or null>",
    "instrument": "<source-grounded value or null>",
    "rationale": "<brief source-grounded explanation or null>",
    "transcript_quote": "<literal support or null>"
  },
  "strategies": [
    {
      "source_strategy_id": "s0",
      "name": "<neutral source-grounded name>",
      "direction": "long|short|both|source_unresolved",
      "direction_transcript_quote": "<literal support, or null only when source_unresolved>",
      "higher_timeframe": "<source-grounded value or source_unresolved>",
      "higher_timeframe_transcript_quote": "<literal support, or null only when source_unresolved>",
      "execution_timeframe": "<source-grounded value or source_unresolved>",
      "execution_timeframe_transcript_quote": "<literal support, or null only when source_unresolved>",
      "setup": [
        {"description": "<rule/context>", "transcript_quote": "<literal source quote>"}
      ],
      "entry_sequence": [
        {
          "step": 1,
          "role": "context|spine|trigger",
          "action": "<what must happen>",
          "rationale": "<why this step belongs in the taught strategy>",
          "transcript_quote": "<literal source quote>"
        }
      ],
      "confluences": [
        {
          "name": "<neutral name>",
          "description": "<source-grounded condition>",
          "transcript_quote": "<literal source quote>"
        }
      ],
      "stop": null,
      "targets": [
        {
          "priority": 1,
          "type": "<source-grounded target type>",
          "r_multiple": null,
          "rationale": "<exact taught target rule>",
          "transcript_quote": "<literal source quote>"
        }
      ],
      "management": [
        {"rule": "<source-grounded management/re-entry/exit rule>", "transcript_quote": "<literal quote>"}
      ],
      "variants": [
        {"name": "<source-grounded variant>", "rule": "<what differs>", "transcript_quote": "<literal quote>"}
      ],
      "source_gaps": [
        {"field": "<unresolved field>", "reason": "<what the transcript does not settle>"}
      ]
    }
  ],
  "top_level_source_gaps": []
}

STOP OBJECT
If a stop is explicitly taught, replace null with:
{
  "anchor": "<source wording/canonical description without invention>",
  "rationale": "<exact taught stop rule>",
  "transcript_quote": "<literal source quote>"
}

IDENTITY LAW
- source_strategy_id values must be sequential s0, s1, ... in source-order.
- If the transcript teaches zero executable strategies, return strategies=[] and explain why in
  top_level_source_gaps.
- Do not force the strategy count to match any historical corpus.
"""


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_text(text: str) -> str:
    return sha256_bytes(text.encode("utf-8"))


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_text_lf(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def write_json(path: Path, obj: Any) -> None:
    write_text_lf(path, json.dumps(obj, indent=2, ensure_ascii=False) + "\n")


def norm_ws(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def selection() -> dict[str, Any]:
    return read_json(SELECTION_PATH)


def get_case(video_id: str) -> dict[str, Any]:
    data = selection()
    for case in data["cases"]:
        if case["video_id"] == video_id:
            return case
    raise SystemExit(f"video_id {video_id!r} is not in frozen diagnostic selection")


def transcript_for(case: dict[str, Any]) -> tuple[Path, str]:
    path = REPO_ROOT / case["transcript_path"]
    if not path.is_file():
        raise SystemExit(f"missing transcript: {path}")
    text = path.read_text(encoding="utf-8")
    if not text.strip():
        raise SystemExit(f"empty transcript: {path}")
    return path, text


def build_task(video_id: str, transcript: str) -> str:
    # Isolation invariant: there is no legacy-extraction argument and no file I/O here.
    return (
        TASK_PREAMBLE
        + "\n\nSUPPLIED VIDEO ID\n"
        + video_id
        + "\n\nORIGINAL TRANSCRIPT — SOURCE AUTHORITY\n<<<TRANSCRIPT_START>>>\n"
        + transcript
        + "\n<<<TRANSCRIPT_END>>>\n"
    )


def _display_path(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT)).replace(os.sep, "/")
    except ValueError:
        return str(path)


def _safe_out_root(raw: str) -> Path:
    root = Path(raw)
    if not root.is_absolute():
        root = REPO_ROOT / root
    resolved = root.resolve()
    vault = CANONICAL_VAULT.resolve()
    try:
        resolved.relative_to(vault)
    except ValueError:
        pass
    else:
        raise SystemExit(
            "diagnostic out-dir may not be the canonical extraction vault or any child of it"
        )
    return resolved


def cmd_emit(args: argparse.Namespace) -> int:
    case = get_case(args.video_id)
    transcript_path, transcript = transcript_for(case)
    task = build_task(args.video_id, transcript)
    out_dir = _safe_out_root(args.out_dir) / args.video_id
    task_path = out_dir / "opus_source_reader_task.txt"
    index_path = out_dir / "task_index.json"
    write_text_lf(task_path, task)
    index = {
        "artifact": "opus-transcript-first-task-index-v2",
        "status": "AWAITING_FRESH_OPUS_READER",
        "video_id": args.video_id,
        "diagnostic_category": case["category"],
        "transcript_path": _display_path(transcript_path),
        "transcript_sha256": sha256_text(transcript),
        "transcript_char_len": len(transcript),
        "task_path": _display_path(task_path),
        "task_sha256": sha256_text(task),
        "required_model_override": REQUIRED_MODEL_OVERRIDE,
        "required_reader_role": REQUIRED_READER_ROLE,
        "semantic_blindness": {
            "legacy_extraction_opened_by_emit": False,
            "legacy_semantics_in_prompt": False,
            "construction": "static source-reader contract + exact transcript bytes only"
        },
        "next_step": (
            "Dispatch ONE fresh Claude Code subagent with model override=opus and give it ONLY "
            "opus_source_reader_task.txt. Save its raw final text verbatim. Create an invocation "
            "receipt bound to this task/transcript, then run ingest."
        )
    }
    write_json(index_path, index)
    print(json.dumps(index, indent=2))
    return 0


def _iter_quote_objects(strategy: dict[str, Any]):
    for key in ("setup", "entry_sequence", "confluences", "targets", "management", "variants"):
        value = strategy.get(key)
        if value is None:
            continue
        if not isinstance(value, list):
            raise ValueError(f"{key} must be a list")
        for i, item in enumerate(value):
            if not isinstance(item, dict):
                raise ValueError(f"{key}[{i}] must be an object")
            yield f"{key}[{i}]", item
    stop = strategy.get("stop")
    if stop is not None:
        if not isinstance(stop, dict):
            raise ValueError("stop must be null or an object")
        yield "stop", stop


def _require_literal_quote(
    quote: Any, *, ref: str, normalized_transcript: str, failures: list[str]
) -> int:
    if not isinstance(quote, str) or not quote.strip():
        failures.append(f"{ref}: missing transcript_quote")
        return 0
    if norm_ws(quote) not in normalized_transcript:
        failures.append(f"{ref}: quote is not a whitespace-normalized transcript substring")
    return 1


def validate_candidate(candidate: dict[str, Any], transcript: str, video_id: str) -> dict[str, Any]:
    if candidate.get("video_id") != video_id:
        raise ValueError(f"candidate video_id mismatch: {candidate.get('video_id')!r} != {video_id!r}")
    if candidate.get("reader_role") != REQUIRED_READER_ROLE:
        raise ValueError("reader_role is not OPUS_LEAD_SOURCE_READER")
    strategies = candidate.get("strategies")
    if not isinstance(strategies, list):
        raise ValueError("strategies must be a list")

    top_gaps = candidate.get("top_level_source_gaps")
    if not strategies and (not isinstance(top_gaps, list) or not top_gaps):
        raise ValueError("strategies=[] requires a non-empty top_level_source_gaps explanation")

    normalized_transcript = norm_ws(transcript)
    quote_count = 0
    quote_failures: list[str] = []
    ids: list[str] = []

    instrument = candidate.get("instrument_classification")
    if instrument is not None:
        if not isinstance(instrument, dict):
            raise ValueError("instrument_classification must be an object or null")
        if any(instrument.get(k) not in (None, "") for k in ("asset_class", "instrument", "rationale")):
            quote_count += _require_literal_quote(
                instrument.get("transcript_quote"),
                ref="instrument_classification",
                normalized_transcript=normalized_transcript,
                failures=quote_failures,
            )

    for si, strategy in enumerate(strategies):
        if not isinstance(strategy, dict):
            raise ValueError(f"strategies[{si}] must be an object")
        expected_id = f"s{si}"
        sid = strategy.get("source_strategy_id")
        if sid != expected_id:
            raise ValueError(f"strategies[{si}].source_strategy_id must be {expected_id!r}, got {sid!r}")
        ids.append(sid)

        direction = strategy.get("direction")
        if direction not in ("long", "short", "both", "source_unresolved"):
            raise ValueError(f"{sid}: invalid direction {direction!r}")
        if direction != "source_unresolved":
            quote_count += _require_literal_quote(
                strategy.get("direction_transcript_quote"),
                ref=f"{sid}.direction",
                normalized_transcript=normalized_transcript,
                failures=quote_failures,
            )

        for field in ("higher_timeframe", "execution_timeframe"):
            value = strategy.get(field)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"{sid}: {field} must be a non-empty string or source_unresolved")
            if value != "source_unresolved":
                quote_count += _require_literal_quote(
                    strategy.get(f"{field}_transcript_quote"),
                    ref=f"{sid}.{field}",
                    normalized_transcript=normalized_transcript,
                    failures=quote_failures,
                )

        entry = strategy.get("entry_sequence")
        if not isinstance(entry, list) or not entry:
            raise ValueError(f"{sid}: entry_sequence must be a non-empty list for an executable strategy")
        for ei, step in enumerate(entry):
            if not isinstance(step, dict):
                raise ValueError(f"{sid}: entry_sequence[{ei}] must be an object")
            if step.get("step") != ei + 1:
                raise ValueError(f"{sid}: entry_sequence step numbers must be sequential from 1")
            if not str(step.get("action") or "").strip():
                raise ValueError(f"{sid}: entry_sequence[{ei}] has no action")
            if step.get("role") not in ("context", "spine", "trigger"):
                raise ValueError(f"{sid}: entry_sequence[{ei}] has invalid role {step.get('role')!r}")

        gaps = strategy.get("source_gaps")
        if gaps is not None and not isinstance(gaps, list):
            raise ValueError(f"{sid}: source_gaps must be a list")

        for ref, obj in _iter_quote_objects(strategy):
            quote_count += _require_literal_quote(
                obj.get("transcript_quote"),
                ref=f"{sid}.{ref}",
                normalized_transcript=normalized_transcript,
                failures=quote_failures,
            )

    if quote_failures:
        raise ValueError("literal evidence verification failed: " + "; ".join(quote_failures))
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate source_strategy_id")

    return {
        "strategy_count": len(strategies),
        "literal_quote_count": quote_count,
        "literal_quote_failures": 0,
        "identity_sequence": ids
    }


def validate_invocation_receipt(receipt: dict[str, Any], index: dict[str, Any]) -> None:
    checks = {
        "video_id": index["video_id"],
        "task_sha256": index["task_sha256"],
        "transcript_sha256": index["transcript_sha256"],
        "model_override": REQUIRED_MODEL_OVERRIDE,
        "subagent_type": "general-purpose",
        "reader_role": REQUIRED_READER_ROLE
    }
    for key, expected in checks.items():
        if receipt.get(key) != expected:
            raise ValueError(
                f"invocation receipt {key} mismatch: {receipt.get(key)!r} != {expected!r}"
            )
    if receipt.get("fresh_reader") is not True:
        raise ValueError("invocation receipt must attest fresh_reader=true")
    if receipt.get("prompt_source") != "task_file_only":
        raise ValueError("invocation receipt must attest prompt_source=task_file_only")
    if receipt.get("legacy_semantics_visible") is not False:
        raise ValueError("invocation receipt must attest legacy_semantics_visible=false")
    actual = receipt.get("actual_model_identity")
    if not isinstance(actual, str) or not actual.strip():
        raise ValueError("invocation receipt must record actual_model_identity or an explicit override-only note")


def cmd_ingest(args: argparse.Namespace) -> int:
    case = get_case(args.video_id)
    _, transcript = transcript_for(case)
    out_dir = _safe_out_root(args.out_dir) / args.video_id
    index = read_json(out_dir / "task_index.json")
    if index.get("video_id") != args.video_id:
        raise SystemExit("task index identity mismatch")
    if index.get("transcript_sha256") != sha256_text(transcript):
        raise SystemExit("current transcript hash differs from emitted task index")

    task_path = out_dir / "opus_source_reader_task.txt"
    task_text = task_path.read_text(encoding="utf-8")
    if sha256_text(task_text) != index.get("task_sha256"):
        raise SystemExit("task bytes changed after emit")

    raw_path = Path(args.raw)
    raw_text = raw_path.read_text(encoding="utf-8")
    receipt = read_json(Path(args.invocation_receipt))
    try:
        validate_invocation_receipt(receipt, index)
    except ValueError as e:
        raise SystemExit(str(e))

    try:
        candidate = json.loads(raw_text)
    except json.JSONDecodeError as e:
        raise SystemExit(f"raw Opus response is not strict JSON: {e}")

    try:
        validation = validate_candidate(candidate, transcript, args.video_id)
    except ValueError as e:
        raise SystemExit(str(e))

    candidate_text = json.dumps(candidate, indent=2, ensure_ascii=False) + "\n"
    raw_sha = sha256_text(raw_text)
    candidate_sha = sha256_text(candidate_text)
    write_text_lf(out_dir / "raw_opus_response.txt", raw_text)
    write_text_lf(out_dir / "fresh_source_candidate.json", candidate_text)

    frozen = {
        "artifact": "opus-transcript-first-candidate-receipt-v2",
        "status": STATUS_FRESH,
        "video_id": args.video_id,
        "diagnostic_category": case["category"],
        "reader_role": REQUIRED_READER_ROLE,
        "model_override": REQUIRED_MODEL_OVERRIDE,
        "actual_model_identity": receipt.get("actual_model_identity"),
        "invocation_declared": True,
        "invocation_independently_attested": False,
        "task_sha256": index["task_sha256"],
        "transcript_sha256": index["transcript_sha256"],
        "raw_response_sha256": raw_sha,
        "candidate_sha256": candidate_sha,
        "validation": validation,
        "legacy_semantics_visible": False,
        "factory_authority": False,
        "certification_required": True,
        "next_step": (
            "Independent grader attacks candidate against the same transcript. Do not compare to "
            "legacy extraction until that grade is frozen."
        )
    }
    write_json(out_dir / "candidate_receipt.json", frozen)
    print(json.dumps(frozen, indent=2))
    return 0


def _legacy_summary(record: dict[str, Any]) -> dict[str, Any]:
    extraction = record.get("extraction") or {}
    strategies = extraction.get("strategies") or []
    seed = record.get("seed_params") or {}
    return {
        "legacy_model": seed.get("model"),
        "legacy_strategy_count": len(strategies),
        "legacy_strategy_shapes": [
            {
                "index": i,
                "direction": s.get("direction"),
                "higher_timeframe": s.get("higher_timeframe"),
                "entry_steps": len(s.get("entry_sequence") or []),
                "confluences": len(s.get("confluences") or []),
                "has_stop": isinstance(s.get("stop"), dict),
                "targets": len(s.get("targets") or [])
            }
            for i, s in enumerate(strategies)
            if isinstance(s, dict)
        ]
    }


def cmd_compare(args: argparse.Namespace) -> int:
    case = get_case(args.video_id)
    out_dir = _safe_out_root(args.out_dir) / args.video_id
    receipt = read_json(out_dir / "candidate_receipt.json")
    if receipt.get("status") != STATUS_FRESH:
        raise SystemExit("fresh candidate is not hash-frozen; refusing legacy comparison")

    candidate_path = out_dir / "fresh_source_candidate.json"
    candidate_bytes = candidate_path.read_bytes()
    if sha256_bytes(candidate_bytes) != receipt.get("candidate_sha256"):
        raise SystemExit("fresh candidate changed after freeze")

    grade_path = Path(args.independent_grade)
    grade = read_json(grade_path)
    required_grade = {
        "video_id": args.video_id,
        "candidate_sha256": receipt["candidate_sha256"],
        "transcript_sha256": receipt["transcript_sha256"],
        "verdict": "PASS"
    }
    for key, expected in required_grade.items():
        if grade.get(key) != expected:
            raise SystemExit(
                f"independent grade {key} mismatch/refusal: {grade.get(key)!r} != {expected!r}"
            )
    if grade.get("grader") in (None, "", "gpt-author"):
        raise SystemExit("independent grade does not identify an independent grader")

    # FIRST legacy-semantic read in this process. It is intentionally below candidate freeze + grade.
    legacy_path = REPO_ROOT / case["legacy_extraction_path"]
    legacy = read_json(legacy_path)
    candidate = json.loads(candidate_bytes.decode("utf-8"))
    report = {
        "artifact": "legacy-vs-fresh-opus-comparison-v2",
        "video_id": args.video_id,
        "diagnostic_category": case["category"],
        "fresh_candidate_sha256": receipt["candidate_sha256"],
        "fresh_strategy_count": len(candidate.get("strategies") or []),
        "fresh_reader_role": candidate.get("reader_role"),
        "independent_grade": {
            "grader": grade.get("grader"),
            "grade_sha256": sha256_bytes(grade_path.read_bytes()),
            "verdict": grade.get("verdict")
        },
        "legacy": _legacy_summary(legacy),
        "legacy_opened_only_after_fresh_freeze_and_grade": True,
        "interpretation": (
            "MECHANICAL COMPARISON ONLY. Differences are evidence for follow-up, not proof that "
            "either strategy has edge or compile authority."
        )
    }
    write_json(out_dir / "legacy_vs_fresh_comparison.json", report)
    print(json.dumps(report, indent=2))
    return 0


def cmd_receipt_template(args: argparse.Namespace) -> int:
    case = get_case(args.video_id)
    out_dir = _safe_out_root(args.out_dir) / args.video_id
    index = read_json(out_dir / "task_index.json")
    template = {
        "video_id": args.video_id,
        "task_sha256": index["task_sha256"],
        "transcript_sha256": index["transcript_sha256"],
        "model_override": REQUIRED_MODEL_OVERRIDE,
        "actual_model_identity": "record exact runtime identity if surfaced; otherwise state override=opus",
        "subagent_type": "general-purpose",
        "reader_role": REQUIRED_READER_ROLE,
        "fresh_reader": True,
        "prompt_source": "task_file_only",
        "legacy_semantics_visible": False,
        "invocation_notes": "ONE fresh Opus reader; given only emitted task text."
    }
    path = out_dir / "invocation_receipt.template.json"
    write_json(path, template)
    print(json.dumps({"status": "TEMPLATE_WRITTEN", "path": str(path), "category": case["category"]}, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    p.add_argument("--out-dir", default=str(DEFAULT_OUT))
    sub = p.add_subparsers(dest="command", required=True)
    for name in ("emit", "receipt-template"):
        sp = sub.add_parser(name)
        sp.add_argument("--video-id", required=True)
    sp = sub.add_parser("ingest")
    sp.add_argument("--video-id", required=True)
    sp.add_argument("--raw", required=True)
    sp.add_argument("--invocation-receipt", required=True)
    sp = sub.add_parser("compare")
    sp.add_argument("--video-id", required=True)
    sp.add_argument("--independent-grade", required=True)
    return p


def main() -> int:
    args = build_parser().parse_args()
    if args.command == "emit":
        return cmd_emit(args)
    if args.command == "receipt-template":
        return cmd_receipt_template(args)
    if args.command == "ingest":
        return cmd_ingest(args)
    if args.command == "compare":
        return cmd_compare(args)
    raise AssertionError(args.command)


if __name__ == "__main__":
    raise SystemExit(main())
