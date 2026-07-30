# GATE-B RATIFY PACKET — the deterministic admission-contract fix · 2026-07-29
### REV 3 · revised 2026-07-30 under R-481 corrections 1–4 (AR-488). Rev 2 was NOT RATIFIED.
### Rev-2 lineage: revised under R-480 §5 + §6 (AR-486). Supersedes rev 1 in §2, §3, §3.5, §4, §6, §7.

> ★★★★★ **REV-3 HEADLINE — THE PARITY PREREQUISITE IS NO LONGER A LINE IN THIS PACKET'S §8. IT IS ITS
> OWN RATIFY PACKET AND ITS OWN WORKTREE** (`LEDGER-E-PARITY-RATIFY-PACKET-2026-07-30.md`, R-481 §90-91).
> **F-B MUST CLOSE BEFORE THE ABLATION. F-G MUST CLOSE BEFORE ANY PARITY RESULT MAY BE ADMITTED.**
>
> ★★★★★ **AND THE FALSE GREEN IS NO LONGER A MECHANISM READ — IT IS AN EXECUTED RESULT, PRODUCED BY
> THE DESK WITH THE GATE'S OWN COMPARATOR [MEASURED, R-481 §5 / §46-47]: pointed at a 5-fixture corpus
> via its own `TF_SPEC_BINDING_SAMPLES_DIR` override, `check-spec-binding-plan-parity.ts` returns
> `FAIL: 2 spec(s)`, exit `1`, RED on `spine_bound` · `bindable` · `primitive` · `approximation` ·
> `session_zone` — while its SHIPPED one-fixture corpus prints `Checked 1 sample specs. / PASS`, exit `0`.
> THE GATE IS NOT BLIND TO THE DIVERGENCE. IT IS NEVER GIVEN THE INPUT.**
>
> ★★★ **MY OWN F-B WAS THE WEAKER FORM OF THIS CLAIM.** AR-486 read both lanes at the line and said they
> *can* disagree. **`TO TEST A GATE, FEED IT THE INPUT IT LACKS — DO NOT RE-IMPLEMENT ITS COMPARISON BY
> HAND.`** The proven proposition below is the desk's narrower one, adopted verbatim, not my vaguer one.

> **STAGED, NOT IMPLEMENTED.** Deliverable of **R-473 §4**, revised under **R-474 §2** (six requirements)
> and **R-480 §5** (five corrections). ★★★★★ **NO CODE HAS BEEN WRITTEN AND NONE MAY BE UNTIL A RULING
> CONSUMING THIS REVISION AUTHORIZES IMPLEMENTATION.**
>
> **CLASSIFICATION (`ratify-packet`, operator amendment 2026-07-11): the AUTONOMOUS class.**
> The system is PRE-LIVE — `[MEASURED, frozen census + AR-458 live check]` `backtests_total = 0`,
> no funded account is trading. **THE GATE IS THE INDEPENDENT GRADE** (`accuracy-validator`,
> doer ≠ grader), not a permission ceremony.
>
> ★★★ **WHY IT IS STILL NOT SELF-AUTHORIZING:** it is instrument-touching by the skill's own
> definition — extraction-fidelity logic whose OUTPUT other decisions trust.
>
> ★★★★★ **REV-2 HEADLINE, AND IT CHANGES THE RISK MODEL AGAIN: the four consumers are not four
> independent surfaces. [MEASURED HERE, `runtime-production` @ `9af37b8f`] `spec-onboarding-service.ts:454`
> gates `compileBindingPlan` behind `if (!archetypeMatch.matched)`. The archetype tie-break hazard and
> the denominator-flip hazard are MUTUALLY EXCLUSIVE BRANCHES OF ONE `if` — so a spec that newly
> matches an archetype has NO after-value for `spineBound`/denominator/`ratio`/`compiled` at all.
> A record-for-record tripwire reads that as "left the queue".**
>
> ★★★★★ **AND A LIVE DEFECT ON THE EXACT SURFACE THIS PACKET MODIFIES, MEASURED AT BOTH EXECUTABLE
> LINES: the TS and Python binding tables have ALREADY DIVERGED on `SESSION_KEYWORDS`, the TS comment
> claims they mirror "EXACTLY", and the CI gate that would catch it IS NOT WIRED INTO CI.**

---

## 0 — WHAT REV 2 CHANGED, AND WHY (read this before trusting any rev-1 sentence)

| rev-1 statement | rev-2 disposition |
|---|---|
| "Downstream consumers … `[UNVERIFIED]` — I did not open them" (§2, §7) | **CLOSED.** All four opened (AR-483) + the Python mirror, the router, the convergence service and both instruments opened here (AR-486). |
| §3's design = demote clauses out of `entry_conditions` | ★★★★★ **REPLACED.** Physical removal is FORBIDDEN as the core design (R-480 §5-1). One immutable source record + typed projections. |
| §4's primary outcome = per-video C8-classified refusals | ★★★★★ **DEMOTED TO DIAGNOSTIC.** C8/C6 are OUTCOMES, not a cohort (R-480 §3-i). Treatment members are selected by source identity. |
| "all four read `execution_context`" | **REPLACED** by four consumer-specific contracts (R-480 §5-2). |
| "the Ledger-E parity gate is enforced in CI" (AR-484 §1) | ★★★★★ **REFUTED at the enforcement half — see F-A.** |
| AR-484 §1 cited `:43/:44/:50/:54` as consumption sites | **CORRECTED — those are IMPORT lines.** Real call sites: `:437`, `:455`, `:487`, `:765`. |
| AR-483 §4 left per-category routing `[NOT VERIFIED]` | ★★★★★ **ANSWERED AND INVERTED — it HAS a behavioural consequence. See F-E.** |

**AND WHAT REV 3 CHANGED (R-481 corrections 1–4):**

| rev-2 statement | rev-3 disposition |
|---|---|
| verdict `CONSUMER-SUPERSEDED`, **aborts the run** | ★★★★★ **REPLACED by `CONTROL_FLOW_CHANGED` + a five-field control-flow record. THE SWEEP CONTINUES.** Aborting would have destroyed the incidence number that decides theoretical-vs-live. |
| §3.5 = six independent matrix rows | **DECISION GRAPH added.** The rows are the leaves; the graph is the shape. |
| §6 "`[UNMEASURED]` whether `0b0d6617` moves C8" | ★★★★★ **CORRECTED — MEASURED: `233 → 159`, `−74`, treatment population `158`. Rev 2 contradicted its own §1.** |
| §7 truth set "`[NOT DETERMINED]`, pending" | ★★★★★ **ITS PRESCRIBED KEY IS DEAD** — `11.2%` realizable, `0%` on the spearhead. Replacement rule is DESK-owned. |
| §4.2 bandc script "diagnostic, may not be called success" | **FORBIDDEN as an efficacy oracle — as a PROHIBITION ON THE CLASS**, not a caution about one script. |
| §3.5.2 F-B "the lanes *can* disagree on `compiled`" | ★★★★★ **REPLACED by the desk's EXECUTED result + the narrower proven proposition: divergence on `compiled` is CONDITIONAL on spine composition.** |
| §8 parity listed as a desk ruling owed | **PROMOTED to its own ratify packet + its own worktree.** |

★★ **UNCHANGED AND NOT RE-OPENED: §1's causal finding.** It rests on positive producer + artifact
evidence, was confirmed at the executable line by the desk (R-474 §2), and is not affected by its own remedy.

---

## 1 — WHAT & WHY NOW (receipts at `file:line`, not narrative)

**THE DEFECT IS AN INSTRUCTION, NOT A BUG.** The producer explicitly teaches the admission
gate that execution context is a decision.

**Producer identity:** `tf-deep-scan` — ★★★ **a LINKED WORKTREE of the main repo, NOT its own
repository (R-474 §0, corrected)** — @ **`dc8a150`**, path `scripts/atomize-transcript.ts`.
★★ **That blob exists on NO working tree; it is reachable through the main repo's object store.**
Stamped on all 40 specs as `pipeline_commit=dc8a150`, `extraction_pipeline_version=compiler-v3-union-1.0`.

| receipt | content |
|---|---|
| **`dc8a150:60`** | `"we trade this on crude oil" / "we're sitting on the 30-minute chart today"  -> YES (WAIT_SESSION — execution context: removing it changes what the engine runs on)` |
| **`dc8a150:61`** | `"mark the high and low of the first 30 minutes" … -> YES (WAIT_STRUCTURE / FILTER — a price LEVEL, never WAIT_SESSION)` |
| **`dc8a150:32`** | `ATOM_TYPES` = 14 members, ★★★★★ **NOT ONE of which represents non-executable context** |
| **`dc8a150:112`** | `if (r.is_decision && r.atom_type && r.atom_type !== "NONE" && ATOM_TYPES.includes(r.atom_type as AtomType)) {` → `:118` `atoms.push(a)` |
| **`graph-to-engine.ts:69,72,76,80-87`** | `sourceAtoms = graph.atoms.filter(...)` → `for (const a of sourceAtoms)` → every `entry_conditions.push` is INSIDE that loop |

★★★★★ **THE ROOT CAUSE, MECHANISTIC: THE ADMISSION CONTRACT CONFLATES *"removing it changes
what the engine runs on"* (RUN CONFIGURATION) WITH *"is an entry predicate"* (A PER-BAR
CONDITION).** `:60` admits them as decisions on the first ground; `:32` then offers no legal way to
type them as context, so `WAIT_SESSION` is the **forced landing spot**.
★★★ **IT IS A DESIGN DEFECT, NOT A TYPO — `:61` draws the opposite boundary carefully on the very
next line. The reasoning is the defect.**

**THE MEASURED CONSEQUENCE** (`C8-PROVENANCE-LEDGER-2026-07-29.md`, instrument
`c8_provenance_ledger.py`): `456` per-video refusals · **`233` C8** over `37` videos ·
**`232` `C8-ANNOTATION`** all carrying `semantic_type=WAIT_SESSION` + `reason=no_recognized_session_keyword` ·
**`1` `C8-EMPTY-SPINE`**. Clause texts are literally `timeframe` (×28) · `time frame` (×15) ·
`chart timeframe` · `daily time frame` · `s p 500` · `oil`.
★★ **AND THE POST-`0b0d6617` STATE, [MEASURED, R-478]: `74` rows moved C8 → C6, so C8 is now `159`.
That movement came from a DOWNSTREAM CLASSIFICATION CHANGE, not from any extraction repair — which is
exactly why §3.5 selects members by source identity and never by bucket.**

★★ **WHY NOW:** C8 is the single largest remediation class and the only one whose repair makes any
POP-120 video refusal-clean. ★★★ **HONEST SCOPE: *"C8 is the only single remediation class that makes
ANY POP-120 videos refusal-clean"* — **NOT** *"C8 alone produces a Phase-1-exitable strategy."*
`0/16 fully bound` is **corpus_A**; the 40-video ranking is **POP-120-LIVE**; the overlap map is `[UNENUMERATED]`.**

---

## 2 — BLAST RADIUS

**INVALIDATED / CHANGED:**
- ★★★★★ **`certified_gate=6-video-46of46-2026-07-02`, stamped on all 40 specs, CEASES TO DESCRIBE
  the post-fix extractor.** It certifies the OLD admission contract; it must be re-earned and may
  **NOT** be carried forward by inheritance.
- **`spec_hash` changes for any re-extracted video** — and `spec_hash` hashes only the EXECUTABLE
  spec, so it **cannot authenticate projections stored beside it.** See §3(f).
- ★★★★★ **SIX DOWNSTREAM DECISION SURFACES, not four.** Enumerated with the executing tree named,
  in §3.5. The rev-1 list of four was correct as far as it went and stopped one layer short of the
  convergence point and the Python mirror.

**EXPLICITLY NOT INVALIDATED:**
- ★★★★★ **THE FROZEN EVIDENCE BASE.** The 40 canonical specs, the classified census (`eed65514…`),
  the raw census (`ad4335f0…`) and the 40 preserved transcripts (`913,668` B) are FORWARD-BASELINE
  FROZEN. **FORWARD-ONLY: NO BACKFILL, NO REWRITE, NO RE-STAMPING** (R-463).
- **Gate A's causal finding** — `456 / 233 / 232 / 1` — rests on positive producer and artifact
  evidence and is not affected by its own remedy.

---

## 3 — THE EXACT CHANGE, SCOPE-LOCKED (R-480 §5-1 design)

### IN SCOPE

**(a) ★★★★★ NO PHYSICAL DELETION. ONE IMMUTABLE SOURCE RECORD, FOUR DERIVED PROJECTIONS.**
The clause record is written once and never removed. Disposition is a *projection selector*, not a delete:

| projection | meaning | executable? | source record retained? |
|---|---|---|---|
| **`decision_condition`** | a per-bar predicate the engine evaluates | **YES** | yes |
| **`execution_context`** | configures WHAT the engine runs on | **NO** | yes |
| **`annotation`** | discussion, motivation, recap, terminology | NO | yes |
| **`unresolved`** | ambiguous, or pass-disagreement | **NO — fail-closed** | yes |

with **`context_kind ∈ { instrument, chart_timeframe, platform, market_session }`**.
★★★★★ **MIXED CLAUSES SPLIT. Both outputs retain the SAME source identity.** The empty-spine
sentinel is **untouched and outside treatment** (invariant #9).

**(b) THE ADMISSION RULE.** A clause selecting ONLY instrument, chart timeframe or platform view
**may never enter `DecisionGraph.atoms`** → `execution_context`. A clause predicating trading on an
actual market **SESSION / TIME WINDOW** remains a `decision_condition` and stays `WAIT_SESSION`.

**(c) ★★★★★ DETERMINISTIC, NOT PROMPT-ONLY — THE LOAD-BEARING REQUIREMENT (R-474 §2-2).**
**A PROMPT EDIT IS A REQUEST, NOT A FIX.** Enforced by CODE at `dc8a150:112`'s gate, so a clause whose
resolved `context_kind` is `instrument | chart_timeframe | platform` **cannot** become an atom
regardless of what the model returned. ★★★★★ **A MODEL-PRODUCED `context_kind` MAY NOT BE
AUTHORITATIVE** (R-469 §6). ★★★ **R-466 §2 is binding: the two-pass UNION cannot CREATE conditionness
but CAN PRESERVE a false positive from EITHER pass.**

**(d) PASS DISAGREEMENT FAILS CLOSED.** Pass A context / pass B decision → **`unresolved`**, retained,
**never silently promoted by the union, never discarded.**

**(e) THE SPAN/EVIDENCE INVARIANT, localised to one line.**
★★★★★ **[MEASURED] `dc8a150:117`: `provenance: SPAN((r.evidence_span || c.text).trim(), c.start, c.end)`
— the model's `evidence_span` STRING against the clause's `c.start`/`c.end` OFFSETS. Two different
objects in one record. That is the mechanism behind byte-exact `evidence == transcript.slice(start,end)`
= `0 / 232`.** Fix: derive the quote **DETERMINISTICALLY** from `transcript.slice(start, end)`; keep any
model hint in a **SEPARATE, EXPLICITLY UNTRUSTED** field. **FORWARD-ONLY.**
★★★★★ **SEPARATE THE FIX FROM THE EXPERIMENT (R-474 §2-3): the span repair is an UNCONDITIONAL
correctness fix shared by CONTROL and TREATMENT; ONLY the admission change sits behind the default-OFF
flag. REQUIRED: a MATERIALITY RECEIPT proving the span repair changes evidence BYTES while changing
ZERO condition identities, executable counts, C8 classifications and empty-spine behaviour.**

**(f) ★★★★★ FULL-ENVELOPE BINDING (R-474 §2-4).** An `artifact_hash` over canonical
`{spec, execution_context[], annotations, unresolved, extraction_provenance}`.
**`A SPEC-ONLY HASH IS NOT A PIN OVER A CONTRACT THAT ADDS ADJACENT FIELDS`** — same species as
`A COUNT IS NOT A PIN`. ★★ **Rev 1 declared this OUT of scope. Rev 2 pulls it IN, because R-474 §2-4
requires it and a projection design without it has no authenticated projection.**

**(g) THE VERSIONED CONTRACT PATH, END TO END (R-474 §2-1).** `execution_context[]` carries source
clause/span identity · `context_kind` · normalized value · **exact transcript-slice evidence** · a
separately named UNTRUSTED model hint · deterministic resolution status · extraction/pass provenance —
traced **atomizer → graph/handoff → engine spec → persisted envelope → each consumer in §3.5.**
★★★ **`RETAINED METADATA` MEANS CONSUMED THROUGH AN EXPLICIT CONTRACT — not bytes stored beside code
that still reads the old field. A field nothing reads is not retention, it is a landfill.**

### OUT OF SCOPE (explicitly, so the implementer cannot drift)

★★★★★ **THE `C8-EMPTY-SPINE` REFUSAL IS UNTOUCHED.** `spec_execution_preflight.py` @ `83efd34e:296-306`
manufactures it with `condition_id=""` hardcoded; it is a downstream **SAFETY BEHAVIOUR** and stays
**FAIL-CLOSED**. Its `remediation_class` LABEL may be corrected separately. ★★★ **`NEVER TAKE A REAL
RISK TO REMOVE AN APPEARANCE` (invariant #9) — and it belongs to `75DJN5UVQnw`, a distance-0 target.**
Also OUT: the unreachable `context` enum member in `CLASS_MAP` (`dc8a150:34`) — a real dead branch but
★★ **explicitly NOT the cause** · the C2 session-role resolver · any backfill of historical artifacts ·
any change to `c8_provenance_ledger.py` · any backtest · any re-extraction beyond §4's single
authorised ablation.
★★★★★ **AND NEWLY OUT, DELIBERATELY: the F-B parity break and the F-A CI-wiring gap are REPORTED
UNPATCHED, not fixed here.** They are pre-existing, they belong to another concept, and R-480 forbids
consumer code changes. **They are PREREQUISITES to the ablation, not part of the treatment.**

---

## ★★★★★ 3.5 — THE CONSUMER CONTRACT MATRIX (R-480 §6 step 2)

**EVERY ROW MEASURED IN `runtime-production` @ `9af37b8f` — THE TREE THAT EXECUTES — AND THE TREE IS
NAMED BESIDE EVERY CITATION.** Where a file also exists in `tf-deep-scan` @ `4f3b5cd0` or primary @
`404a3396`, the divergence is stated rather than assumed away.

### 3.5.0 — THE CONVERGENCE POINT, AND THE BRANCH THAT COUPLES EVERYTHING

★★★★★ **[MEASURED, `runtime-production`, `src/server/services/spec-onboarding-service.ts`]** — the
single file through which all six surfaces are reached. **Real call sites, not imports:**

```
:437   const archetypeMatch = matchArchetype(spec.entry_conditions);        // UNCONDITIONAL
:452   let bindingPlan: BindingPlan | null = null;
:454   if (!archetypeMatch.matched) {
:455     bindingPlan = compileBindingPlan({ entry_conditions, invalidations, entry_trigger_id });
:460     conditionCompiled = bindingPlan.compiled;
       }
:487   const rec = recoverSpecTimeframe(artifact);
:488   if (!rec.recovered || !rec.exec_timeframe) { … return { ok: false, reason: "timeframe_unrecoverable" } }
:514   timeframe = rec.exec_timeframe;
:526   const category = archetypeMatch.matched ? deriveCategoryFromArchetype(archetypeMatch.archetypeKey)
:528                  : conditionCompiled      ? deriveCategoryFromConditionSpec(spec)
:530                                           : deriveCategoryFromArchetype(null);
:535   const strategyName = deriveStrategyName(conceptName, symbol, timeframe);
:765   registerStrategiesInPlaybook(opts.playbookRouterPath, [strategyName], category);
```

### ★★★★★ THE ONBOARDING DECISION GRAPH (R-481 correction 2) — the six consumers are NOT independent rows

```
                       spec.entry_conditions
                                │
                    :437  matchArchetype(...)
                    ┌───────────┴───────────┐
             matched = TRUE            matched = FALSE
                    │                       │
   ┌────────────────┴──────┐     :455  compileBindingPlan(...)
   │ ★ NO BINDING PLAN     │        ┌──────────┴──────────┐
   │   bindingPlan = null  │   compiled = TRUE      compiled = FALSE
   │   spineBound   = null │        │                     │
   │   spine.length = null │        │                     │
   │   spineRatio   = null │        │                     │
   │   compiled     = null │        │                     │
   └────────────┬──────────┘        │                     │
        :527 category from      :529 category from   :530 category from
        ARCHETYPE KEY          CONDITION SPEC       deriveCategoryFromArchetype(null)
        route=ARCHETYPE_MAPPED route=CONDITION_     route=NEEDS_ARCHETYPE
                               COMPILED             (blanket CONTINUATION default)
                    └───────────┬───────────┘
                                │
                  :487  recoverSpecTimeframe(artifact)
                    ┌───────────┴───────────┐
        !recovered / no exec_tf        recovered = TRUE
                    │                       │
        :503 HARD QUARANTINE          :514 timeframe = rec.exec_timeframe
        return { ok:false,                  │   ★ partial removal lands HERE
          "timeframe_unrecoverable" }       │     with a WRONG value
                                    :535 deriveStrategyName(concept, symbol, timeframe)
                                            │   ★ the NAME encodes the timeframe
                                    :765 registerStrategiesInPlaybook(path, [name], category)
                                            │   ★ WRITES playbook_router.py SOURCE
                                            ▼
                              playbook_router.py allowed_strategies
                              → WHICH REGIMES MAY TRADE THIS STRATEGY
```

★★★★★ **READ THE GRAPH, NOT THE ROW LIST: a single clause removal can move the FIRST branch, and every
consumer below it inherits a different path. The matrix rows are the LEAVES; this is the shape.**

★★★★★ **F-C — `matchArchetype` GATES `compileBindingPlan` AT `:454`.** AR-483 §3's denominator flip
and §4's archetype tie-break are **NOT two independent hazards. They are mutually exclusive branches of
one `if`.** If clause removal flips `matched` `false → true`, **`compileBindingPlan` never runs**,
`bindingPlan` stays `null` (`:452`), and `spineBound` / `spineTotal` / `spineRatio` / `compiled` have
**NO AFTER-VALUE.** ★★★★★ **THIS IS A DIRECT HIT ON R-480 §5-3's RECORD-FOR-RECORD TRIPWIRE: a
populated BEFORE row beside a NULL AFTER row reads as "the spec left the queue" — success — when the
truth is "a different consumer took over and the plan was never computed." §4.4 makes that state its
own verdict code rather than a blank cell.**

★★★★ **F-D — the category cascade at `:526-530` branches on the SAME predicate**, so an archetype flip
also **switches which function decides the category** (`deriveCategoryFromArchetype` vs
`deriveCategoryFromConditionSpec`). One clause removal, two consumers re-routed, through one branch.

★★★★ **F-F — the recovered timeframe becomes part of the strategy's NAME** (`:514` → `:535`), and the
name is what `:765` writes into the playbook. Timeframe-recovery FAILURE is a hard spec-level
quarantine (`:488-512`, `ok:false`) — **but AR-483 §2's partial-removal case returns `recovered:true`
with a WRONG timeframe, which sails through that quarantine and yields a DIFFERENT name string.**
[MEASURED, `playbook_router.py:101`] names ARE timeframe-suffixed at multiple timeframes
(`long_entry_or_short_entry_mes_5m` **and** `long_entry_or_short_entry_mes_15m` both present), so a
wrong timeframe is a *plausible* name rather than an obviously broken one. ★★ **`[HYPOTHESIS,
UNTESTED]` — the downstream overlay-bypass consequence of a name change. It needs a
`playbook-registration.ts` read I did NOT do; I am not asserting it.**

### 3.5.1 — THE MATRIX

| # | consumer · tree | INPUT PROJECTION it must consume | DECISION it makes | SILENT-TRANSITION RISK | PARITY OBLIGATION | REQUIRED FIXTURE |
|---|---|---|---|---|---|---|
| **1** | `spec-timeframe-recovery.ts` · `runtime-production` (byte-identical 3/3 trees, `16,935` B / `C622F25B`) | **Structured timeframe context FIRST** (`execution_context[].context_kind=chart_timeframe`, normalized value + confidence). Legacy `entry_conditions[].object` prose **ONLY for old schema versions**. **Conflict ⇒ FAIL CLOSED.** | `exec_timeframe`, `higher_timeframe`, `recovered`, `confidence` — and via `:514`→`:535` the **strategy NAME** | ★★★★★ **FAIL-OPEN, NOT fail-closed.** `:311` `Math.min(...execTfs)` over SURVIVING tokens ⇒ a true-`5m` spec returns `"15m"`, `recovered:true`, conf `0.4–0.9`; `:318` only quarantines OUTSIDE the supported set and `15m` is inside. ★★ Also moves on `c.type`/`c.role`/`c.id` changes, not only existence (`:167-189`, `:255-257`) — provenance tiers `0.9 > 0.8 > 0.4–0.6` | Structured path and legacy path must return the SAME value on a spec that has both, or FAIL CLOSED. **No silent preference.** | *"trade MES on the five-minute chart only during New York session"* (**R-474 §2-2's mandated splitter fixture**) · **partial-removal fixture: remove ONE of two timeframe clauses, assert NOT `recovered:true` with the survivor's value** |
| **2** | `spec-family-bindings.ts` · `runtime-production` | **Executable-required conditions ONLY.** Must report **numerator and a STABLE SOURCE DENOMINATOR SEPARATELY** (R-480 §5-2) | `bindable` per condition · `spineBound` · `spineTotal` · `spineRatio` · `compiled` · `queueReasons` | ★★★★★ **DENOMINATOR ARTIFACT.** `:75` `MIN_SPINE_BOUND_RATIO=0.5`, `:219` numerator `spine.filter(b=>b.bindable).length`, `:257` `spineBound/spine.length`, `:258` `compiled=false` below threshold. `WAIT_SESSION` + `requiresSessionKeyword` (`:88-93`) + no session hit (`:159-174`) ⇒ **unbindable BY CONSTRUCTION**, so removing chart-timeframe clauses **shrinks the denominator only** and can flip `compiled` `false→true` with numerator UNCHANGED | ★★★★★ **TWO-SIDED, PARITY-GATED.** `:1-21` declares a Ledger-E contract: changing `FAMILY_META`, `MIN_SPINE_BOUND_RATIO` or `SESSION_KEYWORDS` **requires the Python change in the SAME commit.** ★★★★★ **AND F-A: THE GATE IS NOT CI-WIRED — see 3.5.2** | **`(spineBound, spineTotal, spineRatio, compiled)` BEFORE and AFTER for every member** · a flip with **unchanged `spineBound` is `DENOMINATOR_ONLY`** and earns **ZERO efficacy credit** (R-480 §3-ii) |
| **3** | `src/engine/spec_family_bindings.py` · `runtime-production` **only** — ★★★ **ABSENT from `4f3b5cd0`** (`40,583` B here vs `35,790` B primary) | same as #2 | `compile_binding_plan(...).to_dict()` — the Python authority | ★★★★★ **ALREADY DIVERGED FROM ITS TS MIRROR — F-B, 3.5.2.** `:314` `MIN_SPINE_BOUND_RATIO=0.5`, `:769` `spine_bound`, `:810` `spine_ratio = spine_bound/len(spine)`, `:811-812` `compiled=False` — **the denominator mechanism is TWO-SIDED and identical**; the SESSION TABLE is not | Must move in the SAME commit as #2 (Ledger-E) | Same before/after tuple, computed in **BOTH** lanes, **asserted equal** |
| **4** | `spec-archetype-matcher.ts` · `runtime-production` | **An explicitly AUTHORIZED semantic projection — NEVER a prose set Gate B altered** (R-480 §5-2) | `matched` · `archetypeKey` — and at `:454` **whether #2/#3 run at all** | ★★★★★ **CAN NEWLY *ENABLE* A REFUSED DISPATCH.** `:145-151` concatenates **every** `entry_conditions[].object` (all roles) into one haystack; `:154-174` scores by keyword-substring count; `:184-187` returns `matched:false` **on a top-score TIE.** Removing the clause that CREATED the tie breaks it ⇒ UNMAPPED → **MAPPED**. Its own docstring (`:7-8`, `:77-78`) names this the dangerous direction: *"a false-positive silently dispatches the WRONG engine class"* | Haystack membership must be a DECLARED projection, diffable before/after | **Tie-creating fixture:** a clause carrying archetype vocabulary *and* chart vocabulary — e.g. *"on the 5 minute chart during the silver bullet window"* — assert `matched` does NOT change |
| **5** | `playbook-registration.ts` · `runtime-production` (`8,274` B; ★★ **`17,472` B in the campaign tree — NOT analysed**) | **A stable semantic projection. Deletion alone may not silently re-bucket it** (R-480 §5-2) | `PlaybookCategory` ∈ {CONTINUATION, REVERSAL, MEAN_REV, ORB} → **written into `playbook_router.py` SOURCE** at `:204` `writeFileSync` | ★★★★★ **ORDERED-PRECEDENCE RE-BUCKETING.** `:92-106` filters `role === "spine" \|\| "trigger"` (`:93-95`), builds a haystack from `c.object` (`:96-98`), routes by **ORDERED** precedence MEAN_REV → REVERSAL → ORB → default CONTINUATION (`:100-105`). Removing a clause **changes the category, not merely loses it** | Category must be derivable from the projection alone and be STABLE under any projection change that does not change meaning | **Ordered-precedence fixture:** a clause whose removal moves the FIRST matching keyword — assert category unchanged |
| **6** | `src/engine/context/playbook_router.py` · `runtime-production` (`27,019` B; **`19,922` B in `4f3b5cd0` — DIVERGENT**) | consumes the category **as list membership** | **WHICH REGIME/PLAYBOOK BLOCKS MAY TRADE THE STRATEGY** | ★★★★★ **F-E — AR-483 §4's `[NOT VERIFIED]` IS NOW ANSWERED, AND INVERTED. The four lists ARE used INDIVIDUALLY as `allowed_strategies`:** CONTINUATION `:138 :145 :198 :211 :224` · REVERSAL `:152 :159 :240` · MEAN_REV `:166 :173 :240` · ORB `:180 :187 :211`. **`ALL_STRATS` (`:105`) is used NOWHERE ELSE in the file.** So AR-483 was RIGHT that the flat union makes the eligibility BYPASS category-insensitive — and the routing consequence it left open is **REAL: category selects the regime set.** And `:79`'s comment (*"a wrong category routes to the wrong per-playbook allow-list"*) is **TRUE, not aspirational** | Category persisted to SOURCE ⇒ a re-bucket is a **source mutation**, reviewable as such | **Regime-set fixture:** assert the strategy's `allowed_strategies` membership set is byte-identical before/after |

### ★★★★★ 3.5.2 — TWO LIVE DEFECTS ON THIS EXACT SURFACE, REPORTED UNPATCHED

**F-A — THE LEDGER-E PARITY GATE IS NOT CI-ENFORCED. [MEASURED HERE, with a positive control.]**

| probe | result |
|---|---|
| `grep -n "check-spec-binding-plan-parity" package.json` | **`:28` present** — `"check:spec-binding-plan-parity": "npx tsx scripts/check-spec-binding-plan-parity.ts"` |
| `grep -rl "check:spec-binding-plan-parity" .github/workflows/` | ★★★★★ **`0` files** |
| **POSITIVE CONTROL** `check:ts-python-exit-parity` | **`1` file — `.github/workflows/ci.yml:343` `run: npm run check:ts-python-exit-parity`** |
| **POSITIVE CONTROL** `check:2026-compliance` · `check:production-isolation` · `system-map:check` | **`2` workflow files each** |
| full-repo sweep (`*.json *.yml *.yaml *.mjs *.ts *.cjs *.sh`, `node_modules` excluded) | only its **own source**, its **own `dist` artifact**, `package.json:28`, and **two docstrings pointing at it** |
| default fixture corpus `ci/fixtures/spec-binding-parity/` | ★★★ **ONE file — `all-families.spec.json`, `1,690` B** — while the script's own docstring `:11-13` claims *"every real sample spec in the **25-sample generalization corpus**"* |

★★★★★ **SO: AR-484 §1's *"CONFIRMS the Ledger-E parity gate is REAL and enforced in CI, not a
docstring aspiration"* IS CORRECT ON `REAL` AND REFUTED ON `ENFORCED`.** The script contains genuine
parity logic and exits `1` on drift — but nothing runs it. **`EXISTENCE IS NOT WIRING.`** AR-483 §3's
*"a one-sided edit fails CI by design"* and R-480 §5-2's reliance on the parity contract both rest on
an unwired gate. ★★ **The workflow directory exists and holds three files (`ci.yml`, `fast.yml`,
`metric-snapshot.yml`), so the null is a measured absence, not a wrong path.**

★★★ **F-G — AND THE GATE UNDER-COMPARES WHAT IT COLLECTS.** `:60-84` maps `reason`, `role`, `type`,
`object`, `executed` into the compare shape; the loop at `:131` compares only
`condition_id, bindable, primitive, approximation, session_zone`. **`reason` — the field carrying
`no_recognized_session_keyword` vs `session_zone_refused_uncomputable_window:*`, i.e. the C8
classification key — is collected and NEVER COMPARED.** Anyone reading "the parity gate covers the
binding record" is wrong about the one field this packet's population is defined by.

**F-B — THE TS AND PYTHON SESSION TABLES HAVE ALREADY DIVERGED, AND THE TS COMMENT DENIES IT.**

| | `spec-family-bindings.ts` (`runtime-production`) | `spec_family_bindings.py` (`runtime-production`) |
|---|---|---|
| `SESSION_KEYWORDS` | **`:65-73` — SEVEN zones:** london · ny_am · ny_pm · silver_bullet · macro_window · **`lunch_blackout`** · **`overnight`** | **`:285-291` — FIVE zones.** The two orphan zones are **absent** |
| `REFUSED_SESSION_KEYWORDS` | ★★★★★ **DOES NOT EXIST** (grep: the only `lunch`/`overnight` occurrences in the entire TS file are the two table rows `:71-72`) | **`:309-312`** — `lunch_blackout`, `overnight` |
| WAIT_SESSION bind path | `:159-160` `if (meta.requiresSessionKeyword) { const zone = resolveSessionKeyword(object); }` → 7-zone table ⇒ **"during lunch" BINDS** | `:572-600` checks `refused_session_zone(obj)` **FIRST** ⇒ `bindable=False`, `primitive=None`, `approximation=True`, `executed=False`, `reason=session_zone_refused_uncomputable_window:<zone>`, `session_zone=None` |
| the caption | ★★★★★ **`:64` — *"mirror `src/engine/spec_family_bindings.py::SESSION_KEYWORDS` EXACTLY"*. IT DOES NOT.** | `:274-279` — *"THIS TABLE DELIBERATELY NO LONGER MATCHES… The divergence is the FIX, not drift — do not resync"* |

★★★★★ **NO LONGER A MECHANISM READ — AN EXECUTED RESULT FROM THE GATE'S OWN COMPARATOR
[MEASURED, R-481 §46-47], and the exact path is `src/server/lib/spec-family-bindings.ts`, NOT
`src/server/services/` (R-481 §30: the desk's first guess returned `No such file or directory`, which
reads exactly like a missing artifact — `LOCATE, DO NOT ASSUME, THE DIRECTORY`):**

| corpus fed via `TF_SPEC_BINDING_SAMPLES_DIR` (`:36-38`) | result |
|---|---|
| **SHIPPED** `ci/fixtures/spec-binding-parity/` (1 fixture) | `Checked 1 sample specs.` · `PASS` · **exit `0`** |
| 5-fixture corpus incl. two orphan-zone specs | **`FAIL: 2 spec(s)`, exit `1`.** `10-lunch-orphan`: `spine_bound ts=2 py=1` · `bindable ts=true py=false` · `primitive ts="session_windows" py=null` · `approximation ts=false py=true` · `session_zone ts="lunch_blackout" py=null`. `11-premarket-orphan`: same shape, `session_zone ts="overnight"` |
| GREEN in the same run | `00-control-shipped` (untouched) · `20-nyam-evaluable` · `21-fivemin-chart` |
| 3-spine corpus (third spine unbindable in BOTH lanes) | **adds `compiled: ts=true py=false`** |
| **same-shape NEGATIVE CONTROL**, `ny am` instead of `during lunch` | ★★★★★ **GREEN — so the flip is caused by the ORPHAN ZONE, not by fixture shape** |

★★★★★ **THE PROVEN PROPOSITION, NARROWER AND SHARPER THAN "THEY CAN DISAGREE": TS AND PYTHON DIVERGE ON
`compiled` WHENEVER THE ORPHAN-ZONE BINDING IS WHAT CARRIES PYTHON ACROSS THE `0.5` SPINE-RATIO FLOOR.**
On a plain 2-spine `during lunch` fixture `compiled` **AGREES** — TS binds `2/2 = 1.0`, PY binds
`1/2 = 0.5`, and `0.5 ≥ 0.5`, so both compile. **`compiled` divergence is CONDITIONAL on spine
composition.** ★★★ **`AN UNCONDITIONAL CLAIM ABOUT A CONDITIONAL MECHANISM IS A FALSE MECHANISM CLAIM,
AND A WRONG MECHANISM GETS OBEYED.`** The always-divergent fields are `bindable`, `primitive`,
`approximation`, `session_zone`, `spine_bound`.
★★ **`[UNVERIFIED HERE — RELAYED]`: Python's exact reason string
`session_zone_refused_uncomputable_window:lunch_blackout`. `reason` is COLLECTED AND NEVER COMPARED
(F-G), so it CANNOT appear in a DRIFT line and no run has printed it.** ★★★★★ **THAT EXPOSES A
CIRCULARITY IN THE ACCEPTANCE CRITERION ITSELF: "refuse identically in both lanes WITH THE SAME REASON"
is a property the current comparator STRUCTURALLY CANNOT CHECK. Closing F-G is a PREREQUISITE to that
criterion being meaningful, not a parallel item.**
★★★★★ **AND THE INVARIANT R-481 §55 ADDS, WHICH GOVERNS THE REPAIR: `TS/PYTHON PARITY IS SEMANTIC
OUTPUT PARITY, NEVER TABLE-TEXT EQUALITY.` **DO NOT "RESTORE PARITY" BY TEACHING PYTHON TO ACCEPT
`lunch` OR `overnight`.** Python's refusal is the SAFE behaviour — those zones have no evaluable window,
so a bind produces a rule that says *"only trade during X"* and executes as *"never trade"* while
reporting `approximation=False`, an exactness claim. **TYPESCRIPT IS THE SIDE THAT MUST MOVE.**
★★★ **AND IT IS A DECLARED, KNOWN CARRY-FORWARD, NOT A DISCOVERY: Python `:283-284` reads
*"[MEASURED 2026-07-28] … it (and the TS mirror) are reported as adjacent work rather than changed
here, to keep this release to one concept."* The author knew. It is un-closed.**
★★★★★ **CONSEQUENCE FOR THIS PACKET: R-480 §5-3's tripwire on `spineBound`, denominator, ratio,
`compiled` MUST NAME ITS LANE. Computing it in TS while the claim is about Python (or the reverse) is
`I MEASURED THE NEIGHBOURING OBJECT` — this desk's most-convicted failure — pre-armed.**
★★ **BOUND ON BLAST RADIUS, stated honestly: all `232` C8-ANNOTATION rows carry
`reason=no_recognized_session_keyword`, a label neither lane emits for an orphan-zone phrase. `[MEASURED
on the frozen label.]` ★ That the label therefore implies token-absence in all 232 is
`[HYPOTHESIS, UNTESTED]` — it holds only if the census producer ran one of these two code paths, and
the producer `pop120_census.py` is GONE (R-480 §Desk). I am not converting it to a measurement.**
★★ **AND AR-483 §3's DENOMINATOR MECHANISM IS UNAFFECTED BY F-B: `"five-minute chart"` matches
NEITHER the 5-zone nor the 7-zone table, so the chart-timeframe clause is unbindable in both lanes.
A new finding next to a sound one does not weaken it.**

---

## 4 — VERIFICATION PLAN

### 4.1 — MEMBER SELECTION: SOURCE IDENTITY, NEVER A BUCKET (R-480 §3-i)

★★★★★ **`A REMEDIATION BUCKET IS AN OUTCOME, NOT A TREATMENT COHORT.`** `0b0d6617` moved `74` rows
C8 → C6 **without touching the upstream extraction error** [MEASURED, R-478]. Selecting members by
current C8 membership makes the experimental population move when downstream classification moves.
**MEMBERS ARE SELECTED BY `(video, transcript_hash, exact_span, exact_slice_hash)`** — source identity
plus frozen truth labels. **C8/C6 membership is REPORTED as a downstream projection and NEVER used to
select.** ★★★ **NOT by `condition_id`: [MEASURED, R-470] it collapses `455 → 359` and merges `96`
rows — an identifier the treatment may change cannot key the set that judges it.**

### 4.2 — WHAT MAY AND MAY NOT COUNT AS SUCCESS

★★★★★ **PRIMARY OUTCOMES (R-480 §5-3):** truth-labelled non-executable context **excluded from the
executable projection** · frozen genuine session predicates **SURVIVE** · mixed clauses **keep their
executable half** · ambiguous cases remain **`unresolved`** · empty-spine **byte-for-byte unchanged**.
★★★★★ **CO-PRIMARY, AND IT OUTRANKS THE PRIMARY:** exact transcript-slice evidence · stable source
identity and full-envelope provenance. **FIDELITY OUTRANKS COUNT** (R-466 §2).
★★★★★ **FORBIDDEN AS SUCCESS, ABSOLUTELY: AGGREGATE COMPILED COVERAGE, QUEUE-RATE, C8 COUNT AND C6
COUNT ARE DIAGNOSTIC OUTCOMES ONLY (R-480 §3-ii).** `A MUTABLE DENOMINATOR CANNOT GRADE THE
INTERVENTION THAT MUTATES IT.`
★★★★★ **AND THE TRAP THAT MAKES THIS CONCRETE — [MEASURED HERE, `runtime-production`]
`scripts/bandc-measure-mapped-queued-split.ts` IS THE MAPPED-vs-QUEUED MEASUREMENT INSTRUMENT, AND
BOTH OF ITS SUCCESS BUCKETS ARE MOVABLE BY CLAUSE REMOVAL ALONE:** `:32` `matchArchetype(...)` →
`:34-38` `ARCHETYPE_MAPPED` (movable by F-C/#4's tie-break) → else `:40-52` `compileBindingPlan` →
`CONDITION_COMPILED` (movable by #2's denominator). ★★ Also: its `SAMPLES_DIR` (`:17-18`) is a
**hardcoded absolute path** into `.claude/worktrees/extraction-100/tmp/generalization` — a fourth lane,
outside all three trees this packet names. `[UNVERIFIED]` whether that directory still names the
intended population.

★★★★★ **RULED (R-481 correction 4): `bandc-measure-mapped-queued-split.ts` IS FORBIDDEN AS AN EFFICACY
ORACLE. DIAGNOSTIC ONLY. NO MAPPED-COUNT, COMPILED-COUNT, C8-COUNT OR QUEUE-RATE MAY ESTABLISH GATE-B
SUCCESS. THE SOURCE-KEYED TRANSITION LEDGER OF §4.4 IS THE INSTRUMENT.**
★★★ **Rev 2 said "permitted as a diagnostic, may not be called success". Rev 3 states it as a
PROHIBITION on the class, not a caution about one script — because the failure mode is reaching for
*any* aggregate count, and naming one script invites substituting another.** `OPTIMIZING THE PROXY
DESTROYS WHAT IT STOOD FOR.`

### 4.3 — THE PRE-REGISTERED TRAP, RESTATED IN FORCE

★★★★★ **`conditions-per-strategy WILL DROP` UNDER TREATMENT, AND THAT IS THE FIX WORKING, NOT A
REGRESSION. A HIGHER CONDITION COUNT AFTER TREATMENT IS A FAILURE SIGNAL. NOBODY MAY RE-READ A DROP AS
DAMAGE AFTER THE FACT.**
**POPULATION:** `POP-120-LIVE`, **per-video NEVER per-row** (triples inflate 3×), tree named beside
every count. **NOT `corpus_A`.** ★★ **`HOLDOUT-26` IS NOT SPENT ON THIS** — that covenant governs
tuning; this is a correctness ablation.

### ★★★★★ 4.4 — EVERY CONSUMER TRANSITION EXPLAINED, NOT COUNTED (R-480 §5-4)

For **every** member: source clause keys removed from the executable projection · before/after consumer
INPUTS · before/after consumer OUTPUT · **numerator and denominator SEPARATELY** · classified:

| verdict | meaning | disposition |
|---|---|---|
| **`SOURCE-JUSTIFIED`** | the transition follows from the source clause's truth label | counts |
| **`DENOMINATOR_ONLY`** | `compiled` flipped with `spineBound` UNCHANGED | ★★★★★ **ZERO efficacy credit; requires source-keyed adjudication; neither automatically success nor automatically regression** (R-480 §3-ii) |
| **`CONTROL_FLOW_CHANGED`** | ★★★★★ **R-481 correction 1. The archetype matched, so `compileBindingPlan` never ran and the binding tuple has NO after-value.** **A NULL AFTER-CELL IS THIS CODE, NEVER A BLANK, AND NEVER "left the queue"** | **EXCLUDED from efficacy scoring · MARKS THE RUN INVALID for a success verdict · ★★★★★ THE SWEEP CONTINUES** |
| **`UNEXPLAINED`** | anything else | **EXCLUDED from efficacy · MARKS THE RUN INVALID · THE SWEEP CONTINUES** |

**`CONTROL_FLOW_CHANGED` REQUIRES AN EXPLICIT CONTROL-FLOW RECORD — five before/after pairs, emitted
whether or not the binding outputs are comparable:**

| field | before | after | source |
|---|---|---|---|
| `archetype_engaged` | ● | ● | `spec-onboarding-service.ts:437` result `matched` |
| `binding_engaged` | ● | ● | whether `:454`'s branch entered and `:455` ran |
| `route` | ● | ● | `ARCHETYPE_MAPPED` \| `CONDITION_COMPILED` \| `NEEDS_ARCHETYPE` |
| `category_function` | ● | ● | which of `:527` / `:529` / `:530` decided the category |
| `onboarding_outcome` | ● | ● | `ok:true` \| `timeframe_unrecoverable` \| other refusal |

★★★★★ **`BEFORE COMPARING OUTPUTS, RECORD WHETHER THE COMPUTATION RAN. A BRANCH-GENERATED NULL IS AN
OUTCOME, NOT MISSING DATA.` BINDING OUTPUTS ARE COMPARABLE ONLY WHEN `binding_engaged` IS TRUE IN BOTH ARMS.**
★★★★★ **AND THE CORRECTION AGAINST REV 2, WHICH GOT THIS WRONG IN THE EXPENSIVE DIRECTION: rev 2 had
this verdict ABORT THE RUN. That would have destroyed the population-incidence number R-481 names as
the deciding one between THEORETICAL and LIVE. `FAIL CLOSED AT THE VERDICT BOUNDARY, NEVER AT THE
EVIDENCE-COLLECTION BOUNDARY.` The sweep runs to completion; the VERDICT is what fails closed.**

### 4.5 — RED-PROOF: WHAT MAKES IT GO RED WITHOUT THE FIX

★★★ **Every fixture's expected outcome is PRE-REGISTERED BEFORE the run — a code chosen after the
fact is not a prediction.**

| fixture | without the fix | with the fix |
|---|---|---|
| `"we trade this on crude oil"` | RED — becomes a `WAIT_SESSION` condition | `execution_context`, `context_kind=instrument`, **NO condition, SOURCE RECORD RETAINED** |
| `"we're on the 30-minute chart"` | RED | `execution_context`, `context_kind=chart_timeframe`, **NO condition** |
| `"trade only 09:30–11:00 ET"` | GREEN both ways | ★★★★★ **genuine `WAIT_SESSION` PRESERVED — the co-primary** |
| ★★★★★ **`"trade MES on the five-minute chart only during New York session"`** (R-474 §2-2 mandated) | RED — fused; whole-clause demotion destroys a real rule | **SPLIT**; both halves keep the same source identity; session predicate survives |
| **partial removal: two timeframe clauses, remove one** | ★★★★★ **RED — `Math.min` returns the survivor's TF with `recovered:true`** (#1) | structured path wins; conflict FAILS CLOSED |
| **tie-creating clause carrying archetype + chart vocabulary** | ★★★★★ **RED — `matched` flips false→true AND `compileBindingPlan` stops running** (F-C, #4) | `matched` unchanged |
| **ordered-precedence clause** | ★★★★★ **RED — playbook category re-buckets, and `allowed_strategies` regime set changes** (#5, #6/F-E) | category unchanged |
| pass A context / pass B decision | RED — union leaks it through | `unresolved`, fail-closed |
| every clause moved out of the executable projection | — | **PRESENT IN ITS SOURCE RECORD** (removal ≠ deletion) |
| **CONTROL arm** | ★★★★★ **must reproduce the frozen classifier result `456 / 233 / 232 / 1` BEFORE the treatment is trusted** | unchanged |
| span invariant | RED — byte-exact `0/232` | quote derived from the slice ⇒ byte-exact by construction |
| ★★★ **F-B discriminator (PREREQUISITE, not treatment)** | **a `lunch`/`premarket` `WAIT_SESSION` clause binds in TS and refuses in Python — assert the two lanes AGREE, or the tripwire's lane is undefined** | — |

★★★ **DISCRIMINATION STATED IN BOTH HALVES: the mutation goes RED **and** the unmutated control stays
GREEN, both reported. A mutation suite without its control cannot tell "catches breakage" from "always red".**

### 4.6 — THE GRADER, AND THE RESTRICTION TRAP

**Independent grader: `accuracy-validator`, dispatched by the DESK.** ★★★★★ **NEITHER THE DESIGNER NOR
THE BUILDER MAY GRADE — independence is structural.**
★★★★★ **`A RESTRICTION IN THE GRADER'S BRIEF IS A HOLE IN THE RESULT.`**

| if restricted | which claim dies |
|---|---|
| no DB read | whether the emitted spec matches the live library — the parity claim |
| no re-extraction of the ONE ablation video | the entire primary outcome; nothing measures the treatment |
| no transcript access | the co-primary — genuine market-state survival is unverifiable |
| no access to the projection store | *"every removed clause is retained in its source record"* — removal-vs-deletion |
| ★★★ **no Python execution** | **#3 and the F-B lane-agreement check — the tripwire's lane stays undefined** |

★★ **The honest null is a complete answer.** ★★★ **The semantic GROUND TRUTH of the `232` labels is
`[OUT OF SCOPE]` per R-467 §5 — neither worker nor grader authors it; every semantic cell keys to the
FROZEN classifier.**

---

## 5 — ROLLBACK

- **Code:** revert the admission-boundary commit. The change is additive at one gate plus a new
  projection sink; no historical artifact is mutated, so **revert restores prior behaviour exactly.**
- **Emitted artifacts:** any spec produced under the treatment is written to a **NEW** path with its own
  `extraction_provenance`; frozen inputs are never overwritten. **Rollback = stop using the new artifacts.**
- **Flag:** the deterministic gate ships **flag-gated for the FEATURE**, and ★★★★★ **THE FLAG GATES THE
  FEATURE, NEVER THE FIX** (extraction-campaign law 5). The §3(e) span repair is **UNCONDITIONAL** and
  therefore ships a **MATERIALITY COUNT RECEIPT** at land time — the OR-branches incident is the precedent.
- **No live default is altered:** nothing is live. `backtests_total = 0`.
- ★★★ **`registerStrategiesInPlaybook` MUTATES `playbook_router.py` SOURCE** (`playbook-registration.ts:204`
  `writeFileSync`). **Any run that reaches `:765` needs a source-level revert path, not just a DB revert.**
  Flagging; rev 1 did not carry this.

---

## 6 — LANE REALITY: NO SINGLE TREE HOLDS THE END-TO-END PATH (R-480 §5-5)

★★★★★ **[MEASURED, R-480 §1] merge-base `a5b74619da6175e4111f5c9e8f9129c59bbd6187`; NEITHER
`4f3b5cd0` NOR `9af37b8f` IS AN ANCESTOR OF THE OTHER.**

| file | `4f3b5cd0` (`tf-deep-scan`, PRODUCER base) | `9af37b8f` (`runtime-production`, EXECUTES) |
|---|---|---|
| `scripts/atomize-transcript.ts` | PRESENT | PRESENT |
| `src/server/lib/graph-to-engine.ts` | **PRESENT** | **absent** |
| all four TS consumers | ★★★★★ **ALL FOUR ABSENT** | **ALL FOUR PRESENT** |
| `src/engine/spec_family_bindings.py` | **absent** | PRESENT |
| `src/server/services/spec-onboarding-service.ts` | ★★★ **absent** | PRESENT (`37,412` B) |
| `scripts/check-spec-binding-plan-parity.ts` | ★★★ **absent** | PRESENT (`5,617` B) |
| `scripts/bandc-measure-mapped-queued-split.ts` | ★★★ **absent** | PRESENT (`3,004` B) |
| `src/engine/context/playbook_router.py` | PRESENT — **`19,922` B, DIVERGENT** | PRESENT — `27,019` B |

★★★★★ **CONSEQUENCE, MEASURED IN AR-486 AND NOT PRESENT IN REV 1: FOUR OF THE FIVE FILES R-480 §6
STEP 1b NAMES ARE ABSENT FROM THE PINNED PRODUCER TREE, AND THE FIFTH DIVERGES BY `7,097` B. A
"PRODUCER PROOF" STAGED IN `4f3b5cd0` CANNOT EXECUTE ONE CONSUMER PARITY FIXTURE AND CANNOT RUN THE
PARITY SCRIPT AT ALL.** ★★ **This does not refute the two-stage design; it BOUNDS what stage 1 may
claim.** `[HYPOTHESIS, UNTESTED]` — that the absence is a plain ancestry gap rather than deletion.

**THEREFORE, TWO SEPARATELY PINNED STAGES:**
1. **PRODUCER PROOF** — a NEW isolated worktree pinned to **`4f3b5cd0`** (R-474 §3). ★★★★★ **ITS
   VERDICT IS SCOPED TO PRODUCER BEHAVIOUR ONLY. It may NOT claim any consumer property, because no
   consumer is present to test.**
2. **DEPLOYABLE INTEGRATION** — a SEPARATE isolated worktree pinned to `runtime-production` at its
   then-current SHA: port the graded producer contract, identify the **ACTUAL runtime graph→spec
   handoff** (`[UNENUMERATED]` — `graph-to-engine.ts` is absent here), update consumers, PR/CI/deploy.
**A TRANSFER RECEIPT NAMES BOTH SHAs, the schema version, the changed-file manifest and the re-run fixtures.**
★★★★★ **DO NOT EDIT `tf-deep-scan` — it is a LINKED WORKTREE sharing the main object store and is the
producer of record for `dc8a150`. DO NOT EDIT `runtime-production` DIRECTLY.**

### ★★★★★ THE CONTROL ARM — CORRECTED (R-481 correction 3). THIS QUESTION IS **MEASURED, NOT OPEN.**

**[MEASURED, R-481 §70]** frozen C8 = **`233`** · counterfactual under current code = **`159`** · movement =
**`−74`** · **sentinel-excluded GATE-B TREATMENT POPULATION = `158`** (§7.1: *this* `158`, the treatment
population — not `confluence ∩ C8`, not R-478 §3's mislabelled figure).
★★★★★ **WHAT REMAINS OPEN IS THE ADDITIVE BASELINE, NOT THE QUESTION.**
★★★★★ **AND THIS IS A CORRECTION AGAINST REV 2, OWNED PLAINLY: rev 2's §1 published the measured
`74`-row movement and rev 2's §6 carried a rev-1 line calling the same question `[UNMEASURED]` — a
direct self-contradiction, one section apart, inside one document. `AN ANSWERED UNKNOWN REPEATED AS OPEN
IS STALE STATE RESURRECTING WORK.` A prerequisite list is a CLAIM and must be re-derived on every
revision, not carried.**
★★ **A FOURTH LANE EXISTS AND IS NOT VALID FOR THIS WORK:** the campaign tree `wt-h1-wave4-20260712`
carries `spec_family_bindings.py` at `160,049` B vs `40,583` B and has NO `spec_execution_preflight.py`
(R-415 / v4 §3-1E). ★★ **A FIFTH is referenced by a hardcoded path in §4.2's instrument.**

---

## 7 — HONEST PARTIAL: WHAT THIS PACKET DOES **NOT** COVER

★★★★★ **STATED BECAUSE A PARTIAL THAT READS AS COMPLETE IS THIS CAMPAIGN'S MOST-CONVICTED SHAPE.**

- ★★★★★ **THE CALL-SITE SCOPE-LOCK IS `[PARTIALLY UNENUMERATED]`.** §1's receipts are exact and
  re-derived, **but they are pinned to a HISTORICAL BLOB (`dc8a150`) on no working tree**, and the file
  to be edited is a live descendant. **THE IMPLEMENTER MUST RE-DERIVE THE GATE'S LINE NUMBERS IN THE
  TREE IT EDITS.** `A KEY'S SAFETY IS A PROPERTY OF THE ARTIFACT` — and so is a line number.
- **CALLER SURFACE `[PARTIALLY UNENUMERATED]`** (AR-484 §1): exhaustive for **static import + symbol
  reference + `await import` WITHIN `runtime-production`.** **NOT covered:** string-keyed / registry
  indirection · n8n or CLI paths that shell out · the other two trees.
- ★★★ **NOT OPENED BY AR-486, NAMED SO THE NEXT SEAT DOES NOT ASSUME OTHERWISE:**
  `playbook-registration.ts` **itself** (its `:92-106` / `:204` behaviour is carried from AR-483's read,
  not re-measured here) · `fade-the-losers-service.ts` (the second runtime playbook consumer) ·
  `playbook-registration-backfill.ts` · `backfill-corpus-timeframes.ts` (runs timeframe recovery
  **across the corpus**) · the campaign-tree and primary-tree copies of all six consumers.
- ★★★★★ **`[NOT DETERMINED]`: the pre-registered set of GENUINE market-state conditions — AND ITS
  PRESCRIBED KEY IS DEAD (R-481 §69, correction 3).** R-474 §4 keyed the truth set to
  `(video, transcript hash, exact span, exact-slice hash)`. **[MEASURED, R-481] THAT KEY IS REALIZABLE ON
  `11.2%` OF THE SURFACE AND ON NONE OF THE SPEARHEAD:** the preserved transcripts ARE the
  extraction-time text (`40/40` char-length identity; `264` recorded `(offset → quote)` pairs resolve
  exactly across `37/40` videos) — **but `evidence` is not a quote field.** Of `2351` conditions, `1027`
  carry an atom ref, `29`+ a placeholder, plus brace-structs and `'},{'` debris; **only `264 / 2351`
  carry a resolvable quote, and `75DJN5UVQnw` — THE distance-0 spearhead — carries ZERO** (13 conditions:
  9 atom refs, 2 debris, 2 brace-structs). ★★★ **THE REPLACEMENT KEYING RULE IS DESK-OWNED. THE WORKER
  DOES NOT AUTHOR IT** (R-467 §5). ★★ **And the desk's own method note is worth carrying: the benign
  cause — the SPEC records no quotes, the archive is not implicated — was measured BEFORE the alarming
  sentence was written. *"Zero spans resolve for the #1 target"* would have been true and a false finding.**
  It must still span FIVE cases: genuine session predicates · descriptive session context ·
  instrument/timeframe context · **mixed** · **ambiguous**.
- **`[NOT FROZEN, DESK-OWNED]`: the ADDITIVE PRODUCTION BASELINE.** ★★★ **And R-480 §Desk's constraint:
  `pop120_census.py` — the census PRODUCER — IS GONE. A re-authored producer is a DIFFERENT INSTRUMENT
  and owes a control: re-authored producer + recovered `classify.py` over the SAME snapshot must
  reproduce `eed65514a126…`, or it is not a substitute. `[HYPOTHESIS, UNTESTED]`.**
- **`[UNMEASURED]`:** ★★ **NOT `0b0d6617`→C8 — that is MEASURED, see §6** · **POPULATION INCIDENCE of every §3.5 transition** —
  each risk is a MECHANISM proven at the executable line; **how many real specs exhibit it is not
  measured, and that is the number deciding theoretical vs live** · DB↔census refusal/classification
  FRESHNESS as distinct from spec freshness · the population OVERLAP MAP · whether §4.2's hardcoded
  `SAMPLES_DIR` still exists.
- **`[UNPROVEN]`:** span SEMANTIC correctness — addresses are valid `232/232`, the invariant fails
  `232/232` byte-exact; **in-bounds is necessary, not sufficient.**
- **`[VOID for certification]`:** `absence_claim_control.py` and `mutation_redproof.py` (RETIRED, R-479).

### ★★★★★ 7.1 — THE THREE COLLIDING `158`s (R-480 §4, standing requirement)

**NO SENTENCE IN THIS PACKET WRITES `158` WITHOUT NAMING WHICH ONE.** The three objects:
`confluence ∩ C8 = 158` · the **Gate-B TREATMENT POPULATION** = `158` (C8-after `159` minus the
protected sentinel) · and R-478 §3's **erroneous** "C8 after = 158", which was numerically the
treatment population under the wrong label.
★★★ **`A COLLIDING VALUE IS A LATENT MISLABEL — AND WHEN A NUMBER HAS ALREADY BEEN PUBLISHED UNDER THE
WRONG NAME ONCE, ITS COLLISIONS ARE NOT COINCIDENCES, THEY ARE TRAPS.`**

---

## ★★★★★ 8 — WHAT THIS PACKET IS AND IS NOT SUFFICIENT FOR

**SUFFICIENT TO IMPLEMENT §3(a)–(g) BEHIND A FLAG WITH §4.5's RED-PROOF, IN THE TWO PINNED STAGES OF §6.**

**NOT SUFFICIENT TO RUN THE ABLATION. FOUR THINGS ARE OWED FIRST — AND ONE OF REV 2's FIVE IS NOW CLOSED:**
1. **DESK** — the genuine-survivor truth set, **whose prescribed key is DEAD and needs a REPLACEMENT
   KEYING RULE** (§7, R-481 §69). Not merely pending: `11.2%` realizable, `0%` on the spearhead.
2. **DESK** — the additive production baseline **+ the re-authored-producer equivalence control**
   (R-480 §Desk). ★★ **Access is no longer the blocker: [MEASURED, R-481 §49] the live library is
   REACHABLE and PROVEN READ-ONLY (`create temp table` rejected, SQLSTATE `25006`; `strategies` = `120`).
   The remaining blocker is the re-authored producer.**
3. ★★★★★ **PARITY — RULED, NOT DEFERRED, AND NO LONGER THIS PACKET'S ITEM.** R-481 §81-84 promoted it
   to `LEDGER-E-PARITY-RATIFY-PACKET-2026-07-30.md` + its own worktree:
   **F-B MUST CLOSE BEFORE THE ABLATION** (unless a graded complete-plan comparison proves the exact
   frozen Gate-B population is DISJOINT from it) · **F-G MUST CLOSE BEFORE ANY PARITY RESULT MAY BE
   ADMITTED** · **F-A CI wiring REQUIRED before merge/deploy or any reliance on parity as continuing
   protection.** ★★★★★ **AND: THE CURRENT ONE-FIXTURE `PASS` HAS ZERO AUTHORITY AND MAY NOT BE CITED BY
   ANY FUTURE RULING.**
4. **RULING** — the runtime graph→spec handoff is `[UNENUMERATED]`; stage 2 cannot start without it.

★★★ **CLOSED SINCE REV 2:** whether `0b0d6617` moves C8 — **MEASURED** (§6: `233 → 159`, `−74`,
treatment population `158`). **It was never open at rev 2 either; rev 2 carried a stale line past its own §1.**

★★★★★ **AND THE ONE SENTENCE THIS PACKET REFUSES TO WRITE: that a rise in compiled coverage, mapped
count or queue-rate would show Gate B worked. [MEASURED] the instrument that reports those numbers has
both of its success buckets movable by clause removal alone, in a tree where the parity gate that would
catch the resulting TS↔Python disagreement is not wired into CI. `A CORRECT COMPILER CHANGE AND AN
INVALID SUCCESS METRIC ARE NOT MUTUALLY EXCLUSIVE.`**
