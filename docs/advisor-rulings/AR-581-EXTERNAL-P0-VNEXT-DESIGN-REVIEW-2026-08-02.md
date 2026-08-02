# External GPT review — `P0-vNext` design after `AR-581`

**Reviewed object:** worker delivery commit `ef1c85d61d672b5f96075096b7694c1b48f4d333`; parent `a016a98fd26e2bedddd5fd37dfe8d659efa9eb2f`; design blob `ed9a2ce45bdd99475627623c2502408f5f42ee69`; working-file SHA-256 `1299FA07B2F840680A6DAFDA97C159E462036FD2C5528C24C659B80A88E8CC6B`. The working design is byte-identical to the reviewed commit.

**Newest worker report read before publication:** `AR-581` (`AR-580` is its start receipt).

**RULING ID / TASK ID / DECISION:** external review of `AR-581` · **REVISE**. The closed runtime grammar, descriptor-first traversal, symbol-visible enumeration, active-path cycle policy, and grammar-derived denominator are substantial improvements. The matrix really is `47 + 1 = 48`, and the three runtime observations behind the new design reproduce independently. But the carrier and completeness defects recur one level above the repair: the operative `4b` list that says **“EVERY CHANNEL”** omits the three new catcher rows; and the `34`-atom map proves that labels have row numbers, not that every promised subcase has an executed mutation. The build-time deep-freeze promise also still names a semantic property without defining the source grammar by which a parser can decide it. No implementation or grade yet.

## CLAIMS VERIFIED (and how)

- **[MEASURED HERE, exact reviewed blob]** `1b-R` now defines a finite JSON-like grammar: `null`, boolean, finite number, string, dense arrays, and plain/null-prototype objects; unsupported values fail closed by name.
- **[MEASURED HERE]** safe traversal names descriptor-first inspection, `Reflect.ownKeys`, recursive prototype identity, and an active-path set released on unwind.
- **[MEASURED HERE, independent Node execution]** string-key enumeration misses a symbol-keyed function while `Reflect.ownKeys` sees it; naïve recursion over a self-cycle throws `RangeError`; the active-path walk names the cycle and remains green on a legitimate shared-object DAG.
- **[MEASURED HERE]** the matrix section parses to 48 unique, contiguous rows `1..48`, with row 48 last as the clean control.
- **[MEASURED HERE]** the displayed promise population increased from 10 to 34 and rows 45–47 were added rather than narrowing the grammar.

## F-1 — the newly added runtime channels did not reach the operative “EVERY CHANNEL” carrier

The detailed grammar and rows 45–47 are present. But the live `4b` red-proof sentence at design line 201 says it lists **“EVERY CHANNEL THE COMPOSITE WALK CLAIMS TO DENY”** and names only:

- function-valued fields — row 39;
- accessors — row 40;
- prototype-borne capability — row 42;
- symbol-keyed capability — row 44;
- cycles — row 43.

An anchored comparison against runtime catcher rows `39, 40, 42–47` returned:

```text
39=true 40=true 42=true 43=true 44=true 45=false 46=false 47=false
OMITTED=45,46,47
```

Those omissions are the unsupported value classes, sparse/extra-property arrays, and non-enumerable fields—the exact four promise channels that the new denominator surfaced. This is not merely a shorter summary: its own quantifier is “EVERY CHANNEL,” and R-536’s carrier law was the task being closed.

There is also a concrete join error in line 210: it says symbol keys are caught by row `45`, then correctly cites row `44` later in the same sentence. Row 45 is the non-conforming **value-class** row; row 44 is the symbol-**key** row. A row citation is an implementation instruction and must be singular.

## F-2 — `34 atoms → rows` is not yet `34 atoms → executed subcases`

Deriving the forward population from the contract is the right correction. The displayed map, however, still maps many distinct promises to one broad row without requiring that row to instantiate every promise. The design already understands this distinction for rows 45 and 46, which explicitly require every grouped subcase to run independently. The `1b-S` half does not yet apply the same rule.

Examples from the reviewed blob:

- The source contract forbids `globalThis`, `window`, `process`, `process.env`, and **any host-global identifier not in the allow-list**. Row 35 plants only `globalThis`; row 36 plants only `process.env`. On this exact Node host, `global` is a live alias of `globalThis` (`typeof global === "object"`, `global === globalThis`), but no matrix subcase plants it or a generic unallowlisted free host global.
- The dynamic-loading contract lists `import()`, `require`, `eval`, `new Function`, `createRequire`, and runtime-resolved module names. Row 41 names only `eval`, `new Function`, and computed `require`; the red-proof prose separately mentions dynamic `import()` but still does not turn the full set into independently scored subcases.
- The export contract forbids setter/configuration exports, every function-valued export other than `project`, and every export that mutates module state. Row 34 plants one setter/callback shape. A row label mapped to three promises does not demonstrate three catchers.

Therefore the empty difference is stronger than AR-579’s hand-picked 10-label result, but it still proves **mapping coverage**, not **mutation coverage**. A row number is not a catcher for an atom until the exact atom is planted and the named check catches it. Otherwise one representative can certify an entire category it never exercised.

## F-3 — `1b-S` still has a semantic promise without a decidable source grammar

The design correctly requires the source parser to decide **deep** frozen-ness and plain-data-ness, and row 38 correctly defeats top-level `Object.isFrozen`. But “DEEPLY-FROZEN plain-data constant” is a runtime property, while `1b-S` explicitly says nothing runs. The design does not yet state the closed source syntax from which the TypeScript AST can prove that property.

This leaves multiple incompatible implementations apparently compliant:

- allow only primitive literals;
- allow recursive object/array literals only when every container is syntactically wrapped in `Object.freeze`;
- trust a call such as `deepFreeze(value)` without evaluating its implementation;
- reject all composite constants, making the green neighbour impossible.

The parser choice is a mechanism class, not the decision procedure. Specify the admitted constant syntax and alias/reference rules. The smallest sound version is: primitive literals plus recursively literal object/array trees whose every container is syntactically frozen; no calls, spreads, computed keys, post-declaration writes, or unresolved aliases. If a helper call is to be admitted, it needs a separately pinned and verified construction rule. Red-proof shallow nested freeze, helper-returned data, spread/alias escape, and a valid recursively frozen neighbour.

## EVIDENCE INDEPENDENTLY CHECKED

- Verified the exact commit, parent, design blob, clean equality of working file to commit, and SHA-256.
- Re-ran a section-anchored matrix parser: count `48`, IDs `1..48`, no gaps, no duplicates, control last.
- Re-ran independent Node probes for symbol enumeration, cycle termination, active-path DAG acceptance, and the Node `global` alias.
- Compared the detailed runtime grammar, the operative `4b` “EVERY CHANNEL” carrier, rows 39–47, the promise/catcher map, and the `1b-S` allowed/forbidden table as one joined surface.

## TESTS RERUN (command/result)

- Matrix parser over `## 10`: `48` rows; missing `[]`; duplicates `[]`; row 48 last.
- Symbol probe: `Object.keys(descriptors) = ["id"]`; `Reflect.ownKeys(descriptors) = ["id", "Symbol(ledgerRead)"]`.
- Cycle probe: naïve walk `RangeError`; active-path walk `cycle:$.self`; shared DAG `[]`.
- Carrier comparison: runtime rows 45, 46, and 47 absent from the sentence claiming to list every `4b` channel.
- Host-global probe: Node exposes `global`, and `global === globalThis` is `true`.

## ARCHITECTURE INVARIANTS TOUCHED

- A closed grammar needs catcher coverage at the same granularity as its productions and forbidden alternatives.
- A live summary with a universal quantifier is an implementation contract, not explanatory prose.
- Static parsing can prove only a closed source syntax; naming a semantic property does not define its AST decision procedure.
- Promise→row membership and promise→executed mutation are different joins.

## FAILED OR UNPROVEN CONDITIONS

- The operative `4b` channel list omits rows 45–47.
- The symbol-key row is cited inconsistently as both 45 and 44.
- The 34-atom result has no durable atom→concrete-mutation→catcher manifest; several `1b-S` atoms are represented only by broader exemplar rows.
- The AST rule for deep-frozen constants has no exact admitted syntax or alias policy.
- No P0-vNext implementation, repo mutation run, CI execution, authority-semantic verification, current Surface-B population, or Phase-1 profile exists. `37/37` remains design-text evidence and scratch mechanism probes.

## REQUIRED CORRECTIONS

1. Update every live `4b` red-proof carrier to include unsupported values, array-shape violations, and non-enumerable fields; correct the symbol-key citation to row 44 only.
2. Replace the prose-only `34 → row` map with a structured atom manifest. Every atom must point to a concrete mutation subcase and named catcher; a many-to-one row is admissible only when that row explicitly runs and reports every subcase independently, as rows 45–46 already require.
3. Expand `1b-S` subcases for the full promised classes, including a generic unallowlisted host global/free identifier, all dynamic-load forms, and the distinct forbidden export/state forms—or narrow the promise before implementation if a class is intentionally outside the threat model.
4. Define a closed AST grammar for admitted module-scope constants, including reference/alias, call, spread, computed-key, and recursive-freeze rules. Add a valid positive neighbour and mutations that distinguish shallow freeze from the admitted form.
5. Recompute the promise/catcher result from atom→mutation records, not atom→row labels, then re-run the anchored carrier and matrix census.

## FILES / SCOPE ALLOWED

Design-only: `docs/designs/P0-VNEXT-DESIGN-2026-08-01.md` and the normal worker report. Blueprint remains out. No implementation, pinned-lane edit, ledger/oracle/census write, engine/runtime/extraction/DB work, grade, merge, deployment, Phase-1 profile, Surface B, P3, or Gate B.

## ACCEPTANCE COMMANDS

1. Anchored carrier check: every live `4b` universal list names rows 39, 40, 42–47; symbol-key citations resolve only to row 44.
2. Emit the structured atom manifest and assert bidirectionally: grammar/source atom ↔ concrete mutation subcase ↔ named catcher. Plant one unmapped atom and prove the check goes red; delete one subcase and prove it goes red.
3. Execute each grouped `1b-S` subcase independently with its green neighbour; include `global` or another unallowlisted host-global alias as a novel direct-syntax case.
4. Print the exact admitted `1b-S` constant grammar. Run a valid recursive-frozen constant green, shallow nested freeze red, and at least one call/spread/alias escape red.
5. Re-parse `## 10`: contiguous IDs, zero duplicates, one final clean control; publish both anchored and unanchored counts.

## STOP CONDITION

Stop if an “EVERY” carrier omits any grammar-derived atom. Stop if an atom is considered caught merely because it shares a row number with an exercised neighbour. Stop if the parser is asked to infer deep frozen-ness from an unspecified semantic notion rather than a closed source form. Stop if the grammar is narrowed to make the map empty.

## LESSON TO PERSIST

> **A row number is not a catcher until the exact promise atom has been planted.**

> **A semantic property is not a static rule until its admitted syntax is closed.**

**Authorized next action:** one final design-only carrier/subcase/static-grammar closure pass in the currently authorized worker seat. First observable: the corrected `4b` carrier plus the structured atom→mutation manifest, approximately 20–30 minutes. Implementation, grading, merge, deployment, Phase-1 profile, Surface B, P3, and Gate B remain blocked.
