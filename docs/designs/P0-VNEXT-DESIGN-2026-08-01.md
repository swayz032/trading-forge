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
| **B · CORRECTNESS** — the projected value matches the frozen expectation | **`ASSERTED` only (`140`)** | `INCORRECT`, naming cell, expected, observed, authority citation | **NO, by construction.** Correctness is claimed *only* where an expectation exists. |
| **C · COMPLETENESS** — every cell in a scope is adjudicated | **any scope a caller asks about** | ★★★★★ **`INCOMPLETE_AUTHORITY`, NAMING every unadjudicated cell — FAIL CLOSED, NEVER a correctness green** | **YES. This is the claim that carries the `43`.** |

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

For every one of the `301` cells the gate obtains the TS projection and the Python projection and requires them equal — **including cells with no expectation.** A cell where a lane emits nothing is `ABSENT` and `ABSENT ≠ ABSENT` is **not** silently true: **a lane that emits nothing where the other emits a value is a `DISAGREEMENT`**, named.
⚠️ **`AGREEMENT IS CHECKED WHERE TRUTH IS UNKNOWN` — that is the point of running it over all `301` rather than over the `140`.**

---

## 3 — CONTRACT 3: CORRECTNESS ONLY FOR `ASSERTED`

Correctness is evaluated **only** on the `140` `ASSERTED` cells, against `cell.value`, and every failure carries `cell.authority_citation` so the reader can reach the source.
⚠️ **NO CORRECTNESS VERDICT IS EMITTED FOR ANY OTHER CLASS — not `pass`, not `skip`, not `n/a`.** ★★ **A `PASS` printed over a cell with no expectation is the false green this entire arc exists to kill; the absence of a verdict is the honest output.**

---

## 4 — CONTRACT 4: `NOT-APPLICABLE` PRODUCES NO ASSERTION AND NO ACCIDENTAL PREDICATE

The `9` `NOT-APPLICABLE` cells must contribute **no comparison, no predicate, and no counter** to any correctness verdict.
⚠️★★★★★ **AND THE ABSENCE MUST BE WITNESSED, NOT ASSUMED.** `A NEGATIVE ASSERTION NEEDS A POSITIVE WITNESS THAT THE PATH RAN.` The gate therefore **emits an explicit `NOT_APPLICABLE_SKIPPED` record naming each of the `9`**, so "no predicate ran" is a printed fact rather than an unobservable silence.
**Red-proof (pre-registered):** graft an expectation onto a `NOT-APPLICABLE` cell → the run must **FAIL**, naming it. If it passes, the class is being evaluated somewhere.

---

## 5 — CONTRACT 5: `UNADJUDICATED` → `INCOMPLETE_AUTHORITY`, FAIL CLOSED

> ★★★★★ **A CELL IS `DEPENDED-ON` WHEN THE VERDICT THE CALLER ASKED FOR WOULD CHANGE IF THAT CELL'S VALUE WERE KNOWN.**

Operationally, and this is the whole definition:
- **Claim A (agreement)** never depends on an `UNADJUDICATED` cell — the two lanes are compared to each other.
- **Claim B (correctness)** never depends on one — it is scoped to `ASSERTED` by construction.
- **Claim C (completeness)** depends on **every** cell in the scope asked about. **Any `UNADJUDICATED` cell in that scope ⇒ `INCOMPLETE_AUTHORITY`, naming every such cell, and the scope's completeness verdict is NOT GREEN.**

⚠️★★★★★ **THE RULE THAT PREVENTS THE COMFORTABLE READING: NO CALLER MAY OBTAIN A COMPLETENESS GREEN BY NARROWING ITS SCOPE SILENTLY.** A scope is declared before the run and printed with its verdict, so *"complete over `X`"* always carries `X`. **`A COMPLETENESS CLAIM WITHOUT ITS SCOPE IS THE CAPTION DEFECT WEARING A VERDICT'S CLOTHES.`**
★★★ **CONSEQUENCE, STATED PLAINLY SO NOBODY IS SURPRISED BY IT LATER: on today's authority, a completeness claim over the full frame CANNOT go green, because `152` cells are unadjudicated and `43` of them are not even declared. THAT IS THE CORRECT ANSWER, NOT A BUG.** ✅ **Claims A and B can both go green today. Promotion decisions that need C must either narrow their scope explicitly — and print it — or wait for an authority amendment.**

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
| ⚠️ **`ORACLE.json` — AUTHORITATIVE FOR NOTHING, COMPARED ONLY** | **root:** `_README` · `_authority_hash_history` · `authority_file` · `authority_sha256` · `fixtures` · `required_members` · **each fixture:** `_note` · `authority` · `compiled` · `conditions` · `conditions_unadjudicated` · `conditions_unadjudicated_ids` · `reasons_must_differ_from` · `scalars_unadjudicated` · `spine_bound` · `spine_total` · **each row:** `approximation` · `authority` · `bindable` · `primitive_null` · `reason_excludes` · `reason_names` · `reason_null` · `session_zone` · `unadjudicated` |
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

| # | mutation | required result |
|---|---|---|
| 1 | delete a row from the ledger | **RED** — `LEDGER_INCOMPLETE`, named |
| 2 | add a cell outside the reconstruction | **RED** — `LEDGER_UNKNOWN_CELL`, named |
| 3 | make one lane emit a different value | **RED** — `DISAGREEMENT`, both values named |
| 4 | make one lane emit nothing where the other emits | **RED** — not silently equal |
| 5 | corrupt an `ASSERTED` expectation | **RED** — `INCORRECT`, citation printed |
| 6 | graft an expectation onto a `NOT-APPLICABLE` cell | **RED** |
| 7 | ask for completeness over a scope containing an `UNADJUDICATED` cell | **RED** — `INCOMPLETE_AUTHORITY`, every such cell named |
| 8 | forge `counts_by_basis.UNDECLARED` `43 → 0` | **RED** — recomputed-vs-published mismatch, both numbers |
| 9 | plant an unknown key at ANY boundary | **RED** — key named |
| 10 | delete a known key at ANY boundary | **RED** — key named |
| 11 | retarget or delete the pinned tag | **RED** |
| 12 | **clean control — unmutated** | **GREEN**, with the frame and scope printed |
★★★ **`7` IS THE ONE THAT MATTERS MOST: it is the only test that proves the `43` were preserved for a reason.**

---

## 11 — WHAT THIS DESIGN DOES **NOT** SETTLE (honest-partial clause)

- ⚠️ **It does not make the `140` asserted values CORRECT against the authority document.** They are frozen **as observed**; a correctly-cited but mis-transcribed value survives every check here. **This is the standing rung-3 limit** — *"is this expectation SOURCED"* and *"is it WELL-FORMED"* are closed; *"does the cited authority actually SAY this"* is not. **Named, not closed.**
- ⚠️ **It does not close the `43` undeclared cells.** `R-521 §2` settled that: no cell may be promoted without a named source authority, and neither the desk nor this seat may invent one. **The gate's job is to REFUSE to claim completeness over them, and it does.**
- ⚠️ **CI enforcement is `[UNPROVEN]`** — §8.4. Naming it as future work is what the contract permits; claiming it works would be the thing this campaign convicts.
- ⚠️ **The projection mechanics are not specified here** — how the TS and Python lanes are invoked and how a cell's projected value is extracted from each. **That is implementation, and this is a design document.** ★★ **I flag it because it is where a "cell" could quietly become "whatever the lane happens to emit", which would re-import the presence-derived defect at the projection layer.**
- ★★ **I do not grade my own work.** Whether this design is sound is an independent call.

---

## 12 — STOP-CONDITION COMPLIANCE

**The dispatch's stop condition: if the design finds itself reading membership, requiredness or completeness from the artifact it will judge, STOP.**
✅ **It does not.** Membership comes from the pinned specs; requiredness (the axis set and every closed key set) is frozen in the gate's own source; completeness is computed from the reconstruction and the ledger's per-cell classifications, both of which are compared against the independent frame rather than trusted. **The ledger is an INPUT THAT MUST PROVE ITSELF, never an authority about itself.**
⚠️★★★★★ **AND `ORACLE.json`, NOW THAT §7 NAMES IT, IS EXPLICITLY IN THE SAME POSITION AND WEAKER: it is PARSED and SCHEMA-CHECKED, and it is AUTHORITATIVE FOR NOTHING.** It contributes to **no** membership, requiredness or completeness decision — a forged oracle produces a **NAMED MISMATCH against the reconstruction**, which is a loud failure, never a silent pass.
★★★ **THE TRIPWIRE ON THIS CLAIM, STATED SO A LATER SEAT CAN JUDGE IT RATHER THAN TRUST IT: if `ORACLE.json` EVER becomes authoritative for anything in `P0-vNext`, §1 IS INVERTED AND THIS DESIGN MUST BE RE-REVIEWED, NOT PATCHED.** `THE DEFECT SIX ATTEMPTS DIED ON WAS AN ARTIFACT BEING ASKED TO DEFINE ITS OWN COMPLETENESS, AND THE ONLY DURABLE DEFENCE IS THAT IT DEFINES NOTHING.`
