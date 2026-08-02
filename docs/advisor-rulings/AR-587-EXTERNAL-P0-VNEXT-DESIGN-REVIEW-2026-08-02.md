# External advisor ruling — AR-587 / P0-vNext design

**Date:** 2026-08-02  
**Object reviewed:** campaign commit `cdc290dc87356f86b33c08e5197b109cc657909f`  
**Design blob:** `e2a8ac5a619afa1c63785ca3ddc514102d66e53b`  
**Decision:** **REVISE — the three AR-585 defects are closed, but the new global validity law collides with the source-channel matrix. Do not implement this revision yet.**

## What held

AR-587 correctly repairs all three defects from the prior external review:

1. Row 53 is a genuinely inert static import whose only admissible catcher is the zero-import cardinality rule.
2. Key identity is now defined from cooked TypeScript AST values (`Identifier.escapedText` / `StringLiteral.text`), and escaped `__proto__` plus duplicate-key mutations are registered with ordinary escaped-key controls.
3. Manifest 50(a) now calls the declared shadowing object, `Object.freeze(v)`, rather than the nonexistent `O.freeze(v)`.

I independently re-parsed the changed artifact. The section-bounded matrix is contiguous `1..54` with `54` unique rows; the same first-cell row shape outside the section contributes five additional numbered rows, giving the reported unanchored `59`. The plantable manifest contains `51` records. These counts are sound and remain explicitly pre-registration, not execution evidence.

## New load-bearing defect — the validity precondition makes registered rows environment-dependent or cross-caught

AR-587 adds the correct law that every mutation must parse and type-check before its named catcher may claim it. The design does not, however, define the compiler environment that makes several registered source mutations valid.

I ran the TypeScript compiler API with an ES2022-only deterministic program surface. The registered shapes produced:

| registered shape | compiler result before the named catcher |
|---|---|
| `window.__ledger` | `TS2304 Cannot find name 'window'` |
| arbitrary free host identifier | `TS2304` |
| `createRequire(import.meta.url)(...)` | `TS2304 createRequire` plus an `ImportMeta` typing failure |
| computed `require(...)` | `TS2580 Cannot find name 'require'` |
| `eval(...)` | type-checks |
| `new Function(...)` | type-checks |

Those are not implementation trivia. Whether row 35 or row 41 is a valid fixture currently depends on implicit `lib` and ambient-type availability. A mutation matrix whose result changes with the host's installed declaration packages is not frozen.

There is a second collision. The contract says the direct-ambient rule rejects **every** host-global identifier except intrinsic `Object.freeze`. Row 41 separately requires `require`, `eval`, `Function`, and `createRequire` to be caught specifically by the dynamic-loading rule. Under the current wording:

- `eval` and `Function` are ambient globals;
- `require` is ambient when Node declarations are present and undefined when they are absent;
- `createRequire` is not a global at all, so it either needs a static import that violates the zero-import rule first or a fixture-only ambient declaration that the ambient rule also owns.

Thus four of row 41's five subcases are either invalid before the catcher or owned by two catchers. The matrix itself says a mutation caught by the wrong check is a failed proof. It presently supplies no precedence or exclusion rule capable of making the promised attribution true.

This is the important design lesson: **validity is a property of `(source, compiler environment)`, and diagnostic ownership is a property of `(syntax node, rule precedence)`. Source text alone does not define either.**

## Required revision

Before implementation, add one bounded fixture-and-diagnostic contract:

1. **Pin the compiler surface.** Name and hash the exact `tsconfig` options, standard libraries, ambient declaration files, and TypeScript version used to admit mutation fixtures. A fixture that relies on a host symbol must receive it from a committed fixture declaration surface, not from whatever `@types/*` happens to be installed.
2. **Make ambient fixtures explicit.** Rows 35(b–d), 36, 41(b), and 41(e) must name the declaration that makes their symbol semantically resolvable. The checker must still identify that symbol as ambient/unowned even though it type-checks.
3. **Define single diagnostic ownership.** Dynamic-load syntax must own `import()`, computed `require`, `eval`, `new Function`, and `createRequire` nodes. Identifiers occurring inside an already-owned dynamic-load node must be excluded from the generic ambient-read verdict. The fixture must assert the named owner fired and the competing owner stayed silent.
4. **Resolve `createRequire` honestly.** Either provide a committed fixture-only ambient declaration and classify the call as dynamic loading, or remove that subcase from the zero-import source contract as unconstructible. Do not import it and then claim the dynamic rule was independently exercised; the cardinality gate would have won first.
5. **Red-proof the environment itself.** Run each affected fixture once with its required declaration present (named catcher fires) and once with that declaration removed (validity precondition fires and the named catcher is explicitly not credited). This proves the precondition is a gate rather than a caption.

## Disposition

AR-587 is a high-quality correction and should be preserved. It is not yet an implementation-ready P0 contract because its newest global rule invalidates or ambiguously reclassifies distant rows. This is precisely the kind of cross-rule dependency that the revised V4 execution graph must represent as an explicit edge rather than leaving inside prose.

**Next smallest task:** one design-only validity/diagnostic-ownership pass over rows 35, 36 and 41, followed by a fresh section-bounded census. No implementation, no Gate-B work, and no widening into the parked side lanes.
