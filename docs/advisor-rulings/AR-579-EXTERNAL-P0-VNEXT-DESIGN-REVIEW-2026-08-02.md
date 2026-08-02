# External GPT review — `P0-vNext` design after `AR-579`

**Reviewed object:** worker delivery commit `1dc40de856002d1d52043ce1209d810fa31442ee`; design blob `5a3619b23d86f9a1f2d7cb5ef8044273a3b7814a`, working-file SHA-256 `29FAC0DD6E9D681EB4310EB959F2CEDB6E087D9F922C6511D7380EBD71432CF7`.

**Newest worker report read before publication:** `AR-579` (`AR-578` is its start receipt).

**RULING ID / TASK ID / DECISION:** external review of `AR-579` · **REVISE**. The source/runtime enforcement split is correct, the real parser choice is sound, and the prototype-borne capability repair is independently reproducible. The repair is not yet carried through every operative summary: three live clauses still describe the descriptor walk as the whole runtime mechanism and omit the prototype check that AR-579 proves indispensable. Separately, “plain data, recursively” is not yet a closed runtime grammar; an unhandled cycle can hang the validator and symbol/non-enumerable keys can escape an ordinary descriptor-object enumeration. Implementation and grade remain blocked for one final runtime-validator closure pass.

## CLAIMS VERIFIED

- **[MEASURED HERE, exact design blob]** requirement 1b is split into `1b-S` source-time and `1b-R` runtime contracts with separate results.
- **[MEASURED HERE]** `1b-S` names a real TypeScript parser/compiler API and explicitly forbids regex capability analysis.
- **[MEASURED HERE, independent Node execution]** `Object.getOwnPropertyDescriptors(new Lane())` and the same call on an `Object.create(protoGetter)` child both return no own capability; the prototype remains reachable. The recursive prototype-identity rule distinguishes the invalid objects without invoking the getter.
- **[MEASURED HERE]** `Object.freeze` is shallow: the root is frozen while its nested holder remains writable.
- **[MEASURED HERE]** rows `1..43` are unique and contiguous: 42 mutations plus one clean control.
- **[MEASURED HERE]** the promise/catcher table names 10 capability classes and 10 rows, and its two displayed differences are empty.

## F-1 — the prototype catcher did not reach three operative summaries

The detailed `1b-R` clause correctly requires **two** checks:

1. own-property descriptor walk; and
2. recursive prototype-identity validation.

Row 42 then demonstrates why the second is load-bearing. But later live clauses regress to descriptor-only wording:

- requirement 4b says `1b-R` is a “descriptor walk” and lists only accessor/function-valued fields;
- the chosen capability summary says the second layer is “a runtime descriptor walk”;
- the `4b` red-proof summary lists only function-valued input and getter/accessor input;
- the next paragraph calls `Object.getOwnPropertyDescriptors` the **sole admitted** inspection mechanism for `4b`.

Those are operative implementation carriers, not historical prose. A builder following the summary can omit prototype validation and still claim compliance, despite row 42 proving that implementation false-green.

Required repair: every live summary must name the composite runtime validator—**own descriptors plus recursive prototype identity**. “Sole admitted” may apply only to own-descriptor inspection; it may not describe the whole `1b-R` mechanism. Add prototype-borne input to the `4b` summary and red-proof list.

## F-2 — “plain data, recursively” is still an open grammar

The allowed runtime set is currently stated as string, number, boolean, null, array, and plain object, recursively. That does not yet decide several values the validator must encounter:

- a self-cycle or mutual cycle made entirely of plain objects;
- repeated object identity in an acyclic DAG;
- symbol keys;
- non-enumerable data properties;
- `undefined`, bigint, symbol, `NaN`, or infinity values;
- sparse arrays and extra named array properties.

This matters mechanically, not stylistically. A naïve recursive walk loops or overflows on a cycle. `Object.getOwnPropertyDescriptors()` does return symbol descriptors, but iterating the returned descriptor object with `Object.keys`/`Object.entries` omits them. I independently measured that split: `Reflect.ownKeys(descriptors)` saw the planted symbol while `Object.keys(descriptors)` did not.

Define one exact admitted grammar. The cleanest contract is a finite JSON-like tree:

- leaves: `null`, boolean, finite number, string;
- containers: arrays and plain/null-prototype objects only;
- own enumerable string-keyed data descriptors only;
- no accessors, functions, symbols, non-enumerable user fields, unsupported primitives, custom prototypes, or cycles;
- array `length` is the sole admitted non-enumerable built-in descriptor; decide sparse holes and extra named keys explicitly.

Use an iterative or recursion-stack traversal with a `WeakSet`/active-path set. Reject a cycle with a named path and non-zero result rather than hanging. If shared acyclic identity is allowed, use an active-path set rather than a permanent visited-set rejection; if it is forbidden, say so and test it.

The validator must enumerate descriptors with `Reflect.ownKeys(Object.getOwnPropertyDescriptors(v))` or an equivalent that sees symbols, then inspect `descriptor.value`; it must never read `v[key]` before the descriptor is admitted.

## F-3 — the promise/catcher “empty” result is bounded by its hand-classified vocabulary

The displayed 10↔10 map is internally consistent, but it is not exhaustive over the broad promise “plain data only.” Cycle termination, symbol keys, unsupported primitives, and descriptor enumerability are absent from both the map and matrix.

This is not a reason to discard the map. It is a reason to make its population explicit: derive runtime promise atoms from the closed grammar, not only from ten prose labels. Then compare those atoms bidirectionally to matrix subcases. The current empty difference proves consistency of the selected ten labels, not completeness of the runtime contract.

## EVIDENCE INDEPENDENTLY CHECKED

- Verified worker commit, parent, exact changed paths, design blob, and SHA-256. The delivery changes only the design and worker report.
- Executed independent Node probes: own descriptors miss prototype methods and inherited getters; prototype identity rejects both with getter invocation count zero; plain object, null-prototype object, and array prototypes are distinguishable.
- Measured descriptor enumeration: a symbol-keyed capability is present in `Reflect.ownKeys(Object.getOwnPropertyDescriptors(v))` and absent from `Object.keys(...)`.
- Measured shallow freeze: top-level frozen `true`, nested frozen `false`.
- Parsed the matrix anchored to `## 10`: 43 unique contiguous rows, no gaps or duplicates.
- Read detailed `1b-R`, requirement 4b, the chosen-contract summary, the `4b` red-proof paragraph, row 42, and the promise/catcher map as one carrier set.

## TESTS RERUN

- Node prototype/accessor probe: class own descriptors `[]`; inherited-getter child own descriptors `[]`; getter invocations during safe inspection `0`; both prototypes outside the allowlist.
- Node descriptor-key probe: string-only enumeration omitted a planted symbol; `Reflect.ownKeys` named it.
- Node freeze probe: shallow root frozen, nested holder mutable.
- Matrix parser: rows `1..43`, count `43`, unique `43`, missing `[]`, duplicates `[]`.

## ARCHITECTURE INVARIANTS TOUCHED

- A detailed requirement and its operative summaries must describe the same enforcement mechanism.
- Own-property safety and prototype-chain safety are separate checks.
- A recursive validator must define termination, key enumeration, and the exact admitted value grammar.
- A promise/catcher map is exhaustive only over a named, closed promise population.

## FAILED OR UNPROVEN CONDITIONS

- Three live carriers still permit descriptor-only `1b-R` implementation.
- The runtime input grammar does not define cycles, symbols, non-enumerable fields, unsupported primitives, or array edge cases.
- No mutation proves cycle rejection/termination or symbol-key visibility.
- The 10↔10 empty map is complete only for its hand-selected vocabulary.
- No P0-vNext implementation, executed repo mutation suite, CI run, current Surface-B population, or authority-semantic verification exists. `30/30` remains design-text evidence plus scratch mechanism probes.

## REQUIRED CORRECTIONS

1. Carry the composite descriptor-plus-prototype mechanism into requirement 4b, the chosen-contract summary, the `4b` red-proof list, and the “sole admitted” wording.
2. Define the exact finite runtime plain-data grammar, including number rules, symbols, enumerability, arrays, shared identity, and cycles.
3. Specify safe traversal: descriptor-first, symbol-visible enumeration, prototype check, and explicit cycle handling before `project` reads any field.
4. Add red-proofs for a cycle and a symbol-keyed/function capability; each must name the path and terminate without invoking the capability. Add the corresponding clean neighbours.
5. Derive the runtime promise atoms from the grammar and rerun the bidirectional promise/catcher comparison.
6. Re-parse all operative carriers and the matrix after the edit.

## FILES / SCOPE ALLOWED

Design-only: `docs/designs/P0-VNEXT-DESIGN-2026-08-01.md` plus the normal worker report. Blueprint remains out of scope. No implementation, pinned-lane edits, ledger/oracle/census writes, engine/runtime/extraction/DB work, grade, merge, deployment, Phase-1 profile, Surface B, P3, or Gate B.

## ACCEPTANCE COMMANDS / OBSERVABLES

1. Search all live `1b-R` carriers: each names both descriptors and prototype identity; no whole-contract “descriptor-only” or “sole mechanism” statement remains.
2. Print the admitted runtime grammar as a closed table and derive its promise atoms mechanically.
3. Cycle fixture: named rejection, non-zero result, bounded completion; clean acyclic neighbour green.
4. Symbol-keyed function fixture: named rejection before invocation; `Reflect.ownKeys` witness present and `Object.keys` negative control absent; clean string-keyed data neighbour green.
5. Getter and prototype fixtures retain invocation count zero.
6. Promise/catcher differences remain empty over the expanded, grammar-derived population; matrix rows remain contiguous with one unmutated control.

## STOP CONDITION

Stop if any live summary permits descriptor-only runtime admission. Stop if recursive validation has no explicit cycle policy. Stop if string-key enumeration is used to certify a symbol-free object. Stop if the promise population is selected from the catcher table itself.

## LESSON TO PERSIST

> **An own-descriptor walk is not a prototype check.**

> **A recursive contract without a cycle rule is an unbounded program, not a closed schema.**

> **A descriptor exists even when string-key enumeration cannot see it.**

**Authorized next action:** revise this single runtime-validator boundary now in the existing worker seat, then return one design-only receipt. Implementation, grading, merge, deployment, Phase-1 profile, Surface B, P3, and Gate B remain blocked.
