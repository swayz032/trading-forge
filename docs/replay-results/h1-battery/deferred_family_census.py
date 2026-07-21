#!/usr/bin/env python3
"""Deferred-family census — WAIT_RETEST + WAIT_CONFIRMATION + FILTER (R-083 §5b / R-084 §5).

INVENTORY ONLY. Per R-084 §5 this may run with the OLD narration flag, and that column is
explicitly NON-LOAD-BEARING until the blind-authored replacement rule validates on virgin
territory. Nothing here may move a denominator.

Why it exists: R-082's ceiling census showed the DEFERRED families (46 conditions) are the
dominant bottleneck by spec count — 14 of 16 specs carry at least one, so they gate
eligibility harder than the structure decomposition does. This inventories what they
actually contain, so the confirmation_native design starts from evidence.

Imports its classifiers from wire1_structure_census.py rather than restating them, so the
two censuses cannot drift apart. Also carries the 4 mis-typed WAIT_SESSION conditions
(R-083 §2(i)) into the reclassification lane as a separate, labelled bucket.
"""

import importlib.util
import json
import os
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

# Import the sibling generator by path (it is an artifact script, not a package module).
_spec = importlib.util.spec_from_file_location(
    "wire1_census", os.path.join(HERE, "wire1_structure_census.py"))
_w1 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_w1)

# The PRODUCTION session resolver — imported, never re-implemented, so this census
# and the engine can never disagree about what counts as a session keyword.
import sys
sys.path.insert(0, ROOT)
from src.engine.spec_family_bindings import resolve_session_keyword as _w1_session_resolver

DEFERRED = {"WAIT_RETEST", "WAIT_CONFIRMATION", "FILTER"}
OUT = os.path.join(HERE, "deferred-family-census.json")

# R-083 §2(i) mis-types: WAIT_SESSION conditions carrying no session semantics.
#
# DERIVED, never transcribed. A hand-typed id list was tried first and was 50% wrong
# (two ids mis-copied at the truncation boundary) — the hand-copied-constant defect class,
# which fails silently by simply matching fewer rows. Deriving from the defect's own
# definition cannot drift, and carries forward unchanged to the tier-a corpus where
# R-083 §2(ii) registers this class for explicit hunting.
def is_mistyped_session(cond):
    """A WAIT_SESSION condition whose text resolves to no session zone at all."""
    if cond.get("type") != "WAIT_SESSION":
        return False
    return _w1_session_resolver(cond.get("object", "")) is None


def main():
    specs = sorted(
        os.path.join(ROOT, "docs/replay-results/h1-scripts/claude-rung-v32/shakedown_specs", f)
        for f in os.listdir(
            os.path.join(ROOT, "docs/replay-results/h1-scripts/claude-rung-v32/shakedown_specs"))
        if f.endswith(".spec.json"))

    rows, mistyped, seen = [], [], set()
    for path in specs:
        spec = json.load(open(path, encoding="utf-8"))
        for c in spec.get("spec", {}).get("entry_conditions", []):
            cid, ctype = c.get("id"), c.get("type")
            if cid in seen:
                continue
            in_deferred = ctype in DEFERRED
            in_mistyped = is_mistyped_session(c)
            if not (in_deferred or in_mistyped):
                continue
            seen.add(cid)
            obj = c.get("object", "")
            concepts = _w1.classify_concepts(obj)
            row = {
                "condition_id": cid,
                "file": os.path.basename(path),
                "type": ctype,
                "role": c.get("role"),
                "object": obj,
                "tf_class": _w1.classify_tf(obj),
                "concepts": concepts,
                "narration_candidate_OLD_RULE": not concepts,
            }
            (mistyped if in_mistyped else rows).append(row)

    n = len(rows)
    out = {
        "artifact": "deferred-family-census",
        "status": "INVENTORY ONLY — no denominator may move from this artifact",
        "generator": "docs/replay-results/h1-battery/deferred_family_census.py",
        "narration_column_caveat": (
            "narration_candidate_OLD_RULE is the PROXY-LABELED-AS-SEMANTIC flag "
            "(== concepts==[]), proven at ~50% false-positive by the R-081 blind grade. "
            "NON-LOAD-BEARING per R-084 §5; retained only so the replacement rule can be "
            "diffed against it. Do not quarantine anything on this column."),
        "families": sorted(DEFERRED),
        "n_deferred": n,
        "type_counts": dict(Counter(r["type"] for r in rows)),
        "tf_class_counts": dict(Counter(r["tf_class"] for r in rows)),
        "concept_counts": dict(Counter(c for r in rows for c in r["concepts"])),
        "n_empty_concepts": sum(1 for r in rows if not r["concepts"]),
        "specs_touched": len({r["file"] for r in rows}),
        "mistyped_session_carried": len(mistyped),
        "rows": rows,
        "mistyped_session_rows": mistyped,
    }
    json.dump(out, open(OUT, "w", encoding="utf-8", newline="\n"), indent=2)

    print(f"deferred conditions: {n} across {out['specs_touched']} specs "
          f"(+{len(mistyped)} mis-typed WAIT_SESSION carried)")
    for k, v in sorted(out["type_counts"].items(), key=lambda kv: -kv[1]):
        print(f"  {k:<20} {v:>3}")
    print("  --- tf_class ---")
    for k, v in sorted(out["tf_class_counts"].items(), key=lambda kv: -kv[1]):
        print(f"  {k:<20} {v:>3}  {v/n*100:5.1f}%")
    print("  --- concepts (multi-label) ---")
    for k, v in sorted(out["concept_counts"].items(), key=lambda kv: -kv[1]):
        print(f"  {k:<20} {v:>3}  {v/n*100:5.1f}%")
    print(f"  {'empty (OLD-rule narration cand)':<20} {out['n_empty_concepts']:>3}  "
          f"{out['n_empty_concepts']/n*100:5.1f}%   [NON-LOAD-BEARING]")


if __name__ == "__main__":
    main()
