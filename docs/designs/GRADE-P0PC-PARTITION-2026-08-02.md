# GRADE — P0PC SIX-POPULATION PARTITION (HUNT MODE)

**Grader:** accuracy-validator (independent; did not design, build, or previously grade this object)
**Date:** 2026-08-02
**Tree:** `C:/Users/tonio/Projects/wt-h1-wave4-20260712` (branch `h1-wave4-sealed12-driver`)
**Container git dir (MEASURED HERE, `rev-parse --git-common-dir`):** `C:/Users/tonio/Projects/trading-forge/trading-forge/.git` — this is a **linked worktree**, not a standalone repo.
**PIN:** `9be6a52a` — MEASURED HERE: ancestor of HEAD `7f9e8d92`, and `git diff 9be6a52a HEAD -- prototypes/p0-vnext-admission docs/designs/P0-VNEXT-DESIGN-2026-08-01.md` is EMPTY. `git status --porcelain -- prototypes/p0-vnext-admission` was empty before and after my work: **I modified no file under test.** All probes ran from the scratchpad and imported the artifacts by `file://` URL.
**Mode:** HUNT. Rulings in scope: R-543 §4, R-544 §3, R-546 §5.0 + items 10–13, R-546 §6.

---

## VERDICT IN ONE LINE

The **arithmetic** of the partition survives independent recomputation. **Four of its five supporting claims do not**, and the rule the partition scores is **blind in a direction the design never enumerated**: I constructed and executed **two modules that reach outside themselves and are ADMITTED with zero violations**.

| Claim under test | Verdict |
|---|---|
| `44+3+0+0+5+0 = 52`, no row in two, no row in none | **NOT REFUTED** (reproduced; type-invalid set independently re-derived) |
| `surface_invalid = 0` is REAL, not definitional | **NOT REFUTED** (independent `tsc` CLI + positive control) |
| `caught_by_typechecker` does not launder misses | **NOT REFUTED** (one hygiene caveat, F-7) |
| `fixture_invalid = 0` is a measured population | **REFUTED — F-3.** Definitional. No code path can assign it. |
| type/value separation is a **PROPERTY** of the rule | **REFUTED — F-2.** Executed counterexample. |
| fixture edits are frozen by emitted behaviour (31/38) | **REFUTED — F-4.** Vacuous on 2 of the 38 rows. |
| `partition_overlap` is STRUCTURALLY UNREACHABLE | **REFUTED — F-5.** Reachable via a duplicate corpus id. |
| the runner is an enforcing gate, 16/16 + green control | **NOT REFUTED** (re-executed) |
| row 54 is a true container twin | **NOT REFUTED** |
| **the rule admits only modules that reach nothing** | **REFUTED — F-1 and F-2, both EXECUTED** |

---

## Discrepancy F-1: `export * from '<specifier>'` is ADMITTED — an unguarded ESM module edge

**Severity:** CRITICAL (false positive — a module that crosses the dependency boundary is admitted clean)

**Claim:** `1b-S:import-cardinality` enforces `admitted import count is 0`; `admitSource` returns a published `importCount`. The corpus's only module-edge rows are 26(a)–(c) and 53, all of which RED.

**Reality (MEASURED HERE):** `export * from './ledger.js'` is **ADMITTED**, `violations = []`, `importCount = 0`. So is `export * from 'node:fs'` — the exact "filesystem / network module" channel row 26(b) exists to prohibit. So is `export {} from './ledger.js'`, and all three stacked together.

**Root cause (MEASURED HERE — the executable lines):** `source-admission.mjs:392` claims and emits **only** for `ts.isImportDeclaration(node)`. In ESM, `ExportDeclaration` **with a `moduleSpecifier`** is a second static module-edge form and is not an `ImportDeclaration`. In the `export *` form the node contains **no `Identifier` at all**, so PASS B's identifier catchers have nothing to look at either. The edge is invisible to every catcher simultaneously.

The near-miss forms fail closed and are therefore *not* the finding: `export { read } from …` and `export * as ns from …` both RED via `POSITION_UNCLASSIFIED` (parents `ExportSpecifier` / `NamespaceExport`). **`export *` is the silent one.**

**Sources compared:**
- source A — `admitSource('fixture.ts', "export * from './ledger.js';\nexport const project = …")` → `ADMITTED`, `importCount=0`.
- source B — the **emitted and executed** artifact: transpiled to `mod.mjs`, imported by a host module. Output:
  ```
  !!! LEDGER MODULE EVALUATED — the boundary was crossed !!!
  re-exported names visible to the consumer: project,read
  m.read("k") = stub:k
  ```
  The ledger module's **top-level side effect fired** and its `read` export is **callable through the admitted module**.
- source C (positive control) — the `import { read } from './ledger.js'` form → `REJECTED [1b-S:import-cardinality]`. The probe can observe presence; the ADMITTED verdicts are a measured absence of any catcher, not a dead probe.

**Source of truth:** the executed artifact. The module edge is real at runtime; the rule's verdict is wrong.

**Why this is not excused by `1b-S:dependency-boundary` being NOT_IMPLEMENTED:** rows 26(a)–(c) are honest named misses of an *unbuilt* catcher, yet those modules are **still REJECTED** by the built one. F-1 convicts a **built and claimed** catcher: the module is not caught at all, and the published `importCount` is wrong.

**Fix point:** `prototypes/p0-vnext-admission/source-admission.mjs:392` — the predicate must be "a static module edge", i.e. `ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier)`. `ts.isImportEqualsDeclaration` should be enumerated in the same wave.

**Repro:**
```
node -e "import('file:///C:/Users/tonio/Projects/wt-h1-wave4-20260712/prototypes/p0-vnext-admission/source-admission.mjs').then(m=>console.log(m.admitSource('fixture.ts',\"export * from './ledger.js';\nexport const project = (lane: Lane) => ({ v: lane.v });\n\")))"
```

**Blast radius:** any consumer of the 44/52 number; R-546 §6's admissibility argument; every downstream claim that 1b-S bounds a module's reachable surface. `export * from` re-exports the ledger's whole namespace into the admitted module's public API.

---

## Discrepancy F-2: a real runtime capture is silently classified `type` — `class extends host.X {}` is ADMITTED

**Severity:** CRITICAL (false positive, in the exact direction the design names as dangerous)

**Claim (verbatim):** "type-space/value-space separation is a **property** of the rule (D/E pair) with a fail-closed residual." `type-value-proof.mjs` prints `VERDICT: type-space / value-space separation is a PROPERTY of this rule.`

**Reality (MEASURED HERE):** `classifyPosition` step (2) (`source-admission.mjs:179-182`) walks **every ancestor** and returns `'type'` on the first `ts.isTypeNode(p)`. **`ExpressionWithTypeArguments` is a TypeNode** — I measured `ts.isTypeNode(ExpressionWithTypeArguments) === true` — and it is the one TypeNode kind whose `.expression` slot holds a **live value expression**: the `extends` heritage clause.

Direct probe of `classifyPosition`, one file, every identifier:

| identifier | parent kind | verdict | truth |
|---|---|---|---|
| `Base` in `class C1 extends Base {}` | `ExpressionWithTypeArguments` | **`type`** | **runtime value** |
| `host`, `Nested` in `class C3 extends host.Nested {}` | `PropertyAccessExpression` (→ ancestor `ExpressionWithTypeArguments`) | **`type`** | **runtime value** |
| `host2`, `Deep` in `const k = class extends host2.Deep {}` | `PropertyAccessExpression` | **`type`** | **runtime value** |
| `Iface` in `class C2 implements Iface {}` | `ExpressionWithTypeArguments` | `type` | correct — but **by the same broken path** |

Because `position !== 'value'`, `source-admission.mjs:464`'s entire catcher block is skipped: no `AMBIENT`, no `FREE_REF`, and — because it is not `'unclassified'` either — **no `POSITION_UNCLASSIFIED`**. The fail-closed residual never sees it. This is precisely the asymmetry the brief named: `POSITION_UNCLASSIFIED` fires loudly, a false `type` verdict does not.

**Sources compared:**
- source A — `admitSource` on four constructed fixtures, all **ADMITTED, `violations = []`**:
  `class extends window.Base {}`, `class extends global.Base {}`, `class extends (Widget as any) {}`, `class extends (process.env as any) {}`, each inside `project`'s body.
- source B — the **emitted and executed** artifact for the `window.Base` case:
  ```
    HOST-GLOBAL READ: Base
  project() returned a class whose base is: Ledger | static reachable: LEDGER-ROW-42
  host-global property reads during project(): 1
  ```
  The emitted JS retains `class extends window.Base` (nothing was erased), the host global **is read at runtime**, and data behind it is reachable through `project()`'s return value.
- source C (positive control) — `({ v: window.Base })` in plain value position → `REJECTED [1b-S:direct-ambient-read]`. Presence is observable.
- source D — `(globalThis as any).Base` in a *parenthesised* `as` position → correctly `value` → caught. The discriminator is the heritage slot specifically, not the property access.

**Source of truth:** the executed artifact.

**Why `type-value-proof.mjs` says PROPERTY anyway:** its 12 cases are a **hand-chosen enumeration** of erased positions (type alias, type reference, `typeof` query, type argument, interface body, `satisfies`, type-only import). `ExpressionWithTypeArguments` — the only TypeNode kind that is *not* erased — is absent from it. "PROPERTY" is a caption over a finite list, not a property. (Separately: its `T1` row PASSes on a module that is `REJECTED [1b-S:import-cardinality]`, because the assertion only counts FREE_REFs on `Addend`. That row cannot discriminate what its label claims.)

**Fix point:** `prototypes/p0-vnext-admission/source-admission.mjs:179-182` — the ancestor walk must stop at, and treat as **value-space**, the `.expression` slot of an `ExpressionWithTypeArguments` (and must not cross a value-carrying slot on its way up). The residual must be widened, not the allowlist.

**Repro:**
```
node -e "import('file:///C:/Users/tonio/Projects/wt-h1-wave4-20260712/prototypes/p0-vnext-admission/source-admission.mjs').then(m=>console.log(m.admitSource('fixture.ts','export const project = (lane: Lane) => ({ v: class extends window.Base {} });\n')))"
```

**Blast radius:** R-546 item 10 in full; the `44` numerator (the corpus has no heritage row, so this channel is unmeasured, not mis-measured); any later claim that the residual is the rule's only escape hatch.

---

## Discrepancy F-3: `fixture_invalid = 0` is definitional — the population has no assignment site

**Severity:** CRITICAL (a reported measurement that cannot vary)

**Claim:** the six populations are `… surface_invalid 0 · fixture_invalid 0 …`, presented as six measured counts.

**Reality (MEASURED HERE — enumerated surface: every `*.mjs` under `prototypes/p0-vnext-admission/`):** the string `'FIXTURE_INVALID'` occurs at **exactly one site**, `run.mjs:190`, as a *value* in the `SIX` map. **No code path ever assigns it to `r.status`.** `classifyTypeInvalid` (`run.mjs:47-54`) returns only `SURFACE_INVALID`, `CAUGHT_BY_TYPECHECKER`, or `TYPE_INVALID_UNCLASSIFIED`. `fixture_invalid` is therefore `0` for every possible input — it is not a measurement.

Same sweep, same file: `'MISS_TYPE_INVALID'` occurs at `run.mjs:169` (`summary.miss_type_invalid`) and `run.mjs:218` (`why()`), and is likewise never assigned. `summary.miss_type_invalid` is a permanently-zero reported field.

**Positive control for this absence claim:** the identical grep pattern returns real `return 'SURFACE_INVALID'` / `'CAUGHT_BY_TYPECHECKER'` / `'TYPE_INVALID_UNCLASSIFIED'` assignment sites at `run.mjs:49/50/53`. The probe can observe an assignment site when one exists, so "no assignment site for `FIXTURE_INVALID`" is measured, not a dead grep.

**Contrast with `surface_invalid`:** that one *is* real. `SURFACE_INVALID` has an assignment site, a red path in `red-proof.mjs` (`surface_invalid_rows`, PASS), and an independent measurement (below) confirming zero rows carry a surface code. `fixture_invalid` has none of the three.

**Fix point:** `prototypes/p0-vnext-admission/run.mjs:47-54` — either give `FIXTURE_INVALID` a classifier branch and a red path, or delete the population and state that R-546 §5.0(ii) is unimplemented. Reporting it as a measured `0` is the defect. Same call for `summary.miss_type_invalid` at `run.mjs:169`.

**Repro:** `rg -n "FIXTURE_INVALID|MISS_TYPE_INVALID" prototypes/p0-vnext-admission/*.mjs`

**Blast radius:** R-546 §6's partition is a **five**-population partition wearing a six-population caption. The claim "no row appears in none" is true but weaker than advertised: one of the six buckets is structurally uninhabitable.

---

## Discrepancy F-4: `emitted-freeze.mjs` is VACUOUS on rows 26(a) and 26(b)

**Severity:** HIGH (a guard with no path to red on the rows it most needs to cover)

**Claim:** "fixture edits are frozen by **emitted behaviour** (31/38 emit-identical, 7 pre-registered, 0 undeclared)."

**Reality (MEASURED HERE):** `emitJs` (`emitted-freeze.mjs:33-38`) uses `ts.transpileModule`, which **elides an import whose bindings are unused**. Rows 26(a) and 26(b) are exactly that shape. Feeding the comparator four different fixtures:

| 26(a) variant | emitted JS | freeze verdict |
|---|---|---|
| baseline `import { read } from './ledger'` | `export const project = (lane) => ({ v: lane.v });` | — |
| shipped `'./ledger.js'` | *identical* | EMIT-IDENTICAL |
| **specifier repointed to `'node:fs'`** | *identical* | **EMIT-IDENTICAL (guard says CLEAN)** |
| **planted mutation DELETED ENTIRELY** | *identical* | **EMIT-IDENTICAL (guard says CLEAN)** |

Same for 26(b). For these two rows the entire fixture body vanishes from the emitted JS, so `EMIT-IDENTICAL` carries **zero information** — including about deletion of the very defect the row exists to plant.

**Positive control:** the comparator *can* see a specifier change on row 26(c) (a bare side-effect import is not elided) — `true`. So the blindness is specific and measured, not a broken harness.

**What the worker disclosed vs what is true:** `corpus.mjs:243-245` states the elision as the *reason* 26(a)/(b) are not in `PREREGISTERED_EMIT_CHANGES`. That is accurate and honest. It is **not** the same as disclosing that the guard cannot fail on those rows. `31/38 emit-identical` counts at least 2 rows where the check is unfalsifiable; the honest figure is **29 discriminating / 2 vacuous / 7 pre-registered**.

**Fix point:** `prototypes/p0-vnext-admission/emitted-freeze.mjs:33-38` — freeze the emitted JS **plus the module-specifier list** (or emit with `verbatimModuleSyntax` / `isolatedModules` so imports survive), and print a per-row DISCRIMINATES witness.

**Repro:** compare `ts.transpileModule("import { read } from './ledger';\nexport const project = (lane) => ({ v: lane.v });\n", {module: ESNext}).outputText` against the same string with line 1 removed.

**Blast radius:** the "0 undeclared" claim and R-546 §7's stop condition, for the unused-import class of fixtures.

---

## Discrepancy F-5: `partition_overlap` is NOT structurally unreachable

**Severity:** MEDIUM (a guard excused from the red-proof count by a false unreachability argument)

**Claim (verbatim, `red-proof.mjs:97-99`):** "STRUCTURALLY UNREACHABLE — one row has exactly one status, so it cannot be in two populations." On that basis it is excluded from the `16/16` denominator.

**Reality (MEASURED HERE):** the argument is sound about *statuses* and silent about *ids*. `run.mjs:198-200` counts occurrences of each **id** across the flattened population lists. `orig` is built by `ORIGINAL_52_IDS.map(id => results.find(...))` (`run.mjs:182`), so a **duplicate id in the corpus** puts the same id in one population twice and `duplicated` becomes non-empty. Replicating `run.mjs:194-200` verbatim:

```
distinct ids            -> duplicated = []
ONE DUPLICATE corpus id -> duplicated = ["x"]   <- guard FIRES
```

A duplicate corpus id is precisely the construction defect this guard should catch, and it is reachable today — not only "after a future construction change."

**Note in the worker's favour:** excluding it from the count rather than claiming `17/17` was the right instinct; the *reason given* is what is wrong. The declaration is more convenient than true. `16/16` is not inflated — the denominator is honest — but the exclusion rationale is.

**Fix point:** `prototypes/p0-vnext-admission/red-proof.mjs:97-99` — replace the unreachability declaration with an injection that duplicates one id in `ORIGINAL_52_IDS`, and count it `17/17`.

**Repro:** run the `SIX`/`inTwo`/`duplicated` reduction from `run.mjs:194-200` over `[{id:'x',status:'ATTRIBUTED'},{id:'x',status:'ATTRIBUTED'}]`.

---

## Discrepancy F-6: the pre-registration is co-committed with the checker that consumes it

**Severity:** MEDIUM (an unverifiable ordering claim underneath a "pre-registered" label)

**Claim (`corpus.mjs:235-237`):** "each reason was published in RESULTS §2 **BEFORE** `emitted-freeze.mjs` was run against them."

**Reality (ARTIFACT-SOURCED):** `PREREGISTERED_EMIT_CHANGES` is absent from `corpus.mjs` at `8297ebbe` and at `1958ba5d`, and first appears at `9be6a52a`. `emitted-freeze.mjs` **also first appears at `9be6a52a`** (`git log --diff-filter=A`). There is **no commit in which the pre-registration exists and the checker does not.** The ordering is therefore not verifiable from the artifacts — it rests entirely on the worker's narrative, which this grade does not consult.

I state this precisely: **this is not evidence of back-filling.** The seven listed reasons are individually plausible, and the four `51(*)` reasons match a real, visible emit diff. What is refuted is the *verifiability* of "pre-registered", which is the whole load-bearing property of a pre-registration.

**Fix point:** pre-registrations must land in a commit **before** the commit that adds the checker consuming them. Process, not code.

---

## F-7: hygiene caveats found while failing to convict (reported for completeness, not charged)

- **54(c) carries an unrepaired incidental diagnostic.** Its two codes are `TS2532` (*Object is possibly 'undefined'* — this **is** the module-scope-`this` channel) and `TS2540` (*Cannot assign to 'slot' because it is a read-only property* — an authoring artifact of the identical class that row 34(a) explicitly repaired with a mutable annotation). `corpus.mjs:21-25` states that rule is "applied uniformly"; it was not applied here. **I tested whether it matters and it does not:** applying 34(a)'s own repair to 54(c) leaves `TS2532` and the row stays `TYPE_INVALID → CAUGHT_BY_TYPECHECKER`. **The population is unchanged and `44` does not move.** Honest null.
- **The runner's own table cannot be audited from its own output.** `why()` (`run.mjs:216-220`) special-cases the dead status `MISS_TYPE_INVALID`, so the five `CAUGHT_BY_TYPECHECKER` rows — the only rows whose population depends *entirely* on their diagnostic codes — print the bare string `TYPE_INVALID`. A reader cannot check the classification the claim rests on. **Fix at the emitter** (`run.mjs:218`), not by hand-annotating the table.

---

## What I FAILED to refute (honest nulls — stated as findings in their own right)

**1. `surface_invalid = 0` is REAL, not a product of list membership.** This was the brief's first and strongest suspicion and it does not hold up.
- Path A: `run.mjs` reports `surface_invalid: []`.
- Path B (**non-overlapping**): I materialised all 39 source rows of the original 52 **on disk** in a temp copy of the pinned surface and compiled them with the **real `tsc` CLI in a separate process** (TS 5.9.3) — no `admitSource`, no in-memory `CompilerHost` override, no `run.mjs` status machine. Result: **exactly 5 rows carry any diagnostic** — `52(a) 52(b) 52(c) 52(d)` (`TS1117`) and `54(c)` (`TS2532`,`TS2540`) — and **none carries any of the 7 `SURFACE_CODES`**. The type-invalid set matches `run.mjs` row-for-row.
- **Positive control:** the archetypal surface fault (`(lane)` unannotated) compiled in the same rig yields `TS7006`, a member of `SURFACE_CODES`. The probe can observe a surface-invalid row; `0` is a measured absence.
- **No row was moved out of `surface_invalid` by list membership.** The list would only be load-bearing if some row carried a code the worker chose to omit from `SURFACE_CODES`; no row carries any unlisted code at all, because `TYPE_INVALID_UNCLASSIFIED` is empty and red-proofed.

**2. `caught_by_typechecker` does not launder misses.** Each of the 5 rows genuinely has the planted illegality *as* its type error:
- `52(a)–(d)`: `TS1117 An object literal cannot have multiple properties with the same name` — the planted illegality **is** duplicate cooked keys. The compiler cooks the escaped forms too (`\x61`, `\u0061` both produce TS1117 in my independent run), which is the non-obvious half of the claim and it holds.
- `54(c)`: `TS2532` is TypeScript modelling module-scope `this` as `undefined` — on-channel. Survives the incidental-diagnostic test in F-7.

**3. No SECOND ownership silent-deletion instance.** I enumerated every owner-claiming construct in `source-admission.mjs` (ImportDeclaration, dynamic `import()`, `require`/`createRequire`/`eval` calls, `new Function`, EXPORTS on both variable and function declarations, and all seven GRAMMAR claim sites) and planted a host-global **inside** each owned range — 15 probes. **All 15 still REJECTED**; every claim is paired with an emission. Positive control (the same host-global with no owner) REJECTS via `1b-S:direct-ambient-read`. The two `checkFrozenExpr` branches that push without claiming (`Object.freeze` of a non-literal; unwrapped nested literal) produce a *double* fire, which fails **loud** as `FAILED_OWNERSHIP`, not silent.

**4. The twin is real.** `run.mjs:125` compares `submittedBody` — the bytes actually handed to `admitSource` — not the corpus declarations; MEASURED `sameBytes=true (131B)` and `(96B)`. `redOnlyModuleSystem` asserts `fired.length === 1 && fired[0] === '1b-S:module-system'` — module-system is genuinely the CJS arm's only catcher. Both emitted artifacts are **executed** by `module-tuple.mjs:80` (`execFileSync`), reporting `typeof this` from *inside* the artifact: ESM `"undefined"`, CJS positive control `"object"`. The `twin` red path goes red on injection (PASS).

**5. The red-proof is a real discriminator.** Re-executed: control **green** (`exit=0`, `GATE: PASS`), 16/16 classes red with each naming its own class. Every injection in `run.mjs:63-74,100,103` mutates a **fixture or artifact**, never an expectation — I read all of them.

---

## BRIEF DEFECT: ops note 1 is refuted

The brief states my own definition `.claude/agents/accuracy-validator.md` is **UNCOMMITTED** in this tree, with GRADE mode present in the working copy but not at HEAD. **MEASURED HERE — this is false.**

```
git rev-parse HEAD:.claude/agents/accuracy-validator.md  -> 572c4d6ea20c415b9f0cf075c4a3b051b4d0d05d
git hash-object    .claude/agents/accuracy-validator.md  -> 572c4d6ea20c415b9f0cf075c4a3b051b4d0d05d
git status --porcelain -- .claude/agents/accuracy-validator.md  -> (empty)
```

Identical blob; clean working tree; the HEAD copy contains "GRADE" 4 times and the coverage mandate. A brief is a claim and this one did not survive.

**Ops note 2 is CONFIRMED:** `scripts/check-agent-parity.mjs` does not exist on disk and is not tracked (`git ls-files` empty) in this tree, so the `worker-execution` skill's stated parity guard is not running here.

---

## MANDATORY CLOSING COVERAGE

### 1. What I verified, and via which non-overlapping paths

| Claim | Path A | Path B (non-overlapping) | Join key |
|---|---|---|---|
| pin describes the artifacts | `merge-base --is-ancestor` | `git diff 9be6a52a HEAD -- <subject paths>` empty | commit sha + path |
| type-invalid set = 5 rows | `run.mjs` status machine (in-memory host override) | **real `tsc` CLI, separate process, on-disk fixtures** in a temp copy of the pinned surface | corpus row `id` → materialised filename, printed in full |
| `surface_invalid = 0` | worker's `SURFACE_CODES` filter | independent per-row diagnostic codes from `tsc` CLI + TS7006 positive control | diagnostic code string (`TSnnnn`) |
| F-1 export-from admitted | `admitSource` return value | **emitted `.mjs` executed by node**; ledger side effect observed, `read` callable | the fixture source text, byte-identical between the two paths |
| F-2 heritage capture admitted | `admitSource` + direct `classifyPosition` probe over every identifier | **emitted `.mjs` executed by node** with an instrumented `window` proxy; 1 host-global read counted | the fixture source text |
| F-3 dead population | reading `classifyTypeInvalid`'s executable returns | `rg` over the enumerated surface (all `*.mjs` in the dir) | the literal `'FIXTURE_INVALID'` |
| F-4 freeze vacuity | reading `emitJs` | running the same `transpileModule` call over 4 mutated inputs incl. full deletion | emitted-JS string equality |
| F-6 pre-reg ordering | `git show <commit>:corpus.mjs` at 3 commits | `git log --diff-filter=A` on `emitted-freeze.mjs` | commit sha + path |
| brief ops note 1 | `git status --porcelain` | `rev-parse HEAD:<path>` vs `hash-object <path>` | git blob sha |

### 2. Positive-control witnesses for every absence claim I make

| My absence claim | Witness that presence is observable |
|---|---|
| "no catcher fires on `export * from`" | the `import` form of the same edge → `REJECTED [1b-S:import-cardinality]` |
| "no catcher fires on `class extends window.Base`" | `window.Base` in plain value position → `REJECTED [1b-S:direct-ambient-read]` |
| "no row is SURFACE_INVALID" | unannotated `(lane)` in the same `tsc` rig → `TS7006` ∈ `SURFACE_CODES` |
| "`FIXTURE_INVALID` has no assignment site" | the same grep returns real assignment sites for the sibling statuses at `run.mjs:49/50/53` |
| "the freeze comparator is blind on 26(a)/(b)" | it is **not** blind on 26(c) — specifier change visible (`true`) |
| "no second ownership silent deletion in 15 probes" | the same host-global with no owner → `REJECTED` |

### 3. Join keys for every "identical / unchanged / matches" claim

- artifacts untouched since pin → **commit sha + exact path list** (`git diff 9be6a52a HEAD -- …` empty).
- independent type-invalid set matches the runner's → **corpus row `id`**, mapped to a materialised filename and printed with byte counts, so the object I compiled is provably the object the runner scored.
- agent definition unchanged → **git blob sha** (`572c4d6e…`), not mtime and not a text grep.
- F-1/F-2 executed artifacts correspond to the admitted fixtures → **the fixture source text itself**, passed byte-identical to `admitSource` and to `transpileModule`.

### 4. What I did NOT verify

- **The 44 `ATTRIBUTED` rows were not independently re-attributed.** I re-derived the *type-invalid* population by a second path; I did **not** independently re-derive which catcher fires on each of the 44, nor re-check single-diagnostic ownership per row. `attributed = 44` remains **MEASURED BY GRADED INSTRUMENT** (the instrument being `run.mjs`, whose gate I did re-execute) — not independently confirmed. F-1 and F-2 do not move this number, because the corpus contains no row exercising either channel.
- **The 18 runtime (`1b-R`) rows.** I read `run.mjs`'s handling but did not audit `runtime-admission.mjs` at all. 13 of the 44 attributed rows are runtime rows and are entirely ungraded here.
- **`RESULTS-2026-08-02.md` was not read.** Deliberate — it is the worker's narrative. Every finding above is from executable lines, git objects, or code I ran. One consequence: if RESULTS discloses F-4's vacuity or F-3's dead bucket, I have not credited it.
- **`AGENT-REPORTS.md` (AR-591/AR-592) was not read**, per the same rule and per the brief's do-not-touch list.
- **Whether F-1/F-2 are reachable in the real P0-vNext build pipeline.** I proved they are admitted by `admitSource` and that the constructed modules execute; I did **not** verify that this prototype's rule is what gates real source, nor that a real `project()` module could take these shapes.
- **Exhaustiveness of the G-1 sweep.** I probed 30+ constructed channels across 7 families (export-from, class heritage, module-scope class/enum/namespace, `import.meta`, meta-properties, TLA, default/class exports). Two admitted. **This is a sample, not a closure** — I did not enumerate the `SyntaxKind` space, and `ts.isTypeNode` has other members I did not individually test. The correct reading is "at least two blind channels exist", never "exactly two".
- **`ts.isImportEqualsDeclaration` / `import x = require(...)`** — named as a sibling of F-1 by inspection; **not probed**.
- **No mutation testing of my own probes.** My probe harness has controls but was not itself red-proofed against a planted bug in the probe.
- **The design document** `docs/designs/P0-VNEXT-DESIGN-2026-08-01.md` was not opened; this grade is of the prototype's behaviour, not of the design's text.
- **Windows/`autocrlf` byte effects** were not investigated; all byte comparisons here were on in-memory strings, not on checked-out files, so the known checkout-smudge trap does not apply — but I did not prove that.

---

## FIX POINTS, ONE LINE EACH

| # | File:line | Change |
|---|---|---|
| F-1 | `prototypes/p0-vnext-admission/source-admission.mjs:392` | claim/emit on `ExportDeclaration` with a `moduleSpecifier` (and enumerate `ImportEqualsDeclaration`) |
| F-2 | `prototypes/p0-vnext-admission/source-admission.mjs:179-182` | the `.expression` slot of `ExpressionWithTypeArguments` is value-space; widen the residual, never an allowlist |
| F-3 | `prototypes/p0-vnext-admission/run.mjs:47-54`, `:169` | give `FIXTURE_INVALID` a branch + red path, or delete the population and say §5.0(ii) is unimplemented |
| F-4 | `prototypes/p0-vnext-admission/emitted-freeze.mjs:33-38` | freeze specifiers as well as emitted JS; print a per-row DISCRIMINATES witness |
| F-5 | `prototypes/p0-vnext-admission/red-proof.mjs:97-99` | inject a duplicate id; count `17/17` |
| F-6 | process | pre-registrations land in a commit strictly before the checker that consumes them |
| F-7 | `prototypes/p0-vnext-admission/run.mjs:218` | print the real diagnostic codes for `CAUGHT_BY_TYPECHECKER` rows — fix the emitter, not the table |

---

*Grade scoped to: commit `9be6a52a`, worktree `wt-h1-wave4-20260712`, corpus = the 59-row `CORPUS` in `corpus.mjs` (52 scored), engine = TypeScript 5.9.3 under `surface/tsconfig.pinned.json`, Node v24.13.0, Windows 11. No claim is made about any other tree, corpus, or compiler version.*
