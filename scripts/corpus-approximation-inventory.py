"""
Approximation inventory — the execution-fidelity "miss-matrix".

96.6% of corpus spine bindings are approximations (generic proxies). This ranks
WHICH educator concepts are being collapsed, so native-evaluator work is
prioritized by breadth (how many strategies each fix touches), not guesswork —
the execution-fidelity analogue of scripts/extraction-miss-matrix.ts.

For every approximated spine binding it recovers (condition_type, object,
primitive) by joining the BindingPlan (compile_binding_plan) back to the spec's
entry_conditions by condition id. Aggregates by:
  (a) condition_type -> generic primitive  (the approximation BUCKETS)
  (b) object token within each bucket        (the distinct educator concepts collapsed)
  (c) per-token strategy BREADTH             (# strategies a native evaluator would touch)

Pure/offline. Reads {strategy_id: compiled_spec.spec}.
  PYTHONPATH=. PYTHONUTF8=1 python scripts/corpus-approximation-inventory.py \\
      --specs <specs.json> --out docs/replay-results/approximation-inventory-2026-07-04.json
"""
import argparse
import json
import re
from collections import Counter, defaultdict

from src.engine.spec_family_bindings import compile_binding_plan

_STOP = {"the", "a", "an", "of", "to", "in", "on", "at", "and", "or", "is", "with", "for", "from", "my", "i"}


def norm_object(obj: str) -> str:
    """Collapse an educator object phrase to a concept token (lowercased, stopword-stripped, short)."""
    words = [w for w in re.split(r"[^a-z0-9]+", (obj or "").lower()) if w and w not in _STOP]
    return " ".join(words[:4]) or "(empty)"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--specs", required=True)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    specs = json.load(open(args.specs, encoding="utf-8"))

    by_type_prim = Counter()          # (condition_type -> primitive) approximation count
    token_count = Counter()           # object token -> total approximated bindings
    token_strats = defaultdict(set)   # object token -> set of strategy ids (breadth)
    token_types = defaultdict(Counter)
    n_specs = 0

    for sid, spec in specs.items():
        try:
            bp = compile_binding_plan(spec)
        except Exception:
            continue
        n_specs += 1
        # id -> (type, object) from the spec's stated conditions
        cond = {}
        for c in spec.get("entry_conditions", []):
            cid = c.get("id") or c.get("condition_id")
            if cid:
                cond[cid] = (c.get("type", "?"), c.get("object", ""))
        for b in bp.bindings:
            if b.role != "spine" or not getattr(b, "approximation", False):
                continue
            ctype, obj = cond.get(b.condition_id, ("?", ""))
            by_type_prim[(ctype, getattr(b, "primitive", "?"))] += 1
            tok = norm_object(obj)
            token_count[tok] += 1
            token_strats[tok].add(sid)
            token_types[tok][ctype] += 1

    print(f"specs analyzed: {n_specs}\n")
    print("=== approximation BUCKETS (condition_type -> generic primitive) ===")
    for (ct, prim), n in by_type_prim.most_common(12):
        print(f"  {n:4d}  {ct:20s} -> {prim}")
    print("\n=== top collapsed OBJECT tokens by strategy BREADTH (build native evaluators here first) ===")
    ranked = sorted(token_strats.items(), key=lambda kv: (-len(kv[1]), -token_count[kv[0]]))
    for tok, strats in ranked[:20]:
        types = ",".join(f"{t}:{c}" for t, c in token_types[tok].most_common(2))
        print(f"  breadth={len(strats):3d} strategies  count={token_count[tok]:4d}  [{types}]  '{tok}'")

    if args.out:
        out = {
            "specs_analyzed": n_specs,
            "buckets": [{"type": ct, "primitive": p, "count": n} for (ct, p), n in by_type_prim.most_common()],
            "tokens": [
                {"token": t, "breadth": len(token_strats[t]), "count": token_count[t],
                 "types": dict(token_types[t])}
                for t in sorted(token_strats, key=lambda k: (-len(token_strats[k]), -token_count[k]))
            ],
        }
        json.dump(out, open(args.out, "w", encoding="utf-8"), indent=1)
        print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
