#!/usr/bin/env python3
"""Bound independent-grade gate for the Opus transcript-first diagnostic.

This replaces the diagnostic harness's original free-form ``compare --independent-grade``
trust boundary.  It does NOT attempt to infer independent execution from a self-declared
``grader`` string.  Instead it binds a fresh accuracy-validator task to the candidate and
transcript, then requires a *real consumed isolated-grader permit* written by the existing
Claude guard for the exact Agent request before it will freeze the grade or open legacy
semantics.

The consumed permit is a control-plane witness, not a claim supplied by the grade JSON:
- it must exist under the repository common-git-dir ``tf-isolated-grader-permits`` directory;
- it must be the one-use CONSUMED form;
- its schema/role/isolation/toolbox identity must match the live guard manifest;
- its parent HEAD must equal the HEAD frozen when this grade task was emitted;
- its ``agent_request_sha256`` must equal the canonical hash of the exact Agent request
  emitted by this script;
- exactly one matching consumed permit must exist.

The grade response is still model output and therefore not cryptographically signed by Claude.
The honest claim this tool makes is narrower: an isolated accuracy-validator seat was actually
permitted and activated for the exact bound grade request, and the supplied response is hash-frozen
against that request.  Independent review remains required before Factory authority.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import secrets
import subprocess
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
HARNESS_PATH = REPO_ROOT / "scripts/strategy_factory_opus_transcript_first_diagnostic.py"
MANIFEST_PATH = REPO_ROOT / ".claude/worker1-hook-guard-manifest.json"
DEFAULT_OUT = REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/runs"
GRADE_ROLE = "accuracy-validator"
GRADE_ISOLATION = "worktree"
GRADE_TASK_SCHEMA = "opus-transcript-first-independent-grade-task-v1"
GRADE_RESPONSE_SCHEMA = "opus-transcript-first-source-fidelity-grade-v1"
GRADE_RECEIPT_SCHEMA = "opus-transcript-first-bound-independent-grade-receipt-v1"
COMPARE_SCHEMA = "legacy-vs-fresh-opus-comparison-v3-bound-grade"
PERMIT_SCHEMA = "tf-isolated-grader-permit-v1"


def _load_harness():
    spec = importlib.util.spec_from_file_location("opus_diag", HARNESS_PATH)
    if spec is None or spec.loader is None:
        raise SystemExit("cannot import transcript-first diagnostic harness")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


H = _load_harness()


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


def git(*args: str) -> str:
    try:
        return subprocess.check_output(
            ["git", *args], cwd=REPO_ROOT, text=True, stderr=subprocess.PIPE
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        raise SystemExit(f"git command failed: {' '.join(args)}: {e}")


def current_head() -> str:
    head = git("rev-parse", "HEAD")
    if len(head) != 40:
        raise SystemExit("could not resolve full current HEAD")
    return head


def common_git_dir() -> Path:
    raw = git("rev-parse", "--git-common-dir")
    p = Path(raw)
    if not p.is_absolute():
        p = REPO_ROOT / p
    return p.resolve()


def manifest_identity() -> tuple[str, str]:
    manifest = read_json(MANIFEST_PATH)
    pin = manifest.get("_toolbox_pin")
    bundle = manifest.get("_toolbox_bundle_sha256")
    if not isinstance(pin, str) or not pin.strip():
        raise SystemExit("live guard manifest has no toolbox pin")
    if not isinstance(bundle, str) or len(bundle) != 64:
        raise SystemExit("live guard manifest has no valid toolbox bundle SHA256")
    return pin, bundle


def canonical_agent_request(request: dict[str, Any]) -> str:
    # Exact field order/normalization mirrors isolated-grader-seat.mjs::canonicalAgentRequest.
    def s(name: str):
        value = request.get(name)
        return value if isinstance(value, str) else None

    return json.dumps(
        {
            "description": s("description"),
            "prompt": s("prompt"),
            "subagent_type": s("subagent_type"),
            "model": s("model"),
            "isolation": s("isolation"),
        },
        separators=(",", ":"),
        ensure_ascii=False,
    )


def request_sha256(request: dict[str, Any]) -> str:
    return sha256_text(canonical_agent_request(request))


def _out_dir(raw: str, video_id: str) -> Path:
    return H._safe_out_root(raw) / video_id


def _load_frozen_candidate(video_id: str, out_dir: Path) -> tuple[dict[str, Any], bytes]:
    receipt_path = out_dir / "candidate_receipt.json"
    candidate_path = out_dir / "fresh_source_candidate.json"
    if not receipt_path.is_file() or not candidate_path.is_file():
        raise SystemExit("fresh candidate/receipt missing; run transcript-first ingest first")
    receipt = read_json(receipt_path)
    if receipt.get("status") != H.STATUS_FRESH or receipt.get("video_id") != video_id:
        raise SystemExit("fresh candidate receipt identity/status mismatch")
    candidate_bytes = candidate_path.read_bytes()
    if sha256_bytes(candidate_bytes) != receipt.get("candidate_sha256"):
        raise SystemExit("fresh candidate changed after hash freeze")
    return receipt, candidate_bytes


def _grade_prompt(video_id: str, candidate_sha: str, transcript_sha: str, nonce: str,
                  transcript: str, candidate_text: str) -> str:
    return f"""You are the independent accuracy-validator for a Trading Forge source-fidelity diagnostic.

ROLE LAW
- Attack the fresh source reconstruction; do not defend it.
- Grade ONLY against the original transcript below.
- You are not shown and must not seek any legacy Gemma extraction before verdict.
- PASS only if every load-bearing reconstructed rule is supported by the transcript and no taught executable strategy/rule is materially omitted, merged, invented, or assigned to the wrong strategy.
- Literal quotes already passed a mechanical substring check; your job is semantic relevance/fidelity, strategy identity, omission, and executable meaning.
- Return strict JSON only.

BOUND IDENTITY
video_id: {video_id}
candidate_sha256: {candidate_sha}
transcript_sha256: {transcript_sha}
grade_nonce: {nonce}

REQUIRED OUTPUT
{{
  "schema": "{GRADE_RESPONSE_SCHEMA}",
  "video_id": "{video_id}",
  "candidate_sha256": "{candidate_sha}",
  "transcript_sha256": "{transcript_sha}",
  "grade_nonce": "{nonce}",
  "verdict": "PASS|FAIL",
  "findings": [
    {{"severity": "CRITICAL|HIGH|MEDIUM|LOW|INFO", "ref": "<candidate field or source omission>", "finding": "<precise source-fidelity attack>", "transcript_quote": "<literal support when applicable>"}}
  ],
  "strategy_count_assessment": "<brief source-grounded assessment>",
  "independence_statement": "I graded the fresh candidate only against the supplied original transcript before any legacy comparison."
}}

ORIGINAL TRANSCRIPT — SOURCE AUTHORITY
<<<TRANSCRIPT_START>>>
{transcript}
<<<TRANSCRIPT_END>>>

FRESH SOURCE CANDIDATE — OBJECT UNDER ATTACK
<<<CANDIDATE_START>>>
{candidate_text}
<<<CANDIDATE_END>>>
"""


def cmd_emit_grade(args: argparse.Namespace) -> int:
    case = H.get_case(args.video_id)
    _, transcript = H.transcript_for(case)
    out_dir = _out_dir(args.out_dir, args.video_id)
    receipt, candidate_bytes = _load_frozen_candidate(args.video_id, out_dir)
    transcript_sha = sha256_text(transcript)
    if transcript_sha != receipt.get("transcript_sha256"):
        raise SystemExit("current transcript differs from candidate receipt")

    nonce = secrets.token_hex(32)
    candidate_text = candidate_bytes.decode("utf-8")
    task_prompt = _grade_prompt(
        args.video_id, receipt["candidate_sha256"], transcript_sha, nonce, transcript, candidate_text
    )
    request = {
        "description": f"independent source-fidelity grade {args.video_id}",
        "prompt": task_prompt,
        "subagent_type": GRADE_ROLE,
        "model": None,
        "isolation": GRADE_ISOLATION,
    }
    req_sha = request_sha256(request)
    head = current_head()
    pin, bundle = manifest_identity()
    task = {
        "schema": GRADE_TASK_SCHEMA,
        "status": "AWAITING_ISOLATED_ACCURACY_VALIDATOR",
        "video_id": args.video_id,
        "candidate_sha256": receipt["candidate_sha256"],
        "transcript_sha256": transcript_sha,
        "grade_nonce": nonce,
        "parent_head_sha": head,
        "toolbox_pin": pin,
        "toolbox_bundle_sha256": bundle,
        "agent_request_sha256": req_sha,
        "agent_request": request,
        "legacy_semantics_visible": False,
        "next_step": (
            "Dispatch Agent using EXACT agent_request fields. Do not commit/advance/reset parent HEAD "
            "between this emit and dispatch. After the Agent returns, save its raw final text and run ingest-grade."
        ),
    }
    write_json(out_dir / "independent_grade_task.json", task)
    print(json.dumps(task, indent=2))
    return 0


def _permit_dir() -> Path:
    return common_git_dir() / "tf-isolated-grader-permits"


def _matching_consumed_permits(task: dict[str, Any]) -> list[tuple[Path, bytes, dict[str, Any]]]:
    root = _permit_dir()
    if not root.is_dir():
        return []
    matches: list[tuple[Path, bytes, dict[str, Any]]] = []
    for path in root.glob("*.consumed-*.json"):
        try:
            raw = path.read_bytes()
            permit = json.loads(raw.decode("utf-8"))
        except Exception:
            continue
        if (
            permit.get("schema") == PERMIT_SCHEMA
            and permit.get("agent_request_sha256") == task.get("agent_request_sha256")
            and permit.get("parent_head") == task.get("parent_head_sha")
            and permit.get("subagent_type") == GRADE_ROLE
            and permit.get("isolation") == GRADE_ISOLATION
            and permit.get("toolbox_pin") == task.get("toolbox_pin")
            and permit.get("toolbox_bundle_sha256") == task.get("toolbox_bundle_sha256")
        ):
            matches.append((path.resolve(), raw, permit))
    return matches


def _validate_grade_response(grade: dict[str, Any], task: dict[str, Any]) -> None:
    required = {
        "schema": GRADE_RESPONSE_SCHEMA,
        "video_id": task["video_id"],
        "candidate_sha256": task["candidate_sha256"],
        "transcript_sha256": task["transcript_sha256"],
        "grade_nonce": task["grade_nonce"],
    }
    for key, expected in required.items():
        if grade.get(key) != expected:
            raise SystemExit(f"grade response {key} mismatch: {grade.get(key)!r} != {expected!r}")
    if grade.get("verdict") not in ("PASS", "FAIL"):
        raise SystemExit("grade response verdict must be PASS or FAIL")
    if not isinstance(grade.get("findings"), list):
        raise SystemExit("grade response findings must be a list")
    expected_statement = (
        "I graded the fresh candidate only against the supplied original transcript before any legacy comparison."
    )
    if grade.get("independence_statement") != expected_statement:
        raise SystemExit("grade response independence statement missing/mismatched")


def _verify_task_live(task: dict[str, Any], video_id: str, out_dir: Path) -> tuple[dict[str, Any], bytes]:
    if task.get("schema") != GRADE_TASK_SCHEMA or task.get("video_id") != video_id:
        raise SystemExit("grade task identity/schema mismatch")
    receipt, candidate_bytes = _load_frozen_candidate(video_id, out_dir)
    case = H.get_case(video_id)
    _, transcript = H.transcript_for(case)
    if receipt.get("candidate_sha256") != task.get("candidate_sha256"):
        raise SystemExit("candidate receipt changed since grade task emission")
    if sha256_text(transcript) != task.get("transcript_sha256"):
        raise SystemExit("transcript changed since grade task emission")
    if request_sha256(task.get("agent_request") or {}) != task.get("agent_request_sha256"):
        raise SystemExit("grade Agent request bytes/fields changed after emission")
    request = task.get("agent_request") or {}
    if request.get("subagent_type") != GRADE_ROLE or request.get("isolation") != GRADE_ISOLATION:
        raise SystemExit("grade Agent request no longer targets isolated accuracy-validator")
    pin, bundle = manifest_identity()
    if task.get("toolbox_pin") != pin or task.get("toolbox_bundle_sha256") != bundle:
        raise SystemExit("live toolbox identity changed since grade task emission")
    return receipt, candidate_bytes


def cmd_ingest_grade(args: argparse.Namespace) -> int:
    out_dir = _out_dir(args.out_dir, args.video_id)
    task_path = out_dir / "independent_grade_task.json"
    task = read_json(task_path)
    _verify_task_live(task, args.video_id, out_dir)

    # Parent branch must not have moved between task emission and guarded Agent dispatch/ingest.
    if current_head() != task.get("parent_head_sha"):
        raise SystemExit("parent HEAD changed since grade task emission; refuse ambiguous grader binding")

    raw_path = Path(args.raw_grade)
    raw_grade = raw_path.read_bytes()
    try:
        grade = json.loads(raw_grade.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise SystemExit(f"raw grade response is not strict UTF-8 JSON: {e}")
    if not isinstance(grade, dict):
        raise SystemExit("raw grade response must be a JSON object")
    _validate_grade_response(grade, task)

    matches = _matching_consumed_permits(task)
    if len(matches) != 1:
        raise SystemExit(
            f"expected exactly one consumed isolated-grader permit for exact Agent request; found {len(matches)}"
        )
    permit_path, permit_raw, permit = matches[0]
    # A consumed permit path is under common .git state, written by the guard on one-use activation.
    expected_root = _permit_dir().resolve()
    try:
        permit_path.relative_to(expected_root)
    except ValueError:
        raise SystemExit("consumed permit resolved outside guard permit directory")

    raw_grade_sha = sha256_bytes(raw_grade)
    grade_text = json.dumps(grade, indent=2, ensure_ascii=False) + "\n"
    grade_sha = sha256_text(grade_text)
    write_text_lf(out_dir / "raw_accuracy_validator_response.txt", raw_grade.decode("utf-8"))
    write_text_lf(out_dir / "independent_source_fidelity_grade.json", grade_text)

    frozen = {
        "schema": GRADE_RECEIPT_SCHEMA,
        "status": "BOUND_INDEPENDENT_GRADE_PASS" if grade["verdict"] == "PASS" else "BOUND_INDEPENDENT_GRADE_FAIL",
        "video_id": args.video_id,
        "candidate_sha256": task["candidate_sha256"],
        "transcript_sha256": task["transcript_sha256"],
        "grade_nonce": task["grade_nonce"],
        "grade_task_sha256": sha256_bytes(task_path.read_bytes()),
        "agent_request_sha256": task["agent_request_sha256"],
        "parent_head_sha": task["parent_head_sha"],
        "grader_role": GRADE_ROLE,
        "grader_isolation": GRADE_ISOLATION,
        "toolbox_pin": task["toolbox_pin"],
        "toolbox_bundle_sha256": task["toolbox_bundle_sha256"],
        "consumed_permit_path": os.path.relpath(permit_path, common_git_dir()).replace(os.sep, "/"),
        "consumed_permit_sha256": sha256_bytes(permit_raw),
        "consumed_permit_token_sha256": permit.get("token_sha256"),
        "consumed_permit_tool_use_id": permit.get("tool_use_id"),
        "raw_grade_response_sha256": raw_grade_sha,
        "canonical_grade_sha256": grade_sha,
        "verdict": grade["verdict"],
        "control_plane_evidence": (
            "Existing guard consumed a one-use permit for the exact bound accuracy-validator Agent request. "
            "This is operational execution evidence, not a cryptographic signature over the model's final text."
        ),
        "factory_authority": False,
    }
    write_json(out_dir / "independent_grade_receipt.json", frozen)
    print(json.dumps(frozen, indent=2))
    return 0


def _verify_bound_grade(video_id: str, out_dir: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    task_path = out_dir / "independent_grade_task.json"
    receipt_path = out_dir / "independent_grade_receipt.json"
    grade_path = out_dir / "independent_source_fidelity_grade.json"
    raw_grade_path = out_dir / "raw_accuracy_validator_response.txt"
    for p in (task_path, receipt_path, grade_path, raw_grade_path):
        if not p.is_file():
            raise SystemExit(f"missing bound-grade artifact: {p.name}")

    task = read_json(task_path)
    candidate_receipt, _ = _verify_task_live(task, video_id, out_dir)
    receipt = read_json(receipt_path)
    grade = read_json(grade_path)

    if receipt.get("schema") != GRADE_RECEIPT_SCHEMA or receipt.get("video_id") != video_id:
        raise SystemExit("independent grade receipt schema/identity mismatch")
    if receipt.get("status") != "BOUND_INDEPENDENT_GRADE_PASS" or receipt.get("verdict") != "PASS":
        raise SystemExit("independent source-fidelity grade is not bound PASS")
    for key in (
        "candidate_sha256", "transcript_sha256", "grade_nonce", "agent_request_sha256",
        "parent_head_sha", "toolbox_pin", "toolbox_bundle_sha256"
    ):
        if receipt.get(key) != task.get(key):
            raise SystemExit(f"independent grade receipt {key} drifted from grade task")
    if receipt.get("candidate_sha256") != candidate_receipt.get("candidate_sha256"):
        raise SystemExit("bound grade no longer matches fresh candidate")
    if receipt.get("grade_task_sha256") != sha256_bytes(task_path.read_bytes()):
        raise SystemExit("grade task changed after grade freeze")
    if receipt.get("raw_grade_response_sha256") != sha256_bytes(raw_grade_path.read_bytes()):
        raise SystemExit("raw grade response changed after grade freeze")
    canonical_grade = json.dumps(grade, indent=2, ensure_ascii=False) + "\n"
    if receipt.get("canonical_grade_sha256") != sha256_text(canonical_grade):
        raise SystemExit("canonical grade changed after grade freeze")
    _validate_grade_response(grade, task)

    permit_rel = receipt.get("consumed_permit_path")
    if not isinstance(permit_rel, str) or not permit_rel:
        raise SystemExit("bound grade receipt has no consumed permit path")
    permit_path = (common_git_dir() / permit_rel).resolve()
    permit_root = _permit_dir().resolve()
    try:
        permit_path.relative_to(permit_root)
    except ValueError:
        raise SystemExit("bound grade permit path escaped guard permit directory")
    if not permit_path.is_file():
        raise SystemExit("consumed isolated-grader permit witness disappeared")
    permit_raw = permit_path.read_bytes()
    if sha256_bytes(permit_raw) != receipt.get("consumed_permit_sha256"):
        raise SystemExit("consumed isolated-grader permit witness changed")
    permit = json.loads(permit_raw.decode("utf-8"))
    if (
        permit.get("schema") != PERMIT_SCHEMA
        or permit.get("agent_request_sha256") != task.get("agent_request_sha256")
        or permit.get("parent_head") != task.get("parent_head_sha")
        or permit.get("subagent_type") != GRADE_ROLE
        or permit.get("isolation") != GRADE_ISOLATION
        or permit.get("toolbox_pin") != task.get("toolbox_pin")
        or permit.get("toolbox_bundle_sha256") != task.get("toolbox_bundle_sha256")
        or permit.get("token_sha256") != receipt.get("consumed_permit_token_sha256")
    ):
        raise SystemExit("consumed isolated-grader permit no longer verifies against bound grade task")
    return receipt, grade


def cmd_compare(args: argparse.Namespace) -> int:
    case = H.get_case(args.video_id)
    out_dir = _out_dir(args.out_dir, args.video_id)
    candidate_receipt, candidate_bytes = _load_frozen_candidate(args.video_id, out_dir)
    grade_receipt, grade = _verify_bound_grade(args.video_id, out_dir)

    # FIRST legacy-semantic read in this program. Everything above is source/candidate/guard evidence only.
    legacy_path = REPO_ROOT / case["legacy_extraction_path"]
    legacy = read_json(legacy_path)
    candidate = json.loads(candidate_bytes.decode("utf-8"))
    report = {
        "artifact": COMPARE_SCHEMA,
        "video_id": args.video_id,
        "diagnostic_category": case["category"],
        "fresh_candidate_sha256": candidate_receipt["candidate_sha256"],
        "fresh_strategy_count": len(candidate.get("strategies") or []),
        "fresh_reader_role": candidate.get("reader_role"),
        "independent_grade": {
            "grader_role": grade_receipt["grader_role"],
            "isolation": grade_receipt["grader_isolation"],
            "verdict": grade["verdict"],
            "canonical_grade_sha256": grade_receipt["canonical_grade_sha256"],
            "agent_request_sha256": grade_receipt["agent_request_sha256"],
            "consumed_permit_sha256": grade_receipt["consumed_permit_sha256"],
        },
        "legacy": H._legacy_summary(legacy),
        "legacy_opened_only_after_fresh_freeze_and_bound_independent_grade": True,
        "interpretation": (
            "MECHANICAL COMPARISON ONLY. Differences are evidence for follow-up, not proof that "
            "either strategy has edge or compile authority."
        ),
        "factory_authority": False,
    }
    write_json(out_dir / "legacy_vs_fresh_comparison.json", report)
    print(json.dumps(report, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    p.add_argument("--out-dir", default=str(DEFAULT_OUT))
    sub = p.add_subparsers(dest="command", required=True)

    sp = sub.add_parser("emit-grade")
    sp.add_argument("--video-id", required=True)

    sp = sub.add_parser("ingest-grade")
    sp.add_argument("--video-id", required=True)
    sp.add_argument("--raw-grade", required=True)

    sp = sub.add_parser("compare")
    sp.add_argument("--video-id", required=True)
    return p


def main() -> int:
    args = build_parser().parse_args()
    if args.command == "emit-grade":
        return cmd_emit_grade(args)
    if args.command == "ingest-grade":
        return cmd_ingest_grade(args)
    if args.command == "compare":
        return cmd_compare(args)
    raise AssertionError(args.command)


if __name__ == "__main__":
    raise SystemExit(main())
