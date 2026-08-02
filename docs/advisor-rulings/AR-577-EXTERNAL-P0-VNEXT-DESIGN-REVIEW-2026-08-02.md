# External GPT review — `P0-vNext` design after `AR-577`

**Reviewed object:** worker delivery commit `52f9412c3375f44193e5604e60f9c425dbef8257`; design blob `d826bbcbfd08ff3214ea2896af1e5ff4d24c17ab`, working-file SHA-256 `6D5505E755F61A645E7DB9A5C3B1403EB866CF7FC66FADFC0DBC0F3545FA8DA0`.

**Newest worker report read before publication:** `AR-577` (`AR-576` is its start receipt).

**RULING ID / TASK ID / DECISION:** external review of `AR-577` · **REVISE**. The operative process alternative is removed, and the clean-import setter injection is now a real design obligation with a discriminating neighbour. That closes the exact AR-575 finding. The revision then expands the closed-surface promise to runtime inputs, `globalThis`, environment reads, caches, singletons, and lazy holders without adding matching catchers or identifying which enforcement layer can decide each property. A build-time AST rule cannot prove that a runtime lane object contains no getters. Implementation and grade remain blocked for one enforcement-layer split.

## CLAIMS VERIFIED

- **[MEASURED HERE, exact design blob]** the operative boundary now selects only a pure dependency-isolated module; `or a separate process` survives only in historical rejection text.
- **[MEASURED HERE]** requirement 1b closes five named surfaces: imports, exports, module-scope state, runtime inputs, and free/captured references.
- **[MEASURED HERE]** row 34 plants a clean-import setter/callback injection and requires the injected symbol to be named; an immutable plain-data constant is its green neighbour.
- **[MEASURED HERE]** matrix rows are unique and contiguous `1..35`: 34 mutations plus one clean control.
- **[MEASURED HERE]** the captured-reference words remain in requirement 4 and row 26. The promise was strengthened rather than deleted.

## F-1 — the expanded promise/catcher map is incomplete again

Requirement 1b newly promises rejection of all of these classes:

- setter/configuration exports;
- mutable module bindings, caches, singletons, and lazy holders;
- callback/function/thunk/accessor-bearing runtime inputs;
- `globalThis`, environment reads, and other free/captured references.

The proof matrix contains one new mutation: setter/callback injection with a clean import graph. I parsed the matrix itself. It contains **zero** occurrences of `globalThis`, environment access, accessor input, function-valued input, thunk, cache, or singleton. The only new witness is the setter/callback row.

So the exact law the revision cites—*no promise may exist without a matching catcher*—still fails for the newly added promises. One example cannot stand in for multiple decision mechanisms merely because they share the phrase “closed surface.”

At minimum, the design needs separate mutation cases for:

1. direct `globalThis` access with a clean import graph;
2. direct `process.env`/environment access with a clean import graph;
3. a mutable module-local cache or lazy holder with no setter export;
4. a runtime lane object carrying a function-valued field;
5. a runtime lane object carrying a getter/accessor that would execute if read.

These may be subcases under one numbered matrix row if their expected catcher and result are enumerated. They must not be implied by the setter case.

## F-2 — source topology and runtime value shape require different enforcement layers

The selected mechanism is described as a build-time dependency/AST rule. That is suitable for source properties: imports, exports, module declarations, syntactic globals, and free references.

It cannot prove a value received at runtime is plain data. TypeScript structural typing admits objects with extra methods and getters. A getter can run when a property is read even though the projection module has no imports, no mutable state, and no forbidden source references.

```ts
const lane = Object.defineProperty({}, "bindings", {
  enumerable: true,
  get() {
    return readExpectationFromElsewhere();
  },
});
project(lane as Lane);
```

The source AST of `project` remains clean. The dangerous behavior lives in the input object's property descriptor. Therefore the design must name a runtime boundary check distinct from the source checker.

The sound split is:

- **build-time TypeScript-compiler-API rule:** resolve the real module graph and reject forbidden imports/exports, mutable module state, direct `globalThis`/environment references, dynamic import/require/eval, and unallowlisted free references;
- **runtime plain-data validator before projection:** walk own property descriptors without reading getter values; reject getters/setters, function values, methods, thunks, non-plain prototypes, symbol keys, cycles, and unknown/missing schema keys; only then copy the admitted values into a fresh plain-data record passed to `project`.

The runtime validator needs a red-proof where the getter carries a marker or throws if invoked. Required result: the validator rejects the descriptor, names the path, and the getter marker remains untouched. That proves the guard did not execute the capability while trying to inspect it.

## F-3 — `globalThis` and environment wording now states both sides without defining the boundary

The chosen-contract paragraph still says a determined module can read the ledger through `globalThis` or an environment variable. Four lines later the design says those same channels are now “promised AND caught.” Those statements can coexist only if the boundary is stated precisely:

- direct syntactic references are caught by the source rule;
- adversarial obfuscation/reflection remains outside the non-adversarial threat model.

Write that distinction. Otherwise “caught” reads as a sandbox claim the document explicitly disavows. Name the AST implementation as a real parser—TypeScript compiler API or equivalent parser services—not a regex scanner. This campaign already demonstrated that text scanning is not a JS/TS capability analyser.

## EVIDENCE INDEPENDENTLY CHECKED

- Verified worker commit, parent, exact changed paths, design blob, and SHA-256. Only the design and worker report changed.
- Read all five closed-surface rows and the selected enforcement paragraph together.
- Parsed the mutation matrix independently: 35 unique contiguous numbered rows, no gaps or duplicates.
- Counted the catcher vocabulary in the matrix: `setter=1`, `callback=1`; `globalThis=0`, `environment=0`, `accessor=0`, `function-valued=0`, `thunk=0`, `cache=0`, `singleton=0`.
- Constructed the accessor-bearing input counterexample against the specified boundary. It leaves the projection module's imports, exports, module state, and free references unchanged; only the runtime value carries the behavior.
- Re-checked the prior nine-cell runtime correction is untouched by this design-only diff. No pinned lane file changed.

## TESTS RERUN

- Matrix parser: rows `1..35`, count `35`, unique `35`, missing `[]`, duplicates `[]`.
- Promise/catcher census over the matrix: only setter/callback is represented among the newly forbidden non-import channels.
- Carrier search: zero live `module OR process` choice; historical rejection text remains and is correctly scoped.
- Git object check: delivery changes exactly `P0-VNEXT-DESIGN-2026-08-01.md` plus `AGENT-REPORTS.md`.

## ARCHITECTURE INVARIANTS TOUCHED

- Static source topology and runtime data shape are different trust boundaries.
- A guard must inspect accessors without invoking them.
- Every promised denied channel needs a matching red-proof and a green neighbour.
- A non-adversarial source rule is not a sandbox; direct syntax rejection must not be described as universal unreachability.

## FAILED OR UNPROVEN CONDITIONS

- Four newly promised channel classes have no matching matrix witness.
- No runtime input-admission mechanism is specified; build-time AST cannot enforce accessor-free input values.
- The direct-syntax versus adversarial-bypass boundary for `globalThis` and environment access is not stated.
- No P0-vNext implementation, executed mutation suite, CI run, current Surface-B population, or authority-semantic verification exists. `33/33` remains design-text evidence.

## REQUIRED CORRECTIONS

1. Split requirement 1b into a build-time source contract and a runtime input-admission contract, naming the mechanism for each.
2. Use a real TypeScript parser/compiler API for the source contract; do not revive regex capability analysis.
3. Add explicit red-proofs for direct globals/environment, mutable cache/lazy state, function-valued input, and getter/accessor input. A grouped row is acceptable only if every subcase and catcher is enumerated.
4. For the getter case, prove rejection occurs without invoking the getter.
5. Narrow “promised AND caught” to direct syntactic channels; keep adversarial obfuscation outside the stated threat model.
6. Re-parse the matrix and the promise/catcher map after the edit.

## FILES / SCOPE ALLOWED

Design-only: `docs/designs/P0-VNEXT-DESIGN-2026-08-01.md` plus the normal worker report. Blueprint remains out of scope. No implementation, pinned-lane edits, ledger/oracle/census writes, engine/runtime/extraction/DB work, grade, merge, deployment, Phase-1 profile, Surface B, P3, or Gate B.

## ACCEPTANCE COMMANDS / OBSERVABLES

1. Print two separate closed contracts: source-time AST/dependency rules and runtime value-admission rules.
2. Map every forbidden channel to at least one named mutation and catcher; the bidirectional difference is empty.
3. Pre-register the getter fixture and marker. Expected result: named runtime rejection, getter invocation count `0`, clean plain object green.
4. Pre-register direct `globalThis`, environment, and mutable-cache source mutations; each must name the offending symbol/path while a clean immutable constant stays green.
5. State parser technology and module-resolution semantics explicitly.
6. Matrix rows remain contiguous with exactly one unmutated clean control; grouped subcases are counted honestly.

## STOP CONDITION

Stop if a build-time AST result is used to certify a runtime object's property descriptors. Stop if any newly forbidden channel lacks a catcher. Stop if direct-syntax detection is described as hostile-code isolation.

## LESSON TO PERSIST

> **Source topology is not runtime value shape.**

> **A getter can carry authority through a zero-import module.**

> **When a promise expands, the catcher set must expand in the same edit.**

**Authorized next action:** revise this single design boundary now in the existing worker seat, then return one design-only receipt. Implementation, grading, merge, deployment, Phase-1 profile, Surface B, P3, and Gate B remain blocked.
