# External advisor ruling — AR-589 / executable admission prototype

**RULING ID / TASK ID:** external AR-589 review / campaign AR-589

**Objects reviewed:** prototype source at campaign commit `06842e21d88d38970c345b57056ecd3c45fcfc2f`; AR-589 report commit `8297ebbe062f97f07d9000a2aa22712420a70c42`; main-advisor ruling R-543 commit `11c6ddfc5cfffff221d950d9b79180465bc37be3`

**DECISION:** **APPROVE the prototype as a productive measurement instrument; REVISE its claimed `49 / 52` coverage and do not grade or promote the runner until the module identity, source-contract complement, diagnostic ownership, and executable enforcement paths are repaired.** R-543 correctly keeps the prototype and already orders semantic diagnostics, deterministic ambient types, and exclusive catcher ownership. The corrections below are additional.

## CLAIMS VERIFIED

- `[MEASURED HERE, campaign tree @ 06842e21]` The prototype runs and reports `49 / 52`, three named misses, five admitted green neighbours, zero getter invocations, and zero ledger/oracle reads.
- `[MEASURED HERE]` The first real run found a genuine defect in its unresolved-identifier rule and the worker repaired that defect without changing the expected result. The executable pivot is therefore vindicated.
- `[MEASURED HERE, source-admission.mjs:120-136]` Every source case is compiled with one hard-coded environment: `module: ESNext`, `ScriptKind.TS`, and the caller-provided filename.
- `[MEASURED HERE, run.mjs:14-39]` The runner supplies `fixture.ts` to every red source case and `green.ts` to every green source case. No corpus row carries a module identity.
- `[MEASURED HERE, corpus.mjs:101-102 and :129-130]` Row 54 and its alleged ESM twin are not the same program under two module systems. The red has a top-level `this.inject` statement; the green deletes that statement. This tests different source text, not the CJS-versus-ESM distinction required by the design.

## EVIDENCE INDEPENDENTLY CHECKED

### 1. The explicitly allowed and forbidden extensions are not executable inputs

I called `admitSource` directly with the same source under three filenames:

```text
probe.ts   bad -> ["1b-S:module-system"] ; clean -> []
probe.mjs  bad -> TypeError: Cannot read properties of undefined (reading 'statements')
probe.mjs  clean -> same TypeError
probe.cjs  bad -> same TypeError
probe.cjs  clean -> same TypeError
```

The design allows `.mjs` and forbids `.cjs`. The prototype cannot inspect either. It therefore has no measured module-system discriminator. Its row-54 red is a syntax scan of a TypeScript/ESNext parse, not evidence that the CommonJS wrapper channel is excluded from the effective artifact.

### 2. The source contract is implemented only as a forbidden-form scan

The design names the object under test as **`project()`'s module**, and its export surface admits `project` plus immutable plain-data schema constants. I independently exercised four complements omitted from the corpus:

```text
empty module                         -> ADMITTED
export const x = 1                   -> ADMITTED
export function helper() { ... }     -> ADMITTED
export const project = 1             -> ADMITTED
```

All four returned `ok: true`, `parseOk: true`, zero violations. The implementation rejects some forbidden exports but never proves the required `project` export exists or is callable. This is the exact complement-first failure class G-2 was meant to expose: a module can satisfy the rule by omitting the object whose purity the rule claims to certify.

### 3. The runner reports acceptance; it does not enforce it

`run.mjs` classifies and prints results, then exports them. It has no `process.exit`, `process.exitCode`, assertion, or terminal throw derived from:

- wrong-catcher rows;
- rejected green neighbours;
- failed parse/semantic validity;
- the negative control;
- getter invocations;
- ledger/oracle reads.

The normal command exits `0`. That is acceptable for an exploratory report only if it is captioned **measurement-only**. It is not an acceptance gate until each forbidden outcome has a demonstrated non-zero path and the unmutated control remains zero.

## TESTS RERUN

1. `node run.mjs` in `prototypes/p0-vnext-admission`: reproduced the reported summary; process exit `0`.
2. Direct `admitSource` filename matrix: `.ts` returned verdicts; `.mjs` and `.cjs` both threw before a verdict.
3. Direct complement probes: empty module, unrelated const export, unrelated function export, and non-callable `project` were all admitted.
4. Read the executable lines in `source-admission.mjs`, `run.mjs`, and `corpus.mjs`; the result above is not inferred from captions.

## ARCHITECTURE INVARIANTS TOUCHED

- P0 remains a hardening prerequisite. It is not Phase-1 exit and produces no trading-ready strategy.
- Source admission certifies a **specific effective module**, not free-floating source text.
- A closed source contract needs both halves: required membership and forbidden capabilities. Absence of forbidden forms is not presence of `project()`.
- Exploratory evidence collection may continue after misses; an acceptance verdict must fail closed. Do not abort the census before collecting incidence, but do exit non-zero after the complete evidence bundle is written.
- The prototype must remain isolated from the ledger, `ORACLE.json`, Gate B, claims, registry, DB, extraction, execution, and capital paths.

## FAILED OR UNPROVEN CONDITIONS

1. **Module-system coverage is unproven.** Row 54 uses the wrong object and the admitted `.mjs` object crashes.
2. **Source-contract membership is unproven.** The required `project` function may be absent or replaced by data and still pass.
3. **Runner enforcement is absent.** Printed acceptance conditions do not have paths to red at the process boundary.
4. R-543's three independent findings remain binding: semantic validity is not checked, ambient type inputs are not pinned, and attribution does not require competing catchers to stay silent.
5. The file-read tracker wraps a bounded set of `fs` entry points. Its result proves zero reads through those wrapped paths, not zero reads through every Node filesystem surface. Keep that scope in the caption unless the tracker is widened and red-proofed.

## REQUIRED CORRECTIONS

Add these to R-543's correction batch:

1. **Make module identity an input.** Each source fixture carries its filename/extension, TypeScript module and resolution options, nearest package `type`, emitted extension, and loader command. Pin the tuple in the result.
2. **Repair row 54 as a same-source differential.** Execute materially identical source through an actual CommonJS artifact and an actual ESM artifact. CJS must expose/reject the wrapper channel; ESM must make top-level `this` unavailable. Ambient/token catchers must remain silent in both ownership assertions.
3. **Make `.mjs` and `.cjs` decidable.** The allowed `.mjs` neighbour must not crash; `.cjs` must be rejected by module identity before source verdicts can launder it.
4. **Close the source-contract complement.** Require exactly one callable exported `project`; reject missing `project`, non-callable `project`, duplicate/ambiguous project exports, and unrelated function-valued exports. Add an immutable schema-constant green neighbour so this does not become “reject every other export.”
5. **Separate collection from enforcement.** Finish and publish the whole result ledger, then exit non-zero if any validity failure, wrong catcher, competing catcher, rejected green, negative-control failure, getter invocation, forbidden artifact read, or required-project membership failure occurred.
6. **Red-proof the runner.** Plant each terminal failure one at a time; require non-zero with the named reason; restore; require the clean control to return zero.

## FILES / SCOPE ALLOWED

Only the isolated prototype directory, its committed result artifact, and the existing design/result receipts needed to pin the correction. No gate/claim/registry implementation, no Gate B treatment, no ledger/oracle read, no DB, no extraction, no backtest, no runtime-production update, and no capital path.

## ACCEPTANCE COMMANDS

- Run one same-source CJS/ESM differential through emitted artifacts and their real loaders; assert exit codes, effective-module tuple, and exclusive catcher ownership.
- Run missing-project, non-callable-project, unrelated-function-export, and immutable-schema-constant controls.
- Run semantic diagnostics with content-pinned ambient declarations and assert each mutation has exactly one primary diagnostic owner.
- Mutate every terminal runner invariant independently; require non-zero after the complete report is emitted and zero after restoration.
- Re-run the full corpus and publish the corrected denominator, attributed subset, honest misses, invalid fixtures, and competing-catcher set separately.

## STOP CONDITION

Stop if a source is called CJS or ESM without changing the effective compiler/emitter/loader tuple; if the green twin removes the channel instead of changing only its module system; if a missing/non-callable `project` passes; if a runner failure is visible only in stdout while the process exits zero; or if the corrected coverage denominator absorbs invalid fixtures.

## AUTHORIZED NEXT ACTION

Continue the narrowly isolated prototype corrections already authorized by R-543. The corrected artifact, not AR-589's `49 / 52`, becomes the input to the independent `accuracy-validator` grade. Gate/claim implementation remains downstream of that grade.

## LESSON TO PERSIST

**A forbidden-form scanner does not certify a required object, and a source file does not have a module system by itself. Certify membership, compiler emit, and loader semantics as one joined contract—then make every broken acceptance invariant exit red.**

**Newest AR checked before write:** AR-589 is the newest report on disk. R-543 is the newest main-advisor ruling and its correction order is incorporated rather than duplicated as a novel finding.
