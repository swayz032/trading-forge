# P1 / P2 TRUTH FREEZE — OBSERVED BASELINE AND TOTAL TRUTH MEMBERSHIP

**Authority:** R-520 §6, repaired under R-523 §4 · **Author:** working agent, seat `claude.exe 26204` · **Dates:** frozen 2026-07-31, repaired 2026-08-01
**Artifacts:** this packet + `docs/designs/P1-P2-TOTAL-MEMBERSHIP-2026-07-31.json` (**the ledger**). **No code was added to the repo.**

> ### ⚠️★★★★★ THE FRAME — READ THIS BEFORE ANY COUNT BELOW (obligation `B`)
> **This freeze is COMPLETE OVER THE PINNED `ENTRY-CONDITION × SEVEN-AXIS` FRAME, AND OVER NOTHING ELSE.**
> In plain words: it is complete over the pinned entry-condition × seven-axis frame — every `43` × `7` combination is enumerated and classified — and it claims nothing whatsoever outside it.
> **`OUT OF FRAME` and NOT enumerated here — named, not deleted:** `compiled` · `spine_bound` · `spine_total` · `reasons_must_differ_from` · `scalars_unadjudicated` · any other fixture-level scalar or relational expectation.
> ★★★ **These are REAL TRUTHS that this ledger does not cover. They are recorded here as a NAMED DOWNSTREAM SURFACE for `P0-vNext` / `P3`, and a completeness claim made over this ledger may not be read as covering them.** `A SCOPE DECLARATION IS NOT PERMISSION TO DELETE WHAT IT EXCLUDES.`

---

## 0 — THE `v1` DEFECT, AND WHY THE DENOMINATOR IS THE WHOLE STORY
**`v1` of this freeze published `210` cells. The true frame is `301`.** `v1` took its row universe from `ORACLE.json`'s `fixtures[].conditions` — **the PRESENCE set** — so a row absent from the oracle was absent from the universe built to detect absence. **`13` declared rows and `91` cells vanished silently.**
⚠️★★★★★ **ALL THIRTEEN WERE IN `00-control-shipped.spec.json` — THE CONTROL FIXTURE. `THE ROWS THAT WENT MISSING WERE THE ONES IN THE FILE WHOSE JOB IS TO BE THE BASELINE.`**
★★★★★ **AND THE SHAPE WORTH KEEPING: `v1` FROZE THE AXES AGAINST EXACTLY THIS DEFECT, ARGUED AT LENGTH WHY DERIVING THEM FROM THE ARTIFACT UNDER TEST WOULD BE SELF-AUTHORIZING — AND THEN DERIVED THE ROWS FROM THAT ARTIFACT IN THE SAME FUNCTION.** `THE DEFENCE ARGUED FOR ONE AXIS OF A MATRIX WAS NOT APPLIED TO THE OTHER.`
✅ **`v2` DERIVES THE ROW UNIVERSE FROM THE PINNED SOURCE FIXTURE SPECS. The oracle is COMPARED against it and NEVER DEFINES it** — R-523 §4's stop condition: *comparison is allowed; derivation is not.*
⚠️ **AND THE REPAIR IS DELIBERATELY NOT THE ONE FIRST PROPOSED.** Unioning the oracle's `conditions` keys with its `conditions_unadjudicated_ids` also yields `43` today — **and both sets live inside the artifact being checked, so a self-consistent deletion from both shrinks the universe again.** `A REMEDY FOR SELF-AUTHORIZATION THAT ADDS A SECOND SOURCE INSIDE THE SAME ARTIFACT HAS NOT LEFT THE SYSTEM — IT HAS RAISED THE PRICE OF THE FORGERY BY ONE EDIT.`

---

## 1 — `P1` OBSERVED BASELINE — *"what exists now?"*

| item | value |
|---|---|
| source commit | `c304b098b156106a5a81b714c7a5a3ed166d68ef` |
| **row universe origin** | **PINNED SOURCE FIXTURE SPECS — `fixture filename × spec.entry_conditions[].id`** |
| oracle path (compared, never authoritative for membership) | `ci/fixtures/spec-binding-parity-expanded/ORACLE.json` |
| oracle blob sha1 | `f57a9d005fb8e43b4772dac9f32cc94894c40fe1` |
| authority document | `docs/designs/ORACLE-AUTHORITY-ORPHAN-ZONES-2026-07-30.md` |
| authority sha256 declared / measured | `3494d4bbe6f10a9da3c6d79d594212b5542f904bae17209cfe3d68c0ea2214e2` / **match `True`** |
| fixtures | **`12`** |
| **rows in the universe** | **`43`** |
| rows present in the oracle | `30` |
| **rows DECLARED but ABSENT from the oracle** | ⚠️ **`13`** |
| rows in the oracle but NOT in the universe | **`0`** |
| rows absent AND undeclared | **`0`** |
| present expectations | **`140`** |
| row-universe sha256 | `dd8c33d30a48dd37e7abb0ab856a488137bd204413e2d417b3a0cb61aa38f046` |
| cell-id-set sha256 | `a62906faf3f97cc53acabf9aad8d3181af749b73759df75b27100d0815b162b7` |
| canonical document sha256 | `e2d0cd77304dc0cd38ffe3dfea3003ddb9c8de43b9ddf7409429748035a9c7b0` |

**Rows per fixture, from the source specs:**

| fixture | rows |
|---|---|
| `00-control-shipped.spec.json` | 15 |
| `10-lunch-orphan.spec.json` | 2 |
| `11-premarket-orphan.spec.json` | 2 |
| `20-nyam-evaluable.spec.json` | 2 |
| `21-fivemin-chart.spec.json` | 2 |
| `22-nypm-evaluable.spec.json` | 2 |
| `23-silverbullet-evaluable.spec.json` | 2 |
| `24-macrowindow-evaluable.spec.json` | 2 |
| `30-compiled-flip.spec.json` | 3 |
| `31-flip-neg-control.spec.json` | 3 |
| `40-overrefusal-boundary.spec.json` | 5 |
| `50-family-axis-invalidations.spec.json` | 3 |

**The `13` rows the oracle does not carry — every one named in its `conditions_unadjudicated_ids`:**
- `00-control-shipped.spec.json::bias`
- `00-control-shipped.spec.json::confirmation`
- `00-control-shipped.spec.json::direction`
- `00-control-shipped.spec.json::enable`
- `00-control-shipped.spec.json::enter`
- `00-control-shipped.spec.json::exception`
- `00-control-shipped.spec.json::filter`
- `00-control-shipped.spec.json::hint`
- `00-control-shipped.spec.json::reset`
- `00-control-shipped.spec.json::retest`
- `00-control-shipped.spec.json::structure`
- `00-control-shipped.spec.json::unknown`
- `00-control-shipped.spec.json::verify`

**Per-axis presence over the `30` oracle-carrying rows:**

| axis | present | absent |
|---|---|---|
| `approximation` | 22 | 8 |
| `bindable` | 29 | 1 |
| `primitive_null` | 26 | 4 |
| `reason_excludes` | 4 | 26 |
| `reason_names` | 4 | 26 |
| `reason_null` | 29 | 1 |
| `session_zone` | 26 | 4 |

★★★ **THE AUTHORITY HASH RESOLVES, CLOSING AN OPEN CAMPAIGN ITEM:** `AR-540 §5` flagged `3494d4bb…` as *"not a git object"* and hypothesised a CONTENT hash rather than a fabrication. **[MEASURED HERE] it is the sha256 of the authority document and it matches byte-for-byte.**

---

## 2 — `P2` TOTAL TRUTH MEMBERSHIP — *"what is intended to exist?"*
**`43` rows × `7` axes = `301` CELLS.** `COMPLETENESS MUST BE AN ENUMERATED MEMBERSHIP SET, NOT AN INFERENCE FROM PRESENCE.`

| classification | cells |
|---|---|
| **ASSERTED** | 140 |
| **NOT-APPLICABLE** | 9 |
| **UNADJUDICATED** | 152 |

| basis | cells |
|---|---|
| `UNDECLARED` | 43 |
| `fixture-declared-id (row absent from oracle)` | 91 |
| `fixture-declared-prose` | 13 |
| `present-in-oracle` | 140 |
| `row-declared-alias (declared as 'primitive')` | 3 |
| `row-declared-exact` | 11 |

⚠️ **THE `91` CELLS OF THE `13` ABSENT ROWS ARE `UNADJUDICATED`. NO ASSERTION WAS FABRICATED FOR ANY OF THEM.**

---

## 3 — THE CLASSIFICATION RULE, PRE-REGISTERED AND REVERSIBLE

| class | rule | grounded in |
|---|---|---|
| `ASSERTED` | present in the oracle | the artifact |
| `NOT-APPLICABLE` | authority **§4d**: *"`primitive` · everything else — NO EXPECTATION — DECLARED GAP; `FAMILY_META`-sourced; implementation on the parity surface"* — adjudicating it would read the expectation out of the code under test. **A MUST-NOT, not a not-yet.** | the AUTHORITY document |
| `UNADJUDICATED` | everything else, including every cell grounded in authority §6, whose own title is `[UNENUMERATED — OPEN]` | the AUTHORITY, or nothing at all |

★★★★★ **WHERE BOTH COULD BE ARGUED, `UNADJUDICATED` WINS.** `A MATRIX WITH GUESSED CELLS IS STRICTLY WORSE THAN THE SPARSE OBJECT`, because it converts an honest absence into a false assertion everything downstream will trust.
✅ **`9` `NOT-APPLICABLE` cells now carry `authority_citation` in the FIELD, not only in this packet** (obligation `E`, filled by regeneration — never a hand edit). ⚠️ **Those `9` are the only cells whose class rests on reading prose; one line in the generator flips them.**

---

## 4 — FINDINGS

### ⚠️★★★★★ P-F1 — `43` CELLS ARE ABSENT AND DECLARED NOWHERE
**Unchanged by the repair, and now measured against the correct denominator of `301`.** An omission there is `intentionally-not-applicable` **or** `honestly-unadjudicated` **or** `accidentally-deleted`, and the sparse object cannot say which.

| axis | undeclared cells |
|---|---|
| `reason_excludes` | 22 |
| `reason_names` | 21 |

★★★ **NOT A DEFECT THE ORACLE'S AUTHORS INTRODUCED.** Authority §6 states that only session-family rows are adjudicated and that the membership manifest *"is wider than this oracle"*. **THE ORACLE NEVER CLAIMED THIS COVERAGE — `P0` ASSUMED IT.**

### ⚠️★★★ P-F2 — `primitive` vs `primitive_null`: A NAMESPACE JOIN, DISCLOSED NOT SILENT
**`3` declared gaps name the key `primitive`; the axis is `primitive_null`.** The ledger joins them explicitly and records the join in `basis`. **Under a strict join those cells are `UNDECLARED` and the undeclared count is `46`.** `A SILENT JOIN IS AN UNTESTED HYPOTHESIS ABOUT TWO NAMES MEANING ONE THING.`

### ✅ P-F3 — INTEGRITY CENSUS, BOTH DIRECTIONS
`rows in oracle not in universe: 0` · `rows absent and undeclared: 0` · `duplicate JSON keys: none` · `duplicate cell ids: none` · `unknown cell ids: none` · `missing cell ids: none` · `unknown row keys: none`
★★★ **The duplicate-key census uses an `object_pairs_hook`, because `json.load` SILENTLY KEEPS THE LAST of duplicate keys — a plain parse cannot see them.**

---

## 5 — PROOFS, EXECUTED, OUTPUT CAPTURED LIVE INTO THIS DOCUMENT

### Determinism across repeated generation and serialization
```
sha256 run1  4392bc65a38235ec4fe1c659556dfe007a7436a916bc1a46c7d2827bbd7f0c6f
sha256 run2  4392bc65a38235ec4fe1c659556dfe007a7436a916bc1a46c7d2827bbd7f0c6f
byte-identical across regeneration: YES
```

### Red-proof — **every membership mutant has its counts AND digests REPAIRED first**
```
LEDGER INTEGRITY [clean control]: PASS (301 cells, 0 checks failed)
  - MISSING CELL IDS (1): ['00-control-shipped.spec.json::bias::reason_excludes']
LEDGER INTEGRITY [MUTANT: 1 cell deleted (+repaired)]: FAIL (300 cells, 1 checks failed)
  - MISSING CELL IDS (7): ['00-control-shipped.spec.json::bias::approximation', '00-control-shipped.spec.json::bias::bindable']
  - ROWS ABSENT FROM LEDGER (1): ['00-control-shipped.spec.json::bias']
LEDGER INTEGRITY [MUTANT: whole ROW + 7 cells (+repaired)]: FAIL (294 cells, 2 checks failed)
  - MISSING CELL IDS (43): ['00-control-shipped.spec.json::bias::bindable', '00-control-shipped.spec.json::confirmation::bindable']
  - AXES ABSENT FROM LEDGER: ['bindable']
LEDGER INTEGRITY [MUTANT: whole AXIS + cells (+repaired)]: FAIL (258 cells, 2 checks failed)
  - UNKNOWN CELL IDS (1): ['99-ghost.spec.json::ghost::bindable']
LEDGER INTEGRITY [MUTANT: unknown ROW added (+repaired)]: FAIL (302 cells, 1 checks failed)
  - DUPLICATE CELL IDS (1): ['00-control-shipped.spec.json::bias::approximation']
LEDGER INTEGRITY [MUTANT: cell duplicated (+repaired)]: FAIL (302 cells, 1 checks failed)
  - CELL CONTENT FORGED 00-control-shipped.spec.json::bias::approximation.classification: 'ASSERTED' != expected 'UNADJUDICATED'
LEDGER INTEGRITY [MUTANT: UNADJUDICATED->ASSERTED]: FAIL (301 cells, 1 checks failed)
  - CELL CONTENT FORGED 40-overrefusal-boundary.spec.json::bias_overnight::approximation.classification: 'ASSERTED' != expected 'NOT-APPLICABLE'
LEDGER INTEGRITY [MUTANT: NOT-APPLICABLE->ASSERTED]: FAIL (301 cells, 1 checks failed)
  - CELL CONTENT FORGED 10-lunch-orphan.spec.json::enter::reason_excludes.basis: 'fixture-declared-id' != expected 'UNDECLARED'
LEDGER INTEGRITY [MUTANT: forged basis]: FAIL (301 cells, 1 checks failed)
  - CELL CONTENT FORGED 00-control-shipped.spec.json::london::approximation.value: None != expected False
LEDGER INTEGRITY [MUTANT: nulled asserted value]: FAIL (301 cells, 1 checks failed)
  - CELL CONTENT FORGED 00-control-shipped.spec.json::bias::approximation.declared_reason: None != expected '13 of 15 conditions (all non-session families, the unknown type, and the INVALIDATE row) � authority section 6 leaves non-session families and invalidations unadjudicated.'
LEDGER INTEGRITY [MUTANT: removed declaration reason]: FAIL (301 cells, 1 checks failed)
  - CELL CONTENT FORGED 40-overrefusal-boundary.spec.json::bias_overnight::primitive_null.basis: 'row-declared-exact' != expected "row-declared-alias (declared as 'primitive')"
LEDGER INTEGRITY [MUTANT: erased alias disclosure]: FAIL (301 cells, 1 checks failed)
ALL CASES DISCRIMINATE: True  (clean=PASS, 11/11 mutants caught)
verifier exit status: 0
```
★★★★★ **THE MUTANTS ARE REPAIRED ON PURPOSE. A forger who deletes a row also fixes `row_count`, `counts_by_*` and every digest — and `v1`'s verifier, which read its expected product from the ledger's own `row_ids` and `axes`, would have called that document `PASS`.** ✅ **`v2` rebuilds the row universe from the PINNED SOURCE SPECS and the axis contract from its own constant, so a self-consistent forgery still goes RED.** ★★★ **The clean control is what makes those RED results mean anything.**

---

## 6 — WHAT THIS FREEZE DOES **NOT** DO (honest-partial clause)
- ⚠️ **It does not make the `140` asserted values CORRECT** — frozen as observed; value-vs-authority re-derivation is the declared rung-3 limit.
- ⚠️ **It does not classify the `43` undeclared cells beyond `UNADJUDICATED`.** The authority does not reach them, and **closing them is an authority amendment — a desk act, not a worker act.**
- ⚠️ **It is silent on everything `OUT OF FRAME`** (see the frame block at the top).
- ⚠️ **`9` `NOT-APPLICABLE` cells rest on one reading of §4d; `3` alias-joined cells rest on one join.** Both are published with both readings.
- ⚠️ **I do not grade my own work.** Whether this ledger is a sound authority for `P0-vNext` is an independent call.

---

## 7 — REPRODUCTION: THE GENERATOR, VERBATIM
```python
"""P1/P2 TRUTH-FREEZE GENERATOR v2 — R-523 §4 (obligations A and E).

v1 DEFECT, FIXED HERE: the row universe was taken from `ORACLE.json`'s
`fixtures[].conditions` — the PRESENCE set — so a row absent from the oracle was
absent from the universe meant to detect absence. 13 declared rows were lost and
the denominator read 210 instead of 301.

v2 DERIVES THE ROW UNIVERSE FROM THE PINNED SOURCE FIXTURE SPECS, keyed
`fixture filename x spec.entry_conditions[].id`. The oracle is COMPARED AGAINST
that universe and never DEFINES it. Same for the axes, which were already frozen.

Runs OUTSIDE the repo (scratchpad). Emits exactly one artifact:
    docs/designs/P1-P2-TOTAL-MEMBERSHIP-2026-07-31.json
Deterministic: every collection sorted, JSON written with sort_keys + fixed
separators + ensure_ascii, digest taken over that canonical serialization.
"""
import hashlib
import io
import json
import subprocess
import sys

REPO = r"C:\Users\tonio\Projects\wt-h1-wave4-20260712"
SRC_COMMIT = "c304b098"
FIXTURE_DIR = "ci/fixtures/spec-binding-parity-expanded"
ORACLE_PATH = FIXTURE_DIR + "/ORACLE.json"
AUTHORITY_PATH = "docs/designs/ORACLE-AUTHORITY-ORPHAN-ZONES-2026-07-30.md"
OUT = REPO + r"\docs\designs\P1-P2-TOTAL-MEMBERSHIP-2026-07-31.json"

# The SEVEN expectation axes — FROZEN HERE, never derived from ORACLE.json.
AXES = ["approximation", "bindable", "primitive_null", "reason_excludes",
        "reason_names", "reason_null", "session_zone"]
NON_AXIS_ROW_KEYS = ["authority", "unadjudicated"]
DECLARED_GAP_ALIASES = {"primitive": "primitive_null"}
AUTHORITY_4D = "ORACLE-AUTHORITY-ORPHAN-ZONES-2026-07-30.md §4d"


def sh(*a):
    return subprocess.run(a, cwd=REPO, capture_output=True, check=True).stdout


def load_dupsafe(text):
    """json.load silently keeps the LAST of duplicate keys; catch them instead."""
    dups = []

    def hook(pairs):
        seen = {}
        for k, v in pairs:
            if k in seen:
                dups.append(k)
            seen[k] = v
        return seen

    return json.loads(text, object_pairs_hook=hook), dups


def row_universe():
    """OBLIGATION A: the row universe, from the PINNED SOURCE SPECS ONLY."""
    names = [f for f in sh("git", "ls-tree", "-r", "--name-only", SRC_COMMIT,
                           FIXTURE_DIR + "/").decode().split()
             if f.endswith(".spec.json")]
    rows, per_fixture = [], {}
    for path in sorted(names):
        spec, _ = load_dupsafe(sh("git", "show", "%s:%s" % (SRC_COMMIT, path)).decode("utf-8"))
        fn = path.split("/")[-1]
        ids = [c.get("id") for c in (spec["spec"].get("entry_conditions") or [])]
        per_fixture[fn] = len(ids)
        rows += [(fn, i) for i in ids]
    return sorted(rows), per_fixture


def build():
    """Returns the ledger document, derived ONLY from the pinned sources.

    The verifier calls this to re-derive the ledger independently of the published
    file. Deliberately ONE implementation of the derivation, shared: two copies of
    the same rule can drift, and then breaking the shipped one would not fail its
    own proof (this campaign's R-513 conviction). What must stay independent is the
    SOURCE — pinned specs and oracle — never the published ledger.
    """
    oracle_raw = sh("git", "show", "%s:%s" % (SRC_COMMIT, ORACLE_PATH))
    oracle, dup_keys = load_dupsafe(oracle_raw.decode("utf-8"))
    fixtures = oracle["fixtures"]
    authority = io.open(REPO + "\\" + AUTHORITY_PATH.replace("/", "\\"), "rb").read()
    authority_sha = hashlib.sha256(authority).hexdigest()

    rows, per_fixture = row_universe()
    row_ids = ["%s::%s" % (fn, cid) for fn, cid in rows]

    # --- compare (never derive) the oracle against the frozen universe ---
    oracle_rows = sorted({(fn, cid) for fn, f in fixtures.items()
                          for cid in (f.get("conditions") or {})})
    present = [r for r in rows if r in set(oracle_rows)]
    absent = [r for r in rows if r not in set(oracle_rows)]
    unexpected = [r for r in oracle_rows if r not in set(rows)]

    cells, axis_counts = [], {a: 0 for a in AXES}
    unknown_row_keys, undeclared_rows = [], []
    for fn, cid in rows:
        fx = fixtures.get(fn) or {}
        row = (fx.get("conditions") or {}).get(cid)
        declared_ids = fx.get("conditions_unadjudicated_ids") or []

        if row is None:
            # ROW DECLARED IN THE SOURCE SPEC, ABSENT FROM THE ORACLE.
            # These are the 13 v1 lost entirely. No assertion is fabricated for them.
            if cid in declared_ids:
                basis, reason = "fixture-declared-id", fx.get("conditions_unadjudicated")
            elif "conditions_unadjudicated" in fx:
                basis, reason = "fixture-declared-prose", fx.get("conditions_unadjudicated")
            else:
                basis, reason = "UNDECLARED", None
                undeclared_rows.append("%s::%s" % (fn, cid))
            for axis in AXES:
                cells.append({"cell_id": "%s::%s::%s" % (fn, cid, axis), "fixture": fn,
                              "condition_id": cid, "axis": axis,
                              "classification": "UNADJUDICATED",
                              "basis": basis + " (row absent from oracle)",
                              "declared_reason": reason, "authority_citation": None})
            continue

        for k in sorted(row.keys()):
            if k in AXES:
                axis_counts[k] += 1
            elif k not in NON_AXIS_ROW_KEYS:
                unknown_row_keys.append("%s::%s::%s" % (fn, cid, k))

        declared = row.get("unadjudicated") or {}
        declared_axis = {}
        for k, reason in declared.items():
            if k in AXES:
                declared_axis[k] = (k, "row-declared-exact", reason)
            elif k in DECLARED_GAP_ALIASES:
                declared_axis[DECLARED_GAP_ALIASES[k]] = (k, "row-declared-alias", reason)

        for axis in AXES:
            cid_full = "%s::%s::%s" % (fn, cid, axis)
            if axis in row:
                cells.append({"cell_id": cid_full, "fixture": fn, "condition_id": cid,
                              "axis": axis, "classification": "ASSERTED",
                              "basis": "present-in-oracle", "value": row[axis],
                              "authority_citation": row.get("authority")})
            elif axis in declared_axis:
                src, basis, reason = declared_axis[axis]
                na = "section 4d" in reason
                open_ = ("OPEN" in reason or "DESK-OWNED" in reason
                         or "leaves it unadjudicated" in reason)
                klass = "UNADJUDICATED" if (open_ or not na) else "NOT-APPLICABLE"
                cells.append({"cell_id": cid_full, "fixture": fn, "condition_id": cid,
                              "axis": axis, "classification": klass,
                              "basis": basis + ("" if src == axis else " (declared as '%s')" % src),
                              "declared_reason": reason,
                              # OBLIGATION E: the citation was published only in the
                              # packet; it belongs in the field too.
                              "authority_citation": AUTHORITY_4D if klass == "NOT-APPLICABLE" else None})
            elif cid in declared_ids:
                cells.append({"cell_id": cid_full, "fixture": fn, "condition_id": cid,
                              "axis": axis, "classification": "UNADJUDICATED",
                              "basis": "fixture-declared-id",
                              "declared_reason": fx.get("conditions_unadjudicated"),
                              "authority_citation": None})
            elif "conditions_unadjudicated" in fx:
                cells.append({"cell_id": cid_full, "fixture": fn, "condition_id": cid,
                              "axis": axis, "classification": "UNADJUDICATED",
                              "basis": "fixture-declared-prose",
                              "declared_reason": fx.get("conditions_unadjudicated"),
                              "authority_citation": None})
            else:
                cells.append({"cell_id": cid_full, "fixture": fn, "condition_id": cid,
                              "axis": axis, "classification": "UNADJUDICATED",
                              "basis": "UNDECLARED", "declared_reason": None,
                              "authority_citation": None})

    cells.sort(key=lambda c: c["cell_id"])
    ids = [c["cell_id"] for c in cells]
    expected = sorted("%s::%s" % (r, a) for r in row_ids for a in AXES)

    by = lambda f: dict(sorted({f(c): sum(1 for x in cells if f(x) == f(c))
                                for c in cells}.items()))
    doc = {
        "_schema": "P1-P2-TOTAL-MEMBERSHIP/2",
        "_generated_by": "gen_p1p2.py v2 (source embedded verbatim in "
                         "docs/designs/P1-P2-TRUTH-FREEZE-PACKET-2026-07-31.md)",
        "_classification_enum": ["ASSERTED", "NOT-APPLICABLE", "UNADJUDICATED"],
        "_frame": "COMPLETE OVER THE PINNED ENTRY-CONDITION x SEVEN-AXIS FRAME. "
                  "Fixture-level scalar and relational expectations (compiled, spine_bound, "
                  "spine_total, reasons_must_differ_from, scalars_unadjudicated) are OUT OF "
                  "FRAME and are NOT enumerated here.",
        "P1_observed_baseline": {
            "source_commit": sh("git", "rev-parse", SRC_COMMIT).decode().strip(),
            "row_universe_origin": "PINNED SOURCE FIXTURE SPECS at %s, keyed "
                                   "`fixture filename x spec.entry_conditions[].id`. "
                                   "ORACLE.json is COMPARED against this universe and "
                                   "NEVER DEFINES it." % SRC_COMMIT,
            "oracle_path": ORACLE_PATH,
            "oracle_blob_sha1": sh("git", "rev-parse", "%s:%s" % (SRC_COMMIT, ORACLE_PATH)).decode().strip(),
            "oracle_bytes": len(oracle_raw),
            "authority_path": AUTHORITY_PATH,
            "authority_sha256_declared": oracle["authority_sha256"],
            "authority_sha256_measured": authority_sha,
            "authority_sha256_match": authority_sha == oracle["authority_sha256"],
            "fixture_count": len(per_fixture),
            "fixture_ids": sorted(per_fixture),
            "rows_per_fixture": per_fixture,
            "row_count": len(rows),
            "row_ids": row_ids,
            "rows_present_in_oracle": len(present),
            "rows_declared_absent_from_oracle": len(absent),
            "rows_declared_absent_ids": ["%s::%s" % r for r in absent],
            "rows_in_oracle_not_in_universe": ["%s::%s" % r for r in unexpected],
            "rows_absent_and_undeclared": sorted(undeclared_rows),
            "present_expectation_count": sum(axis_counts.values()),
            "per_axis_present_counts": {a: axis_counts[a] for a in AXES},
        },
        "P2_total_membership": {
            "axes": AXES,
            "axis_list_origin": "FROZEN IN THE GENERATOR — never derived from ORACLE.json",
            "expected_cell_count": len(rows) * len(AXES),
            "actual_cell_count": len(cells),
            "counts_by_classification": by(lambda c: c["classification"]),
            "counts_by_basis": by(lambda c: c["basis"]),
        },
        "integrity_census": {
            "duplicate_json_keys_in_source": sorted(set(dup_keys)),
            "duplicate_cell_ids": sorted({i for i in ids if ids.count(i) > 1}),
            "unknown_cell_ids": sorted(set(ids) - set(expected)),
            "missing_cell_ids": sorted(set(expected) - set(ids)),
            "unknown_row_keys": sorted(set(unknown_row_keys)),
            "alias_joined_cells": sorted(c["cell_id"] for c in cells
                                         if "declared as" in c.get("basis", "")),
            "detection_rule": "The cell-id set is the CARTESIAN PRODUCT of the SOURCE-SPEC row "
                              "universe and the frozen axes. A verifier must rebuild BOTH from "
                              "the pinned sources — never from this document's own row_ids or "
                              "axes, which a forger may edit alongside the cells.",
        },
        "cells": cells,
    }
    canon = json.dumps(doc, sort_keys=True, ensure_ascii=True, separators=(",", ":"))
    doc["digests"] = {
        "row_universe_sha256": hashlib.sha256("\n".join(row_ids).encode("utf-8")).hexdigest(),
        "cell_id_set_sha256": hashlib.sha256("\n".join(sorted(ids)).encode("utf-8")).hexdigest(),
        "canonical_document_sha256": hashlib.sha256(canon.encode("utf-8")).hexdigest(),
        "digest_definition": "canonical_document_sha256 = sha256 of json.dumps(doc WITHOUT "
                             "'digests', sort_keys=True, ensure_ascii=True, separators=(',',':'))",
    }
    return doc


def main():
    doc = build()
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(
        json.dumps(doc, indent=1, sort_keys=True, ensure_ascii=True) + "\n")

    p1, p2 = doc["P1_observed_baseline"], doc["P2_total_membership"]
    print("row universe: %d (present %d, declared-absent %d, unexpected %d, undeclared-absent %d)"
          % (p1["row_count"], p1["rows_present_in_oracle"], p1["rows_declared_absent_from_oracle"],
             len(p1["rows_in_oracle_not_in_universe"]), len(p1["rows_absent_and_undeclared"])))
    print("cells: %d (expected %d)" % (p2["actual_cell_count"], p2["expected_cell_count"]))
    print("by classification:", json.dumps(p2["counts_by_classification"]))
    print("by basis:", json.dumps(p2["counts_by_basis"]))
    print("present expectations:", p1["present_expectation_count"])
    print("authority sha256 match:", p1["authority_sha256_match"])
    print("canonical_document_sha256:", doc["digests"]["canonical_document_sha256"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## 8 — THE VERIFIER, VERBATIM
```python
"""LEDGER VERIFIER v2 — R-523 §4 obligations C and D.

v1 DEFECT, FIXED HERE: v1 computed its expected product from the ledger's OWN
`P1.row_ids` and `P2.axes`. A forger who deleted a row and also deleted it from
`row_ids` produced a self-consistent document that v1 called PASS.

v2 NEVER READS THE LEDGER'S DENOMINATOR. It rebuilds the 43-row universe from the
PINNED SOURCE SPECS and takes the seven-axis contract from a constant, then
re-derives the whole expected ledger from the pinned sources and compares.

Completion signal = FINAL SUMMARY LINE + EXIT STATUS. Never a grepped line.
"""
import hashlib
import io
import json
import sys

sys.path.insert(0, r"C:\Users\tonio\AppData\Local\Temp\claude"
                   r"\C--Users-tonio-Projects-trading-forge"
                   r"\f7a0bc78-d1eb-49b9-b5ab-200528468abf\scratchpad")
import gen_p1p2 as gen  # noqa: E402  — for the DERIVATION, from pinned sources only

LEDGER = (r"C:\Users\tonio\Projects\wt-h1-wave4-20260712"
          r"\docs\designs\P1-P2-TOTAL-MEMBERSHIP-2026-07-31.json")

# The axis contract, held HERE, independent of the ledger under test.
AXES = ["approximation", "bindable", "primitive_null", "reason_excludes",
        "reason_names", "reason_null", "session_zone"]


def parse_reject_dups(text):
    """OBLIGATION D: reject duplicate JSON keys BEFORE normal parsing —
    json.load silently keeps the last, so a plain parse cannot see them."""
    dups = []

    def hook(pairs):
        seen = {}
        for k, v in pairs:
            if k in seen:
                dups.append(k)
            seen[k] = v
        return seen

    return json.loads(text, object_pairs_hook=hook), dups


def canon_sha(doc):
    d = {k: v for k, v in doc.items() if k != "digests"}
    return hashlib.sha256(json.dumps(d, sort_keys=True, ensure_ascii=True,
                                     separators=(",", ":")).encode("utf-8")).hexdigest()


def check(doc, label, dups=()):
    """Everything expected is rebuilt from the PINNED SOURCES, never from `doc`."""
    exp = gen.build()
    exp_cells = {c["cell_id"]: c for c in exp["cells"]}
    fail = []

    if dups:
        fail.append("DUPLICATE JSON KEYS IN LEDGER: %s" % sorted(set(dups)))

    ids = [c["cell_id"] for c in doc.get("cells", [])]
    d = sorted({i for i in ids if ids.count(i) > 1})
    if d:
        fail.append("DUPLICATE CELL IDS (%d): %s" % (len(d), d[:2]))
    unknown = sorted(set(ids) - set(exp_cells))
    missing = sorted(set(exp_cells) - set(ids))
    if unknown:
        fail.append("UNKNOWN CELL IDS (%d): %s" % (len(unknown), unknown[:2]))
    if missing:
        fail.append("MISSING CELL IDS (%d): %s" % (len(missing), missing[:2]))

    # row universe and axes, rebuilt from source — NOT read from the ledger
    exp_rows = {i.rsplit("::", 1)[0] for i in exp_cells}
    got_rows = {i.rsplit("::", 1)[0] for i in ids}
    if exp_rows - got_rows:
        fail.append("ROWS ABSENT FROM LEDGER (%d): %s"
                    % (len(exp_rows - got_rows), sorted(exp_rows - got_rows)[:2]))
    got_axes = {i.rsplit("::", 1)[1] for i in ids}
    if set(AXES) - got_axes:
        fail.append("AXES ABSENT FROM LEDGER: %s" % sorted(set(AXES) - got_axes))

    # per-cell semantic content, re-derived
    for c in doc.get("cells", []):
        e = exp_cells.get(c["cell_id"])
        if not e:
            continue
        for f in ("classification", "basis", "declared_reason", "value", "authority_citation"):
            if e.get(f) != c.get(f):
                fail.append("CELL CONTENT FORGED %s.%s: %r != expected %r"
                            % (c["cell_id"], f, c.get(f), e.get(f)))
                break

    got = doc.get("digests", {}).get("canonical_document_sha256")
    if got != canon_sha(doc):
        fail.append("CANONICAL DOCUMENT DIGEST MISMATCH (published %s)" % str(got)[:12])

    bad = sorted({c["classification"] for c in doc.get("cells", [])}
                 - set(doc.get("_classification_enum", [])))
    if bad:
        fail.append("CLASSIFICATION OUTSIDE ENUM: %s" % bad)

    for m in fail[:4]:
        print("  - %s" % m)
    print("LEDGER INTEGRITY [%s]: %s (%d cells, %d checks failed)"
          % (label, "PASS" if not fail else "FAIL", len(ids), len(fail)))
    return not fail


def repair(doc):
    """What a competent forger does next: recompute every count and digest so the
    document is internally self-consistent. The verifier must STILL go red."""
    cells = doc["cells"]
    ids = [c["cell_id"] for c in cells]
    doc["P1_observed_baseline"]["row_ids"] = sorted({i.rsplit("::", 1)[0] for i in ids})
    doc["P1_observed_baseline"]["row_count"] = len(doc["P1_observed_baseline"]["row_ids"])
    doc["P2_total_membership"]["axes"] = sorted({i.rsplit("::", 1)[1] for i in ids})
    doc["P2_total_membership"]["actual_cell_count"] = len(cells)
    doc["P2_total_membership"]["expected_cell_count"] = (
        len(doc["P1_observed_baseline"]["row_ids"]) * len(doc["P2_total_membership"]["axes"]))
    for key, f in (("counts_by_classification", lambda c: c["classification"]),
                   ("counts_by_basis", lambda c: c["basis"])):
        doc["P2_total_membership"][key] = dict(sorted(
            {f(c): sum(1 for x in cells if f(x) == f(c)) for c in cells}.items()))
    doc["integrity_census"]["duplicate_cell_ids"] = []
    doc["integrity_census"]["unknown_cell_ids"] = []
    doc["integrity_census"]["missing_cell_ids"] = []
    doc["digests"]["cell_id_set_sha256"] = hashlib.sha256(
        "\n".join(sorted(ids)).encode("utf-8")).hexdigest()
    doc["digests"]["row_universe_sha256"] = hashlib.sha256(
        "\n".join(doc["P1_observed_baseline"]["row_ids"]).encode("utf-8")).hexdigest()
    doc["digests"]["canonical_document_sha256"] = canon_sha(doc)
    return doc


def clone(doc):
    return json.loads(json.dumps(doc))


def main():
    raw = io.open(LEDGER, encoding="utf-8").read()
    doc, dups = parse_reject_dups(raw)
    results = [("clean control", check(doc, "clean control", dups))]

    # --- OBLIGATION C: membership mutants, each with counts+digests REPAIRED ---
    m = clone(doc); m["cells"].pop(3)
    results.append(("delete one cell", check(repair(m), "MUTANT: 1 cell deleted (+repaired)")))

    m = clone(doc)
    row = m["cells"][0]["cell_id"].rsplit("::", 1)[0]
    m["cells"] = [c for c in m["cells"] if not c["cell_id"].startswith(row + "::")]
    results.append(("delete whole row", check(repair(m), "MUTANT: whole ROW + 7 cells (+repaired)")))

    m = clone(doc)
    m["cells"] = [c for c in m["cells"] if c["axis"] != "bindable"]
    results.append(("delete whole axis", check(repair(m), "MUTANT: whole AXIS + cells (+repaired)")))

    m = clone(doc); c = clone(m["cells"][0])
    c["cell_id"] = "99-ghost.spec.json::ghost::bindable"; c["fixture"] = "99-ghost.spec.json"
    m["cells"].append(c)
    results.append(("add unknown row", check(repair(m), "MUTANT: unknown ROW added (+repaired)")))

    m = clone(doc); m["cells"].append(clone(m["cells"][0]))
    results.append(("duplicate a cell", check(repair(m), "MUTANT: cell duplicated (+repaired)")))

    # --- OBLIGATION D: content mutants ---
    def first(pred):
        return next(i for i, c in enumerate(doc["cells"]) if pred(c))

    for label, idx, patch in (
        ("UNADJUDICATED->ASSERTED", first(lambda c: c["classification"] == "UNADJUDICATED"),
         {"classification": "ASSERTED", "value": True}),
        ("NOT-APPLICABLE->ASSERTED", first(lambda c: c["classification"] == "NOT-APPLICABLE"),
         {"classification": "ASSERTED", "value": True}),
        ("forged basis", first(lambda c: c["basis"] == "UNDECLARED"),
         {"basis": "fixture-declared-id"}),
        ("nulled asserted value", first(lambda c: c["classification"] == "ASSERTED"),
         {"value": None}),
        ("removed declaration reason", first(lambda c: c.get("declared_reason")),
         {"declared_reason": None}),
        ("erased alias disclosure", first(lambda c: "declared as" in c["basis"]),
         {"basis": "row-declared-exact"}),
    ):
        m = clone(doc); m["cells"][idx].update(patch)
        results.append((label, check(repair(m), "MUTANT: " + label)))

    clean_ok = results[0][1]
    mutants = results[1:]
    caught = [n for n, ok in mutants if not ok]
    escaped = [n for n, ok in mutants if ok]
    print("ALL CASES DISCRIMINATE: %s  (clean=PASS, %d/%d mutants caught%s)"
          % (clean_ok and not escaped, len(caught), len(mutants),
             "" if not escaped else ", ESCAPED: %s" % escaped))
    return 0 if (clean_ok and not escaped) else 1


if __name__ == "__main__":
    sys.exit(main())
```
