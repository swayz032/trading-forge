# INDEPENDENT GRADE — P0-vNEXT ADMISSION, BATCH 2 (AR-615 / R-576)

**Grader:** accuracy-validator (HUNT mode). **Date:** 2026-08-02.
**Object graded:** `prototypes/p0-vnext-admission/` at tree object `9d6ab970517f0403ad0895ff009aef6ac8e834a4`.
**Scoping — BLOB-WISE, not commit-wise, as the brief required.** `cb9cfd76:prototypes/p0-vnext-admission`
and `2a69454c:prototypes/p0-vnext-admission` both resolve to tree `9d6ab970` [MEASURED HERE,
`git rev-parse`]. A docs commit landing underneath this grade does not invalidate it.
**Worktree = commit:** `git diff HEAD` over the prototype was EMPTY and all 11 `git hash-object`
values equalled `git ls-tree` at HEAD [MEASURED HERE], re-verified byte-for-byte at the end.

**Independence:** I did not design, build, or previously grade this batch. I DID grade the prior
p0-vnext waves (2026-08-02 batch grade @`b16997a0`, FINAL grade @`8a40f899`, partition hunt
@`9be6a52a`). **Lineage declared:** the F-1 defect this batch repairs (INSTANCE NINE) was found by
that earlier grade, so I am grading a repair to a defect I reported. I therefore re-derived every
band from current artifacts only and ignored my own prior findings except as fixtures to re-test.

---

## VERDICT

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| p0-vnext admission, batch 2 | **6 / 10** | **VERIFIED** | 6 gates run clean; 9 claims re-derived; 5 mutation rigs, all with controls green in the same run | F-1 and F-2 below are CRITICAL and live at `9d6ab970` |

**8 of 9 claims CONFIRMED. C1 — the claim I was told to attack hardest — is REFUTED in its
sufficiency by execution.** Plus one novel CRITICAL: **INSTANCE TEN**, on the very file shipped
this batch to close that class.

Band 6 rather than 7: the mechanisms are real and genuinely red-proofed (C2/C3/C4 each reproduced
with controls green BEFORE and AFTER), but the headline deliverable — the instrument that counts
red paths — still admits a measured mutation that retires 18 of 19 red paths while printing the
full declared denominator and certifying itself an ENFORCING GATE. That is not a residual risk;
it is an open hole in the thing being certified.

---

## CLAIM-BY-CLAIM

| Claim | Verdict | Grade of evidence |
|---|---|---|
| C1 denominator from DECLARED tables; 3 loop-head mutations go RED | **PARTLY REFUTED** — positive half TRUE, sufficiency FALSE | MEASURED HERE |
| C2 F-2 closed; `membership` FAILURE_CLASSES row delete goes RED | CONFIRMED | MEASURED HERE |
| C3 `module-collections.mjs` real main entry, `6 files \| 13 pinned tables \| 0 findings \| PASS` | CONFIRMED (exact string match) | MEASURED HERE |
| C4 `SCRIPT_KIND_BY_EXT` pinned; .cts/.tsx/.cjs deletions RED, controls green both sides | CONFIRMED | MEASURED HERE |
| C5 six gates EXIT 0; pin `27751213`→`5edfc4b2`, blob `d269b5cb`→`cdb031df`, 65→68, GREEN 9 | CONFIRMED (two paths) | MEASURED HERE |
| C6 `44/52` and attribution UNTOUCHED (attributed 44, caught_by_typechecker 5) | CONFIRMED (two paths) | MEASURED HERE |
| C7 nine `constructor` spellings ADMITTED, only bare `Function` REJECTS | CONFIRMED | MEASURED HERE |
| C8 all `.constructor` accesses type EXACTLY `Function`, no false positives | CONFIRMED, stronger than claimed | MEASURED HERE |
| C9 **THE DECIDING CLAIM** — `as any` erased at runtime yet moves the checker type | **CONFIRMED on three paths** | MEASURED HERE |

### C9 — the desk was RIGHT. Answering the question asked "tonight".

The desk refused a `type === Function` catcher, and the refusal is sound. All three legs measured:

- **Erasure:** `(({}) as any).constructor.constructor` transpiles to JS **byte-identical** to the
  un-evaded `({}).constructor.constructor` under `PINNED_OPTIONS`. Same for `<any>` and `as Object`.
- **Reach:** the emitted expression, executed, returns an object `=== globalThis`, and
  `typeof reached.process === 'object'` — the REAL global, not a stub (positive control).
- **Type shift:** baseline types `[Function, Function]`; `as any` → `[any, any]`,
  `as unknown as {constructor:any}` → `[any]`, `<any>` → `[any, any]`, `as Object` → stays
  `[Function, Function]`. **3 of 4 — the desk's arithmetic reproduces exactly.**
- All five variants are ADMITTED with zero catchers by the shipped rule.

**C8 is stronger than claimed and its caption is slightly off.** I measured **14/14**
`.constructor` accesses typing exactly `Function` (the 9 spellings contain 14 such nodes: 5
two-hop × 2 + 4 one-hop). The claim says "eight", which matches no count I can derive. The
substantive claim holds; only the number in the caption is unsupported. Discriminating control
green: `Object.freeze`, `(1).toFixed`, `"x".slice` all type as SIGNATURES, so a `type === Function`
test would not false-positive — exactly as C8 asserts.

---

## DISCREPANCIES

### Discrepancy F-1: the declared denominator gates CARDINALITY, never IDENTITY
**Severity:** CRITICAL (false positive — a green with no path to red)
**Claim:** "`red-proof.mjs`'s denominator now comes from the DECLARED tables, never the runtime
accumulator … it GATES the exit code and is PRINTED as the denominator."
**Reality:** True for mutations that change the row COUNT. False for mutations that preserve it.
`rows` never records WHICH declared row produced each entry, so `rows.length === EXPECTED_ROW_COUNT`
cannot distinguish 19 distinct injections from the same injection run 19 times.

**Measured, one loop-head edit, `of EXPECT` → `of EXPECT.map(() => EXPECT[1])`:**

```
CONTROL GREEN: true | CLASSES WITH A DEMONSTRATED RED PATH: 41 / 41
VERDICT: the runner is an ENFORCING GATE — control green, every class red-proofed.
MA_EXIT=0
```

The EXPECT loop printed **19 identical `membership_rename` rows** (baseline prints exactly 1).
**18 of 19 EXPECT red paths were retired, the full declared denominator 41 was printed, and the
instrument certified itself an ENFORCING GATE with EXIT 0.** `module-collections.mjs` reports 0
findings because the EXPECT DECLARATION is byte-identical.

AR-615 §7.3 conceded this as UNENUMERATED. **It is no longer a hypothesis — it executes.**

**The positive half of C1 is real and I verified it**, so the fix is not worthless: retiring ONE
row via `of EXPECT.slice(0, -1)` gives
`*** STOP CONDITION (F-1): built 40 rows, expected exactly 41 …` / `40 / 41` /
`VERDICT: NOT a gate` / EXIT 1. The realistic single-row retirement IS caught.

**Sources compared:** [red-proof baseline: 41/41 exit 0, 1 `membership_rename` row | M-A mutant:
41/41 exit 0, 19 `membership_rename` rows | M-C mutant: 40/41 exit 1]
**Source of truth:** M-A. Identical printed verdict, materially different coverage.
**Fix point:** `red-proof.mjs:216` — `rows.length === EXPECTED_ROW_COUNT` must become a comparison
of the SET OF ROW IDENTITIES against the declared tables, not their cardinality. Push the
declared key onto each row and assert set equality.
**Repro:** copy `red-proof.mjs` to `_MA-redproof.mjs` in the prototype dir, replace
`for (const [inject, cls, what] of EXPECT) {` with
`for (const [inject, cls, what] of EXPECT.map(() => EXPECT[1])) {`, `node ./_MA-redproof.mjs`.
**Blast radius:** every claim that rests on "41/41 ENFORCING GATE" — i.e. the campaign's entire
basis for believing any p0-vnext class is red-proofed.

---

### Discrepancy F-2: INSTANCE TEN — the set-of-sets does not pin its own coverage
**Severity:** CRITICAL (silent disagreement — the pin freezes the declaration; the count reads the consumption)
**Claim:** C3, "`module-collections.mjs` now has a REAL main entry … `6 files | 13 pinned tables |
0 findings | PASS | EXIT 0`", and the file's own header: "the expected membership is read from a
PINNED PRIOR ARTIFACT … a later commit cannot edit a frozen one."
**Reality:** The 13 is PRINTED, never ASSERTED. `tableCount` is
`Object.values(PINNED_MODULE_COLLECTIONS).reduce((a, s) => a + s.tables.length, 0)` — derived at
runtime from the very structure whose shrinkage it should detect. The guard loop at
`module-collections.mjs:123-130` only rejects `tables.length === 0`, so dropping 3 of 4 tables from
a file passes. `module-collections.mjs` is (correctly, and by its own declaration) not in its own
`COVERED_FILES`, so nothing else pins it either.

The file's stated mitigation — "make a silent shrink require editing a value that STATES ITS OWN
MAGNITUDE IN PLAIN SIGHT" — **was implemented for FILES (`COVERED_FILES`, a literal array that IS
checked) and NOT for TABLES.**

**Measured, NOOP control first (a rewriting rig is a second cause of every red):**

```
NOOP (byte-identical copy):  6 files | 13 pinned tables | 0 finding(s) | PASS | EXIT 0
one-line edit, 'EXPECT' removed from red-proof.mjs's tables:
                             6 files | 12 pinned tables | 0 finding(s) | PASS | EXIT 0
```

**Positive control that the coverage removal is what disarmed it:** with coverage INTACT, deleting
the real `module_collection_delete` row from `red-proof.mjs` on disk gives
`*** module_collections: red-proof.mjs: EXPECT MISSING row(s) (expected by cac39d45):
module_collection_delete` / `VERDICT: FAIL` / EXIT 1. The shipped gate can see the deletion. It is
the coverage edit that blinds it.

**THE COMPOSITION — two one-line edits, all three gates green [MEASURED HERE]:**

| gate | result |
|---|---|
| `module-collections.mjs` | `12 pinned tables \| 0 finding(s) \| PASS` — **EXIT 0** |
| `run.mjs` | `GATE: PASS — every enforced class is clean` — **EXIT 0** |
| `red-proof.mjs` | `CLASSES WITH A DEMONSTRATED RED PATH: 40 / 40` / `ENFORCING GATE` — **EXIT 0** |

The denominator fell 41 → 40 in silence because `EXPECTED_ROW_COUNT` is itself DERIVED from
`EXPECT.length`. **This is verbatim the COORDINATED TWO-EDIT DELETION shape `module-collections.mjs`'s
own header claims to have closed for `red-proof.mjs` and `run.mjs` — reproduced one level up, on
the file that does the closing.**

**Scoped honestly:** the coverage edit ALONE is not silent — `run.mjs:51`'s
`simulateDelete: { file: 'red-proof.mjs', collection: 'EXPECT', … }` would then find nothing and
red-proof's `module_collection_delete` row would go RED. It takes BOTH edits, which is exactly what
I measured, and exactly the bar the campaign already accepted as a finding for INSTANCES SIX/SEVEN.
**Fix point:** `module-collections.mjs:320` — add `EXPECTED_PINNED_TABLE_COUNT = 13` and assert it,
the same repair `red-proof.mjs:215` and `emitted-freeze.mjs:142` already use.
**Repro:** `node mutate.mjs module-collections.mjs …` removing `'EXPECT'` from the `red-proof.mjs`
tables array, then `node module-collections.mjs`.
**Blast radius:** every "pinned enforcement table" claim in the campaign.

---

### Discrepancy F-3: both `FREEZE_EXPECT` assertions are satisfied by the wrong injection
**Severity:** HIGH (caption is a claim — the printed witness does not witness)
**Claim (printed by the shipped gate):** `PASS freeze:membership_delete … names '38'=true`
**Reality:** `red-proof.mjs:168` asserts `stdout.includes(mustName)`. The **CLEAN control already
contains `'38'` 16 times**, entirely inside hex digests (`383b867bd8044cbf`, `3db7c88e393031e4`, …),
and every item-16 failure emits the line `compared 38 source rows, expected exactly 39`. So `'38'`
appears 19 times under EITHER injection.

**Cross-product, red-proof's own assertion applied to every pairing [MEASURED HERE]:**

| inject | exit | row `mustName='38'` | row `mustName='35(a)'` |
|---|---|---|---|
| `<clean control>` | 0 | fail (16 hits) | fail (1 hits) |
| `membership_delete` | 1 | **PASS** (19 hits) | **PASS** (1 hits) |
| `membership_rename` | 1 | **PASS** (19 hits) | **PASS** (1 hits) |

The declared diagonal is `membership_delete→38` and `membership_rename→35(a)`. **Every off-diagonal
cell PASSES.** Neither row can distinguish its own injection from the other; the `mustName` conjunct
contributes zero discriminating power beyond `exit != 0 && /STOP CONDITION \(item 16\)/`.
The gate is WEAKENED, not disarmed — the two rows jointly still prove "some item-16 stop condition
fires on some membership mutation", which is not the two distinct claims their captions make.
**Fix point:** `red-proof.mjs:168` — anchor on the emitted stop-condition line, e.g.
`` new RegExp(`STOP CONDITION \\(item 16\\): ${esc(mustName)}: ABSENT`) ``.
**Repro:** `PROTO_INJECT=membership_rename node emitted-freeze.mjs | grep -c 38` → 19.
**Blast radius:** the second-gate witness for R-548 §4(b)/(f).

---

### Discrepancy F-4: the pin reads `element[0]` only; the load-bearing sibling is unpinned
**Severity:** MODERATE (schema drift — F-3 is its exploitable instance)
**Reality:** `extractModuleCollections` takes a tuple row's identity from `e.elements[0]` alone.
Measured against the live file:

```
FREEZE_EXPECT   length=2   keys=["membership_rename","membership_delete"]
EXPECT          length=19  keys=["own_unrelated_attributed", … ,"module_collection_add"]
SHARED          length=2   keys=["partition_orphan","partition_sum"]
```

`element[1]` is **not** in the pinned key set, yet it is load-bearing in all three tables:
EXPECT's required failure-class, SHARED's via-injection (which decides WHICH injection actually
runs), and FREEZE_EXPECT's `mustName`. An edit to any of them is invisible to `module_collections`.
Most fail CLOSED (a wrong class name simply reddens), which is why this is MODERATE not CRITICAL —
but FREEZE_EXPECT's `mustName` fails OPEN, and that is F-3.
Same shape in `run.mjs`'s `SIX`: keys are the property NAMES; the status VALUES are unpinned
(mitigated — a value swap trips `partition_sum`, which I confirmed by reading the executable line).
**Fix point:** `module-collections.mjs:169-175` — extend the row identity to the full tuple of
string-literal elements, or add a per-table "identity arity".

---

### Discrepancy F-5: the failing verdict names nothing
**Severity:** LOW (caption)
When only `countOk` fails, `rows.every(r => r.ok)` is true, so the M-C run printed
`VERDICT: NOT a gate. Classes without a demonstrated red path: ` — an **empty list**. The real
reason is on the preceding STOP CONDITION line. A reader scanning for the named class finds none.
**Fix point:** `red-proof.mjs:229`.

---

## KNOWN RESIDUALS — confirmed present, NOT reported as discoveries
F-3-of-the-desk (no catcher, open by ruling; rows 59(a)-(c) MISS_NOT_CAUGHT), ungated
`MISS_NOT_CAUGHT` outside the pinned 52, `AMBIENT_ALLOWED` failing open at
`source-admission.mjs:110`, the unbuilt `Proxy` runtime catcher, and 59(b)'s one-hop mis-caption.
I re-confirmed C7 is consistent with 59(b): `({}).constructor` types as `Function` in the checker
while being `Object` at runtime.

---

## MANDATORY COVERAGE SECTION

### 1. What I verified, and via which non-overlapping paths

| Claim | Path A | Path B | Path C |
|---|---|---|---|
| Object identity | `git rev-parse` on both commits' trees | `git hash-object` vs `git ls-tree`, 11 files | `git diff HEAD` empty |
| C1 positive half | M-C mutant run (40/41, exit 1) | read the executable line `red-proof.mjs:216` | — |
| C1 refutation | M-A mutant run (41/41, exit 0) | row-count join: 1 vs 19 `membership_rename` lines | `module-collections` 0 findings |
| C2 | real 8-line on-disk delete → `GATE: FAIL` exit 1 | controls green before AND after; sha256 restore | — |
| C3 | `node module-collections.mjs` exact string | NOOP byte-identical copy reproduces it | `run.mjs` still exits 0 |
| C4 | 3 on-disk deletions, each RED and correctly named | controls green before AND after, all restores verified | — |
| C5 pins | `git diff` of `membership.mjs` constants | AST parse of pinned blobs: CORPUS 65→68, GREEN 9→9 | `run.mjs` prints `expected_expanded_cardinality: 68` |
| C5 six gates | ran all six, each EXIT 0 | — | — |
| C6 | `run.mjs` prints attributed 44 / caught_by_typechecker 5 / 52 of 52 | `run.mjs` and `source-admission.mjs` blobs BYTE-IDENTICAL across `a0d54a98^..cb9cfd76` | new rows 59(a)-(c) fall outside the original-52 population |
| C7 | shipped `admitSource` — 9/9 ADMITTED, zero catchers | read the executable lines `source-admission.mjs:462,560` (catchers key on `isNewExpression`/`isIdentifier`; `.constructor` is a PropertyAccess name) | — |
| C8 | my OWN `ts.Program` + checker, 14/14 `Function` | discriminating control: 3 non-`Function` signatures | — |
| C9 | my own checker: 3/4 move off `Function` | `ts.transpileModule` byte-compare: `as any` IDENTICAL | executed the emitted expr → `=== globalThis`, `.process` is object |
| F-2 | NOOP control + one-line mutant (13→12 tables) | positive control: shipped gate FAILS on the same deletion with coverage intact | full composition: all three gates green at 40/40 |
| F-3 | cross-product of 2 injections × 2 mustNames, red-proof's own assertion | clean-control substring census (16 hits of `'38'`) | — |

### 2. Positive-control witnesses for every absence claim
- "the row-preserving mutation survives" → M-C proves the SAME rig convicts a count-changing mutation (40/41, exit 1). Not always-green.
- "`module_collections` reports 0 findings under M-A" → the same gate reported 1 finding on a real EXPECT row delete (exit 1). Not always-green.
- "coverage removal is silent" → with coverage intact the identical deletion FAILS exit 1. The coverage edit is the cause.
- "no gate globs the prototype dir" (so my probe copies were invisible) → enumerated all `readdir/glob/opendir` sites; the only one is `module-tuple.mjs:33` on `surface/`, and `COVERED_FILES` is a hardcoded 6-element list.
- "C7's nine spellings are uncaught" → bare `Function` and `new Function` both REJECT via `1b-S:dynamic-loading` in the same run; `lane.id` ADMITS.
- "C8 is not vacuous" → `Object.freeze`/`toFixed`/`slice` type as signatures, not `Function`.
- "emitted JS still reaches the real global" → `typeof reached.process === 'object'`.
- **A false absence I caught and discarded:** my first freeze-substring run wrote to an unset `$TMPDIR` and reported "0 occurrences" from a missing file. Re-run with a byte-count proof of file existence gave 16. The published number is from the corrected rig.
- **A proxy I measured and discarded:** `grep -c "{ id: '"` over the pinned corpora gave 72/74/77, which does NOT match 65→68 — because it counts a different population (CORPUS + GREEN + others). I did not report it as a refutation; the AST path on the CORPUS array alone gives 65→68 and matches. I measured the neighbouring object and threw it away.

### 3. Join keys checked for every "identical / unchanged / matches" claim
- prototype object identical across commits → **tree SHA** `9d6ab970`, not commit sha.
- worktree == commit → **per-file `git hash-object`** against `git ls-tree`, all 11.
- C6 "attribution untouched" → **blob sha** of `run.mjs` (`e0ff1b9c1c2b`) and `source-admission.mjs` (`a36d2c500dea`), batch base vs HEAD.
- C5 pin bump → **`EXPANDED_PIN_COMMIT` + `EXPANDED_PIN_BLOB` pair**, and the blob resolved from the commit independently.
- C5 cardinality → **`CORPUS` array element count** in the pinned blob (the same key `membership.mjs:149` asserts), not a line count.
- M-A coverage loss → **count of `membership_rename` rows**: baseline 1, mutant 19.
- restore integrity → **sha256** of every mutated file against a pre-mutation record.

### 4. WHAT I DID NOT VERIFY
1. **C2's full M1+M2 composition** (loop-head master key + row delete together) was not executed. I
   executed each half separately (both RED). The composition is CORROBORATED by mechanism, not MEASURED.
2. **The other two C1 loop-head mutations** (claimed 23/41 and 26/41). I executed the 40/41 case the
   brief flagged as important, plus my own refuting mutation. The 23/41 and 26/41 figures are RELAYED.
3. **`module-tuple.mjs` has no injection of its own** in red-proof's mutation set. Its exit code is
   real (`v.ok` from actual emit+execute) but its red path is demonstrated only indirectly through
   `run.mjs`'s `emitted_module` class. UNENUMERATED whether a standalone `module-tuple` red path exists.
4. **I did not audit the 44 ATTRIBUTED rows individually.** C6 was verified as UNCHANGED (blob
   identity + re-derived totals), NOT as CORRECT. Whether 44 is the right answer is a different claim
   than whether this batch moved it, and only the latter was in scope.
5. **`admitSource` correctness beyond the probed expressions.** I probed 9 spellings + 4 evasions +
   3 controls. The rule's behaviour on the full corpus is MEASURED BY GRADED INSTRUMENT (run.mjs), not
   re-derived by me row by row.
6. **The four "type-space evasions" of C9 were reconstructed by me**, not enumerated in the claim.
   My set reproduces the claimed 3-of-4 arithmetic exactly, but the desk's specific four are UNENUMERATED.
7. **No runtime/live-capital surface was touched.** This prototype produces no P&L, no orders, and no
   sizing; there is no first-principles money reconciliation to do here.
8. **`PINNED_BLOBS` self-consistency** is enforced by the gate at runtime (it throws if the pin moved)
   and passed, but I did not independently re-derive each of the 6 pinned blobs from git.

### 5. Shared-tree hygiene
No `git checkout`, `reset`, `stash`, or `commit` was run. Three files were mutated on disk
(`red-proof.mjs`, `module-collections.mjs`, `source-admission.mjs`, `run.mjs`), each backed up
byte-exact and restored, **every restore verified sha256-identical**, and all probe copies deleted.
Final state: `git status --porcelain` over the prototype is EMPTY, `git diff HEAD` is EMPTY, and all
11 working-tree hashes equal the values recorded before any mutation. HEAD is still `cb9cfd76`.
`red-proof.mjs` was never killed mid-run.
