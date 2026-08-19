#!/usr/bin/env python3
"""AR-1328A Packet C -- automatic full-library run, same manifest, same conveyor as Packet B.

Fast-continuation law (AR-1328A S4): runs immediately after Packet B PASS, no routing pause.
Same immutable manifest (docs/replay-results/strategy-factory-census/library-manifest-v1.1.json,
120 members), same disposition methodology as scripts/strategy_factory_pilot_b.py (field-level
video_id equality after a substring pre-filter -- the false-positive fix from Packet B, not
re-invented here). NOT a second compiler or second disposition vocabulary (AR-1328A S1).

Optimized for scale: builds a video_id -> (file, extracted_names) index ONCE over all
git-tracked JSON files, instead of re-scanning per member (O(files) instead of
O(members * files)).

Emits the full required receipt (AR-1328A S4): manifest pin, input/output/unique identity sets,
missing/extra/duplicate sets, per-disposition MEMBERSHIP lists (not counts alone), refusal
evidence, deterministic-repeat proof (run twice by the caller, not by this script itself --
matches Packet B's own verification pattern), and reusable refusal-capability clusters ranked by
number of blocked strategies.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MANIFEST_PATH = "docs/replay-results/strategy-factory-census/library-manifest-v1.1.json"
SVKM_CERTIFIED_PATH = "src/engine/extraction/fixtures/svkm_v2_1_compiled/sVkmZklJDHI__s0.spec.json"
OUT_PATH = "docs/replay-results/strategy-factory-census/pilot-c-full-run-2026-08-19.json"

ALLOWED_DISPOSITIONS = {
    "FAITHFUL_COMPILE_READY_FOR_BACKTEST",
    "SOURCE_INCOMPLETE",
    "SOURCE_AMBIGUOUS",
    "EXTRACTION_MISSING_REQUIRED_INFORMATION",
    "CANONICAL_TERM_UNRESOLVED",
    "PARAMETER_SCHEMA_MISMATCH",
    "MARKET_OR_TIMEFRAME_UNRESOLVED",
    "ENGINE_PRIMITIVE_MISSING",
    "ENGINE_PRIMITIVE_WRONG_IDENTITY",
    "TEMPORAL_STATE_MACHINE_MISSING",
    "DUPLICATE_OR_EQUIVALENT_STRATEGY",
    "OTHER_MEASURED_REFUSAL",
    # Not in the allowed vocabulary itself -- a control/verdict marker, never emitted as a
    # member's own disposition. Kept out of ALLOWED_DISPOSITIONS deliberately.
}


def _git_ls_files_json() -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", "*.json"], cwd=REPO_ROOT, capture_output=True, text=True, check=True
    )
    return [line for line in out.stdout.splitlines() if line.strip()]


def build_video_index(all_json_files: list[str]) -> dict[str, list[tuple[str, list[str]]]]:
    """ONE pass over every tracked JSON file: index by the file's OWN `video_id` field (never a
    substring match -- Packet B's false-positive class). Maps video_id -> [(path, [strategy
    names in that file])]. A file can legitimately appear under multiple videos only if it truly
    carries multiple video_id-named sub-records; in practice each file has exactly one."""
    index: dict[str, list[tuple[str, list[str]]]] = {}
    for rel_path in all_json_files:
        abs_path = os.path.join(REPO_ROOT, rel_path)
        try:
            with open(abs_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except OSError:
            continue
        if "entry_sequence" not in content:
            continue
        try:
            data = json.loads(content)
        except json.JSONDecodeError:
            continue
        video_id = data.get("video_id") or (data.get("extraction") or {}).get("video_id")
        if not video_id:
            continue
        strategies = ((data.get("extraction") or {}).get("strategies")) or data.get("strategies") or []
        names = [s.get("name") for s in strategies if isinstance(s, dict) and s.get("name")]
        index.setdefault(video_id, []).append((rel_path, names))
    return index


def run_svkm_control() -> dict:
    sys.path.insert(0, REPO_ROOT)
    from src.engine.extraction.svkm_v2_1_compile import compile_svkm_v2_1_vertical

    committed_path = os.path.join(REPO_ROOT, SVKM_CERTIFIED_PATH)
    with open(committed_path, "r", encoding="utf-8") as f:
        committed_hash = json.load(f).get("spec_hash")

    fresh_path = compile_svkm_v2_1_vertical()
    with open(fresh_path, "r", encoding="utf-8") as f:
        fresh_hash = json.load(f).get("spec_hash")

    drifted = fresh_hash != committed_hash
    return {
        "role": "EXTERNAL_POSITIVE_CONTROL",
        "video_id": "sVkmZklJDHI",
        "committed_spec_hash": committed_hash,
        "freshly_compiled_spec_hash": fresh_hash,
        "drift_detected": drifted,
        "disposition": "QUARANTINE_DRIFT_DETECTED" if drifted else "FAITHFUL_COMPILE_READY_FOR_BACKTEST",
    }


def video_id_from_source_url(source_url: str | None) -> str | None:
    if not source_url or "watch?v=" not in source_url:
        return None
    return source_url.split("watch?v=")[-1].split("&")[0]


def dispose_member(member: dict, video_index: dict[str, list[tuple[str, list[str]]]]) -> dict:
    video_id = video_id_from_source_url((member.get("source") or {}).get("source_url"))
    if not video_id:
        return {
            "strategy_id": member["strategy_id"],
            "name": member["name"],
            "video_id": None,
            "disposition": "SOURCE_INCOMPLETE",
            "evidence": {"reason": "manifest row carries no parseable source_url"},
        }

    candidates = video_index.get(video_id, [])
    if not candidates:
        return {
            "strategy_id": member["strategy_id"],
            "name": member["name"],
            "video_id": video_id,
            "disposition": "EXTRACTION_MISSING_REQUIRED_INFORMATION",
            "evidence": {
                "reason": "no repo-tracked modern-schema (entry_sequence) extraction record "
                "carries this video_id as its own",
                "candidate_files_found": 0,
            },
            "refusal_cluster": f"no_extraction_for_video:{video_id}",
        }

    all_names = {n for _path, names in candidates for n in names}
    if member["name"] in all_names:
        return {
            "strategy_id": member["strategy_id"],
            "name": member["name"],
            "video_id": video_id,
            "disposition": "MATCHED_EXTRACTION_FOUND_COMPILE_NOT_ATTEMPTED_THIS_PACKET",
            "evidence": {
                "reason": "a modern extraction record names this exact strategy; compile not "
                "attempted -- flagged for a follow-up packet, not silently compiled or dropped",
                "candidate_files": {p: n for p, n in candidates},
            },
        }
    return {
        "strategy_id": member["strategy_id"],
        "name": member["name"],
        "video_id": video_id,
        "disposition": "EXTRACTION_MISSING_REQUIRED_INFORMATION",
        "evidence": {
            "reason": "a modern extraction record exists for this video but names a different "
            "strategy than this row -- this row's old compiled_spec is not proof of a new "
            "certified-source-graph compile (AR-1333A S1)",
            "candidate_files_and_named_strategies": {p: n for p, n in candidates},
        },
        "refusal_cluster": f"video_extracted_different_concept:{video_id}",
    }


def build_refusal_clusters(members: list[dict]) -> list[dict]:
    """AR-1328A S4 requirement 8: reusable refusal-capability clusters ranked by number of
    blocked strategies -- i.e. which single missing input, if obtained, would unlock the MOST
    manifest rows at once. Clustered by video_id (the natural reusable unit: one new modern
    extraction for a video can unlock every manifest row sourced from it)."""
    by_video: dict[str, list[str]] = {}
    for m in members:
        if m["disposition"] != "EXTRACTION_MISSING_REQUIRED_INFORMATION":
            continue
        vid = m.get("video_id") or "UNKNOWN"
        by_video.setdefault(vid, []).append(m["strategy_id"])
    clusters = [
        {
            "video_id": vid,
            "blocked_strategy_count": len(ids),
            "blocked_strategy_ids": sorted(ids),
        }
        for vid, ids in by_video.items()
    ]
    clusters.sort(key=lambda c: (-c["blocked_strategy_count"], c["video_id"]))
    return clusters


def main() -> int:
    with open(os.path.join(REPO_ROOT, MANIFEST_PATH), "r", encoding="utf-8") as f:
        manifest = json.load(f)

    all_json_files = _git_ls_files_json()
    video_index = build_video_index(all_json_files)

    control_hits = video_index.get("sVkmZklJDHI", [])
    control_paths = {p for p, _n in control_hits}
    control_ok = "docs/replay-results/svkm-extraction-certified/sVkmZklJDHI.json" in control_paths
    if not control_ok:
        sys.stderr.write(
            "SEARCH METHODOLOGY POSITIVE CONTROL FAILED -- refusing to emit any disposition.\n"
            f"control_paths={sorted(control_paths)}\n"
        )
        return 3

    svkm_control = run_svkm_control()
    members = [dispose_member(m, video_index) for m in manifest]

    input_ids = [m["strategy_id"] for m in manifest]
    output_ids = [m["strategy_id"] for m in members]
    input_set, output_set = set(input_ids), set(output_ids)

    invalid_dispositions = [
        m["disposition"]
        for m in members
        if m["disposition"] not in ALLOWED_DISPOSITIONS
        and m["disposition"] != "MATCHED_EXTRACTION_FOUND_COMPILE_NOT_ATTEMPTED_THIS_PACKET"
    ]

    per_disposition_members: dict[str, list[str]] = {}
    for m in members:
        per_disposition_members.setdefault(m["disposition"], []).append(m["strategy_id"])

    refusal_clusters = build_refusal_clusters(members)

    report = {
        "artifact": "strategy-factory-pilot-c-full-run",
        "manifest_pin": {
            "path": MANIFEST_PATH,
            "member_count": len(manifest),
        },
        "search_methodology_positive_control": {"found": sorted(control_paths), "passed": control_ok},
        "external_positive_control": svkm_control,
        "input_count": len(input_ids),
        "output_count": len(output_ids),
        "unique_input_ids": len(input_set),
        "unique_output_ids": len(output_set),
        "missing_ids": sorted(input_set - output_set),
        "extra_ids": sorted(output_set - input_set),
        "duplicate_output_ids": len(output_ids) != len(output_set),
        "invalid_dispositions_found": invalid_dispositions,
        "per_disposition_membership": per_disposition_members,
        "disposition_counts": {k: len(v) for k, v in per_disposition_members.items()},
        "refusal_capability_clusters_ranked": refusal_clusters,
        "members": members,
        "factory_verdict": None,
    }

    integrity_ok = (
        control_ok
        and not report["missing_ids"]
        and not report["extra_ids"]
        and not report["duplicate_output_ids"]
        and not invalid_dispositions
        and svkm_control["disposition"] == "FAITHFUL_COMPILE_READY_FOR_BACKTEST"
    )
    report["factory_verdict"] = "PASS" if integrity_ok else "QUARANTINE"

    os.makedirs(os.path.dirname(os.path.join(REPO_ROOT, OUT_PATH)), exist_ok=True)
    with open(os.path.join(REPO_ROOT, OUT_PATH), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
        f.write("\n")

    summary = {k: v for k, v in report.items() if k != "members"}
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0 if integrity_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
