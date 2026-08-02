# AR-594 external GPT review — 2026-08-02

**Object reviewed:** campaign commit `00289f0705f99e997c60e0583ee75a88b6de1703` in a detached worktree.  
**External decision:** **REVISE.** `F-1` is acceptable; `F-2` over-corrects erased TypeScript heritage positions. Items `14`–`16` also remain unimplemented at their previously convicted executable lines. This is external advice only, not a campaign ruling or independent grade.

## Decision basis

I re-ran all five shipped commands on the exact commit:

- `run.mjs` — exit `0`, `44/52` like-for-like and `55/64` expanded.
- `red-proof.mjs` — exit `0`, green control and `18/18` named classes red.
- `type-value-proof.mjs` — exit `0`, `12/12`.
- `emitted-freeze.mjs` — exit `0`, `36` emit-covered plus `2` explicitly not covered by emit.
- `module-tuple.mjs` — exit `0`.

Those greens are real statements about the registered battery. They do not clear the repair.

### 1. `F-1` — receive

The static module-edge repair rejects the missed re-export forms, including `export * from`, named re-export, namespace re-export, and import-equals. The clean control remains admitted. I found no counterexample that reopens the ledger-reaching module edge in the reviewed object.

### 2. `F-2` — revise; executed over-correction

The operative branch in `source-admission.mjs:191-194` classifies every identifier inside `ExpressionWithTypeArguments.expression` as value-space. That node shape is shared by three different semantics:

| probe | admission at `00289f07` | TypeScript emit |
|---|---|---|
| `class Impl implements Widget` | **REJECTED** on `free-captured-reference` plus the residual | `Widget` erased |
| `interface Ext extends Widget` | **REJECTED** on `free-captured-reference` | entire interface erased |
| `class Sub extends window.Base {}` | **REJECTED** on `direct-ambient-read` | `window.Base` retained |
| clean project | **ADMITTED** | control green |

This is discriminating, not always-red. The rule correctly catches runtime `class extends`, but incorrectly convicts `class implements` and `interface extends`. The corpus contains no rows for those erased forms, so `12/12` and `18/18` could not see the over-correction.

Required correction: determine heritage value-space from emitted/runtime retention, not from a hand-written list of remembered syntax kinds. Add both erased forms to the corpus while retaining named and anonymous `class extends` runtime controls and a reachable `POSITION_UNCLASSIFIED` control.

### 3. Earlier false greens remain open

The two AR-592 attacks have not moved:

- `run.mjs:46-57` still uses one global `TYPECHECKER_CAUGHT_CODES` allowlist. A diagnostic code is not joined to the row, owned expression, span, or expected defect, so an unrelated allowed diagnostic can still launder a row into `CAUGHT_BY_TYPECHECKER`.
- `corpus.mjs:282` still derives `ORIGINAL_52_IDS` from mutable `CORPUS.map(...)`. The supposedly frozen membership is therefore authored by the object it is meant to police; a unique rename can silently redefine the baseline.

These must be repaired before another grade. A new grade dispatched against only the heritage correction would spend the independent channel while known false greens remain live.

## Advice to the main advisor

R-551's `REVISE` disposition is supported by the exact-object run. Keep `P0PC` active and `P0PG` blocked. Receive `F-1`; require the emitter-grounded `F-2` correction, immutable external membership for the original 52, and diagnostic ownership rather than a global code allowlist. Then run one fresh independent hunt over the combined replacement object, including the ungraded runtime-admission surface.

The V4 graph candidate remains **not adopted**. AR-594 advances no graph node; its delivery epoch also makes the previously published graph snapshot stale by design until the campaign desk deliberately ratifies and refreshes it.
