# `P0-vNext` — DESIGN

**Authority:** DISPATCH 2026-08-01 `21:37`, delivering `R-524 §5` / `R-525 §5` · **Author:** working agent, seat `claude.exe 26204` · **Date:** 2026-08-01
**Status:** **DESIGN ONLY. NO IMPLEMENTATION CODE EXISTS OR IS AUTHORIZED.** Implementation stays blocked until this design is externally read.
**Inputs it consumes:** `docs/designs/P1-P2-TOTAL-MEMBERSHIP-2026-07-31.json` (the ledger, blob `1551c7e56480caff7d70a580e1f7a2c7ef644203`) · the pinned source fixture specs at tag `p1p2-frozen-source-universe-c304b098` → `c304b098b156106a5a81b714c7a5a3ed166d68ef`.

> ### ★★★★★ THE ONE SENTENCE THIS DESIGN EXISTS TO OBEY
> **`CONSUME CELLS, NOT CAPTIONS.`** Six `P0` attempts died asking a sparse object to prove its own completeness. `P0-vNext` never asks any artifact what its own membership is: **it reconstructs membership from a different file set and treats every artifact it judges — including the ledger — as an input to be validated, never as an authority about itself.**

---

## 0 — WHAT `P0-vNext` IS, AND THE THREE CLAIMS IT KEEPS SEPARATE

`P0-vNext` is a **thin consumer**. It holds no expectations of its own; every expectation comes from the frozen ledger, and every membership fact comes from the pinned specs.

⚠️★★★★★ **THE LOAD-BEARING DESIGN ACT IS THIS SPLIT.** `152` of the `301` cells are `UNADJUDICATED`. **If "depends on an `UNADJUDICATED` cell" is read loosely, the gate can never go green and is useless; if read too narrowly, the `43` undeclared cells buy nothing and the whole inversion was wasted.** The resolution is that the gate does not emit *one* verdict — it emits **three, over different populations**:

| claim | population | verdict on failure | depends on `UNADJUDICATED`? |
|---|---|---|---|
| **A · AGREEMENT** — TS and Python project the same value | **ALL `301` cells** | `DISAGREEMENT`, naming cell + both values | **NO.** Agreement needs no oracle; two lanes can be compared where no truth is known. |
| **B · FROZEN-LEDGER CONFORMANCE** — the projected value matches the frozen ledger entry | **`ASSERTED` only (`140`)** | **`LEDGER_DIVERGENCE`**, naming cell, frozen value, observed, citation | **NO, by construction.** |
| **C · COMPLETENESS** — every cell in a scope is adjudicated | **any REGISTERED `scope_id` — the caller SELECTS, never AUTHORS** | ★★★★★ **`INCOMPLETE_AUTHORITY`, NAMING every unadjudicated cell — FAIL CLOSED, NEVER a conformance green** | **YES. This is the claim that carries the `43`.** |

★★★ **`AGREEMENT IS NOT CORRECTNESS AND NEITHER IS COMPLETENESS.` The parity gate's historic failure mode — `AR-499 §2`: both lanes over-refusing identically while the gate printed `EXIT 0 · PASS` — is exactly claim A passing while claim B is unasked. Keeping them separate is not bookkeeping; it is the defect.**

---

## 1 — CONTRACT 1: MEMBERSHIP IS RECONSTRUCTED INDEPENDENTLY

**The row × axis frame is rebuilt at every run from the PINNED SOURCE SPECS**, keyed `fixture filename × spec.entry_conditions[].id`, read at tag `p1p2-frozen-source-universe-c304b098`. The seven axes are a **frozen constant in the gate's own source.**
**`43` rows × `7` axes = `301` cells.**

⚠️★★★★★ **NEITHER THE LEDGER NOR `ORACLE.json` MAY DEFINE MEMBERSHIP.** Both are compared against the reconstruction:
- a cell in the reconstruction and missing from the ledger → **`LEDGER_INCOMPLETE`**, naming it;
- a cell in the ledger and outside the reconstruction → **`LEDGER_UNKNOWN_CELL`**, naming it;
- either condition **fails the run**. Neither is repaired, inferred, or absorbed.

★★★ **THIS IS THE `v1` DEFECT STATED AS A PROHIBITION:** the first truth freeze took its rows from `ORACLE.json`'s present keys, so absence deleted rows from the universe built to detect absence, and `13` rows — all in the control fixture — vanished. **The gate must be unable to repeat that, and it is, because the file it reads membership from is not the file it judges.**

---

## 2 — CONTRACT 2: AGREEMENT OVER EVERY PROJECTED CELL

🛑★★★★★ **CLAIM `A`'s DENOMINATOR IS `215` UNIQUE PROJECTED FIELDS — **NOT** `301`. THE `301` CELL FRAME BELONGS TO CLAIMS `B` AND `C`.**
`[MEASURED HERE, committed ledger `P1-P2-TOTAL-MEMBERSHIP-2026-07-31.json`, join key `(fixture, condition_id)` STATED rather than auto-selected]`
```
ledger cells                    301
distinct rows                    43      distinct axes  7
UNIQUE projected fields         215      = 43 rows x 5 raw fields
multiplicity histogram          {1: 172, 3: 43}    sum 215 · expanded sum(k*v) = 301
POSITIVE CONTROL   axis set == projection-map keys EXACTLY, both directions empty
```
⚠️★★★★★ **WHY THE DIFFERENCE IS A FALSE-CONFIDENCE ENGINE AND NOT AN ACCOUNTING PREFERENCE: `bindable`, `session_zone`, `approximation` and `primitive` each feed ONE axis, but the single projected `reason` feeds `reason_null` **+** `reason_names` **+** `reason_excludes`. So `43` reason values are counted THREE TIMES inside the `301`.** ★★★★★ **CLAIM `A` REPORTING `301` INDEPENDENT PROJECTIONS WOULD PRINT ONE `reason` MISMATCH AS **THREE** AGREEMENT FAILURES — AND ONE `reason` AGREEMENT AS **THREE** CORROBORATIONS.** `A SHARED OBSERVATION REFERENCED THREE TIMES IS ONE OBSERVATION WITH MULTIPLICITY THREE, NOT THREE INDEPENDENT OBSERVATIONS.`
✅ **BINDING:** claim `A` reports **`unique_projection_n = 215`**. **Surface `A` is stated everywhere as `43` rows / `215` projected fields / `301` ledger cells.** ⚠️ **If an expanded per-axis view is published it MUST carry the `{1:172, 3:43}` histogram and MUST NOT be called independent projections.**

For every one of the `43` rows the gate obtains the TS projection and the Python projection over the `5` raw fields — **`215` unique field comparisons** — and requires them equal, **including fields carrying no expectation.**
⚠️ **`AGREEMENT IS CHECKED WHERE TRUTH IS UNKNOWN` — that is the point of running it over all `215` rather than over the `140` asserted cells.**

> ### ★★★★★ THE FOUR-CASE PRESENCE MATRIX — **PUBLISHED BEFORE ANY CODE EXISTS**
> | TS | Python | verdict |
> |---|---|---|
> | present | present | compare **typed canonical** values; unequal ⇒ `DISAGREEMENT`, path + both values named |
> | present | absent | ⚠️ **`DISAGREEMENT`**, path + value named — **never silently equal** |
> | absent | present | ⚠️ **`DISAGREEMENT`**, path + value named |
> | **absent** | **absent** | 🛑★★★★★ **`PROJECTION_MISSING_BOTH` — A FAILURE. ALWAYS. NO EXCEPTION.** |
>
> 🛑★★★★★ **THE `NOT-APPLICABLE` EXCEPTION THAT USED TO SIT IN THIS ROW IS DELETED, AND IT WAS THE LAST PLACE CLAIM `A` READ THE LEDGER.** The row previously said *"UNLESS that exact cell is authority-classified `NOT-APPLICABLE`"* — **which makes claim `A`'s VERDICT a function of `cell.classification`.** ⚠️★★★★★ **`SEALED BEFORE THE LEDGER IS PARSED` AND `GREEN ONLY IF THE LEDGER SAYS NOT-APPLICABLE` CANNOT BOTH BE TRUE OF ONE CLAIM.** Both sentences were in this document at once, and the second silently repealed the first.
> ★★★★★ **`MOVING DEPENDENCE FROM cell.value TO cell.classification DOES NOT MAKE A CLAIM INDEPENDENT — IT MOVES THE COUPLING ONE FIELD TO THE LEFT.`** The previous revision severed claim `A` from the expectation's VALUE and left it reading the expectation's CLASS, and called that severed.
> ⚠️★★★ **IT WAS NOT EVEN WELL-DEFINED: the exception says *"that exact cell"*, while this same document establishes that ONE projected `reason` feeds THREE ledger cells. There is no one-to-one cell for the exception to name on a `215`-field frame.**
>
> ### 🛑★★★★★ VALUES ARE COMPARED EXACTLY AS EMITTED — **`NOT-APPLICABLE` SAYS NOTHING ABOUT THE RUNTIME**
> **ALL FIVE PROJECTION KEYS ARE ALWAYS EMITTED BY BOTH LANES, AND EACH IS COMPARED EXACTLY AS EMITTED.** `null` is a **LEGITIMATE RUNTIME VALUE WHERE THE LANE ACTUALLY EMITTED NULL.` **Only `MISSING` — the lane failed to emit a required key — is universally invalid.**
> 🛑★★★★★ **THE PREVIOUS REVISION SAID *"a semantically inapplicable field is emitted as JSON `null`"* AND IT IS FALSE AGAINST THE RUNNING CODE.** `[MEASURED HERE BY EXECUTION — BOTH LANES, `c304b098`, positive control `3/3` target rows matched in each]`
> ```
>                  approximation   primitive                                      session_zone
> filter_lunch     True            'entry_quality.confluence_factor_presence'     None
> bias_overnight   True            'bias_engine.classify_institutional_regime'    None
> retest_midday    True            'spec_condition_compiler.retest_touch_check'   None
> NINE N/A-AXIS VALUES:  6 NON-NULL, 3 NULL      TS vs PYTHON: 9 COMPARED, 9 AGREE, 0 DISAGREE
> NEGATIVE CONTROL: flip one TS value True->null  =>  DISAGREE = 1   (the comparator CAN see a difference)
> ```
> ★★★★★ **SO THE OLD SENTENCE WOULD HAVE REWRITTEN SIX REAL RUNTIME VALUES TO `null` TO SATISFY A CLASSIFICATION THAT NEVER SPOKE ABOUT THEM.** `NO EXPECTATION IS NOT AN EXPECTATION OF NULL.`
> ⚠️★★★★★ **THE ROOT CONFUSION, NAMED: `NOT-APPLICABLE` IS THE **AUTHORITY DECLINING TO ASSERT** — a CLAIM-`B` PREDICATE STATUS. It is **NEVER** a claim-`A` DATA VALUE.** `[MEASURED — all `9` N/A cells' `declared_reason` begins `NO EXPECTATION` and `0/9` carry a value]` ★★★ **`A SKIP IN THE AUTHORITY LAYER MUST NOT ERASE A VALUE IN THE OBSERVATION LAYER.`**
> ✅ **THE `9` SKIP WITNESSES ARE UNCHANGED AND REMAIN CLAIM-`B` OUTPUT**, emitted after the sealed claim-`A` projection. **Claim `A` compares those same nine cells NORMALLY and goes green BECAUSE THE LANES AGREE — not because the authority was silent.**
>
> ⚠️★★★★★ **THE LAST ROW IS THE WHOLE REASON THIS MATRIX IS A DESIGN CONTRACT AND NOT AN IMPLEMENTATION DETAIL: `PARITY OVER TWO DEAD LANES IS VACUOUS`. Two lanes that both emit nothing agree perfectly and prove nothing, and this campaign has already paid for that law once.** ★★★ **The previous version left projection mechanics "unspecified" as a declared gap — but claim `A` depends ENTIRELY on them, so the gap was in the one interface most capable of manufacturing a false green.**
> **PER-PROJECTION RECORD, required fields:** raw lane path · **raw presence, with `MISSING` DISTINCT FROM JSON `null`** · raw value · canonical type · normalized value.
> ⚠️★★★★★ **THIS LINE PREVIOUSLY ALSO DEMANDED *"the pure transformation used for any derived axis (`primitive_null` · `reason_names` · `reason_excludes`)"* — A SURVIVOR OF THE PRE-SPLIT VOCABULARY, AND IT CONTRADICTED THE SPLIT DIRECTLY.** **Those three are LEDGER AXES evaluated by `evaluate()`; they are NOT projected, so no projection record can carry their transformation.** ★★★★★ **TWO SENTENCES GIVING OPPOSITE INSTRUCTIONS IS WORSE THAN THE ORIGINAL DEFECT: `A CONTRADICTION IS COMPLIANCE-CITABLE BY WHICHEVER SIDE AN IMPLEMENTER PREFERS`, and the side that reads this line would have rebuilt the coupling the split exists to remove.**
> ★★ **`MISSING` and `null` collapsing into one another is how an absent projection becomes a legitimate-looking value; they are recorded as different states, always.**

> ### 🛑★★★★★ `project()` AND `evaluate()` ARE DIFFERENT FUNCTIONS WITH DIFFERENT INPUTS — **THIS IS THE LOAD-BEARING RULE OF THE WHOLE DESIGN**
> **`project(lane) → projection`** reads **ONLY** the lane's own output plus the frozen, **LEDGER-INDEPENDENT** normalization contract below. **`evaluate(cell, projection) → claim-`B` verdict`** is the ONLY function that may see a ledger expectation.
> 🛑★★★★★ **CLAIM `A` MAY NOT READ `cell.value`, `cell.authority_citation`, OR ANY ORACLE EXPECTATION — NOT TO CHOOSE WHAT TO PROJECT, NOT TO NORMALIZE IT, NOT TO DECIDE WHETHER A CELL PARTICIPATES.**
> ⚠️🛑★★★★★ **THE PREVIOUS VERSION OF THIS PARAGRAPH ENFORCED THAT WITH A FUNCTION SIGNATURE AND CALLED IT *"the enforceable form of the rule"*, MINTING `AN INPUT IT CANNOT REACH IS A COUPLING IT CANNOT FORM`. **THAT SLOGAN IS DELETED BECAUSE IT IS FALSE.** ★★★★★ **A TypeScript/JavaScript function reads MODULE-SCOPE STATE, IMPORTS, CLOSURES, SINGLETONS, CACHES AND CAPTURED CALLBACKS — none of which appear in its parameter list.** `AN OMITTED PARAMETER IS NOT A CAPABILITY BOUNDARY.`
> ★★★ **IT IS RECORDED RATHER THAN QUIETLY REMOVED BECAUSE OF HOW IT PASSED REVIEW: it sat one sentence away from a TRUE measurement — `projectExhaustively()` genuinely takes no expectation argument — and `A TRUE MEASUREMENT NEXT TO A FALSE INFERENCE LENDS IT CREDIT.` A wrong mechanism gets obeyed; that is this campaign's most-convicted class, and this one was written by the party the rule constrains.**
>
> ### ★★★★★ THE BOUNDARY IS STRUCTURAL. FIVE REQUIREMENTS, NONE OF THEM A SIGNATURE.
> 1. 🛑★★★★★ **`project()` LIVES IN A PURE, DEPENDENCY-ISOLATED MODULE. THERE IS NO PROCESS ALTERNATIVE.** Its dependency closure contains **no ledger reader, no oracle reader, and no module that transitively imports either.**
> ⚠️★★★ **THE PREVIOUS REVISION OF THIS LINE READ *"…MODULE **OR A SEPARATE PROCESS**"* — AN OPERATIVE DISJUNCTION SITTING ONE PARAGRAPH ABOVE THE SECTION THAT SAYS *"THE MENU IS DELETED."* An implementer could cite it to take the branch that section DECLINED for want of an enforceable mechanism.** ★★★★★ **`A WITHDRAWN OPTION SURVIVES UNTIL EVERY OPERATIVE CARRIER IS REMOVED.` The separate-process form now appears in this document ONLY as historical explanation of why it was rejected — never as an allowed implementation form.**
>
> ### 🛑★★★★★ REQUIREMENT 1b — **TWO CONTRACTS, TWO NAMED ENFORCEMENT LAYERS. A BUILD-TIME RESULT MAY NEVER CERTIFY A RUNTIME PROPERTY.**
> ⚠️★★★★★ **THE PREVIOUS REVISION WROTE `1b` AS ONE TABLE OF FIVE SURFACES, AND THAT TABLE SILENTLY MIXED TWO DIFFERENT OBJECTS: the module's SOURCE TEXT — decidable by a parser before anything runs — and the VALUE HANDED TO `project()` AT RUNTIME, which is not decidable from source at all.** ★★★★★ **`SOURCE TOPOLOGY IS NOT RUNTIME VALUE SHAPE.` One check spanning both would have to certify a property it cannot observe, so the requirement is SPLIT and each half NAMES ITS OWN MECHANISM.** 🛑 **A `1b-S` PASS IS NEVER EVIDENCE FOR A `1b-R` PROPERTY, AND THE TWO RESULTS ARE REPORTED SEPARATELY — a combined green would relaunder exactly the confusion this split removes.**
>
> #### 🛑★★★★★ `1b-S` — **BUILD-TIME SOURCE CONTRACT.** SCOPE: `project()`'s module text and its frozen import closure. **NOTHING RUNS.**
> ★★★★★ **MECHANISM, NAMED: A REAL PARSER — the TypeScript compiler API (`ts.createProgram` → `SourceFile` AST) or equivalent typed parser services (`@typescript-eslint/parser` with `parserServices`). NOT a regex, NOT a keyword scan, NOT a token grep.**
> ⚠️🛑★★★★★ **AND THE REASON IS AN EXECUTED ONE, NOT A PREFERENCE `[MEASURED, `R-534 §1`, node v24.13.0]`: a module with ZERO imports, ZERO `let`, ZERO `var` and no `export function` but `project` LEAKED THE LEDGER VALUE THROUGH `const HOLDER = {}` PLUS `export const configure = f => { HOLDER.read = f }` — and a keyword-level check returned `<clean>` WHILE THE LEAK SUCCEEDED, exit `0`.** ★★★★★ **`A KEYWORD-LEVEL CAPABILITY CHECK IS A FALSE GREEN GENERATOR`, and this one was demonstrated rather than argued. `DO NOT REVIVE REGEX CAPABILITY ANALYSIS.`**
> 🛑★★★★★ **THE IMPORT POLICY IS A ZERO-IMPORT LEAF. THERE IS NO ALLOW-LISTED-IMPORT ALTERNATIVE. `project()`'s MODULE HAS **NO IMPORTS AT ALL** — the admitted import count is `0`.**
> ⚠️★★★★★ **THIS DELETES THE FOURTH MENU TO SURVIVE IN THIS DOCUMENT. The previous wording read *"none in the PREFERRED form; OTHERWISE an enumerated, frozen allow-list"* — two coequal implementations, one of which (the allow-list) had **NO ENUMERATED MEMBERSHIP ANYWHERE IN `10` LOAD-BEARING REFERENCES** `[MEASURED, `AR-584 §4`, positive control alive]`.** ★★★★★ **`A WITHDRAWN OPTION SURVIVES UNTIL EVERY OPERATIVE CARRIER IS REMOVED`, and `preferred X, otherwise Y` IS A MENU WEARING A RECOMMENDATION'S CLOTHES — it was swept for as a phrase pattern this round, not just as a single line.** ✅ **CHOSEN BECAUSE IT IS DECIDABLE: a zero-import rule needs no transitive resolution, no digest, and no membership list to be checkable.**
> **Every surface below is a CLOSED SET — anything not listed is FORBIDDEN, and the rule names the offending symbol or path.**
> | surface (`1b-S`) | ALLOWED (closed set) | FORBIDDEN — the rule NAMES the offending symbol/path |
> |---|---|---|
> | **module system** | ★★★★★ **ESM ONLY** — `.mjs`, or `.ts` compiled under `"type": "module"` | 🛑★★★★★ **CommonJS in any form — the module-wrapper `this` · `module.exports` · `exports.` · `require` · `__dirname` · `__filename` · `.cjs`** |
> | **imports** | ★★★★★ **NONE. The admitted set is EMPTY.** | ★★★★★ **ANY import statement whatsoever** — no allow-list exists to consult, so every import is forbidden and the rule names the specifier |
> | **dynamic loading** | ★★★★★ **nothing** | ★★★★★ **`import()` · `require` · `eval` · `new Function` · `createRequire` · any construct that resolves a module name at runtime** ⚠️ **broken out of the `imports` row because a STATIC import allow-list cannot decide a name computed at runtime** |
> | **exports** | `project` · immutable plain-data schema constants | ★★★★★ **setter or configuration exports · any function-valued export other than `project` · any export that mutates module state** |
> | **module-scope state** | ⚠️ **DEEPLY-FROZEN plain-data constants ONLY** — no getters, no functions, no nested writable object anywhere in the reachable graph | ★★★★★ **any mutable module-scope binding · caches · singletons · lazily-initialised holders** |
> | **direct ambient reads** | ★★★★★ **EXACTLY ONE ENTRY — the intrinsic `Object.freeze` binding, and ONLY in the frozen-constant wrapper position** (the AMBIENT-INTRINSIC ALLOW-LIST below) | ★★★★★ **EVERY other host global — `globalThis` · `window` · `global` · `process`/`process.env` · and ANY host-global identifier outside that one-entry list** ⚠️ **its own row, because it is neither an import nor a captured reference** |
>
> 🛑★★★★★ **WHY THE MODULE SYSTEM IS PINNED BEFORE ANY CODE IS WRITTEN `[MEASURED HERE, `AR-588`, node v24.13.0, 213-byte CommonJS module]`: a CJS module leaked the ledger value through the module-wrapper `this` while EVERY enumerated forbidden token was ABSENT — `import(` `require` `eval` `new Function` `createRequire` `globalThis` `window` `process` `let` `var` `export const` `module.exports` `exports.` `import` `get` `set` all absent, with the scanner's POSITIVE CONTROL confirming it can see a planted `globalThis`.**
> ```
> BASELINE  {"value":"FROM_LANE"}
> INJECTED  {"value":"EXPECTED_FROM_LEDGER"}   <- crossed the boundary
> ESM top-level `typeof this` = "undefined"    <- the channel does not exist under ESM
> ```
> ★★★★★ **THE MECHANISM: the CJS wrapper `this` is a `ThisExpression`, NOT an identifier binding — so a scope analyser enumerating unresolved identifiers never sees it, and `this !== globalThis`, so the ambient-reads row cannot reach it either.** **`A CLOSED SET THAT NEVER NAMED ITS MODULE SYSTEM IS NOT CLOSED.`** ✅ **Pinning ESM closes it BY CONSTRUCTION rather than by a check.**
> #### 🛑★★★★★ THE AMBIENT-INTRINSIC ALLOW-LIST — **PUBLISHED, BECAUSE A FORBIDDEN SET IS NOT CLOSED UNTIL THE ALLOWED SET IS NAMED**
> ⚠️🛑★★★★★ **THE CONTRADICTION THIS CLOSES, MEASURED: the previous ambient cell read `ALLOWED: nothing`, while the constant grammar's ONLY admitted composite form is `Object.freeze(...)` — and `[MEASURED, `AR-584 §4`, node v24.13.0]` **`Object === globalThis.Object` is `true`. `Object` IS AN AMBIENT HOST GLOBAL.** So `nothing` was literally false, and taken literally it REJECTED EVERY VALID FROZEN CONSTANT — making the GREEN neighbour this design promises **UNCONSTRUCTIBLE**, which is a STOP CONDITION in its own right.**
> ✅ **THE ALLOWED SET, ENUMERATED — MEMBERSHIP `1`:**
> ```
> #1  the INTRINSIC Object.freeze binding
>     admitted position : ONLY as the wrapper of a module-scope constant (the `Frozen` production)
>     resolved by       : TypeScript SYMBOL IDENTITY — the checker must resolve the callee to the
>                         global ObjectConstructor.freeze declaration (lib.es5.d.ts)
>     NEVER resolved by : the source TEXT "Object.freeze"
> ```
> 🛑★★★★★ **SYMBOL IDENTITY IS NOT PEDANTRY — TEXT-MATCHING IS A MEASURED FALSE GREEN `[MEASURED, `AR-584 §2`, node v24.13.0]`:**
> ```
> const Object_ = { freeze: x => x }         // a local binding; the text still reads "…freeze("
> Object_.freeze({ slot: {} })  -> isFrozen(root) = FALSE ; nested write returned the LEDGER value
> CONTROL: intrinsic Object.freeze, every nested literal wrapped
>                               -> isFrozen(root) = TRUE  ; nested write blocked (undefined)
> ```
> ★★★★★ **A SHADOWED, LOCALLY-DECLARED, IMPORTED OR ALIASED `freeze` SATISFIES THE GRAMMAR'S SPELLING AND FREEZES NOTHING. `A NAME IS NOT A BINDING; ONLY THE RESOLVED SYMBOL IS.`** ⚠️ **Under the zero-import policy an IMPORTED `freeze` is already impossible — but the rule is stated against the SYMBOL anyway, because `A RULE THAT DEPENDS ON ANOTHER RULE'S SIDE EFFECT BREAKS WHEN THAT RULE MOVES.`**
> ⚠️ **NOTHING ELSE IS ADMITTED. No `Object.entries`, no `Array`, no `JSON`, no `Symbol`, no `Math` — the list is length `1` and closed. If a later requirement needs a second intrinsic, IT IS ADDED HERE EXPLICITLY OR IT IS FORBIDDEN.**
> | **free / captured references** | only the deeply-frozen constants above | ★★★★★ **any other free or captured reference, including closures over injected values** |
>
> #### 🛑★★★★★ `const` IS A BINDING GUARANTEE, NOT AN IMMUTABILITY GUARANTEE — AND `Object.freeze` IS **SHALLOW**
> **THE SOURCE RULE MUST DECIDE FROZEN-NESS AND PLAIN-DATA-NESS. IT MAY NEVER DECIDE THEM FROM THE DECLARATION KEYWORD.**
> `[MEASURED, `R-534 §1`]` **`Object.isFrozen({}) === false`** — so `const HOLDER = {}` is a fully writable injection target whose declaration reads as a constant.
> ⚠️🛑★★★★★ **AND ONE LEVEL FURTHER, `[MEASURED, `AR-578 §3b`, node v24.13.0]`: `Object.freeze` IS SHALLOW. `Object.isFrozen(Object.freeze({nested:{}}))` RETURNS `true`, AND `SHALLOW.nested.injected = 'LEAK'` **SUCCEEDS.** A top-level `isFrozen` check therefore PASSES an object whose nested holder is still writable — the same leak wearing a frozen wrapper.**
> 🛑★★★★★ **AND THE LEAK REACHES THE PROJECTION — NOT MERELY THE HOLDER `[MEASURED, `R-535 §2`, the desk's own harness, an INDEPENDENT SECOND PATH that EXTENDED the claim rather than accepting it]`:**
> ```
> const HOLDER = Object.freeze({ slot: {} })      // PASSES a top-level isFrozen check
> project({id:"L1",value:"FROM_LANE"})  before -> {"value":"FROM_LANE"}
> HOLDER.slot.read = () => "EXPECTED_FROM_LEDGER" // nested write succeeds
> project({id:"L1",value:"FROM_LANE"})  after  -> {"value":"EXPECTED_FROM_LEDGER"}
> ```
> ★★★★★ **SO A TOP-LEVEL FROZEN-NESS CHECK DOES NOT MERELY FAIL TO HELP — IT PRINTS A GREEN OVER A LIVE COUPLING. `gate-artifact` BIN, one level deeper than the `const` finding.** ✅ **THE RULE THEREFORE DECIDES **DEEP** FROZEN-NESS OVER THE WHOLE REACHABLE PLAIN-DATA GRAPH, and a shallow-frozen nested holder is a `1b-S` FAILURE NAMING THE WRITABLE PATH.** ⚠️ **`R-534 §5.3` said *frozen-ness, not the keyword* — correct and one level short; `R-535 §2` amends it to DEEP, and both legs are measured rather than reasoned.**
>
> #### 🛑★★★★★ THE ADMITTED AST GRAMMAR FOR MODULE-SCOPE CONSTANTS — **BECAUSE "DEEPLY FROZEN" IS A RUNTIME PROPERTY AND `1b-S` RUNS NOTHING**
> ⚠️🛑★★★★★ **THE DEFECT THIS CLOSES, STATED PLAINLY: the clause above requires a PARSER to decide DEEP FROZEN-NESS and PLAIN-DATA-NESS — **RUNTIME properties** — and naming the TypeScript compiler API says **WHO** decides, never **WHAT** it decides on. Four incompatible implementations all read as compliant against the prose alone: primitives-only · recursively-literal frozen trees · trusting an unevaluated `deepFreeze(v)` call · rejecting all composite constants (which makes the GREEN neighbour impossible).** ★★★★★ **`A SEMANTIC PROPERTY IS NOT A STATIC RULE UNTIL ITS ADMITTED SYNTAX IS CLOSED.`**
> ✅ **SO THE ADMITTED SYNTAX IS CLOSED HERE. A module-scope constant is admitted IF AND ONLY IF its declaration matches:**
> ```
> decl      := "const" Ident "=" Frozen                  (never let/var; never reassigned)
> Frozen    := "Object.freeze" "(" ( ObjLit | ArrLit ) ")"   |   Primitive
> ObjLit    := "{" ( Key ":" Frozen ),* "}"
>              Key := Ident | StringLit,  cooked(Key) != "__proto__",
>                                         and all cooked(Key) in one ObjLit DISTINCT
> ```
> #### 🛑★★★★★ `cooked(Key)` — **ONE CANONICAL KEY-IDENTITY FUNCTION, AND EVERY KEY RULE USES IT**
> ```
> cooked(Key) := the TypeScript AST node's COOKED value
>                  Identifier      -> node.escapedText  (unicode escapes already resolved)
>                  StringLiteral   -> node.text         (escape sequences already resolved)
>                NEVER node.getText(), NEVER the raw source slice, NEVER a regex on the file
> ```
> 🛑★★★★★ **BOTH KEY RULES — the `__proto__` prohibition AND duplicate detection — ARE STATED AGAINST `cooked(Key)`, NOT AGAINST SPELLING. A `getText()`-BASED IMPLEMENTATION SATISFIES THE OLD WORDING AND IS WRONG `[MEASURED HERE, node v24.13.0, BOTH escaped forms measured at this desk]`:**
> ```
> Object.freeze({ "\x5f\x5fproto__": p })      -> ownKeys [] ; proto===p TRUE ; inherited 7 ; frozen TRUE
> Object.freeze({ \u005f\u005fproto__: p })  -> ownKeys [] ; proto===p TRUE ; inherited 7 ; frozen TRUE
> Object.freeze({ a:1, "\x61":2 })             -> ownKeys ["a"] ; a=2 ; FIRST VALUE SILENTLY DISCARDED
> Object.freeze({ a:1, \u0061:2 })           -> ownKeys ["a"] ; a=2 ; FIRST VALUE SILENTLY DISCARDED
> CONTROL  { a:1, b:2 }                        -> ownKeys ["a","b"]              stay distinct
> CONTROL  { "\x62":3 } and { \u0062:3 }    -> ownKeys ["b"] ; proto = Object.prototype
> ```
> ★★★★★ **THE TWO CONTROLS DECIDE THE REMEDY'S SHAPE AND THEY ARE WHY THIS RULE TARGETS IDENTITY RATHER THAN ESCAPING: an escaped ORDINARY key is an ORDINARY OWN PROPERTY with an untouched prototype. **ESCAPING IS NOT THE HAZARD. COOKED IDENTITY IS.** Forbidding escaped keys as such would over-forbid on a false premise — the same trap as the computed-`__proto__` discriminator.**
> ⚠️ **HONEST-PARTIAL: `cooked()` is defined for `Identifier` and `StringLiteral` only. A `NumericLiteral` key (`{1: x}`) is FORBIDDEN outright rather than canonicalised, because its cooked identity involves numeric-to-string coercion this design does not specify. `AN UNLISTED CASE FAILS CLOSED.`
> ```
> ArrLit    := "[" ( Frozen ),* "]"                       (no elisions/holes)
> Primitive := StringLit | NumericLit(finite) | "true" | "false" | "null"
> ```
> **FORBIDDEN IN THIS POSITION, EACH REJECTED BY NAME — every one makes deep frozen-ness UNDECIDABLE FROM SOURCE:**
> - ★★★★★ **ANY call expression other than the literal `Object.freeze` wrapper** — including `deepFreeze(x)`, a factory, or any helper. **A CALL'S RETURN VALUE IS NOT VISIBLE TO A PARSER.**
> - ★★★★★ **IDENTIFIER REFERENCE / ALIAS** (`const C = base`) — the alias inherits whatever `base` is, which the rule cannot see at this node.
> - ★★★★★ **SPREAD** (`{...base}`, `[...xs]`) — imports an unbounded, unknown key set.
> - ★★★★★ **COMPUTED KEYS** (`{[k]: v}`) — the key is not statically decidable.
> - ★★★★★ **getters/setters, shorthand methods, function or arrow expressions, `new`, member access, template literals with expressions, conditional/logical operators.**
> - 🛑★★★★★ **THE KEY `__proto__` IN **BOTH LITERAL SPELLINGS** — `{ __proto__: … }` (Ident) AND `{ "__proto__": … }` (StringLit).** ⚠️★★★★★ **IT IS NOT AN ORDINARY KEY: IT IS A PROTOTYPE SETTER, AND IT DEFEATS EVERY OWN-KEY CHECK THIS DESIGN HAS `[MEASURED, `AR-584 §2`, node v24.13.0]`:**
> ```
> Object.freeze({ __proto__: frozenProto })    -> ownKeys []  proto===supplied TRUE
>                                                 inherited REACHABLE   isFrozen TRUE
> Object.freeze({ "__proto__": frozenProto })  -> IDENTICAL on all four
> CONTROL      { a: 1 }                        -> ownKeys ["a"]  proto = Object.prototype
> DISCRIMINATOR{ ["__proto__"]: p } (computed) -> ownKeys ["__proto__"]  proto = Object.prototype
> ```
> ★★★★★ **AN OBJECT SATISFYING THE ADMITTED GRAMMAR, PASSING `isFrozen`, EXPOSING **ZERO OWN KEYS**, AND SERVING REACHABLE INHERITED DATA — with no spread, alias, helper call, computed key, accessor or unfrozen node.** 🛑 **AND IT LANDS ON THE `1b-S`/`1b-R` SEAM: this is a BUILD-TIME constant, so the RUNTIME prototype check at row `42` MAY NEVER SEE IT. `A BUILD-TIME AST RESULT MAY NEVER CERTIFY A RUNTIME PROPERTY` — third time this document has been bitten by its own law.**
> ⚠️★★★★★ **SCOPED TO THE TWO LITERAL FORMS ON PURPOSE: the COMPUTED form `{["__proto__"]: p}` is **NOT** a prototype setter `[MEASURED HERE — ownKeys `["__proto__"]`, prototype unchanged]`. It is forbidden ANYWAY as a computed key, but NOT as a proto channel. `FORBIDDING THE RIGHT THING FOR THE WRONG REASON IS A REMEDY BUILT ON A FALSE PREMISE`, and it would have mis-taught every later reader.**
> - ★★★★★ **DUPLICATE ORDINARY KEYS** — `{ a: 1, a: 2 }`. `[MEASURED, `AR-584 §4`]` **own keys `["a"]`, last value wins, NO ERROR: the first value is SILENTLY DISCARDED.** ⚠️ **A silent last-wins override inside a frozen constant is precisely the class this document exists to refuse, and it is invisible to every own-key check afterwards.**
> ★★★★★ **EVERY NESTED OBJECT AND ARRAY LITERAL CARRIES ITS OWN `Object.freeze` WRAPPER. THAT IS THE ENTIRE POINT — `Object.freeze` IS SHALLOW `[MEASURED, `AR-578 §3b`]`, so a SINGLE outer wrapper is exactly the false green row `38` exists to catch.**
> ⚠️ **HONEST-PARTIAL, AND IT IS A REAL COST: this grammar is DELIBERATELY NARROWER than "all safe constants." A perfectly sound constant built by a helper is REJECTED. **That is a decidability trade accepted on purpose and stated rather than hidden** — `A RULE THAT ADMITS WHAT IT CANNOT DECIDE IS NOT A RULE`, and the alternative is a parser inferring a semantic property it cannot observe.**
>
> #### 🛑★★★★★ `1b-R` — **RUNTIME INPUT-ADMISSION CONTRACT.** SCOPE: **the VALUE handed to `project()`.** ⚠️ **NO SOURCE RULE CAN DECIDE THIS.**
> ★★★★★ **MECHANISM, NAMED — TWO CHECKS, BOTH REQUIRED, BOTH EXECUTED AT THE CALL BOUNDARY BEFORE `project()` READS ANY FIELD, admitting the value or FAILING THE RUN with the offending key named:**
> **(i) A PROPERTY-DESCRIPTOR WALK (`Object.getOwnPropertyDescriptors`)** — rejects OWN accessors and OWN function-valued fields.
> **(ii) ★★★★★ A RECURSIVE PROTOTYPE-IDENTITY CHECK** — at EVERY node of the reachable graph, `Object.getPrototypeOf(v)` must be **`Object.prototype`**, **`null`**, or **`Array.prototype` where `Array.isArray(v)`**. Anything else is REJECTED, naming the path.
> 🛑★★★★★ **(ii) IS NOT BELT-AND-BRACES — WITHOUT IT THE MECHANISM DOES NOT DELIVER THIS CONTRACT'S OWN PROMISE, AND I PROVED THAT AGAINST MY OWN FIRST DRAFT OF THIS CLAUSE `[MEASURED HERE, `AR-579 §3`, node v24.13.0]`:**
> ```
> class Lane { read() { return 'EXPECTED_FROM_LEDGER' } }   // reader on the PROTOTYPE
> ownDescriptorWalk(new Lane())        -> []                 <-- NOT CAUGHT
> new Lane().read()                    -> EXPECTED_FROM_LEDGER   (capability fully reachable)
> const child = Object.create({ get bindings(){ ...ledger... } })
> ownDescriptorWalk(child)             -> []                 <-- NOT CAUGHT
> child.bindings                       -> LEDGER_VALUE_VIA_PROTO_GETTER
> prototype-identity check: plain literal PASS · Object.create(null) PASS
>                           class instance FAIL · proto-getter child FAIL   invocations = 0
> ```
> ★★★★★ **`Object.getOwnPropertyDescriptors` IS **OWN-PROPERTIES ONLY**, AND `1b-R` PROMISES TO REJECT *"objects carrying methods · prototype-bearing class instances"* — SO THE DESCRIPTOR WALK ALONE IS A PROMISE WITHOUT A CATCHER.** ⚠️★★★★★ **THAT IS THE `R-533 §2` SPECIES, REINTRODUCED **IN THE REMEDY** BY THE FIRST DRAFT OF THIS VERY CLAUSE — THE THIRD CONSECUTIVE ROUND IN WHICH A NAMED CATCHER FAILED TO COVER ITS OWN PROMISE. `MY REMEDIES LAND CORRECT AND ONE LEVEL SHORT` IS NOT A DESK PROPERTY; IT IS A SEAT-INDEPENDENT ONE.** ✅ **The promise is KEPT and the catcher was BUILT UP TO IT.**
> ⚠️ **`Array.prototype` is admitted deliberately: a recursive plain-root check that omits it REJECTS LEGITIMATE ARRAY DATA `[MEASURED HERE]`. `A GUARD THAT REJECTS THE VALID CASE IS NOT A STRICTER GUARD, IT IS A BROKEN ONE.`**
> | surface (`1b-R`) | ALLOWED (closed set) | FORBIDDEN — the check NAMES the offending key |
> |---|---|---|
> | **the lane object + the frozen normalization contract** | **THE CLOSED RUNTIME GRAMMAR below — nothing else** | ★★★★★ **any accessor (`get`/`set`) descriptor · any function-valued field · callbacks · thunks · objects carrying methods · prototype-bearing class instances · symbol keys · cycles · non-enumerable user fields · `undefined`/bigint/`NaN`/±Infinity** |
>
> #### 🛑★★★★★ THE CLOSED RUNTIME GRAMMAR — **ONE GRAMMAR, TOTAL OVER THE ADMITTED VALUE. ANYTHING NOT PRODUCED BY IT IS REJECTED BY NAME.**
> ```
> value    := leaf | container
> leaf     := null | boolean | number(FINITE) | string
> container:= array | object(PLAIN)
> array    := own enumerable string keys are EXACTLY "0".."length-1", each a DATA descriptor
>             whose value is a `value`            (no holes · no extra named properties)
> object   := own ENUMERABLE STRING-KEYED DATA descriptors only, each value a `value`,
>             prototype is Object.prototype or null
> ```
> **FORBIDDEN, EACH REJECTED WITH ITS PATH NAMED:** accessor (`get`/`set`) descriptors · function values · **symbol keys** · **non-enumerable user fields** · `undefined` · `bigint` · symbol values · **`NaN`** · **`±Infinity`** · custom/class prototypes · **cycles**.
> ★★★★★ **THE THREE CASES `R-536 §4.2` ORDERS DECIDED EXPLICITLY — DECIDED BY MEASUREMENT, NOT BY PREFERENCE `[MEASURED HERE, `AR-580 §3`, node v24.13.0]`:**
> - **SPARSE HOLES → FORBIDDEN.** `[1,,3]` has own keys `["0","2","length"]`; **index `1` is ABSENT, not `undefined`.** A hole is a THIRD state next to *present* and *null*, and this design's whole `MISSING`/`null`/value discipline forbids a silent third state. **The array rule requires the enumerable index set to be exactly `0..length-1`.**
> - **`length` → ADMITTED, NOT TRAVERSED.** It is an own key but **NOT ENUMERABLE**, so the *"own enumerable"* clause excludes it structurally rather than by special case. ★★ **Stated anyway, because a rule that excludes something accidentally is one refactor from including it.**
> - **EXTRA NAMED ARRAY PROPERTIES → FORBIDDEN.** `arr.note = 'x'` yields own keys `["0","1","length","note"]` and **`note` IS enumerable**, so it WOULD pass a naive object rule applied to an array. **It is forbidden explicitly.**
> 🛑★★★★★ **AND WHY `NaN`/`±Infinity`/`undefined` ARE FORBIDDEN RATHER THAN MERELY DISLIKED — THIS IS A CROSS-LANE CORRECTNESS MATTER, NOT TIDINESS `[MEASURED HERE]`: `JSON.stringify({a:NaN, b:Infinity, c:undefined})` → `{"a":null,"b":null}`. **`NaN` AND `Infinity` BECOME `null`; `undefined` IS DROPPED ENTIRELY.** A lane emitting `NaN` and a lane emitting `null` WOULD COMPARE AS EQUAL AFTER TRANSPORT.** ★★★★★ **`AGREEMENT MANUFACTURED BY THE TRANSPORT IS NOT AGREEMENT BETWEEN THE LANES` — and a dropped key silently becomes `MISSING`, collapsing the exact three-state distinction §SURFACE 1 exists to protect.**
> ⚠️ **HONEST-PARTIAL: this grammar is TOTAL over the five projected fields' value space as measured at `c304b098`. It is NOT claimed total over arbitrary JS. A value class outside it is REJECTED BY DEFAULT AND NAMED — `AN UNLISTED CASE FAILS CLOSED`, never *"assume plain data"*.**
>
> #### 🛑★★★★★ SAFE TRAVERSAL — **DESCRIPTOR-FIRST, SYMBOL-VISIBLE, PROTOTYPE-CHECKED, CYCLE-BOUNDED**
> 1. ★★★★★ **`project()` READS NO FIELD BEFORE THAT FIELD'S DESCRIPTOR IS ADMITTED.** The walk obtains the DESCRIPTOR and never the VALUE of an unadmitted key — **that is what keeps the getter invocation count at `0`.**
> 2. ★★★★★ **ENUMERATE WITH `Reflect.ownKeys`, NEVER `Object.keys`** `[MEASURED HERE, `AR-580 §2`]`: on an object carrying a symbol-keyed function, `Object.keys(getOwnPropertyDescriptors(v))` returns `["id"]` — **the capability is ABSENT** — while `Reflect.ownKeys` returns it. **`A DESCRIPTOR EXISTS EVEN WHEN STRING-KEY ENUMERATION CANNOT SEE IT`, and string-key enumeration used to certify an object symbol-free is a STOP CONDITION.**
> 3. ★★★★★ **PROTOTYPE-IDENTITY CHECKED AT EVERY NODE** — `Object.getPrototypeOf(v)` ∈ {`Object.prototype`, `null`, `Array.prototype` where `Array.isArray(v)`}.
> 4. 🛑★★★★★ **CYCLE POLICY, EXPLICIT AND MANDATORY: AN **ACTIVE-PATH SET** — a node is added on entry and **RELEASED ON UNWIND** — NEVER A PERMANENT VISITED-SET.** A cycle is REJECTED with its path NAMED (`cycle:$.self`), the walk **TERMINATES BOUNDED**, and the run yields a real verdict.
> ⚠️🛑★★★★★ **BOTH HALVES OF THAT ARE MEASURED, AND THE SECOND IS THE ONE THAT BITES `[MEASURED HERE, `AR-580 §2`]`:**
> ```
> naive recursion over a self-cycle        -> THREW RangeError   <-- NO VERDICT AT ALL
> ACTIVE-PATH   on the cycle               -> ["cycle:$.self"]   terminated + named
> ACTIVE-PATH   on {p:shared, q:shared}    -> []                 GREEN — a DAG is legal
> PERMANENT set on {p:shared, q:shared}    -> ["cycle:$.q"]      *** FALSE REJECT ***
> ```
> ★★★★★ **A `RangeError` IS NOT A RED RESULT — IT IS THE ABSENCE OF A RESULT, and in a gate it fails the run for a reason unrelated to the property under test.** ⚠️★★★★★ **AND THE PERMANENT VISITED-SET IS THE OBVIOUS IMPLEMENTATION AND IT IS WRONG: REPEATED IDENTITY IS NOT A CYCLE. `A GUARD THAT REJECTS THE VALID CASE IS NOT A STRICTER GUARD, IT IS A BROKEN ONE` — third surface for that law in two rounds (`Array.prototype`, now the DAG).**
> 🛑★★★★★ **WHY THIS CANNOT BE A BUILD-TIME CHECK, `[MEASURED, `R-534 §2`]`: a getter on the runtime input carried the ledger value through a module whose SOURCE IS SPOTLESS — `project()` returned `LEDGER_VALUE_VIA_GETTER`. **THE DANGEROUS BEHAVIOUR LIVES IN THE INPUT'S PROPERTY DESCRIPTOR, NOT IN THE MODULE'S SYNTAX**, and no AST can reach it.** ★★★★★ **THIS IS THE ENTIRE REASON `1b` IS SPLIT. A BUILD-TIME AST RESULT USED TO CERTIFY A RUNTIME OBJECT'S PROPERTY DESCRIPTORS IS A STOP CONDITION, NOT A SHORTCUT.**
> ★★★★★ **THIS EXISTS BECAUSE REQUIREMENT `4` PROMISES TO REJECT A `captured reference` AND THE FOUR RED-PROOFS BELOW WERE ALL IMPORT-BASED — A PROMISE WHOSE NAMED CATCHER LIST COULD NOT COVER THE PROMISED CHANNEL.** `NO PROMISE MAY EXIST WITHOUT A MATCHING CATCHER.` ⚠️ **The promise was NOT narrowed to fit the weak catcher: `NARROWING A PROMISE TO MATCH A WEAK CATCHER IS A TEST WEAKENED TO PASS.`**
> ⚠️★★★ **AND `:99`'s BAN ON CALLBACKS IN THE PROJECTION DATA CONTRACT DOES NOT DISCHARGE `1b-S`: that is the ARGUMENT surface — now `1b-R` — this is the MODULE surface, and a zero-import module can still receive an expectation reader through an exported setter.** `TWO DIFFERENT SURFACES, TWO DIFFERENT CLOSURES, TWO DIFFERENT MECHANISMS.`
> 2. **THE PROJECTION CONTRACT IS A CLOSED SCHEMA OF PLAIN DATA** — the five raw fields and their three presence states. ⚠️ **NO functions, NO callbacks, NO opaque objects, NO thunks.** `A CALLBACK IS A LEDGER READER WEARING A PARAMETER'S CLOTHES.`
> 3. ★★★★★ **BOTH LANE PROJECTIONS ARE SEALED BEFORE THE LEDGER IS PARSED.** Sequencing is the part a reviewer can actually check: **if the ledger is not yet in memory, no projection can have consulted it**, and the seal is a digest taken at that point.
> 4. **TWO CHECKS FAIL THE RUN, AND THEY ARE REPORTED SEPARATELY.** ⚠️★★★★★ **`4a` BUILD-TIME (`1b-S`, parser-based): any forbidden import path, dynamic-load construct, mutable module-scope holder, direct ambient read, or captured reference reaching `project()`'s closure — **names the offending symbol/path.** · `4b` RUNTIME (`1b-R`, **THE COMPOSITE ADMISSION WALK** at the call boundary — **descriptor inspection *AND* `Reflect.ownKeys` symbol-visible enumeration *AND* recursive prototype-identity *AND* an active-path cycle policy**): any value outside the CLOSED RUNTIME GRAMMAR — **names the offending key AND its path.**
> 🛑★★★★★ **`4b` IS NEVER A DESCRIPTOR WALK ALONE. AN OWN-DESCRIPTOR CHECK MISSES PROTOTYPE-BORNE CAPABILITIES, SYMBOL KEYS AND CYCLES — ALL THREE MEASURED `[`AR-579 §1`, `AR-580 §2`]`. A SUMMARY PERMITTING DESCRIPTOR-ONLY ADMISSION IS A STOP CONDITION.**
> 🛑★★★★★ **NEITHER RESULT MAY BE REPORTED AS THE OTHER, AND A GREEN `4a` IS NOT EVIDENCE FOR `4b`.** `SOURCE TOPOLOGY IS NOT RUNTIME VALUE SHAPE.`
> 5. ★★★★★ **A WHOLE-EXPECTATION-SURFACE MUTATION: perturb EVERY expectation in the ledger at once; the required result is an IDENTICAL PROJECTION DIGEST.**
> ⚠️🛑★★★★★ **AND ITS SCOPE, STATED BECAUSE THE PREVIOUS REVISION OVERCLAIMED IT: this proves `INVARIANCE UNDER THIS MUTATION, OVER THE EXERCISED 43-ROW POPULATION.` **IT DOES NOT PROVE NON-REACHABILITY.** A forbidden read of `classification`, ledger LENGTH, schema version, citations or scope digest survives this mutation untouched — as does any branch those `43` rows never execute.**
> 🛑★★★★★ **THE DELETED SENTENCE WAS *"a capability argument can be wrong about the mechanism; A DIGEST THAT DID NOT MOVE CANNOT."* **THAT IS A UNIVERSAL AND IT IS FALSE.** `R-530` retired one false absolute here and the replacement was ANOTHER absolute one level out.** ★★★★★ **`AN UNCHANGED DIGEST PROVES INVARIANCE UNDER THE MUTATION YOU RAN, NOT THE IMPOSSIBILITY OF EVERY COUPLING YOU DID NOT RUN.`** ✅ **The mutation is KEPT — it is a strong behavioural control. Only its quantifier is gone.**

> ### 🛑★★★★★ THE CAPABILITY CONTRACT — **ONE OPTION, CHOSEN. THE MENU IS DELETED.**
> ✅★★★★★ **CHOSEN: (b) A NON-ADVERSARIAL PURE-MODULE CONTRACT, ENFORCED BY TWO LAYERS — A PARSER-BASED SOURCE RULE (`1b-S`) AND A RUNTIME DESCRIPTOR WALK (`1b-R`).** `project()` lives in a module whose **transitive import closure is enumerated and frozen**, and a build-time **TypeScript-compiler-API rule FAILS THE BUILD** if that closure acquires any ledger or oracle reader, any filesystem/network module, any dynamic-load construct, any mutable module-scope holder, or any direct ambient read. ⚠️★★★★★ **AND BECAUSE A PARSER CANNOT SEE A RUNTIME VALUE'S SHAPE, THE VALUE HANDED TO `project()` IS ADMITTED SEPARATELY AT RUNTIME BY THE **COMPOSITE ADMISSION WALK** — descriptor inspection **AND** `Reflect.ownKeys` symbol-visible enumeration **AND** recursive prototype-identity **AND** an active-path cycle policy, against the CLOSED RUNTIME GRAMMAR.** 🛑 **NOT a descriptor walk alone; that form is a measured false green.**
> 🛑★★★★★ **AND ITS CLAIM IS NARROWED TO WHAT THAT MECHANISM CAN ACTUALLY DELIVER: IT PREVENTS *ACCIDENTAL* COUPLING. IT IS **NOT** A SANDBOX AND DOES **NOT** MAKE THE LEDGER UNREACHABLE TO DETERMINED CODE.** A module that wants the ledger can still read it through `globalThis`, an env var, or a dependency that changes behaviour after review. **THAT IS THE HONEST CEILING OF THIS OPTION AND IT IS STATED RATHER THAN IMPLIED.**
> ⚠️★★★★★ **WHY (a) WAS NOT CHOSEN, SAID PLAINLY: a genuinely restricted runtime would be STRONGER, and I cannot NAME an enforcement mechanism for it on this host today, nor red-proof each forbidden channel.** ★★★ **`AN UNNAMED MECHANISM CANNOT BE VERIFIED, WHATEVER THE OS DOES` — and `A TOPOLOGY STATEMENT IS NOT A CAPABILITY PROOF`. Writing *"separate process"* and calling it filesystem isolation would have been the previous two false absolutes wearing a third costume: `A CHILD PROCESS IS A BOUNDARY FOR STATE, NOT AUTOMATICALLY A BOUNDARY FOR AUTHORITY.`**
> ✅ **THREAT MODEL, EXPLICIT: this contract defends against an implementer WIRING THE LEDGER IN BY MISTAKE — the failure this whole arc has actually suffered, four times, every one of them accidental. It does not defend against a hostile implementer, and no claim here should be read as if it does.**
> **RED-PROOFS IT OWES — EVERY CHANNEL IT CLAIMS TO DENY, EACH NAMING ITS OFFENDING SYMBOL/KEY, EACH WITH A GREEN DISCRIMINATING NEIGHBOUR. `4a` = build-time (`1b-S`), `4b` = runtime (`1b-R`):**
> **`4a` — EVERY SOURCE CHANNEL, ONE PLANTABLE SUBCASE EACH:** add a ledger-reader import to the closure · add a filesystem module · add a transitive dependency that pulls in either · 🛑★★★★★ **the one the import-based four cannot reach: INJECT AN EXPECTATION READER THROUGH A MODULE-LOCAL SETTER OR CALLBACK **WHILE THE IMPORT GRAPH STAYS CLEAN**** · ★★★★★ **THE THREE DISTINCT FORBIDDEN EXPORT FORMS, PLANTED SEPARATELY: a setter/configuration export · a function-valued export other than `project` · an export that MUTATES module state** ⚠️ **(one setter shape cannot certify three promises)** · ★★★★★ **THE DYNAMIC-LOAD FORMS, PLANTED SEPARATELY: `import()` · `require` with a computed specifier · `eval` · `new Function` · `createRequire`** · ★★★★★ **`globalThis` **AND** an ALIAS — `global` `[MEASURED HERE, node v24.13.0: `global === globalThis` is `true` on this host]` — because the contract forbids *"ANY host-global identifier not in the allow-list"* and **A QUANTIFIER OF `any` IS NOT DISCHARGED BY ONE REPRESENTATIVE**** · ★★★★★ **direct environment read (`process.env`)** · ★★★★★ **a mutable cache / lazily-initialised holder WITH NO SETTER EXPORT** ⚠️ **(the setter subcase does not cover it — this one is written and read entirely inside the module)** · ★★★★★ **a SHALLOW-frozen nested holder that PASSES a top-level `Object.isFrozen`.**
> **`4b` — EVERY RUNTIME CHANNEL THE COMPOSITE WALK CLAIMS TO DENY:** ★★★★★ **a FUNCTION-VALUED FIELD** · ★★★★★ **a GETTER/ACCESSOR, CARRYING AN INVOCATION COUNTER WHOSE REQUIRED VALUE IS `0`** · ★★★★★ **a PROTOTYPE-BORNE method or INHERITED getter** · ★★★★★ **a SYMBOL-KEYED function capability** · ★★★★★ **a CYCLE** · ★★★★★ **EACH UNSUPPORTED VALUE CLASS SEPARATELY — `undefined` · `bigint` · a SYMBOL VALUE · `NaN` · `±Infinity`** · ★★★★★ **EACH ARRAY-SHAPE VIOLATION SEPARATELY — a SPARSE HOLE · an EXTRA NAMED ARRAY PROPERTY** · ★★★★★ **a NON-ENUMERABLE USER FIELD** — each on the runtime input, each with the module source SPOTLESS.
> ⚠️🛑★★★★★ **THE LAST THREE GROUPS WERE ABSENT FROM THIS CARRIER FOR ONE REVISION, AND THE REASON IS THE LAW ITSELF RE-ARMING: I swept the prototype requirement into every carrier AS ORDERED, then ADDED rows `45`–`47` IN THE SAME EDIT AND DID NOT RE-SWEEP.** ★★★★★ **`AN ADDED REQUIREMENT DOES NOT EXIST UNTIL EVERY OPERATIVE CARRIER NAMES IT` APPLIES TO THE REQUIREMENT YOU ADD *WHILE OBEYING IT*. THE SWEEP IS NOT AN ACT; IT IS AN OBLIGATION THAT RE-ARMS ON EVERY ADDITION.**
> 🛑★★★★★ **THE ADMITTED INSPECTION IDIOM FOR *OWN-DESCRIPTOR* INSPECTION IS `Object.getOwnPropertyDescriptors`, AND IT IS THE SOLE ADMITTED ONE **FOR THAT SUB-CHECK** `[MEASURED, `AR-578 §2`, node v24.13.0, invocation counter]`. **EXCLUDED BECAUSE EACH WAS MEASURED INVOKING THE GETTER EXACTLY ONCE: spread `{...lane}` · `JSON.stringify` · `Object.values` · `Object.entries` · `structuredClone`.**** ★★★★★ **`THE OBVIOUS WAY TO INSPECT A VALUE IS THE WAY THAT EXECUTES IT` — `5` of `7` idioms, measured twice by two independently authored harnesses.**
> ⚠️🛑★★★★★ **AND THE SCOPE OF *"SOLE ADMITTED"* IS FIXED HERE, BECAUSE UNQUALIFIED IT WAS A REGRESSION IN THREE OPERATIVE SUMMARIES `[`R-536 §1`, anchored carrier census]`: IT DESCRIBES **OWN-DESCRIPTOR INSPECTION ONLY.** IT MAY **NEVER** DESCRIBE THE WHOLE `1b-R` MECHANISM — that is the composite walk, and `Object.getOwnPropertyDescriptors` alone is OWN-PROPERTIES-ONLY and STRING-KEY-BLIND.** ★★★★★ **`AN ADDED REQUIREMENT DOES NOT EXIST UNTIL EVERY OPERATIVE CARRIER NAMES IT` — the inverse of the withdrawal law, and this document has now been bitten by both directions.**
> ⚠️★★★★★ **AND A CORRECTION TO THE DISPATCH THAT ORDERED THIS CLAUSE, RECORDED RATHER THAN OBEYED: `R-534 §5.5` offers *"`Object.getOwnPropertyDescriptors` (or `Object.keys`)"*. **`Object.keys` IS DISQUALIFIED AS A CATCHER** `[MEASURED HERE]` — it is invocation-safe (count `0`) but returns bare key names carrying NO descriptor information, **so it cannot decide accessor-ness at all.** It is admissible for safe ENUMERATION and never for DETECTION.** ★★★★★ **`AN IDIOM THAT DOES NOT RUN THE CAPABILITY IS NOT THEREBY AN IDIOM THAT SEES IT.`**
> ★★★★★ **GREEN DISCRIMINATING NEIGHBOURS, SO NO ROW DEGENERATES INTO `reject everything`:** a module-scope DEEPLY-FROZEN plain-data constant stays GREEN (vs the setter/cache rows) · a ZERO-IMPORT module stays GREEN (vs the import rows) · the INTRINSIC `Object.freeze` with every nested literal wrapped stays GREEN (vs rows `38`/`48`/`50`) · an ORDINARY key and DISTINCT keys stay GREEN (vs rows `51`/`52`) · a plain-data lane object with the identical KEY SET stays GREEN (vs **ALL EIGHT** `4b` rows — `39,40,42,43,44,45,46,47`). `A CONTROL MUST DISCRIMINATE, NOT MERELY TRIGGER.`
> ⚠️ **A channel this contract does NOT claim to deny gets NO red-proof and NO claim — post-review dependency behaviour is named OUT OF SCOPE rather than left to be assumed covered.** ✅★★★ **`globalThis` and environment reads are NO LONGER out of scope: `1b-S` gives each its own row and each its own red-proof, so they are now promised AND caught.**
> 🛑★★★★★ **AND THE SCOPE OF *"PROMISED AND CAUGHT"* IS NARROWED HERE, ONCE, EXPLICITLY: IT MEANS **DIRECT SYNTACTIC CHANNELS** — a construct a parser can name in the module's own source, or a descriptor the runtime walk can name on the admitted value. **ADVERSARIAL OBFUSCATION AND REFLECTION ARE OUTSIDE THE THREAT MODEL AND CARRY NO CLAIM:** computed member access, string-built identifiers, `Proxy` traps, and anything reached by `eval`-class evaluation are **NOT** claimed to be caught.**
> ⚠️🛑★★★★★ **TWO ITEMS WERE STRUCK FROM THAT LIST BECAUSE THEY CONTRADICTED ROWS THIS DESIGN ALREADY CARRIES — MY OWN DEFECT, FOUND BY THE CARRIER CENSUS AND NOT BY ANY READ:**
> - **`prototype-chain injection` WAS LISTED AS *NOT CAUGHT* WHILE ROW `42` CATCHES EXACTLY IT** (a prototype-borne method or inherited getter on the runtime input, caught by the recursive prototype-identity check). **A DOCUMENT CANNOT DISCLAIM A CHANNEL IT PROVES IT CATCHES.** ✅ **Struck — it is IN scope and CAUGHT.**
> - **`Reflect.*` WAS LISTED AS *NOT CAUGHT* WHILE THE TRAVERSAL NOW MANDATES `Reflect.ownKeys` AS ITS ENUMERATION MECHANISM.** ⚠️ **The two senses were being conflated: `Reflect.ownKeys` AS OUR INSTRUMENT is required; adversarial use of reflection TO HIDE a capability remains out of scope.** ✅ **Disambiguated rather than deleted — SYMBOL KEYS specifically are now IN scope and CAUGHT BY ROW `44`, because a symbol key is a DIRECT SYNTACTIC channel a descriptor walk can name, not an obfuscation.**
> ⚠️🛑★★★★★ **THIS SENTENCE CITED ROW `45` AND ROW `44` FOR THE SAME CLAIM FOR TWO REVISIONS, AND THE MECHANISM IS WORTH MORE THAN THE TYPO: I NOTICED THE MISSING CITATION AND **APPENDED A CORRECT ONE INSTEAD OF CORRECTING THE WRONG ONE**, SO BOTH SURVIVED IN ONE SENTENCE — a reader following the first citation lands on the NON-CONFORMING VALUE CLASS row, which does not catch symbol KEYS at all.** ★★★★★ **`A CITATION REPAIRED BY ADDITION LEAVES THE DEFECT IN PLACE AND GIVES IT A WITNESS` — the same additive-repair shape that left `OR A SEPARATE PROCESS` standing one paragraph above the section that deleted it.** ⚠️ **Rows `44` (symbol KEY) and `45` (symbol VALUE) are UNCHANGED and were always correct; only this citation was wrong.**
> ★★★★★ **`A DISCLAIMER THAT OUTLIVES ITS CATCHER IS A FALSE ADVERTISEMENT IN THE OTHER DIRECTION` — it invites an implementer to skip a check the matrix requires.** ⚠️★★★★★ **THIS NARROWS THE **CLAIM**, NEVER A PROMISE ALREADY MADE: every channel listed in `1b-S`/`1b-R` KEEPS its red-proof. `NARROWING A PROMISE TO MATCH A WEAK CATCHER IS A TEST WEAKENED TO PASS` — what is narrowed here is the ADVERTISED REACH of a contract that was never adversarial, which §THREAT MODEL already said in words and this states as a boundary.**
> ★★★★★ **WHY THIS IS THE LOAD-BEARING ITEM AND NOT HOUSEKEEPING: `A PREDICATE'S OPERAND IS PART OF ITS AUTHORITY. IF "PROJECTION" NEEDS THE EXPECTED ANSWER TO DECIDE WHAT TO PROJECT, AGREEMENT HAS ALREADY CONSUMED THE ORACLE`** — and claim `A` would no longer be independent of claim `B`, which is the single property the three-claim split exists to guarantee.
> ⚠️★★★★★ **AND THE DEFECT WAS IN THIS DOCUMENT, NOT IN THE SHIPPED GATE — SAID PLAINLY SO NOBODY REPAIRS THE WRONG OBJECT.** `[MEASURED, `c304b098:scripts/check-spec-binding-plan-parity.ts`]` the gate's `projectExhaustively(raw, map, path, out)` **takes no expectation argument**, and the oracle predicates read the projected `got.reason` against the separate `want.*` in a separate function. **The previous version of the table below listed `reason_names` and `reason_excludes` as *axes* whose *"normalization"* was a *"substring/zone-naming predicate"* and an *"exclusion predicate"*.** ★★★★★ **`A PREDICATE IS NOT A NORMALIZATION: A NORMALIZATION MAPS ONE VALUE, A PREDICATE NEEDS TWO` — and the second operand was the ledger string. An implementer following that table literally would have had to hand the expectation to `project()` to produce those columns. `THE DESIGN WOULD HAVE MANUFACTURED A COUPLING THE CODE DID NOT HAVE.`**

> ### ★★★★★ SURFACE 1 — **THE PROJECTION.** FIVE RAW FIELDS. **NO PREDICATES LIVE HERE.**
> **This is the entire input to claim `A`.** `[MEASURED at `c304b098`; row identity is `condition_id`]`
>
> | projected field | raw path (both lanes) | normalization | recorded states |
> |---|---|---|---|
> | `bindable` | `bindings[condition_id].bindable` | direct boolean | `MISSING` · `null` · `true`/`false` |
> | `session_zone` | `bindings[condition_id].session_zone` | ⚠️ **STRUCTURAL** compare, **not `===`** | `MISSING` · `null` · value |
> | `approximation` | `bindings[condition_id].approximation` | direct boolean | `MISSING` · `null` · `true`/`false` |
> | `primitive` | `bindings[condition_id].primitive` | identity — **the VALUE, not a nullness flag** | `MISSING` · `null` · string |
> | `reason` | `bindings[condition_id].reason` | identity — **the CANONICAL STRING, not a predicate result** | `MISSING` · `null` · string |
>
> ⚠️★★★★★ **`MISSING`, JSON `null`, AND A VALUE ARE THREE STATES, NEVER TWO.** Claim `A` compares the full three-state projection field-by-field; collapsing `MISSING` into `null` is how an absent projection acquires a legitimate-looking value.
> ★★★ **`primitive` AND `reason` ARE PROJECTED AS THEMSELVES.** The old table projected `primitive_null` — a derived boolean — which would have discarded the value and let two lanes emitting **different non-null primitives** agree perfectly on `false`. **A DERIVED BOOLEAN IS A LOSSY PROJECTION, AND A LOSSY PROJECTION MAKES AGREEMENT EASIER TO OBTAIN THAN IT SHOULD BE.**

> ### ★★★★★ SURFACE 2 — **THE TS-SOURCE ↔ WIRE MAPPING.** `[NO LONGER A DECLARED UNKNOWN — ENUMERATED AND FROZEN HERE]`
> `[MEASURED at `c304b098`: TS `BINDING_KEY_MAP` (`scripts/check-spec-binding-plan-parity.ts:259`, `satisfies Record<keyof ConditionBinding, string>`) · Python `ConditionBinding.to_dict()` (`src/engine/spec_family_bindings.py:419`)]`
>
| # | TS source field | TS wire name | Python dataclass field | Python wire name | identical? |
|---|---|---|---|---|---|
| 1 | `bindable` | `bindable` | `bindable` | `bindable` | ✅ identity |
| 2 | `sessionZone` | `session_zone` | `session_zone` | `session_zone` | ⚠️ **TS RENAMES** (camel → snake) |
| 3 | `approximation` | `approximation` | `approximation` | `approximation` | ✅ identity |
| 4 | `primitive` | `primitive` | `primitive` | `primitive` | ✅ identity |
| 5 | `reason` | `reason` | `reason` | `reason` | ✅ identity |
>
> ★★★★★ **FOUR OF FIVE ARE IDENTITY IN BOTH LANES; EXACTLY ONE IS A REAL RENAME — AND IT IS `session_zone`, THE SAME FIELD THAT REQUIRES STRUCTURAL RATHER THAN `===` COMPARE.** The one field whose NAME is transformed is the one field whose VALUE is compared non-trivially, so it is the highest-risk cell in this table and is named as such.
> ⚠️ **Python's dataclass field names are already the wire names — `to_dict()` is identity for all five — so ALL rename risk in this system is on the TS side, concentrated in `BINDING_KEY_MAP`.**
> ✅★★★ **THE `[DECLARED UNKNOWN]` THAT USED TO STAND HERE IS RETIRED, AND THE REASON IT COULD BE RETIRED CONVICTS ITS AUTHOR: the answer was one `git grep BINDING_KEY_MAP` away the entire time.** `A DECLARED UNKNOWN IS ADMISSIBLE ONLY WHILE IT IS ACTUALLY UNKNOWN` — declaring it is honest; **leaving it declared once it is cheap to close is not, and the campaign rewards the declaration precisely so that somebody goes and closes it.**
> **RED-PROOF RETARGETED AT THIS TABLE, NOT AT AN INVENTED SURROGATE:** change any one mapping's wire name, or delete an entry, and the run must go RED naming the exact key. ★★ **The proof points at a real, enumerated object; before this revision it pointed at a layer the document said it had not named.**
> 🛑★★★★★ **BUT THE CATCHER I NAMED FOR IT CANNOT CATCH IT, AND THAT IS A FAILED PROOF EVEN THOUGH THE RUN WOULD GO RED.** `[MEASURED, `c304b098:…parity.ts:285-338`]` `projectExhaustively()` compares **SOURCE** key sets (`Object.keys(raw)` vs `Object.keys(map)`), detects **DESTINATION COLLISIONS ONLY** (`seen.set(dest, …)` → `DUPLICATE DESTINATION`), and reports `UNCONSUMED MAPPING ENTRY`. **THERE IS NO DESTINATION-MEMBERSHIP CHECK AGAINST A FROZEN WIRE SCHEMA.** ⚠️★★★★★ **So renaming `sessionZone: "session_zone"` → `sessionZone: "sessionZone"` leaves the source sets identical, the destination unique and the entry consumed — ALL FOUR NAMED CHECKS STAY SILENT.** The run still reddens, but via `diffDeep()`, **a different catcher.** ★★★★★ **`A MUTATION IS EVIDENCE FOR THE CATCHER THAT CAUGHT IT, NOT FOR THE ONE YOU NAMED` — and `A RED EXIT IS NOT EVIDENCE FOR THE CHECK YOU CLAIMED.`**

> ### 🛑★★★★★ CONTRACT 2b — **TWO STAGES: VALIDATE ALL TEN, THEN SELECT FIVE.** (replaces the five-key closed schema, which was UNIMPLEMENTABLE)
> ⚠️★★★★★ **THE PREVIOUS REVISION FROZE A FIVE-KEY *CLOSED DESTINATION SCHEMA* BESIDE A SOURCE MAP THAT IS COMPILE-TIME EXHAUSTIVE OVER TEN RAW FIELDS. `[MEASURED HERE, `c304b098`, counted programmatically]` `BINDING_KEY_MAP` = `10` entries, `satisfies Record<keyof ConditionBinding, string>`; the Python `ConditionBinding` dataclass = the same `10` fields; **the five keys my schema would have REJECTED are `condition_id` · `executed` · `object` · `role` · `type`.**
> 🛑★★★★★ **THE TWO CONTRACTS COULD NOT BOTH BE SATISFIED: pass all ten and the five-key schema rejects five legitimate destinations · pass five and the exhaustive check flags the other five as EXTRA · pre-select five before the guard and **THE SELECTOR BECOMES A SILENT-DROP SURFACE THE "EXHAUSTIVE" CHECK NEVER SEES.** `A CLOSED SCHEMA IS A CLAIM ABOUT A KEY SET, AND A KEY-SET CLAIM IS ONLY TRUE RELATIVE TO THE SET IT WAS JOINED AGAINST` — I froze one without joining it against the map it was meant to close.
>
> **STAGE 1 — FULL NORMALIZATION. THE WHOLE OBJECT, BEFORE ANYTHING IS DISCARDED.**
> Validate the complete `10`-field raw `ConditionBinding` against the complete `10`-entry source map **AND** a complete `10`-key destination schema. **Both set differences empty, BOTH directions, at BOTH ends.** Unknown raw key · unmapped raw key · unknown destination · missing destination · duplicate destination · unconsumed mapping entry ⇒ **RED, key NAMED.**
> **STAGE 2 — CLAIM-`A` SELECTION. FROM THE ALREADY-VALIDATED OBJECT.**
> Select exactly the `5` projection keys `{bindable, session_zone, approximation, primitive, reason}`, **validate that selection in both directions against a frozen selector list**, then **SEAL** (digest taken here).
> ⚠️★★★★★ **THE ORDER IS THE WHOLE POINT: `VALIDATE THE FULL OBJECT BEFORE SELECTING THE MEASURED SUBSET, OR THE SELECTOR BECOMES THE OMISSION MECHANISM.` A field dropped before the boundary is validated is a field nobody ever proves was there.**
> ✅ **`condition_id` REMAINS ROW IDENTITY** and per-lane emitted uniqueness (CONTRACT 2c) is checked **BEFORE stage 2.**
> ✅ **`type` · `role` · `object` · `executed` ARE EXPLICITLY OUT OF CLAIM `A`** — they are **not** silently discarded: they pass stage 1's full boundary, are named here as out-of-frame for agreement, and remain available to other claims. ★★ **Declaring an exclusion is not the same act as deleting a key, and only the first is reviewable.**
>
> **THREE MUTATIONS, THREE SEPARATE NAMED CATCHERS — none may stand in for another:**
> | mutation | catcher |
> |---|---|
> | a sixth/unknown raw field appears on the lane object | **stage 1** source-set difference |
> | a unique wrong destination (`sessionZone → "sessionZone"`) | **stage 1** destination-schema membership |
> | a wrong five-field selector (drops or adds one) | **stage 2** selector validation |
> ★★★ **Two renames exist in the real map — `conditionId → condition_id` AND `sessionZone → session_zone`.** ⚠️ **The previous revision said *"exactly ONE is a real rename"*; that was true over the five axis-bearing fields and was written as though it characterised the map.** `A COUNT IS ONLY TRUE INSIDE THE POPULATION IT WAS TAKEN OVER.`

> ### ★★★★★ CONTRACT 2c — **PER-LANE EMITTED `condition_id` UNIQUENESS**, CHECKED BEFORE ANY LOOKUP
> **Each lane's EMITTED binding array is checked for duplicate `condition_id` BEFORE `bindings[condition_id]` indexing or any map construction.** ⚠️★★★★★ **Two emitted rows sharing an id COLLAPSE INTO ONE MAP ENTRY even when the source fixture is clean — so a lane can silently drop a row and still agree with the other lane about what survived.**
> ⚠️★★★ **SOURCE-FIXTURE UNIQUENESS AND EMITTED-OUTPUT UNIQUENESS ARE SEPARATE BOUNDARIES.** This design already rejects duplicates in the source fixture; that does **NOT** cover the emitted array, and the two are not substitutes.
> 🛑★★★★★ **AND THIS CAMPAIGN HAS ALREADY BEEN BITTEN BY THIS EXACT MISPLACEMENT ONCE — the pinned gate carries its own warning at `:1222`: *"THE RIGHT CHECK ALREADY EXISTED IN THE WRONG PLACE: `duplicateConditionIds`."*** ✅ **The pinned gate defines `duplicateConditionIds()` at `:560` and calls it PER LANE at `:779`, `:784`, `:1370`. This design either BINDS TO A VERIFIED RECEIPT FROM THAT GATE or RE-DECLARES the check as its own.** ★★★★★ **`DO NOT INHERIT A SAFEGUARD BY PROXIMITY` — a check that exists somewhere in the repo is not a check this contract owns.**

> ### ★★★★★ SURFACE 3 — **THE LEDGER AXES.** SEVEN AXES, **CONSUMED ONLY BY `evaluate()`**, NEVER BY `project()`
> **The ledger keys its `301` cells by SEVEN axes. That is claim `B`'s key space, and it is NOT the projection surface** — three of the seven evaluate against ONE projected field.
>
> | ledger axis | projected field it consumes | `evaluate()` predicate — **claim `B` ONLY** |
> |---|---|---|
> | `bindable` | `bindable` | equality against `cell.value` |
> | `session_zone` | `session_zone` | STRUCTURAL equality against `cell.value` |
> | `approximation` | `approximation` | equality against `cell.value` |
> | `primitive_null` | `primitive` | **derived**: `projection.primitive === null` vs `cell.value` |
> | `reason_null` | `reason` | **derived**: `projection.reason === null` vs `cell.value` |
> | `reason_names` | `reason` | ⚠️ **`cell.value` is a REQUIRED SUBSTRING** of the projected reason — not an equality |
> | `reason_excludes` | `reason` | ⚠️ **`cell.value` is a FORBIDDEN SUBSTRING** of the projected reason — not an equality |
>
> ★★★★★ **THREE LEDGER AXES READ ONE PROJECTED FIELD (`reason`), AND TWO OF THEM ARE SUBSTRING PREDICATES RATHER THAN COMPARISONS.** A change to how `reason` is emitted moves three axes at once; that coupling is a property of the design and is stated rather than discovered.
> ⚠️★★★ **AND THE ASYMMETRY IS DELIBERATE AND MUST SURVIVE IMPLEMENTATION: `reason_names` and `reason_excludes` are NOT equality checks, so a `LEDGER_DIVERGENCE` on either means *"the reason string failed a containment test"*, never *"the reason string differed from the ledger"*. `A SUBSTRING PREDICATE REPORTED AS AN EQUALITY FAILURE MISDESCRIBES ITS OWN EVIDENCE.`**

---

## 3 — CONTRACT 3: **FROZEN-LEDGER CONFORMANCE** ONLY FOR `ASSERTED` — **AND IT IS NOT CORRECTNESS**

Claim `B` is evaluated **only** on the `140` `ASSERTED` cells, against `cell.value`, and every failure — **`LEDGER_DIVERGENCE`** — carries `cell.authority_citation` so the reader can reach the source.
⚠️ **NO VERDICT OF ANY KIND IS EMITTED FOR ANY OTHER CLASS — not `pass`, not `skip`, not `n/a`.** ★★ **A `PASS` printed over a cell with no expectation is the false green this entire arc exists to kill; the absence of a verdict is the honest output.**

> ### ⚠️★★★★★ WHY THIS CLAIM IS **NOT** CALLED `CORRECTNESS`, AND WHY THE NAME IS THE POINT
> **[MEASURED, `gen_p1p2.build()`] the `140` `ASSERTED` values were COPIED from `ORACLE.json` — `cell.value = row[axis]` — and have NEVER been checked against the authority document.** ★★★★★ **`FREEZING A TRANSCRIPTION DOES NOT VERIFY IT.` Matching the frozen ledger proves CONFORMANCE TO A TRANSCRIPTION; it proves nothing about whether the transcription is faithful to what the authority actually says.**
> ⚠️★★★★★ **THIS DESIGN PREVIOUSLY CALLED CLAIM `B` `CORRECTNESS` WHILE §11 — sixty lines later, in the same document — ALREADY STATED THAT *"a correctly-cited but mis-transcribed value survives every check here."* BOTH CANNOT HOLD. The honest limit and the dishonest label shipped together.**
> ★★★★★ **AND THE CONSEQUENCE IS ON THE MONEY PATH, WHICH IS WHY THE RENAME IS NOT COSMETIC: Blueprint Phase 1's exit criterion is compile-FIDELITY. A green labelled `CORRECTNESS` would satisfy a reader that fidelity had been measured when only SELF-CONSISTENCY had.** `BLUEPRINT PHASE 1 MAY NOT CITE LEDGER CONFORMANCE AS COMPILER FIDELITY.` **`A CLAIM'S NAME IS THE PART A DOWNSTREAM GATE ACTUALLY CONSUMES.`**
> ✅ **THEREFORE: every GREEN aggregate this gate emits — for any claim — is printed with `AUTHORITY_SEMANTICS_UNVERIFIED` beside it, and that marker is removed ONLY when the `140` have been independently re-derived from their citations in the authority document.**
> ✅ **AND THE WORD `correctness` IS RESERVED, EXPLICITLY AND IN THIS DOCUMENT, FOR THAT LATER AUTHORITY CHECK. No claim in `P0-vNext` may use it. A gate that has not read the authority may not spend the authority's word.**

---

## 4 — CONTRACT 4: `NOT-APPLICABLE` PRODUCES NO ASSERTION AND NO ACCIDENTAL PREDICATE

The `9` `NOT-APPLICABLE` cells must contribute **no comparison, no predicate, and no counter** to any claim-`B` (frozen-ledger conformance) verdict.
⚠️★★★★★ **AND THE ABSENCE MUST BE WITNESSED, NOT ASSUMED.** `A NEGATIVE ASSERTION NEEDS A POSITIVE WITNESS THAT THE PATH RAN.` The gate therefore **emits an explicit `NOT_APPLICABLE_SKIPPED` record naming each of the `9`**, so "no predicate ran" is a printed fact rather than an unobservable silence.
**Red-proof (pre-registered):** graft an expectation onto a `NOT-APPLICABLE` cell → the run must **FAIL**, naming it. If it passes, the class is being evaluated somewhere.

---

## 5 — CONTRACT 5: `UNADJUDICATED` → `INCOMPLETE_AUTHORITY`, FAIL CLOSED

> ★★★★★ **A CELL IS `DEPENDED-ON` WHEN THE VERDICT THE CALLER ASKED FOR WOULD CHANGE IF THAT CELL'S VALUE WERE KNOWN.**

Operationally, and this is the whole definition:
- **Claim A (agreement)** never depends on an `UNADJUDICATED` cell — the two lanes are compared to each other.
- **Claim B (frozen-ledger conformance)** never depends on one — it is scoped to `ASSERTED` by construction.
- **Claim C (completeness)** depends on **every** cell in the scope asked about. **Any `UNADJUDICATED` cell in that scope ⇒ `INCOMPLETE_AUTHORITY`, naming every such cell, and the scope's completeness verdict is NOT GREEN.**

> ### ⚠️★★★★★ SCOPES ARE **REGISTERED**, NOT SUPPLIED — THE CALLER SELECTS, IT NEVER AUTHORS
> **A caller requests a `scope_id`. IT MAY NOT SUPPLY CELL MEMBERSHIP.** Each `scope_id` resolves to a **COMMITTED EXACT MEMBER SET plus its digest**, living in the gate's frozen source alongside the axis list.
> **FAIL CLOSED on every one of:** unknown `scope_id` · a scope whose registered member set is EMPTY · a member added at runtime · a member removed at runtime · digest mismatch between the registry and the resolved set.
> **Every consumer names the exact `scope_id` AND digest it requires, and REJECTS a result carrying any other** — so a result cannot be re-pointed at a friendlier scope after the fact.
> ⚠️ **The Phase-1 admission scope is PRE-REGISTERED BEFORE ANY IMPLEMENTATION RESULT EXISTS.** `A SCOPE CHOSEN AFTER SEEING THE RESULT IS THE RESULT CHOOSING ITS OWN EXAM.`
>
> ★★★★★ **WHY THE PREVIOUS VERSION WAS INSUFFICIENT, IN ITS OWN WORDS:** it said no caller may narrow its scope *silently*, and enforced that by PRINTING the requested scope. **`PRINTING IT IS DISCLOSURE, NOT ENFORCEMENT.`** A caller passing `scope = []`, or any subset containing no `UNADJUDICATED` cells, obtained a completeness GREEN exactly as designed, and a downstream consumer reading status still saw a false ready-signal.
> ★★★★★ **THIS IS THE SEVENTH SIGHTING OF ONE FAMILY, NOW AT THE CALLER BOUNDARY: axis → row → `digests` namespace → CALLER SCOPE. `THE DENOMINATOR MUST BE INDEPENDENT OF THE CALLER FOR THE SAME REASON LEDGER MEMBERSHIP HAD TO BE INDEPENDENT OF THE LEDGER.`** **The general test: `NAME THE PARTY WHO CHOOSES THE DENOMINATOR. IF IT IS THE PARTY BEING MEASURED — OR THE PARTY ASKING — IT IS NOT A DENOMINATOR.`**
>
> ### 🛑★★★★★ THE PHASE-1 ADMISSION PROFILE: **`NO SOUND PHASE-1 PROFILE AVAILABLE`**
> **I was asked to freeze a Phase-1 profile — `consumer_id` · `required_claim_set` · `scope_id` · exact sorted cell-id set · scope digest · derivation authority · out-of-frame exclusions — or to record that none is available and say why. I RECORD THE REFUSAL, ON MEASUREMENT.**
> ```
> data artifacts carrying `tier_a` / `load_bearing`                     34
> ledger fixtures referenced by ANY of those 34 artifacts                0
> POSITIVE CONTROL: the ledger names its own fixtures                   12 / 12   (the join works)
> `phase_1_scope` anywhere in the repo                                   0
> ```
> ⚠️★★★★★ **THE VOCABULARY EXISTS AND IT SPEAKS ABOUT A DIFFERENT POPULATION.** Phase 1 exits on a **TIER-A STRATEGY SPEC** with every load-bearing condition bound; this ledger's `43` rows are **TWELVE PARITY FIXTURES** under `ci/fixtures/`. **On the tested filename ↔ stub keys the exact intersection is EMPTY, and there is NO DECLARED IDENTITY JOIN between them.**
> ⚠️★★★ **THE PRECISE STANDING IS `DISTINCT, PRESENTLY UNJOINED POPULATIONS` — NOT *"populations that do not intersect."* What was measured is an empty overlap on the keys tested plus the absence of a declared join; that does NOT exclude a semantic or provenance relationship under some mapping nobody has authorized.** ★★★ **The conclusion is unaffected — an unauthorized join is exactly what the stop condition forbids — but `A CLAIM BROADER THAN ITS EVIDENCE IS THE ONE A READER CANNOT CATCH`, so the narrower wording is the binding one.**
> 🛑★★★★★ **AND THE READING OF THAT EMPTY JOIN IS THE WHOLE FINDING, BECAUSE I GOT IT WRONG THE FIRST TIME: `ZERO OVERLAP BETWEEN TWO POPULATIONS IS EVIDENCE THEY ARE DIFFERENT — IT IS NEVER EVIDENCE THAT ONE OF THEM IS MISSING.`** ⚠️ **I read the empty join as *"no artifact enumerates the tier-A specs"* and prescribed building one. That inversion pointed a correct refusal at the wrong object.**
> ★★★★★ **THE ENUMERATOR ALREADY EXISTS `[MEASURED HERE, from MEMBER RECORDS at `be194136`, not from summary captions]`:**
> ```
> docs/replay-results/h1-battery/tier-a-compile-census.json   @ be194136
>   specs (NAMED container)                  11    · unique identities 11 / 11
>   condition rows                           99    · CROSS-CHECK n_conditions = 99   (second path)
>   load_bearing_spine = true                53    · specs carrying >=1:  11 / 11
>   spine_bind_status_counts   {UNBOUND 28, APPROXIMATED 25}  = 53          (reconciles)
> ```
> ⚠️★★★ **AND ITS TWO PROVENANCE DEFECTS ARE CARRIED, NOT LAUNDERED, BECAUSE A CITED ARTIFACT INHERITS ITS AUTHOR'S LIMITS:**
> 1. ⚠️ **`extraction_source` IS A SESSION-TEMPORARY, NON-DURABLE PATH** — `…/Temp/claude/…/d96dba1d-…/scratchpad/SEALED-READ/phase_b`. **READABLE AT THIS REVIEW; NOT A DURABLE AUTHORITY OR REPRODUCIBILITY GUARANTEE.** ★★ **The same non-durable-provenance defect `R-524` flagged in the `P0` verifier.**
> 🛑★★★★★ **THIS SENTENCE PREVIOUSLY READ *"IS A DEAD SESSION-TEMP SCRATCHPAD… that path no longer exists and cannot be re-read."* **THAT WAS FALSE AND IT WAS MINE.** `[MEASURED HERE]` **the path EXISTS, is a DIRECTORY, and holds `13` children; POSITIVE CONTROL — a non-existent sibling returns absent, so the test can tell the two apart.** ⚠️★★★★★ **The desk INFERRED `DEAD` from `session-temp`; I ASSERTED NON-EXISTENCE, which is strictly stronger, and I never ran the one-line test.** ★★★★★ **`PROVENANCE STATUS AND FILESYSTEM EXISTENCE ARE DIFFERENT CLAIMS.` The narrower true statement above supports the same conclusion — the artifact is still not a durable authority — so the overreach bought NOTHING and cost the record, inside a document whose entire subject is claims that outrun their evidence.**
> ⚠️ **AND PRESENT READABILITY IS NOT A PROMOTION: a path that happens to survive on one machine tonight is not durable provenance, and nothing here upgrades the census on that basis.**
> 2. ⚠️ **IT CARRIES A TOP-LEVEL `SUPERSESSION_MARKER` READING *"SUPERSEDED AND REPLACED"*** — **and the marker's SCOPE must be read before it is quoted.** `[MEASURED HERE]` its own `what_is_dead` names **the PREFIX-classifier RANKING** (the dead `31`-sorted `WAIT_STRUCTURE` order), **not the enumeration**; its live recomputed block republishes `spine_bind_status {UNBOUND 28, APPROXIMATED 25}`, which sums to the `53` I counted independently. ★★★★★ **`A SUPERSESSION MARKER IS SCOPED — QUOTE ITS SCOPE OR YOU WILL KILL A GOOD ARTIFACT.` Quoting the status line alone would have retired a sound structural enumerator over a dead sort key.**
> ✅★★★★★ **SO ITS STANDING IS: A HISTORICAL STRUCTURAL ENUMERATOR. Sound for what it counts, NOT promotable to a Phase-1 denominator — and NOT the thing to re-commission either.**

> ### 🛑★★★★★ WHAT THE MISSING OBJECT ACTUALLY IS (`R-529 §4`) — **NOT AN ENUMERATOR**
> **A CURRENT, AUTHORITY-RATIFIED TIER-A COMPILE-FIDELITY MEMBERSHIP / CONFORMANCE SURFACE**, keyed at minimum **`tier_a_spec_id × condition_id × fidelity_axis`**, carrying **current spec hashes · load-bearing membership · authority citations · and a consumer profile frozen BEFORE any result is read.**
> ⚠️★★★★★ **`P0-vNext`'s LEDGER CANNOT SUPPLY IT AND MUST NOT BE STRETCHED TO.** ✅ **THE REFUSAL STANDS AND IS SHARPER: `NO SOUND PHASE-1 PROFILE AVAILABLE`** — and until that surface exists the Phase-1 consumer has **NO registered profile and FAILS CLOSED**, rather than defaulting to the full frame.
> ★★★★★ **THE LESSON THIS COST, RECORDED AGAINST MYSELF: `A REFUSAL IS ONLY ACTIONABLE IF THE THING IT NAMES AS MISSING IS ACTUALLY THE MISSING THING.` A correct `NO` carrying a wrong `WHAT WOULD FIX IT` commissions the wrong work at full confidence — here, a DUPLICATE ENUMERATOR that would have been just as inadmissible as the one already on disk.**

> ### ★★★★★ PHASE 1 HAS **TWO SURFACES**, AND ONLY THE SECOND ONE EXITS IT (`R-529 §5`)
> ⚠️ **BLUEPRINT v4's LADDER IS UNCHANGED AND ITS PHASE-1 EXIT CRITERION IS UNTOUCHED** — *"≥1 tier-A spec compiles with ALL load-bearing conditions concretely bound AND the compile-fidelity forensics gate passes calibration."* What is recorded is that two distinct surfaces sit under it:
> | | surface | population | status |
> |---|---|---|---|
> | **A** | **PARITY INSTRUMENT** — this design | `12` fixtures · `43` rows · `301` cells | **in flight** — qualifies the INSTRUMENT |
> | **B** | **TIER-A COMPILE-FIDELITY GATE** | `11` real specs · `99` conditions · `53` load-bearing | ⚠️ **UNSTARTED · UNOWNED · now NAMED** |
> 🛑★★★★★ **CLOSING SURFACE `A` DOES NOT ADVANCE PHASE 1'S EXIT. `BLUEPRINT PHASE 1 MAY NOT CITE ANY `P0-vNext` GREEN AS COMPILE FIDELITY`** — stronger than `R-526`'s earlier form, which forbade citing frozen-ledger conformance as fidelity: **here the POPULATION is wrong, not merely the claim's name.** ★★★ **`A PROFILE IS VALID ONLY FOR THE POPULATION WHOSE IDENTITIES IT ACTUALLY CONTAINS`, and `A TEST CORPUS CAN CERTIFY AN INSTRUMENT; IT CANNOT BECOME THE PRODUCTION ADMISSION POPULATION BY ACQUIRING A PROFILE NAME.`**
> ⚠️ **Surface `B`'s owner is UNASSIGNED as of `R-529`, which records it as an obligation on the DESK. This design does not claim it, does not scope it, and must not be read as covering it.**

> ⚠️★★★ **THE RESIDUAL, STATED AS A LIMIT RATHER THAN CLAIMED AWAY: a registry cannot make scope selection immune to WHOEVER WRITES THE REGISTRY.** What it does is make every scope **VISIBLE, DIFFABLE, and PRE-REGISTERED** — a scope change becomes a reviewed commit rather than a runtime argument, and the pre-registration rule stops it being written after the answer is known. ★★ **That is a real reduction in a real attack and it is NOT airtight, and I would rather the desk judge a stated limit than inherit an implied guarantee.**

⚠️★★★★★ **AND THE OLDER RULE STANDS ON TOP OF IT: NO CALLER MAY OBTAIN A COMPLETENESS GREEN BY NARROWING ITS SCOPE SILENTLY** — the resolved scope and its digest are printed with the verdict, so *"complete over `X`"* always carries `X`. **`A COMPLETENESS CLAIM WITHOUT ITS SCOPE IS THE CAPTION DEFECT WEARING A VERDICT'S CLOTHES.`**
★★★ **CONSEQUENCE, STATED PLAINLY SO NOBODY IS SURPRISED BY IT LATER: on today's authority, a completeness claim over the full frame CANNOT go green, because `152` cells are unadjudicated and `43` of them are not even declared. THAT IS THE CORRECT ANSWER, NOT A BUG.** ✅ **Claims A and B can both go green today. ⚠️★★★★★ **A PROMOTION DECISION REQUIRING CLAIM `C` MAY CONSUME ONLY THE EXACT PRE-REGISTERED CONSUMER PROFILE** (`consumer_id` · required claims · `scope_id` · scope digest). **IT MAY NOT NARROW OR SELECT ANOTHER SCOPE AT DECISION TIME. Absent a sound profile or an authority amendment, IT WAITS.** ★★★ **The earlier wording here let a promotion decision CHOOSE a narrower scope so long as it printed it — and registration makes scope DEFINITIONS reviewable without making caller SELECTION safe once several registered scopes exist.** `A REGISTRY OF DENOMINATORS IS NOT A DENOMINATOR UNTIL THE CONSUMER IS BOUND TO ONE.` ★★ **Ninth sighting of the family, and the binding is the consumer side.****

---

## 6 — CONTRACT 6: SUMMARY COUNTS ARE RECOMPUTED FROM CELLS

Every count the gate reports — per class, per basis, per axis, totals — is **computed by summing the cells it actually read**, then **compared against the ledger's published manifest**. A mismatch is a **failure naming both numbers**, never a silent preference for either.
★★★ **`THE MANIFEST IS AN INPUT TO BE CHECKED, NOT A SOURCE TO BE TRUSTED` — the ledger's own summary was unprotected until `R-524`/`R-525`, and a consumer that reads `counts_by_basis.UNDECLARED` instead of counting cells would have believed a forged `0`.**

---

## 7 — CONTRACT 7: CLOSED KEY SETS AT EVERY AUTHORITY BOUNDARY, BOTH DIRECTIONS

**Every object crossing an authority boundary is validated as a CLOSED SCHEMA — unknown key ⇒ reject and NAME it; missing key ⇒ reject and NAME it.** The boundaries, enumerated (an unenumerated boundary is the defect):

| boundary | expected key set |
|---|---|
| ⚠️★★★★★ **the PINNED SOURCE SPECS — the boundary that DEFINES membership** | each `spec.entry_conditions[]` entry: `id` · `type` · `object` · `role`. **A missing `id` is FATAL, never a `None` row. A duplicate `id` within a fixture is FATAL, never a collapsed row. `entry_conditions` absent or not a list is FATAL, never an empty universe.** |
| ⚠️ **`ORACLE.json`** — **AUTHORITATIVE FOR NO MEMBERSHIP, REQUIREDNESS OR COMPLETENESS DECISION; HISTORICAL SOURCE OF THE FROZEN VALUES; COMPARED ONLY (see §12)** | **root:** `_README` · `_authority_hash_history` · `authority_file` · `authority_sha256` · `fixtures` · `required_members` · **each fixture:** `_note` · `authority` · `compiled` · `conditions` · `conditions_unadjudicated` · `conditions_unadjudicated_ids` · `reasons_must_differ_from` · `scalars_unadjudicated` · `spine_bound` · `spine_total` · **each row:** `approximation` · `authority` · `bindable` · `primitive_null` · `reason_excludes` · `reason_names` · `reason_null` · `session_zone` · `unadjudicated` |
| ledger root | `_schema` · `_generated_by` · `_classification_enum` · `_frame` · `P1_observed_baseline` · `P2_total_membership` · `integrity_census` · `cells` · `digests` |
| each cell | `cell_id` · `fixture` · `condition_id` · `axis` · `classification` · `basis` · `declared_reason` · `authority_citation` · `value` *(`value` present iff `ASSERTED`)* |
| `digests` | `canonical_document_sha256` · `cell_id_set_sha256` · `row_universe_sha256` · `digest_definition` |
| `P1_observed_baseline` · `P2_total_membership` · `integrity_census` | their published key sets, closed identically |
| `classification` | exactly `ASSERTED` · `NOT-APPLICABLE` · `UNADJUDICATED` |

> ### ★★★★★ THE BINDING PROPERTY — THIS OUTRANKS THE TABLE ABOVE IT
> **ANY OBJECT THIS GATE PARSES IS SCHEMA-CLOSED. PARSING AN OBJECT FOR WHICH NO SCHEMA IS DECLARED IS ITSELF A FAILURE, NAMING THE OBJECT AND THE PARSE SITE.**
> ⚠️★★★★★ **THE TABLE IS A CONVENIENCE; THIS SENTENCE IS THE RULE.** A table enumerates the boundaries someone thought of, and **this family has now surfaced SIX times — twice inside its own remedies.** Each previous fix added the missing member: closed-key on oracle rows, then three named digest fields, then the source specs, then the oracle. **`A LIST IS A SNAPSHOT OF TODAY'S VOCABULARY; A CLOSED PROPERTY IS A RULE.`**
> ★★★ **The operational consequence, so this is testable and not a slogan: a new input cannot be read by adding a parse call. It must arrive WITH a declared schema, or the gate fails on first contact.** **Red-proof:** introduce a parse of any object with no declared schema → the run must **FAIL**, naming it. **That is the test the seventh appearance has to survive, and it does not depend on anyone predicting where the seventh will be.**

⚠️★★★★★ **THE SOURCE-SPEC ROW WAS ADDED AFTER THIS DESIGN WAS FIRST PUBLISHED, AND THE OMISSION IS WORTH KEEPING ON THE RECORD.** My original boundary table enumerated every object *inside the ledger* and **left out the source specs — the one boundary that DEFINES membership.** ★★★ **I had written "an unenumerated boundary is the defect" one line above a list that was itself missing a boundary.** `THE SURFACE YOU MEASURE FROM IS A BOUNDARY TOO, AND IT IS THE EASIEST ONE TO FORGET BECAUSE IT IS THE ONE YOU TRUST.`
⚠️ **A silently dropped `id` would have produced a `None` row, and a duplicated `id` a collapsed one — both changing the `43` without any check objecting.**

⚠️★★★★★ **THIS RULE IS MINTED FROM A DEFECT IN MY OWN PREVIOUS DELIVERY.** The fix for an open-key oracle row was closed-key on rows; I then repaired the ledger's manifest gap with **an open-key LIST of three field names, one namespace over**, and a planted `digests.human_facing_certification = "ALL VALUES IN THIS LEDGER ARE DESK-VERIFIED"` passed silently. ★★★ **`A LIST IS A SNAPSHOT OF TODAY'S VOCABULARY; A CLOSED KEY SET IS A PROPERTY.` `REJECT UNKNOWN OR MISSING FIELDS AT EVERY AUTHORITY BOUNDARY.`**
✅ **The gate also verifies the ledger's digests against an independently regenerated derivation, and rejects duplicate JSON keys before parsing** (`json.load` silently keeps the last).

---

## 8 — CONTRACT 8: DURABILITY — HOW THIS BECOMES A STANDING GUARD

⚠️★★★★★ **THE OPEN OBLIGATION, STATED PLAINLY BECAUSE SILENCE IS NOT ACCEPTABLE (`R-525 §4b`): the current `P1`/`P2` verifier is a CLOSEOUT PROOF, not continuous enforcement. It `sys.path.insert`s a SESSION-TEMPORARY SCRATCHPAD and imports its generator from there. It runs today; when that directory is cleaned, the shipped listing stops running as written.**

**The design's answer, as future work with its shape named:**
1. **The derivation moves INTO THE REPO** — a committed module, not a scratchpad import. The embedded packet listing becomes documentation of a committed file rather than the only copy.
2. **The gate is a committed script** with a **non-zero exit on any failure** and a **final summary line**, so its completion signal is the exit status.
3. **The pinned source is the TAG**, not a path into anyone's temp directory — `p1p2-frozen-source-universe-c304b098`. **The tag must not be deleted or retargeted; the gate should assert its peeled object equals `c304b098b156106a5a81b714c7a5a3ed166d68ef` and fail if not.**
4. **CI invocation** — and one honest caveat rather than a promise: **this campaign has previously measured that `ci.yml` does not fire on campaign branches.** ★★ **So "wire it into CI" is a claim that must itself be verified by execution on the branch where it will run, not assumed from the file's existence.** ⚠️ **[UNPROVEN — I have not measured the current CI trigger set in this task, and I am not claiming it.]**
5. **Everything the gate reads is a PINNED GIT OBJECT plus one committed ledger**, so unlike a deployed-runtime instrument it is **not machine-bound** and can run anywhere the repo is checked out.

---

## 9 — CONTRACT 9: OUT-OF-FRAME SURFACES, CARRIED NOT DELETED

**The ledger is complete over the pinned `entry-condition × seven-axis` frame and over NOTHING ELSE.** These are real truths it does not carry, and they remain a **NAMED `P3`/downstream obligation**:
`compiled` · `spine_bound` · `spine_total` · `reasons_must_differ_from` · `scalars_unadjudicated` · any other fixture-level scalar or relational expectation.
⚠️ **`P0-vNext` MUST NOT SILENTLY BRING THEM IN SCOPE, AND MUST NOT LET A GREEN OVER THE FRAME BE READ AS COVERING THEM.** ★★ **Its printed scope line names the frame every run, for exactly this reason.** `A SCOPE DECLARATION IS NOT PERMISSION TO DELETE WHAT IT EXCLUDES.`

---

## 10 — PRE-REGISTERED RED-PROOF (written before any implementation exists)

**Every rule above owes a mutation that turns it RED, plus a clean control that stays GREEN.** A mutation suite without the unmutated control cannot tell *catches breakage* from *always red*.

⚠️★★★★★ **THIS MATRIX IS `54` MUTATIONS **PLUS** `1` CLEAN CONTROL — `55` NUMBERED ROWS, CONTIGUOUS `1..55`, ZERO DUPLICATES, CONTROL LAST.** `[COUNTED BY A SECTION-ANCHORED PARSE AFTER THE ROWS LANDED; NOT copied from any prior statement of the figure.]`
★★★★★ **ELEVENTH RECOMPUTATION. The caption has read `23`, `22+1`, `24+1`, `29+1`, `32+1`, `33+1`, `42+1`, `47+1`, `49+1`, `52+1`, `53+1` and now `54+1`, each correct until the next rows landed.**
⚠️🛑★★★★★ **AND THIS ROUND THE RE-PARSE CAUGHT A REAL GAP FOR THE SECOND TIME IN THIS DOCUMENT'S HISTORY: the two new rows were first written `49`/`50` while the clean control WAS `48`, leaving `48` CONSUMED AND THE SEQUENCE GAPPED. Renumbered `49→48`, `50→49`, control `→50`, re-parsed contiguous.** ★★★★★ **`A CONTIGUITY CHECK IS NOT DECORATION — IT IS THE ONLY THING THAT SEES A NUMBER YOU CONSUMED`, and it has now convicted twice, both times on the same manoeuvre: appending rows by replacing the control.**
🛑★★★★★ **AND THE PARSE IS NOW ANCHORED TO **THIS SECTION**, NEVER TO A ROW SHAPE — BECAUSE A ROW SHAPE HAS FOOLED THIS DESK TWICE ON THE SAME TABLE.** `[MEASURED HERE, WITH A POSITIVE CONTROL]` **anchored to `## 10`: `55` rows. The IDENTICAL row-shape pattern with NO anchor: `60` rows — the `5` extra are the field-mapping table at `:290–294`, whose rows are numbered `1..5` and are not mutations at all. BOTH COUNTS ARE PUBLISHED, never just the flattering one.** ★★★★★ **THE CONTROL IS THE POINT: the parser CAN see those five, so the anchor is what EXCLUDES them rather than blindness doing it.** `A CENSUS IS BOUNDED BY ITS SURFACE AS WELL AS ITS PATTERN` · `PARSE A TABLE BY ITS SECTION ANCHOR, NEVER BY ITS ROW SHAPE.`
⚠️★★★ **PRIOR ROUND, KEPT AS THE STANDING WARNING: the new row was once first written `35` while the old control WAS `34`, leaving the sequence GAPPED. `A CONTIGUITY CHECK IS NOT DECORATION — IT IS THE ONLY THING THAT SEES A NUMBER YOU CONSUMED.`**
⚠️★★★ **RE-PARSED after every edit — never carried, including from this document's own previous revision.** `A HAND-COPIED EXPECTED VALUE IS A FABRICATED SAFETY CLAIM.`

| # | mutation | required result | **THE CATCHER** |
|---|---|---|---|
| 1 | delete a row from the ledger | RED — `LEDGER_INCOMPLETE`, named | §1 reconstruction diff |
| 2 | add a cell outside the reconstruction | RED — `LEDGER_UNKNOWN_CELL`, named | §1 reconstruction diff |
| **3** | ★★★★★ **THE SAME WRONG VALUE IN BOTH LANES, on one `ASSERTED` cell** | ★★★★★ **claim `A` stays GREEN · claim `B` ALONE emits `LEDGER_DIVERGENCE`, citation printed** | §3 conformance against `cell.value` |
| 4 | one lane emits a different value | RED — `DISAGREEMENT`, both values named | §2 matrix row 1 |
| 5 | one lane emits nothing where the other emits a value | RED — `DISAGREEMENT`, path + value named | §2 matrix rows 2–3 |
| 6 | both lanes missing **ANY** of the five required wire keys | RED — `PROJECTION_MISSING_BOTH`, **ALWAYS, no classification exception** | §2 matrix row 4 |
| 7 | ★★★★★ **THE REAL N/A POPULATION — `3` rows × `3` axes in `40-overrefusal-boundary`, both lanes emitting `approximation=True` · a concrete `primitive` string · `session_zone=null` (`6` NON-NULL, `3` NULL) | ★★★★★ **claim `A` compares all nine NORMALLY and is GREEN **BECAUSE THE LANES AGREE** · claim `B` emits `9` skip witnesses and NO predicates** | §2 as-emitted comparison + §4 claim-`B` skip witness |
| 8 | `MISSING` on one side vs JSON `null` on the other | RED | §2 per-projection record |
| 9 | graft an expectation onto a `NOT-APPLICABLE` cell | RED, named | §4 |
| 10 | completeness over a scope containing an `UNADJUDICATED` cell | RED — `INCOMPLETE_AUTHORITY`, every such cell named | §5 |
| 11 | unknown `scope_id` | RED, named | §5 registry |
| 12 | registered but **EMPTY** scope | RED, named | §5 registry |
| 13 | scope member **added** at runtime | RED, named | §5 registry |
| 14 | scope member **removed** at runtime | RED, named | §5 registry |
| 15 | scope **digest mismatch** | RED, named | §5 registry |
| 16 | consumer-required `scope_id` / digest mismatch | **CONSUMER REJECTION** | §5 consumer contract |
| 17 | `AUTHORITY_SEMANTICS_UNVERIFIED` removed from any green aggregate | **INVALID OUTPUT, non-zero exit** | §3 |
| 18 | forge `counts_by_basis.UNDECLARED` `43 → 0` | RED — recomputed-vs-published, both numbers | §6 |
| 19 | plant an unknown key at ANY boundary | RED, key named | §7 |
| 20 | delete a known key at ANY boundary | RED, key named | §7 |
| 21 | parse an object with **no declared schema** | RED, object + parse site named | §7 binding property |
| 22 | retarget or delete the pinned tag | RED | §8 |
| **23** | ★★★★★ **LEDGER MOVES, LANES FIXED** — change one `ASSERTED` `reason_names` (or `reason_excludes`) `cell.value`, both lane outputs untouched | ★★★★★ **claim `A`'s PROJECTION AND VERDICT BYTE-IDENTICAL to the unmutated run · claim `B` ALONE changes, naming the cell** | §2 `project()` cannot receive the ledger |
| **24** | ★★★★★ **LANES MOVE TOGETHER, LEDGER FIXED** — emit the SAME WRONG `reason` string in BOTH lanes on an `ASSERTED` `reason_names` cell | ★★★★★ **claim `A` GREEN (the lanes agree) · claim `B` RED — `LEDGER_DIVERGENCE`, reported as a FAILED CONTAINMENT, citation printed** | §3 `evaluate()` substring predicate |
| **25** | ★★★★★ **WHOLE-EXPECTATION-SURFACE PERTURBATION** — change EVERY expectation in the ledger at once, lanes untouched | ★★★★★ **the PROJECTION DIGEST is IDENTICAL** (claim `B` may move freely) | §2 sealed-before-parse + digest |
| **26** | **FORBIDDEN DEPENDENCY** — give `project()`'s closure an import or captured reference reaching a ledger/oracle reader | RED — run fails, **the offending path NAMED** ⚠️★★★★★ **SUBCASES, EACH PLANTED, RUN AND REPORTED INDEPENDENTLY — one import shape cannot certify three promises:** **(a)** a DIRECT ledger/oracle-reader import · **(b)** a FILESYSTEM/network module · **(c)** a TRANSITIVE edge whose own import graph reaches either.| §2 dependency-boundary check |
| **27** | ★★★★★ **UNIQUE-WRONG-DESTINATION RENAME** — `sessionZone: "session_zone"` → `sessionZone: "sessionZone"` (source set identical · destination unique · entry consumed) | RED — **unknown destination key NAMED** | **STAGE 1** destination-schema membership — ⚠️ **NOT `projectExhaustively()`'s source check, which stays silent here** |
| **28** | **SOURCE-SIDE KEY MUTATION** — add an unmapped raw field, or delete a mapped one, on the lane object | RED — `EXTRA RAW KEY` / `MISSING MAPPED KEY`, key NAMED | §2 `projectExhaustively()` source-key check |
| **29** | ★★★★★ **DUPLICATE EMITTED `condition_id` IN ONE LANE** — source fixture CLEAN, opposite lane FIXED | RED at the **emitted-uniqueness boundary, BEFORE claim `A` evaluates** | §2c per-lane emitted uniqueness |
| **30** | 🛑★★★★★ **CLASSIFICATION-ONLY LEDGER MUTATION** — change ONLY a `classification`; **every `cell.value` untouched** | 🛑★★★★★ **claim `A`'s PROJECTION *AND VERDICT* BYTE-IDENTICAL · claims `B`/`C` may move** | §2 claim `A` reads no ledger field |
| **31** | **WRONG FIVE-FIELD SELECTOR** — drop or add one key in the claim-`A` selection | RED — selector difference NAMED | **STAGE 2** selector validation |
| **32** | **SIXTH / UNKNOWN RAW FIELD** on the lane object | RED — extra source key NAMED | **STAGE 1** source-set difference |
| **33** | 🛑★★★★★ **N/A DISCRIMINATOR — ONE LANE ONLY, `approximation True → null` on an N/A cell** | 🛑★★★★★ **claim `A` RED (`DISAGREEMENT`, path + both values named) · claim `B` STILL EMITS THE SAME `9` SKIP WITNESSES** | §2 as-emitted comparison |
| **34** | 🛑★★★★★ **CLEAN-IMPORT CAPTURED-READER INJECTION** — feed an expectation reader into `project()` through a module-local **setter/callback** while the **IMPORT GRAPH STAYS CLEAN** | 🛑★★★★★ **RED — the rule FAILS and NAMES the injected symbol** · ★★★ **PAIRED NEIGHBOUR: a module-scope IMMUTABLE PLAIN-DATA CONSTANT stays GREEN, proving the rule rejects injected STATE and not every module-scope reference** ⚠️★★★★★ **SUBCASES, EACH PLANTED, RUN AND REPORTED INDEPENDENTLY — the `1b-S` export/reference surface carries FOUR distinct promises and one setter shape certifies none of the others:** **(a)** a SETTER/CONFIGURATION export · **(b)** a FUNCTION-VALUED export other than `project` · **(c)** an export that MUTATES module state · **(d)** a CLOSURE OVER AN INJECTED VALUE (free/captured reference, no export at all).| §2 `1b-S` closed **export/state** surface (parser) — ⚠️ **NOT the import-graph check, which stays silent here** |
| **35** | ★★★★★ **DIRECT `globalThis` READ** — `project()`'s module reads `globalThis.__ledger`; **import graph CLEAN** | RED — build fails, the `globalThis` reference **NAMED** · ★★★ **GREEN NEIGHBOUR: a ZERO-IMPORT module reading only its own deeply-frozen constants stays GREEN** ⚠️ **(the former neighbour was *an allow-listed pure helper import* — UNCONSTRUCTIBLE once the import policy became zero-import, and a green neighbour its own rule rejects is a STOP CONDITION)** ⚠️★★★★★ **SUBCASES, EACH PLANTED, RUN AND REPORTED INDEPENDENTLY — the contract's quantifier is *ANY host-global identifier not in the allow-list*, and `A QUANTIFIER OF `any` IS NOT DISCHARGED BY ONE REPRESENTATIVE:** **(a)** `globalThis` · **(b)** `window` · **(c)** ★★★★★ **`global` — a REAL ALIAS on this host `[MEASURED, `AR-582`, node v24.13.0: `global === globalThis` is `true`]`** · **(d)** an ARBITRARY unallowlisted free host identifier, to exercise the quantifier rather than the enumerated three.| §2 `1b-S` **direct-ambient-read** row (parser) — ⚠️ **NOT the import-graph check, which stays silent here** |
| **36** | ★★★★★ **DIRECT ENVIRONMENT READ** — `process.env.LEDGER_PATH` in `project()`'s module | RED — build fails, `process.env` reference **NAMED** · ★★★ **GREEN NEIGHBOUR: a deeply-frozen plain-data constant stays GREEN** | §2 `1b-S` **direct-ambient-read** row (parser) |
| **37** | ★★★★★ **MUTABLE CACHE / LAZY HOLDER WITH *NO* SETTER EXPORT** — a module-internal holder populated on first call; **nothing is exported, import graph CLEAN** | RED — build fails, the mutable binding **NAMED** · ★★★ **GREEN NEIGHBOUR: a deeply-frozen constant read on every call stays GREEN** ⚠️★★★★★ **SUBCASES, EACH PLANTED, RUN AND REPORTED INDEPENDENTLY:** **(a)** a MUTABLE module-scope binding (`let`) · **(b)** a CACHE populated on first call · **(c)** a SINGLETON instance · **(d)** a LAZILY-INITIALISED holder. ⚠️ **All four are written and read entirely inside the module, so row `34`'s export check stays SILENT on every one.**| §2 `1b-S` **module-scope-state** row — ⚠️ **NOT row `34`'s setter check, which stays silent: there is no export to see** |
| **38** | 🛑★★★★★ **SHALLOW-FROZEN NESTED HOLDER** — `const HOLDER = Object.freeze({slot:{}})`, then `HOLDER.slot.read = <ledger reader>`; **the module PASSES a top-level `Object.isFrozen` check** | 🛑★★★★★ **RED — the WRITABLE NESTED PATH named** · ⚠️★★★★★ **AND THE PROOF THIS ROW EXISTS FOR: a top-level `isFrozen` check prints **GREEN** while `project()` returns the LEDGER value `[MEASURED, `R-535 §2`]` — the row FAILS if the implementation checks frozen-ness shallowly** · ★★★ **GREEN NEIGHBOUR: a DEEPLY-frozen constant stays GREEN** | §2 `1b-S` **DEEP frozen-ness** rule — ⚠️ **NOT a top-level `Object.isFrozen` check, which is the false green itself** |
| **39** | ★★★★★ **FUNCTION-VALUED FIELD ON THE RUNTIME INPUT** — hand `project()` a lane object carrying a method/thunk; **module source SPOTLESS** | RED at the call boundary — the offending **KEY NAMED** · ★★★ **GREEN NEIGHBOUR: a plain-data lane object with the IDENTICAL KEY SET stays GREEN** | §2 `1b-R` descriptor walk — ⚠️ **NOT any build-time rule, which cannot see a runtime value** |
| **40** | 🛑★★★★★ **GETTER/ACCESSOR ON THE RUNTIME INPUT** — a `get` descriptor that returns the ledger value; **module source SPOTLESS** | 🛑★★★★★ **RED — `accessor:<key>` NAMED · AND THE ROW CARRIES AN INVOCATION COUNTER WHOSE REQUIRED VALUE IS `0`: the guard must reject WITHOUT EVER RUNNING THE GETTER** ⚠️ **a rejection at counter `≥1` is a FAILED proof even though the run was red** · ★★★ **GREEN NEIGHBOUR: the same key set as plain data stays GREEN** | §2 `1b-R` descriptor walk via **`Object.getOwnPropertyDescriptors` ONLY** — ⚠️★★★★★ **spread · `JSON.stringify` · `Object.values` · `Object.entries` · `structuredClone` are EXCLUDED, each MEASURED invoking the getter once; `Object.keys` is invocation-safe but accessor-BLIND and is NOT a catcher** |
| **41** | ★★★★★ **RUNTIME-RESOLVED MODULE NAME** — reach the ledger via `eval` / `new Function` / a `require` whose specifier is computed; **the STATIC import list stays CLEAN and the allow-list is never violated** | RED — build fails, the dynamic-load construct **NAMED** · ★★★ **GREEN NEIGHBOUR: a ZERO-IMPORT module with a module-scope frozen constant stays GREEN** ⚠️ **(NOT *an allow-listed static import* — no import is admitted at all now)** ⚠️★★★★★ **SUBCASES, EACH PLANTED, RUN AND REPORTED INDEPENDENTLY — the contract lists five dynamic-load forms and `eval` alone certifies none of the rest:** **(a)** `import()` · **(b)** `require` with a COMPUTED specifier · **(c)** `eval` · **(d)** `new Function` · **(e)** `createRequire`.| §2 `1b-S` **dynamic-loading** row (parser) — ⚠️ **NOT the import allow-list, which cannot decide a specifier computed at runtime** |
| **42** | 🛑★★★★★ **PROTOTYPE-BORNE CAPABILITY ON THE RUNTIME INPUT** — hand `project()` a class instance whose ledger reader is a **PROTOTYPE METHOD**, and separately an `Object.create()` child with an **INHERITED GETTER**; **own properties are spotless AND module source is spotless** | 🛑★★★★★ **RED — the offending PATH named, invocation counter `0`** · ⚠️★★★★★ **THE PROOF THIS ROW EXISTS FOR: an OWN-descriptor walk returns `[]` on both while the capability is fully reachable `[MEASURED, `AR-579 §3`]` — the row FAILS if the implementation checks own properties only** · ★★★ **GREEN NEIGHBOUR: the same key set as a plain object literal, and a nested ARRAY field, both stay GREEN** | §2 `1b-R` **recursive prototype-identity** check — ⚠️★★★★★ **NOT `Object.getOwnPropertyDescriptors`, which is own-properties-only and stays SILENT here** |
| **43** | 🛑★★★★★ **CYCLE ON THE RUNTIME INPUT** — a self-referential plain object (`root.self = root`); **every node is plain data and no capability is present** | 🛑★★★★★ **RED — `cycle:$.self` NAMED, and the walk COMPLETES BOUNDED** ⚠️★★★★★ **A `RangeError` IS A FAILED PROOF, NOT A RED RESULT: `[MEASURED, `AR-580 §2`]` naive recursion THREW and returned NO VERDICT AT ALL, which fails the run for a reason unrelated to the property under test** · ★★★ **TWO GREEN NEIGHBOURS: an acyclic plain object stays GREEN, AND a legitimate DAG `{p:shared,q:shared}` stays GREEN — the row must reject CYCLES, never REPEATED IDENTITY** | §2 `1b-R` **active-path** cycle policy — ⚠️★★★★★ **NOT a permanent visited-set, which `[MEASURED]` FALSE-REJECTS the DAG neighbour** |
| **44** | 🛑★★★★★ **SYMBOL-KEYED FUNCTION CAPABILITY ON THE RUNTIME INPUT** — plant a ledger reader under a `Symbol()` key; **every STRING key is spotless and the module source is spotless** | 🛑★★★★★ **RED — `symbol-key:$.symbol(ledgerRead)` NAMED *BEFORE* ANY INVOCATION, counter `0`** · ★★★★★ **POSITIVE WITNESS: `Reflect.ownKeys` SEES it** · ★★★★★ **NEGATIVE CONTROL, REQUIRED TO MISS: `Object.keys(getOwnPropertyDescriptors(v))` returns `["id"]` and does NOT contain the symbol `[MEASURED, `AR-580 §2`]` — if the negative control ever SEES it, the witness is not testing what it claims** · ★★★ **GREEN NEIGHBOUR: the same object with the capability under a STRING key is caught by row `39` instead, proving the symbol path is a DISTINCT catcher and not a duplicate** | §2 `1b-R` **`Reflect.ownKeys`** enumeration — ⚠️★★★★★ **NOT `Object.keys`, which is STRING-KEY-BLIND and stays SILENT here** |
| **45** | ★★★★★ **NON-CONFORMING VALUE CLASS** — grouped, **and every subcase names its own expected result** because a grouped row that does not is a caption: `undefined` value · `bigint` · a SYMBOL VALUE · `NaN` · `+Infinity` / `-Infinity` | ★★★★★ **RED for EACH subcase independently — the offending PATH and the offending VALUE CLASS both named** ⚠️★★★★★ **THIS IS A CROSS-LANE CORRECTNESS ROW, NOT TIDINESS: `[MEASURED, `AR-580 §3`]` a JSON round-trip turns `NaN`/`±Infinity` into `null` and DROPS `undefined`, so an un-rejected `NaN` would compare EQUAL to a lane emitting `null`** · ★★★ **GREEN NEIGHBOURS: finite number · string · boolean · `null` all stay GREEN** | §2 `1b-R` grammar **leaf** rule |
| **46** | ★★★★★ **ARRAY-SHAPE VIOLATION** — grouped, each subcase with its own expected result: **(a)** a SPARSE HOLE (`[1,,3]`, own enumerable keys `["0","2"]`, index `1` ABSENT) · **(b)** an EXTRA NAMED ARRAY PROPERTY (`arr.note = 'x'`, enumerable, would pass a naive object rule) | ★★★★★ **RED for each — **(a)** names the MISSING INDEX, **(b)** names the OFFENDING KEY** · ★★★ **GREEN NEIGHBOURS: a dense array with contiguous indices `0..length-1` stays GREEN, and `length` ALONE never triggers the row — it is an own but NON-ENUMERABLE key** | §2 `1b-R` grammar **array** rule |
| **47** | ★★★★★ **NON-ENUMERABLE USER FIELD** — `Object.defineProperty(v,'hidden',{value:…,enumerable:false})` | ★★★★★ **RED — the hidden key NAMED** · ★★★★★ **POSITIVE WITNESS: `Reflect.ownKeys` returns `["hidden"]`** · ★★★★★ **NEGATIVE CONTROL, REQUIRED TO MISS: `Object.keys` returns `[]` `[MEASURED, `AR-580 §3`]`** · ★★★ **GREEN NEIGHBOUR: the same field declared ENUMERABLE is admitted normally** | §2 `1b-R` grammar **own-enumerable** clause |
| **48** | ★★★★★ **HELPER-RETURNED MODULE CONSTANT** — `const C = deepFreeze(raw)` / `const C = makeConstants()`; **the helper may be perfectly sound** | ★★★★★ **RED — the CALL EXPRESSION named** ⚠️★★★★★ **THIS ROW IS DELIBERATELY STRICTER THAN SAFETY REQUIRES: `A CALL'S RETURN VALUE IS NOT VISIBLE TO A PARSER`, so admitting it would be the rule inferring a property it cannot observe** · ★★★ **GREEN NEIGHBOUR: the SAME data written as a recursively `Object.freeze`-wrapped literal tree stays GREEN — proving the rule rejects UNDECIDABILITY, not composite constants** | §2 `1b-S` **admitted AST grammar** — `Frozen := Object.freeze(ObjLit\|ArrLit) \| Primitive` |
| **49** | ★★★★★ **SPREAD / ALIAS ESCAPE** — grouped, each subcase with its own expected result: **(a)** `const C = Object.freeze({...base})` · **(b)** `const C = base` (bare alias) · **(c)** `const C = Object.freeze({[k]: v})` (computed key) | ★★★★★ **RED for each — **(a)** names the SPREAD, **(b)** names the ALIASED IDENTIFIER, **(c)** names the COMPUTED KEY** ⚠️ **each imports a key set or a value the parser cannot bound at this node** · ★★★ **GREEN NEIGHBOUR: the same shape with every key written literally and every nested literal individually frozen stays GREEN** | §2 `1b-S` **admitted AST grammar** — forbidden-form list |
| **50** | 🛑★★★★★ **NON-INTRINSIC `freeze` CALLEE** — grouped, each subcase planted separately: **(a)** a SHADOWED local `const Object = {freeze: x => x}` · **(b)** a locally-declared `freeze` · **(c)** an ALIASED binding (`const f = Object.freeze` then `f(...)`) ⚠️ **(an IMPORTED `freeze` is unreachable under the zero-import policy and is recorded as N/A rather than silently dropped)** | 🛑★★★★★ **RED for each — the CALLEE SYMBOL named, and the rejection must cite SYMBOL IDENTITY, never the source text** ⚠️★★★★★ **THE PROOF THIS ROW EXISTS FOR `[MEASURED, `AR-584 §2`]`: the shadowed form leaves `isFrozen(root) = FALSE` and the nested write returns the LEDGER value, while the spelling is indistinguishable from the intrinsic** · ★★★ **GREEN NEIGHBOUR: the INTRINSIC `Object.freeze` with every nested literal wrapped stays GREEN — `isFrozen = TRUE`, nested write blocked** | §2 `1b-S` **ambient-intrinsic allow-list** resolved by TS SYMBOL IDENTITY — ⚠️ **NOT a text match on `Object.freeze`, which is the false green itself** |
| **51** | 🛑★★★★★ **`__proto__` AS A PROTOTYPE SETTER** — grouped, each spelling its own subcase: **(a)** `Object.freeze({ __proto__: p })` (raw Ident) · **(b)** `Object.freeze({ "__proto__": p })` (raw StringLit) · ★★★★★ **(c)** ESCAPED IDENTIFIER `Object.freeze({ \u005f\u005fproto__: p })` · ★★★★★ **(d)** ESCAPED STRING `Object.freeze({ "\x5f\x5fproto__": p })` | 🛑★★★★★ **RED for each — WITNESSES REPORTED: OWN KEYS (`[]`) *and* PROTOTYPE IDENTITY (`=== supplied`, not `Object.prototype`)** ⚠️★★★★★ **`[MEASURED, `AR-584 §2`]` both spellings pass `isFrozen`, expose ZERO own keys and serve REACHABLE inherited data — so an own-key check alone reports a clean object and the row FAILS if prototype identity is not among its witnesses** · ★★★ **GREEN NEIGHBOUR: an ORDINARY key (`{a: 1}`) → own keys `["a"]`, prototype `Object.prototype`** · ⚠️★★★ **NOT A SUBCASE, BY MEASUREMENT: the COMPUTED `{["__proto__"]: p}` is NOT a prototype setter and is rejected as a COMPUTED KEY instead** | §2 `1b-S` grammar **`Key != "__proto__"`** production |
| **52** | ★★★★★ **DUPLICATE COOKED KEYS** — grouped, each subcase planted separately: **(a)** raw `Object.freeze({ a: 1, a: 2 })` · **(b)** ESCAPED STRING `Object.freeze({ a:1, "\x61":2 })` · **(c)** ESCAPED IDENTIFIER `Object.freeze({ a:1, \u0061:2 })` · **(d)** MIXED spellings across Ident and StringLit | ★★★★★ **RED — the duplicated key named, and BOTH source positions reported** ⚠️ **`[MEASURED, `AR-584 §4`]` own keys `["a"]`, last value wins, NO ERROR — the first value is SILENTLY DISCARDED and is invisible to every own-key check afterwards** · ★★★ **GREEN NEIGHBOUR: `{a: 1, b: 2}` with distinct keys stays GREEN** | §2 `1b-S` grammar **all Keys DISTINCT** production |
| **53** | 🛑★★★★★ **HARMLESS-IMPORT CARDINALITY MUTATION** — a direct STATIC import of a demonstrably INERT local helper (pure arithmetic; its transitive closure reaches NO ledger, oracle, filesystem or network module) | 🛑★★★★★ **RED SOLELY BECAUSE THE IMPORT COUNT IS NON-ZERO**, the SPECIFIER named ⚠️★★★★★ **THE ROW FAILS IF IT REDDENS VIA A CAPABILITY CHECK — this mutation reaches NO capability, which is the entire point: it is the ONLY mutation that separates the CARDINALITY policy (`import count = 0`) from the CAPABILITY policy it replaced** · ★★★ **GREEN NEIGHBOUR: the zero-import module stays GREEN** | §2 `1b-S` **zero-import CARDINALITY** rule — ⚠️★★★★★ **NOT the capability/dependency check, which stays SILENT here** |
| **54** | 🛑★★★★★ **CJS MODULE-WRAPPER `this` INJECTION** — a CommonJS module assigning an injector onto the wrapper `this`; **EVERY enumerated forbidden token ABSENT** | 🛑★★★★★ **RED — the MODULE-SYSTEM / wrapper-`this` channel NAMED** ⚠️★★★★★ **THE PROOF THIS ROW EXISTS FOR `[MEASURED, `AR-588`]`: a 213-byte CJS module returned the LEDGER value from `project()` with a token scan reporting `[]` and its positive control alive — so the row FAILS if it reddens via a token or identifier check rather than the module-system rule** · ★★★ **GREEN NEIGHBOUR: the SAME module as ESM (`typeof this === "undefined"`) stays GREEN** | §2 `1b-S` **module-system pin (ESM only)** — ⚠️ **NOT the ambient-reads row (`this !== globalThis`) and NOT the identifier scan (`this` is a ThisExpression, not a binding), both of which stay SILENT here** |
| **55** | **clean control — unmutated** | **GREEN**, with the frame, resolved scope and digest printed | all |

⚠️★★★★★ **`3` IS THE MUTATION THIS MATRIX EXISTS FOR, AND NOTHING BEFORE THIS REVISION TESTED IT.** **Without it an implementation may make claim `B` A MERE ALIAS OF CLAIM `A` and still satisfy every other row** — the two lanes agreeing *with each other* would be reported as conformance *to the ledger*, and the gate would print a green that means far less than it says. ★★★ **It forces claim `B` to have a source of truth INDEPENDENT of claim `A`.**
⚠️★★★ **THAT SENTENCE USED TO READ *"the ONLY row that forces…"* AND IT IS NO LONGER TRUE — rows `23` and `24` now force the same property at the boundary where the operand actually lives. Corrected rather than left standing:** `A SUPERLATIVE IN A PROOF MATRIX EXPIRES THE MOMENT A ROW IS ADDED, AND AN EXPIRED SUPERLATIVE READS AS A GUARANTEE.`

⚠️★★★★★ **`23` AND `24` ARE ONE PROOF IN TWO DIRECTIONS, AND NEITHER HALF IS SUFFICIENT ALONE.** Row `23` moves the **LEDGER** while the lanes stand still and requires claim `A` to be **BYTE-IDENTICAL** — that is what proves claim `A` never READ the expectation. Row `24` moves **BOTH LANES TOGETHER** while the ledger stands still and requires claim `A` GREEN with claim `B` RED — that is what proves claim `B` is not an alias of agreement.
★★★★★ **RUN ONLY ONE AND AN IMPLEMENTATION CAN STILL PASS WHILE COUPLED: a gate that reads `cell.value` inside `project()` can be built to keep row `24` red, and a gate whose claim `B` merely re-checks agreement can be built to keep row `23` green. `A ONE-DIRECTION INDEPENDENCE PROOF IS A HALF-PROOF, AND THE HALF IT OMITS IS THE HALF AN IMPLEMENTER WILL SATISFY BY ACCIDENT.`**
⚠️ **Row `23`'s required result is BYTE-IDENTITY, not "still green".** *Still green* is satisfied by a claim `A` that read the expectation and happened to survive the change; **only byte-identity witnesses that the expectation was never an input.** `A VERDICT THAT SURVIVES A MUTATION IS WEAKER EVIDENCE THAN AN OUTPUT THAT DID NOT MOVE AT ALL.`
★★★ **`10` IS THE ONE THAT PROVES THE `43` WERE PRESERVED FOR A REASON**, and `21` is the one that survives the next unenumerated boundary.
🛑★★★★★ **PRECONDITION ON EVERY ROW IN THIS MATRIX — VALIDITY BEFORE VERDICT: a mutation fixture must PARSE and TYPE-CHECK before any verdict from it is admitted. A row is **NOT** satisfied by a `ReferenceError`, a parse failure, a type failure, or any error raised before the NAMED catcher runs.** ★★★★★ **`A MUTATION CAUGHT BY THE WRONG CHECK IS A FAILED PROOF` — and an error that fires BEFORE the catcher is the wrong check in its purest form: the run is red, the rule is untested, and the matrix reads as covered.** ⚠️ **CONVICTED HERE `[MEASURED, `AR-586 §3`]`: manifest `50(a)` as first recorded called an UNDECLARED binding and threw `ReferenceError`, so row `50` would have gone RED **without ever exercising symbol resolution.** Repaired — and the precondition is stated for ALL rows, because fixing the one token would have left the CLASS open.**
⚠️★★★★★ **EVERY ROW NAMES ITS CATCHER, AND THAT COLUMN IS NOT DECORATION: `A MUTATION CAUGHT BY THE WRONG CHECK IS A COINCIDENCE, NOT A PROOF.` A row that reddens via a different mechanism than the one named is a FAILED proof even though the run was red.**
### ✅★★★★★ THE PROMISE/CATCHER MAP — **BIDIRECTIONAL DIFFERENCE, MEASURED EMPTY**
🛑★★★★★ **THE POPULATION IS **DERIVED FROM THE CONTRACT TEXT**, NOT HAND-LISTED, AND NOT SELECTED FROM THE CATCHER TABLE.** `[MEASURED HERE — atoms extracted mechanically from the GRAMMAR's `FORBIDDEN` list, its explicit `→ FORBIDDEN` decisions, the `1b-S` table's FORBIDDEN column SPLIT PER CHANNEL, and the DEEP-frozen clause]`
```
ATOM (derived from the contract)      PLANTED MUTATION SUBCASE (concrete)          CATCHER
--- 1b-R : the value handed to project() ------------------------------------------------
accessor descriptor                   { get bindings(){ return ledger } }           40
function value                        { read: () => ledger }                        39
symbol key                            v[Symbol('ledgerRead')] = () => ledger        44
non-enumerable user field             defineProperty(v,'h',{enumerable:false})      47
undefined value                       { a: undefined }                              45(a)
bigint value                          { a: 10n }                                    45(b)
symbol value                          { a: Symbol('x') }                            45(c)
NaN                                   { a: NaN }                                    45(d)
+/-Infinity                           { a: Infinity }                               45(e)
custom / class prototype              new Lane() / Object.create(protoGetter)       42
cycle                                 root.self = root                              43
sparse hole                           [1, ,3]                                       46(a)
extra named array property            arr.note = 'x'                                46(b)
--- 1b-S : the module's own source -------------------------------------------------------
unallowlisted import                  import {read} from './ledger'                 26(a)
filesystem / network module           import fs from 'node:fs'                      26(b)
transitive edge to either             import './helper' (helper imports ledger)     26(c)
setter / configuration export         export const configure = f => {HOLDER.r = f}  34(a)
function-valued export != project     export const getLedger = () => ledger         34(b)
export that mutates module state      export const reset = () => {HOLDER.r = null}  34(c)
free / captured reference             closure over an injected reader, no export    34(d)
globalThis                            globalThis.__ledger                           35(a)
window                                window.__ledger                               35(b)
global (alias of globalThis)          global.__ledger                               35(c)
ANY unallowlisted host-global         an arbitrary free host identifier             35(d)
process / process.env                 process.env.LEDGER_PATH                       36
mutable module-scope binding          let cache = null                              37(a)
cache populated on first call         if(!c) c = readLedger()                       37(b)
singleton                             const S = new Reader()                        37(c)
lazily-initialised holder             const H = {}; H.r ??= readLedger              37(d)
SHALLOW-frozen nested holder          Object.freeze({slot:{}}) then slot.read = fn  38
import()                              await import('./ledger')                      41(a)
require, computed specifier           require('./' + name)                          41(b)
eval                                  eval("require('./ledger')")                   41(c)
new Function                          new Function("return require('./ledger')")    41(d)
createRequire                         createRequire(import.meta.url)('./ledger')    41(e)
helper-returned module constant       const C = deepFreeze(raw)                     48
spread escape                         const C = Object.freeze({...base})            49(a)
bare alias                            const C = base                                49(b)
computed key                          const C = Object.freeze({[k]: v})             49(c)
shadowed / local freeze callee        const Object={freeze:x=>x}; Object.freeze(v)  50(a)
locally-declared freeze               const freeze = x => x; freeze({slot:{}})      50(b)
aliased freeze binding                const f = Object.freeze; f({slot:{}})         50(c)
__proto__ key (Ident spelling)        Object.freeze({ __proto__: p })               51(a)
__proto__ key (StringLit spelling)    Object.freeze({ "__proto__": p })             51(b)
duplicate cooked keys (raw)           Object.freeze({ a: 1, a: 2 })                 52(a)
duplicate cooked keys (esc string)    Object.freeze({ a:1, "\x61":2 })              52(b)
duplicate cooked keys (esc ident)     Object.freeze({ a:1, \u0061:2 })              52(c)
duplicate cooked keys (mixed)         Object.freeze({ a:1, "a":2 })                 52(d)
__proto__ key (escaped identifier)    Object.freeze({ \u005f\u005fproto__: p })     51(c)
__proto__ key (escaped string)        Object.freeze({ "\x5f\x5fproto__": p })       51(d)
harmless inert static import          import {add} from './pure-math'               53
CJS module-wrapper `this` channel     this.inject = f => { HOLDER.slot.read = f }   54
------------------------------------------------------------------------------------------
  atoms with NO plantable subcase ..... EMPTY
  subcases with NO named catcher ...... EMPTY
  catcher rows with NO atom ........... EMPTY
```
⚠️🛑★★★★★ **WHAT THIS MANIFEST IS, LABELLED BECAUSE THE SUBSTITUTION IT REPLACES IS EXACTLY THE ONE `R-537 §2` CONVICTED: IT IS `[PRE-REGISTERED — NOT EXECUTED]`. NO IMPLEMENTATION EXISTS, SO NO SUBCASE HAS BEEN RUN AGAINST THE GATE. IT IS A PLANTABLE-MUTATION CONTRACT, NOT A MUTATION-COVERAGE RESULT** — and calling it coverage would be the same error one level further out.
🛑★★★★★ **WHY THE PROSE `atom → row` MAP WAS REPLACED: `A ROW NUMBER IS NOT A CATCHER UNTIL THE EXACT ATOM HAS BEEN PLANTED.` The old map recorded MEMBERSHIP — atom `x` belongs to row `n` — which let ONE REPRESENTATIVE CERTIFY AN ENTIRE CATEGORY IT NEVER EXERCISED.** `[MEASURED HERE, node v24.13.0]` **the sharpest instance: `global === globalThis` is `true` on this host, row `35` planted `globalThis` ALONE, and the contract forbids *ANY* unallowlisted host-global. `A QUANTIFIER OF `any` IS NOT DISCHARGED BY ONE REPRESENTATIVE`, and the map could not see the difference because membership was all it recorded.**
✅ **EVERY MANY-TO-ONE ROW NOW ENUMERATES ITS SUBCASES IN THE ROW ITSELF AND MUST RUN AND REPORT EACH INDEPENDENTLY** — rows `26`, `34`, `35`, `37`, `41`, `45`, `46`, `49`. **A row that reddens once and reports a category is a FAILED proof.**
⚠️🛑★★★★★ **WHY THE POPULATION MOVED FROM `10` TO `34`, STATED AGAINST THE PREVIOUS REVISION OF THIS BLOCK: the old map's forward side was TEN PROSE LABELS I CHOSE MYSELF while being the party measured. `EMPTY` over that population proved CONSISTENCY ACROSS TEN LABELS, never COMPLETENESS over the contract — cycle termination, symbol keys, enumerability and unsupported primitives were absent from BOTH sides and so could not appear in either difference.** ★★★★★ **`AN EMPTY DIFFERENCE OVER A POPULATION YOU CHOSE IS A MIRROR, NOT A MEASUREMENT` · `NAME THE PARTY WHO CHOOSES THE DENOMINATOR.`**
✅★★★★★ **THE DERIVED POPULATION IMMEDIATELY EXPOSED FOUR CHANNELS THE GRAMMAR FORBADE WITH NO ROW TO CATCH THEM — non-enumerable fields, the unsupported value classes, sparse holes and extra named array properties. ROWS `45`–`47` WERE ADDED FOR THEM RATHER THAN TRIMMING THE GRAMMAR TO MATCH THE MATRIX.** `NARROWING A PROMISE TO MATCH A WEAK CATCHER IS A TEST WEAKENED TO PASS.`
⚠️🛑★★★ **AND THE INSTRUMENT WAS AUDITED BEFORE ITS RESULT WAS BELIEVED — THREE FAULTS, ALL MINE, ALL CAUGHT BY THE REVERSE DIRECTION `[MEASURED HERE]`:** (1) an earlier draft computed `set(MAP.values()) − set(MAP.values())`, **EMPTY BY CONSTRUCTION** — a check that could never convict · (2) one atom per `1b-S` SURFACE ROW was too coarse, hiding `process.env` behind `globalThis` and producing a FALSE orphan at row `36` · (3) the DEEP-frozen clause probe was CASE-SENSITIVE against text written in caps, orphaning row `38`. ★★★★★ **BOTH DIRECTIONS NOW CARRY A NEGATIVE CONTROL: an unrecognised atom returns no catcher and is REPORTED; dropping row `44` from the claimed set makes REVERSE report `[44]`.** `AN EMPTY DIFFERENCE IS ONLY EVIDENCE IF THE CHECK COULD HAVE BEEN NON-EMPTY.`
⚠️ **THE OLD FAILURE NAME IS RETIRED: it no longer labels any verdict, and its ONLY remaining occurrence in this document is the retirement note you are reading.** ★★ **Stated that way on purpose — the first draft of this line said it *"appears nowhere in this design"* while being the one place it appeared. `A SENTENCE THAT DISPROVES ITSELF BY EXISTING IS THIS FAMILY'S PUREST FORM`, and it was caught by counting the token instead of trusting the claim.** ★★★★★ **It survived here — and ONLY here — through the rename, which is why the rule now stands: `A RENAME THAT NO TEST ENFORCES IS A CAPTION CHANGE.` After any rename, grep the PROOF section for BOTH the new token and the old one; the old name's last refuge is the place that proves it.**

---

## 11 — WHAT THIS DESIGN DOES **NOT** SETTLE (honest-partial clause)

- ⚠️ **It does not make the `140` asserted values CORRECT against the authority document.** They are frozen **as observed**; a correctly-cited but mis-transcribed value survives every check here. **This is the standing rung-3 limit** — *"is this expectation SOURCED"* and *"is it WELL-FORMED"* are closed; *"does the cited authority actually SAY this"* is not. **Named, not closed.**
- ⚠️ **It does not close the `43` undeclared cells.** `R-521 §2` settled that: no cell may be promoted without a named source authority, and neither the desk nor this seat may invent one. **The gate's job is to REFUSE to claim completeness over them, and it does.**
- ⚠️ **CI enforcement is `[UNPROVEN]`** — §8.4. Naming it as future work is what the contract permits; claiming it works would be the thing this campaign convicts.
- ✅★★★★★ **PROJECTION MEANING IS SETTLED, AND SO IS THE LAYER THAT USED TO BE DECLARED UNKNOWN.** §2 now publishes THREE surfaces: the five-field **projection** (claim `A`'s entire input), the **TS-source ↔ wire mapping** enumerated from `BINDING_KEY_MAP` and `ConditionBinding.to_dict()` at `c304b098`, and the seven **ledger axes** consumed only by `evaluate()`. ⚠️ **The `[DECLARED UNKNOWN]` label is REMOVED from this document because the thing it labelled is now enumerated — not because it was reclassified.** ★★★ **It was one `git grep` away the whole time, which is the honest and unflattering reason it could be closed in a single edit.** `A DECLARED UNKNOWN IS ADMISSIBLE ONLY WHILE IT IS ACTUALLY UNKNOWN.`
- ⚠️★★★ **WHAT IS STILL NOT SETTLED HERE, STATED SO THE CLOSURE IS NOT OVERREAD: the mapping is enumerated AT `c304b098`. It is a MEASUREMENT OF ONE PINNED COMMIT, not a guarantee about the next one** — which is exactly why the red-proof is retargeted at that table rather than at prose, so a future rename goes RED instead of going unnoticed.
- ★★ **I do not grade my own work.** Whether this design is sound is an independent call.

---

## 12 — STOP-CONDITION COMPLIANCE

**The dispatch's stop condition: if the design finds itself reading membership, requiredness or completeness from the artifact it will judge, STOP.**
✅ **It does not.** Membership comes from the pinned specs; requiredness (the axis set and every closed key set) is frozen in the gate's own source; completeness is computed from the reconstruction and the ledger's per-cell classifications, both of which are compared against the independent frame rather than trusted. **The ledger is an INPUT THAT MUST PROVE ITSELF, never an authority about itself.**
⚠️★★★★★ **AND `ORACLE.json`'s ROLE, STATED IN THREE CLAUSES BECAUSE THE EARLIER ONE-LINER WAS TOO BROAD AND LAUNDERED ITS HISTORY:**
1. **It is authoritative for NO membership, requiredness, or completeness decision** — a forged oracle produces a **NAMED MISMATCH against the reconstruction**, a loud failure, never a silent pass.
2. ⚠️ **It IS the HISTORICAL SOURCE of the frozen observed values the ledger now carries** — the `140` `ASSERTED` values were transcribed FROM it.
3. ⚠️★★★★★ **The AUTHORITY DOCUMENT is the intended semantic authority, and the `140` oracle→authority transcriptions REMAIN UNVERIFIED.**
★★★★★ **THE EARLIER PHRASING — *"authoritative for nothing"* — WAS MINE TO WRITE AND IT MADE CLAIM `B`'s CAPTION EASIER TO OVERREAD: if the oracle is authoritative for nothing, a reader naturally assumes the values came from somewhere better. They did not. `THE MIS-NAMED CLAIM AND THE OVER-BROAD DISCLAIMER REINFORCED EACH OTHER`, which is why they are one defect wearing two numbers.
★★★ **THE TRIPWIRE ON THIS CLAIM, STATED SO A LATER SEAT CAN JUDGE IT RATHER THAN TRUST IT: if `ORACLE.json` EVER becomes authoritative for anything in `P0-vNext`, §1 IS INVERTED AND THIS DESIGN MUST BE RE-REVIEWED, NOT PATCHED.** `THE DEFECT SIX ATTEMPTS DIED ON WAS AN ARTIFACT BEING ASKED TO DEFINE ITS OWN COMPLETENESS, AND THE ONLY DURABLE DEFENCE IS THAT IT DEFINES NOTHING.`
