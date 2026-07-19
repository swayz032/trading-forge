"""A-packet DoD runner over ALL 22 certified design-pool strategies
(staging_v32 on disk). AMENDED per R-039 (2026-07-18).

For each strategy it assembles a certificate TWICE through the UNMODIFIED
`assemble_certificate`:
  * BEFORE -- topology-less (the honest pre-producer state): the 3 mechanical
    structural lints return NOT_EVALUATED(no_compiled_topology).
  * AFTER  -- with `produce_topology`'s overlay AND the strategy's CALIBRATED
    semantic conflation verdict (from conflation_grades/): the 3 mechanical
    lints EVALUATE (reachability diagnostic, zero NOT_EVALUATED), and `full_grade`
    is now gated on the SEMANTIC verdict (R-039), so it is REACHABLE and HONEST.

TWO DoD facts:
  (1) mechanical-lint REACHABILITY -- every strategy's 3 structural lints EVALUATE
      after the producer (zero NOT_EVALUATED), OR the non-compilability is
      classified. This is a diagnostic, not a safety claim.
  (2) full_grade HONESTY -- with the calibrated conflation verdict threaded,
      full_grade tracks the SEMANTIC axis (all 22 conflation=PASS -> full_grade
      reachable), NOT the prose-blind mechanical lint. Merge-silencing is caught
      by the semantic gate (proven on R5L890-FUSED in test_cert_assembler.py).

Emits a per-strategy before/after table to a-packet-22-table.json.
Run:  python docs/replay-results/h1-scripts/claude-rung-v32/run_a_packet_22.py
Exit non-zero if any strategy's mechanical lints are still NOT_EVALUATED after
the producer (an unclassified compile surprise).
"""

from __future__ import annotations

import glob
import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, "..", "..", "..", ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from src.engine.extraction import compile_lints as cl  # noqa: E402
from src.engine.extraction.cert_assembler import assemble_certificate  # noqa: E402
from src.engine.extraction.topology_producer import produce_topology  # noqa: E402
from src.engine.tests._a_packet_harness import build_inputs  # noqa: E402

_STRUCTURAL = ("direction_conflation_lint", "unsat_sat_check", "or_alternatives_honored")
_STAGING = os.path.join(
    _ROOT, "docs", "replay-results", "h1-scripts", "claude-rung-designpool", "staging_v32"
)
_CONFLATION = os.path.join(_HERE, "conflation_grades")
_ENUM = os.path.join(_HERE, "enum_semantic_grades")
_OUT = os.path.join(_HERE, "a-packet-22-table.json")


def _structural_statuses(cert: dict) -> dict:
    return {name: cert["compile_integrity"][name]["status"] for name in _STRUCTURAL}


def _calibrated_conflation_verdict(stub: str):
    """The panel's CALIBRATED semantic conflation verdict for this strategy, or
    None if the grade record is absent (then full_grade fail-closes, honestly)."""
    path = os.path.join(_CONFLATION, f"{stub}.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)["verdict"]["verdict"]


def _calibrated_enum_verdict(stub: str):
    """The CALIBRATED semantic enumeration-consistency verdict for this strategy,
    mapped to the assemble_certificate token ("PASS"/"FAIL"), or None if absent.
    The 22 are all `enumeration_consistent=true` (no variants -> trivially
    consistent) -> PASS, so full_grade is proven honest on BOTH semantic axes."""
    path = os.path.join(_ENUM, f"{stub}.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        consistent = json.load(fh)["verdict"].get("enumeration_consistent")
    if consistent is True:
        return "PASS"
    if consistent is False:
        return "FAIL"
    return None


def _one_strategy(strategy: dict, video_id: str, stub: str) -> dict:
    transcript, tier1, entries = build_inputs(strategy)
    topology, or_branches = produce_topology(strategy, entries)
    conflation = _calibrated_conflation_verdict(stub)
    enumeration = _calibrated_enum_verdict(stub)

    kwargs = dict(
        full_transcript=transcript,
        full_transcript_sha256="sha-designpool-v32",
        source_video_id=video_id,
        extractor_version="gpt-5.4:designpool-v32",
        taxonomy_version="taxonomy-v2",
        tier1_detections=tier1,
        tier1_fallthroughs=[],
    )

    before = assemble_certificate(**kwargs)  # topology-less
    after = assemble_certificate(
        **kwargs,
        topology=list(topology.values()),
        or_branches=or_branches,
        # R-039: full_grade gates on BOTH calibrated SEMANTIC axes
        conflation_verdict=conflation,
        enumeration_consistency_verdict=enumeration,
    )

    before_struct = _structural_statuses(before)
    after_struct = _structural_statuses(after)
    any_not_eval = any(s == cl.STATUS_NOT_EVALUATED for s in after_struct.values())

    classification = None
    if any_not_eval:
        classification = (
            "no_conditions_extracted" if not entries else "unexpected_not_evaluated"
        )

    return {
        "video_id": video_id,
        "strategy_name": strategy.get("name"),
        "condition_count": len(entries),
        "or_branch_count": len(or_branches),
        "calibrated_conflation_verdict": conflation,
        "calibrated_enumeration_verdict": enumeration,
        "before": {
            "structural": before_struct,
            "terminal_read_grade": before["terminal_read_grade"],
        },
        "after": {
            "structural": after_struct,
            "all_five": {
                name: after["compile_integrity"][name]["status"]
                for name in after["compile_integrity"]
            },
            "terminal_read_grade": after["terminal_read_grade"],
            "terminal_read_clean": after["terminal_read_clean"],
            "full_grade": after["full_grade"],
            "full_grade_basis": after["full_grade_basis"]["structural_gate"],
        },
        "structural_evaluate_after": not any_not_eval,
        "non_compilability_classification": classification,
    }


def main() -> int:
    files = sorted(glob.glob(os.path.join(_STAGING, "*.json")))
    rows = []
    for path in files:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
        stub = os.path.splitext(os.path.basename(path))[0]
        video_id = stub
        for strat in doc.get("strategies", []):
            rows.append(_one_strategy(strat, video_id, stub))

    n = len(rows)
    n_eval = sum(1 for r in rows if r["structural_evaluate_after"])
    n_before_indeterminate = sum(
        1 for r in rows if r["before"]["terminal_read_grade"] == "INDETERMINATE"
    )
    grade_hist: dict = {}
    for r in rows:
        g = r["after"]["terminal_read_grade"]
        grade_hist[g] = grade_hist.get(g, 0) + 1
    full_grade_hist: dict = {}
    for r in rows:
        g = str(r["after"]["full_grade"])
        full_grade_hist[g] = full_grade_hist.get(g, 0) + 1
    n_with_conflation = sum(1 for r in rows if r["calibrated_conflation_verdict"] is not None)
    n_with_enum = sum(1 for r in rows if r["calibrated_enumeration_verdict"] is not None)

    summary = {
        "artifact": "h1-a-packet-22-table",
        "packet": "h1-a-packet-full-grade-semantic-gate-amended-ratify-2026-07-18 (R-039)",
        "n_files": len(files),
        "n_strategies": n,
        "structural_evaluate_after_count": n_eval,
        "structural_not_evaluated_after_count": n - n_eval,
        "before_indeterminate_count": n_before_indeterminate,
        "after_terminal_grade_histogram": grade_hist,
        "strategies_with_calibrated_conflation_verdict": n_with_conflation,
        "strategies_with_calibrated_enumeration_verdict": n_with_enum,
        "after_full_grade_histogram": full_grade_hist,
        "definition_of_done_met": n_eval == n,
    }
    out = {"summary": summary, "strategies": rows}
    with open(_OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)

    print(json.dumps(summary, indent=2))
    print(f"\nper-strategy table written -> {_OUT}")
    unclassified = [
        r for r in rows if not r["structural_evaluate_after"] and not r["non_compilability_classification"]
    ]
    return 1 if unclassified else 0


if __name__ == "__main__":
    raise SystemExit(main())
