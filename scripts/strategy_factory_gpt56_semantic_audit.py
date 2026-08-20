#!/usr/bin/env python3
"""GPT-5.6 Sol semantic-audit harness for transcript-first Strategy Factory candidates.

GPT-authored engineering candidate. This tool does NOT certify its own semantic output.
It binds a frozen Opus candidate to the original transcript, enumerates every transcript-
quote-bearing claim that requires semantic entailment review, emits a GPT-5.6 Sol task, and
fail-closes audit ingest on incomplete coverage / strategy-identity / cross-field failures.

A successful ingest is still NOT Factory authority. It is stamped:
  GPT56_SEMANTIC_AUDIT_PASS_NOT_INDEPENDENTLY_CERTIFIED
and requires an independent Claude/accuracy-validator challenge before certifier/compiler use.

AR-1378A REPAIR (2026-08-20): prior SHA 8acb6b0fc63e0b38595a9e64c2f61a77885e9f9b listed the six
REQUIRED_CROSS_CHECKS names in the rendered prompt without ever supplying their governing
authoring-law contract. That omission let the auditor invent a stricter taxonomy than the reader
(Opus) was told to obey, producing two proven-false HIGH findings (E8Wg6tFPYjo, 1HFoStW_wsc) that
GPT itself struck on independent Claude challenge (AR-1383/AR-1384 -> AR-1378A). This revision adds
ROLE_ASSIGNMENT_CONTRACT, bound into every rendered prompt, so role_assignment / stop / targets /
variants / trigger_vs_source_gaps / directional_symmetry are graded against the SAME written law
the candidate was authored under. No change to TASK_SCHEMA / RESPONSE_SCHEMA / RECEIPT_SCHEMA, the
claim-enumeration algorithm, or the ingest validation logic -- this is a prompt-completeness fix
only, exactly as AR-1378A SS6 scopes it.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import secrets
from pathlib import Path
from typing import Any

AUDITOR_ROLE = "GPT_5_6_SOL_SEMANTIC_AUDITOR"
MODEL_IDENTITY = "GPT-5.6 Sol"
TASK_SCHEMA = "tf-gpt56-semantic-audit-task-v1"
RESPONSE_SCHEMA = "tf-gpt56-semantic-audit-response-v1"
RECEIPT_SCHEMA = "tf-gpt56-semantic-audit-receipt-v1"
PASS_STATUS = "GPT56_SEMANTIC_AUDIT_PASS_NOT_INDEPENDENTLY_CERTIFIED"
FAIL_STATUS = "GPT56_SEMANTIC_AUDIT_FAIL"

IDENTITY_CLASSES = {
    "independent_strategy",
    "variant_of_other_strategy",
    "filter_or_qualifier",
    "context_only",
    "non_executable_teaching",
    "uncertain",
}
ENTAILMENT = {"ENTAILED", "PARTIAL", "NOT_ENTAILED", "UNCERTAIN"}
CHECK_STATUS = {"PASS", "FAIL", "UNRESOLVED"}
REQUIRED_CROSS_CHECKS = (
    "trigger_vs_source_gaps",
    "strategy_evidence_disjointness",
    "target_definition_conflicts",
    "audience_attribution",
    "role_assignment",
    "directional_symmetry",
)

# AR-1378A SS6 -- the exact authoring-law contract that MUST bind role_assignment and its sibling
# cross-field checks. Every point below is quoted/paraphrased from the ruling's numbered list so
# the auditor is graded against the reader's real law, not an invented taxonomy. Kept as a single
# constant so a proof can assert its presence in the rendered prompt (positive control) and so it
# can never silently diverge between two call sites.
ROLE_ASSIGNMENT_CONTRACT = """AUTHORING CONTRACT -- BIND role_assignment AND ITS SIBLING CROSS-FIELD CHECKS TO THIS LAW
(AR-1378A SS6: the reader's own frozen authoring law governs these checks. You may not invent a
stricter or different taxonomy than what follows, and you may not excuse a real violation by
misreading rule 1 as a blanket exemption.)

1. setup[] accepts source-grounded rule OR context, and MAY legally contain non-executable
   education, tooling, visualization-only steps, platform/execution-venue logistics,
   demo/backtest practice advice, or generic trading philosophy -- PROVIDED it is clearly framed
   as non-executable (e.g. typed/described as context, not as an executable rule). This is NOT a
   role_assignment violation.
2. setup[] is the ONLY legal home for that non-executable material. The five containers most
   commonly misused for it are entry_sequence, stop, targets, management, variants -- but this is
   NOT a closed list: the same material is a role_assignment violation in ANY container other
   than setup[], named here or not, including an invented or non-standard container name.
3. targets[] must contain actual source-taught target destinations/rules. Generic risk:reward
   commentary or general trading philosophy placed in targets[] is a role_assignment violation,
   not a target.
4. stop must describe the actual taught stop placement. A distinct invalidation boundary silently
   substituted for the stop is a role_assignment violation -- check whether the source itself
   distinguishes "invalidation" from "stop" before accepting one as the other.
5. variants[] records source-grounded alternatives ("what differs"). Do NOT require that every
   variant independently contain a complete entry+stop+target strategy unless a stronger written
   authority explicitly says so -- absence of that completeness is not itself a role_assignment
   violation, UNLESS such a stronger written authority exists, in which case it governs instead.
6. trigger_vs_source_gaps must distinguish candidate CONTRADICTION/INVENTION (= FAIL) from an
   HONESTLY DISCLOSED unresolved source fact (= unresolved execution authority). Honest disclosure
   of a gap is never itself a fabrication finding -- but it is never permission to invent the
   missing rule either. An honestly disclosed gap must stay disclosed as a gap, not be silently
   resolved by the candidate and then credited as if it were still honest.
7. directional_symmetry must distinguish a broad bidirectional bias/framing statement from a
   fully specified, deterministic MIRRORED executable trigger. When the candidate discloses that
   only one side has a complete trigger, that is a source-completeness finding, not semantic
   fabrication -- do not fail role_assignment or invent the missing mirror yourself.
8. The atomic quote law is UNCHANGED and stays strict: each claim's own attached transcript_quote
   must fully entail the ENTIRE attached claim. A true fact found ELSEWHERE in the transcript does
   not rescue an under-bound claim -- that claim remains PARTIAL or NOT_ENTAILED regardless of
   what else the transcript says.

Do not defend a candidate that violates rules 2-4 by citing rule 1. Do not manufacture a
role_assignment / directional_symmetry / trigger_vs_source_gaps finding under rules 1, 5, 6 or 7
when the candidate is doing exactly what this contract permits."""


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_text(text: str) -> str:
    return sha256_bytes(text.encode("utf-8"))


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def write_json(path: Path, obj: Any) -> None:
    write_text(path, json.dumps(obj, indent=2, ensure_ascii=False) + "\n")


def transcript_contains(transcript: str, quote: str) -> bool:
    return isinstance(quote, str) and quote != "" and quote in transcript


def _claim_text_for_dict(obj: dict[str, Any]) -> str:
    preferred = (
        "action", "rule", "description", "anchor", "type", "rationale", "name",
        "direction", "higher_timeframe", "execution_timeframe",
    )
    parts: list[str] = []
    for key in preferred:
        value = obj.get(key)
        if isinstance(value, (str, int, float)) and str(value).strip():
            parts.append(f"{key}={value}")
    return " | ".join(parts) if parts else canonical_json({k: v for k, v in obj.items() if k != "transcript_quote"})


def _claim_text_for_field(field_name: str, value: Any) -> str:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return f"{field_name}={value}"
    return f"{field_name}={canonical_json(value)}"


def enumerate_claims(candidate: dict[str, Any]) -> list[dict[str, Any]]:
    """Enumerate every source-quote-bearing semantic claim obligation.

    Two candidate evidence shapes are supported and both are load-bearing:
    1. an object with a bare ``transcript_quote`` describing that object; and
    2. sibling ``<field>_transcript_quote`` evidence attached to ``<field>`` in the same object.

    Presence of a literal quote is already a mechanical property. This inventory makes semantic
    coverage explicit so an auditor cannot silently skip an awkward claim while returning PASS.
    """
    claims: list[dict[str, Any]] = []

    def walk(node: Any, path: str) -> None:
        if isinstance(node, dict):
            q = node.get("transcript_quote")
            if q is not None and (not isinstance(q, str) or not q):
                raise SystemExit(f"candidate claim {path or '$'} transcript_quote must be null or non-empty string")
            if isinstance(q, str) and q:
                claims.append({
                    "claim_ref": path or "$",
                    "claim": _claim_text_for_dict(node),
                    "transcript_quote": q,
                })

            for key, value in node.items():
                if key == "transcript_quote":
                    continue
                if key.endswith("_transcript_quote"):
                    if value is None:
                        continue
                    if not isinstance(value, str) or not value:
                        raise SystemExit(
                            f"candidate quote field {key} at {path or '$'} must be null or non-empty string"
                        )
                    stem = key[:-len("_transcript_quote")]
                    if not stem or stem not in node:
                        raise SystemExit(
                            f"candidate quote field {key} at {path or '$'} has no sibling claim field {stem!r}"
                        )
                    claim_ref = f"{path}.{stem}" if path else stem
                    claims.append({
                        "claim_ref": claim_ref,
                        "claim": _claim_text_for_field(stem, node[stem]),
                        "transcript_quote": value,
                    })
                    continue
                child = f"{path}.{key}" if path else key
                walk(value, child)
        elif isinstance(node, list):
            for i, value in enumerate(node):
                walk(value, f"{path}[{i}]")

    walk(candidate, "")
    refs = [c["claim_ref"] for c in claims]
    if len(refs) != len(set(refs)):
        raise SystemExit("candidate claim inventory contains duplicate refs")
    return claims


def strategy_ids(candidate: dict[str, Any]) -> list[str]:
    strategies = candidate.get("strategies")
    if not isinstance(strategies, list) or not strategies:
        raise SystemExit("candidate has no strategies[]")
    out: list[str] = []
    for i, strategy in enumerate(strategies):
        if not isinstance(strategy, dict):
            raise SystemExit(f"strategies[{i}] is not an object")
        sid = strategy.get("source_strategy_id")
        if not isinstance(sid, str) or not sid:
            raise SystemExit(f"strategies[{i}] missing source_strategy_id")
        out.append(sid)
    if len(out) != len(set(out)):
        raise SystemExit("candidate has duplicate source_strategy_id values")
    return out


def build_task(video_id: str, transcript: str, candidate: dict[str, Any], candidate_raw: bytes) -> dict[str, Any]:
    if candidate.get("video_id") != video_id:
        raise SystemExit("candidate video_id mismatch")
    if candidate.get("reader_role") != "OPUS_LEAD_SOURCE_READER":
        raise SystemExit("candidate is not a fresh Opus lead-source-reader artifact")
    claims = enumerate_claims(candidate)
    sids = strategy_ids(candidate)
    transcript_sha = sha256_text(transcript)
    candidate_sha = sha256_bytes(candidate_raw)
    nonce = secrets.token_hex(32)
    task_core = {
        "schema": TASK_SCHEMA,
        "video_id": video_id,
        "candidate_sha256": candidate_sha,
        "transcript_sha256": transcript_sha,
        "audit_nonce": nonce,
        "auditor_role": AUDITOR_ROLE,
        "required_model_identity": MODEL_IDENTITY,
        "legacy_semantics_visible": False,
        "strategy_ids": sids,
        "required_claims": claims,
        "required_cross_field_checks": list(REQUIRED_CROSS_CHECKS),
    }
    task_core["task_sha256"] = sha256_text(canonical_json(task_core))
    return task_core


def render_prompt(task: dict[str, Any], transcript: str, candidate_text: str) -> str:
    claim_lines = "\n".join(
        f"- {c['claim_ref']}: {c['claim']}\n  QUOTE: {c['transcript_quote']}"
        for c in task["required_claims"]
    )
    return f"""You are GPT-5.6 Sol acting as Trading Forge's independent semantic auditor.

AUTHORITY LAW
- Original transcript is the source authority.
- Opus authored the candidate. Do not defend Opus.
- Legacy/Gemma semantics are forbidden and have NOT been supplied. Do not seek them.
- Literal substring presence is already checked. Your job is semantic entailment, strategy identity,
  role assignment, omitted conflicts, source-gap consistency, and audience/directional meaning.
- Return strict JSON only. Do not repair the candidate. Grade what is frozen.

BOUND IDENTITY
video_id: {task['video_id']}
candidate_sha256: {task['candidate_sha256']}
transcript_sha256: {task['transcript_sha256']}
task_sha256: {task['task_sha256']}
audit_nonce: {task['audit_nonce']}
role: {AUDITOR_ROLE}
model_identity: {MODEL_IDENTITY}

STRATEGY IDENTITY
For every source_strategy_id, classify exactly one:
independent_strategy | variant_of_other_strategy | filter_or_qualifier | context_only |
non_executable_teaching | uncertain.
A whole-candidate PASS requires every proposed top-level strategy to be a real independent strategy.

CLAIM ENTAILMENT COVERAGE
You MUST return exactly one audit row for every claim_ref below. Verdict per row:
ENTAILED | PARTIAL | NOT_ENTAILED | UNCERTAIN.
A literal quote can still be NOT_ENTAILED if it does not mean what the attached claim says.

{claim_lines}

{ROLE_ASSIGNMENT_CONTRACT}

CROSS-FIELD CHECKS
Return exactly one PASS|FAIL|UNRESOLVED row for each of: {', '.join(REQUIRED_CROSS_CHECKS)}
role_assignment, trigger_vs_source_gaps, and directional_symmetry are graded against the authoring
contract above -- do not invent a stricter or different taxonomy for these three than what the
contract states. strategy_evidence_disjointness, target_definition_conflicts, and
audience_attribution are NOT defined by the contract above; grade them on ordinary semantic-
consistency grounds against the transcript, and apply the same atomic quote law (contract point 8)
to any finding you raise against them -- absence of a written rule for a check is not itself
license to invent one, and it is not license to skip the check either.

REQUIRED RESPONSE SHAPE
{{
  "schema": "{RESPONSE_SCHEMA}",
  "video_id": "{task['video_id']}",
  "candidate_sha256": "{task['candidate_sha256']}",
  "transcript_sha256": "{task['transcript_sha256']}",
  "task_sha256": "{task['task_sha256']}",
  "audit_nonce": "{task['audit_nonce']}",
  "auditor_role": "{AUDITOR_ROLE}",
  "model_identity": "{MODEL_IDENTITY}",
  "legacy_semantics_visible": false,
  "verdict": "PASS|FAIL",
  "strategy_identity": [
    {{"source_strategy_id":"s0","classification":"independent_strategy","reason":"...","transcript_quote":"literal source span"}}
  ],
  "claim_entailment": [
    {{"claim_ref":"strategies[0].entry_sequence[0]","verdict":"ENTAILED","reason":"...","transcript_quote":"literal source span"}}
  ],
  "cross_field_checks": [
    {{"check":"trigger_vs_source_gaps","status":"PASS","reason":"...","transcript_quote":null}}
  ],
  "findings": [
    {{"severity":"CRITICAL|HIGH|MEDIUM|LOW|INFO","ref":"...","finding":"...","transcript_quote":null}}
  ],
  "coverage_statement": "...",
  "independence_statement": "I audited the frozen Opus candidate only against the supplied original transcript before any legacy comparison."
}}

PASS LAW
PASS only when every claim is ENTAILED, every top-level strategy is independent_strategy, every
required cross-field check is PASS, and there are no HIGH/CRITICAL findings. Otherwise FAIL.

ORIGINAL TRANSCRIPT
<<<TRANSCRIPT_START>>>
{transcript}
<<<TRANSCRIPT_END>>>

FROZEN OPUS CANDIDATE
<<<CANDIDATE_START>>>
{candidate_text}
<<<CANDIDATE_END>>>
"""


def emit(args: argparse.Namespace) -> int:
    transcript_path = Path(args.transcript)
    candidate_path = Path(args.candidate)
    out_dir = Path(args.out_dir)
    transcript = transcript_path.read_text(encoding="utf-8")
    raw = candidate_path.read_bytes()
    candidate = json.loads(raw.decode("utf-8"))
    task = build_task(args.video_id, transcript, candidate, raw)
    prompt = render_prompt(task, transcript, raw.decode("utf-8"))
    out_dir.mkdir(parents=True, exist_ok=True)
    write_json(out_dir / "gpt56_semantic_audit_task.json", task)
    write_text(out_dir / "gpt56_semantic_audit_prompt.txt", prompt)
    print(json.dumps({
        "status": "GPT56_SEMANTIC_AUDIT_TASK_EMITTED",
        "video_id": args.video_id,
        "candidate_sha256": task["candidate_sha256"],
        "transcript_sha256": task["transcript_sha256"],
        "task_sha256": task["task_sha256"],
        "claim_count": len(task["required_claims"]),
        "strategy_count": len(task["strategy_ids"]),
    }, indent=2))
    return 0


def _literal_or_null(transcript: str, quote: Any, where: str) -> None:
    if quote is None:
        return
    if not isinstance(quote, str) or not quote:
        raise SystemExit(f"{where}: transcript_quote must be null or non-empty string")
    if quote not in transcript:
        raise SystemExit(f"{where}: audit quote is not a literal transcript substring")


def _validate_response(task: dict[str, Any], response: dict[str, Any], transcript: str) -> tuple[bool, list[str]]:
    exact = {
        "schema": RESPONSE_SCHEMA,
        "video_id": task["video_id"],
        "candidate_sha256": task["candidate_sha256"],
        "transcript_sha256": task["transcript_sha256"],
        "task_sha256": task["task_sha256"],
        "audit_nonce": task["audit_nonce"],
        "auditor_role": AUDITOR_ROLE,
        "model_identity": MODEL_IDENTITY,
        "legacy_semantics_visible": False,
    }
    for key, expected in exact.items():
        if response.get(key) != expected:
            raise SystemExit(f"audit response {key} mismatch")
    if response.get("verdict") not in {"PASS", "FAIL"}:
        raise SystemExit("audit verdict must be PASS or FAIL")
    expected_independence = (
        "I audited the frozen Opus candidate only against the supplied original transcript before any legacy comparison."
    )
    if response.get("independence_statement") != expected_independence:
        raise SystemExit("audit independence statement mismatch")

    reasons: list[str] = []

    # Strategy identity: exact one-row coverage, no duplicates or extras.
    expected_sids = task["strategy_ids"]
    rows = response.get("strategy_identity")
    if not isinstance(rows, list):
        raise SystemExit("strategy_identity must be a list")
    by_sid: dict[str, dict[str, Any]] = {}
    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            raise SystemExit(f"strategy_identity[{i}] not an object")
        sid = row.get("source_strategy_id")
        if sid in by_sid:
            raise SystemExit(f"duplicate strategy identity row: {sid}")
        if sid not in expected_sids:
            raise SystemExit(f"unexpected strategy identity row: {sid}")
        cls = row.get("classification")
        if cls not in IDENTITY_CLASSES:
            raise SystemExit(f"strategy identity {sid}: invalid classification")
        _literal_or_null(transcript, row.get("transcript_quote"), f"strategy_identity[{sid}]")
        by_sid[sid] = row
        if cls != "independent_strategy":
            reasons.append(f"strategy {sid} classified {cls}")
    if set(by_sid) != set(expected_sids):
        missing = sorted(set(expected_sids) - set(by_sid))
        raise SystemExit(f"strategy identity coverage incomplete: {missing}")

    # Claim entailment: exact one-row coverage.
    expected_claims = {c["claim_ref"]: c for c in task["required_claims"]}
    ent = response.get("claim_entailment")
    if not isinstance(ent, list):
        raise SystemExit("claim_entailment must be a list")
    seen: dict[str, dict[str, Any]] = {}
    for i, row in enumerate(ent):
        if not isinstance(row, dict):
            raise SystemExit(f"claim_entailment[{i}] not an object")
        ref = row.get("claim_ref")
        if ref in seen:
            raise SystemExit(f"duplicate claim audit row: {ref}")
        if ref not in expected_claims:
            raise SystemExit(f"unexpected claim audit row: {ref}")
        verdict = row.get("verdict")
        if verdict not in ENTAILMENT:
            raise SystemExit(f"claim {ref}: invalid entailment verdict")
        _literal_or_null(transcript, row.get("transcript_quote"), f"claim_entailment[{ref}]")
        seen[ref] = row
        if verdict != "ENTAILED":
            reasons.append(f"claim {ref}={verdict}")
    if set(seen) != set(expected_claims):
        missing = sorted(set(expected_claims) - set(seen))
        raise SystemExit(f"claim entailment coverage incomplete: {missing}")

    # Cross-field checks: exact required coverage.
    checks = response.get("cross_field_checks")
    if not isinstance(checks, list):
        raise SystemExit("cross_field_checks must be a list")
    by_check: dict[str, dict[str, Any]] = {}
    for i, row in enumerate(checks):
        if not isinstance(row, dict):
            raise SystemExit(f"cross_field_checks[{i}] not an object")
        name = row.get("check")
        if name in by_check:
            raise SystemExit(f"duplicate cross-field check: {name}")
        if name not in REQUIRED_CROSS_CHECKS:
            raise SystemExit(f"unexpected cross-field check: {name}")
        status = row.get("status")
        if status not in CHECK_STATUS:
            raise SystemExit(f"cross-field check {name}: invalid status")
        _literal_or_null(transcript, row.get("transcript_quote"), f"cross_field_checks[{name}]")
        by_check[name] = row
        if status != "PASS":
            reasons.append(f"cross-field {name}={status}")
    if set(by_check) != set(REQUIRED_CROSS_CHECKS):
        missing = sorted(set(REQUIRED_CROSS_CHECKS) - set(by_check))
        raise SystemExit(f"cross-field coverage incomplete: {missing}")

    findings = response.get("findings")
    if not isinstance(findings, list):
        raise SystemExit("findings must be a list")
    for i, finding in enumerate(findings):
        if not isinstance(finding, dict):
            raise SystemExit(f"findings[{i}] not an object")
        sev = finding.get("severity")
        if sev not in {"CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"}:
            raise SystemExit(f"findings[{i}]: invalid severity")
        _literal_or_null(transcript, finding.get("transcript_quote"), f"findings[{i}]")
        if sev in {"CRITICAL", "HIGH"}:
            reasons.append(f"blocking finding {sev}:{finding.get('ref')}")

    semantic_pass = not reasons
    if response.get("verdict") == "PASS" and not semantic_pass:
        raise SystemExit("audit claims PASS but fail-closed semantic conditions are not all clean: " + "; ".join(reasons[:8]))
    if response.get("verdict") == "FAIL" and semantic_pass:
        # FAIL is always allowed semantically, but it must name at least one finding rather than be vacuous.
        if not findings:
            raise SystemExit("audit claims FAIL with no failing condition and no finding")
    return semantic_pass and response.get("verdict") == "PASS", reasons


def ingest(args: argparse.Namespace) -> int:
    out_dir = Path(args.out_dir)
    task_path = out_dir / "gpt56_semantic_audit_task.json"
    task = read_json(task_path)
    if task.get("schema") != TASK_SCHEMA or task.get("video_id") != args.video_id:
        raise SystemExit("semantic audit task identity/schema mismatch")

    transcript = Path(args.transcript).read_text(encoding="utf-8")
    candidate_raw = Path(args.candidate).read_bytes()
    if sha256_text(transcript) != task.get("transcript_sha256"):
        raise SystemExit("transcript changed after semantic audit task emission")
    if sha256_bytes(candidate_raw) != task.get("candidate_sha256"):
        raise SystemExit("candidate changed after semantic audit task emission")

    task_copy = dict(task)
    task_sha = task_copy.pop("task_sha256", None)
    if sha256_text(canonical_json(task_copy)) != task_sha:
        raise SystemExit("semantic audit task changed after emission")

    raw_response = Path(args.raw_response).read_bytes()
    response = json.loads(raw_response.decode("utf-8"))
    clean_pass, reasons = _validate_response(task, response, transcript)
    status = PASS_STATUS if clean_pass else FAIL_STATUS
    receipt = {
        "schema": RECEIPT_SCHEMA,
        "status": status,
        "video_id": args.video_id,
        "candidate_sha256": task["candidate_sha256"],
        "transcript_sha256": task["transcript_sha256"],
        "task_sha256": task["task_sha256"],
        "raw_response_sha256": sha256_bytes(raw_response),
        "auditor_role": AUDITOR_ROLE,
        "model_identity": MODEL_IDENTITY,
        "legacy_semantics_visible": False,
        "semantic_pass": clean_pass,
        "fail_closed_reasons": reasons,
        "next_authority": (
            "INDEPENDENT_CLAUDE_ACCURACY_VALIDATOR_REQUIRED"
            if clean_pass else "STOP_NO_CERTIFIER_COMPILER_AUTHORITY"
        ),
        "explicitly_not_factory_authority": True,
    }
    write_text(out_dir / "raw_gpt56_semantic_audit_response.json", raw_response.decode("utf-8"))
    write_json(out_dir / "gpt56_semantic_audit_receipt.json", receipt)
    print(json.dumps(receipt, indent=2))
    return 0


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("emit")
    e.add_argument("--video-id", required=True)
    e.add_argument("--transcript", required=True)
    e.add_argument("--candidate", required=True)
    e.add_argument("--out-dir", required=True)
    e.set_defaults(fn=emit)

    i = sub.add_parser("ingest")
    i.add_argument("--video-id", required=True)
    i.add_argument("--transcript", required=True)
    i.add_argument("--candidate", required=True)
    i.add_argument("--out-dir", required=True)
    i.add_argument("--raw-response", required=True)
    i.set_defaults(fn=ingest)
    return p


def main() -> int:
    args = parser().parse_args()
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
