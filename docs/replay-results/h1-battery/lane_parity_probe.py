"""R-424 item (4): per-condition lane diff of corpus_A.

Loads the SAME 16 *.spec.json files and calls the SAME primitive
(`bind_condition`) the canonical instrument uses
(dual_denominator_remeasure.py:4085), but imports the engine from whichever
tree is passed as argv[1]. Flags left at production default (OFF).

Metric replicated verbatim from measure_corpus_a:
    taught  = every entry_condition
    bound   = bindable
    approx  = bindable AND approximation
    bound_and_concrete = bound - approx
"""
import glob
import json
import os
import sys
from pathlib import Path

TREE = Path(sys.argv[1])
OUT = sys.argv[2]
CORPUS_GLOB = sys.argv[3]

# Import the engine from THIS tree only.
sys.path.insert(0, str(TREE))
import src.engine.spec_family_bindings as sfb  # noqa: E402

rows = {}
taught = bound = approx = 0
for p in sorted(glob.glob(CORPUS_GLOB)):
    d = json.loads(Path(p).read_text(encoding="utf-8"))
    name = os.path.basename(p).replace(".spec.json", "")
    for c in d["spec"]["entry_conditions"]:
        taught += 1
        b = sfb.bind_condition(c)
        key = f"{name}|{c.get('id')}"
        rows[key] = {
            "bindable": bool(b.bindable),
            "approximation": bool(b.approximation),
            "primitive": getattr(b, "primitive", None),
            "type": c.get("type"),
            "role": c.get("role"),
        }
        if not b.bindable:
            continue
        bound += 1
        if b.approximation:
            approx += 1

summary = {
    "tree": str(TREE),
    "engine_file_bytes": (TREE / "src/engine/spec_family_bindings.py").stat().st_size,
    "n_specs": len(sorted(glob.glob(CORPUS_GLOB))),
    "n_taught": taught,
    "n_bindable": bound,
    "n_binding_approximation": approx,
    "n_bound_and_concrete": bound - approx,
}
Path(OUT).write_text(json.dumps({"summary": summary, "rows": rows}, indent=1), encoding="utf-8")
print(json.dumps(summary, indent=1))
