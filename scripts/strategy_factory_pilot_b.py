#!/usr/bin/env python3
"""AR-1328A Packet B -- deterministic 10-member pilot (batch-disposition-integrity contract).

Members: the certified sVkm golden source (EXTERNAL positive control, not itself a manifest
row -- AR-1333A S4) + the first 9 unique members of the frozen manifest
(docs/replay-results/strategy-factory-census/library-manifest-v1.1.json), in that file's own
(name, strategy_id) order. No manual cherry-picking (AR-1328A S3, explicit).

THIS IS NOT A SECOND COMPILER. It reuses:
  - src.engine.extraction.svkm_v2_1_compile.compile_svkm_v2_1_vertical (the EXISTING, already-
    certified Stage-2 SPINE-A path) for the sVkm control only;
  - a repo-wide content search (git ls-files, filtered) for the 9 manifest members, to determine
    whether a modern (entry_sequence-schema) raw extraction record exists for each member's
    claimed source video/concept at all. Per AR-1333A S3: "Do not launch a new broad
    extraction/model campaign merely because a member lacks modern evidence... stays in the
    manifest and receives the appropriate measured disposition." No compile is attempted for a
    member with no certified/raw input to compile FROM -- there is nothing for compile_certified_
    record.py to read.

POSITIVE CONTROL for the search methodology itself (worker-execution S2a "control-probe your
null results"): the same video-id+entry_sequence search, run against sVkmZklJDHI, MUST find
docs/replay-results/svkm-extraction-certified/sVkmZklJDHI.json. If it does not, the search
methodology itself is broken and this script refuses to emit any disposition.

Allowed dispositions used here: FAITHFUL_COMPILE_READY_FOR_BACKTEST,
EXTRACTION_MISSING_REQUIRED_INFORMATION (batch-disposition-integrity vocabulary).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MANIFEST_PATH = "docs/replay-results/strategy-factory-census/library-manifest-v1.1.json"
SVKM_CERTIFIED_PATH = "src/engine/extraction/fixtures/svkm_v2_1_compiled/sVkmZklJDHI__s0.spec.json"
OUT_PATH = "docs/replay-results/strategy-factory-census/pilot-b-disposition-2026-08-19.json"


def _git_ls_files_json() -> list[str]:
    """All tracked .json files -- the population this search runs over. Using git ls-files
    (not a filesystem walk) means the search only ever sees committed, real artifacts."""
    out = subprocess.run(
        ["git", "ls-files", "*.json"], cwd=REPO_ROOT, capture_output=True, text=True, check=True
    )
    return [line for line in out.stdout.splitlines() if line.strip()]


def find_modern_extraction_files(video_id: str, all_json_files: list[str]) -> list[str]:
    """Repo-wide search for a file whose OWN `video_id` (or `extraction.video_id`) field --
    never a substring match anywhere in the blob -- equals the target, AND which also carries
    the modern-schema marker "entry_sequence" (in the raw text, cheap pre-filter before parsing).

    MEASURED DEFECT, FIXED: an earlier version of this check matched `video_id in content`
    (substring over the whole file), which fired on unrelated files whose shared Wave-1 control
    section (`_load_wave1_control_section`, pilot_conveyor.py) embeds OTHER videos' ids as
    example/control text -- e.g. every file under `h1-scripts/pilot-run/videos/*.json` contains
    the string "FqxEKDxemtI" somewhere despite its own `video_id` being a completely different
    video. Field-level comparison after a cheap substring pre-filter removes this false-positive
    class; the pre-filter alone is not the check."""
    hits: list[str] = []
    for rel_path in all_json_files:
        abs_path = os.path.join(REPO_ROOT, rel_path)
        try:
            with open(abs_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except OSError:
            continue
        if video_id not in content or "entry_sequence" not in content:
            continue
        try:
            data = json.loads(content)
        except json.JSONDecodeError:
            continue
        own_video_id = data.get("video_id") or (data.get("extraction") or {}).get("video_id")
        if own_video_id == video_id:
            hits.append(rel_path)
    return hits


def extracted_strategy_names(path: str) -> list[str]:
    """Best-effort extraction of strategy names from a candidate file, handling the one known
    modern-extraction shape (sVkm's: top-level `extraction.strategies[].name`). Returns []
    (never raises) for any other shape -- the disposition logic treats [] as "found the video,
    could not identify a named strategy inside it", never as "not found"."""
    try:
        with open(os.path.join(REPO_ROOT, path), "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return []
    strategies = ((data.get("extraction") or {}).get("strategies")) or data.get("strategies") or []
    if not isinstance(strategies, list):
        return []
    return [s.get("name") for s in strategies if isinstance(s, dict) and s.get("name")]


def run_svkm_control() -> dict:
    """The external positive control: reproduce the already-certified Stage-2 artifact via the
    EXISTING adapter (svkm_v2_1_compile.py), unchanged. Byte-compares the freshly-compiled
    spec_hash against the committed certified artifact's own spec_hash -- any drift QUARANTINES
    the pilot (AR-1328A S3, explicit)."""
    sys.path.insert(0, REPO_ROOT)
    from src.engine.extraction.svkm_v2_1_compile import compile_svkm_v2_1_vertical

    committed_path = os.path.join(REPO_ROOT, SVKM_CERTIFIED_PATH)
    with open(committed_path, "r", encoding="utf-8") as f:
        committed_artifact = json.load(f)
    committed_hash = committed_artifact.get("spec_hash")

    fresh_path = compile_svkm_v2_1_vertical()
    with open(fresh_path, "r", encoding="utf-8") as f:
        fresh_artifact = json.load(f)
    fresh_hash = fresh_artifact.get("spec_hash")

    drifted = fresh_hash != committed_hash
    return {
        "role": "EXTERNAL_POSITIVE_CONTROL",
        "video_id": "sVkmZklJDHI",
        "compiled_name": fresh_artifact.get("spec", {}).get("name"),
        "committed_spec_hash": committed_hash,
        "freshly_compiled_spec_hash": fresh_hash,
        "drift_detected": drifted,
        "disposition": "QUARANTINE_DRIFT_DETECTED" if drifted else "FAITHFUL_COMPILE_READY_FOR_BACKTEST",
        "evidence": {
            "compiler_path": "svkm_v2_1_compile.compile_svkm_v2_1_vertical -> "
            "compile_certified_record.compile_record_to_artifact [SPINE-A, unchanged] -> "
            "spec_producer.produce_spec_artifact_from_record [canonical producer, unchanged]",
            "committed_artifact_path": SVKM_CERTIFIED_PATH,
            "freshly_compiled_artifact_path": os.path.relpath(fresh_path, REPO_ROOT),
        },
    }


def run_manifest_member(member: dict, all_json_files: list[str]) -> dict:
    video_id = None
    source_url = (member.get("source") or {}).get("source_url") or ""
    if "watch?v=" in source_url:
        video_id = source_url.split("watch?v=")[-1].split("&")[0]

    if not video_id:
        return {
            "strategy_id": member["strategy_id"],
            "name": member["name"],
            "disposition": "SOURCE_INCOMPLETE",
            "evidence": {"reason": "manifest row carries no parseable source_url"},
        }

    candidates = find_modern_extraction_files(video_id, all_json_files)
    if not candidates:
        return {
            "strategy_id": member["strategy_id"],
            "name": member["name"],
            "video_id": video_id,
            "disposition": "EXTRACTION_MISSING_REQUIRED_INFORMATION",
            "evidence": {
                "reason": "no repo-tracked JSON file contains this video_id alongside the "
                "modern extraction schema marker 'entry_sequence' -- no raw or certified "
                "extraction record exists to compile from",
                "search_population_size": len(all_json_files),
                "candidate_files_found": 0,
            },
        }

    names_by_file = {c: extracted_strategy_names(c) for c in candidates}
    row_name_matches = any(member["name"] in names for names in names_by_file.values())
    if row_name_matches:
        return {
            "strategy_id": member["strategy_id"],
            "name": member["name"],
            "video_id": video_id,
            "disposition": "MATCHED_EXTRACTION_FOUND_COMPILE_NOT_ATTEMPTED_THIS_PACKET",
            "evidence": {
                "reason": "a modern extraction record naming this exact strategy exists but "
                "was not compiled in this packet -- unexpected branch for the Packet-B pilot "
                "population, flagged rather than silently compiled or silently skipped",
                "candidate_files": names_by_file,
            },
        }
    return {
        "strategy_id": member["strategy_id"],
        "name": member["name"],
        "video_id": video_id,
        "disposition": "EXTRACTION_MISSING_REQUIRED_INFORMATION",
        "evidence": {
            "reason": "a modern extraction record exists for this source video, but does not "
            "name this row's specific strategy -- the video was extracted under the modern "
            "pipeline for a DIFFERENT taught concept; this row's old (spec_onboarding, "
            "corpus_version pre-dating the certified pipeline) compiled_spec is not proof of a "
            "new certified-source-graph compile (AR-1333A S1)",
            "candidate_files_and_named_strategies": names_by_file,
        },
    }


def main() -> int:
    with open(os.path.join(REPO_ROOT, MANIFEST_PATH), "r", encoding="utf-8") as f:
        manifest = json.load(f)
    pilot_members = manifest[:9]

    all_json_files = _git_ls_files_json()

    # Positive control for the search methodology itself.
    control_hits = find_modern_extraction_files("sVkmZklJDHI", all_json_files)
    control_ok = "docs/replay-results/svkm-extraction-certified/sVkmZklJDHI.json" in control_hits
    if not control_ok:
        sys.stderr.write(
            "SEARCH METHODOLOGY POSITIVE CONTROL FAILED: sVkmZklJDHI's own certified extraction "
            "was not found by the same search this script uses for the 9 pilot members. "
            "Refusing to emit any disposition -- the search itself is unproven.\n"
            f"control_hits={control_hits}\n"
        )
        return 3

    svkm_control = run_svkm_control()
    member_results = [run_manifest_member(m, all_json_files) for m in pilot_members]

    input_ids = {m["strategy_id"] for m in pilot_members}
    output_ids = {r["strategy_id"] for r in member_results}
    disposition_counts: dict[str, int] = {}
    for r in member_results:
        disposition_counts[r["disposition"]] = disposition_counts.get(r["disposition"], 0) + 1

    report = {
        "artifact": "strategy-factory-pilot-b-disposition",
        "search_methodology_positive_control": {
            "target": "sVkmZklJDHI",
            "expected_file": "docs/replay-results/svkm-extraction-certified/sVkmZklJDHI.json",
            "found": control_hits,
            "passed": control_ok,
        },
        "external_positive_control": svkm_control,
        "manifest_members_in": len(pilot_members),
        "manifest_members_out": len(member_results),
        "missing_ids": sorted(input_ids - output_ids),
        "extra_ids": sorted(output_ids - input_ids),
        "duplicate_output_ids": len(member_results) != len(output_ids),
        "disposition_counts": disposition_counts,
        "members": member_results,
        "pilot_verdict": None,  # filled below
    }

    integrity_ok = (
        control_ok
        and not report["missing_ids"]
        and not report["extra_ids"]
        and not report["duplicate_output_ids"]
        and svkm_control["disposition"] == "FAITHFUL_COMPILE_READY_FOR_BACKTEST"
        and all(
            r["disposition"] in ("EXTRACTION_MISSING_REQUIRED_INFORMATION", "FAITHFUL_COMPILE_READY_FOR_BACKTEST")
            for r in member_results
        )
    )
    report["pilot_verdict"] = "PASS" if integrity_ok else "QUARANTINE"

    os.makedirs(os.path.dirname(os.path.join(REPO_ROOT, OUT_PATH)), exist_ok=True)
    with open(os.path.join(REPO_ROOT, OUT_PATH), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if integrity_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
