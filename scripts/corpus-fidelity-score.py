"""
Execution Fidelity Score — corpus-level report (first pass).

The one metric the 2026-07-04 Mode A/B result demanded: for each compiled
strategy, how much of the educator's CORE (spine) logic runs as a native
evaluator vs a generic approximation vs is dropped. Distinguishes
"failed because the idea has no edge" from "failed because only ~half of what
the educator taught could actually be executed."

  fidelity_score = (faithful_spine + 0.5 * approximated_spine) / spine_total
    faithful   = spine binding, approximation=False  (native evaluator)
    approx     = spine binding, approximation=True    (generic proxy) -> 0.5
    dropped    = spine step with no binding            (primitive=None) -> 0.0

Reads specs from a JSON map {strategy_id: compiled_spec.spec} (export with the
companion node one-liner). Pure/offline — calls
src.engine.spec_family_bindings.compile_binding_plan(). No DB, no backtest.

This is the LIGHT first pass. Wave C (the Fidelity Verdict, docs/superpowers/
specs/2026-07-03-fidelity-verdict-design.md) is the productionized version:
emit + persist the verdict at backtest time and gate admissibility so a
low-fidelity backtest is quarantined as "tests our approximation, not his idea."

Usage:
  PYTHONPATH=. PYTHONUTF8=1 python scripts/corpus-fidelity-score.py \\
      --specs /tmp/corpus-specs.json --out docs/replay-results/corpus-fidelity-2026-07-04.json
"""
import argparse
import json
from collections import Counter

from src.engine.spec_family_bindings import compile_binding_plan


def score_spec(spec: dict) -> dict:
    bp = compile_binding_plan(spec)
    spine_total = bp.spine_total or 0
    approx = sum(1 for b in bp.bindings if getattr(b, "approximation", False) and b.role == "spine")
    faithful = bp.spine_bound - approx
    dropped = spine_total - bp.spine_bound
    score = None if spine_total == 0 else round((faithful + 0.5 * approx) / spine_total, 3)
    return {
        "fidelity_score": score,
        "spine_total": spine_total,
        "spine_bound": bp.spine_bound,
        "faithful": faithful,
        "approximated": approx,
        "dropped": dropped,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--specs", required=True, help="JSON map {strategy_id: compiled_spec.spec}")
    ap.add_argument("--out", default=None, help="write per-strategy report JSON")
    args = ap.parse_args()

    specs = json.load(open(args.specs, encoding="utf-8"))
    report = {}
    for sid, spec in specs.items():
        try:
            report[sid] = score_spec(spec)
        except Exception as e:  # noqa: BLE001 — fail-loud per strategy, never fabricate a score
            report[sid] = {"fidelity_score": None, "error": str(e)[:80]}

    scores = sorted(v["fidelity_score"] for v in report.values() if v.get("fidelity_score") is not None)
    n = len(scores)
    tot_bound = sum(v.get("spine_bound", 0) for v in report.values() if v.get("fidelity_score") is not None)
    tot_spine = sum(v.get("spine_total", 0) for v in report.values() if v.get("fidelity_score") is not None)
    tot_approx = sum(v.get("approximated", 0) for v in report.values() if v.get("fidelity_score") is not None)

    def tier(s: float) -> str:
        return "high>=0.85" if s >= 0.85 else "mid_0.6-0.85" if s >= 0.6 else "low<0.6"

    summary = {
        "n_scored": n,
        "min": scores[0] if n else None,
        "median": scores[n // 2] if n else None,
        "max": scores[-1] if n else None,
        "tiers": dict(Counter(tier(s) for s in scores)),
        "corpus_spine_bound_pct": round(100 * tot_bound / tot_spine, 1) if tot_spine else None,
        "corpus_approximated_of_bound_pct": round(100 * tot_approx / tot_bound, 1) if tot_bound else None,
    }
    print(json.dumps(summary, indent=2))

    if args.out:
        json.dump({"summary": summary, "per_strategy": report}, open(args.out, "w", encoding="utf-8"), indent=1)
        print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
