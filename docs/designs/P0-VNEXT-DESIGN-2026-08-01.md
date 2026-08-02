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
> 1. **`project()` LIVES IN A DEPENDENCY-ISOLATED MODULE OR A SEPARATE PROCESS.** Its dependency closure contains **no ledger reader, no oracle reader, and no module that transitively imports either.**
> 2. **THE PROJECTION CONTRACT IS A CLOSED SCHEMA OF PLAIN DATA** — the five raw fields and their three presence states. ⚠️ **NO functions, NO callbacks, NO opaque objects, NO thunks.** `A CALLBACK IS A LEDGER READER WEARING A PARAMETER'S CLOTHES.`
> 3. ★★★★★ **BOTH LANE PROJECTIONS ARE SEALED BEFORE THE LEDGER IS PARSED.** Sequencing is the part a reviewer can actually check: **if the ledger is not yet in memory, no projection can have consulted it**, and the seal is a digest taken at that point.
> 4. **A DEPENDENCY-BOUNDARY CHECK FAILS THE RUN** on any forbidden import path or captured reference reaching `project()`'s closure — **and it names the offending path.**
> 5. ★★★★★ **A WHOLE-EXPECTATION-SURFACE MUTATION: perturb EVERY expectation in the ledger at once; the required result is an IDENTICAL PROJECTION DIGEST.**
> ⚠️🛑★★★★★ **AND ITS SCOPE, STATED BECAUSE THE PREVIOUS REVISION OVERCLAIMED IT: this proves `INVARIANCE UNDER THIS MUTATION, OVER THE EXERCISED 43-ROW POPULATION.` **IT DOES NOT PROVE NON-REACHABILITY.** A forbidden read of `classification`, ledger LENGTH, schema version, citations or scope digest survives this mutation untouched — as does any branch those `43` rows never execute.**
> 🛑★★★★★ **THE DELETED SENTENCE WAS *"a capability argument can be wrong about the mechanism; A DIGEST THAT DID NOT MOVE CANNOT."* **THAT IS A UNIVERSAL AND IT IS FALSE.** `R-530` retired one false absolute here and the replacement was ANOTHER absolute one level out.** ★★★★★ **`AN UNCHANGED DIGEST PROVES INVARIANCE UNDER THE MUTATION YOU RAN, NOT THE IMPOSSIBILITY OF EVERY COUPLING YOU DID NOT RUN.`** ✅ **The mutation is KEPT — it is a strong behavioural control. Only its quantifier is gone.**

> ### 🛑★★★★★ THE CAPABILITY CONTRACT — **ONE OPTION, CHOSEN. THE MENU IS DELETED.**
> ✅★★★★★ **CHOSEN: (b) A NON-ADVERSARIAL PURE-MODULE CONTRACT, ENFORCED BY A CLOSED DEPENDENCY GRAPH.** `project()` lives in a module whose **transitive import closure is enumerated and frozen**, and a build-time **dependency/AST rule FAILS THE BUILD** if that closure acquires any ledger or oracle reader, any filesystem/network module, or any dynamic `import()`.
> 🛑★★★★★ **AND ITS CLAIM IS NARROWED TO WHAT THAT MECHANISM CAN ACTUALLY DELIVER: IT PREVENTS *ACCIDENTAL* COUPLING. IT IS **NOT** A SANDBOX AND DOES **NOT** MAKE THE LEDGER UNREACHABLE TO DETERMINED CODE.** A module that wants the ledger can still read it through `globalThis`, an env var, or a dependency that changes behaviour after review. **THAT IS THE HONEST CEILING OF THIS OPTION AND IT IS STATED RATHER THAN IMPLIED.**
> ⚠️★★★★★ **WHY (a) WAS NOT CHOSEN, SAID PLAINLY: a genuinely restricted runtime would be STRONGER, and I cannot NAME an enforcement mechanism for it on this host today, nor red-proof each forbidden channel.** ★★★ **`AN UNNAMED MECHANISM CANNOT BE VERIFIED, WHATEVER THE OS DOES` — and `A TOPOLOGY STATEMENT IS NOT A CAPABILITY PROOF`. Writing *"separate process"* and calling it filesystem isolation would have been the previous two false absolutes wearing a third costume: `A CHILD PROCESS IS A BOUNDARY FOR STATE, NOT AUTOMATICALLY A BOUNDARY FOR AUTHORITY.`**
> ✅ **THREAT MODEL, EXPLICIT: this contract defends against an implementer WIRING THE LEDGER IN BY MISTAKE — the failure this whole arc has actually suffered, four times, every one of them accidental. It does not defend against a hostile implementer, and no claim here should be read as if it does.**
> **RED-PROOFS IT OWES (each a build-time failure, each naming the offending path):** add a ledger-reader import to the closure · add a filesystem module · introduce a dynamic `import()` · add a transitive dependency that pulls in either. ⚠️ **A channel this contract does NOT claim to deny gets NO red-proof and NO claim — `globalThis`, environment variables and post-review dependency behaviour are named here as OUT OF SCOPE rather than left to be assumed covered.**
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

⚠️★★★★★ **THIS MATRIX IS `33` MUTATIONS **PLUS** `1` CLEAN CONTROL — `34` NUMBERED ROWS.** `[COUNTED FROM THE TABLE BELOW BY PARSE, after the rows landed; NOT copied from any prior statement of the figure.]`
★★★★★ **FOURTH RECOMPUTATION. The caption has read `23`, `22+1`, `24+1`, `29+1` and `32+1`, and every one was correct until the next rows landed.** ⚠️ **`A CONTROL COUNTED AS AN ATTACK INFLATES A SUITE'S ADVERSARIAL STRENGTH BY EXACTLY THE ROW THAT PROVES IT IS NOT ALWAYS RED` · `A COUNT CARRIED ACROSS AN EDIT IS STALE THE MOMENT THE EDIT LANDS.`**
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
| **26** | **FORBIDDEN DEPENDENCY** — give `project()`'s closure an import or captured reference reaching a ledger/oracle reader | RED — run fails, **the offending path NAMED** | §2 dependency-boundary check |
| **27** | ★★★★★ **UNIQUE-WRONG-DESTINATION RENAME** — `sessionZone: "session_zone"` → `sessionZone: "sessionZone"` (source set identical · destination unique · entry consumed) | RED — **unknown destination key NAMED** | **STAGE 1** destination-schema membership — ⚠️ **NOT `projectExhaustively()`'s source check, which stays silent here** |
| **28** | **SOURCE-SIDE KEY MUTATION** — add an unmapped raw field, or delete a mapped one, on the lane object | RED — `EXTRA RAW KEY` / `MISSING MAPPED KEY`, key NAMED | §2 `projectExhaustively()` source-key check |
| **29** | ★★★★★ **DUPLICATE EMITTED `condition_id` IN ONE LANE** — source fixture CLEAN, opposite lane FIXED | RED at the **emitted-uniqueness boundary, BEFORE claim `A` evaluates** | §2c per-lane emitted uniqueness |
| **30** | 🛑★★★★★ **CLASSIFICATION-ONLY LEDGER MUTATION** — change ONLY a `classification`; **every `cell.value` untouched** | 🛑★★★★★ **claim `A`'s PROJECTION *AND VERDICT* BYTE-IDENTICAL · claims `B`/`C` may move** | §2 claim `A` reads no ledger field |
| **31** | **WRONG FIVE-FIELD SELECTOR** — drop or add one key in the claim-`A` selection | RED — selector difference NAMED | **STAGE 2** selector validation |
| **32** | **SIXTH / UNKNOWN RAW FIELD** on the lane object | RED — extra source key NAMED | **STAGE 1** source-set difference |
| **33** | 🛑★★★★★ **N/A DISCRIMINATOR — ONE LANE ONLY, `approximation True → null` on an N/A cell** | 🛑★★★★★ **claim `A` RED (`DISAGREEMENT`, path + both values named) · claim `B` STILL EMITS THE SAME `9` SKIP WITNESSES** | §2 as-emitted comparison |
| **34** | **clean control — unmutated** | **GREEN**, with the frame, resolved scope and digest printed | all |

⚠️★★★★★ **`3` IS THE MUTATION THIS MATRIX EXISTS FOR, AND NOTHING BEFORE THIS REVISION TESTED IT.** **Without it an implementation may make claim `B` A MERE ALIAS OF CLAIM `A` and still satisfy every other row** — the two lanes agreeing *with each other* would be reported as conformance *to the ledger*, and the gate would print a green that means far less than it says. ★★★ **It forces claim `B` to have a source of truth INDEPENDENT of claim `A`.**
⚠️★★★ **THAT SENTENCE USED TO READ *"the ONLY row that forces…"* AND IT IS NO LONGER TRUE — rows `23` and `24` now force the same property at the boundary where the operand actually lives. Corrected rather than left standing:** `A SUPERLATIVE IN A PROOF MATRIX EXPIRES THE MOMENT A ROW IS ADDED, AND AN EXPIRED SUPERLATIVE READS AS A GUARANTEE.`

⚠️★★★★★ **`23` AND `24` ARE ONE PROOF IN TWO DIRECTIONS, AND NEITHER HALF IS SUFFICIENT ALONE.** Row `23` moves the **LEDGER** while the lanes stand still and requires claim `A` to be **BYTE-IDENTICAL** — that is what proves claim `A` never READ the expectation. Row `24` moves **BOTH LANES TOGETHER** while the ledger stands still and requires claim `A` GREEN with claim `B` RED — that is what proves claim `B` is not an alias of agreement.
★★★★★ **RUN ONLY ONE AND AN IMPLEMENTATION CAN STILL PASS WHILE COUPLED: a gate that reads `cell.value` inside `project()` can be built to keep row `24` red, and a gate whose claim `B` merely re-checks agreement can be built to keep row `23` green. `A ONE-DIRECTION INDEPENDENCE PROOF IS A HALF-PROOF, AND THE HALF IT OMITS IS THE HALF AN IMPLEMENTER WILL SATISFY BY ACCIDENT.`**
⚠️ **Row `23`'s required result is BYTE-IDENTITY, not "still green".** *Still green* is satisfied by a claim `A` that read the expectation and happened to survive the change; **only byte-identity witnesses that the expectation was never an input.** `A VERDICT THAT SURVIVES A MUTATION IS WEAKER EVIDENCE THAN AN OUTPUT THAT DID NOT MOVE AT ALL.`
★★★ **`10` IS THE ONE THAT PROVES THE `43` WERE PRESERVED FOR A REASON**, and `21` is the one that survives the next unenumerated boundary.
⚠️★★★★★ **EVERY ROW NAMES ITS CATCHER, AND THAT COLUMN IS NOT DECORATION: `A MUTATION CAUGHT BY THE WRONG CHECK IS A COINCIDENCE, NOT A PROOF.` A row that reddens via a different mechanism than the one named is a FAILED proof even though the run was red.**
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
