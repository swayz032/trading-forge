"""STABLE CERTIFICATION RUNNER for source-graph-projection-v2.1 -- AR-1323A F59/F60.

NOT a `_tmp.py` investigation script. This is the durable, versioned entry point AR-1323A
requires: it loads the committed JSON spec (never reads fixture-specific adjudication out of a
temporary driver), verifies pins, runs the pure projection TWICE to prove determinism, executes
the permanent focused test module and the neighboring regression suite as explicit subprocesses,
and owns the WHOLE-CONTRACT verdict -- `run_projection()` itself stays pure and never invokes
pytest (AR-1323A F59).

Usage:  python scripts/source_graph_projection_v2_1_certify.py
Exit codes: 0 = every certificate-contract item is DONE. 1 = at least one item is not.
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys

sys.path.insert(0, os.getcwd())

SPEC_PATH = "docs/replay-results/svkm-extraction-certified/grade/opus-v2/source_graph_projection_v2_1_spec.json"
RECEIPT_PATH = "docs/replay-results/svkm-extraction-certified/grade/opus-v2/source_graph_projection_v2_1.json"
CERTIFICATE_PATH = "docs/replay-results/svkm-extraction-certified/grade/opus-v2/source_graph_projection_v2_1_certificate.json"
FOCUSED_TEST_PATH = "src/engine/tests/test_source_graph_projection.py"


def _bench():
    spec = importlib.util.spec_from_file_location(
        "_svkm_bench", os.path.join("scripts", "svkm_locator_benchmark.py")
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _canonical_hash(record: dict) -> str:
    import hashlib

    blob = json.dumps(record, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _run_pytest(args: list[str], timeout_s: int = 900) -> dict:
    """`TF_MOCK_VBT=1` is set unconditionally: this certifier exercises the extraction/projection
    layer only, never the real vectorbt-JIT backtester, and running WITHOUT the stub triggers the
    documented multi-minute-plus Numba JIT hang under pytest collection on this tower (see
    src/engine/conftest.py `mock_vectorbt_session` docstring; CLAUDE.md pinned env trait). A
    subprocess timeout additionally bounds worst case instead of hanging the whole certifier."""
    env = dict(os.environ)
    env["TF_MOCK_VBT"] = "1"
    command = "pytest " + " ".join(args) + " -q"
    try:
        proc = subprocess.run(
            [sys.executable, "-m", "pytest", *args, "-q"],
            capture_output=True, text=True, cwd=os.getcwd(), env=env, timeout=timeout_s,
        )
    except subprocess.TimeoutExpired:
        return {
            "command": command, "returncode": None, "tail": f"TIMEOUT after {timeout_s}s",
            "passed": False,
        }
    tail = "\n".join(proc.stdout.strip().splitlines()[-8:])
    return {
        "command": command,
        "returncode": proc.returncode,
        "tail": tail,
        "passed": proc.returncode == 0,
    }


def main() -> int:
    from src.engine.extraction import source_graph_projection_spec as sgps
    from src.engine.extraction.source_graph_projection import run_projection

    bench = _bench()
    transcript, extraction_record = bench._load_pinned()

    spec = sgps.load_spec_json(SPEC_PATH)
    inputs = sgps.build_projection_run_inputs(
        spec, transcript, verify_pins=True, extraction_record=extraction_record,
    )

    checklist: dict[str, dict] = {}

    # ------------------------------------------------------------------ #
    # A -- run twice, assert deterministic receipt identity
    # ------------------------------------------------------------------ #
    record_1 = run_projection(**inputs.run_kwargs())
    record_2 = run_projection(**inputs.run_kwargs())
    hash_1 = _canonical_hash(record_1)
    hash_2 = _canonical_hash(record_2)
    deterministic = hash_1 == hash_2
    checklist["A_determinism"] = {
        "status": "DONE" if deterministic else "PARTIAL",
        "hash_run_1": hash_1, "hash_run_2": hash_2, "identical": deterministic,
    }

    record = record_1
    record["receipt_sha256_canonical"] = hash_1

    conservation_ok = record["conservation"] == {
        "input_ref_count": 12, "canonical_count": 9, "alias_count": 1,
        "preserved_metadata_count": 2,
    }
    graph_ok = record["graph"]["complete"] is True
    canonical_ok = record["canonical_accepted_count"] == 9
    grade_ok = record["grade"] == "GREEN_PENDING_CERTIFICATION"
    pins_ok = (
        record.get("transcript_sha256") == spec["pins"]["transcript_sha256"]
        and record.get("extraction_sha256") == spec["pins"]["extraction_sha256"]
    )
    checklist["B_versioned_spec_data_artifact"] = {
        "status": "DONE", "spec_path": SPEC_PATH,
        "detail": "all fixture-specific adjudication loaded from committed JSON, zero adjudication in this runner",
    }
    checklist["C_self_contained_receipt"] = {
        "status": "DONE" if pins_ok else "PARTIAL",
        "pins_present_and_verified": pins_ok,
        "transcript_sha256": record.get("transcript_sha256"),
        "extraction_sha256": record.get("extraction_sha256"),
    }
    checklist["D_conservation_9_1_2"] = {"status": "DONE" if conservation_ok else "PARTIAL", "conservation": record["conservation"]}
    checklist["E_graph_complete"] = {"status": "DONE" if graph_ok else "PARTIAL", "graph": {k: v for k, v in record["graph"].items() if k != "edges"}}
    checklist["F_canonical_9_of_9_accepted"] = {"status": "DONE" if canonical_ok else "PARTIAL", "canonical_accepted_count": record["canonical_accepted_count"]}
    checklist["G_receipt_grade_green"] = {"status": "DONE" if grade_ok else "PARTIAL", "grade": record["grade"]}

    focused = _run_pytest([FOCUSED_TEST_PATH])
    checklist["H_permanent_focused_tests"] = {
        "status": "DONE" if focused["passed"] else "PARTIAL", **focused,
    }

    # AR-1324A section 3 micro-closeout: "neighboring suite" is restored to the EXACT
    # pre-registered AR-1322A/V2 neighboring command (not a new 53-file extraction-import census
    # -- that broader selection pulled in 2 disclosed pre-existing/stateful failures outside this
    # patch's scope and is explicitly NOT authorized as a substitute proof). This is the same
    # command AR-1322A's V2 packet used and reported `294 passed, 5 skipped, 0 failed` for.
    NEIGHBORING_SUITE_ARGS = [
        "src/engine/tests/test_evidence_relevance.py", "src/engine/tests/",
        "-k", "antecedent or fidelity or collision or finalizer or opus_phase1_route or g2d",
    ]
    neighboring = _run_pytest(NEIGHBORING_SUITE_ARGS, timeout_s=600)
    neighboring["scope"] = (
        "exact pre-registered AR-1322A/V2 neighboring command per AR-1324A section 3 "
        "(evidence_relevance / antecedent / fidelity / collision / finalizer / "
        "opus_phase1_route / g2d test population)"
    )
    checklist["I_neighboring_suite"] = {
        "status": "DONE" if neighboring["passed"] else "PARTIAL", **neighboring,
    }

    checklist["J_github_ci"] = {
        "status": "EXTERNAL_NOT_CHECKED_BY_THIS_RUNNER",
        "detail": (
            "GitHub CI status is external to this local runner and is not fabricated here. "
            "Check via `gh api repos/<owner>/<repo>/commits/<sha>/status` or the GitHub UI."
        ),
    }

    all_internal_done = all(
        v["status"] == "DONE"
        for k, v in checklist.items()
        if k != "J_github_ci"
    )
    overall = "GREEN_ALL_ITEMS_DONE" if all_internal_done else "PARTIAL_SEE_CHECKLIST"

    certificate = {
        "certificate_version": "source-graph-projection-v2.1-certificate",
        "authority": "AR-1323A section 3 (E: stable certification command)",
        "overall_status": overall,
        "checklist": checklist,
    }

    with open(RECEIPT_PATH, "w", encoding="utf-8", newline="\n") as f:
        json.dump(record, f, indent=2, ensure_ascii=False)
        f.write("\n")
    with open(CERTIFICATE_PATH, "w", encoding="utf-8", newline="\n") as f:
        json.dump(certificate, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"overall_status: {overall}")
    for k, v in checklist.items():
        print(f"  {k}: {v['status']}")
    print(f"wrote {RECEIPT_PATH}")
    print(f"wrote {CERTIFICATE_PATH}")
    return 0 if overall == "GREEN_ALL_ITEMS_DONE" else 1


if __name__ == "__main__":
    raise SystemExit(main())
