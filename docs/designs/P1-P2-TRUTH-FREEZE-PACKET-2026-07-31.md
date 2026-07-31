# P1 / P2 TRUTH FREEZE — OBSERVED BASELINE AND TOTAL TRUTH MEMBERSHIP

**Authority:** R-520 §6 · **Author:** working agent, seat `claude.exe 26204` · **Date:** 2026-07-31
**Artifacts:** this packet + `docs/designs/P1-P2-TOTAL-MEMBERSHIP-2026-07-31.json` (**the ledger**). **No code was added to the repo.**
**Why this exists:** six `P0` attempts failed because **`A SPARSE OBJECT CANNOT PROVE THAT AN OMITTED TRUTH WAS DELETED`**. `P1` freezes *what exists now*; `P2` enumerates *what is intended to exist*, cell by cell, so completeness stops being an inference from presence.

> ⚠️★★★★★ **THE ONE NUMBER THIS DELIVERABLE EXISTS TO PRODUCE: `43` OF `210` CELLS ARE ABSENT FROM THE ORACLE **AND DECLARED NOWHERE** — not in a row's `unadjudicated`, not in any fixture-level gap statement. That is the silent-void population, measured. Every one of the six `P0` attempts was asked to distinguish those from deliberate omissions using the sparse object alone, which is impossible by construction.**

---

## 1 — `P1` OBSERVED BASELINE — *"what exists now?"*
⚠️ **`P1` answers ONLY that question. It does NOT convert present-presence into intended truth** — that conversion is exactly the defect `P2` exists to prevent.

| item | value |
|---|---|
| source commit | `c304b098b156106a5a81b714c7a5a3ed166d68ef` |
| oracle path | `ci/fixtures/spec-binding-parity-expanded/ORACLE.json` |
| oracle blob sha1 | `f57a9d005fb8e43b4772dac9f32cc94894c40fe1` |
| oracle bytes | `25095` |
| authority document | `docs/designs/ORACLE-AUTHORITY-ORPHAN-ZONES-2026-07-30.md` |
| authority sha256 **declared in the oracle** | `3494d4bbe6f10a9da3c6d79d594212b5542f904bae17209cfe3d68c0ea2214e2` |
| authority sha256 **measured here** | `3494d4bbe6f10a9da3c6d79d594212b5542f904bae17209cfe3d68c0ea2214e2` |
| **match** | **`True`** |
| fixtures | **`12`** |
| rows (fixture × condition_id) | **`30`** |
| present expectations | **`140`** |
| ledger cell-id-set sha256 | `de761836ba64f00fb2982e4bf7c3b23fecd799a50f3b8eab64681b22914ee8de` |
| ledger canonical document sha256 | `dbb871dd73da83e4e7b690efecde3e7a3230fc4076187da11bc4c2b38681d087` |

★★★ **THE AUTHORITY HASH RESOLVES, AND IT CLOSES AN OPEN CAMPAIGN ITEM.** `AR-540 §5` flagged `3494d4bb…` as *"not a git object"* and hypothesised it was a CONTENT hash rather than a fabrication. **[MEASURED HERE] it is the sha256 of `docs/designs/ORACLE-AUTHORITY-ORPHAN-ZONES-2026-07-30.md`, and it matches byte-for-byte. The hypothesis is confirmed; nothing was fabricated.**

**Fixture identities (`12`):**
- `00-control-shipped.spec.json`
- `10-lunch-orphan.spec.json`
- `11-premarket-orphan.spec.json`
- `20-nyam-evaluable.spec.json`
- `21-fivemin-chart.spec.json`
- `22-nypm-evaluable.spec.json`
- `23-silverbullet-evaluable.spec.json`
- `24-macrowindow-evaluable.spec.json`
- `30-compiled-flip.spec.json`
- `31-flip-neg-control.spec.json`
- `40-overrefusal-boundary.spec.json`
- `50-family-axis-invalidations.spec.json`

**Per-axis presence over the `30` rows — re-derived here, not relayed from R-520 §2:**

| axis | present | absent |
|---|---|---|
| `approximation` | 22 | 8 |
| `bindable` | 29 | 1 |
| `primitive_null` | 26 | 4 |
| `reason_excludes` | 4 | 26 |
| `reason_names` | 4 | 26 |
| `reason_null` | 29 | 1 |
| `session_zone` | 26 | 4 |

---

## 2 — `P2` TOTAL TRUTH MEMBERSHIP — *"what is intended to exist?"*
**The complete cartesian set: `30` rows × `7` axes = `210` CELLS.** `COMPLETENESS MUST BE AN ENUMERATED MEMBERSHIP SET, NOT AN INFERENCE FROM PRESENCE.`

| classification | cells |
|---|---|
| **ASSERTED** | 140 |
| **NOT-APPLICABLE** | 9 |
| **UNADJUDICATED** | 61 |

| basis | cells |
|---|---|
| `UNDECLARED` | 43 |
| `fixture-declared-prose` | 13 |
| `present-in-oracle` | 140 |
| `row-declared-alias (declared as 'primitive')` | 3 |
| `row-declared-exact` | 11 |

⚠️★★★★★ **THE AXIS LIST IS FROZEN IN THE GENERATOR AND IS DELIBERATELY *NOT* DERIVED FROM `ORACLE.json`.** Deriving the axis list from the artifact under test is the **self-authorizing** defect R-519 EDIT 1 named and R-520 §3 traced to the root: if the axes came from the oracle, deleting every instance of an axis would delete the axis itself and the matrix would shrink to fit the damage.

---

## 3 — THE CLASSIFICATION RULE, PRE-REGISTERED AND REVERSIBLE

| class | rule | grounded in |
|---|---|---|
| `ASSERTED` | the cell is present in the oracle | the artifact |
| `NOT-APPLICABLE` | authority **§4d**: *"`primitive` · everything else — **NO EXPECTATION — DECLARED GAP**; `FAMILY_META`-sourced; implementation on the parity surface"* — adjudicating it would read the expectation out of the code under test. **A MUST-NOT, not a not-yet.** | the AUTHORITY document |
| `UNADJUDICATED` | everything else — **including every cell grounded in authority §6, whose own title is `WHAT THIS FILE DOES NOT COVER [UNENUMERATED — OPEN]`** | the AUTHORITY document, or nothing at all |

★★★★★ **WHERE BOTH COULD BE ARGUED, `UNADJUDICATED` WINS** — R-520 §6's stop condition, applied as a tie-break rather than as a slogan. **`A 210-CELL MATRIX WITH GUESSED CELLS IS STRICTLY WORSE THAN THE SPARSE OBJECT`, because it converts an honest absence into a false assertion that everything downstream will trust.**
✅ **AND THE RULE IS REVERSIBLE BY DESIGN: every cell carries its `basis` and its verbatim `declared_reason`. If the desk rules that §4d's declared gap is `UNADJUDICATED` rather than `NOT-APPLICABLE`, that is a one-line change in the generator and a regeneration — no re-derivation, no re-reading of the authority.** ⚠️ **`9` cells turn on that single reading. They are the only cells in the ledger whose class rests on interpreting prose, and I am naming them rather than burying them.**
⚠️ **I did NOT re-derive the `140` ASSERTED VALUES against the authority document.** They are frozen AS OBSERVED. **`P1` is an observation, and a value that is correctly cited but mis-transcribed would survive this freeze** — the same rung-3 gap the `P0` packet declared out of scope. `[DECLARED SCOPE LIMIT, not an oversight.]`

---

## 4 — FINDINGS

### ⚠️★★★★★ P-F1 — `43` CELLS ARE ABSENT AND DECLARED NOWHERE
**Neither a row `unadjudicated` entry nor any fixture-level gap statement covers them.** This is the population that made `P0` unprovable: an omission here is **intentionally-not-applicable · honestly-unadjudicated · accidentally-deleted**, and the sparse object cannot say which.

| axis | undeclared cells |
|---|---|
| `reason_excludes` | 22 |
| `reason_names` | 21 |

| fixture | undeclared cells |
|---|---|
| `10-lunch-orphan.spec.json` | 3 |
| `11-premarket-orphan.spec.json` | 3 |
| `20-nyam-evaluable.spec.json` | 4 |
| `21-fivemin-chart.spec.json` | 3 |
| `22-nypm-evaluable.spec.json` | 4 |
| `23-silverbullet-evaluable.spec.json` | 4 |
| `24-macrowindow-evaluable.spec.json` | 4 |
| `30-compiled-flip.spec.json` | 4 |
| `31-flip-neg-control.spec.json` | 5 |
| `40-overrefusal-boundary.spec.json` | 9 |

★★★ **THIS IS NOT A DEFECT IN THE ORACLE'S AUTHORS.** Authority §6 states plainly that only session-family rows are adjudicated and that the membership manifest *"is wider than this oracle"*. **The oracle never claimed this coverage. `P0` assumed it.**

### ⚠️★★★ P-F2 — A NAMESPACE JOIN DEFECT IN THE DECLARED GAPS: `primitive` vs `primitive_null`
**[MEASURED HERE] `3` declared gaps in `40-overrefusal-boundary.spec.json` name the key `primitive`; the axis is `primitive_null`.** The ledger joins them **explicitly and records it** (`basis: row-declared-alias (declared as 'primitive')`) rather than joining silently.
⚠️ **UNDER A STRICT JOIN THOSE `3` CELLS WOULD BE `UNDECLARED` AND THE UNDECLARED COUNT WOULD BE `46`.** ★★★ **I record both numbers because the alias is a judgement, and `A SILENT JOIN IS AN UNTESTED HYPOTHESIS ABOUT TWO NAMES MEANING ONE THING`. R-520 §2 relayed this as `R-3` and marked it unverified; it is now measured, and it is a real name mismatch between the declaration and the axis it declares.**

### ✅ P-F3 — THE INTEGRITY CENSUS IS CLEAN, AND THE ZEROES HAVE A POSITIVE CONTROL
`duplicate JSON keys in source: [] (none)` · `duplicate cell ids: [] (none)` · `unknown cell ids: [] (none)` · `missing cell ids: [] (none)` · `unknown row keys: [] (none)` · `unresolved declared-gap keys: [] (none)`
★★★ **The duplicate-key census uses an `object_pairs_hook` because `json.load` SILENTLY KEEPS THE LAST of duplicate keys — a plain parse cannot see them at all.** ✅ **The zeroes are not an empty query: §5's red-proof plants a duplicate, an unknown and a deletion and each is caught.**

---

## 5 — PROOFS, EXECUTED, WITH OUTPUT

### Determinism across repeated generation and serialization
```
sha256 (run 1)  25fbd1cc765c0e4a66d1788b…
sha256 (run 2)  25fbd1cc765c0e4a66d1788b…
cmp run1 run2 -> RUN1 == RUN2 byte-identical: YES
```
Every collection is sorted; JSON is emitted with `sort_keys=True`, `ensure_ascii=True` and fixed separators; the digest is taken over that canonical serialization.

### Red-proof of the detection claim — **the completion signal is the EXIT STATUS and a FINAL SUMMARY LINE, never a grepped intermediate line**
```
LEDGER INTEGRITY [clean control]: PASS (210 cells, 0 checks failed)
LEDGER INTEGRITY [MUTANT: duplicated cell]: FAIL (211 cells, 3 checks failed)
LEDGER INTEGRITY [MUTANT: unknown cell]: FAIL (211 cells, 3 checks failed)
LEDGER INTEGRITY [MUTANT: deleted cell]: FAIL (209 cells, 3 checks failed)
ALL CASES DISCRIMINATE: True  (clean=True dup=False unknown=False deleted=False)
verifier exit: 0
```
★★★ **The clean control is what makes the three RED results mean something — `A MUTATION SUITE WITHOUT THE UNMUTATED CONTROL CANNOT TELL "CATCHES BREAKAGE" FROM "ALWAYS RED".`**

---

## 6 — HOW A CELL IS ADDED, DUPLICATED OR LOST — AND WHY THAT IS DETECTABLE
**The cell-id set IS the cartesian product of `P1`'s frozen `row_ids` and the frozen axes.** Any addition, duplication or loss changes the product, the count, or `cell_id_set_sha256`. **The verifier re-derives the product independently rather than trusting the ledger's own `expected_cell_count`.**

---

## 7 — WHAT THIS FREEZE DOES **NOT** DO (honest-partial clause, R-520 §6)
- ⚠️ **It does not make the `140` asserted values CORRECT.** They are frozen as observed; value-vs-authority re-derivation is the declared rung-3 limit (§3).
- ⚠️ **It does not classify the `43` undeclared cells beyond `UNADJUDICATED`.** The authority does not reach them, and **guessing would poison the ledger everything downstream will trust.** ★★ **Closing them is a DESK act — an authority amendment — not a worker act.**
- ⚠️ **`9` `NOT-APPLICABLE` cells rest on ONE reading of authority §4d** (§3). Reversible by a one-line regeneration.
- ⚠️ **The `3` alias-joined cells rest on a judgement** that `primitive` means `primitive_null` (P-F2). Both counts are published.
- ⚠️ **`P3`, Gate B and `P0-vNext` are untouched.** This freeze unblocks them; it does not begin them.
- ⚠️ **I do not grade my own work.** Whether this ledger is a sound authority for `P0-vNext` is an independent call.

---

## 8 — REPRODUCTION: THE GENERATOR, VERBATIM
**It runs from the scratchpad, OUTSIDE the repo, so the deliverable stays at exactly two artifacts.** Anyone can reproduce the ledger byte-for-byte from this listing alone.

```python
"""P1/P2 TRUTH-FREEZE GENERATOR — R-520 §6.

Runs OUTSIDE the repo (scratchpad). Emits exactly one artifact:
    docs/designs/P1-P2-TOTAL-MEMBERSHIP-2026-07-31.json

Deterministic by construction: every collection is sorted, JSON is written with
sort_keys + fixed separators + ensure_ascii, and the digest is taken over that
canonical serialization. Re-running on the same inputs is byte-identical.
"""
import hashlib
import io
import json
import subprocess
import sys

REPO = r"C:\Users\tonio\Projects\wt-h1-wave4-20260712"
SRC_COMMIT = "c304b098"
ORACLE_PATH = "ci/fixtures/spec-binding-parity-expanded/ORACLE.json"
AUTHORITY_PATH = "docs/designs/ORACLE-AUTHORITY-ORPHAN-ZONES-2026-07-30.md"
OUT = REPO + r"\docs\designs\P1-P2-TOTAL-MEMBERSHIP-2026-07-31.json"

# The SEVEN expectation axes. FROZEN HERE, in the generator — deliberately NOT
# derived from whichever keys happen to appear in ORACLE.json. Deriving the axis
# list from the artifact under test is the self-authorizing defect that killed
# the P0 lane (R-519 EDIT 1 / R-520 §3).
AXES = [
    "approximation",
    "bindable",
    "primitive_null",
    "reason_excludes",
    "reason_names",
    "reason_null",
    "session_zone",
]

# Non-axis row keys, frozen for the same reason.
NON_AXIS_ROW_KEYS = ["authority", "unadjudicated"]

# Documented alias: fixture 40's declared gaps name `primitive`; the axis is
# `primitive_null`. RECORDED, NOT SILENTLY JOINED — see the packet's finding P-F2.
DECLARED_GAP_ALIASES = {"primitive": "primitive_null"}


def sh(*args):
    return subprocess.run(args, cwd=REPO, capture_output=True, check=True).stdout


def load_with_dup_census(raw_text):
    """json.load silently keeps the LAST of duplicate keys. Catch them instead."""
    dups = []

    def hook(pairs):
        seen = {}
        for k, v in pairs:
            if k in seen:
                dups.append(k)
            seen[k] = v
        return seen

    return json.loads(raw_text, object_pairs_hook=hook), dups


def main():
    oracle_blob = sh("git", "show", "%s:%s" % (SRC_COMMIT, ORACLE_PATH))
    oracle_blob_sha = sh("git", "rev-parse", "%s:%s" % (SRC_COMMIT, ORACLE_PATH)).decode().strip()
    src_commit_full = sh("git", "rev-parse", SRC_COMMIT).decode().strip()
    oracle, dup_keys = load_with_dup_census(oracle_blob.decode("utf-8"))

    authority_bytes = io.open(REPO + "\\" + AUTHORITY_PATH.replace("/", "\\"), "rb").read()
    authority_sha = hashlib.sha256(authority_bytes).hexdigest()

    fixtures = oracle["fixtures"]

    # ---------- P1 : OBSERVED BASELINE — "what exists now?" ----------
    fixture_ids = sorted(fixtures.keys())
    rows = []
    for fn in fixture_ids:
        for cid in sorted((fixtures[fn].get("conditions") or {}).keys()):
            rows.append((fn, cid))

    present = []
    axis_counts = {a: 0 for a in AXES}
    unknown_row_keys = []
    for fn, cid in rows:
        row = fixtures[fn]["conditions"][cid]
        for k in sorted(row.keys()):
            if k in AXES:
                axis_counts[k] += 1
                present.append((fn, cid, k))
            elif k not in NON_AXIS_ROW_KEYS:
                unknown_row_keys.append("%s::%s::%s" % (fn, cid, k))

    # ---------- P2 : TOTAL TRUTH MEMBERSHIP — "what is intended to exist?" ----------
    # Classification rule, PRE-REGISTERED (packet §3):
    #   ASSERTED        - the cell is present in the oracle.
    #   NOT-APPLICABLE  - authority §4d: "primitive · everything else = NO EXPECTATION
    #                     - DECLARED GAP; FAMILY_META-sourced; implementation on the
    #                     parity surface." Adjudicating it would read the expectation
    #                     out of the code under test. A MUST-NOT, not a not-yet.
    #   UNADJUDICATED   - everything else, including every cell grounded in authority
    #                     §6, which is titled "[UNENUMERATED - OPEN]".
    # When the two could both be argued, UNADJUDICATED wins. R-520 §6 stop condition.
    cells = []
    for fn, cid in rows:
        row = fixtures[fn]["conditions"][cid]
        fx = fixtures[fn]
        declared = row.get("unadjudicated") or {}
        # map declared-gap keys onto axes, recording HOW they joined
        declared_axis = {}
        for k, reason in declared.items():
            if k in AXES:
                declared_axis[k] = (k, "row-declared-exact", reason)
            elif k in DECLARED_GAP_ALIASES:
                declared_axis[DECLARED_GAP_ALIASES[k]] = (k, "row-declared-alias", reason)
        fixture_ids_gap = fx.get("conditions_unadjudicated_ids") or []
        for axis in AXES:
            cell_id = "%s::%s::%s" % (fn, cid, axis)
            if axis in row:
                cells.append({
                    "cell_id": cell_id, "fixture": fn, "condition_id": cid, "axis": axis,
                    "classification": "ASSERTED",
                    "basis": "present-in-oracle",
                    "value": row[axis],
                    "authority_citation": row.get("authority"),
                })
                continue
            if axis in declared_axis:
                src_key, basis, reason = declared_axis[axis]
                na = ("section 4d" in reason or "section 4d's" in reason)
                open_ = ("OPEN" in reason or "DESK-OWNED" in reason
                         or "leaves it unadjudicated" in reason)
                cells.append({
                    "cell_id": cell_id, "fixture": fn, "condition_id": cid, "axis": axis,
                    "classification": "UNADJUDICATED" if open_ or not na else "NOT-APPLICABLE",
                    "basis": basis + ("" if src_key == axis else " (declared as '%s')" % src_key),
                    "declared_reason": reason,
                })
                continue
            if cid in fixture_ids_gap:
                cells.append({
                    "cell_id": cell_id, "fixture": fn, "condition_id": cid, "axis": axis,
                    "classification": "UNADJUDICATED", "basis": "fixture-declared-id",
                    "declared_reason": fx.get("conditions_unadjudicated"),
                })
                continue
            if "conditions_unadjudicated" in fx:
                cells.append({
                    "cell_id": cell_id, "fixture": fn, "condition_id": cid, "axis": axis,
                    "classification": "UNADJUDICATED", "basis": "fixture-declared-prose",
                    "declared_reason": fx.get("conditions_unadjudicated"),
                })
                continue
            cells.append({
                "cell_id": cell_id, "fixture": fn, "condition_id": cid, "axis": axis,
                "classification": "UNADJUDICATED", "basis": "UNDECLARED",
                "declared_reason": None,
            })

    cells.sort(key=lambda c: c["cell_id"])

    # ---------- integrity census ----------
    ids = [c["cell_id"] for c in cells]
    dup_cells = sorted({i for i in ids if ids.count(i) > 1})
    expected_ids = sorted("%s::%s::%s" % (fn, cid, a) for fn, cid in rows for a in AXES)
    unknown_cells = sorted(set(ids) - set(expected_ids))
    missing_cells = sorted(set(expected_ids) - set(ids))

    # unresolved identity census: declared-gap keys that join to no axis at all
    unresolved_gap_keys = []
    for fn, cid in rows:
        for k in sorted((fixtures[fn]["conditions"][cid].get("unadjudicated") or {}).keys()):
            if k not in AXES and k not in DECLARED_GAP_ALIASES:
                unresolved_gap_keys.append("%s::%s::%s" % (fn, cid, k))
    alias_joined = sorted(c["cell_id"] for c in cells if "declared as" in c.get("basis", ""))

    by_class = {}
    for c in cells:
        by_class[c["classification"]] = by_class.get(c["classification"], 0) + 1
    by_basis = {}
    for c in cells:
        by_basis[c["basis"]] = by_basis.get(c["basis"], 0) + 1

    doc = {
        "_schema": "P1-P2-TOTAL-MEMBERSHIP/1",
        "_generated_by": "gen_p1p2.py (source embedded verbatim in "
                         "docs/designs/P1-P2-TRUTH-FREEZE-PACKET-2026-07-31.md)",
        "_classification_enum": ["ASSERTED", "NOT-APPLICABLE", "UNADJUDICATED"],
        "P1_observed_baseline": {
            "source_commit": src_commit_full,
            "oracle_path": ORACLE_PATH,
            "oracle_blob_sha1": oracle_blob_sha,
            "oracle_bytes": len(oracle_blob),
            "authority_path": AUTHORITY_PATH,
            "authority_sha256_declared": oracle["authority_sha256"],
            "authority_sha256_measured": authority_sha,
            "authority_sha256_match": authority_sha == oracle["authority_sha256"],
            "fixture_count": len(fixture_ids),
            "fixture_ids": fixture_ids,
            "row_count": len(rows),
            "row_ids": ["%s::%s" % (fn, cid) for fn, cid in rows],
            "present_expectation_count": len(present),
            "per_axis_present_counts": {a: axis_counts[a] for a in AXES},
        },
        "P2_total_membership": {
            "axes": AXES,
            "axis_list_origin": "FROZEN IN THE GENERATOR — never derived from ORACLE.json",
            "expected_cell_count": len(rows) * len(AXES),
            "actual_cell_count": len(cells),
            "counts_by_classification": dict(sorted(by_class.items())),
            "counts_by_basis": dict(sorted(by_basis.items())),
        },
        "integrity_census": {
            "duplicate_json_keys_in_source": sorted(set(dup_keys)),
            "duplicate_cell_ids": dup_cells,
            "unknown_cell_ids": unknown_cells,
            "missing_cell_ids": missing_cells,
            "unknown_row_keys": sorted(set(unknown_row_keys)),
            "unresolved_declared_gap_keys": sorted(set(unresolved_gap_keys)),
            "alias_joined_cells": alias_joined,
            "detection_rule": "The cell-id set is the CARTESIAN PRODUCT of P1's frozen row_ids "
                              "and the frozen axes. Any added, duplicated or missing cell is "
                              "mechanically detectable by re-deriving that product and diffing "
                              "it against cell_id_set_sha256 below.",
        },
        "cells": cells,
    }

    canon = json.dumps(doc, sort_keys=True, ensure_ascii=True, separators=(",", ":"))
    doc["digests"] = {
        "cell_id_set_sha256": hashlib.sha256(
            "\n".join(sorted(ids)).encode("utf-8")).hexdigest(),
        "canonical_document_sha256": hashlib.sha256(canon.encode("utf-8")).hexdigest(),
        "digest_definition": "canonical_document_sha256 = sha256 of json.dumps(doc without "
                             "'digests', sort_keys=True, ensure_ascii=True, separators=(',',':'))",
    }

    io.open(OUT, "w", encoding="utf-8", newline="\n").write(
        json.dumps(doc, indent=1, sort_keys=True, ensure_ascii=True) + "\n")

    print("cells: %d (expected %d)" % (len(cells), len(rows) * len(AXES)))
    print("by classification:", json.dumps(dict(sorted(by_class.items()))))
    print("by basis:", json.dumps(dict(sorted(by_basis.items()))))
    print("present expectations:", len(present), "per-axis:", json.dumps(axis_counts))
    print("dup json keys:", sorted(set(dup_keys)), "| dup cells:", dup_cells,
          "| unknown:", unknown_cells, "| missing:", missing_cells)
    print("unknown row keys:", sorted(set(unknown_row_keys)))
    print("unresolved declared-gap keys:", sorted(set(unresolved_gap_keys)))
    print("alias-joined cells:", alias_joined)
    print("authority sha256 match:", authority_sha == oracle["authority_sha256"])
    print("canonical_document_sha256:", doc["digests"]["canonical_document_sha256"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## 9 — THE VERIFIER, VERBATIM
```python
"""RED-PROOF of the ledger's integrity claim (R-520 §6: 'adding an unknown cell or
duplicating a cell must be mechanically detectable').

Re-derives the cell-id set as the CARTESIAN PRODUCT of P1's frozen row_ids x frozen
axes and diffs it against the ledger. Prints a FINAL SUMMARY LINE and exits non-zero
on any violation, so the completion signal is the exit status, never a grepped line.
"""
import hashlib
import io
import json
import sys

LEDGER = r"C:\Users\tonio\Projects\wt-h1-wave4-20260712\docs\designs\P1-P2-TOTAL-MEMBERSHIP-2026-07-31.json"


def check(doc, label):
    p1, p2 = doc["P1_observed_baseline"], doc["P2_total_membership"]
    expected = sorted("%s::%s" % (r, a) for r in p1["row_ids"] for a in p2["axes"])
    ids = [c["cell_id"] for c in doc["cells"]]
    fail = []
    dups = sorted({i for i in ids if ids.count(i) > 1})
    unknown = sorted(set(ids) - set(expected))
    missing = sorted(set(expected) - set(ids))
    if dups:
        fail.append("DUPLICATE CELL IDS (%d): %s" % (len(dups), dups[:3]))
    if unknown:
        fail.append("UNKNOWN CELL IDS (%d): %s" % (len(unknown), unknown[:3]))
    if missing:
        fail.append("MISSING CELL IDS (%d): %s" % (len(missing), missing[:3]))
    if len(ids) != p2["expected_cell_count"]:
        fail.append("COUNT %d != declared %d" % (len(ids), p2["expected_cell_count"]))
    got = hashlib.sha256("\n".join(sorted(ids)).encode("utf-8")).hexdigest()
    if got != doc["digests"]["cell_id_set_sha256"]:
        fail.append("CELL-ID-SET DIGEST MISMATCH")
    allowed = set(doc["_classification_enum"])
    bad = sorted({c["classification"] for c in doc["cells"]} - allowed)
    if bad:
        fail.append("CLASSIFICATION OUTSIDE ENUM: %s" % bad)
    for m in fail:
        print("  - %s" % m)
    print("LEDGER INTEGRITY [%s]: %s (%d cells, %d checks failed)"
          % (label, "PASS" if not fail else "FAIL", len(ids), len(fail)))
    return not fail


def main():
    doc = json.loads(io.open(LEDGER, encoding="utf-8").read())
    ok_clean = check(doc, "clean control")

    m = json.loads(json.dumps(doc))
    m["cells"].append(json.loads(json.dumps(m["cells"][0])))
    ok_dup = check(m, "MUTANT: duplicated cell")

    m2 = json.loads(json.dumps(doc))
    c = json.loads(json.dumps(m2["cells"][0]))
    c["cell_id"] = "99-not-a-fixture.spec.json::ghost::bindable"
    m2["cells"].append(c)
    ok_unk = check(m2, "MUTANT: unknown cell")

    m3 = json.loads(json.dumps(doc))
    m3["cells"].pop(7)
    ok_miss = check(m3, "MUTANT: deleted cell")

    discriminates = ok_clean and not ok_dup and not ok_unk and not ok_miss
    print("ALL CASES DISCRIMINATE: %s  (clean=%s dup=%s unknown=%s deleted=%s)"
          % (discriminates, ok_clean, ok_dup, ok_unk, ok_miss))
    return 0 if discriminates else 1


if __name__ == "__main__":
    sys.exit(main())
```
