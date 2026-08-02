# GRADE — P1/P2 TRUTH FREEZE · **RE-CENSUS OF THE REPAIR**

**Grader:** `accuracy-validator`, independent seat · **Date:** 2026-08-01
**Target (pinned, did not move):** `f362a80b64e3def4fa9039cb0fd906df63f6250f` on `h1-wave4-sealed12-driver` (published on `origin`)
**Artifacts graded:** `docs/designs/P1-P2-TRUTH-FREEZE-PACKET-2026-07-31.md` · `docs/designs/P1-P2-TOTAL-MEMBERSHIP-2026-07-31.json`
**Source of row truth:** twelve `*.spec.json` under `ci/fixtures/spec-binding-parity-expanded/` at `c304b098b156106a5a81b714c7a5a3ed166d68ef`
**Prior census (an INPUT, read and re-tested, not inherited):** `GRADE-P1-P2-TRUTH-FREEZE-2026-08-01.md` at `76773939`
**Predecessor artifact for the preservation diff:** `c80c8df7f06eba8a925fe678b5320251967189c2`

---

## VERDICT

### ✅ **CLAIM NOT REFUTED — every conjunct re-derived through two or more non-overlapping paths.**
### ⚠️ **BUT: the verifier's guarantee stops at the `cells` array. `20` of `28` novel forgery operators are called `PASS`, including deleting the frame declaration and forging every published headline count — among them `UNDECLARED: 43 → 0`.**

The claim under attack, restated conjunct by conjunct:

| # | conjunct | verdict | evidence grade |
|---|---|---|---|
| 1 | freezes the row universe **INDEPENDENTLY of the artifact under test** | ✅ **TRUE** | MEASURED HERE — full input-surface enumeration, 17 reads, 16 pinned git objects, 1 mutable input proven unable to move membership |
| 2 | **43 rows** from the pinned source fixture specs | ✅ **TRUE** | MEASURED HERE ×2 paths |
| 3 | enumerates **301 cells** (`43 × 7`) | ✅ **TRUE** | MEASURED HERE ×2 paths |
| 4 | preserves all **210** previously-verified cells **semantically unchanged** | ✅ **TRUE** | MEASURED HERE — join key `cell_id`, 1:1 total, 0 semantic deltas |
| 5 | keeps the **43 UNDECLARED at exactly 43** | ✅ **TRUE** | MEASURED HERE — and the **same SET**, not merely the same count |
| 6 | verifier reddens on **row-deletion and axis-deletion even with counts and digests repaired** | ✅ **TRUE** | MEASURED HERE — re-executed, 11/11, clean control PASS, exit 0 |

**★★★ THE CENTRAL QUESTION IS ANSWERED IN THE ARTIFACT'S FAVOUR.** *"If an adversary may freely edit `ORACLE.json` and the ledger, can they still make the universe agree with them?"* — **NO. [MEASURED HERE]** The rejection of the census's own proposed `conditions.keys() ∪ conditions_unadjudicated_ids` fix was correct, and the replacement genuinely left the system.

**No numeric band was CLAIMED** — the packet says *"I do not grade my own work"* (§6). Correct conduct, credited again.

---

## THE CENTRAL QUESTION — RE-DERIVED, NOT READ

The design claims the row universe comes from `fixture filename × spec.entry_conditions[].id` in the **pinned source specs**, with the oracle only COMPARED. I did not take that from the docstring. I intercepted every `subprocess.run` and every `io.open` the derivation performs.

**Positive control first** — my instrument was initially **over**-sensitive (it logged subprocess pipe fds), caught by requiring an exact count of 2 on a planted pair. After filtering integer fds it captured exactly the planted subprocess read and the planted file read, and nothing else. *An enumeration from a blind instrument is worthless; this one is witnessed.*

**COMPLETE INPUT SURFACE OF `gen.build()` — 17 reads [MEASURED HERE]:**

| # | input | mutable? |
|---|---|---|
| 1 | `git show c304b098:…/ORACLE.json` | ❌ immutable object |
| 2–13 | `git show c304b098:…/{twelve}.spec.json` | ❌ immutable objects |
| 14 | `git ls-tree -r --name-only c304b098 ci/fixtures/spec-binding-parity-expanded/` | ❌ immutable tree |
| 15–16 | `git rev-parse c304b098` , `git rev-parse c304b098:…/ORACLE.json` | ❌ |
| 17 | `…/docs/designs/ORACLE-AUTHORITY-ORPHAN-ZONES-2026-07-30.md` | ⚠️ **live worktree — the ONLY mutable input** |

- **`GIT INVOCATIONS NOT PINNED TO c304b098: NONE`** [MEASURED HERE].
- **The working-tree path `ci/fixtures/spec-binding-parity-expanded/ORACLE.json` DOES NOT EXIST on this branch** — `ci/` is absent from `f362a80b` entirely. There is no working-tree oracle to tamper with; the only oracle is a git object addressed by a full commit hash.
- **The oracle influences `classification` / `basis` / `value` and NOTHING in the cell-id set.** Row membership is `12 spec blobs × their `entry_conditions[].id``, crossed with a seven-axis literal held in the generator.

**Tamper test of the one mutable input [MEASURED HERE]** — appended bytes to the authority document (`3494d4bb… → 46141f71…`) and re-ran the derivation:

| property | result |
|---|---|
| `row_ids` unchanged | ✅ **True** |
| cell-id set unchanged | ✅ **True** |
| every `classification` unchanged | ✅ **True** |
| `authority_sha256_match` | `True → False` — **the tamper is detected** |
| `canonical_document_sha256` | **moved** — see F-5 |

**Conclusion [MEASURED HERE]: MEMBERSHIP IS IMMUNE TO EVERY MUTABLE INPUT. The self-authorization defect is genuinely closed.**

---

## REQUIRED CHECKS 1–7 — RE-DERIVED

| # | check | result | how |
|---|---|---|---|
| 1 | 43-row universe from the pinned specs; `43 × 7 = 301` | ✅ | my own parser: 43 rows (15/2/2/2/2/2/2/2/3/3/5/3), unique 43, **0 conditions without an `id`**, **0 duplicate ids**, **0 duplicate JSON keys** in any spec |
| 2 | `ASSERTED 140` / `NOT-APPLICABLE 9` / `UNADJUDICATED 152`; `UNDECLARED` still `43` | ✅ | reproduced exactly by an independent re-implementation; `UNDECLARED` by axis = `reason_excludes 22` + `reason_names 21`; strict-join alternative = `46`, and the 3 alias cells are the named ones |
| 3 | preservation of all 210 cells vs `c80c8df7` | ✅ | see below |
| 4 | the 91 new cells `UNADJUDICATED`, explicit source-fixture basis, assert nothing | ✅ | 91/91 `UNADJUDICATED`; 91/91 basis `fixture-declared-id (row absent from oracle)`; **0 of 91 carry a `value` key at all**; 0 carry an `authority_citation`; all 91 carry a non-empty `declared_reason`; the 13 rows are exactly `rows_declared_absent_ids` |
| 5 | verifier independence + the five mutants | ✅ | re-executed; see below |
| 6 | content protection + duplicate-key rejection | ✅ **with a caveat** | all six named content mutants RED; duplicate JSON keys rejected **pre-parse** at every nesting depth; caveat in **F-2** |
| 7 | frame declaration | ✅ | see below |

### Check 3 — preservation [MEASURED HERE]
Join key **`cell_id`**, verified 1:1 and **total on the old side** before any comparison (`210` old ids, `0` absent from new, `301 = 210 + 91`).

| field | preserved across all 210 |
|---|---|
| `classification` | ✅ **yes** |
| `basis` | ✅ **yes** |
| `value` | ✅ **yes** |
| `declared_reason` | ✅ **yes** |
| `authority_citation` (140 non-null) | ✅ **140/140 byte-identical** |

**70 field-level deltas exist and every one is accounted for:**
- **9** = the AUTHORIZED change — `authority_citation` **key-absent → `"ORACLE-AUTHORITY-ORPHAN-ZONES-2026-07-30.md §4d"`** on exactly the 9 `NOT-APPLICABLE` cells. The `NOT-APPLICABLE` **set** is identical old-to-new.
- **61** = `authority_citation` **key-absent → explicit `null`**. v1 omitted the key on null cells; v2 emits it. **Semantically identical under `.get()`; a shape normalization, not a content change.** Disclosed here because a consumer testing `"authority_citation" in cell` sees a different answer (v1: 140/210 carry the key; v2: 301/301).

*My diff was deliberately over-strict and flagged all 70 — that is its positive control. It has teeth; the 61 survive review, the 9 are the authorized fill.*

### Check 7 — frame declaration [MEASURED HERE]
The packet's frame block and the ledger's `_frame` field both scope completeness to the pinned entry-condition × seven-axis frame and both name `compiled` · `spine_bound` · `spine_total` · `reasons_must_differ_from` · `scalars_unadjudicated` as OUT OF FRAME, *"recorded as a NAMED DOWNSTREAM SURFACE for `P0-vNext` / `P3`"* — **named, not deleted.**

**I proved the boundary by what it excludes.** Independent enumeration of every fixture-level key in the oracle:

`_note`(8) · `authority`(12) · `compiled`(11) · `conditions`(12) · `conditions_unadjudicated`(2) · `conditions_unadjudicated_ids`(1) · `reasons_must_differ_from`(1) · `scalars_unadjudicated`(1) · `spine_bound`(11) · `spine_total`(11)

The five named out-of-frame keys are **exactly** the fixture-level *expectation-bearing* keys. The remainder are structure (`conditions`), declaration (`conditions_unadjudicated*`), or metadata (`authority`, `_note`). **The out-of-frame list is EXHAUSTIVE, not illustrative.** Prior-census F-2 is closed.

### Check 5 — verifier independence [MEASURED HERE]
- `check()` derives `exp` from `gen.build()` (pinned sources) and holds `AXES` in its **own** constant. **It never reads `ledger.P1.row_ids` or `ledger.P2.axes`.** Confirmed by reading the executable lines, not the docstring.
- Re-executed against the pinned ledger blob: **`ALL CASES DISCRIMINATE: True (clean=PASS, 11/11 mutants caught)`, exit status `0`** — reproducing the packet's §5 block line for line.
- **Row-deletion and axis-deletion both go RED with `row_count`, `row_ids`, `axes`, `counts_by_*` and all three digests repaired first.** Prior-census F-3 is closed.

### Prior-census F-4 — the nine content blind spots, re-tested against the repair

| operator (prior census verdict) | verdict now |
|---|---|
| all 43 `UNDECLARED` → `ASSERTED` (was 🛑 GREEN) | ✅ **RED** |
| all 9 `NOT-APPLICABLE` → `ASSERTED` (was 🛑 GREEN) | ✅ **RED** |
| forge `basis` + fabricate `declared_reason` (was 🛑 GREEN) | ✅ **RED** |
| null every one of the 140 `ASSERTED` values (was 🛑 GREEN) | ✅ **RED** |
| strip every `declared_reason` (was 🛑 GREEN) | ✅ **RED** |
| erase all 3 alias disclosures (was 🛑 GREEN) | ✅ **RED** |
| self-consistent row delete / axis delete (was 🛑 GREEN) | ✅ **RED** |
| duplicate `"classification"` key **inside a cell** (was 🛑 GREEN, last-key-wins) | ✅ **RED** — and a plain `json.loads` still silently returns the flipped value, confirming the hook is doing real work |
| delete the `value` **key** from every `ASSERTED` cell (not previously tested) | ✅ **RED** |

**Prior-census F-1, F-2, F-3, F-4, F-5 are all CLOSED and independently verified. F-6 is NOT closed — see F-5 below.**

### The "VERBATIM" caption — a caption is a claim [MEASURED HERE]
The author's original scratchpad survives at session `f7a0bc78…`. I byte-diffed the packet's §7 and §8 listings against the files that actually ran:

```
diff packet-§7-extract  f7a0bc78/scratchpad/gen_p1p2.py    -> exit 0, no output
diff packet-§8-extract  f7a0bc78/scratchpad/verify_p1p2.py -> exit 0, no output
```

**Both listings are byte-identical to the executed code. The "VERBATIM" caption is TRUE.** This desk has convicted itself nine times on captions that were not; this one is.

### Determinism [MEASURED HERE]
Re-ran the generator twice (output redirected out of the shared tree). File sha256 `4392bc65a38235ec4fe1c659556dfe007a7436a916bc1a46c7d2827bbd7f0c6f` on both runs, **byte-identical to the pinned blob at `f362a80b`** (132,703 B). `canonical_document_sha256` `e2d0cd77…` matches §1. ORACLE blob sha1 `f57a9d00…` matches §1. Authority sha256 `3494d4bb…` matches at the worktree and at `f362a80b`.

---

## FINDINGS

### 🛑 F-1 — HIGH · THE VERIFIER'S GUARANTEE STOPS AT `cells[]`; 20 OF 28 NOVEL OPERATORS ESCAPE

**Severity:** HIGH (silent disagreement — a forged document the shipped verifier certifies `PASS`, exit 0)
**Claim:** the packet publishes the verifier as the artifact's integrity guard, red-proofed 11/11.
**Reality:** `check()` validates the `cells` array and nothing else. Every other region of the document is unprotected once the forger re-seals `canonical_document_sha256`.

**All five NOOP controls GREEN first** (untouched · clone→`repair` · clone→reseal · JSON round-trip · cells reversed) — the harness is not a second cause of any red. The shipped 11 all RED. Then 28 novel operators:

| region | operator | shipped verifier |
|---|---|---|
| **cell** | add unknown keys (`desk_verified: true`, `reviewed_by`) | 🛑 **GREEN** |
| **cell** | add `value: null` to an `UNADJUDICATED` cell | 🛑 **GREEN** |
| **cell** | forge the `axis` field (cell_id intact) | 🛑 **GREEN** |
| **cell** | forge the `fixture` field | 🛑 **GREEN** |
| **cell** | forge the `condition_id` field | 🛑 **GREEN** |
| **manifest** | `counts_by_basis.UNDECLARED` **43 → 0** | 🛑 **GREEN** |
| **manifest** | `counts_by_classification` → `{ASSERTED: 301}` | 🛑 **GREEN** |
| **manifest** | `rows_declared_absent_from_oracle` **13 → 0**, ids emptied | 🛑 **GREEN** |
| **manifest** | `row_count` **43 → 30** (v1's wrong number, restored) | 🛑 **GREEN** |
| **manifest** | `expected/actual_cell_count` **301 → 210** | 🛑 **GREEN** |
| **manifest** | `authority_sha256_measured` forged, `match` left `True` | 🛑 **GREEN** |
| **manifest** | `per_axis_present_counts` + `present_expectation_count` forged | 🛑 **GREEN** |
| **census** | `alias_joined_cells` emptied (P-F2 disclosure erased) | 🛑 **GREEN** |
| **census** | fabricate `unknown_row_keys` / `duplicate_json_keys_in_source` | 🛑 **GREEN** |
| **digests** | `row_universe_sha256` + `cell_id_set_sha256` → zeroes | 🛑 **GREEN** |
| **digests** | `digest_definition` prose rewritten | 🛑 **GREEN** |
| **frame** | **`_frame` DELETED entirely** | 🛑 **GREEN** |
| **frame** | **`_frame` rewritten to `"COMPLETE OVER EVERY EXPECTATION."`** | 🛑 **GREEN** |
| **frame** | `_schema` retyped to `/9` | 🛑 **GREEN** |
| **frame** | `_classification_enum` widened with `DESK-VERIFIED` | 🛑 **GREEN** |
| cell | retype `value: false` on an `UNADJUDICATED` cell | ✅ RED |
| cell | delete `digests.canonical_document_sha256` | ✅ RED |
| axis | **add an UNKNOWN AXIS** (+repaired) — *not in the shipped set* | ✅ RED |
| cells | delete all cells / delete the `cells` key | ✅ RED |
| cell | swap two cell_ids **whose content differs** | ✅ RED |
| row | rename a whole row (+repaired) | ✅ RED |
| manifest | duplicate top-level JSON key `_schema` | ✅ RED |
| cell | reorder (benign by design) | GREEN — correct |

⚠️ **WITHDRAWN BY ME:** my first swap experiment reported GREEN. It swapped `bias::approximation` with `bias::bindable` — **[MEASURED HERE] semantically identical cells**, so the swap was a genuine no-op and the GREEN was correct. Re-run with an `ASSERTED`/`UNDECLARED` pair it goes **RED**. Corrected count: **20 escapes, not 21.** *A grader's own harness can have the bug.*

★★★★★ **THE TWO THAT MATTER MOST.** The `43` UNDECLARED are stated to be the point of this artifact — **`counts_by_basis.UNDECLARED = 0` passes.** And `_frame` is obligation `B`, the clause that stops a partial completeness claim being read as total — **deleting it passes, and rewriting it into an unbounded claim passes.** The outcome rule says *fail only if the ledger misrepresents its uncertainty*; these two operators are precisely how a ledger misrepresents its uncertainty, and the guard does not see them.

**Fix point — ONE LINE, and the expected value is already in the function.** `check()` computes `exp = gen.build()` at its top and uses only `exp["cells"]`. `exp["digests"]["canonical_document_sha256"]` is discarded.

```
verify_p1p2.py, check(), replacing the self-comparison at the `canon_sha` block:
    got = doc.get("digests", {}).get("canonical_document_sha256")
    if got != exp["digests"]["canonical_document_sha256"]:      # <- exp, not canon_sha(doc)
        fail.append(...)
```

**[MEASURED HERE] I implemented it and re-ran all 20: 18 go RED, and BOTH clean controls (pinned document, and a JSON round-trip of it) still PASS** — the remedy has a path to red and a path to green.

**Repro:** `C:\Users\tonio\AppData\Local\Temp\claude\C--Users-tonio-Projects-trading-forge\b45b0372-8d74-4829-be08-c446fea62c8f\scratchpad\novel_hunt.py` and `…\remedy.py`
**Blast radius:** any consumer that reads the ledger's **summary** rather than re-summing its 301 cells — which is every human reader, the packet's own §1/§2/§4 tables, and `P0-vNext` if it is built on the manifest fields.

---

### ⚠️ F-2 — MEDIUM · THE CANONICAL-DIGEST CHECK IS SELF-REFERENTIAL, SO IT CLOSES NOTHING

**Severity:** MEDIUM (a check with no path to red against the adversary it names)
**Claim (packet §0/commit message, obligation D):** *"D also verifies `canonical_document_sha256` from an independent canonicalization (previously published but never checked)."*
**Reality [MEASURED HERE]:** `canon_sha(doc)` re-canonicalises **the ledger itself**:

```
verify_p1p2.py:91   got = doc.get("digests", {}).get("canonical_document_sha256")
verify_p1p2.py:92   if got != canon_sha(doc):
```

The canonicalization is independent of the ledger's *stored digest*; it is **not** independent of the ledger's *content*. Against the threat model the packet itself declares — *"what a competent forger does next: recompute every count and digest"* — it is inert. The verifier's own `repair()` recomputes it, which is why every shipped mutant sails past this check and is caught by the cell comparison instead.

**This matters because it is the prior census's own remedy, implemented in its weakest form.** `GRADE-P1-P2-TRUTH-FREEZE-2026-08-01.md` F-4 said verifying `canonical_document_sha256` *"would close **every** content-mutation row above in one line, since it digests the whole document."* That sentence is true only of a digest compared against an **independently re-derived** document. Compared against itself it closes zero.

**In fairness, and measured:** the content class the prior census listed **is** closed — by the per-cell comparison against `exp_cells`, a stronger mechanism than the digest would have been. The net is a real improvement. What the weak digest check leaves open is F-1's twenty.

**Repro:** `…\scratchpad\final_probes.py`, section J.

---

### ⚠️ F-3 — MEDIUM · TWO OF THE THREE PUBLISHED DIGESTS ARE OUTSIDE BOTH THE HASH AND EVERY CHECK

**Severity:** MEDIUM (forge-digest operator class, unreached even by the F-1 remedy)
`canon_sha()` excludes the **entire** `digests` object: `d = {k: v for k, v in doc.items() if k != "digests"}`. Therefore `row_universe_sha256`, `cell_id_set_sha256` and `digest_definition` are covered by **no** canonical hash and **no** check.

`row_universe_sha256 = dd8c33d3…` and `cell_id_set_sha256 = a62906fa…` are **printed in packet §1 as evidence**. [MEASURED HERE] both can be set to 64 zeroes and the shipped verifier says `PASS` — **and so does the strengthened one-line version**, because the field it compares lives inside the excluded object. These are the only 2 of 20 the remedy does not reach.

**Fix point:** compare `doc["digests"]` against `exp["digests"]` field-by-field (excluding `canonical_document_sha256` from its own comparison), or fold `digests`-minus-canonical into the canonicalization.
**Repro:** `…\scratchpad\remedy.py`, rows `FORGE row_universe+cell_id_set digests` and `FORGE digest_definition prose`.

---

### ⚠️ F-4 — MEDIUM · THE PINNED ROW-UNIVERSE SOURCE IS NOT REACHABLE FROM THE ARTIFACT'S OWN HISTORY

**Severity:** MEDIUM (durability — the independence that makes the design correct also makes it fragile)
**[MEASURED HERE]:**

```
git merge-base --is-ancestor c304b098 f362a80b   -> NO
git ls-tree f362a80b -- ci/                      -> (empty; no ci/ directory at all)
git for-each-ref --contains c304b098             -> refs/heads/hardening/ledger-e-delivery-r497-20260730
                                                    refs/remotes/origin/hardening/ledger-e-delivery-r497-20260730
```

The twelve source specs exist **only** on a side branch that is not an ancestor of the artifact commit. Both refs are the sole reachability anchors. Delete that branch locally and on `origin` and a `git gc` prunes the objects — at which point the generator, the verifier, and every future re-census of this artifact become **unrunnable**, and the row universe becomes unverifiable in principle.

This is a genuine cost of the (correct) decision to source the universe outside the artifact's own tree. It is not disclosed in the packet's honest-partial clause.

**Fix point:** an annotated tag on `c304b098` (e.g. `pin/p1p2-row-universe-source`), named in packet §1 beside the commit hash. `SRC_COMMIT` is also an 8-hex abbreviation; [MEASURED HERE] `git rev-parse --disambiguate=c304b098` returns exactly one object today, and an ambiguous prefix would fail loudly rather than silently — so that part is a nit, not a defect.

---

### ⚠️ F-5 — MEDIUM-LOW · CARRIED FORWARD UNFIXED: THE ONE MUTABLE INPUT STILL FEEDS THE PUBLISHED DIGEST

**Severity:** MEDIUM-LOW (reproducibility, on a **shared live tree**)
Prior-census F-6, not closed by the repair. The generator reads eleven-twelfths of its world from pinned git objects and the authority document from `REPO + AUTHORITY_PATH` — **an unpinned read of the live worktree**, inside an otherwise commit-pinned derivation.

**[MEASURED HERE] the blast radius is bounded and now measured, not assumed:** under a tampered authority document, `row_ids`, the cell-id set and every `classification` are **unchanged** — membership is immune. But `authority_sha256_measured` and hence `canonical_document_sha256` **do** move. So the packet's *"byte-identical across regeneration: YES"* is conditional on one mutable file in a tree that the brief itself describes as SHARED and live. Today it resolves identically at the worktree and at `f362a80b` (`3494d4bb…`), so there is no live defect.

**Fix point:** `git show <pin>:docs/designs/ORACLE-AUTHORITY-ORPHAN-ZONES-2026-07-30.md`, matching the treatment of every other input.

---

### ℹ️ F-6 — LOW · THE PUBLISHED REPRODUCTION RECIPE OVERWRITES THE ARTIFACT IT CERTIFIES

`gen_p1p2.py` line 28 (packet §7, verbatim) is:

```
OUT = REPO + r"\docs\designs\P1-P2-TOTAL-MEMBERSHIP-2026-07-31.json"
```

Anyone following §7's instruction to run the generator **writes over the pinned ledger in the shared live worktree**. The write happens to be byte-identical today — I proved that by redirecting `OUT` to scratchpad and comparing — but a grader with a dirty authority document, or any future divergence, silently mutates the certified artifact mid-audit. **Not a truth defect; an operational hazard that a reproduction section should not carry.** I redirected `OUT` and touched nothing in the tree.

---

### ℹ️ F-7 — LOW · THE "OUTPUT CAPTURED LIVE" BLOCK IS NOT BYTE-FAITHFUL

**[MEASURED HERE]** the packet contains **exactly one** `U+FFFD` replacement character, at §5 inside the red-proof block, in the expected `declared_reason` evidence: `…the INVALIDATE row) <U+FFFD> authority section 6…`.

**The ledger contains ZERO `U+FFFD`** — it stores the character correctly as `\u2014` (em dash), 165 occurrences, `ensure_ascii=True`, zero literal non-ASCII bytes. Re-running the verifier under `PYTHONIOENCODING=utf-8` reproduces the em dash correctly.

So the data is clean and the transcript is not: §5's *"OUTPUT CAPTURED LIVE INTO THIS DOCUMENT"* passed through a lossy `cp1252` console encode that destroyed one character of evidence. `A CAPTION IS A CLAIM` — the block is a re-encoded transcript, not a capture. **Fix at the emitter** (`PYTHONIOENCODING=utf-8` when capturing), never by hand-editing the character back in.

---

### ℹ️ F-8 — LOW · NON-SCALAR RETYPE CRASHES THE GUARD INSTEAD OF REPORTING

**[MEASURED HERE]** `classification → ["ASSERTED"]` raises `TypeError` (unhashable, in the enum set-difference) and `cell_id → null` raises `AttributeError`. Both **fail closed** — unhandled exception, exit 1, and per the verifier's own contract (*"Completion signal = FINAL SUMMARY LINE + EXIT STATUS"*) the absent summary line is correctly read as not-passed. But the guard produces a traceback rather than a diagnosis. Scalar retypes (`classification → null`, `basis → 7`) go cleanly RED.

---

## NOVEL HUNT — THE OPERATOR MATRIX, AND WHAT THE DESIGN DOES NOT REACH

Rows are operator classes; columns are the object operated on. `cells[]` is the only well-defended column.

| operator | on a **cell** | on a **row** | on an **axis** | on the **manifest** (everything outside `cells[]`) |
|---|---|---|---|---|
| **delete** | ✅ RED | ✅ RED (+repaired) | ✅ RED (+repaired) | 🛑 **GREEN** — `_frame`, digest sub-keys |
| **duplicate** | ✅ RED (id + JSON key, any depth) | ✅ RED | — | ✅ RED (JSON key) |
| **retype** | ✅ RED (scalar) · ⚠️ CRASH (non-scalar) | — | — | 🛑 **GREEN** — `_schema`, widened enum |
| **empty-value** | ✅ RED (null a value, drop the key) | — | — | 🛑 **GREEN** — census lists emptied |
| **alias-collision** | ✅ RED (basis rewritten) | — | — | 🛑 **GREEN** — `alias_joined_cells` erased |
| **reorder** | GREEN — benign, `cell_id` is self-identifying | — | — | — |
| **rename** | ✅ RED (swap differing ids) | ✅ RED (+repaired) | ✅ RED (unknown axis) | 🛑 **GREEN** — via add-key |
| **forge-digest** | — | — | — | ⚠️ **SPLIT**: `canonical_document_sha256` RED only if *not* re-sealed (F-2); `row_universe_sha256` / `cell_id_set_sha256` **GREEN always** (F-3) |
| **add-key** | 🛑 **GREEN** — `desk_verified`, `value: null` | — | — | 🛑 **GREEN** |

**THE UNREACHED CLASS, STATED ONCE:** *every operator applied anywhere outside the `cells` array, plus `add-key` inside it.* Eighteen of the twenty are closed by F-1's one line; the last two need F-3's.

---

## GRADING TABLE

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| **P1 row universe — independence from the artifact under test** (obligation A) | **8** | **VERIFIED** | full input-surface enumeration with a witnessed positive control: 16/16 git reads pinned to `c304b098`, 1 mutable input proven unable to move membership; the working-tree oracle path does not exist; regeneration byte-identical to the pinned blob | F-4 (source reachable only via a side branch), F-5 (authority unpinned) |
| **P2 cell content + the 43 UNDECLARED** | **8** | **VERIFIED** | 301/301 cells reproduced by an independent re-implementation with **0** semantic mismatches; 140/9/152 and UNDECLARED 43 re-derived twice; strict-join 46 and the 3 alias cells correct; **zero guessed cells** | none found — I could not move one cell |
| **Preservation of the 210** (check 3) | **8** | **VERIFIED** | join key `cell_id`, 1:1 and total; `classification`/`basis`/`value`/`declared_reason` **all preserved**; 140/140 non-null citations byte-identical; the only authorized change is the 9 §4d fills | 61 key-absent→null shape normalizations, disclosed |
| **Frame declaration** (obligation B) | **7** | **VERIFIED** | the 5 named out-of-frame keys are **exactly** the fixture-level expectation-bearing keys — boundary proven by independent enumeration, not by reading the caption; named as a downstream surface, not deleted | **the declaration itself is deletable with the verifier still GREEN (F-1)** |
| **Integrity verifier** (obligations C, D) | **6** | **VERIFIED** | 11/11 shipped mutants reproduced with a real clean control and exit 0; row- and axis-deletion RED **with counts and digests repaired**; all 9 prior-census content blind spots now RED; duplicate JSON keys rejected pre-parse at any depth | **F-1 (20 escapes), F-2 (self-referential digest), F-3 (2 digests unprotected), F-8** |
| **Packet as an authority for `P0-vNext`** | **7** | **VERIFIED** | the denominator defect that caused the prior FAIL is genuinely repaired and the repair is the *stronger* of the two candidate fixes; the honest-partial clause is real | a consumer reading the **summary** rather than re-summing the cells is reading an unprotected surface (F-1) |

**Overall: BAND 7 — adversarially tested, with residual risks documented and one open HIGH.**
Not 8: F-1 is a HIGH that the artifact's own guard authorizes. Not 9: 9 requires zero open HIGHs.
**The prior census's FAIL is LIFTED. The claim under attack stands.**

---

## THE SMALLEST CORRECTION

Two lines in the §8 verifier listing, then re-run and re-paste §5. **No data moves; all 301 cells are already correct.**

1. **F-1** — in `check()`, compare the ledger's `canonical_document_sha256` against **`exp["digests"]["canonical_document_sha256"]`** instead of `canon_sha(doc)`. `exp` is already in scope. Closes 18 of 20. *(Measured: both clean controls still PASS.)*
2. **F-3** — also compare `doc["digests"]` to `exp["digests"]` for `row_universe_sha256` and `cell_id_set_sha256`. Closes the last 2.
3. *(Optional, caption-only)* — F-4: tag `c304b098` and name the tag in §1. F-5: read the authority via `git show`. F-6: point `OUT` outside the repo. F-7: re-capture §5 under `PYTHONIOENCODING=utf-8`.

---

## MANDATORY CLOSING COVERAGE

### 1 — What I verified, and via which non-overlapping paths

| claim | path A | path B | path C |
|---|---|---|---|
| 43-row universe | shipped `gen_p1p2.py` re-executed | my own parser over the 12 spec blobs (no import of their code) | oracle top-level `required_members` independently corroborates the 12-fixture dimension |
| 301 cells | shipped generator | my own cartesian product | published `expected/actual_cell_count` |
| 140 / 9 / 152 · UNDECLARED 43 | shipped generator stdout | my independent classifier — **0 mismatches over 301 cells** | published `counts_by_*` |
| the seven axes are the right seven | frozen constant in the generator | **data-derived**: union of oracle row keys minus `{authority, unadjudicated}` — **equal**; and `unadjudicated`-map keys minus axes minus `{primitive}` = **∅**, so there is no undisclosed second alias | packet §1 per-axis table |
| ledger == pinned artifact | regeneration byte-identical (sha256 `4392bc65…`, 132,703 B) | `canonical_document_sha256` `e2d0cd77…` recomputed | `git diff` working tree vs `f362a80b` clean |
| §7/§8 listings are VERBATIM | extracted from the packet and parsed | **byte-diff against the author's actual executed files** in the surviving `f7a0bc78` scratchpad — exit 0 | both re-executed and reproduced §5 line for line |
| membership independence | read the executable lines of `row_universe()` / `check()` | **runtime interception** of all 17 reads with a positive control | tamper test on the one mutable input |
| verifier discriminates | re-executed shipped 11/11 + clean control | 44 further experiments incl. 5 NOOP controls | remedy re-run showing 18/20 flip to RED |

### 2 — Positive-control witnesses for every absence claim

| absence claim | positive control |
|---|---|
| "the derivation reads no mutable input but the authority doc" | the interceptor was validated on a **planted** subprocess read and a **planted** file read, requiring an exact count of 2. It first returned 6 — **my own instrument was over-sensitive** (subprocess pipe fds) — and I fixed it before trusting any enumeration. |
| "no duplicate JSON keys in the specs / oracle / ledger" | injected a duplicate `_schema` at top level **and** a duplicate `classification` inside a cell; both detected, and plain `json.loads` demonstrably returned the forged last-key value in both cases |
| "no condition lacks an `id`, no duplicate condition ids" | the checks emit on a positive; verified they can fire by construction (explicit branches), and 12/12 files parsed with the same code that reports the 43 |
| "these 20 operators escape" | 5 NOOP controls GREEN (harness inert) **and** 8 operators RED in the same battery (harness capable of red) |
| "the one-line remedy works" | both clean controls still PASS — the strengthened check has a path to green as well as to red |
| "the 210 cells are unchanged" | my diff flagged all 70 field-level deltas before I classified them — it was not silent |
| "the out-of-frame list is exhaustive" | enumerated **all 10** fixture-level keys present in the oracle and classified each, rather than checking only the 5 named |

### 3 — Join keys for every "identical / unchanged / matches" claim

- **Preservation (210 cells):** join key **`cell_id`**; verified 1:1 and **total on the old side** *before* comparison (0 of 210 absent from the new document).
- **"UNDECLARED still 43":** compared the **SET** of `cell_id`s with `basis == "UNDECLARED"`, not the count — `old == new`, |43|.
- **"NOT-APPLICABLE unchanged":** set of `cell_id`s, old == new, |9|.
- **"my derivation == published":** join key `cell_id`; id sets identical; 5 fields compared per cell.
- **"regeneration byte-identical":** join key = the file bytes (sha256), not a field.
- **"VERBATIM listings":** join key = the file bytes (`diff` exit 0).
- **"authority matches":** sha256 of the file, compared at the worktree and at `f362a80b`, against the value stored in the pinned oracle.
- **"ORACLE blob":** `git rev-parse c304b098:…/ORACLE.json` == packet §1's `f57a9d00…`.

### 4 — What I did NOT verify, and why

1. **Whether the 140 ASSERTED values are CORRECT against the authority document.** I verified each matches the pinned oracle on an exact join key. Value-vs-authority re-derivation is the packet's own declared rung-3 limit (§6) and was not in this brief's checks 1–7. **The ledger's correctness as a transcription of the oracle is verified; the oracle's correctness is not re-litigated here.**
2. **Whether the 9 `NOT-APPLICABLE` readings of authority §4d are the right readings.** This rests on prose (`na = "section 4d" in reason`, negated by an `OPEN`/`DESK-OWNED` disjunction). The packet discloses that one line flips them. I verified the rule is applied **consistently** to all 301 cells and that both readings are published; I did **not** adjudicate the prose. That is an authority amendment — a desk act.
3. **Everything OUT OF FRAME** — `compiled`, `spine_bound`, `spine_total`, `reasons_must_differ_from`, `scalars_unadjudicated`. I verified they are correctly *named and excluded*; I did not enumerate their truth. Prior-census F-2 measured that all 35 can be deleted without moving this ledger; **that remains true and is now a declared boundary rather than a hidden one.**
4. **`gen.build()` as an independent re-implementation.** It is not one, and the packet says so in the `build()` docstring: the verifier imports the generator so there is exactly one copy of the derivation rule. That is a defensible anti-drift choice (R-513), but it means the verifier catches **ledger** forgery, not **generator** error. My own from-scratch re-implementation (path B) is the mitigation and found 0 mismatches — but it is *my* second implementation, not the shipped tooling's.
5. **CI / any runtime surface.** There is no executable artifact in the repo; the generator and verifier exist only as listings in a markdown file and as files in two ephemeral scratchpad directories. **Nothing here is a gate. It cannot fail a build.** Consistent with *"No code was added to the repo"*, but it means this is a certified transcript, not a standing guard.
6. **Whether `76773939`'s own numbers were right.** I read that document and re-tested its findings against the repair; I did not re-audit its measurements of the *superseded* `c80c8df7` artifact beyond the 210-cell preservation diff, which independently confirms its `140 / 9 / 61` and `UNDECLARED 43`.
7. **Concurrent mutation of the shared tree during this audit.** I re-confirmed `f362a80b` and both artifacts byte-clean at start; I did not hold a lock. The tree is shared and live.

### 5 — UNDETERMINED

- **Whether F-1's twenty escapes have ever been exploited.** No evidence they have; the pinned ledger is fully consistent with the pinned sources on all 301 cells and every summary field I recomputed. The finding is that the guard *authorizes* the forgery, not that one occurred.
- **Whether `_note` and fixture-level `authority` (unconsumed, unnamed) belong in frame.** They carry no expectation I can identify, so I treated them as metadata; a desk reading could differ. Covered by the packet's `"any other fixture-level scalar or relational expectation"` catch-all either way.

### 6 — Harness faults found in my own instrument, and corrected

1. **The read-interceptor was over-sensitive**, logging `subprocess`'s internal pipe fds — 6 events where 2 were planted. Caught by the exact-count assertion, fixed by filtering integer fds, re-validated before any enumeration was trusted.
2. **My first swap experiment reported a false escape.** It swapped two semantically identical cells, making the mutation a genuine no-op. Re-run against a differing pair it goes RED. **Withdrawn from the findings; the escape count is 20, not 21.**

*Both are recorded because a census that hides its own harness bugs is asking to be believed rather than checked.*

### 7 — Independence declaration

- I am **not** the author of the artifact under test, of `gen_p1p2.py`, or of `verify_p1p2.py`.
- I did **not** write, design, or advise on the repair, and I did not participate in `R-523 §4`.
- **Lineage disclosure:** the prior census `76773939` was produced by this same agent **role** (`accuracy-validator`) in a separate session. I therefore treated it as an INPUT and a CLAIM: I re-derived every number it asserted rather than inheriting one, and I **re-tested each of its six findings against the repair** — F-1 through F-5 closed, F-6 not closed and carried forward here as F-5. I also **found against its central remedy twice**: (a) its proposed `conditions ∪ conditions_unadjudicated_ids` fix was correctly rejected by the author, and I confirm the rejection was right; (b) its F-4 claim that verifying `canonical_document_sha256` *"would close every content-mutation row in one line"* is **only true of a digest compared against a re-derived document**, and the self-referential implementation that shipped closes none of them (my F-2).
- I re-derived every band from the current artifacts. I ignored the prior bands when scoring. The one >1-band movement (`membership set` 3 → 8) is justified by an independent re-scan: byte-identical regeneration from the pinned sources, a from-scratch second implementation agreeing on all 301 cells, and a runtime enumeration of the derivation's entire input surface.
- **Scope of every band:** the two pinned artifacts at `f362a80b`, the twelve spec blobs and `ORACLE.json` at `c304b098`, the authority document at sha256 `3494d4bb…`, Python 3.13.0, tree `C:/Users/tonio/Projects/wt-h1-wave4-20260712`. Nothing here is scoped to CI, to `HEAD`, or to any other tree.
- **Read-only compliance:** no `checkout`, `reset`, or index operation was performed. The generator's `OUT` was redirected to scratchpad so the pinned ledger was never written. The only file I created in the tree is this receipt.
