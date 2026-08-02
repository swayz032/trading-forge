# GRADE — P0PC COMPILER-ADMISSION BATCH (AR-607 / AR-608 / AR-609 / AR-610 / R-566)

**Mode:** HUNT (adversarial). **Grader:** accuracy-validator, independent of the doer.
**Date:** 2026-08-02.

## Pin — READ THIS FIRST, THE HEAD MOVED MID-GRADE

| | |
|---|---|
| Brief's pin | `b16997a01e6cf86b0b4a4a47275b1bf24896ae5d` |
| `git rev-parse HEAD` at grade START | `b16997a01e6cf86b0b4a4a47275b1bf24896ae5d` (MEASURED HERE) |
| `git rev-parse HEAD` at grade END | `c5a04043937a17af2112a31488defe8212e119fc` (MEASURED HERE) |

A worker seat committed to the shared tree while I was grading. **The join key is the blob, not
the commit.** All ten prototype blobs were re-read at the end and are byte-identical to the ones
I snapshotted at start (MEASURED HERE):

```
run.mjs                e0ff1b9c1c2bf367c3d2ec63a6c3a827d2c990dc
red-proof.mjs          78d76b0babdaaf894a21b33fd38b3bc9a28e34cc
module-collections.mjs e7e836c4753a6b61598d2e019ff96f2dea7ff5f5
type-value-proof.mjs   468ac763164e152a476ec88139cc76c76286ce99
source-admission.mjs   a36d2c500deaf0ddcf3b699f56301c6f8fd65ccf
runtime-admission.mjs  6e7a3f5148181a8e02efaf28e3fa5797ab79dc53
membership.mjs         e125c72ed2715199bce1fba665731f8c394c2e30
corpus.mjs             d269b5cbce2cc9d03905abac5c816e039a1f9cfd
emitted-freeze.mjs     0e1980b52018bab39de58c0b95d93fdb09d76784
module-tuple.mjs       ed5f2926924362117951342b0165b32d63ff22f6
```

**This verdict describes those blobs.** `git status --porcelain prototypes/` returned empty at
the end: my grade never wrote to the shared tree.

## Verdict per claim

| # | Claim | CLAIMED | VERIFIED | Basis |
|---|---|---|---|---|
| 1 | AR-607 "the set-of-sets now covers the enforcement tables" | shut | **MATERIALLY FALSE AS SCOPED** | tables covered (12/12), composition still live — F-1, F-2 |
| 2 | AR-608 "`F-3` is shut" | shut | **NOT REFUTED** | red path + over-correction control reproduced independently |
| 3 | AR-609 instance eight + rule-set pins | closed | **CONFIRMED** | all 12 pins convict a real one-row deletion |
| 4 | AR-610 "the SOURCE surface is already closed to Proxy" | closed | **REFUTED BY EXECUTION** | F-3 |
| 5 | R-566 `new.target` ADMITTED is correct | correct | **NOT REFUTED, premise unenforced** | ruling stands; its discriminator is not enforced by the rule (F-3) |

**Band: 6 / 10** (VERIFIED, grader-issued). Adversarially tested, real defects found, one
CRITICAL class re-opened and one CRITICAL scope claim refuted by execution. Not 7-8 because
two of the five claims do not survive contact.

---

## Discrepancy F-1: INSTANCE NINE — the pin protects the DECLARATION, the count is computed from the CONSUMPTION

**Severity:** CRITICAL (false positive — a gate certifies itself while 18 of its checks are retired)

**Claim:** AR-607 — *"the set-of-sets now covers the enforcement tables"*; deleting one `EXPECT`
row from `red-proof.mjs` "is now caught."

**Reality:** Deleting a row is caught. **Not consuming the rows is not.** `red-proof.mjs:190`
prints `${rows.filter((r) => r.ok).length} / ${rows.length}` — and `rows` is a runtime array
built by `push` inside four loops. The batch pinned `CLASSES`/`SHARED`/`EXPECT`/`FREEZE_EXPECT`
as *declarations*; nothing anywhere asserts what `rows.length` must be. A **12-byte edit at the
loop head**, leaving the `EXPECT` declaration byte-identical, retires 18 red-proofs silently.

**Sources compared:**
- set-of-sets pin (`checkPinnedCollections()`): `[]` — sees `EXPECT` at full length **19**
- `red-proof.mjs` verdict: `CLASSES WITH A DEMONSTRATED RED PATH: 23 / 23` · `VERDICT: the runner is an ENFORCING GATE` · EXIT **0**
- unmutated NOOP control on the same harness: `41 / 41` · EXIT **0**

**Source of truth:** the executed run. 18 classes lost their red path and every gate stayed green.

**Fix point:** `red-proof.mjs:189-190` — `allOk`/the printed ratio need a denominator that does
not come from `rows`. The two sibling gates already show the correct shape and **exclude** this
mutation (boundary proven by what it excludes, MEASURED HERE):

| gate | denominator | same mutation → |
|---|---|---|
| `red-proof.mjs:190` | `rows.length` (runtime) | `23 / 23`, ENFORCING GATE, **EXIT 0** |
| `type-value-proof.mjs:125` | `CASES.length` (pinned) | `3 / 15`, **EXIT 1** |
| `emitted-freeze.mjs:142` | `EXPECTED_SOURCE_COUNT` (pinned) | `compared 5, expected exactly 39`, **EXIT 1** |

**Repro:**
```
cp -r prototypes/p0-vnext-admission <scratch>/mut     # + node_modules/typescript
sed -i 's/of EXPECT) {/of EXPECT.slice(0, 1)) {/' <scratch>/mut/red-proof.mjs
cd <scratch>/mut && node red-proof.mjs ; echo EXIT=$?   # 23/23, ENFORCING GATE, EXIT 0
node -e "import('./module-collections.mjs').then(m=>console.log(m.checkPinnedCollections()))"  # []
```

**Blast radius:** `red-proof.mjs` is the **sole** instrument certifying "the runner is an ENFORCING
GATE." Every AR in this campaign that cites a red path cites this number. `grep -n "rows.length"`
over the directory returns exactly one enforcement-bearing hit — there is no second source.

---

## Discrepancy F-2: the coordinated two-edit deletion is still live, and it re-opens the F-1/R-558 CRITICAL

**Severity:** CRITICAL (silent disagreement — a deleted guard row is printed and gates nothing)

**Claim:** AR-607 — *"Before the fix both passed green and **composed**: two edits retired the
class fix AND the proof it ever worked."* Stated as closed.

**Reality:** The composition is closed at the layer AR-607 patched and **open one layer up**.
Two edits, neither visible to the set-of-sets pin:

- **M1** `red-proof.mjs` loop head → `EXPECT.slice(0, 1)` (12 bytes; declaration untouched)
- **M2** `run.mjs` `FAILURE_CLASSES` entry `['membership', <predicate>, …]` → `['membership', false, …]`
  (the tuple's leading string — the only thing the pin reads — survives)

**Sources compared (all MEASURED HERE):**

| probe | result |
|---|---|
| `checkPinnedCollections()` | `[]` |
| `node run.mjs` (clean) | `GATE: PASS`, EXIT **0** |
| `node red-proof.mjs` | `23 / 23`, `ENFORCING GATE`, EXIT **0** |
| `PROTO_INJECT=membership_delete_guard node run.mjs` | `GATE: PASS`, EXIT **0**, with `"missing_expanded_ids": ["56(a)"]` **printed** |

Row `56(a)` is `static edge: export * from` — **the guard row that exists because the
accuracy-validator's F-1 CRITICAL admitted a module that reached the ledger.** R-558's exact
words for the original defect were "computed, printed, and gated nothing." That state is
reproduced here at the current blobs.

**Discriminating control (proves the probe is alive):** `PROTO_INJECT=membership_delete`
(deletes row `38`, which *is* in the pinned original 52) still gives `GATE: FAIL (1 class)`,
EXIT 1 — caught incidentally by `partition_sum`, not by membership. Only rows outside the
original 52 — i.e. the guard rows added by prior CRITICALs — are unprotected.

**Fix point:** same as F-1 (`red-proof.mjs:189-190`). M2 alone is caught; M1 is the master key
that makes M2 invisible.

**Blast radius:** every guard row added by a prior CRITICAL (`56(a)`–`(d)`, `57`, `58`).

---

## Discrepancy F-3: AR-610 REFUTED — the source surface is not closed to Proxy, or to host state at all

**Severity:** CRITICAL (false positive — ADMITTED modules reach live host state)

**Claim:** AR-610 — *"the SOURCE surface is already closed to Proxy"*, because naming `Proxy` is
REACHING FOR a host global, so even an inert `new Proxy({},{})` is `REJECTED
1b-S:direct-ambient-read`.

**Reality:** The premise is true and the conclusion does not follow. **The catchers key on
`Identifier` nodes.** A property-access chain contains no free identifier — `.constructor` sits
in its parent's `.name` slot and is classed `isPropName`, which skips every catcher
(`source-admission.mjs:530`, `:555`). An object literal supplies the root. So host state is
reachable while the module names **nothing**.

**Sources compared — PATH 1, the shipped rule's verdict (MEASURED HERE):**

```
REJECTED   new Proxy({}, {})                                          [1b-S:direct-ambient-read]   <- positive control
REJECTED   Reflect.get(...)                                           [1b-S:direct-ambient-read]   <- positive control
ADMITTED   ({}).constructor.constructor('return globalThis')()        []
ADMITTED   lane.constructor.constructor('return globalThis')()        []
ADMITTED   ({}).constructor.constructor('return new Proxy(...)')()    []
ADMITTED   [].constructor.constructor('return process.env')()         []
ADMITTED   ''.constructor.constructor('return globalThis')()          []
ADMITTED   (async () => {}).constructor                               []
```

**PATH 2, transpile the fixture under the same pinned options and EXECUTE it** (non-overlapping —
asks the runtime, not the rule):

```
({}).constructor.constructor('return globalThis')()   ->  v === globalThis      : true
[].constructor.constructor('return process.env')()    ->  v === process.env     : true
({}).constructor.constructor('return new Proxy(…)')() ->  live Proxy, get trap returns globalThis : true
(async () => {}).constructor                          ->  AsyncFunction constructor : true
NEGATIVE CONTROL  export const project = (lane) => ({ v: lane.v })
                                                      ->  v === globalThis      : false  (v === 1)
```

**Source of truth:** the execution. An ADMITTED module hands its caller the real `globalThis`,
the real `process.env`, and a live `Proxy` — the last of these with no `Proxy` token in the source.

**In scope by the rule's own taxonomy, not by my opinion:** `CATCHERS.DYNAMIC_LOAD` is declared to
reject `eval` / `Function` / `new Function` / `require` / `import()`. `({}).constructor.constructor`
**is** `Function`. `CATCHERS.AMBIENT` is declared to reject `globalThis` / `process`. Both reached.

**Fix point:** `source-admission.mjs:530` (`isPropName` blanket-skips property-access names) and
`:555-583` (the catcher cascade runs on identifiers only). The channel is the *member expression*,
not the spelling — a name list cannot close it. `grep -n "constructor" corpus.mjs` returns **zero**
rows for this channel (the only hits are `__proto__` key rows and a runtime fixture's class
constructor), so the corpus cannot see it either.

**Repro:**
```
node -e "import('<proto>/source-admission.mjs').then(m=>console.log(
  m.admitSource('probe.ts',\"export const project = (lane: Lane) => ({ v: ({}).constructor.constructor('return globalThis')() });\n\").outcome))"
# ADMITTED
```

**Blast radius:** every verdict the prototype has published about the source surface's closure.
`44/52` attribution is unaffected (it scores named channels); the **scope claim** built on it is not.

### Desk residual discharged: no Proxy fixture is uninterpretable

The brief names an open residual — *"One Proxy probe still returns `TYPE_INVALID` and is
uninterpretable. If you can make that fixture type-clean, do it."* I could not reproduce it.
**Eight Proxy shapes, all type-clean under the pinned surface (MEASURED HERE):**

```
REJECTED  new Proxy({}, {})                              [1b-S:direct-ambient-read]
REJECTED  new Proxy(lane, {})                            [1b-S:direct-ambient-read]
REJECTED  new Proxy({}, { get: () => 1 })                [1b-S:direct-ambient-read]
REJECTED  new Proxy({}, { get(t,k) { return globalThis } })  [1b-S:direct-ambient-read]
REJECTED  Proxy.revocable({}, {})                        [1b-S:direct-ambient-read]
REJECTED  const P = new Proxy({}, {}) at module scope     [1b-S:const-ast-grammar]
ADMITTED  `as unknown as ProxyHandler<object>` (TYPE position only)   — correct, erased
REJECTED  Reflect.ownKeys(lane)                          [1b-S:direct-ambient-read]
```

Zero `TYPE_INVALID`. The residual is closed: **the named-`Proxy` arm of AR-610 is correct and now
has eight executed witnesses.** What fails is the scope claim, not the mechanism.

---

## Discrepancy F-4: `module-collections.mjs` is not a gate, and is counted as one

**Severity:** HIGH (a completion signal is not a result)

**Claim:** the access recipe — `node module-collections.mjs   # the set-of-sets check` — and the
desk-verified state *"all six gates EXIT 0."*

**Reality:** `node module-collections.mjs` produces **zero bytes of output** and EXIT 0.
The file has no main entry: `grep -n "process.exit|console.log|import.meta.main|argv"` returns
**one hit, inside a comment (line 37)**. `checkPinnedCollections()` is exported and never invoked
when the module is run directly. Its EXIT 0 asserts only that the file parsed and that the
`COVERED_FILES` loop did not throw.

**Source of truth:** the real check does run — inside `run.mjs:51`, before anything else, with
`process.exit(1)` on findings. So coverage exists; **the caption is what is false.** "Six gates
EXIT 0" is five gates plus one no-op.

**Fix point:** `module-collections.mjs` — add a main guard that calls `checkPinnedCollections()`
and exits non-zero, or strike it from the recipe and the "six gates" count.

**Repro:** `node module-collections.mjs > out 2>&1; echo EXIT=$?; wc -c out` → `EXIT=0`, `0` bytes.

---

## Discrepancy F-5: `SCRIPT_KIND_BY_EXT` — a third rule set in a rule file, present at the pin, not membership-pinned

**Severity:** MEDIUM (coverage erosion; **fails CLOSED**, so not an admission hole)

**Claim:** AR-609 — the previously-unpinned **rule sets** `source-admission::CATCHERS` and
`runtime-admission::CATCHERS` are pinned.

**Reality:** Both are pinned and both convict (below). But `source-admission.mjs` carries a
**third** consumed module-level rule set, `SCRIPT_KIND_BY_EXT`, which is present at the pin
commit and absent from `PINNED_MODULE_COLLECTIONS['source-admission.mjs'].tables`. It gates
`admitSource` (`if (!(ext in SCRIPT_KIND_BY_EXT)) return PARSE_ERROR`).

**Sources compared (MEASURED HERE):**

| deletion | pin says | `run.mjs` |
|---|---|---|
| `'.tsx': ts.ScriptKind.TSX,` | `[]` | `GATE: PASS`, EXIT **0** — silent |
| `'.cts': ts.ScriptKind.TS,` | `[]` | `GATE: FAIL (2)`, EXIT 1 — caught **by the corpus, not the pin** |

So the coverage that exists is incidental (a `.cts` fixture happens to be present), not
structural. **Bounded honestly:** `admitSource` early-returns `PARSE_ERROR` on an unknown
extension, so a deleted entry fails closed — this erodes coverage, it does not admit a bad module.

**Fix point:** `module-collections.mjs:88` — add `SCRIPT_KIND_BY_EXT` to the `source-admission.mjs`
table list.

Full "present at the pin, not membership-pinned" enumeration (MEASURED HERE) — everything else in
this list is a runtime accumulator or a metadata object, not an enforcement table:
`run.mjs`: `PLANT_WITNESS`, `results`, `negControl`, `extraRoots`, `summary`, `liveCollections`,
`duplicated`, `likeForLike` · `red-proof.mjs`: `rows` · `type-value-proof.mjs`: `rows` ·
`membership.mjs`: `BASELINE_META`, `EXPANDED_META` · `runtime-admission.mjs`: none.
(`red-proof.mjs::rows` on that list **is** F-1.)

---

## Claims that survived

**AR-609 — CONFIRMED, and this is the strongest part of the batch.** A real one-row textual
deletion was made against the LIVE file for every pinned table (an independent path — I did not
use the shipped `simulateDelete` option, which would have reproduced the instrument's own
simulation), then the file was restored and byte-compared. **12 / 12 convicted; all restored
byte-identical:**

```
FAILURE_CLASSES/SIX/SURFACE_CODES/FIXTURE_INVALID_CODES  run.mjs                 CONVICTED
CLASSES/SHARED/EXPECT/FREEZE_EXPECT                      red-proof.mjs           CONVICTED
CASES                                                    type-value-proof.mjs    CONVICTED
CATCHERS                                                 source-admission.mjs    CONVICTED
CATCHERS                                                 runtime-admission.mjs   CONVICTED
HISTORICAL_RENAMES                                       membership.mjs          CONVICTED
```

The brief's residual "`run.mjs::SIX`, `SURFACE_CODES`, `FIXTURE_INVALID_CODES` were pinned this
batch — verify that landed AND that pinning did not alter attribution" is **discharged**: all
three convict, and my independent clean run reproduces `caught_by_typechecker: 5`,
`expected_cardinality: 52`, `expected_expanded_cardinality: 65`, `GATE: PASS` — attribution
unchanged.

**AR-608 — NOT REFUTED.** `caught_by_typechecker: 5` reproduced on my own harness (the
over-correction control); the `substituted_diagnostic` red path passes in my independent 41/41
NOOP run. I attacked the witness axis by reading: a substituted diagnostic with a different code
falls to `unjoined`; a resolved true plant leaves its anchor `unwitnessed`; a spanless diagnostic
exits early to `unjoined`. All three convict. Residuals are as the desk named them.

**R-566 — NOT REFUTED, on an unenforced premise.** `new.target` is ADMITTED (MEASURED HERE), and
I could not make `new.target` alone yield host state. But the discriminator the ruling rests on —
REACHED-FOR vs SUPPLIED — **is not enforced by the rule**: F-3 shows a module reaching host state
from a supplied `lane` via `lane.constructor.constructor`. The ruling is correct about
`new.target`; it is not correct that the surface enforces the distinction it invokes.

---

## COVERAGE — what I verified, how, and what I did not

### 1. Two-plus non-overlapping paths per claim

| claim | path A | path B |
|---|---|---|
| F-1 / F-2 | executed `red-proof.mjs` / `run.mjs` verdict + exit code off the process | `checkPinnedCollections()` called directly, reporting `[]` and `EXPECT` length 19 |
| F-3 | the shipped rule's `admitSource` verdict | **transpile + execute** the fixture and identity-compare the returned value against `globalThis` / `process.env` |
| AR-609 pins | real text deletion + restore + sha256 byte-compare | verdict strings naming the exact missing row key |
| baseline numbers | desk's reported values | my own harness, independently resolved `typescript`, reproducing `5` / `52` / `65` / `41/41` / `GATE: PASS` |
| F-1 boundary | red-proof goes green under the mutation | the two nearest neighbours (`type-value-proof`, `emitted-freeze`) go **red** under the same mutation |

### 2. Positive-control witnesses for every absence claim

- "no catcher fires on the prototype-climb" → **in the same harness, same call**, `new Proxy({},{})`
  and `Reflect.get` REJECT with `1b-S:direct-ambient-read`. The probe is alive.
- "the escape is real, not a broken witness" → the **negative control** clean fixture returns
  `v === globalThis: false` (`v === 1`).
- "the pin is blind to M1" → the same `checkPinnedCollections()` call **convicts 12/12 real
  deletions**. It is not a dead probe.
- "my mutation harness is faithful" → **NOOP control run first**: unmutated scratch copy reproduced
  `41/41`, `GATE: PASS`, `5`, `52`, `65`, EXIT 0. My first harness attempt FAILED this control
  (`ERR_MODULE_NOT_FOUND: typescript`) and every result from it was discarded.
- "every plant landed" → `apply.mjs` throws `PLANT DID NOT LAND` if the anchor is absent or the
  replace is a no-op. All plants printed a landed witness with before/after byte counts.

### 3. Join keys checked for every "identical / unchanged" claim

- **blob sha1 per file**, start vs end of grade — the commit moved, the blobs did not.
- **sha256 before/after** every scratch mutation-and-restore (`restoredIdentical: true`, 12/12).
- `git status --porcelain prototypes/` empty at the end.
- `caught_by_typechecker: 5` compared on the **row ids** (`52(a)-(d)`, `54(c)`), not just the count.
- Baseline reproduction compared on `expected_cardinality` / `expected_expanded_cardinality` /
  `GATE:` line, not on exit code alone.

### 4. Exit-code discipline

Every exit code was read off the process via redirect-then-`$?`. **No pipeline was used to read an
exit code anywhere in this grade.**

### 5. What I did NOT verify

- **Attribution logic / `44/52`.** Out of bounds per the brief. Read only. I confirmed by
  execution that my clean run reproduces the published partition, but I did not independently
  re-derive attribution — it has had its own pass at `8a40f899`.
- **The other six `typecheckerOwned` anchors.** The brief names this residual; only `34(d-u)`'s
  substitution is executed, and I did not add the other six. Unchanged.
- **The `witness` EXACT-MATCH residual.** I attacked it by reading (three failure modes all
  convict) but did not construct an impostor whose `anchorText` equals a declared witness. That
  remains open exactly as the desk named it.
- **`corpus.mjs` internal row correctness.** I read it for channel coverage only.
- **Whether F-3 is exploitable through the RUNTIME admission path** (`runtime-admission.mjs`).
  I probed the SOURCE surface only. The runtime path has its own catchers I did not exercise.
- **`module-tuple.mjs` and `emitted-freeze.mjs` collection coverage** beyond the denominator
  question — neither is in `PINNED_MODULE_COLLECTIONS`; I verified their denominators are pinned
  and did not enumerate their other module-level declarations.
- **Any claim about the executing tree** `trading-forge/runtime-production` — never read, never
  written, per the brief.

### 6. Access

Everything ran from the brief's recipe in
`C:/Users/tonio/Projects/wt-h1-wave4-20260712/prototypes/p0-vnext-admission`, read-only.
Mutations ran in a byte-identical copy at a scratch path **outside the repository**, with
`typescript` copied in (not junctioned — a junction `rm -rf` deletes the target on this box) and
`GIT_DIR` exported so the gates' `git show` pin reads still resolved. No `git checkout`, `reset`,
`stash`, or worktree command was run in the shared tree.
