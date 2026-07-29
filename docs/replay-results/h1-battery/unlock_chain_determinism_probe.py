"""Does the LEDGER'S OWN generator reproduce its published chain on a re-run?

gen_ledger.py breaks the step-4 tie by whichever class Python's SET iteration
yields first. Python randomizes str hashing per process, so this is a MECHANISM
claim -- and a mechanism claim owes a measurement. This replays gen_ledger.py's
greedy loop VERBATIM (copied below) and reports the chain it emits.
"""
import json, os, sys
from collections import defaultdict

CEN = json.load(open("frozen/pop120_census.json", encoding="utf-8"))
CLS = json.load(open("frozen/pop120_classified.json", encoding="utf-8"))
cls_by_key = {(r["strategy_id"], r["condition_id"]): r["remediation_class"] for r in CLS}
seen, rows = set(), []
for s in CEN["strategies"]:
    if s["video"] in seen:
        continue
    seen.add(s["video"])
    for r in s["refusals"]:
        rows.append({"video": s["video"],
                     "remediation_class": cls_by_key[(r["strategy_id"], r["condition_id"])]})

# ---- verbatim from gen_ledger.py (the committed ledger's generator) ----------
byvid = defaultdict(set)
for r in rows:
    byvid[r["video"]].add(r["remediation_class"])
CLASSES = sorted({c for v in byvid.values() for c in v})
chosen, rem, step, chain = [], set(CLASSES), 0, []
while rem:
    best = None
    for c in rem:                                   # <-- SET iteration order
        cand = set(chosen) | {c}
        u = sum(1 for v, s in byvid.items() if s <= cand)
        if best is None or u > best[1]:             # <-- strict >, first max wins
            best = (c, u)
    chosen.append(best[0]); rem.discard(best[0]); step += 1
    chain.append(best[1] * 3)
# -----------------------------------------------------------------------------
print(f"PYTHONHASHSEED={os.environ.get('PYTHONHASHSEED','<random>')}  "
      f"chain={chain}  order={' '.join(c.split('_')[0] for c in chosen)}")
