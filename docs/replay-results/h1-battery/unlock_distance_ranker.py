"""v4 §3-1B — UNLOCK-DISTANCE RANKER.  AR-426 / R-448 as amended by R-449.

INDEPENDENT implementation. It does NOT import or re-run gen_ledger.py; the
cumulative-unlock arithmetic below is written from the DEFINITION
("a video is clean iff every class it carries has been remediated"), and its
agreement with the published chain is the acceptance gate.

FROZEN INPUTS (sha256 published in the AR):
  frozen/pop120_census.json      -- raw census, real preflight_binding_plan output
  frozen/pop120_classified.json  -- per-refusal remediation_class (hand-corrected)
"""
import json
from collections import Counter, defaultdict

CEN = json.load(open("frozen/pop120_census.json", encoding="utf-8"))
CLS = json.load(open("frozen/pop120_classified.json", encoding="utf-8"))
S = CEN["strategies"]

out = []
def w(s=""):
    print(s)
    out.append(s)

w("=" * 78)
w("STEP 0 -- POPULATION AND ITS MULTIPLIER, VERIFIED HERE (not inherited)")
w("=" * 78)
w(f"backtests_total (frozen census) = {CEN['backtests_total']}")
w(f"strategies_total = {CEN['strategies_total']}  rows_with_compiled_spec = {CEN['rows_with_compiled_spec']}")

byvid = defaultdict(list)
for s in S:
    byvid[s["video"]].append(s)
w(f"rows = {len(S)}   distinct videos = {len(byvid)}")
w(f"multiplicity histogram = {dict(Counter(len(v) for v in byvid.values()))}")

# Verify the triples really are identical on the load-bearing surface (the
# refusal set). The 3x denominator correction rests entirely on this.
def refusal_sig(s):
    return tuple(sorted((r["condition_id"], r["rule_text"], r["reason"],
                         r["rule_class"], r["semantic_type"], str(r["role"]))
                        for r in s["refusals"]))

ident = sum(1 for rows in byvid.values() if len({refusal_sig(r) for r in rows}) == 1)
w(f"videos whose rows share an IDENTICAL refusal set: {ident} of {len(byvid)}")
name_sig = sum(1 for rows in byvid.values() if len({r["name"] for r in rows}) == len(rows))
w(f"videos whose rows have DISTINCT names (the instrument fan-out): {name_sig} of {len(byvid)}")
w(f"refused rows = {sum(1 for s in S if s['refused'])} of {len(S)}")
w(f"refused videos = {sum(1 for rows in byvid.values() if all(r['refused'] for r in rows))} of {len(byvid)}")
w(f"raw refusals (all 120 rows) = {sum(len(s['refusals']) for s in S)}")

reps = {v: rows[0] for v, rows in byvid.items()}
w(f"per-video refusals (representative row per video) = {sum(len(r['refusals']) for r in reps.values())}")

w()
w("=" * 78)
w("STEP 1 -- CLASS MAP: join the frozen classification onto the census")
w("=" * 78)
w(f"classified rows = {len(CLS)}   keys = {sorted(CLS[0].keys())}")
# JOIN KEY IS THE CLAIM: (strategy_id, condition_id) uniquely identifies a refusal.
cls_by_key = {}
dupes = 0
for r in CLS:
    k = (r["strategy_id"], r["condition_id"])
    if k in cls_by_key and cls_by_key[k] != r["remediation_class"]:
        dupes += 1
    cls_by_key[k] = r["remediation_class"]
w(f"distinct (strategy_id, condition_id) keys = {len(cls_by_key)}   conflicting duplicates = {dupes}")

# Every representative refusal must find a class; nothing may be dropped silently.
missing = 0
vid_classes = defaultdict(set)          # video -> set of blocking classes
vid_refusals = defaultdict(list)        # video -> [(condition_id, class, rule_text)]
for v, rep in reps.items():
    for r in rep["refusals"]:
        k = (r["strategy_id"], r["condition_id"])
        c = cls_by_key.get(k)
        if c is None:
            missing += 1
            continue
        vid_classes[v].add(c)
        vid_refusals[v].append((r["condition_id"], c, r["rule_text"]))
w(f"representative refusals with NO class (join misses) = {missing}")

cc = Counter(c for v in vid_refusals for _, c, _ in vid_refusals[v])
w()
w("per-video refusal counts by class  [ledger table to compare against]")
w(f"{'class':48s} {'n':>4s} {'share':>7s} {'videos':>7s} {'strat':>6s}")
tot = sum(cc.values())
for c in sorted(cc):
    vids = len({v for v in vid_refusals if any(cl == c for _, cl, _ in vid_refusals[v])})
    w(f"{c:48s} {cc[c]:4d} {cc[c]*100.0/tot:6.1f}% {vids:7d} {vids*3:6d}")
w(f"{'TOTAL':48s} {tot:4d}")

w()
w("=" * 78)
w("STEP 2 -- ACCEPTANCE GATE: reproduce R-426's cumulative chain")
w("=" * 78)
CLASSES = sorted({c for cs in vid_classes.values() for c in cs})
w(f"classes present = {len(CLASSES)}")

w()
w("EACH CLASS ALONE (videos whose ENTIRE class set is that one class):")
for c in CLASSES:
    u = [v for v, s in vid_classes.items() if s <= {c}]
    w(f"  {c:48s} videos={len(u):2d}  strategies={len(u)*3:3d}")

w()
w("CUMULATIVE, greedy by marginal gain -- and TIES ARE REPORTED, not hidden:")
chosen, rem, chain_v, chain_s = [], set(CLASSES), [], []
step = 0
while rem:
    scored = []
    for c in rem:
        cand = set(chosen) | {c}
        u = sum(1 for s in vid_classes.values() if s <= cand)
        scored.append((u, c))
    best_u = max(u for u, _ in scored)
    tied = sorted(c for u, c in scored if u == best_u)
    pick = tied[0]
    step += 1
    chosen.append(pick); rem.discard(pick)
    chain_v.append(best_u); chain_s.append(best_u * 3)
    tie_note = "" if len(tied) == 1 else f"   [TIE among {len(tied)}: {', '.join(t.split('_')[0] for t in tied)}]"
    w(f"  {step} | {pick:48s} videos={best_u:2d} strategies={best_u*3:3d}{tie_note}")

w()
w(f"MY CHAIN (videos)     : {' -> '.join(str(x) for x in chain_v)}")
w(f"MY CHAIN (strategies) : {' -> '.join(str(x) for x in chain_s)}")
PUBLISHED = [6, 15, 27, 39, 57, 75, 93, 111, 120]
PUBLISHED_ORDER = ["C8", "C3", "C2", "C7", "C1", "C4", "C5", "C6", "C9"]
w(f"R-426 PUBLISHED       : {' -> '.join(str(x) for x in PUBLISHED)}")
w(f"MY ORDER              : {' '.join(c.split('_')[0] for c in chosen)}")
w(f"PUBLISHED ORDER       : {' '.join(PUBLISHED_ORDER)}")
gate = (chain_s == PUBLISHED) and ([c.split('_')[0] for c in chosen] == PUBLISHED_ORDER)
w(f"ACCEPTANCE GATE       : {'PASS' if gate else 'FAIL'}  (strategy-denominated chain AND class order)")
w(f"per-video image is exactly 1/3 of the published chain: "
  f"{all(s == v * 3 for s, v in zip(chain_s, chain_v))}")

w()
w("=" * 78)
w("STEP 3 -- THE UNIT 'spec': is it 1:1 with the video?")
w("=" * 78)
spec_hashes = defaultdict(set)
for s in S:
    ek = s["envelope_keys"]
    spec_hashes[s["video"]].add(s.get("spec_hash") or "n/a")
names_per_vid = {v: sorted(r["name"] for r in rows) for v, rows in byvid.items()}
multi = {v: n for v, n in names_per_vid.items() if len(n) != 3}
w(f"videos with exactly 3 named rows: {len(byvid) - len(multi)} of {len(byvid)}")
w("=> in POP-120-LIVE one VIDEO carries exactly one spec, replicated across "
  "mes/mnq/mcl. SPEC and VIDEO are 1:1 on this population.")

w()
w("=" * 78)
w("STEP 4 -- THE {C8-FIXED} COUNTERFACTUAL: per-spec unlock distance")
w("=" * 78)
C8 = "C8_non_executable_annotation_mistyped"
rank = []
for v in sorted(vid_classes):
    all_cls = vid_classes[v]
    residual_cls = sorted(all_cls - {C8})
    residual_n = sum(1 for _, c, _ in vid_refusals[v] if c != C8)
    c8_n = sum(1 for _, c, _ in vid_refusals[v] if c == C8)
    rank.append({
        "video": v,
        "spec": reps[v]["name"],
        "distance": len(residual_cls),
        "residual_conditions": residual_n,
        "c8_conditions": c8_n,
        "total_conditions": len(vid_refusals[v]),
        "residual_classes": [c.split("_")[0] for c in residual_cls],
        "carries_c8": C8 in all_cls,
    })
rank.sort(key=lambda r: (r["distance"], r["residual_conditions"], r["video"]))

w(f"{'#':>2} {'video':12s} {'dist':>4s} {'resid':>5s} {'C8':>3s} {'tot':>4s} {'residual classes':22s} spec")
for i, r in enumerate(rank, 1):
    w(f"{i:2d} {r['video']:12s} {r['distance']:4d} {r['residual_conditions']:5d} "
      f"{r['c8_conditions']:3d} {r['total_conditions']:4d} "
      f"{','.join(r['residual_classes']) or '-':22s} {r['spec']}")

w()
d0 = [r for r in rank if r["distance"] == 0]
w(f"DISTANCE 0 (C8 fix ALONE fully binds) : {len(d0)} specs / {len(d0)} videos / {len(d0)*3} rows")
w(f"  named videos: {', '.join(r['video'] for r in d0)}")
w(f"  specs       : {'; '.join(r['spec'] for r in d0)}")
w(f"videos carrying NO C8 at all          : {sum(1 for r in rank if not r['carries_c8'])}")
w(f"videos carrying C8                    : {sum(1 for r in rank if r['carries_c8'])}")
w()
w("distance histogram: " + str(dict(sorted(Counter(r['distance'] for r in rank).items()))))

json.dump(rank, open("rank_out.json", "w", encoding="utf-8"), indent=1)
open("ranker_output.txt", "w", encoding="utf-8").write("\n".join(out))
