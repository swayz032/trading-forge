// THE COMMITTED AMBIENT DECLARATION FILE (R-543 s4 item 2, item 4).
//
// WHY THIS FILE EXISTS: with `types: []` the pinned surface supplies NO ambient @types/*.
// Every host symbol a fixture mentions must therefore be declared HERE, in the repository,
// or the fixture is TYPE-INVALID and cannot be credited as coverage (R-543 s4 item 1).
//
// WHAT THIS FILE MAY NOT DO: it may not declare away the defect a fixture exists to prove.
// Declaring a symbol makes a fixture COMPILE; it must never make it CLEAN. Every symbol
// below is still caught by its named catcher -- `window` is still an ambient read, `require`
// is still dynamic loading. The declaration removes the type error, not the violation.
//
// THE ONE CHANNEL THIS FILE CANNOT SERVE, STATED OUTRIGHT: an UNRESOLVED identifier
// (corpus 34(d-unresolved)) is TS2304 by construction. Declaring it here would resolve it
// and destroy the very channel under test. That subcase is therefore an HONEST
// `miss_type_invalid` and is NOT declared below. See RESULTS, "the 34(d) split".

// ---- the lane object every fixture's project() receives ------------------------------
// Without this, `(lane) =>` is TS7006 under `strict` and EVERY source fixture is invalid.
declare type Lane = {
  readonly v: unknown;
  readonly n: string;
  readonly [key: string]: unknown;
};

// ---- host globals: declared so the fixture COMPILES; still caught as ambient reads ----
declare var window: any;
declare var global: any;
declare var process: { readonly env: Readonly<Record<string, string | undefined>> };
declare var __ledger: unknown; // makes `globalThis.__ledger` resolvable (else TS7017)

// ---- dynamic-loading symbols: declared so the fixture COMPILES; still caught ----------
declare function require(id: string): unknown;
// R-543 s4 item 4 -- createRequire RESOLVED as a committed fixture-only declaration.
// This is deliberately NOT node:module's real signature: the fixture only needs the name
// to resolve so the DYNAMIC_LOAD catcher can own it. Declaring the real one would drag in
// @types/node and re-open the environment dependence this surface exists to close.
declare function createRequire(specifier: string): (id: string) => unknown;

// ---- helpers referenced by grammar fixtures -------------------------------------------
// A non-intrinsic freeze helper. Row 48 must red via the CONST-GRAMMAR catcher for being
// a non-intrinsic callee -- not via a "cannot find name" type error.
declare function deepFreeze<T>(x: T): T;
// The declared free reference used by the type-valid arm of the 34(d) split. It resolves
// to THIS file -- neither the fixture nor a lib.*.d.ts -- which is exactly the
// "free/captured reference" shape the FREE_REF catcher owns.
declare function injectedReader(lane: Lane): unknown;

// ---- the D/E RED-PROOF PAIR (R-546 s5.10) ---------------------------------------------
// ONE spelling declared in BOTH spaces, so the same identifier can be placed in a type-only
// position and a value-only position and the two verdicts compared directly. Without a
// declaration in both spaces the pair dies at TS2304 before any catcher runs and proves
// nothing -- which is exactly what my first attempt at this probe did.
declare type Widget = { readonly w: number };
declare const Widget: (lane: Lane) => unknown;

// ---- module declarations for non-relative fixture imports -----------------------------
declare module 'node:fs' {
  const fs: { readonly readFileSync: (p: string) => unknown };
  export default fs;
}
