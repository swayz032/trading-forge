# P0 REDESIGN PACKET — `check-spec-binding-plan-parity.ts` oracle-side contract

**Authority:** R-516 §8 · **Author:** working agent, seat `claude.exe 26204` (filed AR-533→AR-542) · **Date:** 2026-07-31
**Object under redesign:** `scripts/check-spec-binding-plan-parity.ts` + `ci/fixtures/spec-binding-parity-expanded/ORACLE.json`
**Status of the current design:** **RETIRED** by R-516 under Blueprint v4 §15.7. **No fifth patch round is authorized.**
**This is a DOCUMENT. No implementation code is written by this packet.**

**Evidence base, and its grades:**
- `GRADE-C304B098-2026-07-31.md` (`33,385` B, band `6/10`, `accuracy-validator`, independence declared vs all four predecessors) — **[MEASURED BY GRADED INSTRUMENT]** for every mutation result quoted below. I did **not** re-execute them; re-running its harness reproduces its instrument and is not a second path.
- `git show c304b098:scripts/check-spec-binding-plan-parity.ts` (`1536` lines) — **[MEASURED HERE]** for every line citation below. Every `:N` in this packet was read in the shipped blob, not in the worktree.

---

## 1 — THE REPAIR SET: **FIVE numbered findings + ONE `NOT-SOUND` sub-claim.** NOT three.

> ⚠️ Both upstream sources said *"three"*. `AR-540 §2` named `F-2`, `F-3` and sub-claim `6` and omitted `F-1`, `F-4`, `F-5`; the tenth external read repeated the undercount because it read `AR-540` rather than the grade. R-516 §2 corrected both. **[MEASURED HERE] `grep -c "^## Finding " GRADE-C304B098-2026-07-31.md` → `5`; no `F-6` exists in the file.**
> ⚠️ The grade's own §6 (`:303`) says *"All six findings"* against its own §7 `Total 5`. **The count used by this packet is `5`, taken from the enumerated headings and the severity table.** Why the prose says six is **[HYPOTHESIS — untested; the grader was not asked]** and this packet does not rely on it.

### F-2 — HIGH — an oracle row's expectation is silently deleted by a typo'd key; output byte-identical, exit 0
**[MEASURED BY GRADED INSTRUMENT, grade `:45-86`]** Six single-key mutations each destroyed a live expectation and produced stdout **byte-identical** to the clean PASS (md5 `eb99c6ccdc373ab4a6e0c3e9c47a1351`), `EXIT=0`: `reason_names`→`reason_name` · `reason_excludes`→`reason_exclude` · `bindable`→`bindible` · `session_zone`→`session_zne` · `reason_null`→`reason_nul` · and `reason_null: true`→`"true"` (**key intact, type wrong**). Control `A0_noop_reformat_only` isolates the cause to the single renamed key.
**Fix point [MEASURED HERE]:** `:404-409` — the per-row loop in `validateOracleContractOrExit()` checks only `row.authority` and `row.unadjudicated`; it never enumerates the row's key set. Plus `:729`/`:732`, where `reason_null` is read through a **double equality** (`=== true` … `=== false`) so any non-boolean makes **both branches skip**.
**Grade §7 `:314`: `F-2` ALONE IS DISQUALIFYING.**

### F-3 — MEDIUM — `reasons_must_differ_from` can be deleted entirely; output byte-identical, exit 0
**[MEASURED BY GRADED INSTRUMENT, grade `:88-109`]** `N7` (delete the key) and `N8` (set it to `[]`) both → `EXIT=0`, stdout byte-identical.
**Fix point [MEASURED HERE]:** `:1408-1409` iterates `expect.reasons_must_differ_from ?? []` — the `?? []` converts an **absent population** into **zero iterations and zero output**. Nothing censuses this population: no count printed, no membership asserted, no declared-gap reason demanded. The file itself calls it *"the oracle's sharpest assertion"* at `:1405-1407`.
**Positive control that the population is live when present:** the clean run resolves `10-lunch-orphan.sess` ↔ `21-fivemin-chart.sess` in both lanes; `A1`/`A2` prove the surrounding machinery reddens. The silence is a real disarm, not a dead path.

### F-1 — MEDIUM — the FAIL summary's caption names FIVE feeding checks; the bucket is fed by SIX
**[MEASURED BY GRADED INSTRUMENT, grade `:111-139`]** `:1517` prints `GATE CHECKS (membership · tripwire · axis-4 · TS-schema · reason-distinctness)`; `failures` has six feeders — `:1298` membership · `:1309` **rowCensus** · `:1319` tripwire · `:1334` axis-4 · `:1364` TS-schema · `:1435`/`:1444` distinctness. **The omitted feeder is `rowCensus` — this delivery's own headline repair.** Four census-only failures were observed printing under a caption naming five subsystems that produced none of them.
**Never a false PASS** — exit code and count are correct; it misdirects triage. **Fix points:** `:1517`, the comment at `:1511`, and ratify-packet line `683`, which ratified the five-name caption as FIXED.

### F-5 — MEDIUM — *"No engine change: both lane files are byte-identical to the base"* is false as written
**[MEASURED BY GRADED INSTRUMENT, grade `:141-162`]** Python lane identical (`2a31942f`); **TS lane is not** (`8053598b` at base → `1853e7d9` at `c304b098`), carrying `REFUSED_SESSION_KEYWORDS` and a new refusal branch in `bindCondition()`.
**The charitable reading, which the grade itself tested and reported:** blob `1853e7d9` is identical across all four deliveries, so the sentence is TRUE against the *prior delivery* and FALSE against the *stated base* — this delivery **inherits** an engine change rather than introducing one. It is load-bearing: the gate imports `refusedSessionZone` from the TS lane (`:47`) and cannot compile without it. **Fix point:** the commit message (unamendable) and any downstream summary repeating it.

### F-4 — LOW — ORACLE prose counts an INVALIDATE row inside *"13 of 15 conditions"* that is not one of the 15
**[MEASURED BY GRADED INSTRUMENT, grade `:164-192`]** The fixture declares 15 `entry_conditions` plus **one separate** `invalidations` entry; the oracle adjudicates 2 and enumerates 13 (2+13 = 15 ✓) and the 13 contain **no** invalidate row. **The executable path is right; the prose describing it is wrong.** The row is excluded by the census **population boundary** — a different mechanism than the prose names. **[MEASURED HERE] that boundary is declared at `:460-462`:** *"`invalidations` are NOT in this population… that gap is pre-existing and separately declared; this census does not silently widen to cover it."*
**Fix point:** `ORACLE.json` → `fixtures["00-control-shipped.spec.json"].conditions_unadjudicated`.

### SUB-CLAIM 6 — `NOT-SOUND` — the DECLARED `invalidations` exclusion is stated in code and **stated nowhere in the packet**
**[MEASURED BY GRADED INSTRUMENT, grade `:27`]** The exclusion is real and defensible (see `:460-462` above). **The defect is that the ratify packet does not carry it**, so a reader ratifying the delivery ratifies a scope they were never shown. **Fix point:** `LEDGER-E-PARITY-RATIFY-PACKET-2026-07-30.md` — declare the exclusion where it is ratified, not only where it is coded.

---

## 2 — THE COMMON FAILURE MECHANISM: **ONE, and it covers `F-2` + `F-3` only.**

> **`AN UNDECLARED GAP IN THE ORACLE READS AS COVERAGE.`**
> The oracle is consumed under **OPTIONAL** semantics at every expectation site — *present? then assert : skip*. So an expectation that is **absent**, **misspelled**, or **of the wrong type** is indistinguishable from *"this fixture asserts nothing here"*, and silence is scored as agreement.

★★★★★ **THIS IS NOT MY COINAGE — IT IS THE FILE'S OWN LAW, APPLIED TO ONE SURFACE AND NOT THE OTHER.** `[MEASURED HERE, :667-675]`
```
if (omitted.length > 0 && !expect.scalars_unadjudicated) {
  // An undeclared gap is the failure mode, not the gap itself. A fixture that
  // silently checks nothing is worse than one that says what it does not check.
```
**That comment governs plan SCALARS. `F-2` and `F-3` are the same sentence, unenforced, on the ORACLE ROW and the DISTINCTNESS POPULATION.**

**The mechanism decomposes into three sub-modes, and they are NOT interchangeable — this matters for the architecture in §4:**

| sub-mode | the mutation it must catch | closed by |
|---|---|---|
| (a) **UNKNOWN key accepted** | `reason_names` → `reason_name` (`F-2`) | closed-key rejection on `OracleRow` |
| (b) **wrong-TYPE value skipped** | `reason_null: true` → `"true"` (`F-2`) | per-key value type-check; **closed-key alone does NOT reach this** |
| (c) **REQUIRED key absent** | delete `reasons_must_differ_from` (`F-3`) | required-key + declared-gap reason; **closed-key alone does NOT reach this either** |

⚠️★★★ **THIS REFINES — AND PARTLY REFUTES — R-516 §7's `[HYPOTHESIS]` THAT *"closed-key + type-check on `OracleRow` closes `F-2` AND `F-3` together"*.** `[MEASURED HERE, by reading both sites]` **`reasons_must_differ_from` lives at FIXTURE level (`expect.…`, `:1408`), not on an `OracleRow`.** A closed-key rule rejects **unknown** keys; `F-3` deletes a **known** one. **So no rule scoped to `OracleRow` can close `F-3`, and no unknown-key rule can close a deletion at any level.** The unifying principle that does cover both is one level up: **parse the oracle under a TOTAL schema — every key known-or-rejected, every value typed, every absence either declared or fatal.** ⚠️ **STATED AS A PREDICTION, NOT A RESULT: this is reasoning over the executable lines, and a document cannot execute the test that would settle it. The executable test is named in §6.**

### The three defects with **NO** common mechanism — stated plainly rather than manufactured
**`F-1`, `F-4` and `F-5` do NOT share the mechanism above and are not closed by any repair to it.** None can produce a false PASS. They are **caption/provenance defects**: a human-authored sentence claiming more coverage than the code delivers (`F-1` a summary caption, `F-4` oracle prose, `F-5` a commit-message identity claim). ★★ **They share a FAMILY — `CAPTION IS A CLAIM` — but a family is not a mechanism, and treating them as one would invent a shared root that the evidence does not support.** Their remedy is different in kind and is given in §4.4.

---

## 3 — RETIRED ASSUMPTIONS FROM THE FOUR-ATTEMPT DESIGN

| # | delivery | the assumption it rested on | how it was retired |
|---|---|---|---|
| 1 | `2011e8de` | *"the registered fixture battery proves the gate is sound"* | **R-496 `NOT-SOUND`** — two novel false-greens survived **every** registered fixture, and survived the desk's own green run. |
| 2 | `39948d3c` | *"membership at FIXTURE-FILE granularity is membership"* | condemned in-lineage: *"membership operates at FIXTURE-FILE granularity and never at `condition_id` granularity"*. |
| 3 | `8187b730` | *"the oracle's rows are trustworthy because they are TYPED"* — the file's own comment at `:397-399` says it read as enforced *"because the TYPE said `authority: string`"* | **R-497 `NOT-SOUND`** — deleting a fully adjudicated row, or stripping its authority, left output **byte-identical, exit 0**. |
| 4 | `c304b098` | *"a census at `condition_id` granularity closes membership"* | **grade `NOT-SOUND`** — *"the census operates at `condition_id` granularity and never at FIELD granularity"* (`F-2`). |

★★★★★ **THE PATTERN, AND IT IS THE REASON §15.7 BITES ON SUBSTANCE AND NOT ONLY ON A COUNT: every attempt closed the join ONE LEVEL DOWN and left the next level open.** `CLOSING A JOIN MOVES THE FAMILY ONE LEVEL IN, IT DOES NOT END IT` (R-513's synthesis, from a different lane, now convicted in this one).
⚠️★★★★★ **SO THE DECISIVE RETIRED ASSUMPTION IS THE ONE COMMON TO ALL FOUR: `A CHECK ADDED AT THE GRANULARITY WHERE THE LAST DEFECT APPEARED WILL CATCH THE NEXT DEFECT.` It has now failed four times. A design that closes FIELD granularity and stops is attempt five with a new label.**

---

## 4 — THE REPLACEMENT ARCHITECTURE

**It is bounded, and the bound is that the mechanism already exists in this file, twice** `[MEASURED HERE, both read in the shipped blob]`:

**Precedent A — closed-key discipline, `projectExhaustively()` `:285-339`** (applied to the **plan under test**):
`:297` `UNMAPPED TS FIELD — … A NEW FIELD IS A NEW DRIFT BY DEFAULT.` · `:306` `MISSING SOURCE FIELD` · `:319` `DUPLICATE DESTINATION` · `:335` `UNCONSUMED MAPPING ENTRY`.
**Precedent B — omission demands a declared reason, `:667-675`** (applied to **plan scalars**): `if (omitted.length > 0 && !expect.scalars_unadjudicated)` → errors and **names** the omitted fields.

### 4.0 — WHY THE ORACLE SIDE WAS EXEMPT (R-516 §8.4 asks this explicitly, and the answer is in the file)
`[MEASURED HERE, :397-399 — the comment immediately above the per-row loop]`
> `★★★★★ THE CITATION IS THE CONTRACT. An expectation with no authority is an assertion with no source, and it read as enforced because the TYPE said 'authority: string'.`

★★★ **`validateOracleContractOrExit()` WAS BUILT TO ANSWER ONE QUESTION — *"is this expectation SOURCED?"* — AND WAS NEVER BUILT TO ANSWER *"is this expectation WELL-FORMED?"*.** Its per-row loop (`:404-409`) therefore checks `row.authority` and `row.unadjudicated` and nothing else. **The exemption was not an oversight in the last delivery; it is the original scope of the function, inherited unchanged across all four attempts.** `A FUNCTION KEEPS THE SCOPE ITS FIRST COMMENT GAVE IT UNTIL SOMEONE RE-READS THE COMMENT.`

### 4.1 — `OracleRow` becomes CLOSED-KEY *(closes sub-mode (a))*
A literal key list is declared once; the per-row loop at `:404-409` rejects any key not on it, **naming fixture · condition id · offending key** — the shape of `:297`. An unknown key is a FAILURE, never an ignored sibling.

### 4.2 — Every expectation value is TYPE-CHECKED *(closes sub-mode (b))*
Each key on the list carries its expected type; a wrong type is a FAILURE, not a skipped branch. **Specifically `:729`/`:732`'s double equality is replaced by: read `reason_null` if present → assert boolean → then branch.** Under the current code a JSON type slip disarms the assertion with the key still spelled correctly.

### 4.3 — The DISTINCTNESS population is censused and its omission must be DECLARED *(closes sub-mode (c))*
`:1408`'s `?? []` is removed as an acceptance path: the resolved-pair count is **asserted and printed**, and a fixture that drops `reasons_must_differ_from` must carry a declared reason — mirroring `scalars_unadjudicated` **exactly**, including the existing message shape at `:670-674`. **This is Precedent B moved one surface across, not a new invention.**

### 4.4 — The caption family (`F-1`, `F-4`, `F-5`) — a DIFFERENT remedy, stated as such
- **`F-1`:** derive the caption **from the feeder list in the object** rather than hand-writing names — the campaign's own `n_scored_cases` remedy from AR-538 (`A COMMIT MESSAGE IS A CAPTION, AND I WILL STATE COUNTS FROM THE OBJECT OR NOT AT ALL`). A hand-written caption that a later `failures.push` invalidates is the exact recurrence here (`R-497` added `:1309` and did not extend `:1517`).
- **`F-4`:** correct the ORACLE prose to name the **population boundary** (`:460-462`) as the reason the INVALIDATE row is excluded, instead of claiming the 13 covers it.
- **`F-5`:** state the provenance claim **against the stated base**, and say the TS engine change is **inherited from the prior delivery and load-bearing** (`:47` imports `refusedSessionZone`).
- **Sub-claim 6:** carry the `invalidations` exclusion **into the ratify packet**, where it is ratified.
⚠️ **None of these is closed by §4.1–4.3, and shipping §4.1–4.3 alone leaves four of six findings open.**

---

## 5 — THE BOUND (R-516 §8.5)

**ONE implementation attempt + ONE independent `accuracy-validator` grade. NO THIRD.**
- The grade slot for `P0` (§15.6 step 2) is **spent** — `GRADE-C304B098-2026-07-31.md` exists. **Whether the redesign earns a second grade is the desk's decision, not mine.** The grader is `accuracy-validator`, it is a local agent, and it is **one authorization away** — it is not blocked and must not be reported as blocked.
- The grade brief owes, per `worker-execution` §5b: the claim **verbatim** · the pinned commit · a working access recipe · an explicit **novel false-green hunt** request · and a **durable receipt path** (a committed verdict file — a verdict living only in a dispatcher's chat is single-source).
- **If this one attempt is graded `NOT-SOUND`, §15.7 applies again and the correct result is escalation, not a sixth delivery.**

---

## 6 — THE `ABORT` CONDITION

> ### ⚠️ **`ABORT` — STOP AND WRITE IT UP, DO NOT IMPLEMENT, IF ANY OF THESE IS TRUE:**
> 1. **`ABORT` if the design recreates a retired mechanism** — an **open-key** oracle row, an expectation read under *present-or-skip* semantics, or **any check satisfiable by ABSENCE rather than by verification.**
> 2. **`ABORT` if the red-proof cannot be stated BEFORE implementation.** The implementation must ship, as scored cases: a planted **unknown key** → RED · a planted **wrong-type value** (`reason_null: "true"`) → RED · a **deleted** `reasons_must_differ_from` → RED · **and a clean unmutated control** → GREEN. **A mutation suite without the control cannot tell "catches breakage" from "always red".**
> 3. **`ABORT` if the only available design closes FIELD granularity and nothing else** — that is attempt five under a new name (§3). The design must state what it does at the **next** granularity down, even if that answer is an explicitly declared scope limit.
> 4. **`ABORT` if `git status --porcelain -- scripts ci src` shows any change BEYOND THE BASELINE RECORDED AT IMPLEMENTATION START** — this is a shared tree with other lanes' work in it.
> ⚠️★★★ **THIS CONDITION IS A DELTA, NEVER AN ABSOLUTE CLEAN — AND I CAUGHT IT BY RUNNING IT ON MYSELF.** I first wrote it as *"any change outside the two named files"*; **[MEASURED HERE, 2026-07-31] that command already returns ` M src/engine/tests/test_synthetic_market_simulator.py`** — pre-existing, not this lane's, and untouched by this packet. **As first written, this ABORT fires before the implementation begins. `A GUARD THAT IS ALREADY RED CANNOT DISCRIMINATE`, and it would have been read as a stop order on its first run.** The implementing seat records the baseline in its start-receipt and compares against **that**.

**`NO SOUND REDESIGN AVAILABLE` and `UNRESOLVED_SOURCE_AMBIGUITY` are VALID EXPERT RESULTS here** (R-516 §8) and are to be reported as findings, not worked around.

**The settling test for §2's prediction, named so it is not mistaken for a result:** apply §4.1–4.3, then re-run the grade's own six mutations plus `N7`/`N8` and require **`EXIT=1` with the offending key or population NAMED** on every one, with `A0_noop_reformat_only` still GREEN. ⚠️ **UNPROVEN UNTIL EXECUTED — this packet is a document and executed nothing.**

---

## 7 — WHAT THIS PACKET DOES **NOT** COVER (honest-partial clause, R-516 §8)

- ⚠️ **I did not re-execute any of the grade's mutations.** Every mutation result above is `[MEASURED BY GRADED INSTRUMENT]`, not `[MEASURED HERE]`. My independent path was the **shipped blob**, and it covers only the line citations.
- ⚠️ **The surface I enumerated is `check-spec-binding-plan-parity.ts` at `c304b098` and the grade.** I did **not** enumerate `ORACLE.json`'s full key space, so **the closed key list in §4.1 is NOT authored here** — deriving it is the first act of the implementation, and doing it by hand from memory is exactly how a closed list becomes an allow-list. `THE BASELINE ALLOW-LIST EXCUSED 24 KILL-SWITCH ASSERTIONS` is this campaign's standing warning on that.
- ⚠️ **Whether `F-1`/`F-4`/`F-5` are exhaustive of the caption family is `[UNENUMERATED]`.** The grade found them by novel hunts; no census of captions in this file was run by anyone. **`F-1` is the NINTH `caption falsifies its own line` on this codebase — a class with eight prior instances has no reason to be complete at nine.**
- ⚠️ **`P1`/`P2`/`P3` are untouched.** This packet unblocks §15.6 step 1 only.
- ⚠️ **No claim is made that §4 is sufficient.** It is a design whose sufficiency is decided by the red-proof in §6.2 and by an independent grade — **not by this document and not by its author.**
