# External advisor ruling — AR-588 / P0-vNext prototype pivot

**RULING ID / TASK ID:** external AR-588 review / campaign AR-588

**Object reviewed:** campaign commit `06842e21d88d38970c345b57056ecd3c45fcfc2f`; design blob `a5ca03237eb5f9fd5977315c9ed3617e08ab021c`

**DECISION:** **APPROVE the executable-prototype pivot; REVISE item 0's effective-module contract before any coverage result is admitted. The worker may continue the isolated prototype.**

## CLAIMS VERIFIED

- `[MEASURED HERE]` The CommonJS wrapper channel is real. In an actual Node CommonJS wrapper, an external property written through the module export object changed `project()` from baseline `1` to injected value `2`; a deeply frozen sibling constant remained frozen.
- `[MEASURED HERE]` Actual Node ESM reports top-level `typeof this === "undefined"`.
- `[MEASURED HERE]` The AR-588 design delta adds a module-system surface, a dedicated wrapper-`this` mutation, and an ESM clean neighbour.
- `[MEASURED HERE]` The section-bounded matrix is contiguous `1..55`, `55` unique rows, control last; the corresponding unanchored row shape is `60`; the plantable manifest contains `52` records.
- The pivot from further prose-only closure to an isolated executable prototype is architecturally correct. A prototype can measure named misses that another prose pass cannot.

## EVIDENCE INDEPENDENTLY CHECKED

I independently compiled the same TypeScript source twice with the installed TypeScript compiler API. `compilerOptions.module = CommonJS` emitted `exports.project` and CommonJS scaffolding; `compilerOptions.module = ESNext` emitted an ESM export. The package-level string `"type": "module"` was not an input to that compilation. This is the join AR-588 currently leaves implicit: **source extension/package loader configuration and TypeScript emit configuration are separate inputs to effective module semantics.**

## TESTS RERUN

1. Node CommonJS wrapper probe: baseline `1`; injected `2`; frozen constant stayed frozen.
2. `node --input-type=module`: top-level `this` was `undefined`.
3. Local TypeScript compiler API: CommonJS and ESNext options emitted different module systems from the same source.
4. Section-anchored design census: `55/55`, range `1..55`, unique `55`; unanchored `60`; manifest `52`.

One first probe was discarded: Windows' `node -e` argument path removed quotes from my embedded fixture and caused a `ReferenceError`. I re-ran through a simpler actual wrapper probe. That failed instrument is not evidence about AR-588.

## ARCHITECTURE INVARIANTS TOUCHED

- P0 is still an instrument prerequisite, not Phase-1 exit and not a trading-ready strategy.
- The prototype remains separated from the ledger, `ORACLE.json`, Gate B, claims, registry, runtime and capital paths.
- Module-system closure is a build-and-loader property. A prose label is neither an emitted module nor a runtime loader decision.
- Mutation validity and diagnostic ownership remain binding from the AR-587 external review.

## FAILED OR UNPROVEN CONDITIONS

1. **The sentence “`.ts` compiled under `"type": "module"`” is incomplete.** `"type"` belongs to Node package loading; TypeScript emit is controlled independently by `compilerOptions.module` and related resolution/output settings.
2. **“Closes the channel by construction rather than by a check” is premature.** Item 0 is a design edit. Row 54 itself requires a module-system catcher. Closure exists only when the effective emitted artifact is enforced as ESM and executed through the intended loader.
3. Rows 35, 36 and 41 still lack a content-pinned compiler/ambient-declaration surface and single-catcher precedence. The prototype may report these as honest named misses; it may not count parse/type/reference failures as coverage.
4. No prototype code or result artifact existed in AR-588, so no implementation coverage is approved here.

## REQUIRED CORRECTIONS

Before publishing the prototype coverage number:

1. Replace the shorthand module rule with an **effective-module tuple**: TypeScript version; `compilerOptions.module`; `moduleResolution`; source/output extensions; nearest package `type`; and the emitted artifact/loader command.
2. Hash or otherwise content-pin that tuple in the prototype result artifact.
3. Make row 54 assert all three facts: the CJS twin is rejected by the module-system catcher; the ESM twin is green; token/ambient catchers remain silent.
4. Execute the emitted ESM twin, not only the TypeScript source, and assert top-level `this` is unavailable there.
5. Preserve honest misses for rows whose compiler declarations or catcher ownership are not yet defined. Do not repair the expected result after observing the prototype.

## FILES / SCOPE ALLOWED

The AR-588 design file, one new isolated prototype directory, its runner/fixtures, and one committed result artifact. The gate, three claims, scope registry, ledger/oracle consumers, Gate B, P1/P2 artifacts, runtime, DB, extraction and live-capital paths remain out.

## ACCEPTANCE COMMANDS

- Run the CJS G-1 fixture and its emitted ESM twin; assert catcher identity and exit codes, not captions.
- Print and pin the effective-module tuple and the hash of every ambient declaration/compiler option surface used.
- Run all 52 manifest records per subcase, reporting primary catcher or honest named miss.
- Assert zero reads of the membership ledger and `ORACLE.json` with a positive witness that the read detector can detect a planted read.
- Re-run the clean prototype after every transient mutation and prove restoration functionally.

## STOP CONDITION

Stop if any source is classified as ESM solely because it is `.ts` or because a package says `"type": "module"`; if any row receives coverage credit from a parse/type/reference error; if two catchers claim primary ownership of the same mutation; or if the prototype reads an expectation artifact.

## AUTHORIZED NEXT ACTION

Continue the isolated `1b-S` / `1b-R` prototype under R-541. Incorporate the effective-module tuple before the first coverage artifact is committed. The first observable remains the G-1 CJS rejection plus emitted-ESM green neighbour; named misses are an acceptable and expected result.

## LESSON TO PERSIST

**A module system is not a source-file caption. It is the joined result of compiler emit and runtime loading. “By construction” begins only after both halves are pinned and exercised.**

**Newest AR checked before write:** AR-588 is the newest report on disk and directly governs this ruling.
