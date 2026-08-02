# GRADE — P0-vNext admission prototype, R-578 §6 batch 3/3

**Grader:** accuracy-validator (independent; did not design, build, or previously grade this specific batch).
**Object:** `prototypes/p0-vnext-admission/` at **`0a557e37`**, tree `C:/Users/tonio/Projects/wt-h1-wave4-20260712` (branch `h1-wave4-sealed12-driver`).
**Date:** 2026-08-02.
**Status:** NOT COMMITTED by the grader — the desk commits this receipt.

---

## VERDICT

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| P0-vNext admission prototype @ `0a557e37` | **5 / 10** | **VERIFIED** | 6/6 scripts executed at shipped state; 4 mutation experiments; 2 non-overlapping paths per claim (below) | F-1 CRITICAL (C1 refuted), F-2 CRITICAL (composition), F-3, F-4 |

**Band basis.** Not 3–4: four of five claims are CONFIRMED, one (C5) is *stronger* than the doer claimed, and C2/C3/C5 are individually band-7-quality work with real paths to red. Not 6–7: the batch's **headline deliverable — C1 row identity — is refuted by a single-expression edit inside the very function the fix was written into**, and that defect composes with one further edit to resurrect the R-558 founding defect with both gates green. A delivery whose central new property does not hold cannot be certified above happy-path.

**Reconciliation with the prior band.** My memory index records the previous batch graded **6** with *the same claim C1 refuted* (18 paths retired). This batch's C1 fix moved from a *count* to an *identity*, and is refuted again (11 paths retired, **byte-identical output**). Two consecutive remedies of the same claim, each defeated, is a remedy that keeps going **one layer up rather than changing kind**. I therefore decline to hold 6 and grade 5. No band above 5 is defensible while F-1 stands.

**Pin integrity.** `git diff --stat 0a557e37 HEAD -- prototypes/` printed **nothing** — the object is byte-identical at `148faec6`. Verified myself, not taken on the brief's word. [MEASURED HERE]

---

## PER-CLAIM

| Claim | Verdict |
|---|---|
| **C1** row identity asserted as membership both directions; substitution/duplication/retirement each convicted | **REFUTED** |
| **C2** FREEZE_EXPECT witnesses discriminate; 2x2 diagonal; both old witnesses were constants | **CONFIRMED** (independently) |
| **C3** `DECLARED_TABLE_TOTAL = 13`, per-file literals, cross-checked both directions | **CONFIRMED** (with demonstrated path to red) |
| **C4** all six scripts exit 0 at the shipped state | **CONFIRMED**; the NO-OP question **ANSWERED** (see F-3) |
| **C5** global pin bump adopted no enforcement table | **CONFIRMED — and stronger than claimed** |

---

## NOOP CONTROL (run first, before believing any mutation result)

```
$ cd C:/Users/tonio/Projects/wt-h1-wave4-20260712/prototypes/p0-vnext-admission
$ for s in run red-proof emitted-freeze type-value-proof module-collections module-tuple; do node $s.mjs; echo EXIT=$?; done
```
All six **EXIT=0**. `red-proof.mjs` → `CONTROL GREEN: true | CLASSES WITH A DEMONSTRATED RED PATH: 41 / 41`. `module-collections.mjs` → `6 files | 13 pinned tables (DECLARED) | 0 finding(s)`. [MEASURED HERE] C4's exit-code claim is CONFIRMED.

---

### Discrepancy F-1: C1 REFUTED — the identity check's witness key is manufactured from the declaration it is checking against

**Severity:** CRITICAL (false positive — full green denominator over retired red paths)

**Claim:** *"Row identity is asserted as MEMBERSHIP in both directions… Substitution (18 keys 0x, 1 key 19x), duplication (1 key 2x) and retirement (1 key 0x) each have their own convicting path, and none can pass."*

**Reality:** A **one-expression edit** retires **11 of 19** `EXPECT` red paths while `red-proof.mjs` prints `41 / 41`, `VERDICT: the runner is an ENFORCING GATE — control green, every declared class ran exactly once and red-proofed.`, **EXIT 0** — and the stdout is **byte-identical to the clean control**.

**Repro:**
```
# red-proof.mjs:151 — substitute the WORK, preserve the LABEL
-  const r = runWith(inject);
+  const r = runWith(EXPECT.find(([, c]) => c === cls)[0]);
$ node red-proof.mjs ; echo EXIT=$?          # -> 41 / 41, ENFORCING GATE, EXIT=0
$ diff noop_red-proof.txt C1_classgroup.txt   # -> no output. BYTE-IDENTICAL.
```
[MEASURED HERE — 2m15s run, diff exit 0]

**Retired (11):** `own_unrelated_nonowned`(c), `own_extra_code`(d), `own_extra_inside_anchor`(h, R-557's reproducer), `membership_delete_guard`(i, **R-558's reproducer — the guard for the campaign's F-1 CRITICAL**), `membership_add`(e), `membership_delete`(f), `membership_duplicate`(g), `green_add`(k), `green_duplicate`(l), `substituted_diagnostic`(s, **the prior batch's F-3 fix**), `module_collection_add`(r, **this batch's own instance-ten fix**).

**Source of truth:** the executable line. `rows.push({ cls: \`${inject}->${cls}\` })` at `red-proof.mjs:154` records **the label it manufactured from `EXPECT`**, never which injection the subprocess actually ran.

**Root cause — the species, named:** R-561 convicted *"both operands computed from the same mutable array."* The campaign's remedy was to add a DECLARATION. This defect is that remedy's mirror image:

> **BOTH OPERANDS COMPUTED FROM THE SAME DECLARATION.**

`declaredCount` is built from `EXPECT`; `witnessedCount` is built from `rows`; and every `rows` key is itself built from `EXPECT`. Membership-in-both-directions is therefore **true by construction** for any mutation that preserves the *iteration* and changes the *work*. The check discriminates mutations of the **loop head** (`.slice`, `.map`, `.filter` — the two shapes previously found) and is structurally blind to mutations of the **loop body**. The doer's enumeration is closed under the ITERATION operator and open under the WORK operator.

**Fix point (single line, and the evidence already exists):** `run.mjs:693` already prints `INJECTION: <name>` — the **observed** witness of which injection actually executed. `grep -n "INJECTION" red-proof.mjs` returns **zero matches**: red-proof never reads it. [MEASURED HERE] The join key is printed and discarded. Assert it:
```js
const ranOurs = new RegExp(`^INJECTION: ${inject.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`, 'm').test(r.stdout);
const ok = r.code !== 0 && namedOurClass && ranOurs && /GATE: FAIL/.test(r.stdout);
```
The same join is owed by the `CLASSES` and `SHARED` loops.

**Blast radius:** every certification that cites `red-proof.mjs`'s `N / N` as coverage evidence — AR-620, R-580, and the "41/41" figure in any downstream ruling.

---

### Discrepancy F-2: the two-edit path the doer named is real, and it is CHEAPER than the doer's own estimate

**Severity:** CRITICAL (silent removal of enforcement with both gates green)

**Claim:** the doer named `DECLARED_ROW_KEYS` as its residual, defended by `derivationsAgree`, "so defeating it requires TWO coordinated edits."

**Reality:** I could not defeat `DECLARED_ROW_KEYS` in two edits — that path needs **three** (shrink `DECLARED_ROW_KEYS`, set `STANDALONE_ROWS = 1`, and delete the matching `rows.push`), so the doer's named residual is *harder* than claimed. **But a two-edit path exists elsewhere and it does not touch `DECLARED_ROW_KEYS` at all.**

**Repro:**
```
# edit 1: red-proof.mjs:151        (as F-1)
-  const r = runWith(inject);
+  const r = runWith(EXPECT.find(([, c]) => c === cls)[0]);
# edit 2: run.mjs:636 — delete 3 of 4 membership enforcement properties, row key untouched
-  ['membership', membership.missing.length > 0 || membership.missing_expanded.length > 0
-    || membership.undeclared.length > 0 || membership.duplicated.length > 0,
+  ['membership', membership.undeclared.length > 0,
$ PROTO_INJECT=membership_delete_guard node run.mjs   # -> GATE: PASS, EXIT 0
$ node red-proof.mjs ; echo EXIT=$?                   # -> 41 / 41, ENFORCING GATE, EXIT=0
```
[MEASURED HERE]

**What is actually lost:** `membership_delete_guard` — deleting corpus guard row `56(a)`, the guard that exists for the accuracy-validator's F-1 `export * from` CRITICAL — goes from **EXIT 1 to GATE: PASS EXIT 0**. That is the **R-558 founding defect resurrected verbatim**. (`missing` and `duplicated` are coincidentally still caught by `partition_sum` / `partition_overlap`; `missing_expanded` has no such backstop.)

**The caption is false, measured:** the composed run prints
`PASS membership_delete_guard exit=1 names 'membership'=true`
for an injection that, measured directly, yields `GATE: PASS` and exit 0. The row describes a run that never happened.

**Trace left behind:** `diff` of the 41-row output against the clean control shows **one cosmetic line** — an unrelated row's co-fired name list (`named=[partition_overlap,membership]` → `named=[partition_overlap]`). No assertion reads it; the verdict, the denominator and the exit code are identical.

**Why `module-collections.mjs` does not catch edit 2:** `FAILURE_CLASSES` is pinned **by row key only** (`extractModuleCollections` takes `elements[0]`, the class name). The **predicate — the thing that decides pass/fail — is unpinned** and is defended solely by `red-proof.mjs`. F-1 removes that defence for 11 of 19 rows. This is `governed_surface_is_one_column_not_the_row`.

---

### Discrepancy F-3: C4's NO-OP — R-575 fixed the instance, not the class; `module-tuple.mjs` is a latent zero-byte no-op

**Severity:** HIGH (a gate that can silently stop being a gate)

**Reality:** R-575's no-op was **`module-collections.mjs`** — it "printed ZERO BYTES and exited 0", and F-4 fixed it at `2a69454c` with a robust main-entry guard. That fix was **not swept across the class**. `module-tuple.mjs:117` still carries the fragile form:

```js
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {   // module-tuple.mjs:117
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);  // module-collections.mjs:368
```

**Discriminating pair [MEASURED HERE]** — identical probe file, run from two paths:

| probe location | FRAGILE guard fires | ROBUST guard fires |
|---|---|---|
| `…/scratchpad/a b/probe.mjs` (space) | **false** | true |
| `…/scratchpad/probe_nospace.mjs` | true | true |

`import.meta.url` percent-encodes (`a%20b`); `argv[1].replace(/\\/g,'/')` does not. Any repo path containing a space — `Program Files`, `My Projects`, most OneDrive-synced trees — makes `node module-tuple.mjs` print zero bytes and exit 0. It is a gate today **only because this tree's path happens to have no space.** The other four scripts have no main-entry guard at all and always execute their bodies, so they cannot fail this way.

**Fix point:** `module-tuple.mjs:117` — adopt `module-collections.mjs:368` verbatim.

---

### Discrepancy F-4: nothing joins the 24 ENFORCED classes to the red-proofed set (0 live gaps — reported as structural)

**Severity:** MEDIUM (latent; no false green today)

**Honest null first:** `run.mjs` `FAILURE_CLASSES` declares **24** enforced classes; `red-proof.mjs` asserts **25** distinct class names. **Enforced classes with no declared red path: 0.** [MEASURED HERE] The 25th (`module_collections`) is the deliberate pre-gate at `run.mjs:51`. Coverage is complete today.

**But it is unasserted.** `red-proof.mjs` contains **zero non-comment references to `FAILURE_CLASSES`**. [MEASURED HERE] Its denominator counts *its own declared rows*; nobody counts *the gate's enforced classes*. Adding a 25th `FAILURE_CLASSES` row is caught once by the pin as `UNDECLARED` — and a pin bump is a routine, sanctioned act, after which the new class ships with no red path and `red-proof` still prints `41 / 41 ENFORCING GATE`. The completeness is maintenance discipline, not an enforced property.

**Fix point:** import `FAILURE_CLASSES`' key set (or parse it, as `module-collections.mjs` already does) and assert every key appears in red-proof's covered set.

---

## CONFIRMED CLAIMS — evidence

### C2 CONFIRMED — and the doer's self-correction against its own interest is upheld

Independent 2x2, measured by running `emitted-freeze.mjs` myself under each injection and grepping — **not** by reading red-proof's own printout:

| run | old `'35(a)'` lines | old `'38'` lines | new `…35(a): ABSENT` | new `…38: ABSENT` |
|---|---|---|---|---|
| clean control | **1** | **12** | 0 | 0 |
| `membership_rename` | 1 | 15 | **1** | 0 |
| `membership_delete` | 1 | 15 | 0 | **1** |

[MEASURED HERE] `'38'` also occurs **16 times** by occurrence-count (`grep -o`) in the clean control; 12 is the *line* count — both figures stated so the join key is unambiguous.

Both old witnesses appear in the **clean control**, so under `stdout.includes(mustName)` all four off-diagonal cells were green and neither witness could certify anything. **The doer's correction of the prior grade, made in its own disfavour, is CONFIRMED.** The new witnesses are exactly diagonal.

### C3 CONFIRMED — with a demonstrated path to red

`DECLARED_TABLE_TOTAL = 13`; `COVERED_FILES` sums to 4+4+1+2+1+1 = 13; three module-load throws enforce it in both directions (`module-collections.mjs:160,169,180`). Replanting the **exact instance-ten defect** (drop 3 of run.mjs's 4 tables):
```
Error: INSTRUMENT FAULT: run.mjs is declared to cover 4 enforcement table(s) but
PINNED_MODULE_COLLECTIONS lists 1 (FAILURE_CLASSES) — a table was added or silently dropped
$ node module-collections.mjs > /dev/null 2>&1 ; echo $?   # -> 1
```
[MEASURED HERE] Pre-fix this printed a smaller number under `PASS`. The guard has a real path to red.

### C5 CONFIRMED — stronger than the doer claimed

The doer verified only `membership.mjs`. I checked **all six pinned files** across `cac39d45 → 1a1abb46`:

| file | blob across bump | checked surface |
|---|---|---|
| `run.mjs` | `e0ff1b9c` → `e0ff1b9c` **IDENTICAL** | bump is a no-op |
| `type-value-proof.mjs` | `468ac763` → `468ac763` **IDENTICAL** | bump is a no-op |
| `source-admission.mjs` | `a36d2c50` → `a36d2c50` **IDENTICAL** | bump is a no-op |
| `runtime-admission.mjs` | `6e7a3f51` → `6e7a3f51` **IDENTICAL** | bump is a no-op |
| `membership.mjs` | `0e7540c3` → `10ccce6e` re-baselined | `HISTORICAL_RENAMES` keys `["54"]` → `["54"]`; collection set `{BASELINE_META, EXPANDED_META, HISTORICAL_RENAMES}` identical |
| `red-proof.mjs` | `78d76b0b` → `f0a6d2e6` re-baselined | `CLASSES` 16→16, `SHARED` 2→2, `EXPECT` 19→19, `FREEZE_EXPECT` 2→2 — **all four key sets IDENTICAL**; gained `DECLARED_ROW_KEYS` (declared at `module-collections.mjs:55-59`) |

[MEASURED HERE] Four of six files could not have adopted anything — the bump does not move their bytes. The two that moved have identical enforced key sets. **No enforcement table was silently adopted.** `PINNED_BLOBS` independently re-derived via `git rev-parse 1a1abb46:…` — all six match the literals in the file.

---

## AUDIT OF THE DESK'S OWN FIGURES (R-578 / R-580)

The brief asked me to check figures whose join key was never verified. Re-derived from artifacts:

| figure | verdict |
|---|---|
| R-578 §2 "12 pinned tables while dropping 3 of 4 tables" | **The desk's own correction is CORRECT.** Pinned total is 13 pre- and post-fix; 13−3 = 10. The `12` joins to a **one-table** deletion. Mis-joined illustration, real defect. |
| "13 pinned tables" | CONFIRMED — declared literal and per-file sum agree; both re-derived. |
| "6 files" | CONFIRMED. |
| "18 keys 0x, 1 key 19x" (substitution shape) | CONFIRMED — `EXPECT` has exactly 19 rows. |
| "41 / 41" | The arithmetic is right (16+2+19+2+2). **What the number means is wrong** — see F-1. |
| C1 "none of the three can pass" | **True of the three named shapes; false as a sufficiency claim.** The operator axis is unenumerated. |

No other mis-joined figure found in the material I read. This is an honest null, not an absence of looking.

---

## MANDATORY CLOSING COVERAGE

### 1. What I verified, and via which two non-overlapping paths

| claim | path A | path B |
|---|---|---|
| object unchanged at HEAD | `git diff --stat 0a557e37 HEAD -- prototypes/` (empty) | sha256 of live files == sha256 of `git show 0a557e37:…` extraction, all 10 |
| C1 refuted | executed mutation → `41/41` EXIT 0 | `diff` of full stdout vs clean control → byte-identical; plus reading the executable line `red-proof.mjs:154` |
| F-2 composition | `PROTO_INJECT=membership_delete_guard node run.mjs` → GATE: PASS (direct) | full `red-proof.mjs` run under both edits → `41/41` EXIT 0 (composed) |
| C2 | my own `emitted-freeze.mjs` runs + `grep` counts | red-proof's own `absent-from-control/present-under-own/leaked-to` printout (graded instrument) |
| C3 | reading the three throw sites | executing the replanted instance-ten defect → exit 1 |
| C5 | `git rev-parse` blob comparison across both pins | AST re-extraction of every collection/key set at both revisions via `extractModuleCollections` |
| C4 exit codes | direct execution of all six | — (single path; see §4) |
| F-3 | reading both guard forms side by side | executing the discriminating probe pair (spaced vs unspaced path) |

### 2. Positive-control witnesses for every absence claim

- **"no output difference" (F-1):** the same `diff` harness DID report a difference for the F-2 composition run — so a zero-diff is a measured absence, not a dead comparator.
- **"the fragile guard fails" (F-3):** the unspaced-path run returned `true` for the same expression — the probe can observe presence.
- **"red-proof never reads `INJECTION`" (F-4/F-1 fix point):** the same `grep -n "INJECTION"` returned two hits in `run.mjs` — the pattern and the tool work.
- **"0 enforced classes without a red path" (F-4):** the same comparator reported one asymmetry in the other direction (`module_collections` proven-but-not-enforced), so it is not returning an empty set by construction.
- **NOOP control:** run **before** every mutation result was believed, and re-run green after full restore.
- **exit-code instrument:** I initially misread a piped `$?` as node's exit code and re-measured with `node … > /dev/null 2>&1; echo $?` → 1. The corrected figure is the one reported.

### 3. Join keys checked for every "identical / unchanged / matches" claim

- object vs HEAD: **git blob + sha256 per file** (10 files).
- pin bump: **blob sha per file** (6), then **collection-name set** and **per-table key arrays** per file.
- `HISTORICAL_RENAMES`: literal key `["54"]` at both revisions — matches the doer's stated key exactly.
- restore: **sha256 of all 8 touched files** against the pre-mutation baseline + `git status --porcelain prototypes/` empty.
- freeze witnesses: the **exact sentence** `*** STOP CONDITION (item 16): <id>: ABSENT`, not the bare id.

### 4. WHAT I DID NOT VERIFY

- **C4's "six gates are green" — deliberately not certified.** I verified six scripts **exit 0**; I did **not** independently red-proof `type-value-proof.mjs`, `emitted-freeze.mjs` or `module-tuple.mjs` from scratch. Their red paths are `[MEASURED BY GRADED INSTRUMENT]` (red-proof's rows), and red-proof is the instrument F-1 just refuted — so for the 11 retired classes that evidence is **now weaker than the desk believes**. Re-establishing it is owed after F-1 is fixed.
- **`corpus.mjs`'s 68 rows, `membership.mjs`'s expected-set derivation, and `source-admission.mjs`/`runtime-admission.mjs` CATCHERS** were not audited for content correctness — only for pin integrity across the bump. `corpus.mjs` sits outside the set-of-sets and is covered by a separate mechanism I did not re-derive.
- **`emitted-freeze.mjs` and `module-tuple.mjs` have no module-level collections the AST reader can see**, so they are outside the set-of-sets entirely. `EXPECTED_SOURCE_COUNT` derives from the **pinned** baseline via `membership.mjs` (sound, read not executed) — I did not mutation-test that denominator. [ARTIFACT-SOURCED]
- **The three-edit `DECLARED_ROW_KEYS` path** was reasoned from the code, **not executed**. My "it needs three edits, not two" is `[HYPOTHESIS-UNPROVEN]`; the two-edit path I *did* execute (F-2) bypasses it entirely, so I did not spend a run confirming it.
- **`run.mjs`'s 5 unpinned module-level object literals** (`negControl`, `summary`, `liveCollections`, `duplicated`, `likeForLike`) are runtime values, not enforcement tables — judged by reading, not by mutation.
- **Wall-clock/environment:** every measurement is from this tree on this machine, Node v24.13.0. `red-proof.mjs` takes ~2m15s per run; I ran it 2 times mutated + 1 clean. I did **not** re-run the full six-script suite after the final restore — I re-ran `module-collections.mjs` only (green) and verified byte-identity by sha256 + `git status`.

### 5. Tree hygiene

Four mutations were planted and reverted (`red-proof.mjs` ×1, `run.mjs` ×1, `module-collections.mjs` ×1, plus the composed pair). **No `git checkout`, `reset`, `stash`, `commit` or amend was used at any point.** Final state: all 8 touched files sha256-identical to the pre-grade baseline; `git status --porcelain prototypes/` empty. Scratch artifacts live outside the repo.

---

## WHAT THE DESK SHOULD DO

1. **F-1 first, and it is one line per loop:** join each red-proof row to `run.mjs`'s own `INJECTION:` echo. The witness must be **observed from the run**, never manufactured from the table.
2. **F-2 follows from F-1** — no separate fix, but re-run the suite and confirm `membership_delete_guard` reds again.
3. **F-3:** sweep the main-entry-guard class; `module-tuple.mjs:117` is the one survivor.
4. **F-4:** assert red-proof's covered class set against `FAILURE_CLASSES`' key set.
5. **Do not re-cite `41 / 41` as coverage evidence** in any ruling until F-1 lands.
