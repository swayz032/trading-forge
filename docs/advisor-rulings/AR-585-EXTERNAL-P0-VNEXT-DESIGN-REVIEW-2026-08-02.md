# External GPT review — `P0-vNext` design after `AR-585`

**Reviewed object:** worker delivery commit `d9db4aa7e0b8238c3944abc682b4741e2bdb200b`; parent `671d9de20f00a037af71e6e75a47c4a57bfe25fa`; design blob `4f69ec6e4f48fefee491916fb95b320c1ca0fddb`. The campaign working file hashes to the same Git blob.

**Newest worker report read before publication:** `AR-585` (`AR-584` is its start receipt).

**RULING ID / TASK ID / DECISION:** external review of `AR-585` · **REVISE**. The five ordered corrections genuinely landed: zero imports is now the sole import policy; the intrinsic allow-list contains one symbol-resolved entry; non-intrinsic freeze callees, special `__proto__` keys, and duplicate ordinary keys are forbidden; the stale `4b` carrier names eight rows; the matrix is `52 + 1 = 53`; and the manifest contains 45 records. The next pass is still design-only because three false-green paths remain: the universal zero-import promise has no harmless-import red mutation, static key identity is not defined by cooked property value, and one advertised concrete mutation fails on an unrelated undefined identifier.

## CLAIMS VERIFIED (and how)

- **[MEASURED HERE, exact blob]** imports are now a closed empty set; there is no remaining live helper-import alternative.
- **[MEASURED HERE]** the ambient intrinsic list has exactly one entry, `Object.freeze`, restricted to the wrapper position and resolved by TypeScript symbol identity.
- **[MEASURED HERE]** rows 50–52 cover non-intrinsic freeze callees, two exact `__proto__` spellings, and one exact duplicate-key spelling.
- **[MEASURED HERE]** the `4b` carrier names rows `39,40,42,43,44,45,46,47`.
- **[MEASURED HERE]** a section-anchored parse yields 53 unique contiguous rows `1..53`, control last; the same row shape unanchored yields 58.
- **[MEASURED HERE]** the promise/catcher manifest contains 45 concrete records and is honestly labelled `[PRE-REGISTERED — NOT EXECUTED]`.

## F-1 — “zero imports” is not red-proofed by an otherwise harmless import

The source contract forbids **ANY import statement whatsoever**. But row 26 and the manifest plant only:

1. a ledger/oracle-reader import;
2. a filesystem/network module;
3. a transitive edge reaching either.

Those mutations prove dangerous dependencies are rejected. They do not prove the import population is empty. A compliant-looking implementation can retain an allow-list for a pure helper, reject all three row-26 attacks, keep every new green neighbour green, and still violate the chosen zero-import policy.

This is the exact control that changed polarity when the policy changed: the former “allow-listed pure helper import stays GREEN” should not merely disappear. It must become a **RED mutation**. The positive neighbour remains the zero-import module.

Required correction: add a direct static import of a demonstrably inert local helper as its own mutation subcase. It must fail because the import count is non-zero, with the module specifier named—not because it reaches a forbidden capability.

## F-2 — the key grammar does not define semantic/cooked key identity

The grammar says `Key != "__proto__"` and “all Keys DISTINCT,” while the matrix plants only exact raw spellings:

```js
{ __proto__: p }
{ "__proto__": p }
{ a: 1, a: 2 }
```

JavaScript and the TypeScript AST admit spellings whose raw source differs but whose cooked property key is identical. I executed these grammar-conforming forms:

```js
Object.freeze({ "\x5f\x5fproto__": p })
Object.freeze({ \u005f\u005fproto__: p })
Object.freeze({ a: 1, "\x61": 2 })
```

Measured runtime result for both escaped proto forms: `Reflect.ownKeys` is empty, the supplied object becomes the prototype, inherited data is reachable, and the root is frozen. Measured duplicate result: one own key `a`, value `2`; the first value is silently discarded.

The TypeScript AST exposes why a raw-text implementation can pass the design while remaining wrong:

```text
raw "\x5f\x5fproto__"  → cooked __proto__
raw \u005f\u005fproto__  → cooked __proto__
raw "\x61"              → cooked a
```

Required correction: define **canonical static property identity** as the TypeScript AST’s cooked `Identifier`/`StringLiteral` value, never `getText()` or raw source spelling. Apply that one identity function to both the special-key prohibition and duplicate detection. Add escaped identifier/string proto mutations and mixed/escaped duplicate-key mutations, plus ordinary distinct-key neighbours.

## F-3 — manifest row 50’s “concrete” mutation is red for the wrong reason

The manifest records:

```js
const Object={freeze:x=>x}; O.freeze(v)
```

`O` is never declared. Executed exactly, it throws `ReferenceError: O is not defined`. A future gate can therefore mark the case red without ever testing the promised non-intrinsic `Object.freeze` symbol resolution. This violates the document’s own rule that a mutation caught by the wrong check is a failed proof.

Required correction: make the concrete mutation use the shadowed binding it declares—`Object.freeze(v)`—and require the catcher identity to be the non-intrinsic-callee check. Add a clean syntactic/type-check control so an undefined-name or parse/type failure cannot satisfy the row.

## EVIDENCE INDEPENDENTLY CHECKED

- Verified commit, parent, design blob, and working-file/blob equality.
- Parsed matrix membership and order independently: 53 anchored, 58 unanchored, no gaps or duplicates, control last.
- Parsed the structured manifest independently: 45 records.
- Joined import policy → row 26 → manifest records by the concrete mutation subcase, not by the shared word “import.”
- Executed Node runtime probes for escaped proto keys, escaped/mixed duplicate keys, and the exact `O.freeze` manifest example.
- Parsed the same escaped keys with the TypeScript compiler API and compared raw source text with cooked AST values.

## TESTS RERUN (command/result)

```text
Matrix parser                         → anchored 53; ids 1..53; missing []; duplicates []; unanchored 58
Manifest parser                       → 45 records
escaped quoted __proto__              → ownKeys []; custom prototype true; inherited 7; frozen true
escaped identifier __proto__          → same result
duplicate {a:1,"a":2}                → ownKeys ["a"]; a=2
duplicate {a:1,"\x61":2}             → ownKeys ["a"]; a=2
TypeScript AST raw vs cooked          → escaped raw spellings normalize to __proto__ / a
exact manifest `O.freeze(v)`           → ReferenceError: O is not defined
```

## ARCHITECTURE INVARIANTS TOUCHED

- A universal zero-cardinality policy needs a member that would have been safe under a capability policy; otherwise capability rejection can masquerade as cardinality enforcement.
- Static object-key safety is a property of the **cooked property identity**, not its source spelling.
- A red mutation is evidence only when the named catcher—not an earlier parse/name/type failure—causes the red.
- Compiler correctness remains separate from strategy profitability; no runtime or trading behavior is authorized here.

## FAILED OR UNPROVEN CONDITIONS

- No mutation plants a harmless static import against the zero-import rule.
- `__proto__` and duplicate-key decisions do not specify cooked-key canonicalization and do not cover escaped/mixed spellings.
- Manifest row 50(a) does not execute the binding it declares and can fail for an unrelated missing name.
- All 45 manifest records remain pre-registered design text; no implementation, mutation run, CI execution, current Surface-B population, authority-semantic verification, or Phase-1 profile exists.

## REQUIRED CORRECTIONS

1. Add the harmless-static-import RED mutation and zero-import GREEN neighbour; the red cause must be non-zero import cardinality.
2. Define one cooked-key canonicalization function for all admitted static keys; use it for both `__proto__` and duplicate detection.
3. Add escaped identifier/string proto subcases and mixed/escaped duplicate-key subcases with exact catcher attribution.
4. Repair manifest row 50(a) to call the declared shadowed binding and require parse/type validity before the symbol-identity verdict is admitted.
5. Recompute the manifest and anchored/unanchored matrix counts from the revised design.

## FILES / SCOPE ALLOWED

Design-only: `docs/designs/P0-VNEXT-DESIGN-2026-08-01.md` and the normal worker report. Blueprint remains out for this worker task. No implementation, pinned-lane edit, ledger/oracle/census write, engine/runtime/extraction/DB work, grade, merge, deployment, Phase-1 profile, Surface B, P3, or Gate B.

## ACCEPTANCE COMMANDS

1. Plant a pure local static helper import: named RED solely because import count is `1`; zero-import neighbour GREEN.
2. Parse raw and cooked static property names with the TypeScript API; escaped proto variants normalize to `__proto__` and reject via the proto catcher.
3. Mixed/escaped duplicates normalize to the same canonical key and reject with both source positions; distinct cooked keys stay GREEN.
4. Execute/type-check row 50(a) before the gate verdict; it must be syntactically and semantically valid, then reject via non-intrinsic symbol identity.
5. Re-run bidirectional manifest joins and the section-anchored matrix parser; report anchored and unanchored counts.

## STOP CONDITION

Stop if zero-import is inferred from rejection of only dangerous imports. Stop if property keys are compared by raw source spelling. Stop if any red mutation can satisfy its row through an undefined identifier, parse failure, or type failure instead of the named catcher.

## LESSON TO PERSIST

> **When a policy changes a control’s polarity, invert the control; do not merely delete it.**

> **For static object literals, the security key is the cooked property identity, not the characters that spell it.**

**Authorized next action:** one more design-only closure pass in the current worker seat. First observable: the harmless-import mutation, cooked-key rule/subcases, and corrected row 50(a), approximately 20–30 minutes. Implementation, grading, merge, deployment, Phase-1 profile, Surface B, P3, and Gate B remain blocked.
