# External GPT review — `P0-vNext` design after `AR-583`

**Reviewed object:** worker delivery commit `6bdb2e5994e91aeddb08eb2ca885159d21b99100`; parent `3b70d6dfb6be7c7b8057055f0da186d411067fc0`; design blob `e285449694d70390e0412983a60054f2823e9434`; working-file SHA-256 `1B2ABD0DB1BF24A06CD6C160D29E225351DF59F2FEA004B7FEFB3E29A9CF4E1C`. The working design is identical to the reviewed commit.

**Newest worker report read before publication:** `AR-583` (`AR-582` is its start receipt).

**RULING ID / TASK ID / DECISION:** external review of `AR-583` · **REVISE**. The prior six corrections are genuinely present: line 210 now cites row 44 only; the 39-record manifest is explicitly pre-registered rather than called executed coverage; grouped rows enumerate their subcases; the AST constant grammar is closed syntactically; and the matrix is `49 + 1 = 50`. The next boundary is the authority of that syntax: the design invokes an unspecified allow-list while its own admitted grammar requires a host global, and the literal grammar admits two JavaScript forms whose runtime meaning is not the syntax it claims—shadowed `Object.freeze` and special `__proto__` properties. These are design-time false-green paths, so implementation and grade remain blocked for one narrow source-grammar closure pass.

## CLAIMS VERIFIED (and how)

- **[MEASURED HERE, exact blob]** the `4b` universal carrier now names unsupported values, array-shape violations, and non-enumerable fields.
- **[MEASURED HERE]** line 210 cites row 44 only; rows 44 and 45 retain their distinct symbol-key/symbol-value meanings.
- **[MEASURED HERE]** the atom manifest contains 39 atom→plantable-subcase→catcher records and labels itself `[PRE-REGISTERED — NOT EXECUTED]`.
- **[MEASURED HERE]** rows 26, 34, 35, 37, 41, 45, 46, and 49 enumerate their many-to-one subcases.
- **[MEASURED HERE]** the matrix parses to 50 unique contiguous rows `1..50`, with row 50 last as the clean control.
- **[MEASURED HERE]** the AST grammar admits only primitives or recursively wrapped `Object.freeze` object/array literals and forbids calls, aliases, spreads, computed keys, accessors, functions, `new`, and expression templates.

## F-1 — the allow-list that decides the source contract is not defined

The source table says:

- imports prefer none, but otherwise permit an “enumerated, frozen allow-list”;
- ambient reads allow “nothing,” while forbidding host globals not in “the allow-list”;
- green controls include an “allow-listed pure helper import.”

No import allow-list, host-global allow-list, canonical module-identity rule, or digest is enumerated anywhere in the design. More importantly, the new admitted constant grammar requires the expression `Object.freeze(...)`. On this host, independently measured, `Object === globalThis.Object`; `Object` is itself an ambient global. Therefore one of two incompatible readings must be true:

1. ambient reads really allow nothing, in which case every valid recursively frozen composite constant is rejected; or
2. the intrinsic `Object.freeze` is allowed, in which case “nothing” is false and the missing allow-list is load-bearing.

The same gap exists for imports: “preferred zero-import” and “otherwise allow-listed helper” are still a menu, not one chosen contract. An atom called `unallowlisted import` or `unallowlisted host-global` has no decidable membership until the allowed set and canonical identity are frozen. This is the denominator problem recurring on the **allowed** side rather than the forbidden side.

Required design decision: choose the zero-import leaf for this module, or publish the exact canonical import allow-list and transitive-resolution rules. Separately publish the exact ambient intrinsic allow-list. The minimum viable ambient list appears to be the intrinsic `Object.freeze` binding only; it must be resolved by TypeScript symbol identity, not by the text `Object.freeze`.

## F-2 — the new AST grammar matches spelling, not JavaScript meaning, on two forms

### Shadowed `Object.freeze`

The production accepts the literal spelling `Object.freeze(ObjLit|ArrLit)`, but does not require `Object`/`freeze` to resolve to the intrinsic global binding. I executed the same shape with a shadowing object:

```js
const Object = { freeze: x => x };
const C = Object.freeze({ slot: {} });
C.slot.injected = "LEAK";
```

Measured result: the root is **not frozen** and the nested write succeeds. A syntax-only matcher accepts the form while the promised property is false. The TypeScript checker can close this by resolving the callee symbol to the intrinsic `ObjectConstructor.freeze` declaration and rejecting any local/imported/aliased/shadowed binding. That exact false-green needs a pre-registered subcase and catcher.

### Special `__proto__` object-literal keys

`ObjLit := { (Ident | StringLit): Frozen }` admits both `__proto__:` and `"__proto__":`. In JavaScript object-literal initializers, those are special prototype setters rather than ordinary own data properties. I executed both forms inside the admitted recursive-freeze shape. In both cases:

- `Reflect.ownKeys(result)` was empty;
- `Object.getPrototypeOf(result)` was the supplied frozen object;
- data on that custom prototype was reachable by ordinary lookup;
- the root and supplied prototype were both frozen.

Thus the grammar can certify an object as a literal own-data graph while the runtime object has a custom prototype and inherited data. This violates the design’s own plain-data/prototype discipline without using a spread, alias, call helper, computed key, accessor, function, or unfrozen node.

Forbid `__proto__` in every identifier/string-literal spelling that has special object-literal semantics, and require unique ordinary data-property keys. Add both the identifier-key and string-key forms as explicit red subcases with an ordinary literal-key green neighbour.

## EVIDENCE INDEPENDENTLY CHECKED

- Verified exact commit, parent, design blob, SHA-256, and equality of working design to the reviewed commit.
- Parsed `## 10`: 50 rows, no gaps, no duplicates, control last.
- Parsed the structured manifest: 39 records.
- Read the source contract table, AST grammar, all universal red-proof carriers, rows 35/41/44–50, and the manifest as one joined surface.
- Executed Node probes for intrinsic-global identity, a shadowed `Object.freeze`, and identifier/string-literal `__proto__` semantics.

## TESTS RERUN (command/result)

```text
Matrix parser                     → count 50; missing []; duplicates []; controlLast true
Manifest parser                   → 39 records
Object === globalThis.Object      → true
shadowed Object.freeze root       → Object.isFrozen false; nested write "LEAK"
{__proto__: frozenProto}          → ownKeys []; custom prototype true; inherited value reachable
{"__proto__": frozenProto}       → same result
```

## ARCHITECTURE INVARIANTS TOUCHED

- A forbidden-set classifier is undefined until the allowed set is frozen too.
- AST spelling is not symbol identity; a parser rule must bind the callee it trusts.
- JavaScript object-literal keys can carry semantics beyond “own data property.”
- Positive neighbours are part of the contract: an empty ambient allow-list cannot coexist with a required ambient intrinsic.

## FAILED OR UNPROVEN CONDITIONS

- The import and host-global allow-lists are referenced but not enumerated, pinned, or digested.
- “ambient reads allowed: nothing” contradicts required use of the ambient intrinsic `Object.freeze`.
- The AST grammar has no intrinsic-symbol-resolution requirement and no shadowed-callee mutation.
- `__proto__` identifier/string keys remain admitted despite producing a custom-prototype object.
- The line 225 green-neighbour sentence still says “vs both `4b` rows” although the runtime matrix now has more than two `4b` rows; this should be scoped to the function/accessor pair or rewritten as “the relevant runtime rows.”
- No P0-vNext implementation, mutation execution, CI run, current Surface-B population, authority-semantic verification, or Phase-1 profile exists.

## REQUIRED CORRECTIONS

1. Choose and publish one import policy: zero imports, or an exact canonical allow-list plus transitive-resolution and digest rules. Do not leave “preferred” and “otherwise” as coequal implementations.
2. Publish the exact ambient-global allow-list and reconcile it with the “nothing” cell. Require TypeScript symbol resolution proving that admitted `Object.freeze` is the intrinsic binding.
3. Add manifest/matrix subcases for local/imported/shadowed `Object.freeze`; require them red and an intrinsic `Object.freeze` recursively frozen literal green.
4. Forbid special `__proto__` object-literal keys in identifier and string-literal forms; add both red subcases and an ordinary-key green neighbour. State whether duplicate ordinary keys are forbidden (recommended) and test that decision.
5. Repair the stale “both `4b` rows” green-neighbour carrier, then recompute the atom manifest and anchored/unanchored matrix counts.

## FILES / SCOPE ALLOWED

Design-only: `docs/designs/P0-VNEXT-DESIGN-2026-08-01.md` and the normal worker report. Blueprint remains out. No implementation, pinned-lane edit, ledger/oracle/census write, engine/runtime/extraction/DB work, grade, merge, deployment, Phase-1 profile, Surface B, P3, or Gate B.

## ACCEPTANCE COMMANDS

1. Print the exact canonical import and ambient-global allow-lists plus their source/digest rules; prove no unresolved “allow-list” reference remains.
2. Symbol-resolution red-proof: shadow/local/import `Object.freeze` → named red; intrinsic global `Object.freeze` → green.
3. Object-literal semantic red-proof: identifier `__proto__` and string-literal `"__proto__"` → named red; ordinary key → green; report own keys and prototype identity as witnesses.
4. Add these source atoms to the structured manifest with concrete subcases and named catchers; plant an unmapped atom and a nonexistent catcher as the two negative controls.
5. Re-parse all universal carriers and `## 10`; rows remain contiguous, unique, with one last clean control and an unanchored positive-control count.

## STOP CONDITION

Stop if membership in “unallowlisted” is evaluated without publishing the allowed set. Stop if `Object.freeze` is trusted by spelling rather than symbol identity. Stop if a special object-literal key can create a custom prototype while satisfying the admitted AST grammar. Stop if the positive neighbour is rejected by the same rule it is meant to validate.

## LESSON TO PERSIST

> **A forbidden set is not closed until the allowed set is named.**

> **A parser sees syntax; a safety rule must also bind the symbol and the language semantics it trusts.**

**Authorized next action:** one design-only source-grammar authority pass in the current worker seat. First observable: the chosen/pinned allow-lists plus the intrinsic-symbol and `__proto__` subcases, approximately 20–30 minutes. Implementation, grading, merge, deployment, Phase-1 profile, Surface B, P3, and Gate B remain blocked.
