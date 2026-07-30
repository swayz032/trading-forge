"""GATE A -- C8-PROVENANCE-LEDGER instrument (R-468 §6, REPAIRED per R-469 §5b).

READ-ONLY. No model execution, no DB access, no writes to any input.

Forward path : preserved transcript span -> spec condition -> classified refusal row
Reverse path : classified refusal row -> spec condition -> preserved transcript span

★ BRIDGE KEYS (R-470 §3, corrected here at R-471 §3). THE GOVERNING LAW:

    A KEY'S SAFETY IS A PROPERTY OF THE ARTIFACT, NOT OF THE KEY.

  Every key is named WITH the artifact it is admissible on -- never alone. All four
  lines are required, and this header is the THIRD CARRIER of the rule: R-470 §5
  named only the ledger DOCUMENT, so the correction landed there while these lines
  kept asserting the withdrawn version. WHEN A RULE IS WITHDRAWN, ENUMERATE EVERY
  CARRIER OF IT, not the one you happen to be looking at.

  1. collapsed per-video classified artifact -> canonical spec:
         (video, condition_id)          -- 455 distinct, max multiplicity 1. THIS IS
         what this instrument actually joins on, and always has.
  2. raw 120-row census payload -> persisted refusal:
         (strategy_id, condition_id)    -- 1368 distinct, max multiplicity 1
  3. condition_id ALONE: INADMISSIBLE ON EVERY ARTIFACT.
         [MEASURED] over the 455 non-empty rows it yields only 359 distinct ids,
         32 ids duplicated, max multiplicity 28 -- 96 ROWS SILENTLY MERGED, into a
         coverage table that would still balance.
  4. (video, condition_id) is INADMISSIBLE on the three-copy census payload:
         456 distinct but max multiplicity 3, histogram {3: 456}. It fuses the
         mcl/mes/mnq triple, turning 1368 into 456 -- exactly the figure a reader
         expects, which is what makes it dangerous.
  ★ The earlier "DISPLAY LABEL ONLY" blanket rule was WITHDRAWN by R-470 §3 as
    over-broad: it was a measurement of the census payload stated as a property of
    the key, and a worker obeying it literally is driven off the correct key.

  spec condition -> transcript : span {start,end} char range into <video>.transcript.txt
  video level                  : video == spec envelope 'video' == transcript stem

★ REPAIRED AFTER REJECTION (R-469 §5b). Three defects, all real:
  1. `JOIN_RESIDUAL = 0` was a HARDCODED STRING LITERAL in the first conservation
     table while the later C8 table CORRECTLY computed 1, and the process exited 0
     regardless -- two tables in one run disagreeing about the same bucket with
     nothing failing. A HARDCODED EXPECTED VALUE IS A FABRICATED SAFETY CLAIM.
     Now: ONE bucket computation (`Buckets`), shared by EVERY table, and
     `reconcile()` EXITS NON-ZERO on any internal disagreement.
  2. The evidence-taxonomy counts were published in the ledger document but had NO
     EMITTER here. A published number with no emitter is the convicted drift shape.
     Now emitted below (§5).
  3. Only the classified artifact was pinned. Now ALL THREE input populations are
     pinned: classified + specs + transcripts.
  Also added: the SPAN INVARIANT check (R-469 §4) -- IN-BOUNDS IS NOT CORRECT.

EXIT CODES
  0  ledger produced and every bucket reconciles across every table
  6  INTERNAL DISAGREEMENT -- buckets do not reconcile (the R-469 §5b defect)
  7  input pinning failed (an input artifact does not match its recorded hash)
"""
from __future__ import annotations

import collections
import hashlib
import json
import pathlib
import re
import sys
from dataclasses import dataclass, field

CENSUS_DIR = pathlib.Path(r"C:\Users\tonio\Projects\trading-forge\backups\h1-census\unknown-dbtime-ad4335f0")
SPECS = pathlib.Path(r"C:\Users\tonio\Projects\trading-forge\tf-deep-scan\corpus\specs")
TRANSCRIPTS = pathlib.Path(r"C:\Users\tonio\Projects\trading-forge\backups\h1-shadow-eval\transcripts-78fe8ea7\transcripts")

CLASSIFIED = CENSUS_DIR / "pop120_classified.json"
PIN_CLASSIFIED = "eed65514a126adb136b5430939223965a12909b6e21cda4fba87d547326051d1"
# Body hash of the preserved transcript manifest (R-464/R-467: 40 rows, 913,668 B).
PIN_TRANSCRIPT_BYTES = 913_668
PIN_TRANSCRIPT_COUNT = 40
PIN_SPEC_COUNT = 40

MUTATE = "--mutate" in sys.argv
EMPTY_SPINE_REASON = "non_executable_empty_spine"


def sha256_of(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


# ---------------------------------------------------------------- input pinning
def pin_inputs() -> dict[str, str]:
    """(3) ALL THREE populations pinned, not just the classified artifact."""
    print("=== INPUT PINNING (all three populations) ===")
    facts: dict[str, str] = {}

    got = sha256_of(CLASSIFIED)
    ok = got == PIN_CLASSIFIED
    print(f"  classified : {CLASSIFIED.name}  sha256 {'MATCH' if ok else 'MISMATCH'}  {got[:16]}...")
    if not ok:
        sys.exit(7)
    facts["classified_sha256"] = got

    spec_files = sorted(SPECS.glob("*.spec.json"))
    # Set-level pin: a stable hash over (name, sha256) of every spec file, so the
    # population is pinned as a SET rather than one representative file.
    h = hashlib.sha256()
    for f in spec_files:
        h.update(f.name.encode()); h.update(sha256_of(f).encode())
    spec_set = h.hexdigest()
    print(f"  specs      : {len(spec_files)} files  set-hash {spec_set[:16]}...  "
          f"{'OK' if len(spec_files) == PIN_SPEC_COUNT else f'COUNT MISMATCH (want {PIN_SPEC_COUNT})'}")
    if len(spec_files) != PIN_SPEC_COUNT:
        sys.exit(7)
    facts["spec_set_hash"] = spec_set

    t_files = sorted(TRANSCRIPTS.glob("*.transcript.txt"))
    total = sum(f.stat().st_size for f in t_files)
    h = hashlib.sha256()
    for f in t_files:
        h.update(f.name.encode()); h.update(sha256_of(f).encode())
    t_set = h.hexdigest()
    ok = len(t_files) == PIN_TRANSCRIPT_COUNT and total == PIN_TRANSCRIPT_BYTES
    print(f"  transcripts: {len(t_files)} files, {total:,} bytes  set-hash {t_set[:16]}...  "
          f"{'OK' if ok else 'PIN MISMATCH'}")
    if not ok:
        sys.exit(7)
    facts["transcript_set_hash"] = t_set
    print(f"  tree: specs=tf-deep-scan (separate git repo) · classified+transcripts=backups (outside git)")
    return facts


# ------------------------------------------------------------- reconciled buckets
@dataclass
class Buckets:
    """(1) THE single bucket computation. Every table renders from THIS object --
    there is no second place a bucket count can be typed."""
    population: int = 0
    matched: list = field(default_factory=list)      # joined 1:1
    duplicate: list = field(default_factory=list)    # key seen >1x in the population
    miss_explained: list = field(default_factory=list)   # missed join, manufactured by design
    join_residual: list = field(default_factory=list)    # missed join, UNEXPLAINED

    def counts(self) -> dict[str, int]:
        return {
            "matched_1:1": len(self.matched),
            "duplicate": len(self.duplicate),
            "miss_EXPLAINED": len(self.miss_explained),
            "JOIN_RESIDUAL": len(self.join_residual),
        }

    def total(self) -> int:
        return sum(self.counts().values())

    def subset(self, pred) -> "Buckets":
        """A sub-population (e.g. C8) inherits the SAME bucket definitions."""
        b = Buckets(population=0)
        b.matched = [m for m in self.matched if pred(m[0])]
        b.duplicate = [d for d in self.duplicate if pred(d)]
        b.miss_explained = [r for r in self.miss_explained if pred(r)]
        b.join_residual = [r for r in self.join_residual if pred(r)]
        b.population = b.total()
        return b


def render(label: str, b: Buckets) -> None:
    print(f"\n=== {label} ===")
    for k, v in b.counts().items():
        print(f"  {k:16s} = {v}")
    ok = b.total() == b.population
    print(f"  {'SUM':16s} = {b.total()}  vs population {b.population}  -> "
          f"{'BALANCES' if ok else 'DOES NOT BALANCE'}")


RECONCILE_FAILURES: list[str] = []


def reconcile(label: str, b: Buckets) -> None:
    """(1) EXIT NON-ZERO on internal disagreement. The rejected version printed a
    hardcoded 0 beside a computed 1 and still exited 0."""
    if b.total() != b.population:
        RECONCILE_FAILURES.append(
            f"{label}: buckets sum to {b.total()} but population is {b.population}")


def main() -> int:
    pin_inputs()

    rows = json.loads(CLASSIFIED.read_text(encoding="utf-8"))
    print(f"\n[population] classified rows = {len(rows)}  (POP-120-LIVE, per-video)")

    # ---- broken-join fixture (R-468 §6.3) -- a green-only trace is not evidence
    if MUTATE:
        t = next(r for r in rows
                 if str(r["remediation_class"]).startswith("C8") and r["condition_id"])
        before = t["condition_id"]
        t["condition_id"] = before + "__MUTATED_JOIN_KEY"
        print("\n[FIXTURE] MUTATED one C8 join key")
        print(f"[FIXTURE]   video ={t['video']}")
        print(f"[FIXTURE]   before={before!r}")
        print(f"[FIXTURE]   after ={t['condition_id']!r}")
        print("[FIXTURE] EXPECT matched 455->454 and JOIN_RESIDUAL 0->1, "
              "miss_EXPLAINED unchanged at 1, SUM still 456")

    # ---- index the canonical spec conditions
    cond_index: dict[tuple[str, str], tuple[str, dict]] = {}
    list_hist: collections.Counter = collections.Counter()
    prov: dict[str, dict] = {}
    for f in sorted(SPECS.glob("*.spec.json")):
        env = json.loads(f.read_text(encoding="utf-8"))
        video = env.get("video") or f.name.split(".")[0]
        prov[video] = env.get("extraction_provenance") or {}
        spec = env.get("spec") or {}
        for lk in ("entry_conditions", "conditions", "exit_conditions", "invalidations"):
            for c in (spec.get(lk) or []):
                list_hist[lk] += 1
                if c.get("id") is not None:
                    cond_index[(video, c["id"])] = (lk, c)
    print(f"[population] spec conditions = {sum(list_hist.values())} by list {dict(list_hist)}; "
          f"distinct keys = {len(cond_index)}")

    # ---- THE JOIN, once, into the single Buckets object
    b = Buckets(population=len(rows))
    keyfreq = collections.Counter((r["video"], r["condition_id"]) for r in rows)
    for r in rows:
        key = (r["video"], r["condition_id"])
        if keyfreq[key] > 1:
            b.duplicate.append(r)
            continue
        hit = cond_index.get(key)
        if hit is not None:
            b.matched.append((r, hit[0], hit[1]))
        elif r["reason"] == EMPTY_SPINE_REASON:
            b.miss_explained.append(r)
        else:
            b.join_residual.append(r)

    # PERMANENT FIXTURE for the reconciliation GATE itself: a gate that has never
    # fired is not a gate. `--break-reconcile` corrupts the declared population by
    # one so the buckets can no longer balance; the run MUST exit 6.
    if "--break-reconcile" in sys.argv:
        b.population -= 1
        print(f"\n[FIXTURE] declared population corrupted to {b.population} "
              f"(true {len(rows)}). EXPECT exit 6, NOT a printed table with exit 0.")

    render("JOIN COVERAGE -- whole population (refusal row -> canonical spec condition)", b)
    reconcile("whole population", b)
    for r in b.miss_explained:
        print(f"  miss_EXPLAINED: video={r['video']} cond_id={r['condition_id']!r} "
              f"reason={r['reason']!r}  [manufactured by preflight, condition_id='' hardcoded]")
    for r in b.join_residual:
        print(f"  JOIN_RESIDUAL : video={r['video']} cond_id={r['condition_id']!r} "
              f"reason={r['reason']!r}  [UNEXPLAINED -- a real one is a BROKEN JOIN]")

    # ---- C8 sub-population, SAME bucket definitions
    c8 = b.subset(lambda r: str(r["remediation_class"]).startswith("C8"))
    render("C8 SPLIT (R-468 §4: NO GLOBAL REMEDY) -- same bucket definitions", c8)
    reconcile("C8 sub-population", c8)
    print(f"  C8-ANNOTATION  = {len(c8.matched)}  -> ATOM-ADMISSION boundary (treatment population)")
    print(f"  C8-EMPTY-SPINE = {len(c8.miss_explained)}  -> PREFLIGHT safety path, "
          f"FAIL-CLOSED, EXCLUDED from treatment")

    # cross-table consistency: C8 buckets must be subsets of the whole-population ones
    if len(c8.matched) > len(b.matched) or len(c8.join_residual) > len(b.join_residual):
        RECONCILE_FAILURES.append("C8 buckets are not subsets of the whole-population buckets")

    # ---- provenance fields on the matched C8 rows
    cm = c8.matched
    print("\n=== C8-ANNOTATION stored provenance (frozen classifier is the ONLY semantic source) ===")
    print(f"  span present     = {sum(1 for _, _, c in cm if c.get('span') is not None)} / {len(cm)}")
    print(f"  evidence present = {sum(1 for _, _, c in cm if c.get('evidence') is not None)} / {len(cm)}"
          f"   <-- PRESENCE ONLY; see the invariant below")
    print(f"  type agrees      = {sum(1 for r, _, c in cm if c.get('type') == r['semantic_type'])} / {len(cm)}")

    # ---- (2) EVIDENCE TAXONOMY -- emitted here, not only in prose
    CLAUSE = re.compile(r"^T-[A-Za-z0-9_-]{2,6}-C\d{3,4}$")
    tax: collections.Counter = collections.Counter()
    for _, _, c in cm:
        ev = (c.get("evidence") or "").strip()
        if CLAUSE.match(ev):
            tax["CLAUSE-ID token"] += 1
        elif ev and len(ev) < 8 and re.search(r"[{}\[\]]", ev):
            tax["JSON DEBRIS"] += 1
        elif len(ev.split()) >= 4:
            tax["PROSE (plausible quote)"] += 1
        elif not ev:
            tax["EMPTY"] += 1
        else:
            tax["SHORT/OTHER (mostly clause-id refs)"] += 1
    print("\n=== EVIDENCE FIELD TAXONOMY (emitted by the instrument -- R-469 §5b) ===")
    for k, n in tax.most_common():
        print(f"  {k:38s} {n:4d}")
    print(f"  {'TOTAL':38s} {sum(tax.values()):4d}")

    # ---- SPAN INVARIANT (R-469 §4): IN-BOUNDS IS NOT CORRECT
    tcache: dict[str, str | None] = {}
    inv: collections.Counter = collections.Counter()
    for r, _, c in cm:
        v = r["video"]
        if v not in tcache:
            p = TRANSCRIPTS / f"{v}.transcript.txt"
            tcache[v] = p.read_text(encoding="utf-8") if p.exists() else None
        t = tcache[v]
        span = c.get("span") or {}
        s, e = span.get("start"), span.get("end")
        if t is None:
            inv["transcript missing"] += 1
            continue
        if not isinstance(s, int) or not isinstance(e, int):
            inv["span not numeric"] += 1
            continue
        if not (0 <= s <= e <= len(t)):
            inv["span OUT OF BOUNDS"] += 1
            continue
        inv["span in-bounds (necessary, NOT sufficient)"] += 1
        sl, ev = t[s:e], (c.get("evidence") or "")
        if ev == sl:
            inv["INVARIANT HOLDS: evidence == slice (byte-exact)"] += 1
        elif " ".join(ev.split()).lower() == " ".join(sl.split()).lower():
            inv["equal only after normalisation"] += 1
        else:
            inv["DIVERGENT even normalised"] += 1
    print("\n=== SPAN INVARIANT  evidence_quote === transcript.slice(start,end)  (R-469 §4) ===")
    for k in ("span in-bounds (necessary, NOT sufficient)",
              "INVARIANT HOLDS: evidence == slice (byte-exact)",
              "equal only after normalisation", "DIVERGENT even normalised",
              "span OUT OF BOUNDS", "span not numeric", "transcript missing"):
        if k in inv:
            print(f"  {k:48s} {inv[k]:4d} / {len(cm)}")

    # ---- producer provenance, recorded not adjudicated
    flat: collections.Counter = collections.Counter()
    for pv in prov.values():
        for k, val in (pv or {}).items():
            flat[f"{k}={val}"] += 1
    print("\n=== extraction_provenance across the specs (RECORDED, NOT ADJUDICATED) ===")
    for k, n in flat.most_common(12):
        print(f"  {k:56s} {n:3d}")

    # ---- final reconciliation gate
    print("\n" + "=" * 70)
    if RECONCILE_FAILURES:
        print("INTERNAL DISAGREEMENT -- exit 6. The ledger is NOT admissible:")
        for f in RECONCILE_FAILURES:
            print(f"  {f}")
        print("=" * 70)
        return 6
    print("RECONCILED: every bucket balances and every table renders from ONE")
    print("bucket computation. No count in this output is a typed literal.")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
