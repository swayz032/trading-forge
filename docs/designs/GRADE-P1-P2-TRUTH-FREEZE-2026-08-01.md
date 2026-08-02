# GRADE — P1/P2 TRUTH FREEZE · INDEPENDENT CENSUS

**Grader:** `accuracy-validator` (independent; did not design, build, or previously grade P1/P2)
**Date:** 2026-08-01 · **Mode:** GRADE + HUNT
**Object under grade (PINNED, verified not to have moved):**

| item | value |
|---|---|
| commit | `c80c8df7f06eba8a925fe678b5320251967189c2` |
| branch | `h1-wave4-sealed12-driver` (tree HEAD was `c974584f` — pin is an ancestor) |
| packet blob | `dd29e1ed5be1db897d1e0272e8c6d482c9b992b1` |
| ledger blob | `eb261f21ad8c4110b7c67db8ff4e29d5e13c04b5` |
| ledger sha256 | `25fbd1cc765c0e4a66d1788b40401bf663bf7e46697d795f8fdb0c69b793ef88` |
| source oracle | `c304b098:ci/fixtures/spec-binding-parity-expanded/ORACLE.json` blob `f57a9d00…` |

`git diff --stat c80c8df7 HEAD` touched only `ADVISOR-RULINGS.md`, `ADVISOR-STATE.md`, `AGENT-REPORTS.md`. **[MEASURED HERE]** Both graded artifacts are byte-identical at the pin and at HEAD. Tree is a linked worktree; `--git-common-dir` = `trading-forge/trading-forge/.git`.

---

## VERDICT

### 🛑 **FAIL — NAMED MEMBERSHIP DEFECT**

**The claim's arithmetic is flawless and its honesty about the `43` is exemplary. The defect is the denominator.** `210` is complete over *the rows the oracle happens to contain*, not over the rows the oracle *declares*. Three independent paths put the true row membership at **`43`, not `30`**, and the true cell membership at **`301`, not `210`**. **`91` cells were never enumerated.**

⚠️★★★★★ **THIS FAIL DOES NOT PUNISH AN HONEST UNKNOWN, AND I MEASURED THAT RATHER THAN ASSERTING IT.** Under the correction the `43` UNDECLARED cells stay **exactly `43`**, all `210` existing cells are **byte-unchanged**, and `0` are lost. The correction is **purely additive**. The `43` are the artifact's best feature and the correction leaves them untouched.

★★★ **The failure mode found is the one the brief named as the target: an object claiming more certainty than its basis supports.** The ledger's own thesis — `A SPARSE OBJECT CANNOT PROVE THAT AN OMITTED TRUTH WAS DELETED` — is reproduced **one level up, unnamed and unremediated**, on the row and fixture dimensions.

---

## WHAT THE CLAIM GOT RIGHT — re-derived, not relayed

Every one of these was recomputed by me from the frozen source, through paths that do not reuse the packet's generator output.

| claim | verdict | how |
|---|---|---|
| `30 × 7 = 210` | ✅ **CONFIRMED** | Path A (own Python) + Path B (`jq`, different parser/language) both yield 30 rows, 210 distinct ids |
| ledger id-set == cartesian product | ✅ **CONFIRMED** | `jq`-derived product from the **oracle** diffed against ledger ids → `IDENTICAL`; sha256 `de761836…` matches the packet's declared `cell_id_set_sha256` |
| exactly one cell per identity | ✅ **CONFIRMED** | 210 cells / 210 distinct ids; zero duplicates |
| exactly one state per cell | ✅ **CONFIRMED** | no cell_id carries >1 classification; zero classifications outside the declared enum |
| `140` / `9` / `61` | ✅ **CONFIRMED** | recomputed both paths; sum = 210 |
| `43` UNDECLARED | ✅ **CONFIRMED** | and the per-axis (`reason_excludes` 22 / `reason_names` 21) and per-fixture breakdowns match packet §4 **exactly** |
| per-axis presence table | ✅ **CONFIRMED** | 22/29/26/4/4/29/26 = 140, reproduced independently in Python **and** `jq` |
| strict-join alternative `46` | ✅ **CONFIRMED** | 43 + 3 alias = 46 |
| the exact three alias cells | ✅ **CONFIRMED** | all three in `40-overrefusal-boundary.spec.json`, all on axis `primitive_null`, conditions `bias_overnight` · `filter_lunch` · `retest_midday`; matches `integrity_census.alias_joined_cells` |
| **zero guessed cells** | ✅ **CONFIRMED** | basis-vs-source audit over all 210: **NO violations.** Every `basis` points at a declaration that genuinely exists; every `declared_reason` matches its source string; every UNDECLARED cell has `declared_reason: null` |
| `140` ASSERTED values faithful to the oracle | ✅ **CONFIRMED (exceeds the claim)** | join key `fixture::condition::axis`; **zero** value mismatches. The packet only claimed to freeze them as observed |
| determinism run1 == run2 | ✅ **CONFIRMED** | both `25fbd1cc…` |
| **regeneration == the pinned blob** | ✅ **CONFIRMED (stronger than claimed)** | the generator, extracted programmatically from the packet, reproduces the pinned artifact **byte-for-byte**. The packet only claimed self-determinism |
| red-proof: clean GREEN, 3 mutants RED | ✅ **CONFIRMED** | reproduced verbatim: `PASS (210, 0)` · `FAIL (211, 3)` ×2 · `FAIL (209, 3)` · `ALL CASES DISCRIMINATE: True` · **exit 0** |
| `9` NOT-APPLICABLE all trace to §4d | ✅ **CONFIRMED** | all 9 cite `section 4d`; none carries an `OPEN`/`DESK-OWNED` token; all 9 in fixture `40` |
| everything grounded in §6 → UNADJUDICATED | ✅ **CONFIRMED** | zero §6-grounded cells classified otherwise |
| authority sha256 resolves | ✅ **CONFIRMED via a 4th path** | `3494d4bb…` identical at `c304b098`, `c80c8df7`, `HEAD`, and the worktree, and equals the oracle's declared value. **AR-540 §5's "not a git object" flag is closed: it is a content sha256, not a fabrication** |

**[MEASURED HERE] I could not break a single published number.** The findings below are all about what the frame excludes, never about a value inside it.

---

## FINDINGS

### 🛑 F-1 — CRITICAL · MEMBERSHIP UNDERCOUNT: `13` DECLARED ROWS / `91` CELLS NEVER ENUMERATED

**Severity:** CRITICAL (membership defect — the denominator of a completeness claim)
**Claim:** *"`P2` enumerates the complete typed truth membership at 210 cells"*
**Reality:** the complete typed truth membership is **`301` cells over `43` rows**. `210` counts only the rows physically present in `ORACLE.json`.

**Sources compared — three non-overlapping paths, all agreeing:**

| path | instrument | row membership |
|---|---|---|
| A | `spec.entry_conditions[]` in the 12 real fixture files @ `c304b098` | **43** |
| B | the oracle's own machine-readable `conditions_unadjudicated_ids` | 13 declared-absent + 30 present = **43** |
| C | the oracle's own prose: *"13 of 15 conditions"* | 13 + 2 = **15** for fixture `00`, → **43** total |
| — | the ledger | **30** |

**The join key is exact.** `conditions_unadjudicated_ids` on `00-control-shipped.spec.json` joins **13 of 13** to the spec's `entry_conditions[].id`, and **0 of 13** to the oracle's `conditions` keys. Only fixture `00` is affected; the other 11 are 1:1.

★★★★★ **THE GENERATOR ALREADY HAS THE BRANCH FOR THIS AND IT IS DEAD.** `basis: "fixture-declared-id"` exists in the generator (packet §8) and appears in **zero** of 210 cells. It is gated on `cid in fixture_ids_gap`, where `cid` is drawn from `conditions` — the very set that excludes all 13. **The author anticipated this exact class; the branch cannot fire because the row set is presence-derived.** Its zero count is not a clean result — it is the fingerprint of the undercount.

★★★ **THIS IS THE PACKET'S OWN DEFECT, ONE DIMENSION OVER.** Packet §2 freezes the **axis** list in the generator precisely so that *"deleting every instance of an axis would delete the axis itself and the matrix would shrink to fit the damage."* That protection was **never applied to the row dimension**. `P1.row_ids` is derived from presence and becomes `P2`'s membership denominator — which is exactly the present-presence→intended-truth conversion §1 promises `P1` does not perform. It does not perform it in its *fields*; it performs it in its *denominator*.

**Fix point:** `gen_p1p2.py` row-set derivation (packet §8, the `for fn in fixture_ids:` loop) — **3 lines**:
```python
_present  = set((fixtures[fn].get("conditions") or {}).keys())
_declared = set(fixtures[fn].get("conditions_unadjudicated_ids") or [])
for cid in sorted(_present | _declared):
```
**Measured result of that correction [MEASURED HERE]:** `301` cells · `ASSERTED 140` (unchanged) · `NOT-APPLICABLE 9` (unchanged) · `UNADJUDICATED 152` · `UNDECLARED 43` (**unchanged**) · `fixture-declared-id 91` (branch comes alive) · **`0` existing cells altered · `0` lost · purely additive.**

**Repro:**
```
git show c304b098:ci/fixtures/spec-binding-parity-expanded/00-control-shipped.spec.json | \
  python -c "import sys,json;print(len(json.load(sys.stdin)['spec']['entry_conditions']))"   # -> 15
git show c304b098:ci/fixtures/spec-binding-parity-expanded/ORACLE.json | \
  python -c "import sys,json;print(len(json.load(sys.stdin)['fixtures']['00-control-shipped.spec.json']['conditions']))"  # -> 2
```
**Blast radius:** `P0-vNext` is chartered as a **thin consumer of P2** (R-520). A consumer that trusts `210` as total membership will compute every coverage ratio against a denominator that is `30%` short on the row axis, and will report **complete coverage of fixture `00` while adjudicating 2 of its 15 conditions**.

---

### ⚠️ F-2 — HIGH · `35` FIXTURE-LEVEL ADJUDICATED TRUTHS ARE OUTSIDE THE "COMPLETE" MEMBERSHIP, AND THE BOUNDARY IS NEVER DECLARED

**Severity:** HIGH (scope over-claim on a completeness artifact)
**Reality:** the oracle carries fixture-level expectations that the **authority document adjudicates in dedicated frozen tables**, and no cell of the 210 covers any of them:

| key | count | authority | note |
|---|---|---|---|
| `compiled` | 11 | **§4c** — a full derived table | contains the campaign finding *"PYTHON WAS RIGHT AND TS WAS WRONG"* and *"A HIGHER `compiled` COUNT IS A FAILURE SIGNAL"* (R-482) |
| `spine_bound` | 11 | **§4b** — a full derived table | |
| `spine_total` | 11 | **§4b** | |
| `reasons_must_differ_from` | 1 | §4a's *"sharpest assertion in this file"* (row 21 vs row 10) | a cross-row relational expectation |
| `scalars_unadjudicated` | 1 | §6 | **a declared gap for exactly this class — proving the oracle's authors treat fixture-level scalars as an adjudication surface** |

**Discriminating fixture [MEASURED HERE], with an inert NOOP control and a working positive control:**

| mutation of the source oracle | ledger truth-membership payload | verdict |
|---|---|---|
| NOOP re-serialisation | identical | **control inert** — harness is not a second cause |
| delete a condition-level `bindable` (§4a) | **changed** (ASSERTED 140→139) | **positive control: the instrument works at this level** |
| delete `compiled=False` from `30-compiled-flip` (§4c) | **IDENTICAL** | 🛑 **INVISIBLE** |
| delete `spine_bound`/`spine_total` (§4b) | **IDENTICAL** | 🛑 **INVISIBLE** |
| **delete ALL 35 fixture-level expectations + declared gaps, every fixture** | **IDENTICAL**, integrity census **clean** | 🛑 **INVISIBLE** |
| halve top-level `required_members` 12→6 | **IDENTICAL** | 🛑 **INVISIBLE** |

★★★★★ **You can delete every fixture-level adjudicated truth in the oracle — including the single `compiled=False` that the authority calls the finding the repair turns on — and this ledger's truth membership does not move by one byte, and its integrity census still prints clean.** That is `A SPARSE OBJECT CANNOT PROVE THAT AN OMITTED TRUTH WAS DELETED`, verbatim, at the fixture level.

⚠️ **Packet §7 lists six honest-partial limits and this is not among them.** A boundary is proven by what it excludes; §7 excludes nothing at this level, so the completeness claim reads as unbounded. **Smallest correction: name the bound in §7** (*"membership is complete over the condition × axis frame; fixture-level scalars §4b/§4c are out of frame"*), or extend the matrix. The first is a caption fix and costs nothing.

⚠️ **[CORROBORATED — a positive finding for the ledger]** `required_members` (12) matches the `fixtures` keys exactly, so the **fixture** dimension *is* independently corroborated inside the oracle. Only the **condition** and **fixture-scalar** dimensions are presence-derived.

---

### ⚠️ F-3 — HIGH · PACKET §6's MECHANISM CLAIM IS FALSIFIED BY MEASUREMENT

**Claim (verbatim, packet §6):** *"The cell-id set IS the cartesian product of `P1`'s **frozen** `row_ids` and the **frozen** axes. **Any** addition, duplication or loss changes the product, the count, or `cell_id_set_sha256`. The verifier re-derives the product **independently**…"*

**Reality:** the verifier computes `expected` from `p1["row_ids"]` and `p2["axes"]` — **both read out of the document under test.** Neither is frozen from the verifier's standpoint. It is independent of `expected_cell_count` only, which is the narrow thing the sentence's second clause says — but the first sentence's *"Any … loss"* is false as written:

| mutation | shipped guard |
|---|---|
| delete a whole **row** from `row_ids` + its 7 cells + fix count + fix digest | 🛑 **GREEN** |
| delete a whole **axis** from `axes` + its 30 cells + fix count + fix digest | 🛑 **GREEN** |

★★★ **The second row is the exact self-authorizing defect packet §2 claims to have prevented.** §2's claim is true **of the generator** (`AXES` is a literal there) and I verify it as true. But the *detection* story in §6 is attributed to the **verifier**, and the verifier reads the axis list from the artifact under test. **The freeze protects regeneration; it does not protect verification.** A mechanism claim gets its own test — this one fails it.

---

### ⚠️ F-4 — MEDIUM · NINE CONTENT-OPERATOR BLIND SPOTS IN THE INTEGRITY GUARD

The verbatim claim promises red-proofed detection of **duplicate / unknown / deleted** cells, and all three genuinely go RED. **So this is a scope boundary, not a falsification of the claim as worded.** It is reported because the PASS outcome authorizes *designing a consumer on top of this ledger*, and a consumer will read `classification` and `basis` — neither of which the guard protects.

Battery run against the **shipped** `check()`, imported not reimplemented. Three NOOP controls GREEN first (harness proven inert), four packet-claimed mutants RED (harness proven capable of red):

| operator | mutation | guard |
|---|---|---|
| delete / duplicate / add-unknown | the three packet-claimed | ✅ RED |
| delete + fix count + fix digest | self-consistent single-cell shrink | ✅ RED |
| **retype** | 43 `UNDECLARED` → `ASSERTED` | 🛑 **GREEN** — *the exact hunted failure: 43 honest unknowns become false certainty* |
| **retype** | 9 `NOT-APPLICABLE` → `ASSERTED` | 🛑 **GREEN** |
| **basis forge** | rewrite UNDECLARED → `row-declared-exact` + a fabricated `declared_reason` | 🛑 **GREEN** |
| **empty-value** | null every one of the 140 ASSERTED values | 🛑 **GREEN** |
| **reason strip** | delete every `declared_reason` (destroys §3's reversibility evidence) | 🛑 **GREEN** |
| **row delete** | F-3 above | 🛑 **GREEN** |
| **axis delete** | F-3 above | 🛑 **GREEN** |
| **alias-collision** | erase the `declared as 'primitive'` disclosure | 🛑 **GREEN** — the 43-vs-46 judgement becomes invisible |
| **duplicate JSON key** | inject a second `"classification"` inside a cell | 🛑 **GREEN** — last-key-wins flipped 1 cell |
| reorder | reverse the cells array | GREEN (benign — `cell_id` is self-identifying) |

⚠️ **`canonical_document_sha256` is computed and published but the verifier never checks it.** I recomputed it from the pinned ledger and it **matches** (`dbb871dd…`) — so the ledger is self-consistent — but nothing in the shipped tooling would notice if it stopped being. Verifying it would close **every** content-mutation row above in one line, since it digests the whole document.
⚠️ **The duplicate-key census is applied to the *oracle* but never to the *ledger itself*.** Packet §4/P-F3 correctly notes `json.load` silently keeps the last of duplicate keys; the verifier then parses the ledger with a bare `json.loads`. **[MEASURED HERE] the pinned ledger has no duplicate keys** (checked with an `object_pairs_hook`) — but that is a fact about today's file, not a property the tooling enforces.

---

### ℹ️ F-5 — LOW · A SECOND UNRESOLVED JOIN, UNCENSUSED AND UNDISCLOSED

`conditions_unadjudicated_ids` joins **0 of 13** to the oracle's condition keys. This is structurally identical to the `primitive` → `primitive_null` mismatch the packet **did** find, measure and disclose as P-F2 — but the `unresolved_declared_gap_keys` census only walks **row-level** `unadjudicated` keys, so this fixture-level join failure is invisible to it. Extending that census to fixture-level declaration keys would have surfaced F-1 automatically.

### ℹ️ F-6 — LOW · MIXED PIN: the generator reads the oracle from `git show` but the authority from the **live worktree**

`authority_bytes = io.open(REPO + "\\" + AUTHORITY_PATH…)` is an unpinned filesystem read inside an otherwise commit-pinned generator. **[MEASURED HERE] it currently resolves identically at `c304b098`, `c80c8df7`, `HEAD` and the worktree**, so no live defect — a reproducibility fragility only. A dirty worktree would silently move `authority_sha256_measured`.

### ✅ NOTED, NOT COUNTED
- `authority_citation: null` on the 9 NOT-APPLICABLE cells — **known, disclosed, deliberately deferred to keep the pin still. Excluded from the verdict as instructed.** (Precisely: the key is *absent* on non-ASSERTED cells, not present-and-null.)
- `na = ("section 4d" in reason or "section 4d's" in reason)` — the second disjunct is dead code; `"section 4d's"` contains `"section 4d"`. Harmless.

---

## GRADING TABLE

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| P1 observed baseline | **8** | **VERIFIED** | every published figure re-derived through 2+ non-overlapping paths; authority hash confirmed at 3 commits + worktree; regeneration byte-identical to the pinned blob | reads authority from the unpinned worktree (F-6); its `row_ids` become P2's denominator (F-1) |
| P2 truth membership — **cell content** | **8** | **VERIFIED** | zero guessed cells; basis-vs-source audit clean across all 210; every ASSERTED value matches the oracle on an exact join key; both alias counts published | none found — I could not break a single cell |
| P2 truth membership — **the membership set** | **3** | **VERIFIED** | 13 declared rows / 91 cells absent (3 paths); 35 fixture-level adjudicated truths deletable with zero ledger movement and a clean census | **F-1, F-2** |
| Integrity verifier / red-proofs | **5** | **VERIFIED** | the 3 claimed operators genuinely discriminate, with a real clean control | 9 content operators unreachable; §6 mechanism claim falsified (**F-3, F-4**) |
| **Packet as an authority for `P0-vNext`** | **4** | **VERIFIED** | — | **not yet sound as a completeness denominator** |

**CLAIMED band was not stated numerically by the doer** — the packet explicitly says *"I do not grade my own work"* (§7), which is correct conduct and is credited.

---

## THE SMALLEST ARTIFACT-LEVEL CORRECTION

No code implementation begins. Three edits, all to the two pinned artifacts:

1. **Row set = `present ∪ conditions_unadjudicated_ids`** — 3 lines in the §8 generator listing, then regenerate. Yields 301 cells; **purely additive; the 43 stay 43; no existing cell moves.** (F-1)
2. **Declare the frame in §7** — *"membership is complete over the condition × axis frame; fixture-level expectations (`compiled` §4c, `spine_bound`/`spine_total` §4b, `reasons_must_differ_from`, `scalars_unadjudicated`) are OUT of frame and unenumerated."* (F-2)
3. **Correct §6's mechanism sentence** — the verifier re-derives from `row_ids`/`axes` **as published in the ledger**, so it detects cell-level add/dup/delete but **not** a self-consistent row or axis deletion. Optionally verify `canonical_document_sha256`, which closes F-4 wholesale. (F-3, F-4)

Items 2 and 3 are caption corrections and move no data.

---

## MANDATORY CLOSING COVERAGE

### 1 — What I verified, and via which non-overlapping paths
| claim | path 1 | path 2 | path 3 |
|---|---|---|---|
| 30 rows / 210 cells | own Python parse of the oracle | `jq` (different parser + language) | ledger's own id list, diffed |
| cell-id set correctness | `jq`-derived cartesian product **from the oracle** | sha256 `de761836…` matched against the ledger's published digest | Python set-diff both directions |
| 140/9/61 · 43 · 46 · 3 alias | own Python recount | `jq` recount | packet tables compared field-by-field |
| 140 present expectations | Python per-axis count from the oracle | `jq` per-axis count | ledger ASSERTED set == my presence set (exact) |
| determinism | ran the extracted generator twice → identical | byte-compared against the **pinned git blob** | worktree file sha256 == blob sha256 |
| authority hash | `git show` at `c304b098` | at `c80c8df7` and `HEAD` | worktree `sha256sum`, all == the oracle's declared value |
| **row membership (F-1)** | `spec.entry_conditions[]` in 12 real fixture files | oracle's `conditions_unadjudicated_ids` (13/13 join to spec ids) | oracle's prose *"13 of 15 conditions"* |
| **fixture-level exclusion (F-2)** | key-census of the oracle | grep of packet+ledger with a validated positive control | delete-and-regenerate experiment |

The packet's generator and verifier were **extracted programmatically from the packet text** (regex over the fenced blocks), never hand-transcribed — a hand-copied expected value is a fabricated safety claim.

### 2 — Positive-control witnesses for every absence claim
| absence claim | positive control |
|---|---|
| "`spine_bound`/`spine_total`/`scalars_unadjudicated`/`required_members`/`reasons_must_differ_from` appear nowhere in packet or ledger" | same grep found `primitive_null` (7/65) and `UNADJUDICATED` (12/63); `grep -c` exit-code trap verified (exit 1 on zero, no `&&` chains used) |
| "the 46 `compiled` hits are filename-only" | `grep -o` enumerated every hit → all `30-compiled-flip.spec.json` |
| "deleting fixture-level truths is invisible" | **NOOP control identical** (harness inert) **+ condition-level `bindable` deletion CHANGED the ledger** (instrument demonstrably works at the level it covers) |
| "the guard is blind to 9 operator classes" | 3 NOOP controls GREEN + 4 mutants RED in the same run — the guard has a proven path to red |
| "the pinned ledger has no duplicate JSON keys" | `object_pairs_hook` census; the same hook **did** catch my injected duplicate in M13 |
| "`fixture-declared-id` yields 0 cells" | the corrected generator makes the same branch yield exactly 91 |
| "no cell claims a declaration that does not exist" | basis-vs-source audit; my M7 mutant (forged declarations) was constructed and confirmed detectable by that same audit |

### 3 — Join keys for every "identical / unchanged / matches" claim
- artifacts unmoved: **blob sha1** `dd29e1ed…` / `eb261f21…` at `c80c8df7` vs `HEAD`.
- regeneration identical: **file sha256** `25fbd1cc…` across run1, run2, the git blob, and the worktree file.
- ASSERTED value fidelity: **`fixture::condition_id::axis`**, and `cell_id` re-checked to equal the concatenation of its own three fields (a caption-vs-line check — they agree on all 210).
- row membership: **fixture filename** + **`entry_conditions[].id`**.
- alias cells: **`cell_id`**, compared against `integrity_census.alias_joined_cells`.
- delete-experiment comparisons excluded `oracle_bytes`/`oracle_blob_sha1` — see the harness-bug note below.

### 4 — What I did NOT verify, and why
- **Whether the 140 ASSERTED values are CORRECT against the authority document.** I verified they faithfully match the **oracle**; the oracle-vs-authority rung is the packet's own declared rung-3 limit (§3) and I did not re-derive it. A correctly-cited but mis-transcribed value would survive both the freeze and this census.
- **Whether the frozen 7-axis list is the RIGHT 7.** I confirmed it is *complete over observed data* (`unknown_row_keys` is genuinely empty — no oracle row key falls outside the 7 plus `authority`/`unadjudicated`). I did **not** establish an authority citation for the number 7 itself; authority §4a's tuple table is the apparent source but the packet cites none. **UNDETERMINED** — flagged because the axis list is the other half of the denominator F-1 indicts.
- **The 17 invalidation rows** in `50-family-axis-invalidations` and the 1 in `00-control-shipped`. The oracle declares them out of scope and structurally unaddressable (*"`checkOracle()` can only index `plan.bindings`"*). I accepted that as a **declared, reasoned** boundary — unlike F-1's 13, which are `entry_conditions` and are addressable. They are excluded from my 43.
- **Downstream consumers.** `P0-vNext` does not exist yet; blast radius for F-1 is reasoned from R-520's charter, marked **[HYPOTHESIS]** where it concerns future code.
- **`ORACLE.json` does not exist at `HEAD`** and `c304b098` is **not an ancestor of `HEAD`** — the source data lives off-branch and is reachable only by explicit hash. Not a defect in the ledger (the ledger pins the full commit sha), but it means the source of truth is not on the branch that carries the artifact. I did not chase where `c304b098` lives.
- I did **not** run `tsc` or any test suite: no TypeScript is in scope; the deliverable is two documents and contains no repo code.

### 5 — Harness fault found in my own instrument, and corrected
My first delete-experiment reported all four deletions as "ledger CHANGED". **That was my harness's bug, not a result:** `oracle_bytes = len(input)` is embedded in the ledger, so *any* re-serialisation of the oracle moves the ledger's sha256 and confounds every comparison. The NOOP control caught it by failing. I rebuilt the comparison over the truth-membership payload with input-provenance fields excluded, re-established an **inert** NOOP control, and only then read the results reported in F-2. **The v1 numbers are withdrawn.** A JSON-rewriting mutation harness is a second cause of every red until a NOOP pass proves otherwise.

### 6 — Independence declaration
I did not design, implement, or previously grade `P1`/`P2`, and I hold no lineage in `gen_p1p2.py` or the verifier. I did **not** reproduce the packet's generator row-for-row as my primary instrument — Paths A and B are my own, and the extracted generator was used **only** for the determinism and delete-injection experiments, where the shipped instrument is the object under test rather than the measuring device. Prior grades in this lineage (`GRADE-P0-REDESIGN-PACKET-2026-07-31.md`, `…-REGRADE-…`) are mine; **F-1 is a defect class neither of them raised**, and every band here was re-derived from the pinned artifacts alone, ignoring those scores. No repo file was modified and no git index or checkout operation was performed on the shared tree; all reads were `git show` / `cat-file`, and every experiment wrote to the scratchpad.

---

**Bottom line.** ★★★ **The `43` are right, the honesty is right, and the cell-level work is the best this lane has produced — I attacked all 210 cells and could not move one.** But `210` is not the complete membership: **`91` cells are missing behind a machine-readable declaration the generator already has a branch for, and `35` authority-adjudicated fixture-level truths can be deleted without this ledger noticing.** The correction is additive, costs the `43` nothing, and is three lines plus two captions.
