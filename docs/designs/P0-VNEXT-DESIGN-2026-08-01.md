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

For every one of the `301` cells the gate obtains the TS projection and the Python projection and requires them equal — **including cells with no expectation.**
⚠️ **`AGREEMENT IS CHECKED WHERE TRUTH IS UNKNOWN` — that is the point of running it over all `301` rather than over the `140`.**

> ### ★★★★★ THE FOUR-CASE PRESENCE MATRIX — **PUBLISHED BEFORE ANY CODE EXISTS**
> | TS | Python | verdict |
> |---|---|---|
> | present | present | compare **typed canonical** values; unequal ⇒ `DISAGREEMENT`, path + both values named |
> | present | absent | ⚠️ **`DISAGREEMENT`**, path + value named — **never silently equal** |
> | absent | present | ⚠️ **`DISAGREEMENT`**, path + value named |
> | **absent** | **absent** | ★★★★★ **`PROJECTION_MISSING_BOTH` — a FAILURE — UNLESS that exact cell is authority-classified `NOT-APPLICABLE`** |
>
> ⚠️★★★★★ **THE LAST ROW IS THE WHOLE REASON THIS MATRIX IS A DESIGN CONTRACT AND NOT AN IMPLEMENTATION DETAIL: `PARITY OVER TWO DEAD LANES IS VACUOUS`. Two lanes that both emit nothing agree perfectly and prove nothing, and this campaign has already paid for that law once.** ★★★ **The previous version left projection mechanics "unspecified" as a declared gap — but claim `A` depends ENTIRELY on them, so the gap was in the one interface most capable of manufacturing a false green.**
> **PER-PROJECTION RECORD, required fields:** raw lane path · **raw presence, with `MISSING` DISTINCT FROM JSON `null`** · raw value · canonical type · normalized value · **the pure transformation used for any derived axis** (`primitive_null` · `reason_names` · `reason_excludes`).
> ★★ **`MISSING` and `null` collapsing into one another is how an absent projection becomes a legitimate-looking value; they are recorded as different states, always.**

> ### 🛑★★★★★ `project()` AND `evaluate()` ARE DIFFERENT FUNCTIONS WITH DIFFERENT INPUTS — **THIS IS THE LOAD-BEARING RULE OF THE WHOLE DESIGN**
> **`project(lane) → projection`** reads **ONLY** the lane's own output plus the frozen, **LEDGER-INDEPENDENT** normalization contract below. **`evaluate(cell, projection) → claim-`B` verdict`** is the ONLY function that may see a ledger expectation.
> 🛑★★★★★ **CLAIM `A` MAY NOT READ `cell.value`, `cell.authority_citation`, OR ANY ORACLE EXPECTATION — NOT TO CHOOSE WHAT TO PROJECT, NOT TO NORMALIZE IT, NOT TO DECIDE WHETHER A CELL PARTICIPATES.** `project()` does not receive the ledger as an argument, and that is the enforceable form of the rule: **an input it cannot reach is a coupling it cannot form.**
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
> **RED-PROOF RETARGETED AT THIS TABLE, NOT AT AN INVENTED SURROGATE:** change any one mapping's wire name, or delete an entry, and the run must go RED naming the exact key — **the `EXTRA RAW KEY` / `MISSING MAPPED KEY` / `DUPLICATE DESTINATION` / `UNCONSUMED KEY` rejections already exist in `projectExhaustively()` and this is the table they are obliged to defend.** ★★ **The proof now points at a real, enumerated object; before this revision it pointed at a layer the document said it had not named.**

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
> ⚠️★★★★★ **THE VOCABULARY EXISTS AND IT SPEAKS ABOUT A DIFFERENT POPULATION.** Phase 1 exits on a **TIER-A STRATEGY SPEC** with every load-bearing condition bound; this ledger's `43` rows are **TWELVE PARITY FIXTURES** under `ci/fixtures/`. **The exact filename ↔ stub intersection is EMPTY.**
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
> 1. ⚠️ **`extraction_source` IS A DEAD SESSION-TEMP SCRATCHPAD** — `…/Temp/claude/…/d96dba1d-…/scratchpad/SEALED-READ/phase_b`. **That path no longer exists and cannot be re-read.** ★★ **The same non-durable-provenance defect `R-524` flagged in the `P0` verifier.**
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

⚠️★★★★★ **THIS MATRIX IS `24` MUTATIONS **PLUS** `1` CLEAN CONTROL — `25` NUMBERED ROWS.** `[COUNTED FROM THE TABLE BELOW BY PARSE, after the rows landed; NOT copied from any prior statement of the figure.]`
★★★★★ **THE CAPTION IS STATED IN THAT FORM BECAUSE THE PREVIOUS ONE WAS WRONG IN EXACTLY THE WAY THAT FLATTERS A SUITE: `AR-566`'s header said *"`23` MUTATIONS"* when the truth was `22` mutations and `1` control.** ⚠️ **`A CONTROL COUNTED AS AN ATTACK INFLATES A SUITE'S ADVERSARIAL STRENGTH BY EXACTLY THE ROW THAT PROVES IT IS NOT ALWAYS RED.` The control is the row that makes the other twenty-four mean something; it is not one of them.**
⚠️★★★ **AND THE COUNT IS RE-DERIVED WHENEVER A ROW IS ADDED — never carried across an edit.** `A HAND-COPIED EXPECTED VALUE IS A FABRICATED SAFETY CLAIM`, and a row count copied from the version before last is exactly that.

| # | mutation | required result | **THE CATCHER** |
|---|---|---|---|
| 1 | delete a row from the ledger | RED — `LEDGER_INCOMPLETE`, named | §1 reconstruction diff |
| 2 | add a cell outside the reconstruction | RED — `LEDGER_UNKNOWN_CELL`, named | §1 reconstruction diff |
| **3** | ★★★★★ **THE SAME WRONG VALUE IN BOTH LANES, on one `ASSERTED` cell** | ★★★★★ **claim `A` stays GREEN · claim `B` ALONE emits `LEDGER_DIVERGENCE`, citation printed** | §3 conformance against `cell.value` |
| 4 | one lane emits a different value | RED — `DISAGREEMENT`, both values named | §2 matrix row 1 |
| 5 | one lane emits nothing where the other emits a value | RED — `DISAGREEMENT`, path + value named | §2 matrix rows 2–3 |
| 6 | both lanes missing a **non-`NOT-APPLICABLE`** cell | RED — `PROJECTION_MISSING_BOTH` | §2 matrix row 4 |
| 7 | both lanes missing an **exact `NOT-APPLICABLE`** cell | GREEN **plus the named skip witness**, and **NO claim-`B` predicate** | §4 skip witness |
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
| **25** | **clean control — unmutated** | **GREEN**, with the frame, resolved scope and digest printed | all |

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
