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

> ### ★★★★★ WHAT EACH AXIS *MEANS* — RAW PATH AND NORMALIZATION. **CONTRACT, NOT MECHANICS.**
> ⚠️ **Claim `A`'s meaning is fixed by WHICH RAW FIELD represents each axis and HOW it is normalized. A presence matrix over an unspecified extraction still lets two lanes agree about the WRONG FIELD.** `[paths MEASURED in the shipped gate at `c304b098`; row identity is `condition_id`]`
>
> | axis | raw path (both lanes, in the projected plan) | normalization |
> |---|---|---|
> | `bindable` | `bindings[condition_id].bindable` | direct boolean compare |
> | `session_zone` | `bindings[condition_id].session_zone` | STRUCTURAL compare (`JSON.stringify`), not `===` |
> | `approximation` | `bindings[condition_id].approximation` | direct boolean compare |
> | `primitive_null` | ⚠️ **DERIVED** from `bindings[condition_id].primitive` | `primitive === null` → boolean |
> | `reason_null` | ⚠️ **DERIVED** from `bindings[condition_id].reason` | `reason === null` → boolean |
> | `reason_names` | ⚠️ **DERIVED** from `bindings[condition_id].reason` | substring/zone-naming predicate over the reason string |
> | `reason_excludes` | ⚠️ **DERIVED** from `bindings[condition_id].reason` | exclusion predicate over the reason string |
>
> ★★★ **FOUR OF SEVEN AXES ARE DERIVED, AND THREE OF THOSE READ ONE RAW FIELD — `reason`.** A change to how `reason` is emitted moves three axes at once; that coupling is a property of the design and is stated rather than discovered.
> ⚠️ **`[DECLARED UNKNOWN, not deferred]` The per-lane EMITTER paths — which TypeScript source field becomes each wire name — are fixed by the normalization mapping in the gate, and I have NOT enumerated that mapping here. The axis, its projected path and its normalization are named above; the TS-source-field ↔ wire-name mapping is the one layer still unnamed, and it is named AS unnamed.** `A DECLARED UNKNOWN IS ADMISSIBLE; CALLING IT IMPLEMENTATION IS NOT.`

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
> ⚠️★★★★★ **THE VOCABULARY EXISTS AND IT SPEAKS ABOUT A DIFFERENT POPULATION.** Phase 1 exits on a **TIER-A STRATEGY SPEC** with every load-bearing condition bound; this ledger's `43` rows are **TWELVE PARITY FIXTURES** under `ci/fixtures/`. **No artifact in this repo joins the two.**
> ★★★★★ **SO ANY ADMISSION SCOPE I WROTE TODAY WOULD BE AUTHORED BY THE PARTY THAT WILL BE MEASURED AGAINST IT — the eighth sighting of the denominator family, aimed at the consumer, and the one place I can still refuse it rather than close it one level in.** `DO NOT LET THE IMPLEMENTER AUTHOR THE EXAM IT WILL IMMEDIATELY PASS.`
> ✅ **WHAT WOULD MAKE IT AVAILABLE, NAMED SO THE REFUSAL IS ACTIONABLE:** an independent, committed artifact that (i) enumerates the tier-A spec set by identity and (ii) marks which of each spec's conditions are load-bearing — authored by whoever owns Phase 1's exit criterion, **not by this gate and not by its implementer.** ⚠️ **Until then the Phase-1 consumer has NO registered profile, and a consumer with no profile FAILS CLOSED rather than defaulting to the full frame.**

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
| **23** | **clean control — unmutated** | **GREEN**, with the frame, resolved scope and digest printed | all |

⚠️★★★★★ **`3` IS THE MUTATION THIS MATRIX EXISTS FOR, AND NOTHING BEFORE THIS REVISION TESTED IT.** **Without it an implementation may make claim `B` A MERE ALIAS OF CLAIM `A` and still satisfy every other row** — the two lanes agreeing *with each other* would be reported as conformance *to the ledger*, and the gate would print a green that means far less than it says. ★★★ **It is the only row that forces claim `B` to have a source of truth INDEPENDENT of claim `A`.**
★★★ **`10` IS THE ONE THAT PROVES THE `43` WERE PRESERVED FOR A REASON**, and `21` is the one that survives the next unenumerated boundary.
⚠️★★★★★ **EVERY ROW NAMES ITS CATCHER, AND THAT COLUMN IS NOT DECORATION: `A MUTATION CAUGHT BY THE WRONG CHECK IS A COINCIDENCE, NOT A PROOF.` A row that reddens via a different mechanism than the one named is a FAILED proof even though the run was red.**
⚠️ **THE OLD FAILURE NAME IS RETIRED: it no longer labels any verdict, and its ONLY remaining occurrence in this document is the retirement note you are reading.** ★★ **Stated that way on purpose — the first draft of this line said it *"appears nowhere in this design"* while being the one place it appeared. `A SENTENCE THAT DISPROVES ITSELF BY EXISTING IS THIS FAMILY'S PUREST FORM`, and it was caught by counting the token instead of trusting the claim.** ★★★★★ **It survived here — and ONLY here — through the rename, which is why the rule now stands: `A RENAME THAT NO TEST ENFORCES IS A CAPTION CHANGE.` After any rename, grep the PROOF section for BOTH the new token and the old one; the old name's last refuge is the place that proves it.**

---

## 11 — WHAT THIS DESIGN DOES **NOT** SETTLE (honest-partial clause)

- ⚠️ **It does not make the `140` asserted values CORRECT against the authority document.** They are frozen **as observed**; a correctly-cited but mis-transcribed value survives every check here. **This is the standing rung-3 limit** — *"is this expectation SOURCED"* and *"is it WELL-FORMED"* are closed; *"does the cited authority actually SAY this"* is not. **Named, not closed.**
- ⚠️ **It does not close the `43` undeclared cells.** `R-521 §2` settled that: no cell may be promoted without a named source authority, and neither the desk nor this seat may invent one. **The gate's job is to REFUSE to claim completeness over them, and it does.**
- ⚠️ **CI enforcement is `[UNPROVEN]`** — §8.4. Naming it as future work is what the contract permits; claiming it works would be the thing this campaign convicts.
- ✅ **PROJECTION MEANING IS NO LONGER DEFERRED — §2 now names, per axis, the RAW PATH and the NORMALIZATION**, because claim `A`'s meaning depends on them entirely and *"a presence matrix over an unspecified extraction still lets two lanes agree about the wrong field."* ⚠️ **What remains genuinely unnamed is ONE layer: the TS-source-field ↔ wire-name mapping. It is DECLARED as unknown in §2, not called implementation.** ★★★ **The earlier version of this bullet called the whole thing "implementation" — that was the gap sitting in the one interface most able to manufacture a false green.**
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
