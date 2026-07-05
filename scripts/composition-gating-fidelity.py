#!/usr/bin/env python3
"""composition-gating-fidelity.py — Step 2 coverage control for the Composition Fidelity
Experiment (docs/designs/composition-fidelity-experiment-2026-07-05.md).

Reads Step 0's output (scripts/composition-gating-diagnostic.json) and, for every VALIDATED
strategy, recomputes its binding plan with TF_COMPOSITION_BUNDLE_ENABLED=true and
restore_condition_ids = exactly that strategy's own gating-set condition ids (never more, never
less — per-strategy targeted, the single-variable contract). Measures:

  gating_fidelity = (# of the strategy's OWN gating-set conditions now bound to a native bundle
                      primitive, approximation=False) / (size of that strategy's gating set)

PRIMARY TEST SET = strategies reaching gating_fidelity >= PRIMARY_FIDELITY_THRESHOLD (0.80, per the
locked spec). Strategies below the threshold are EXCLUDED from the primary set and reported as a
finding (their gating set names OBJECTS this pass's 5 native evaluators don't cover — e.g. "volume
profile", "vwap", "order block" — an honest gap, not fudged).

Also verifies the non-target / non-gating-sibling byte-identical proof at scale: for every strategy,
every spine condition NOT in its own gating set keeps `approximation` IDENTICAL between the
before/after binding plans (single-variable proof, corpus-wide).

Usage:
  PYTHONPATH=. python scripts/composition-gating-fidelity.py \\
      --diagnostic docs/replay-results/composition-gating-diagnostic.json \\
      --strategies docs/designs/corpus-v2-mode-ab-strategies.json \\
      --out docs/replay-results/composition-gating-fidelity.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # repo root on sys.path

from src.engine.spec_family_bindings import compile_binding_plan  # noqa: E402

PRIMARY_FIDELITY_THRESHOLD: float = 0.80


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--diagnostic", default="docs/replay-results/composition-gating-diagnostic.json")
    ap.add_argument("--strategies", default="docs/designs/corpus-v2-mode-ab-strategies.json")
    ap.add_argument("--out", default="docs/replay-results/composition-gating-fidelity.json")
    args = ap.parse_args()

    diagnostic = json.loads(Path(args.diagnostic).read_text(encoding="utf-8"))
    corpus = json.loads(Path(args.strategies).read_text(encoding="utf-8"))
    spec_by_name = {e["strategy"]["name"]: e["compiled_spec"]["spec"] for e in corpus}

    os.environ["TF_COMPOSITION_BUNDLE_ENABLED"] = "true"

    per_strategy: list[dict] = []
    families_in_primary: set[str] = set()

    for rec in diagnostic["per_strategy"]:
        name = rec["name"]
        gating = rec.get("gating", {})
        out: dict = {"name": name, "symbol": rec.get("symbol"), "timeframe": rec.get("timeframe"), "family": rec.get("family")}

        if rec.get("error") or not gating.get("validated"):
            out.update({"eligible": False, "reason": rec.get("error") or gating.get("reason") or "gating_not_validated", "gating_fidelity": None})
            per_strategy.append(out)
            continue

        spec = spec_by_name.get(name)
        if spec is None:
            out.update({"eligible": False, "reason": "spec_not_found_in_corpus_file", "gating_fidelity": None})
            per_strategy.append(out)
            continue

        gating_ids = gating["gating_condition_ids"]
        restore_set = frozenset(gating_ids)

        plan_before = compile_binding_plan(spec)  # restore_condition_ids=None -> baseline, unaffected by env flag
        plan_after = compile_binding_plan(spec, restore_condition_ids=restore_set)

        by_id_before = {b.condition_id: b for b in plan_before.bindings}
        by_id_after = {b.condition_id: b for b in plan_after.bindings}

        n_restored = 0
        restored_objects: list[dict] = []
        unrestored_objects: list[dict] = []
        for cid in gating_ids:
            b_after = by_id_after.get(cid)
            if b_after is not None and b_after.approximation is False and b_after.bindable:
                n_restored += 1
                restored_objects.append({"condition_id": cid, "type": b_after.type, "object": b_after.object, "primitive": b_after.primitive})
            elif b_after is not None:
                unrestored_objects.append({"condition_id": cid, "type": b_after.type, "object": b_after.object})

        gating_fidelity = round(n_restored / len(gating_ids), 4) if gating_ids else None

        # Non-target / non-gating-sibling byte-identical proof: every spine condition OUTSIDE
        # this strategy's own gating set must be identical before vs after.
        non_gating_diffs = []
        for cid, b_before in by_id_before.items():
            if cid in restore_set:
                continue
            b_after = by_id_after.get(cid)
            if b_after is None or b_before.to_dict() != b_after.to_dict():
                non_gating_diffs.append(cid)

        eligible = gating_fidelity is not None and gating_fidelity >= PRIMARY_FIDELITY_THRESHOLD
        out.update(
            {
                "eligible": eligible,
                "reason": None if eligible else "below_primary_fidelity_threshold",
                "gating_set_size": len(gating_ids),
                "n_restored": n_restored,
                "gating_fidelity": gating_fidelity,
                "restored_objects": restored_objects,
                "unrestored_objects": unrestored_objects,
                "non_gating_byte_identical": len(non_gating_diffs) == 0,
                "non_gating_diffs": non_gating_diffs,
            }
        )
        per_strategy.append(out)
        if eligible:
            families_in_primary.add(rec.get("family"))

    n_eligible = sum(1 for r in per_strategy if r.get("eligible"))
    n_byte_identical_violations = sum(
        1 for r in per_strategy if r.get("non_gating_byte_identical") is False
    )

    report = {
        "primary_fidelity_threshold": PRIMARY_FIDELITY_THRESHOLD,
        "n_strategies_evaluated": len(per_strategy),
        "n_eligible_primary_set": n_eligible,
        "n_families_in_primary_set": len(families_in_primary),
        "families_in_primary_set": sorted(families_in_primary),
        "n_non_gating_byte_identical_violations": n_byte_identical_violations,
        "per_strategy": per_strategy,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")

    print(
        f"primary set: {n_eligible}/{len(per_strategy)} strategies reach gating_fidelity >= "
        f"{PRIMARY_FIDELITY_THRESHOLD:.0%}, spanning {len(families_in_primary)} families",
        file=sys.stderr,
    )
    print(f"non-gating byte-identical violations: {n_byte_identical_violations} (must be 0)", file=sys.stderr)
    print(f"wrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
