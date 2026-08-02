# GRADE-P0PC-FINAL — 2026-08-02

**Mode:** HUNT (adversarial), with a grading band attached.
**Object:** `prototypes/p0-vnext-admission/` at pin **`8a40f899`**.
**Tree of record:** campaign worktree `C:/Users/tonio/Projects/wt-h1-wave4-20260712`, branch `h1-wave4-sealed12-driver`.
**Grader tree:** a detached `git worktree` at `/c/tfb` (first at `/c/tfa`, see §Environment), pinned to `8a40f899`. The shared campaign worktree was never written to except for this receipt.
**Engine:** node `v24.13.0`, TypeScript `5.9.3`.

**Independence:** I did not design, build, or previously grade this object. A prior
`accuracy-validator` grade in this lineage (`GRADE-P0PC-PARTITION-2026-08-02`) produced the F-1 /
F-2 CRITICALs that rows `56(a)–(d)` and `57` now guard; that lineage is declared here. Every band
below is re-derived from the artifacts at `8a40f899` only.

**Declared substitution (one, and it is the established one):** in my isolated tree the three files
importing `typescript` by bare specifier (`emitted-freeze.mjs`, `module-tuple.mjs`,
`source-admission.mjs`) were rewritten to
`file:///C:/Users/tonio/Projects/wt-h1-wave4-20260712/node_modules/typescript/lib/typescript.js`,
because a detached worktree has no `node_modules`. Import specifier only; no other byte changed.
Verified same compiler: `ts.version 5.9.3`, resolving to that exact path in the campaign tree.

---

## VERDICT

**NOT SOUND — band 5.** The instrument's *machinery* is genuinely adversarial and its headline
number is correct. The *property it certifies* does not hold: I constructed and executed four
counterexamples, two of which are live runtime-capture classes the rule ADMITS.

| Claim | Verdict |
|---|---|
| 1. Both of R-548's founding attacks are closed | **REFUTED** (attack-A species survives — F-3) |
| 2. `44 / 52` like-for-like is admissible | **CONFIRMED** — independently re-derived, set-identical |
| 3. Ownership key `(row, owned expression, span, code)`, no code allowlist, join is a bijection | **PARTIALLY CONFIRMED** — bijection real, `AMBIGUOUS` fails closed; but the join is satisfiable by an impostor (F-3) and its prescribed remedy is unusable (F-6) |
| 4. Expanded membership externally pinned, cannot be silently shrunk | **REFUTED** for the coordinated case (F-4) |
| 5. Type/value separation is a property decided by the emitter; no `SyntaxKind` or spelling allowlist exists | **PARTIALLY REFUTED** — the emitter-oracle *decision* is real and property-based, but a `SyntaxKind` allowlist DOES exist (dead), and the claimed second opinion does not (F-5) |

Reproduced at my own hand and **not in dispute**: all six gates exit 0; `red-proof` 31/31 with
control green; the bracketed clean→attack→restore control discriminates.

---

### Discrepancy F-1: `runtime-admission.mjs` ADMITS a `Proxy`, which is a live runtime capture
**Severity:** CRITICAL (false positive)
**Claim:** `runtime-admission.mjs:1-9` — "RUNTIME INPUT ADMISSION for the value handed to
`project()` … (iii) recursive prototype-identity check … Invokes nothing."
**Reality:** [MEASURED HERE] A `Proxy` over a plain object is ADMITTED with `violations: []`. The
walk reads `Object.getOwnPropertyDescriptors` and `Reflect.ownKeys` only, so it never observes the
`get` trap. The admitted value then reaches host state on every property read.

Executed counterexample — the module source is the value itself:
```js
const lane = new Proxy({ id: 'L1', size: 1 }, {
  get(t, k, rx) { if (k === 'size') return globalThis.process.pid; return Reflect.get(t, k, rx); },
});
```
```
admitRuntime verdict : ADMITTED []
project(lane).v      : 18036  <- real process.pid is 18036
CAPTURE OCCURRED     : true
```
**Positive control (probe was alive):** same run rejected `{a:()=>1}` → `1b-R:function-valued-field`,
`new Date()` → `1b-R:prototype-identity`, and an accessor descriptor → `1b-R:accessor-descriptor`;
`{id:'L1',a:1}` ADMITTED. **The same capture written as a getter is REJECTED
(`1b-R:accessor-descriptor`) — the rule catches one spelling of a capture and misses the other.**
Also admitted: a proxy whose `ownKeys`/`getOwnPropertyDescriptor` traps report `{a:1}` while the
target holds a function; and a proxy over a `Date` whose `getPrototypeOf` trap forges
`Object.prototype`, defeating catcher (iii) by name.
**Source of truth:** the executed module. `Proxy` is a legal value for the `lane` argument.
**Fix point:** `runtime-admission.mjs:49` `isPlainRoot` / `:55` `getOwnPropertyDescriptors` — the walk
needs a proxy-detection step; there is no in-language predicate, so this is a design decision, not a
one-line patch.
**Blast radius:** every `1b-R` verdict. The corpus contains **zero** `Proxy` rows
[MEASURED HERE: `grep -n "Proxy" corpus.mjs` → no match], so the corpus is structurally incapable of
seeing this — the same shape as the `implements` gap the delivery itself documents.
**Repro:** `node probe-runtime.mjs`, `node probe-capture.mjs` (sources in §Artifacts).

---

### Discrepancy F-2: THE THIRD BLIND CHANNEL — `import.meta` is ADMITTED
**Severity:** CRITICAL (false positive)
**Claim:** Claim 5 — "an identifier absent from emitted JS cannot be a runtime capture. No
`SyntaxKind` or spelling allowlist exists." Prior grade: "at least two blind channels exist, never
exactly two." This is the third.
**Reality:** [MEASURED HERE] `export const project = (lane: Lane) => ({ v: import.meta });` is
**ADMITTED**, `violations: []`.

**Mechanism, measured not hypothesised** — an AST dump of that exact body:
```
Identifier "meta"     parent=MetaProperty  parent.name===node ? true
```
`source-admission.mjs:568` computes `isPropName = node.parent.name === node`, and a `MetaProperty`
node's `.name` **is** its Identifier. So `meta` is classed a name slot and `source-admission.mjs:573`
(`if (!isPropName && !isDeclName && ...)`) skips **every** catcher. The `import` half is an
`ImportKeyword` token, not an Identifier, so nothing else can see it.

**Executed:** the admitted module was emitted and run.
```
emitted JS: "export const project = (lane) => ({ v: import.meta });"
project(lane).v.url     = file:///C:/.../admitted.mjs
project(lane).v.dirname = C:\Users\tonio\AppData\Local\Temp\grader-meta-XvgkkR
HOST STATE ESCAPED      = true
v.resolve is a function = true   <- module resolution handed to the caller
```
`import.meta.resolve` is dynamic module resolution — the capability `CATCHERS.DYNAMIC_LOAD` exists to
reject when spelled `require` / `createRequire` / `import()`. `{ ...import.meta }` is also ADMITTED.
**Positive control:** in the same run `({ v: process.env })` → REJECTED `1b-S:direct-ambient-read`,
and the prior CRITICAL `class extends window.Base {}` → REJECTED. The probe was alive.
**Source of truth:** the executed emitted module.
**Fix point:** `source-admission.mjs:568` — `isPropName` must exclude `MetaProperty`.
**Blast radius:** every `1b-S` source verdict. `new.target` (also a `MetaProperty`) is likewise
ADMITTED. Corpus coverage of `import.meta` / `new.target` / `MetaProperty`: **zero rows**
[MEASURED HERE].
**Note:** this is a different axis from the `.cts`/`.mts` module-format probe the desk already ran;
it is a node-KIND hole, not a container hole.

---

### Discrepancy F-3: an impostor diagnostic in the anchor's slack still buys `caught_by_typechecker`
**Severity:** CRITICAL (false positive) — this is the `[HYPOTHESIS, UNPROVEN]` the brief named. It is now PROVEN.
**Claim:** Claim 1 — "Both of R-548's founding attacks are closed (A: an unrelated diagnostic planted
on a row cannot buy it a `caught_by_typechecker` credit)." `run.mjs:104-108` — "every anchor is
joined by EXACTLY ONE diagnostic. A second diagnostic sheltering inside an anchor has no anchor of
its own left to claim."
**Reality:** [MEASURED HERE] The bijection catches a *surplus* diagnostic. It does **not** catch a
*substituted* one. When the row's true planted illegality VANISHES and an unrelated diagnostic of
the same code lands inside the anchor, the anchor is claimed, `unwitnessed` is empty, and the row is
credited.

Row `34(d-u)` declares anchor `undeclaredReader(lane)` / `TS2304`; its stated defect is "the planted
illegality IS the unresolved free reference." I made that reference RESOLVE and renamed the
parameter, so the true `TS2304` disappears and an unrelated `TS2304` on `lane` shelters in the slack:
```js
// body only; the row's expectation was NOT touched
`declare function undeclaredReader(x: unknown): unknown;\nexport const project = (ln: Lane) => ({ v: undeclaredReader(lane) });\n`
```
| run | diagnostic witnessing the anchor | verdict | exit |
|---|---|---|---|
| clean | `TS2304@L1:46 "undeclaredReader"` | CAUGHT_BY_TYPECHECKER | 0 |
| **mutated** | **`TS2304@L2:61 "lane"`** | **CAUGHT_BY_TYPECHECKER** | **0** |
| restored | `TS2304@L1:46 "undeclaredReader"` | CAUGHT_BY_TYPECHECKER | 0 |

**`GATE: PASS`. And the partition is numerically IDENTICAL to the clean run** — `total 64`,
`attributed 55`, every bucket unchanged. A grader reading only the numbers sees nothing.
**Source of truth:** the executed bracket (clean → mutated → restored), all three at my own hand.
**Fix point:** `run.mjs:112-132` — the join proves "a diagnostic of the declared code lands inside
the declared expression". It does not prove that diagnostic IS the row's planted illegality. The
`defect` field is prose and, as `corpus.mjs:171-173` honestly concedes, not machine-checked.
**Blast radius:** all 6 rows declaring `typecheckerOwned` (`34(d-u)`, `52(a)–(d)`, `54(c)`); 5 of them
are the `caught_by_typechecker` population inside the like-for-like 52.
**Scope, stated honestly:** this does **not** move `44 / 52` — `34(d-u)` is a declared addition, not
one of the pinned 52. It refutes claim 1, not claim 2.

---

### Discrepancy F-4: the expanded corpus CAN be shrunk — pin bump plus row deletion passes every membership check
**Severity:** CRITICAL (false positive)
**Claim:** Claim 4, and `membership.mjs:79` — "✅ THE COORDINATED CASE IS CLOSED BY CONSTRUCTION, NOT
BY A SECOND CHECK." `membership.mjs:152-153` — "no edit to this delivery can change what that commit
contains."
**Reality:** [MEASURED HERE] `EXPANDED_PIN_COMMIT` is a plain string on `membership.mjs:51`, inside
the delivery it polices, and **nothing asserts its value**. Contrast `membership.mjs:112-115`, where
the ORIGINAL pin has a hardcoded `EXPECTED_CARDINALITY = 52` that throws if the pin yields a
different count. The expanded pin has **no cardinality guard at all** — its expected count is
whatever the pin says.

I performed the coordinated shrink: bumped the pin to `9be6a52a` (one line) and deleted the five
rows that commit lacks — `56(a)`, `56(b)`, `56(c)`, `56(d)`, `57`, **the guard rows that exist
because of the two prior CRITICALs**.

```
run.mjs        EXIT=0     GATE: PASS
membership.mjs EXIT=0
  "expected_expanded_cardinality": 59        <- silently fell from 64, nothing asserts it
  "missing_ids": []      "missing_expanded_ids": []
  "undeclared_ids": []   "derived_additions_absent": []
```
Every membership check reports **clean** while five guard rows are gone.
**What did fire, and why it is not the claim:** `red-proof.mjs` exited 1 — but only on
`membership_delete_guard`, an injection that **hardcodes the string `56(a)`** and became a no-op once
that row was already absent. That is the red-proof suite noticing its own fixture broke, not the
membership mechanism detecting the shrink. [MEASURED HERE] `56(a)` is the **only** guard row id named
anywhere in `red-proof.mjs` or `run.mjs`; `56(b)`, `56(c)`, `56(d)` and `57` are named by no
injection and rest solely on the membership mechanism that just reported clean.
**Source of truth:** the executed shrink; restore control returned all gates to exit 0.
**Fix point:** `membership.mjs:51` — the expanded pin needs the same treatment as the original: an
asserted cardinality and/or an asserted blob hash, so a pin move cannot be a silent shrink.
**Blast radius:** the entire expanded-corpus membership guarantee, i.e. the R-558 repair.

---

### Discrepancy F-5: a `SyntaxKind` allowlist DOES exist, and the claimed second opinion does not
**Severity:** MEDIUM (caption/claim vs code)
**Claim:** `source-admission.mjs:191` — "NO SPELLING ALLOWLIST AND NO `SyntaxKind` ALLOWLIST EXISTS OR
MAY EXIST." `source-admission.mjs:566-567` — "`classifyPosition` is retained only as a SECOND,
non-overlapping opinion for the disagreement report below."
**Reality:** [MEASURED HERE, dir-wide grep]
- `VALUE_PARENT_KINDS` — a `Set` of `ts.SyntaxKind` values — is declared at `:153` and consulted at
  `:254`. That is a `SyntaxKind` allowlist. The *existence* claim is false as written.
- `classifyPosition` has **zero call sites**: defined `:226`, named in a comment `:566`, imported by
  `type-value-proof.mjs:109` and never called. There is no "disagreement report" anywhere.
- It is not merely dead but **unrunnable**: `:247` calls `isWithin(...)`, and `isWithin` is **defined
  nowhere in the directory** — reaching that branch throws `ReferenceError`.
**Source of truth:** the grep results and the absent definition.
**Fix point:** delete `classifyPosition` + `VALUE_PARENT_KINDS`, or implement `isWithin` and wire the
disagreement report. Deleting makes both captions true again.
**Blast radius:** the delivery advertises a second, non-overlapping opinion it does not have — which
is precisely the two-path property this desk grades against.
**Honest scope:** the *decision* claim survives. The emitter oracle at `:203-224` is the sole decider
and is genuinely property-based, not a syntax list. Claim 5's substance holds; its absolutes do not.

---

### Discrepancy F-6: the `AMBIGUOUS` branch works — but the remedy its own caption prescribes cannot ever pass
**Severity:** MEDIUM (caption is a claim)
**Claim:** `run.mjs:107-108` — "A row that genuinely owns two diagnostics at one expression declares
that expression TWICE — the count is then a CLAIM the row makes and the run can falsify."
**Reality:** [MEASURED HERE] Good news first: the `AMBIGUOUS` branch is **reachable and fails
closed** — the brief's `[UNWITNESSED]` concern resolves in the safe direction. I declared row
`52(a)`'s anchor `a: 2` twice, exactly as instructed:
```
52(a)  TYPE_INVALID_UNCLASSIFIED
JOIN: AMBIGUOUS ownership (overlapping declared anchors): TS1117@32:"a" matches 2 declared anchors
      | declared anchor(s) never witnessed: TS1117@"a: 2", TS1117@"a: 2"     run.mjs EXIT=1
```
But this can never succeed. `body.indexOf` resolves both declarations to the *same* `[start,end)`,
so any diagnostic inside matches 2 anchors → `AMBIGUOUS` → unclaimable. For two diagnostics sharing
one code at one expression the prescribed remedy is unusable, and such a row can never be credited.
(Distinct codes at one expression work fine — that is how `54(c)` passes.)
**Fix point:** `run.mjs:86-93` — dedupe anchors positionally, or match the Nth occurrence per code.

---

### Discrepancy F-7: `miss_type_invalid: 0` is DEFINITIONAL, not measured
**Severity:** MEDIUM (false green in a report field)
**Reality:** [MEASURED HERE] dir-wide grep for `MISS_TYPE_INVALID` returns exactly two hits: the
tally at `run.mjs:364` and a comment at `run.mjs:440` ("a status R-546 §5.0 RETIRED and which is
never assigned again"). **No assignment site exists.** The `0` printed every run is unreachable-by-
construction. This is verbatim the defect `run.mjs:65-69` convicts for `FIXTURE_INVALID` — a
population with no assignment site wearing a measured caption. Related stale captions, verified:
`corpus.mjs:158-161` and `surface/ambient.d.ts:15` still classify rows into this retired population.

---

### Stale captions (corroborated by a delegated sweep, spot-verified by me)
[CORROBORATED — sweep by a subagent; the items below I re-measured myself]
- `corpus.mjs:295-297`: "this corpus is now 59 rows … 7 rows were ADDED". [MEASURED HERE] `CORPUS` is
  **64**, `GREEN` 8; additions over the pinned 52 are **12**. The enumeration omits `56(a)–(d)` and
  `57` — added in this same file.
- `red-proof.mjs:155/158`: over-correction control asserts `"caught_by_typechecker": 5` and names 5
  ids. [MEASURED HERE] **6** rows declare `typecheckerOwned`; the 5 is correct only under the
  original-52 scoping, which the caption never states. `34(d-u)` — the row F-3 defeats — is outside
  this control's reach.
[RELAYED, not re-measured by me]: `corpus.mjs:300` claiming the by-id 52 lives in that file;
`membership.mjs:4` and `run.mjs:414` dangling line pointers.

---

## Grading

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| P0PC admission prototype @ `8a40f899` | **5** | **VERIFIED** | Six gates exit 0 and `red-proof` 31/31 reproduced at my own hand; `44/52` independently re-derived set-identical via a second path; four executed counterexamples (F-1..F-4), each bracketed by controls | Two live capture classes ADMITTED (`Proxy`, `MetaProperty`); typechecker credit buyable by substitution; expanded membership shrinkable; corpus structurally blind to all three |

**Reconciliation (claimed vs verified differ by >1, so it is written out).** The object was presented
as DELIVERED-PENDING-GRADE off "all six gates green, 31/31 red-proof, bracketed control" — machinery
consistent with band 7. I cannot certify 7. Band 7 requires *adversarially tested with residual risks
documented*; the adversarial testing here is real and unusually disciplined, but it did not reach the
classes that decide the rule's purpose, and the corpus cannot see them (zero `Proxy` rows, zero
`MetaProperty` rows, one guard row id hardcoded out of five). Two of the five claims are refuted by
execution and two more are partially refuted. A rule whose certified property — "an admitted module
performs no runtime capture" — is falsified by two executed modules is *implemented and partially
proven*, not *adversarially tested*. Band 5 is the honest read: the harness is 7-grade, the rule is
not. **The default assumption is that a claim differing this far was inflated; here I do not think it
was dishonest — the desk's own residuals named F-3 and the `AMBIGUOUS` branch and routed them to a
grader rather than closing them itself, which is the correct behaviour and is why F-3 was findable.**

**Not eligible for 9 or 10 regardless:** no independent re-scan beyond this one, and open HIGHs exist.

---

## Environment note (identity decays)

My first isolated worktree `/c/tfa` was **deleted mid-audit by something outside this session** and
deregistered; the campaign worktree's HEAD also moved during the grade, `0caa94e5` → `1d4c1976`. I
re-derived rather than recalled: the campaign tree and prototype were verified intact and clean, and
`git diff 8a40f899 1d4c1976 -- prototypes/p0-vnext-admission/` is **empty**, so every measurement
above still describes the pinned object. Work resumed in a fresh tree `/c/tfb` at the same pin. One
near-miss recorded for honesty: a `grep -c` returning 0 short-circuited an `&&` chain and printed
`EXIT=1` for a `node run.mjs` **that never ran** — I nearly recorded "the shrink is caught". F-4 was
re-measured cleanly before being written down.

---

## MANDATORY CLOSING COVERAGE

### 1. What I verified, and via which two-plus non-overlapping paths
- **Gate liveness.** Path A: ran all six gates in my own tree, exit codes read off the process, never
  through a pipe. Path B: the bracketed clean → four-attack → restore control, reproduced.
- **`44 / 52`** — the brief's largest unverified number. Path A: the delivery's own `run.mjs`
  classifier. Path B (mine, non-overlapping): the 52 ids obtained by **text scan** of
  `git show 8297ebbe:…corpus.mjs` (`membership.mjs` instead imports that blob as a module), then each
  row's verdict recomputed from the **raw violation list** returned by `admitSource`/`admitRuntime`,
  with the partition rule re-stated from its definition rather than imported from `run.mjs`.
  Result: 52 unique ids, partition **44 + 3 + 5 = 52**, attributed set **set-identical** to the
  published 44, `in CLAIMED not in MINE: (none)`, `in MINE not in CLAIMED: (none)`.
  **This is the first independent re-attribution of those 44 rows; the number is CORRECT.**
- **Both frozen pins.** Path A: the run's printed `expected_membership_source` /
  `expanded_membership_source`. Path B: `git rev-parse 8297ebbe:…` → `b56e2969c1b6…` (11050B) and
  `53e80935:…` → `f177b2456dee…`. Agree.
- **F-1 / F-2** — static verdict from the admission function, plus the emitted module **executed** and
  its captured host value compared against the real host value.
- **F-3 / F-4 / F-6** — executed through the real gate in an isolated tree, each with a restore
  control returning the tree to exit 0 and `git diff --stat` confirming only my declared substitution
  remained.

### 2. Positive-control witness for EVERY absence claim
| Absence claimed | Positive control |
|---|---|
| Proxy not caught by `1b-R` | same run REJECTED `{a:()=>1}`, `new Date()`, an accessor descriptor; ADMITTED `{id:'L1',a:1}`; and **REJECTED the getter spelling of the identical capture** |
| `import.meta` not caught by `1b-S` | same run REJECTED `({v: window.x})`, `({v: process.env})`, and the prior CRITICAL `class extends window.Base {}` |
| No `Proxy` / `MetaProperty` rows in corpus | grep pattern proven live on the same file by matching `Reflect.ownKeys` (a real corpus row) and `prototype` (5 hits) |
| `classifyPosition` has no call sites | the same grep returned its definition, its comment, and its import — so the pattern matches |
| `isWithin` defined nowhere | the same grep returned its **use** at `:247`, proving the pattern matches that identifier |
| `MISS_TYPE_INVALID` has no assignment site | the same grep returned the tally and the comment |
| Guard rows unnamed by injections | the same grep **did** return `56(a)` at 4 sites, proving the pattern matches row ids |
| F-3 mutation caused the flip | restore control returned the exact clean anchor text and exit 0 |
| F-4 shrink caused the pass | restore control returned all gates to exit 0, diff clean |

### 3. Join keys checked for every "identical / unchanged / matches" claim
- Prototype byte-stability: `git diff --stat <pin> <head> -- prototypes/p0-vnext-admission/` — empty
  at both `0caa94e5` and `1d4c1976`. Key = tree path at commit.
- `44/52` set identity: key = **row id**, compared as sets both directions, not by count.
- Pins: key = **blob SHA + byte length**, not commit message.
- Compiler identity: key = `ts.version` + resolved absolute path.
- F-3 "partition unchanged": key = each named bucket count in the expanded partition, compared
  field-by-field against the clean run.

### 4. WHAT I DID **NOT** VERIFY
- **`emitted-freeze.mjs`, `module-tuple.mjs`, `type-value-proof.mjs` internals.** I ran them (exit 0)
  and read them, but I did not adversarially attack their oracles. `type-value-proof` 15/15 is
  ARTIFACT-SOURCED, not independently re-derived.
- **The remaining 26 red-proof classes.** I confirmed 31/31 and control-green, and attacked the
  ownership and membership classes specifically. I did **not** check each of the other classes for
  vacuity. `31/31` is MEASURED BY GRADED INSTRUMENT, not re-derived.
- **The `attributed` verdicts inside the expanded 64** beyond the pinned 52. Only `44/52` was
  re-attributed independently; `55/64` is ARTIFACT-SOURCED.
- **Whether `Proxy` and `MetaProperty` exhaust the blind channels. THEY DO NOT — this is a SAMPLE,
  NOT A CLOSURE.** I probed 8 runtime forms and 12 source forms. `new.target` is a second confirmed
  MetaProperty admission I did not develop. I did not enumerate the `SyntaxKind` space; the correct
  reading remains "at least three blind channels exist", never "exactly three".
- **`Reflect`-based, getter-on-prototype, and `Symbol.toPrimitive` runtime forms** — not probed.
- **Deep-recursion and stateful-proxy robustness.** Both throw uncaught out of `admitRuntime`
  (`RangeError`, `TypeError`); `run.mjs:249` does not wrap the call. I did not assess whether that is
  fail-closed in the intended production caller, because no such caller exists yet.
- **Three relayed stale captions** (`corpus.mjs:300`, `membership.mjs:4`, `run.mjs:414`) are
  CORROBORATED by a delegated sweep and **not re-measured by me**; graded RELAYED.
- **`RESULTS-2026-08-02.md`** was not audited against the code.
- **Any ruling/AR document.** I graded the code at the pin, not the campaign record.
