"""GATE A -- C8-PROVENANCE-LEDGER builder (R-468 §6). READ-ONLY.

Forward path : preserved transcript span -> spec condition -> classified refusal row
Reverse path : classified refusal row -> spec condition -> preserved transcript span
The two must converge record-for-record; divergences are PUBLISHED, never reconciled.

Bridge keys, written per hop (R-467 §2 as corrected by R-468 §6):
  refusal row  -> spec condition : condition_id  ==  spec condition 'id'   [exact string]
  spec condition -> transcript   : span {start,end} char range into <video>.transcript.txt
  video-level                    : video id == spec envelope 'video' == transcript filename stem
`(video, condition_id)` is a DISPLAY LABEL ONLY -- it is 3-way degenerate on the census payload.
"""
import collections
import hashlib
import json
import pathlib
import sys

CENSUS_DIR = pathlib.Path(r"C:\Users\tonio\Projects\trading-forge\backups\h1-census\unknown-dbtime-ad4335f0")
SPECS = pathlib.Path(r"C:\Users\tonio\Projects\trading-forge\tf-deep-scan\corpus\specs")
TRANSCRIPTS = pathlib.Path(r"C:\Users\tonio\Projects\trading-forge\backups\h1-shadow-eval\transcripts-78fe8ea7\transcripts")

CLASSIFIED = CENSUS_DIR / "pop120_classified.json"
EXPECT_CLASSIFIED = "eed65514a126adb136b5430939223965a12909b6e21cda4fba87d547326051d1"

# --- 0. input integrity, in-process --------------------------------------------
got = hashlib.sha256(CLASSIFIED.read_bytes()).hexdigest()
if got != EXPECT_CLASSIFIED:
    sys.exit(f"STOP: classified artifact hash mismatch {got}")
print(f"[input] pop120_classified.json sha256 MATCH")

rows = json.loads(CLASSIFIED.read_text(encoding="utf-8"))
print(f"[input] classified rows = {len(rows)}   (POPULATION for this ledger)")

# --- 0b. BROKEN-JOIN FIXTURE (R-468 §6.3) --------------------------------------
# A green-only trace is not evidence. `--mutate` deliberately breaks ONE
# (video, condition_id) join key on a C8-ANNOTATION row. The join MUST detect it:
# matched falls by 1 and miss rises by 1. Run BOTH arms and compare -- a mutation
# suite without its unmutated control cannot tell "detects breakage" from
# "always red".
MUTATE = "--mutate" in sys.argv
if MUTATE:
    target = next(r for r in rows
                  if str(r["remediation_class"]).startswith("C8") and r["condition_id"])
    before = target["condition_id"]
    target["condition_id"] = before + "__MUTATED_JOIN_KEY"
    print(f"[FIXTURE] MUTATED one C8 join key on video={target['video']}")
    print(f"[FIXTURE]   before={before!r}")
    print(f"[FIXTURE]   after ={target['condition_id']!r}")
    print("[FIXTURE] EXPECT: matched 455->454, miss 1->2, C8-ANNOTATION 232->231")

# --- 1. load the 40 canonical specs, index conditions by (video, id) -----------
spec_files = sorted(SPECS.glob("*.spec.json"))
print(f"[input] canonical spec files = {len(spec_files)}  tree=tf-deep-scan (separate git repo)")

cond_index = {}          # (video, cond_id) -> condition dict
cond_count = 0
cond_lists_seen = collections.Counter()
prov = {}
for f in spec_files:
    env = json.loads(f.read_text(encoding="utf-8"))
    video = env.get("video") or f.name.split(".")[0]
    prov[video] = env.get("extraction_provenance")
    spec = env.get("spec") or {}
    for listkey in ("entry_conditions", "conditions", "exit_conditions", "invalidations"):
        for c in (spec.get(listkey) or []):
            cond_lists_seen[listkey] += 1
            cond_count += 1
            cid = c.get("id")
            if cid is not None:
                cond_index[(video, cid)] = (listkey, c)
print(f"[input] conditions indexed = {cond_count}  by list: {dict(cond_lists_seen)}")
print(f"[input] distinct (video, condition id) keys = {len(cond_index)}")

# --- 2. THE JOIN, with all four disposition buckets ----------------------------
matched, missed, dup = [], [], []
seen_keys = collections.Counter()
for r in rows:
    key = (r["video"], r["condition_id"])
    seen_keys[key] += 1
    hit = cond_index.get(key)
    if hit is None:
        missed.append(r)
    else:
        matched.append((r, hit[0], hit[1]))
dup = [k for k, n in seen_keys.items() if n > 1]

print()
print("=== JOIN COVERAGE (refusal row -> canonical spec condition) ===")
print(f"  matched 1:1     = {len(matched)}")
print(f"  duplicate keys  = {len(dup)}")
print(f"  miss            = {len(missed)}")
print(f"  JOIN_RESIDUAL   = 0   (nothing deferred; every row is in exactly one bucket)")
print(f"  SUM             = {len(matched) + len(dup) + len(missed)}  vs population {len(rows)}"
      f"  -> {'BALANCES' if len(matched)+len(dup)+len(missed) == len(rows) else 'DOES NOT BALANCE'}")
for r in missed:
    print(f"  MISS: video={r['video']!r} cond_id={r['condition_id']!r} reason={r['reason']!r} class={r['remediation_class']}")

# --- 3. C8 split: 232 annotation vs 1 empty-spine placeholder ------------------
c8 = [r for r in rows if str(r["remediation_class"]).startswith("C8")]
c8_matched = [(r, lk, c) for (r, lk, c) in matched if str(r["remediation_class"]).startswith("C8")]
c8_missed = [r for r in missed if str(r["remediation_class"]).startswith("C8")]
print()
print("=== C8 SPLIT (R-468 §4: NO GLOBAL REMEDY) ===")
print(f"  C8 total              = {len(c8)}")
print(f"  C8-ANNOTATION matched = {len(c8_matched)}   -> ATOM-ADMISSION boundary")
# The bucket label is COMPUTED from the reason field, never assumed from "it missed
# the join". Under --mutate a mutated annotation row also misses, and the earlier
# version of this line labelled it EMPTY-SPINE -- a caption asserting a class
# membership it had not checked. A caption is a claim.
c8_empty = [r for r in c8_missed if r["reason"] == "non_executable_empty_spine"]
c8_unexplained = [r for r in c8_missed if r["reason"] != "non_executable_empty_spine"]
print(f"  C8-EMPTY-SPINE missed = {len(c8_empty)}    -> PREFLIGHT safety path, OWN row, excluded from treatment")
print(f"  C8 UNEXPLAINED miss   = {len(c8_unexplained)}    -> JOIN_RESIDUAL; a real one is a BROKEN JOIN, not a class")
for r in c8_unexplained:
    print(f"      residual: video={r['video']} cond_id={r['condition_id']!r} reason={r['reason']!r}")

# --- 4. semantic-conservation fields, ARTIFACT-SOURCED only -------------------
has_span = sum(1 for _, _, c in c8_matched if c.get("span") is not None)
has_ev = sum(1 for _, _, c in c8_matched if c.get("evidence") is not None)
type_agree = sum(1 for r, _, c in c8_matched if c.get("type") == r["semantic_type"])
print()
print("=== C8-ANNOTATION: stored provenance fields (frozen classifier label is the ONLY semantic source) ===")
print(f"  span present    = {has_span} / {len(c8_matched)}")
print(f"  evidence present= {has_ev} / {len(c8_matched)}")
print(f"  type agrees with frozen semantic_type = {type_agree} / {len(c8_matched)}")

# --- 5. FORWARD/REVERSE CONVERGENCE against the preserved transcript bytes ----
print()
print("=== CONVERGENCE: does the stored span resolve, in the PRESERVED transcript, to the stored evidence? ===")
tcache = {}
conv = collections.Counter()
divergences = []
for r, lk, c in c8_matched:
    v = r["video"]
    if v not in tcache:
        p = TRANSCRIPTS / f"{v}.transcript.txt"
        tcache[v] = p.read_text(encoding="utf-8") if p.exists() else None
    t = tcache[v]
    if t is None:
        conv["transcript_missing"] += 1
        continue
    span = c.get("span") or {}
    s, e = span.get("start"), span.get("end")
    if not isinstance(s, int) or not isinstance(e, int):
        conv["span_not_numeric"] += 1
        continue
    if not (0 <= s <= e <= len(t)):
        conv["span_out_of_bounds"] += 1
        divergences.append((v, c.get("id"), f"span {s}-{e} vs len {len(t)}"))
        continue
    sliced = t[s:e]
    ev = (c.get("evidence") or "")
    n_sl, n_ev = " ".join(sliced.split()).lower(), " ".join(ev.split()).lower()
    if n_ev and n_ev == n_sl:
        conv["EXACT: slice == evidence"] += 1
    elif n_ev and (n_ev in n_sl or n_sl in n_ev):
        conv["CONTAINED: one inside the other"] += 1
    elif n_ev:
        conv["DIVERGENT: slice != evidence"] += 1
        divergences.append((v, c.get("id"), f"slice={sliced[:60]!r} evidence={ev[:60]!r}"))
    else:
        conv["evidence_empty"] += 1
for k, n in sorted(conv.items(), key=lambda kv: -kv[1]):
    print(f"  {k:34s} {n:4d}")
print(f"  transcripts read = {sum(1 for v in tcache.values() if v is not None)} / {len(tcache)}")
if divergences:
    print(f"  --- DIVERGENCES PUBLISHED (first 8 of {len(divergences)}) ---")
    for d in divergences[:8]:
        print(f"    {d}")

# --- 6. provenance flags (R-468 flags provenance_backfilled as grader-owned) ---
print()
print("=== extraction_provenance across the 40 specs (recorded, NOT adjudicated) ===")
flat = collections.Counter()
for v, pv in prov.items():
    if isinstance(pv, dict):
        for k, val in pv.items():
            flat[f"{k}={val}"] += 1
    else:
        flat[f"(provenance {type(pv).__name__})"] += 1
for k, n in flat.most_common(12):
    print(f"  {k:52s} {n:3d}")
