# AR-1061 — WORKER — **UNIT A GREEN** (source-risk contract lands at the onboarding boundary). Red-proved by mutation, not by first-run green. One honest control gap named.

```
RULING : AR-1059 (gpt-rulings 8e9ea5bc) SS4 UNIT A / UNIT E
COMMIT : 93dfa18e12a741589ec5a999bea4711f51acbd8f
PRIOR  : AR-1060 (617b2f71) -- UNIT B+C+D and the two money-path defects
TREE   : C:\Users\tonio\Projects\wt-h1-wave4-20260712   [all MEASURED HERE]
STATUS : partial. NOT the SS6 certification GREEN. The fork raised in AR-1060 SS3
         remains open and I have implemented nothing against it.
```

## 1. WHAT LANDED

`spec-onboarding-service.ts` built `stop_loss: { type: "atr", multiplier: 1.5 }`
**unconditionally**, before the overlay ran. That is where a taught stop died (AR-1056 SS2.4).

New module `src/server/services/source-risk-contract.ts` (DB-free) carrying
`SourceRiskContract` / `SourceStopContract` / `SourceTargetContract`, `ANCHOR_TO_RESOLVER`,
and the pure `resolveSpecStopLoss()`. `SpecArtifactBody` gains an **optional** `source_risk`.
The call site now delegates.

| input | output |
|---|---|
| no `source_risk` (**the entire existing library**) | exactly `{type:"atr", multiplier:1.5}` |
| `TF_OVERLAY_VARIANT`, even with a taught stop | exactly `{type:"atr", multiplier:1.5}` |
| `SOURCE_FAITHFUL`, no taught stop | framework stop **stamped** `framework_default_untaught` |
| `SOURCE_FAITHFUL` + taught stop | `{type:"source_structural", anchor, required_anchor, include_wick, source_exact:true, ownership:"source", span}` |

**Vocabulary REUSED, not minted** (AR-1057 SS5.1): the anchor type is exactly the 12-value
`stop.anchor` enum from `transcript-extractor-minimal-schema.json`.
`atr_multiple`, `displacement_candle_*` and `swing_after_sfp` are **deliberately unmapped** --
the Python resolver implements no candidate for them, and inventing a mapping would bind the
taught stop to a DIFFERENT structure than the one taught. Refuses a `{0,0}` span (the
LLM-rationale sentinel AR-1055 measured) and any anchor outside the vocabulary.

**Why a separate module:** `spec-onboarding-service.ts` opens a DB connection at import time,
so importing it demands `DATABASE_URL`. The contract has to be importable by the compiler, the
overlay and tests without a database. Re-exported from the service so call sites keep one
import surface.

## 2. EVIDENCE

```
GREEN : 10 passed  src/server/services/__tests__/source-risk-contract.test.ts
TSC   : 0 errors, exit 0
ADJACENT: 143 passed / 11 files
```

### 2.1 The red-proof is by MUTATION, and I want that on the record

**My first run of these tests was GREEN, because I wrote the module before re-running.**
A green that was never red proves nothing, so I mutated the implementation and re-ran:

| mutation | result |
|---|---|
| `SOURCE_FAITHFUL` silently returns the legacy ATR stop | **6 failed** / 4 passed |
| `source_exact: false` — silently reintroduce the framework buffer | **1 failed** / 9 passed |
| restored | **10 passed** |

The 4 surviving tests under mutation 1 are the legacy-behaviour and vocabulary tests, which
*should* be unaffected. Mutation 2 failing exactly 1 is the assertion that guards the buffer.

### 2.2 🛑 HONEST CONTROL GAP — the 143 greens do NOT witness this change

`grep stop_loss` across every pre-existing `spec-onboarding-*` test returns **nothing**.
**No pre-existing test asserts `stop_loss` anywhere.** So "143 passed" is *silent* on whether
legacy `stop_loss` is unchanged -- it is not a control for this edit, and I am not citing it as
one. The actual control is the unit test (`toEqual({type:"atr",multiplier:1.5})`, deep equality)
plus mutation 1 proving that assertion bites.

**Residual, stated plainly:** legacy equivalence is proven at the FUNCTION, and the call site is
a direct substitution of that function for the literal it replaced. I have **not** executed the
onboarding builder end-to-end for a legacy artifact and diffed the built config, because that
path requires a live DB. `[UNPROVEN AT THE CALL SITE]`.

## 3. STILL OPEN

- **UNIT E second half — `framework-overlay.ts:328` still force-replaces any non-`atr`
  `stop.type` with `atr 1.5x`.** Until that is mode-gated it will overwrite the
  `source_structural` stop this AR just preserved. (Its warning text also calls a structural
  stop "non-structural" while citing a `CLAUDE.md SS13` clause that *requires* structural --
  the message inverts the policy it cites. Reported in AR-1058 SS2, still unrepaired.)
- **Python side does not yet consume `source_risk`.** `SpecConditionStrategy` /
  `from_compiled_spec` do not read it, so the contract stops at the persisted artifact.
- **RED/GREEN 1, 2, 10, 11 outstanding.** No money-path crossing yet.
- **AR-1060 SS3 fork still open** — whether `SOURCE_FAITHFUL` may bypass
  `BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED` (operator-set, defaults FALSE) and the MES 6.0pt
  stop floor. **Nothing implemented against it.** Without a ruling the source stop provably
  cannot execute, so this is now the critical-path blocker, not a side question.

## 4. NEXT

`framework-overlay.ts` mode gating (UNIT E second half) -- it does not depend on the SS3 fork
and it is the last thing that can silently overwrite the contract before Python ever sees it.

**Nothing blocking for the operator.**
