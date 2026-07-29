"""ACCEPTANCE-GATE DIAGNOSTIC -- why my greedy chain diverged at steps 5-6.

Hypothesis H1: the census agrees; the published chain is ONE of several equally
greedy paths, selected by an arbitrary tie-break, and greedy-with-ties is not a
function of the census alone.
Falsification: force the PUBLISHED class order and recompute. If the published
numbers appear exactly, H1 holds and the census is exonerated.
"""
import json, itertools
from collections import defaultdict, Counter

CEN = json.load(open("frozen/pop120_census.json", encoding="utf-8"))
CLS = json.load(open("frozen/pop120_classified.json", encoding="utf-8"))

cls_by_key = {(r["strategy_id"], r["condition_id"]): r["remediation_class"] for r in CLS}
byvid = defaultdict(list)
for s in CEN["strategies"]:
    byvid[s["video"]].append(s)
reps = {v: rows[0] for v, rows in byvid.items()}
vid_classes = {}
for v, rep in reps.items():
    vid_classes[v] = {cls_by_key[(r["strategy_id"], r["condition_id"])] for r in rep["refusals"]}

SHORT = {c.split("_")[0]: c for c in {c for s in vid_classes.values() for c in s}}
def clean(cand):
    return sum(1 for s in vid_classes.values() if s <= set(cand))

PUB_ORDER = ["C8", "C3", "C2", "C7", "C1", "C4", "C5", "C6", "C9"]
PUB_CHAIN = [6, 15, 27, 39, 57, 75, 93, 111, 120]

print("=" * 74)
print("TEST 1 -- FORCE THE PUBLISHED CLASS ORDER, recompute cumulative from the census")
print("=" * 74)
cand, got_v, got_s = [], [], []
for sh in PUB_ORDER:
    cand.append(SHORT[sh])
    u = clean(cand)
    got_v.append(u); got_s.append(u * 3)
print(f"published order : {' '.join(PUB_ORDER)}")
print(f"videos          : {got_v}")
print(f"strategies      : {got_s}")
print(f"R-426 published : {PUB_CHAIN}")
print(f"EXACT MATCH     : {got_s == PUB_CHAIN}")

print()
print("=" * 74)
print("TEST 2 -- IS THE PUBLISHED ORDER ACTUALLY GREEDY AT EVERY STEP?")
print("=" * 74)
cand = []
for step, sh in enumerate(PUB_ORDER, 1):
    rem = [c for c in SHORT.values() if c not in cand]
    scored = sorted(((clean(cand + [c]), c) for c in rem), reverse=True)
    best = scored[0][0]
    picked = clean(cand + [SHORT[sh]])
    tied = [c.split("_")[0] for u, c in scored if u == best]
    ok = "greedy-optimal" if picked == best else f"NOT GREEDY (best available {best})"
    print(f" step {step}: picked {sh:3s} -> {picked:2d} videos | best {best:2d} | tied@best: "
          f"{','.join(sorted(tied))} | {ok}")
    cand.append(SHORT[sh])

print()
print("=" * 74)
print("TEST 3 -- HOW MANY DISTINCT CHAINS ARE 'GREEDY'? (enumerate every tie path)")
print("=" * 74)
paths = []
def walk(cand, chain, order):
    rem = [c for c in SHORT.values() if c not in cand]
    if not rem:
        paths.append((tuple(chain), tuple(order)))
        return
    scored = [(clean(cand + [c]), c) for c in rem]
    best = max(u for u, _ in scored)
    for u, c in scored:
        if u == best:
            walk(cand + [c], chain + [u * 3], order + [c.split("_")[0]])
walk([], [], [])
distinct = sorted({p[0] for p in paths})
print(f"distinct greedy PATHS  = {len(paths)}")
print(f"distinct greedy CHAINS = {len(distinct)}")
for ch in distinct:
    ords = sorted({" ".join(o) for c, o in paths if c == ch})
    tag = "  <== R-426 PUBLISHED" if list(ch) == PUB_CHAIN else ""
    print(f"  {list(ch)}  via {len(ords)} order(s){tag}")
print()
print("STEP-5 VALUE across greedy chains: "
      f"{sorted({ch[4] for ch in distinct})}  -- the chain is NOT unique at step 5.")

print()
print("=" * 74)
print("TEST 4 -- ORDER-FREE INVARIANTS (what the census says regardless of tie-break)")
print("=" * 74)
print(f" videos clean with NOTHING remediated      : {clean([])}")
print(f" videos clean with C8 alone                : {clean([SHORT['C8']])}")
print(f" videos clean with ALL nine               : {clean(list(SHORT.values()))}")
print(f" every greedy chain starts at 6 strategies : {all(ch[0] == 6 for ch in distinct)}")
print(f" every greedy chain ends at 120 strategies : {all(ch[-1] == 120 for ch in distinct)}")
print(f" steps 1-4 identical across chains         : {len({ch[:4] for ch in distinct}) == 1}")
# The TRUE optimum at each k, independent of greedy:
print()
print(" TRUE MAXIMUM videos clean for the best k-subset (exhaustive, not greedy):")
allc = list(SHORT.values())
for k in range(1, 10):
    best = max((clean(list(c)), tuple(sorted(x.split('_')[0] for x in c)))
               for c in itertools.combinations(allc, k))
    print(f"   k={k}: {best[0]:2d} videos / {best[0]*3:3d} strategies   via {','.join(best[1])}")
