# GATE-B RATIFY PACKET — the deterministic admission-contract fix · 2026-07-29

> **STAGED, NOT IMPLEMENTED.** Deliverable of **R-473 §4**. Authored by AR-471's worker seat
> (AR-472). ★★★★★ **NO CODE HAS BEEN WRITTEN AND NONE MAY BE UNTIL `afc644b1bbcb0c742`
> RETURNS SOUND AND A RULING CONSUMING THAT GRADE AUTHORIZES IMPLEMENTATION.**
>
> **CLASSIFICATION (`ratify-packet`, operator amendment 2026-07-11): the AUTONOMOUS class.**
> The system is PRE-LIVE — `[MEASURED, frozen census + AR-458 live check]` `backtests_total = 0`,
> no funded account is trading. So this change is **NOT** in the irreversible / live-capital
> class and does **NOT** wait on operator permission. ★★★ **THE GATE IS THE INDEPENDENT GRADE
> (`accuracy-validator`, doer ≠ grader), not a permission ceremony. This document is the
> receipt the GRADER rules on; the operator rules only on a plain-English summary and holds a
> standing veto.**
>
> ★★★ **WHY IT IS STILL NOT SELF-AUTHORIZING:** it is instrument-touching by the skill's own
> definition — extraction-fidelity logic whose OUTPUT other decisions trust.

---

## 1 — WHAT & WHY NOW (receipts at `file:line`, not narrative)

**THE DEFECT IS AN INSTRUCTION, NOT A BUG.** The producer explicitly teaches the admission
gate that execution context is a decision.

**Producer identity:** `tf-deep-scan` (a SEPARATE git repository) @ **`dc8a150`**, path
`scripts/atomize-transcript.ts`. ★★ **That blob exists on NO working tree — 4 on-disk sizes
(`16,565`×17 · `16,785`×31 · `22,903`×1 · `26,423`×1) across 50 copies; the producer is
reachable only through that repo's git history.** Stamped on all 40 specs as
`pipeline_commit=dc8a150`, `extraction_pipeline_version=compiler-v3-union-1.0`.

| receipt | content |
|---|---|
| **`dc8a150:60`** | `"we trade this on crude oil" / "we're sitting on the 30-minute chart today"  -> YES (WAIT_SESSION — execution context: removing it changes what the engine runs on)` |
| **`dc8a150:61`** | `"mark the high and low of the first 30 minutes" … -> YES (WAIT_STRUCTURE / FILTER — a price LEVEL, never WAIT_SESSION)` |
| **`dc8a150:32`** | `ATOM_TYPES` = 14 members, ★★★★★ **NOT ONE of which represents non-executable context** |
| **`dc8a150:112`** | `if (r.is_decision && r.atom_type && r.atom_type !== "NONE" && ATOM_TYPES.includes(r.atom_type as AtomType)) {` → `:118` `atoms.push(a)` |
| **`graph-to-engine.ts:69,72,76,80-87`** | `sourceAtoms = graph.atoms.filter(...)` → `for (const a of sourceAtoms)` → every `entry_conditions.push` is INSIDE that loop |

★★★★★ **THE ROOT CAUSE, MECHANISTIC: THE ADMISSION CONTRACT CONFLATES *"removing it changes
what the engine runs on"* (RUN CONFIGURATION) WITH *"is an entry predicate"* (A PER-BAR
CONDITION).** Instrument and chart timeframe genuinely matter to execution and are **not**
per-bar predicates. `:60` admits them as decisions on the first ground; `:32` then offers no
legal way to type them as context, so `WAIT_SESSION` is the **forced landing spot**.
★★★ **IT IS A DESIGN DEFECT, NOT A TYPO — `:61` draws the opposite boundary carefully on the
very next line. The same author distinguishes precisely one line later, so the conflation is
reasoned, and the reasoning is the defect.**

**THE MEASURED CONSEQUENCE** (`C8-PROVENANCE-LEDGER-2026-07-29.md`, instrument
`c8_provenance_ledger.py`): `456` per-video refusals · **`233` C8** over `37` videos ·
**`232` `C8-ANNOTATION`** all carrying `semantic_type=WAIT_SESSION` + `reason=no_recognized_session_keyword` ·
**`1` `C8-EMPTY-SPINE`**. Clause texts are literally `timeframe` (×28) · `time frame` (×15) ·
`chart timeframe` · `daily time frame` · `s p 500` · `oil`.

★★ **WHY NOW:** C8 is the single largest remediation class and the only one whose repair makes
any POP-120 video refusal-clean. ★★★ **AND THE HONEST SCOPE, WHICH THIS PACKET WILL NOT
OVERSTATE (R-466's own correction): *"C8 is the only single remediation class that makes ANY
POP-120 videos refusal-clean"* — **NOT** *"C8 alone produces a Phase-1-exitable strategy."*
`0/16 fully bound` is **corpus_A**; `51.1%` and the 40-video ranking are **POP-120-LIVE**; the
overlap map between those populations is `[UNENUMERATED]`.**

## 2 — BLAST RADIUS

**INVALIDATED / CHANGED:**
- ★★★★★ **`certified_gate=6-video-46of46-2026-07-02`, stamped on all 40 specs, CEASES TO
  DESCRIBE the post-fix extractor.** It is a certification of the OLD admission contract. It
  must be re-earned, and it may **NOT** be carried forward onto new extractions by inheritance.
- **Every future emitted spec's condition count drops** (see §4's pre-registered trap).
- **`spec_hash` changes for any re-extracted video** — and `spec_hash` hashes only the
  EXECUTABLE spec, so it **cannot authenticate annotations stored beside it** (R-466 §2's
  correction). An `artifact_hash` over canonical `{spec, annotations, extraction_provenance}` is
  required by that ruling and is **OUT of this packet's scope** (§3).
- **Downstream consumers of `entry_conditions`** in the census lane: `playbook-registration.ts`,
  `spec-archetype-matcher.ts`, `spec-family-bindings.ts`, `spec-timeframe-recovery.ts`. ★★★
  **These CONSUME conditions; a condition that becomes metadata disappears from their input.
  Each must be checked for a "condition count > 0" or index assumption.** ★★ **`[UNVERIFIED]`
  — I did not open them; enumerated by name only (see §7).**

**EXPLICITLY NOT INVALIDATED:**
- ★★★★★ **THE FROZEN EVIDENCE BASE. The 40 canonical specs, the classified census
  (`eed65514…`), the raw census (`ad4335f0…`) and the 40 preserved transcripts
  (`913,668` B) are FORWARD-BASELINE FROZEN. This fix is FORWARD-ONLY: NO BACKFILL, NO
  REWRITE, NO RE-STAMPING (R-463's forward-baseline law).**
- **Gate A's causal finding** — `456 / 233 / 232 / 1` — rests on positive producer and artifact
  evidence and is not affected by its own remedy.

## 3 — THE EXACT CHANGE, SCOPE-LOCKED

### IN SCOPE

**(a) THE THREE-WAY CONTRACT.** Replace the binary decision/non-decision admission outcome with
three **disjoint, exhaustive** dispositions:

| disposition | meaning | executable? | retained? |
|---|---|---|---|
| **`decision_condition`** | a per-bar predicate the engine evaluates | **YES** | yes |
| **`execution_context`** | configures WHAT the engine runs on | **NO** | ★★★★★ **YES — RETAINED AS STRUCTURED METADATA, NEVER DISCARDED. It genuinely configures the run.** |
| **`annotation`** | discussion, motivation, recap, terminology | NO | yes |

with **`context_kind ∈ { instrument, chart_timeframe, platform, market_session }`**.

**(b) THE ADMISSION RULE.** A clause that selects ONLY instrument, chart timeframe or platform
view **may never enter `DecisionGraph.atoms`** → it becomes `execution_context`. A clause that
predicates trading on an actual market **SESSION / TIME WINDOW** remains a
`decision_condition` and stays `WAIT_SESSION`.

**(c) ★★★★★ DETERMINISTIC, NOT PROMPT-ONLY. THIS IS THE LOAD-BEARING REQUIREMENT.**
**A PROMPT EDIT IS A REQUEST, NOT A FIX.** The classification must be enforced by CODE at the
admission boundary — `dc8a150:112`'s gate — so that a clause whose resolved `context_kind` is
`instrument | chart_timeframe | platform` **cannot** become an atom regardless of what the
model returned. ★★★ **AND R-466 §2's WARNING IS BINDING: the two-pass UNION cannot CREATE
conditionness but CAN PRESERVE a false positive from EITHER pass — so a wording change alone
leaves the leak open. The deterministic gate is what closes it.**

**(d) PASS DISAGREEMENT FAILS CLOSED.** Where pass A says context and pass B says decision, the
result is **`UNRESOLVED_CONTEXT_CONFLICT`** — **RETAINED and FAIL-CLOSED. Never silently
promoted by the union, never discarded.**

**(e) THE SPAN/EVIDENCE INVARIANT — and this packet localises it to one line.**
★★★★★ **[MEASURED HERE] `dc8a150:117`: `provenance: SPAN((r.evidence_span || c.text).trim(), c.start, c.end)`.
IT STORES THE MODEL'S `evidence_span` STRING AGAINST THE CLAUSE'S `c.start`/`c.end` OFFSETS —
TWO DIFFERENT OBJECTS IN ONE RECORD. That is the exact mechanism behind byte-exact
`evidence == transcript.slice(start,end)` = `0 / 232`.** Fix: derive the quote
**DETERMINISTICALLY** from `transcript.slice(start, end)` and keep any model-produced hint in a
**SEPARATE, EXPLICITLY UNTRUSTED** field. **FORWARD-ONLY — no backfill.**

### OUT OF SCOPE (explicitly, so the implementer cannot drift)

★★★★★ **THE `C8-EMPTY-SPINE` REFUSAL IS UNTOUCHED.** `spec_execution_preflight.py` @ `83efd34e:296-306`
manufactures it with `condition_id=""` **hardcoded**; it is a downstream **SAFETY BEHAVIOUR**
and stays **FAIL-CLOSED**. Its `remediation_class` LABEL may be corrected separately. ★★★
**`NEVER TAKE A REAL RISK TO REMOVE AN APPEARANCE` (invariant #9) — and it belongs to
`75DJN5UVQnw`, a distance-0 target, so a global C8 remedy would have corrupted a spearhead
candidate first.**
Also OUT: `artifact_hash` / provenance-contract work · the unreachable `context` enum member in
`CLASS_MAP` (`dc8a150:34`) — a real dead branch but ★★ **explicitly NOT the cause: five other
enum values map to the same `"contextual"` disposition and all are offerable** · the C2
session-role resolver · any backfill of historical artifacts · any change to
`absence_claim_control.py` / `c8_provenance_ledger.py` / `absence-fixtures/` · any backtest ·
any re-extraction beyond §4's single authorised ablation.

## 4 — VERIFICATION PLAN

### 4.1 — THE PRE-REGISTERED TRAP, RESTATED IN FORCE (R-466 §2, verbatim in effect)

★★★★★ **`conditions-per-strategy WILL DROP` UNDER TREATMENT, AND THAT IS THE FIX WORKING, NOT
A REGRESSION. A HIGHER CONDITION COUNT AFTER TREATMENT IS A FAILURE SIGNAL. NOBODY MAY RE-READ
A DROP AS DAMAGE AFTER THE FACT.**
**PRIMARY OUTCOME:** per-video C8-classified refusals, CONTROL vs TREATMENT, **per-video NEVER
per-row** (triples inflate 3×).
★★★★★ **CO-PRIMARY, AND IT OUTRANKS THE PRIMARY: every pre-registered GENUINE market-state
condition SURVIVES. A treatment that lowers C8 while dropping ONE genuine market-state
condition FAILS. FIDELITY OUTRANKS COUNT — declared here so it cannot be traded later.**
**BRANCH TABLE, FIXED NOW:** C8 drops AND all genuine conditions survive AND no new C8 ⇒ **PASS**
· C8 drops but a genuine condition is lost ⇒ **FAIL, treatment withdrawn** · C8 unchanged ⇒
**WRONG BOUNDARY, return to Gate A, do NOT widen the treatment** · C8 drops and NEW C8 appears
elsewhere ⇒ **FAIL, the leak moved** · any pass disagreement silently resolved ⇒ **FAIL**.
**POPULATION:** `POP-120-LIVE`, per-video, tree named beside every count. **NOT `corpus_A`.**
★★ **`HOLDOUT-26` IS NOT SPENT ON THIS** — that covenant governs tuning; this is a correctness
ablation.

### 4.2 — RED-PROOF: WHAT MAKES IT GO RED WITHOUT THE FIX

★★★ **A guard that cannot fail is not a guard, and every fixture's expected outcome is
PRE-REGISTERED BEFORE the run — a code chosen after the fact is not a prediction.**

| fixture | without the fix | with the fix |
|---|---|---|
| `"we trade this on crude oil"` | RED — becomes a `WAIT_SESSION` condition | `execution_context`, `context_kind=instrument`, **NO condition** |
| `"we're on the 30-minute chart"` | RED | `execution_context`, `context_kind=chart_timeframe`, **NO condition** |
| `"trade only 09:30–11:00 ET"` | GREEN both ways | ★★★★★ **genuine `WAIT_SESSION` PRESERVED — the co-primary** |
| mixed timeframe + market-state clause | RED — fused | **SPLIT**; market condition preserved |
| pass A context / pass B decision | RED — union leaks it through | `UNRESOLVED_CONTEXT_CONFLICT`, fail-closed |
| every removed C8 clause | — | **APPEARS IN ANNOTATIONS** (removal ≠ deletion) |
| **CONTROL arm** | ★★★★★ **must reproduce the frozen C8 classifier result `456 / 233 / 232 / 1` BEFORE the treatment is trusted** | unchanged |
| span invariant | RED — byte-exact `0/232` | quote derived from the slice ⇒ byte-exact by construction |

★★★ **DISCRIMINATION MUST BE STATED IN BOTH HALVES: the mutation goes RED **and** the
unmutated control stays GREEN, both reported. A mutation suite without its control cannot tell
"catches breakage" from "always red".**

### 4.3 — THE GRADER, AND THE RESTRICTION TRAP

**Independent grader: `accuracy-validator`, dispatched by the DESK.** ★★★★★ **NEITHER THE
DESIGNER NOR THE BUILDER MAY GRADE — independence is structural, not a matter of how honestly
either looks.**
★★★★★ **AND THE SKILL'S WARNING, APPLIED IN ADVANCE BECAUSE IT HAS ALREADY COST THIS CAMPAIGN
A RESULT: `A RESTRICTION IN THE GRADER'S BRIEF IS A HOLE IN THE RESULT.` Per verification step,
the claim that becomes UNCHECKABLE if the step is restricted "for safety":**

| if restricted | which claim dies |
|---|---|
| no DB read | whether the emitted spec matches the live library — the parity claim |
| no re-extraction of the ONE ablation video | the entire primary outcome; nothing measures the treatment |
| no transcript access | the co-primary — genuine market-state survival is unverifiable |
| no access to the annotations store | *"every removed clause appears in annotations"* — i.e. removal-vs-deletion |

★★ **The honest null is a complete answer: *"no refutation found, here is what I covered and
what I could not."*** ★★★ **The semantic GROUND TRUTH of the 232 labels is `[OUT OF SCOPE]` per
R-467 §5 — neither worker nor grader authors it; every semantic cell keys to the FROZEN
classifier.**

## 5 — ROLLBACK

- **Code:** revert the admission-boundary commit. The change is additive at one gate plus a new
  metadata sink; no historical artifact is mutated, so **revert restores prior behaviour exactly.**
- **Emitted artifacts:** any spec produced under the treatment is written to a **NEW** path with
  its own `extraction_provenance`; frozen inputs are never overwritten. **Rollback = stop using
  the new artifacts.** ★★★ **The frozen census, the 40 canonical specs and the preserved
  transcripts are never written by this change, so rollback CANNOT regress the evidence base.**
- **Flag:** the deterministic gate ships **flag-gated for the FEATURE**, and ★★★★★ **THE FLAG
  GATES THE FEATURE, NEVER THE FIX (extraction-campaign law 5). Any unconditional component
  that can move condition counts ships a MATERIALITY COUNT RECEIPT at land time** — the
  OR-branches incident is the precedent: a flag-gated feature whose unconditional half silently
  zeroed 7 strategies' trading.
- **No live default is altered:** nothing is live. `backtests_total = 0`.

## 6 — RE-VERIFICATION OBLIGATION: LANE EQUIVALENCE NO LONGER HOLDS

★★★★★ **[MEASURED, AR-460] the census manifest recorded `runtime-production` @ `a6f92822` with
all three refusal-deciding engine files byte-identical to the census lane. `runtime-production`
IS NOW `9af37b8f` AND 2 OF 3 HAVE MOVED:** `spec_condition_compiler.py` `b20d285e…`→`3fda1963…`
· `spec_execution_preflight.py` `96526469…`→`e68404a9…` · `spec_family_bindings.py` unchanged.
**Cause: one commit, `0b0d6617` (`record UNKNOWN_REQUIREDNESS`), `+72/−15`.**
★★★★★ **THEREFORE: THE TREATMENT MUST BE RE-VERIFIED AGAINST `runtime-production` AT ITS
THEN-CURRENT COMMIT, NAMED IN THE RESULT. A measurement in the census lane does NOT transfer.**
★★★ **AND `[UNMEASURED]`: whether `0b0d6617` moves the C8 count. It touches REQUIREDNESS — the
census's own `C6` class — so "it leaves C8 alone" would be an unmeasured mechanism claim.
MEASURE IT BEFORE THE ABLATION, or the CONTROL arm is not the frozen control.**
★★ **A THIRD LANE EXISTS AND IS NOT VALID FOR THIS WORK: the campaign tree
`wt-h1-wave4-20260712` carries `spec_family_bindings.py` at `160,049` B vs `40,583` B and has
NO `spec_execution_preflight.py` at all (R-415 / v4 §3-1E).**

## 7 — HONEST PARTIAL: WHAT THIS PACKET DOES **NOT** COVER

★★★★★ **STATED BECAUSE A PARTIAL THAT READS AS COMPLETE IS THIS CAMPAIGN'S MOST-CONVICTED
SHAPE, AND R-473 §4 required this clause up front.**

- ★★★★★ **THE CALL-SITE SCOPE-LOCK IS `[PARTIALLY UNENUMERATED]`.** §1's receipts are exact and
  re-derived. But the producer is a **historical git blob** (`dc8a150`) on no working tree, and
  the file that will actually be edited is a **live descendant** (`tf-deep-scan` HEAD is
  `22,903` B vs the blob's `21,518` B). **THE IMPLEMENTER MUST RE-DERIVE THE GATE'S LINE NUMBERS
  IN THE TREE IT EDITS. The line numbers in §1 are pinned to `dc8a150` and MUST NOT be applied
  to another copy** — `A KEY'S SAFETY IS A PROPERTY OF THE ARTIFACT`, and so is a line number.
- **The four downstream `entry_conditions` consumers (§2) are enumerated BY NAME ONLY,
  `[UNVERIFIED]`.** I did not open them. Whether any assumes a non-empty condition list is
  **OPEN** and is the first thing the implementer must check.
- **`[UNENUMERATED]`: which lane will host the fix.** `graph-to-engine.ts` exists in exactly
  `2` trees (`tf-deep-scan`, `.claude/worktrees/extraction-100`) — **neither the census lane nor
  `runtime-production`.** This desk owes the R-415 lane-authority ruling (v4 §3-1E,
  advisor-owned) before an implementer can know which tree is authoritative.
- **`[NOT DETERMINED]`: the pre-registered set of GENUINE market-state conditions** that must
  survive. The co-primary outcome cannot be scored until that set is frozen, and ★★★ **it is a
  GROUND-TRUTH judgment — it is NOT the worker's to author** (R-467 §5).
- **`[UNMEASURED]`:** DB↔census refusal/classification FRESHNESS as distinct from spec
  freshness · whether `0b0d6617` moves C8 · the population OVERLAP MAP.
- **`[UNPROVEN]`:** span SEMANTIC correctness — addresses are valid `232/232`, the invariant
  fails `232/232` byte-exact, and **in-bounds is necessary, not sufficient.**

★★★★★ **THE PACKET IS SUFFICIENT TO IMPLEMENT §3(a)–(e) BEHIND A FLAG WITH §4's RED-PROOF. IT
IS NOT SUFFICIENT TO RUN THE ABLATION — that needs the frozen genuine-condition set and the
lane-authority ruling, both listed above, both owed by the DESK.**
