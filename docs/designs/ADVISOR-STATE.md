# ADVISOR-STATE — money-path / H1 seat

> **Rewritten in place, never appended.** Cold read: this file → last 3–5 rulings
> → newest 1–2 ARs. **Never read the ledger from the top.**
>
> **COMPACTED 2026-07-29 at R-472/AR-471: `1,186` lines → this.** [MEASURED HERE]
> the pre-compaction file was `1,186` lines / `102,513` bytes while its own header
> claimed "compacted 450→313, current through R-453" — a self-description nobody
> re-measured, and a cold seat trusting it under-read the file by two thirds.
> **What was CUT is ~700 lines of superseded seat narrative, all of it recoverable
> from git history and from the rulings it summarised. What was KEPT is every
> contract block, verbatim.** `CUT NARRATIVE, NEVER CONTRACTS` — and the whole
> file was read (three pages, `1–520` · `521–920` · `921–1186`) before anything was
> classified as cuttable, because you cannot classify what you have not read.
>
> ★★★★★ **VERIFY THE PAYLOAD OF EACH `v3-N` UPGRADE, NOT ITS TAG.** A tag-presence
> check is exactly what missed the dropped fourth attribution bin on 2026-07-29.
> `v3-1` must read **FOUR** bins including `gate-artifact`; `v3-2` must carry
> **effective-N**. Both verified present in `## THE PLAN` below.
> ★★★ **CITE RULINGS BY `grep -n "^## R-061"`, NEVER BY LINE NUMBER.** The ledger
> appends at top, so every new ruling pushes every old one down; the prior header
> cited `ADVISOR-RULINGS.md:6625` for R-061 when R-061 had moved to `8169`.

---

## SEAT — CURRENT AS OF R-472 / AR-471

**Ledger `R-475`** (commit `a92f95aa`). **Newest AR `AR-475` — RULED: REVISE. Item 1
is BETTER and is NOT RATIFIED.**
★★★★★ **WHY IT IS NOT RATIFIED — A THIRD FLOOR OF THE SAME DEFECT, REPRODUCED HERE
WITH GROUND TRUTH: a caller names a directory as the surface; a descendant named
`node_modules` holding a REAL occurrence is silently pruned; the tool prints
`1 PRESENT, 0 UNREADABLE, of 1` · ADMISSIBLE · exit `0` — while an independent
recursive content match finds `2`. `buried.ts` appears NOWHERE: not excluded, not
unreadable, not listed.** ★★★★★ **AND `:168`'s comment reads `# DECLARED exclusion,
printed with every run -- not a silent drop`. [MEASURED] `PRUNE_DIRS` occurs
exactly TWICE in the file — the declaration at `:71` and the skip at `:167`. THERE
IS NO EMIT. A false caption annotating the very statement that falsifies it.**
★★★★★ **LAW: `AN EXCLUSION IS PART OF THE MEASUREMENT SURFACE. IF IT IS NEITHER
ADJUDICATED NOR EMITTED, IT IS A SILENT OMISSION WEARING THE NAME "PRUNING".`
R-472 §0 put fail-closed at the CONTROL · R-474 at the ENUMERATION · R-475 at the
EXCLUSION POLICY. `EVERY BOUNDARY THE CLAIM CROSSES MUST FAIL CLOSED` — including
the boundary your own fix just introduced.**
★★★★★ **AND AGAINST THIS DESK: I verified Item 1's red-proof, self-test AND
containment, all correctly, and all of it was blind here — MY FIXTURES CONTAINED NO
PRUNED DIRECTORY. `A CONTROL PROVES ONLY THE CASE IT CONTAINS.` RE-PROVING THE
DEFECT YOU ALREADY KNOW IS REHEARSAL, NOT VERIFICATION. The external read looked at
the boundary I had just MOVED rather than the one I had just FIXED.**
★★★ **[MEASURED HERE] THE RELAY IS PROVEN END-TO-END: R-473 committed `21:37`,
worker start-receipt `21:37:50` — **40 seconds**. A quiet window before a ruling
lands is THE DESK OWING A RULING, not a stalled worker.**
★★★★★ **[VERIFIED AT THIS DESK, not accepted from the report] Item 1's red-proof
holds on the advisor's OWN original fixtures — run A (honest surface) exit `0`,
"ALL 3 surface members were readable"; run B (`hidden`→`hiddne`) exit `8`,
`DENIED BY: …\hiddne — SURFACE DOES NOT EXIST`. `--self-test` `10/10` at
pre-registered codes, exit `0`. Containment: `8838183f` touches only the guard,
3 fixtures and the report; `c8_provenance_ledger.py` untouched as ordered.**

## AUTHORIZED NOW — R-475 §5, TO THE WORKER SEAT UNDER `claude.exe 15908` (addressee corrected by R-476)
★★★★★ **THE §3 BOUNDED CORRECTION, ORDERED AS A PROPERTY:** *"NO PATH MAY LEAVE THE
SURFACE WITHOUT APPEARING IN THE VERDICT — either a named problem forcing a
non-zero exit, OR an explicit caller-supplied exclusion whose exact paths are
EMITTED and whose removal is stated in the certified proposition. A BUILT-IN,
UNDECLARED EXCLUSION IS INADMISSIBLE."*
★★★★★ **BOTH HALVES RED-PROOFED, AND THIS IS THE HARD PART: the pruned-occurrence
case must go non-zero (or emit its exclusion), AND a realistic multi-repo query
must still return a usable verdict. The real surface is `47` repos where
`node_modules` is ubiquitous, so a bare "every prune exits 8" rule may retire the
tool by accident `[HYPOTHESIS, UNTESTED]`. IF THE TWO HALVES PROVE INCOMPATIBLE
THAT IS A FINDING — report it UNPATCHED, do not pick one silently.**
**ALSO:** fix the false `:168` comment · add the permanent pruned-occurrence
fixture (control in a readable sibling, real occurrence under a `PRUNE_DIRS`-named
subdir, exact path named) · correct the provenance banner (6 fixtures from AR-470,
4 from R-474/AR-474) · narrow the citation sentence to *"no live direct filename
citation within `docs/designs/*.md`"* · drop the "three independent routes"
overclaim (typo and nonexistent-surface share ONE `not s.exists()` branch).
★★★ **DIRECTORY-SYMLINK STAYS `UNKNOWN` — do not turn a handler read into an
executed result. Worth ONE attempt via `cmd /c mklink /J` (a junction is not a
symlink and often needs no elevation); if that fails it stays `[NOT EXECUTED]`.**
**FILES:** `absence_claim_control.py` · `absence-fixtures/` · `AGENT-REPORTS.md`.
**`c8_provenance_ledger.py` is graded SOUND — DO NOT TOUCH.**

**QUEUED, CONTRACT ALREADY WRITTEN, NO ROUND-TRIP:** R-474 §5 Item 2 — revise the
Gate-B packet against R-474 §2's six requirements. ★★★ **First concrete act: OPEN
the four `entry_conditions` consumers (`spec-timeframe-recovery.ts`,
`playbook-registration.ts`, `spec-archetype-matcher.ts`, `spec-family-bindings.ts`)
— AR-473 NAMED them and never opened them, and that is exactly how the design break
survived its packet. `BEFORE REMOVING A FIELD, ASK WHO READS IT — AND OPEN THAT
FILE, DO NOT NAME IT.`**
★★★★★ **GATE B REMAINS BLOCKED. Nothing here opens it.**

## ★★★★★ [FACT, MEASURED, NOT RULED] `0b0d6617` — THE COMMIT'S OWN INVARIANT IS THE WRONG ONE FOR THIS QUESTION

**Desk obligation (2) advanced from `[UNMEASURED]` to a SHARP NAMED QUESTION. No
disposition, no severity — this is measurement only.**
★★★ **[MEASURED HERE] `0b0d6617` = *"spine is not source-mandatory — record
UNKNOWN_REQUIREDNESS"*. It removes `spine` from `_MANDATORY_ROLES`
(`spec_execution_preflight.py:94`), so every `spine` condition now falls to the
else-arm and RECORDS `UNKNOWN_REQUIREDNESS` instead of `MANDATORY`.**
★★★★★ **[MEASURED HERE, at the executable line, `:164-170`] its central claim
HOLDS: `def blocks_execution(rule_class): return rule_class in (MANDATORY,
UNKNOWN_REQUIREDNESS)`. Both classes block. **THE REFUSAL SET DOES NOT MOVE**, and
the commit pins that in CI as a SET comparison with a control.**
★★★★★ **AND THAT IS NOT THE QUESTION. `C8` IS NOT A REFUSAL SET — IT IS A
REMEDIATION CLASS OVER REFUSAL *ROWS*, AND [MEASURED, AR-460] THOSE ROWS CARRY A
`rule_class` FIELD, WHICH THIS COMMIT CHANGES FOR EVERY `spine` CONDITION. The
frozen taxonomy contains a class literally named `C6_unknown_requiredness`. So the
same rows, unchanged in membership, can carry DIFFERENT class values into the
remediation classifier — and a row moving `C8 → C6` changes the C8 count WITHOUT
moving the refusal set.**
★★★★★ **`A LAYER-SCOPED PROOF IS SCOPED TO ITS LAYER.` The commit proves invariance
at the REFUSAL layer and is silent at the CLASSIFICATION layer; its CI pin cannot
answer the C8 question and must not be cited as if it did. **REFUSAL-SET INVARIANCE
IS NECESSARY, NOT SUFFICIENT.**
★★★ **THE QUESTION, NOW EXACT AND STILL `[UNMEASURED]`: IS THE REMEDIATION
CLASSIFICATION A FUNCTION OF `rule_class`?** [MEASURED HERE] the classifier is NOT
in the census lane — `grep` for `C6_unknown_requiredness|remediation_class|
C8_ANNOTATION` over `wt-preflight-blockers-20260729` returns **nothing**, so it is
not cheaply reachable and I did not invent an answer. ★★ **If it IS a function of
`rule_class`, the CONTROL arm is not the frozen control and the ablation cannot
start. If the classification is a human JUDGMENT over rows (as R-451 recorded —
"the remediation-class assignments themselves: JUDGMENT, never re-graded"), then a
re-run census presents CHANGED INPUTS to that judgment, which is a different
problem and not a smaller one.**

## ★★★★★ THE DESK'S OWN OPEN OBLIGATION — DO NOT LET THIS LAPSE AGAIN
**FREEZE THE GENUINE-SURVIVOR TRUTH SET (R-474 §4).** Mine, not the worker's, not
"a fresh session". **Keyed to `(video, transcript hash, exact span, exact-slice
hash)` — NEVER to mutable `condition_id`, which [MEASURED] collapses `455 → 359`
and merges `96` rows.** Must span FIVE cases: genuine session predicates ·
descriptive session context · instrument/timeframe context · **mixed clauses** ·
**ambiguous cases**. ★★★★★ **FROZEN BEFORE ANY TREATMENT RESULT EXISTS — a
survivor set chosen after seeing the outcome is a rationalisation, not a
pre-registration.** The worker may enumerate candidates; the desk freezes labels.
★★★★★ **SEATS — CORRECTED BY R-476 AFTER THIS DESK INVERTED THEM. [MEASURED HERE
by walking UP from a shell's own `$PID`, which is the ONLY test that answers it]:**
- **`claude.exe 15908`** (since `18:26`) — ★★★★★ **THE WORKER. NOT relieved. R-475 §5
  IS ITS TASK.** The "new worker" is a **NEW CONVERSATION IN THIS SAME PROCESS**
  (operator-confirmed), which is why its ear kept working.
- **`claude.exe 23988`** (since `22:22:48`) — **THE ADVISOR. ME.** Created by my own
  crash-restart, NOT by a worker being seated.

★★★★★ **R-475 §4 SAID THE OPPOSITE OF BOTH LINES: it called `23988` "the seated
worker" and RELIEVED `15908`. I ADDRESSED THE TASK TO MYSELF AND STOOD DOWN THE ONLY
SEAT THAT COULD DO IT — a ruling that authorizes nobody. STRUCK BY R-476; its "EAR
HAZARD" is WITHDRAWN ENTIRELY as an artefact of the same inversion.**
★★★★★ **THE LAW: `A PROCESS LIST TELLS YOU WHAT EXISTS, NEVER WHICH ONE YOU ARE.`
Walk up from `$PID` to the owning `claude.exe`. **AND: `YOUR OWN PID IS AN
IDENTIFIER WHOSE DECAY YOU MUST WRITE DOWN TOO`** — I measured mine correctly at
`17812` earlier tonight, reused it across a crash, and mistook my own restart for
someone else's arrival. R-465 minted that law for MONITOR pids and R-474 extended it
to GRADER ids; I applied it to neither when the identifier was my own.**
★★★ **AND THE TELL I IGNORED: I observed "the new seat has not armed an ear" and
built a hazard section on it. **A seat that has existed for zero minutes and armed
nothing is more likely a fresh instance of the OBSERVER than a worker** — I wrote
the anomaly down and reasoned forward instead of doubting the premise.**
★★ **STILL TRUE AND WORTH KEEPING, from the withdrawn block: `A DECLARED HANDOFF IS
NOT A DEAD PROCESS, AND A LIVE PROCESS IS NOT A SEATED WORKER` — the discriminator
is a START-RECEIPT, never a process list.**
★★★★★ **A CORRECTION AGAINST THIS DESK, MADE BEFORE IT COULD COST ANYTHING: the
first draft of this block said `HANDED OFF at a clean boundary`. AR-471 §4 says no
such thing — it says *"IF the follow-up grade returns further repairs, a FRESH SEAT
is the cheaper and safer executor"*, a CONDITIONAL RECOMMENDATION, and it ends
*"Next smallest task — ONE: the follow-up grade."* **I READ A RECOMMENDATION AS A
DECLARATION AND NEARLY LEFT A LIVE WORKER RECORDED AS GONE.** A later seat reading
`HANDED OFF` would have gone looking for a fresh worker instead of dispatching to
the one sitting there with its ear on. `A RECOMMENDATION IS NOT A DECLARATION` —
and the discriminator is the process table plus the conversation file, never the
report's tone.**
★★★ **ITS OWN DISPOSITION, [RELAYED]: nothing half-done, everything committed, no
fixture pending, no sub-agent dispatched or owed.**

**AR-471 delivers R-472 §1–§4 in full, and the desk has verified the CONTAINMENT
itself:** [MEASURED HERE] `git show --stat 138f26e9` touches exactly five paths —
`absence_claim_control.py` · `absence-fixtures/undecodable.ts` ·
`c8_provenance_ledger.py` · `C8-PROVENANCE-LEDGER-2026-07-29.md` ·
`AGENT-REPORTS.md` — **nothing outside R-472's allowed file list**, net
`+359/−382` (the guard SHRANK). ★★ **Everything else in AR-471 is CLAIMED, NOT
ESTABLISHED, and is with the grader.**

★★★★★ **GATE B REMAINS BLOCKED until the follow-up grade is sound.**

## ★★★★★ THE GRADE ROUTE CHANGED AGAIN, ON A MEASUREMENT — AND A NEW LAW CAME WITH IT

**R-472 §6 ordered: return the repair to the EXISTING validator
`a858339f7a6a7cfb8` via `SendMessage`, DO NOT dispatch a third grader
(`ONE RIG PER CHANNEL` applied to graders).** ★★★★★ **[MEASURED HERE] THAT ROUTE
DOES NOT EXIST FROM THIS SEAT: `SendMessage` → `No transcript found for agent ID:
a858339f7a6a7cfb8`.**
★★★★★ **AND THE ERROR STRING IS FALSE, WHICH IS WHY A CONTROL WAS RUN BEFORE
ACTING ON IT. [MEASURED HERE] the transcript EXISTS —
`…/projects/C--Users-tonio-Projects-trading-forge/0f4ff6ee-31eb-47c9-ac2e-934a16ad2b95/subagents/agent-a858339f7a6a7cfb8.jsonl`,
`484,089` bytes. POSITIVE CONTROL: the first grader `a5a70a93c66262a61` is present
in the same directory. The session UUID `0f4ff6ee…` is NOT this session
(`c4b1e324…`).**
★★★★★ **THE LAW: `AGENT RESUMPTION IS SESSION-SCOPED. A GRADER IS NOT A DURABLE
ADDRESS.` "No transcript found" means NOT REACHABLE FROM HERE, not NOT EXISTING —
publishing the second would have been `I MEASURED THE NEIGHBOURING OBJECT` for the
ninth time, this time measuring REACHABILITY and reporting EXISTENCE.**
★★★ **THIS IS R-465's MONITOR LAW, ARRIVING AT GRADERS: `AN IDENTIFIER IN A STATE
FILE IS A MEASUREMENT WHOSE DECAY NOBODY WROTE DOWN.` R-472 §6 built a routing
method on an identifier whose decay nobody wrote down. **STORE THE ROUTE'S
PRECONDITION, NOT THE ID: a grader is resumable only from the session that spawned
it; across a session boundary you must re-dispatch and CARRY THE HISTORY IN THE
BRIEF.**
★★★★★ **DECISION TAKEN, AND IT IS THE DESK'S TO TAKE (tooling/grading, reversible,
no capital): R-472 §6's ORDER IS VOID BECAUSE ITS PREMISE IS FALSE. Its PURPOSE —
a grade continuous with the one that found F-1/F-2 — is served instead by carrying
F-1, F-2 and F-3 VERBATIM into a fresh brief. `ONE RIG PER CHANNEL` is NOT
violated: the old grader is unreachable, so exactly ONE grader is live.** ★★★ **The
alternative — holding Gate B blocked waiting for a route that cannot open — is the
stall this campaign convicts.**
★★★ **GRADE REGISTER (name the agent id, never "a grade was obtained"):**
`a5a70a93c66262a61` = `SOUND-WITH-GAPS`, ran against the **PRE-REPAIR** bundle,
certifies NEITHER the rebuild NOR any repair · `a858339f7a6a7cfb8` = `NOT-SOUND`
on the AR-469 guard, **UNREACHABLE from this session** · ★★★★★ **`afc644b1bbcb0c742`
= `NOT-SOUND` on `138f26e9`, DELIVERED — it found F-1 (enumeration silently drops
members) and the advisor reproduced it independently · ★★★★★ **`a4458cbae40c54ec3`
= DISPATCHED 22:14 against `8838183f` and **STOPPED WITH NO COMPLETION RECORD —
IT RETURNED NO VERDICT. IT CERTIFIES NOTHING.** ★★★★★ **AND IT SHOULD NOT HAVE
BEEN SENT: the external read then ordered no grade against `8838183f` because a
known defect made it wasteful. IT WAS RIGHT AND I HAD ALREADY DISPATCHED. No
wasted grade landed only because the agent died — BY LUCK, NOT JUDGMENT.
`A PRE-REGISTERED TRIGGER FIRES ON ITS CONDITION, NOT ON THE ARTIFACT BEING WORTH
THE WORK`, and R-474's trigger carried no is-this-worth-grading test.**
★★★ **NEXT GRADE: the read orders returning to `afc644b1bbcb0c742`. Unlike
`a858339f7a6a7cfb8` (prior session, unreachable) that agent was dispatched from
THIS session, so resumption MAY work — `[UNVERIFIED]`, TEST THE ROUTE BEFORE ANY
RULING DEPENDS ON IT. `A GRADER IS NOT A DURABLE ADDRESS.`**
Superseded register entry follows, kept for the trail: it was dispatched 21:26.
Carries F-1, F-2, F-3, the four-round history and the prior grade's
CONFIRMED-SOUND list so none of it is re-litigated, plus all eight attack items.
NO RULING MAY SAY THE GRADE WAS OBTAINED UNTIL A RULING NAMES THIS ID AND
CONSUMES ITS VERDICT.**

## ★★★★★ THE FALSE-POSITIVE LANE — CLOSED BY RETIREMENT, NOT BY REPAIR (R-472)

**`docs/replay-results/h1-battery/absence_claim_control.py`.** Four repair rounds,
each closing every named shape with a green suite, each followed by a NEW unnamed
shape. **A FIFTH PATCH ROUND IS FORBIDDEN.**
- **`--module/--symbol` → `VERDICT UNAVAILABLE — CAPABILITY MODE RETIRED`, exit
  `8`.** The CLI survives only as a fail-safe so an old command line cannot
  silently mean something new.
- **`--pattern` survives certifying EXACTLY ONE proposition:** *"this literal
  pattern was PRESENT / ABSENT over this explicitly enumerated surface."*
  ★★★★★ **IT MAY NEVER BE CITED AS PROOF THAT A CAPABILITY OR PERSISTENCE PATH
  EXISTS OR DOES NOT EXIST. Every absence claim that cited capability mode is
  `[VOID]`.**
- ★★ **A TypeScript-compiler-API + type-checker instrument is the RIGHT tool for
  the semantic question and is deliberately NOT AUTHORIZED. Gate A does not need
  it; building it now would be the fifth round in a better hat.**

★★★★★ **THE LAW THAT DIAGNOSED ALL FOUR ROUNDS AT ONCE: `A FAIL-CLOSED CLASSIFIER
IS NOT FAIL-CLOSED WHEN ONLY ITS CONTROL MUST BE DECIDABLE. SURFACE-WIDE ABSENCE
REQUIRES SURFACE-WIDE DECIDABILITY.` [MEASURED] a 2-file surface — one
`UNDECIDABLE`, one `ENGAGED` — returned `CONTROL ENGAGED` / absence `ADMISSIBLE` /
exit `0`, certifying absence over a file it had just said it could not read.
**CHECK THE QUANTIFIER OF THE CLAIM AGAINST THE QUANTIFIER OF THE EVIDENCE.**
★★★★★ **AND: `WHEN EVERY REPAIR ROUND CLOSES ITS NAMED SHAPES AND A NEW UNNAMED
SHAPE APPEARS, THE APPROACH IS WRONG, NOT THE CODE.`**
★★★★★ **AND THE THREE THAT PRECEDED IT, ALL STILL BINDING:**
`ISOLATED FIXTURES DO NOT ESTABLISH CLOSURE UNDER COMPOSITION` — nine fixtures each
passed and a PAIR of them greened · **`REGISTERED-FIXTURE CLOSURE ESTABLISHES
NOTHING ABOUT UNREGISTERED SHAPES`** — `17/17` passed while both convicting defects
lived outside the registered set · `PROVING PRESENCE IS NOT PROVING USE` — any "is
X used" check must EXCLUDE the site that DECLARES X · `A GUARD INHERITS EVERY
WEAKNESS OF THE METHOD IT AUTOMATES` — automating a grep does not make it sound, it
makes it authoritative.
★★★ **≥2 COMPOSED FIXTURES are required for any guard that ANDs two signals.**

## ★★★★★ WHERE GATE A ACTUALLY STANDS — SUBSTANTIVELY LOCATED, PROCEDURALLY OPEN

★★★★★ **ROOT CAUSE FOUND, MECHANISTIC NOT INFERRED: [MEASURED] the STAMPED PRODUCER
`tf-deep-scan` @ `dc8a150`, `scripts/atomize-transcript.ts:60` reads verbatim —**
`"we trade this on crude oil" / "we're sitting on the 30-minute chart today"  -> YES (WAIT_SESSION — execution context: removing it changes what the engine runs on)`
★★★★★ **THE ADMISSION CONTRACT CONFLATES *"changes run configuration"* WITH *"is an
entry predicate"*. `WAIT_SESSION` occurs `3`× in the producer, `1`× in the
census-lane copy. `:61` shows the same author drawing the boundary CORRECTLY one
line later (*"a price LEVEL, never WAIT_SESSION"*) — DESIGN DEFECT, NOT A TYPO.**
★★★ **C8 SPLIT, BINDING: `232` `C8-ANNOTATION` → **ATOM-ADMISSION** boundary ·
`1` `C8-EMPTY-SPINE` (`75DJN5UVQnw`, `condition_id=""` hardcoded at
`spec_execution_preflight.py:293-307`) → **PREFLIGHT safety path, FAIL-CLOSED, MUST
NOT BE "FIXED AWAY"**, and it belongs to a distance-0 target video so a global
remedy would have hit a spearhead candidate first. **NO GLOBAL C8 REMEDY.**
★★★ **CLOSED ON TWO INDEPENDENT PATHS: DB↔disk freshness — `120` rows · `40`
videos · `spec_hash` `120/120` · `graph_canonical_hash` `40/40` · `strategy_id` set
`0` drift.**
★★★ **ENTAILMENT MEASURED AT BOTH HOPS: atom creation gated on `is_decision`
(`dc8a150:112`); conditions built ONLY inside `for (const a of sourceAtoms)`
(`graph-to-engine.ts:76`, all pushes inside). Backfill `895ce11e` diffed — metadata
only, NO backfill wrote conditions.**
★★ **`prompt_sha256` PROVEN NON-AUTHORITATIVE as a runtime fingerprint: the
UNEVALUATED template source hashes `c75a2da8…` (= the stamp); the EVALUATED string
hashes `3edc1167…`. Template literals evaluate eagerly, so a real emitter can only
hash the evaluated form ⇒ the stamp can only be a static source-text hash.
`[CORROBORATED, NOT PROVEN]` on producer identity still stands.**
★★★★★ **GATE A TOTALS, THE THING THAT MUST SURVIVE EVERYTHING: `456 / 233 / 232 /
1`. Its substantive finding is INTACT and UNCONTAMINATED by the guard saga — it
rests on POSITIVE producer and artifact evidence (the `:60` instruction, the
`455/456` join, `232/232` span+evidence+type, the two-hop entailment, DB↔disk
equality on two paths), NEVER on the generic absence guard.**
★★★★★ **GATE B DESIGN IS FIXED: three-way contract
`decision_condition | execution_context | annotation`, **DETERMINISTIC NOT
PROMPT-ONLY** (a prompt edit is a request, not a fix). Instrument/chart-timeframe →
RETAINED METADATA (it genuinely configures the run) · genuine market-session
predicates stay EXECUTABLE · empty-spine refusal UNTOUCHED.**
★★ **PRE-REGISTERED TRAP (R-466 §2) GOVERNS: conditions-per-strategy WILL DROP and
that is the fix working; a HIGHER count is FAILURE; every pre-registered genuine
market-state condition must SURVIVE. FIDELITY OUTRANKS COUNT.**
★★ **CARRIED OBLIGATION: any Gate-B treatment must be re-verified against
`runtime-production` AT ITS THEN-CURRENT COMMIT — lane equivalence NO LONGER HOLDS.**

## ★★★★★ THE JOIN-KEY CONTRACT — THREE-WAY, ARTIFACT-SCOPED

- collapsed per-video **classified** artifact → canonical spec: **`(video, condition_id)`** — [MEASURED] `455` distinct, max mult `1` — **ADMISSIBLE**
- raw 120-row **census** → persisted refusal: **`(strategy_id, condition_id)`** — [MEASURED] `1368` distinct, max mult `1` — **ADMISSIBLE**
- **`condition_id` ALONE: INADMISSIBLE EVERYWHERE** — [MEASURED] collapses `455 → 359`, `32` duplicated, merges `96` rows, max multiplicity `28`
- **`(video, condition_id)` on the CENSUS payload: INADMISSIBLE** — [MEASURED] `{3: 456}`, fuses the `_mcl_`/`_mes_`/`_mnq_` triple, and `1368/3 = 456` is the number a reader EXPECTS, so the table BALANCES while three market copies are silently merged

★★★★★ **`A KEY'S SAFETY IS A PROPERTY OF THE ARTIFACT, NOT OF THE KEY.` R-467
permitted `(video, condition_id)` universally (too loose); R-468/469 forbade it
universally (too strict — it is the RIGHT key for classified→spec). Both wrong the
same way. **NEVER NAME A JOIN KEY WITHOUT THE ARTIFACT IT IS ADMISSIBLE ON.**
★★★ **AND `A COUNT IS NOT A PIN`: pinning a spec set by COUNT, or transcripts by
COUNT + AGGREGATE BYTES, is satisfied by ANY same-sized substitution.**

## THE PLAN — money-path ladder (**BLUEPRINT v4, ADOPTED R-445**)

★★★★★ **v4 IS THE OPERATIVE PLAN. CANONICAL TEXT:
`docs/designs/BLUEPRINT-V4-DRAFT.md` (rev 2, `161f11dc`) — red-teamed by
`accuracy-validator`, F1–F9 resolved.**
★★★★★ **CARRIER DISCIPLINE (v4 §2.5): duplicate the LADDER VERBATIM, POINT at the
blueprint for detail, NEVER re-paraphrase — paraphrase eroded this block twice
(three of five upgrades lost 2026-07-28; the fourth attribution bin lost
2026-07-29).**

- **Phase 1 — SPEC COMPILATION (WE ARE HERE).** Exit: ≥1 tier-A spec compiles with
  ALL load-bearing conditions concretely bound AND the compile-fidelity forensics
  gate passes calibration. Pinned before-figure (R-401, cite exactly): `0/16 specs
  fully bound. Flags-off: 0 of 155 bound_and_concrete. Flags-on hypothetical: 6 of
  155. Source: dual-denominator-remeasure-2026-07-21.json, frozen, refresh BLOCKED
  by REVIVAL_FAMILY.` ★★★ **R-409: NOT exitable on corpus_A; dies at BINDING.**
- **Phase 2 — BATTERY / WAVE.** ★★★★★ **v3-1 FAILURE-ATTRIBUTION READ — FOUR BINS**,
  pre-registered before any verdict is interpreted: **{edge-absent ·
  compile-fidelity-loss (approximation residue) · OVERLAY-CONFLICT (house exits vs
  taught-exit edge) · `gate-artifact`}** — [MEASURED, R-061 §1 verbatim; locate with
  `grep -n "^## R-061"`]. ★★★ **`gate-artifact` = "the instrument lied", dropped
  from both carriers until v4 caught it, and it is the MODAL real failure.**
  ★ **v3-2 OVERLAY A/B**, taught-exit specs ONLY: pre-registered dual-arm, house
  Style-C vs taught exits. ★★ **Trials counted honestly — "effective-N tuples
  distinguish arms" (R-061 §2 verbatim), the anti-double-count law.**
  ★★ **Phase-2 ENTRY checklist (v4 §4) incl. BATTERY-RIG NULL-CALIBRATION: the rig
  has never fired (`backtests = 0`) and must go RED on a planted defect first. A
  rig that has never gone red is not an instrument.**
- **Phase 3 — CONVEYOR, not a queue.** Internal-paper + shadow-accumulation
  CONCURRENT per strategy. ★ **v3-3 EVAL-ODDS PRE-COMPUTE** at pre-flight: aim
  B14/survival at the EVAL's own parameters → per-attempt pass probability BEFORE
  spending an eval.
- **Phase 3→4 — ★ v3-4 DEPLOY-IN-SEASON.** Survivors deploy only when their
  forensics-named regime is LIVE; out-of-season survivors hold in paper standby.
- **Phase 3.5 — FIRST THIRTY FUNDED DAYS**, written BEFORE funding. Payout cadence
  under 20/80 reserve; advisor recommendation on record = CONSISTENCY lane.
  ★★ **v3-5 STOP-GATES SYMMETRIC TO GO-GATES:** eval failed 2× → attribution loop,
  NEVER a blind retry · funded loss-streak → pre-written post-mortem before redeploy.
- **PRE-POSITIONED LAST MILE (operator spend):** when the first real-fidelity wave
  shows promise, brief the operator to buy Combine + TopstepX API THEN (R-060).

★ **v4 §2.4: `v3-N` tags exist only in the carriers, never in the ledger. A ledger
grep for `v3-` returning zero is EXPECTED.** Duplicate in `advisor-onboarding` §1a.

## ★★★★★ WHERE WE ACTUALLY ARE (R-466 PIVOT) — READ BEFORE ANY GOVERNANCE ITEM

★★★★★ **PHASE 1, SPEC COMPILATION. THE HOUSEKEEPING LANE IS CLOSED AND PARKED.**
★★★★★ **POPULATIONS — v4 §0 SAYS *NEVER MERGE THEM*, AND THIS DESK DID: `0/16 FULLY
BOUND` IS **corpus_A** (16 specs, R-401). C8's `51.1%` AND THE 40-VIDEO RANKING ARE
**POP-120-LIVE** (120 rows = 40 videos × 3). tier-A/spearhead is a THIRD population
(11 specs, 53 load-bearing conditions). ★★★ THE OVERLAP MAP IS FORMALLY
`[UNENUMERATED]` — any sentence joining a corpus_A figure to a POP-120 figure is a
CLAIM ABOUT AN OVERLAP NOBODY HAS MEASURED.**
★★★★★ **THE HONEST C8 CLAIM: *"C8 is the only single remediation class that makes
any POP-120 videos refusal-clean."* **NOT** *"C8 alone produces a Phase-1-exitable
strategy."* [EXTERNAL, UNVERIFIED HERE] the two distance-0 videos still carry
executed APPROXIMATE bindings — `75DJN5UVQnw` 7, `jlShztsY3oA` 4. REFUSAL-CLEAN IS
NOT BOUND-AND-CONCRETE, and the refusal-only rank MUST NOT be the target selector.**
★★★★★ **SUCCESS DEFINITION, AND NOTHING ELSE COUNTS: ONE newly extracted TIER-A
spec, IN THE AUTHORITATIVE EXECUTION LANE, EVERY load-bearing condition CONCRETE,
FORENSICS GATE CALIBRATED. A lower C8 count is NOT success.**

## v4 §3-1B — THE C8 SLICE, DELIVERED AND RULED (R-451)

★★★ **37 videos IN · 3 EXCLUDED BY NAME** — `N7uP9V0Iktc` · `ktkqq7QsN9Q` ·
`1HFoStW_wsc` (carry NO C8 refusal, so the fix moves nothing). **Retained in the
library for separate remediation; re-entry ONLY via a new measured ranking.**
★★ **The MANIFEST — by ID, never the count — is authoritative.**
**Distance histogram `{0:2, 1:8, 2:8, 3:9, 4:8, 5:5}` = 40.** Distance-0 =
`75DJN5UVQnw` (5 C8, 0 residual) · `jlShztsY3oA` (1 C8, 0 residual).
★★★★★ **`UNLOCKED ≠ TRADE-READY`, MEASURED not hedged: of `2351` bindings, `943`
are `approximation=False`; their primitives are `496` ALL FRAMEWORK-OWNED
(`spine_completion_trigger` 245 · `structural_stops` 224 · `provenance_only` 27)
plus `447` WITH NO PRIMITIVE AT ALL. NOT ONE IS A TAUGHT DETECTOR.
`75DJN5UVQnw` has `executable_spine_count = 0`.** `distance 0` = PREFLIGHT-CLEAN
only — never source-exact, bound, Phase-1-complete, profitable, backtest-qualified,
paper- or live-ready. **NEVER "two working strategies". THE RANKING AUTHORIZES NO
BACKTEST.**
★★★ **SMC PREDICTION WITHDRAWN ON MEASUREMENT: v4 predicted the SMC spec at
distance-0; `bos_and_fvg_or_fvg` (`E8Wg6tFPYjo`) measures `1` (needs +C5). DO NOT
ROUND IT UP.**
★★★★★ **`gen_ledger.py` RETIRED FROM DECISION USE: [MEASURED] it reproduces its OWN
published chain in `4 of 12` runs — a tie at step 4 resolved by Python's per-process
`str` hash randomisation. THE PUBLISHED NUMBER WAS THE OPTIMUM BY LUCK.** The result
is independently re-derived as the exhaustive optimum at all nine k; the
deterministic ranker is authoritative for all future ranking.

## CAMPAIGN LAW ADOPTED FROM EXTERNAL READS (R-455 §3–§4) — BINDING

**(i) CAPITAL-SAFE VALIDATION** — "affirmatively exercised" means REPLAY / PRACTICE
/ SANDBOX / DRY-RUN. **NEVER deliberately create a funded loss, drawdown event,
firm-rule breach or invalid payout request to prove a guard.** No permitted test
path ⇒ record `UNEXERCISABLE`.
**(ii) INDEPENDENCE IS LAYER-SCOPED** — "the VIDEO is the independence unit" is TRUE
FOR EXTRACTION/REFUSAL ONLY. Overlay A/B = paired `strategy × market ×
untouched-OOS-window` tuples. Performance = dependence-adjusted trades / sessions /
walk-forward windows.
**(iii) A FIFTH ATTRIBUTION OUTCOME `UNRESOLVED / MIXED`** outside the four bins —
prefer "edge NOT DETECTED at pre-registered power" over "no edge". Pin the Phase-2
power floor BEFORE the wave; publish no per-class conclusion until it exists.
**(iv) ANTI-OVERFITTING ON THE NO-SURVIVOR ROUTE:** retry budget · data-spending
ledger · correctness fixes SOURCE-JUSTIFIED never performance-selected · fresh
untouched OOS before promotion after any adaptive change.
**(v) PHASE-3 SHADOW FLOOR:** ~20 signals is a SMOKE/PARITY floor, NOT performance
evidence. Also requires parity bands, calendar + regime coverage, dependence-aware
uncertainty.
**(vi) DEPLOY-IN-SEASON CONTRACT:** pre-register eligible regimes · shadow-validate
the classifier · stale/unknown = FAIL-CLOSED · transition hysteresis · ★ **THE
REGIME MAY NOT BE NAMED AFTER OBSERVING FAVOURABLE LIVE PERFORMANCE.**
**(vii) UNIT-ECONOMICS GATE:** before ANY horizontal scaling, a PER-ACCOUNT
economics packet showing net profit after commissions, slippage, fees, payout
splits, reserve mechanics and drawdown. **Multiplying an unproven unit multiplies
losses.** ★ `50 micros` NEVER overrides lowest-wins sizing.
★★★★★ **AND THE REFUTATION THAT CAME WITH THEM: an external read asserted "the
workspace contract explicitly says NO multi-account scaling". [MEASURED] NO SUCH
DOCUMENT EXISTS — `CLAUDE.md:15` says growth is "primarily HORIZONTAL (multiple
Topstep accounts + copy-trade)", `:16` makes it LEVER 2 OF 4, `:412` "Multi-account
within one user: ALLOWED". **v4 §8 STANDS. A CONFIDENT SOURCE CITING A DOCUMENT
THAT DOES NOT EXIST IS THE MOST DANGEROUS INPUT A DESK RECEIVES — OPEN THE ARTIFACT
IT CITES.**

## QUEUE (next 4, in order)

1. ★★★★★ **v4 §3-1A — THE SEVEN C8 PREREQUISITES.** #2 (two-arm ablation
   pre-registration) and #3 (name `accuracy-validator`) are **DISCHARGED in R-466**.
   **#1, #4–#7 remain the worker's and are OPEN.** ★★ **#1 = the ≥3-quota consumer
   census: compute the TRANSITIVE CLOSURE, not the grep; publish surfaces AND
   exclusions.** ★★★ **A prerequisite assigned to nobody is a stall order.**
2. **v4 §3-1E — LANE AUTHORITY (R-415)**, pulled EARLIER than the corpus_B binding
   measurement. This desk rules which binding lane is authoritative **on COMPILER
   CORRECTNESS, never on which lane produces better numbers.**
3. **Advisor-owned, parallel, cheap:** the `C2` session-role resolver yield (a
   post-C8 multiplier) · maintain `STRANDED-CAPABILITY-REGISTER.md`.
4. **Semantic-role-classifier migration (HOLDOUT-26 two-arm shadow, R-434/435) —
   v4 §9 puts it OFF the Phase-1 critical path and NEVER a Phase-2 gate.** The
   frozen rubric stays advisor-owned and unspent.

## PARKED — MAY NOT PRE-EMPT THE MONEY PATH UNLESS IT INVALIDATES C8 EVIDENCE

partition-generator hardening (R-463 §5) · heartbeat/expiring-lease engineering
(R-465) · off-machine encrypted backup (**OPERATOR**) · wider bug-pattern sweeps ·
a committed prompt-hash verifier.
★★★ **THE LESSON THAT PUT THEM HERE: a governance audit that keeps finding
governance work RECURSIVELY REPLACES THE MONEY PATH, and it does not feel like
drift — every item was real. The operator had to say "remember back to the plan."
v4 §9's bound existed; this desk did not apply it to itself.**

## FIDELITY LEDGER — AUTHORITATIVE; THE AGGREGATE IS SUBORDINATE (R-447)

**"UNLOCKED" ≠ "EXACT".** Flag yield is **`0 → 10` in `runtime-production`** (the
executing lane — cite that pair); the campaign lane reads `1 → 11`; **Δ = +10 in
BOTH.**

| spec | n | class |
|---|---:|---|
| `WEhm…__s0` | 2 | **SOURCE-DEFINED EXACT** (teacher defined wick-to-wick = the primitive) |
| `-igp…__s0` | 4 | **SOURCE-DEFINED MISMATCH** (teacher close→open; primitive high/low; **STRICTER**) |
| `CLDE…__s0` | 3 | **CANONICAL DEFAULT** (teacher never defined the term) |
| `kFyD…__s0` | 1 | **CANONICAL DEFAULT** |
| — | 0 | **UNVERIFIED** |

★★★★★ **NO SPEC IS IN THE DANGEROUS DIRECTION (primitive LOOSER than teacher, which
manufactures trades the teacher never sanctioned). Every deviation runs
CONSERVATIVE.** ★★★ **FIDELITY IS A PROPERTY OF THE PAIR (primitive, spec), NOT OF
THE PRIMITIVE — one `compute_fvg_signal`, three truths.**
★★★ **REPORTING LAW: always separate `newly bindable` · `source-defined exact` ·
`canonical-default` · `conservatively mismatched` · `unsafe/unresolved`. The
headline MAY say "10 newly bindable"; it MAY NOT say "10 exact" — only 2 are.**
★★★★★ **THE `1` IS NOT A PHANTOM: [MEASURED, AR-377] a REAL row
(`W7nlnHTUZQU__s0 [6] prim=session_windows apx=False`) present in the campaign lane,
ABSENT in the executing lane — `spec_family_bindings.py` 160,049 B vs 35,046 B.
SUPERSEDED and TREE-KEYED, NOT DELETED: it anchors the R-415 gate. THE FIX FOR A
NUMBER MEASURED IN THE WRONG TREE IS TO KEY IT TO ITS TREE.**

## POPULATIONS — PERMANENT

**`DEV-14`** — contaminated (13 of 14 straddle its own row-hashed "held-out" split:
GROUP LEAKAGE). Fixtures/debug/controls only, **never the independent claim**.
**`HOLDOUT-26`** — the valid internal holdout, **spent the moment it is used to
tune**; the `HOLDOUT-26` list in `SEMANTIC-ROLE-MIGRATION-PACKET-2026-07-29.md` is
VERIFIED SOUND and MAY govern tuning. ★★★ **NEVER averaged into one headline. Split
by SOURCE VIDEO ID, never by row — the VIDEO is the independent unit.** Success =
semantic fidelity, **NEVER pass-count**. ★★ Fail-closed: no evidence →
`CLASSIFICATION_UNAVAILABLE`; labeller error → `CLASSIFICATION_ERROR`. **Legacy
fallback may be MEASURED, never presented as a semantic decision.** ★★★ **Rule
expansion FORBIDDEN until a fresh untouched population is named FIRST.**

## NOT AUTHORIZED

★★★ **Relaxing ANY refusal class — including `spine` — before a validated
type-keyed replacement exists. This migration can only ADD refusals.**
`C8` implementation (HELD on prerequisites) · re-extraction · re-running the census ·
writing classifications to the DB · tuning the labeller on `HOLDOUT-26` · flipping
`TF_SEMANTIC_ROLE_CLASSIFIER` · promoting `trigger` · remapping roles · mutating any
stored `compiled_spec` or role field · spec edits · `.env` writes ·
`runtime-production` writes · tower update · `db:generate` · editing applied
migrations · deploying the 160KB campaign lane (R-415) · removing
`continue-on-error` · `git checkout`/`reset`/index operations in this shared tree ·
**any change to the legitimate empty-spine refusal** · **a fifth semantic-regex
patch round** · **building the TypeScript-compiler instrument.**

## STATE, WITH EVIDENCE GRADES

**[MEASURED HERE]** `backtests total = 0` · `strategies = 120` · **no live
execution, no connected capital.** Tower `a6f92822`; both safety releases DEPLOYED
and verified in the running tree. **LANDED ≠ RUNNING.**
**[MEASURED HERE]** ★★★ **`role` IS TOPOLOGY, NOT SEMANTICS:**
`graph-to-engine.ts:93` `inAndGroup.has(a.id) ? "confluence" : "spine"` — reads
nothing from source. **`spine` WITHDRAWN as evidence of source-mandatory status**;
the join IS proven for `trigger` (`:141-142`). **PROVENANCE RULE: `spine +
unbindable` → still REFUSE, record `UNKNOWN_REQUIREDNESS`, NEVER "the source
required this."**
**[MEASURED HERE]** `POP-120-LIVE` = **40 videos × 3, triples byte-identical**; raw
counts inflate 3×; **sizing is ALWAYS per-video.** Refusal sets identical across
each triple (40 of 40).
**[MEASURED HERE]** 1458/1458 pointers resolve (100%); `'},{'` debris 28.5% resolves
to nothing; ≈71.5% source-gradeable. ★★ **A working chain is NOT a faithful
extraction** — `'timeframe'` resolves perfectly to a real sentence.
**[MEASURED HERE]** PRODUCTION DRIFT: `runtime-production` HEAD `9af37b8f` (census
manifest recorded `a6f92822`); 2 of 3 refusal-deciding files MOVED under commit
`0b0d6617` (UNKNOWN_REQUIREDNESS). **`MEASURED ≠ MEASURED-WHERE-IT-RUNS`.**
**[RELAYED]** HOLDOUT-26: rules fire on **4.1%**, `LEGACY_FALLBACK` **95.9%**.
**[RELAYED]** `C8` = 51.1% of blockage, the only class unlocking anything alone.
**OPEN INCIDENT — Python suite RED on Linux, REPORTS GREEN.** [MEASURED] the pytest
step exits `1` while the job shows `success` via `continue-on-error: true`; the tree
truncates at **44%**. ★★★ **`continue-on-error` STAYS until Linux is green — a
blocking gate over a red tree blocks every push.** ★★★ **STANDING: no ruling may
cite "CI green/red" as evidence about Python — cite a named suite, its command, and
its EXIT CODE.** Severity: governance, not trading-safety.
**[UNENUMERATED — OPEN]** the 20 span disagreements · non-flag-gated stranded
capability · C2 resolver yield · DB provenance preservation · timezone/calendar
basis · Python's unrun 56% · whether a C8 re-extraction ACTUALLY clears the refusals
it predicts (**1A's ablation to prove — never assume it**) · DB↔census refusal
FRESHNESS (distinct from spec freshness) · whether `0b0d6617` moves C8 · span
SEMANTIC correctness (`[UNPROVEN]` — addresses valid, invariant fails `232/232`
byte-exact) · the population OVERLAP MAP · original transcript identity
(`[UNRECOVERABLE AT ORIGIN]`) · the remediation-class assignments themselves
(**JUDGMENT, never re-graded**).

## TREES AND ARTIFACTS — NAME THESE IN EVERY COMMAND

- campaign relay tree: `C:/Users/tonio/Projects/wt-h1-wave4-20260712` (branch `h1-wave4-sealed12-driver`)
- ★★★★★ **`trading-forge/tf-deep-scan` IS A LINKED WORKTREE OF `trading-forge/trading-forge` — *NOT* ITS OWN REPO. THIS LINE SAID THE OPPOSITE IN BOLD FOR A DAY AND WAS CORRECTED BY AN OUTSIDE READER (R-474 §0).** [MEASURED HERE] `git -C tf-deep-scan rev-parse --git-dir` → `…/trading-forge/trading-forge/.git/worktrees/tf-deep-scan`; `--git-common-dir` → `…/trading-forge/trading-forge/.git`. **They DIFFER and git-dir is under `.git/worktrees/` — that is the discriminator.** ★★★★★ **`rev-parse --show-toplevel` CANNOT TELL THE DIFFERENCE — it returns the worktree root for both. Do not use it for this question.**
  - **THE SYMPTOM WAS RIGHT, THE MECHANISM WAS WRONG:** `git grep` from the campaign tree still cannot see it — because it is a different WORKING DIRECTORY, not a different object store. **THE COST OF THE WRONG MECHANISM: its objects ARE reachable from the main repo's store, so `git -C trading-forge/trading-forge log --all` / `cat-file` CAN read the producer's history. The desk denied itself that for a day.** `A WRONG MECHANISM GETS OBEYED.`
  - It holds `corpus/specs/` (40 specs, 2,351 conditions) and the producer at `dc8a150`. ★★★ **IT MAY NOT BE EDITED (R-474 §3): it is the producer of record, and Gate-B implementation goes in a NEW worktree pinned to `4f3b5cd075a15dab33e08d1c57340dd6a011141b`** — [MEASURED] that commit's tree carries BOTH `scripts/atomize-transcript.ts` and `src/server/lib/graph-to-engine.ts`.
  - ★★ **NAMING TRAP: the repo is `Projects/trading-forge/trading-forge` (INNER). `Projects/trading-forge` is the ~90-worktree CONTAINER and is not a repo — `git -C` against it returns `fatal: not a git repository`, which reads like a broken command rather than a category error.**
- census artifacts, OUTSIDE every git tree: `trading-forge/backups/h1-census/unknown-dbtime-ad4335f0/` (`pop120_classified.json` sha256 `eed65514a1…`, `pop120_census.json`)
- preserved transcripts: `trading-forge/backups/h1-shadow-eval/transcripts-78fe8ea7/transcripts/` — 40 files, `913,668` B
- preserved harness: `trading-forge/backups/h1-shadow-eval/shadow-eval-edaa0c14/` (`shadow.ts` = `16654d17…`, EQUALS the freeze document's own pin)
- census lane `C:/Users/tonio/Projects/wt-preflight-blockers-20260729` @ `83efd34e` · production `trading-forge/runtime-production` @ `9af37b8f`
- ★★★ **50 copies of `atomize-transcript.ts` exist at 4 on-disk sizes. The PRODUCER version is a GIT BLOB (`21,518` B) on NO disk — reachable only through `tf-deep-scan`'s history.**
- ★★★★★ **THE CAMPAIGN TREE'S OWN `.env` `DATABASE_URL` IS DEAD (`switchback…:36475`, connection refused). The live library is ONLY at `runtime-production/.env` (`sakura…:34357`). A DB check run from the campaign tree fails in a way that READS LIKE A RESULT.**
- ★★★ **THE CAMPAIGN TREE IS NOT A VALID LANE FOR A REFUSAL TRACE: it has `spec_family_bindings.py` at `160,049` B vs `40,583` in `runtime-production`, and NO `spec_execution_preflight.py` AT ALL.**

## KNOWN-BENIGN (do not investigate)

★★★★★ **FIVE INSTRUMENT LIES IN ONE SESSION, ALL THE DESK'S OWN, NONE A DEFECT IN
THE WORK UNDER REVIEW:** `| tail` masked a `gh` exit code · a scratch vitest config
resolved `vitest/config` from outside `node_modules` · a suite run in a tree lacking
the file (`No test files found`, exit 1 — would have reported a GREEN suite as RED) ·
`comm -23` under a locale mismatch reported 19-of-19 files missing when the truth is
ZERO · a probe whose stderr was swallowed with `2>/dev/null`. ★★★ **AN EXIT CODE IS
NOT A VERDICT UNTIL YOU KNOW WHAT PRODUCED IT. A SURPRISING RESULT IS AN ACCUSATION
AGAINST YOUR TOOLING FIRST.**
★★★★★ **LIVE CI FAILURE MODE (PR #33, intended): `vitest_report_malformed:
unrecognized assertion status (<name>=N)` is NOT a broken suite — a vitest upgrade
added a status value.** ★★★ **FIX SEQUENCE: identify → CONFIRM its meaning from the
producing tool → decide pass/fail/skip/todo/pending → add to `KNOWN_STATUSES` with
CORRECT comparison semantics → SHIP A FIXTURE. Never add a status merely to restore
a green lane.**
★★★ **THE 15-MIN IDLE-WATCHDOG BAR IS SHORTER THAN THE AUTHORIZED ETA, SO IT FIRES
ON HEALTHY RUNS. Do NOT widen it** — read the event and apply the discriminator.
★ **DISCRIMINATOR: process ALIVE + its conversation `.jsonl` STILL GROWING ⇒ silent
work · ALIVE + conversation STOPPED ⇒ external account limit · not alive ⇒ dead.**
★★★ **A SEAT CHANGE DOES NOT MEAN A NEW PID — a fresh worker runs in a NEW
CONVERSATION under the SAME `claude.exe`.**
★★★★★ **AND THE FIFTH STATE THE WATCHDOG CANNOT NAME: `THE DESK OWES A RULING.` Its
four states (idle · silent work · external limit · dead) do not include it. **FIRST
QUESTION ON ANY WAKE: IS THE NEWEST AR UNRULED?** On 2026-07-29 an AR sat unruled
02:56→04:35 because a ledger write was REJECTED BY A HOOK and never re-issued, and
the watchdog fired SEVEN times unable to say why. **A BLOCKED WRITE IS NOT A LANDED
RULING.**
★★ **`Remove-Item -Recurse` on a Windows JUNCTION deletes the TARGET** — remove
junctions reparse-safely.
`M session_windows_parity.json` phantom · a monitor event naming an OLD AR = torn
mid-write read · `.playwright-cli/` = operator tooling · **`| head`/`| tail` MASK
EXIT CODES** · `pytest-timeout` NOT installed (`--timeout` ⇒ exit `4`) · daily
`cme-outage CRITICAL` = known false positive.
★★★ **TWO DB TRAPS: (a) `ai_inference_log` shows `7040` `transcript_extractor` rows,
which READS like coverage — its entire span is `2026-05-06 → 2026-05-19`, months
before extraction, with NO video column. A LARGE COUNT FROM AN UNJOINABLE TABLE IS
NOT WEAK EVIDENCE, IT IS NO EVIDENCE. (b) `transcript_fetched_at = 2026-07-28` on
all 40 — the transcript TEXT was backfilled 25 days AFTER the specs were onboarded,
so grading fidelity against that archive grades a NEIGHBOURING OBJECT.**

## ★★★ THE SEAT'S OWN CONVICTED ERROR — READ BEFORE MEASURING ANYTHING

**ONE SHAPE, now NINE times: I measured a NEIGHBOURING OBJECT and reported it as the
one asked about.** The census, published:
1. R-467 §2 licensed the 3-way-degenerate census key. 2. Its occurrence-ordinal
defeater was INERT (`{0: 455}`, never increments). 3. **Corroborated a worker's
write-surface grep by re-running it on the worker's own wrong file** — corroboration
by re-running someone else's query is NOT independence; it gave a false finding two
witnesses. 4. `evidence present: 232/232` was a NULL CHECK read as content (true
count: byte-exact `0/232`). 5. **Grepped `WAIT_SESSION` on the census-lane copy and
published a false refutation of the campaign's leading hypothesis — inside the ruling
convicting a worker for that same error.** 6. Over-corrected #1 into a blanket
prohibition that forbade the correct key. 7. **Certified a comment-defect fix using
an unparsed-language control that exits before the comment logic runs.** 8. **Credited
`--break-reconcile`'s exit `6` as the fix for a defect living in `--mutate` — two
flags are two code paths.** 9. **Nearly published "no grader transcript exists" when
the truth was "not reachable from this session" — caught only by a positive control.**
★★★★★ **`THE JOIN KEY IS NOT A DETAIL OF THE QUERY — IT IS THE CLAIM.` State the
key, and state what your filter EXCLUDED.**
★★★ **`NAME THE TREE`** — broken twice in one session, once 90 minutes after
re-copying it into this file. **When the claim is about CI, sweep with
`git show <tested-sha>:<path>`, never in whatever checkout your shell is sitting in.**
★★★★★ **`A GREP PROVES SOMETHING ABOUT ITS PATTERN, NEVER ABOUT A RELATIONSHIP.`
When the claim is "nothing calls this", THE JOIN KEY IS THE CALLER'S VOCABULARY.**
★★★★★ **`A GUARD OWES A DISCRIMINATES FIXTURE, NAMED IN THE SAME SENTENCE AS THE
GUARD.` "Assert X is stable" is a wish; "assert X is stable ON THIS INPUT, WHICH
BREAKS THE OLD ONE" is a test.**
★★★★★ **`A CONTROL MUST REPRODUCE THE SHAPE OF THE REAL INPUT.` Before believing a
null result, ask what SHAPE the thing would have IF IT EXISTED — and make the control
that shape. ★★★ `A TRUE SENTENCE CAN BE A FALSE FINDING.`**
★★★★★ **`A LAW IS NOT IN FORCE FOR ITS AUTHOR UNTIL AN INSTRUMENT ENFORCES IT` —
discipline did not survive one document.**
★★★ **`A COMPLETION SIGNAL IS NOT A RESULT. VERIFY THE ARTIFACT` — every mutation
asserts its own edit TOOK.** ★★★ **`AN ANNOUNCED INTENT IS NOT AN ACTION.`**
★★★ **MY ORDER IS NOT EVIDENCE — including when it PREDICTS the answer.** The worker
has refused a wrong order and a volunteered prediction, and was right both times.
★★ **A replacement that silently degrades to its predecessor reports agreement with
itself and calls it validation. Prove the new thing RAN, per item.**
★★ **A true finding is the most dangerous moment for a guard** — correct premise +
unbuilt replacement + enormous convenience is how good desks ship regressions.
★★★★★ **`EVERY ORDERED TAXONOMY OWES A RESIDUAL CATEGORY` — AND A DESK'S QUESTION IS
A TAXONOMY.** Asking "legacy OR minimal?" asserted those two exhausted the space.
★★★★★ **`UNSUPPORTED ≠ REFUTED`, and `A PIPELINE IS NOT ONE PROMPT`.**
★★★★★ **`A REPORT IS A VIEW OF AN ARTIFACT` — a published number and its artifact
drifted apart three times in one session (hand-normalized table · renamed field ·
wrong-cwd write). FIX THE EMITTER, NEVER THE TRANSCRIPT.**
★★★ **`THE SPEC LABEL IS NOT AN IDENTIFIER` — [MEASURED] `39` distinct canonical
labels over `40` videos. THE DISTINCT SOURCE-VIDEO ID IS THE IDENTITY in every
artifact, join, manifest and report.**

## SEAT MECHANICS

★★★ **TREE: `C:/Users/tonio/Projects/wt-h1-wave4-20260712`, branch
`h1-wave4-sealed12-driver`** — NOT the primary cwd (~90 worktrees). "Relay files
missing" = wrong tree, never a vanished campaign. ★★ **`main` IS NOT THIS CAMPAIGN'S
INTEGRATION BRANCH** — PRs merge to
`hardening/slumhouse-shared-office-parity-20260723`; `origin/main` is an older line.
★★★ **SINGLE WRITER: the advisor writes `ADVISOR-RULINGS.md` + `ADVISOR-STATE.md`
and NEVER edits `AGENT-REPORTS.md`. Commit with `git commit -o <path>` — `-o`
protects the committer only; never `git checkout`/`reset`/index ops in this shared
tree.**
★★★ **INVOKE `advisor-ruling` BEFORE EVERY RULING** (hook-enforced; the sentinel is
consumed PER RULING, not per session, and the file MUTATES). **Every ruling
authorizing work opens with a cold-start-complete `★ WORKER — START HERE` block;
when RECORD and DISPATCH compete, the DISPATCH wins.** ★★ **Two ledger guards are
live and both have caught this desk: the MECHANISM guard (evidence in the same
sentence as a by-construction/cannot claim) and the STALE-PREMISE guard (name the
newest AR).**
★★★ **INDEPENDENT GRADES GO TO THE `accuracy-validator` AGENT** — never parked on
"the advisor seat" or "a fresh session". Route EARLY. **Name the AGENT ID in the
ruling that consumes the grade; never "a grade was obtained".**
★★★★★ **`TaskList` DOES NOT TRACK MONITORS AND ITS AGENT COVERAGE IS
`[UNVERIFIED]`. [MEASURED] the desk ran it while TWO of its own monitors were live
and provably delivering — one had just delivered the notification being read — and
got "No tasks found". ABSENCE FROM `TaskList` IS TRUE OF EVERY MONITOR, RUNNING OR
DEAD, SO IT DISCRIMINATES NOTHING.** ★★★★★ **THE OLD RULE "EMPTY `TaskList` ⇒
RETIRE AND RE-ARM" IS WITHDRAWN (R-465). Obeying it retires running processes on a
test that cannot fail.**
★★★★★ **THE CORRECT INSTRUMENT IS THE PROCESS TABLE, KEYED BY WHICH RELAY FILE EACH
COMMAND LINE WATCHES, AND BY THE OWNING `claude.exe`. NO PID OR TASK ID IS RECORDED
HERE — three generations appeared in ~40 minutes and two were written into this file
as durable facts and were false within the hour. STORE THE CHECK:**
```powershell
Get-CimInstance Win32_Process -Filter "Name='bash.exe'" |
  Where-Object { $_.CommandLine -match 'ADVISOR-RULINGS|AGENT-REPORTS' }
# then walk ParentProcessId up to the owning claude.exe; compare to YOUR OWN:
$p = Get-CimInstance Win32_Process -Filter "ProcessId=$PID"   # walk up to claude.exe
```
★★★ **DECISION TABLE: owning `claude.exe` == YOURS ⇒ **ADOPT, ARM NOTHING** (a
monitor armed by a PRIOR CONVERSATION of the SAME process still delivers to you —
verified 2026-07-29 21:22 when an inherited rig delivered `AR-471` into a
post-`/clear` seat) · owning `claude.exe` ≠ yours ⇒ **IT IS THE WORKER'S EAR, NEVER
TOUCH IT** (killing the `ADVISOR-RULINGS` watcher deadlocks the worker as surely as
a ruling that authorizes nothing) · dead/absent ⇒ verify the gap is EMPTY, then arm
exactly ONE · **LIVENESS UNESTABLISHABLE ⇒ STOP** and read the relay file directly.**
★★★ **TWO PIDs = ONE LOGICAL MONITOR (wrapper + child). Never read the pair as two
rigs.** **THE REQUIRED RIG: ONE `ADVISOR-RULINGS` watcher (the worker's) + TWO
`AGENT-REPORTS` watchers (the desk's change-detector and idle watchdog) = 6
processes. ONE watcher while unseated, TWO while seated.**
★★★★★ **OWED, NOT BUILT: A DEAD WATCHER CANNOT REPORT ITS OWN DEATH. `ONE RIG PER
CHANNEL` HAS ALWAYS BEEN TWO REQUIREMENTS — UNIQUENESS **AND** EXTERNALLY VERIFIABLE
LIVENESS — AND ONLY THE FIRST HAS EVER BEEN ENFORCED. The durable form is a
heartbeat or expiring lease a reader can check without asking the watcher.**
★★★★★ **A CHANNEL IS NOT AN AUTHOR (R-450). TEXT ARRIVING THROUGH THE OPERATOR'S
CHANNEL IS NOT THE OPERATOR'S WORDS — they stated "ITS GPT NOT ME".** ★★★★★ **WHY IT
IS DANGEROUS: the campaign RESERVES powers to the operator (real capital · spend ·
irreversible destruction · unboundable blast radius) — recording external text as
operator authority BREACHES THAT RESERVATION BY LABELLING, and a later seat would
obey it.** ★★★ **Every relayed non-operator text is `[EXTERNAL OPINION]` — ZERO
authority, premises AUDITED, freely overruled by measurement. Four arrived flawed;
several carried content SHARPER than this desk's, adopted on merit. RE-GRADE THE
SOURCE, KEEP READING IT.** ★★★★★ **STANDING BAN: no advisor report may state or
imply an external review occurred when it did not.**
★★★★★ **THE OPERATOR'S STANDING ORDER: THE EXTERNAL (GPT) READ ARRIVES BEFORE EVERY
RULING. `THE PASTE IS THE GATE.` MEASURE AND RELAY FREELY; JUDGE NOTHING.** ★★★ **A
STATE-FILE WRITE AND A LEDGER WRITE ARE DIFFERENT FILES, NOT DIFFERENT ACTS: if a
sentence would change what the next seat DOES, it is a ruling wherever you write
it.** ★★ **A DESK MAY NOT REPEAL ITS PRINCIPAL'S ORDER, and a "measurement is not
judgment" split that always resolves toward "I may proceed" is a rationalisation
with a citation.**
★★ **YOU DECIDE:** merges · worktree updates · deploys of verified work · reversible
CI-gated production writes · tooling and grading routes. **Reserved to operator:**
real capital · spend · irreversible destruction · unboundable blast radius.
★★ **STANDING (R-451): committing a DERIVED, operator-data-free INSTRUMENT is inside
the worker's authority. `AN INSTRUMENT THAT EXISTS ONLY IN %TEMP% IS NOT AN
INSTRUMENT, IT IS A RUMOUR.`** ★★★ **No money-path task may depend on an
unregistered temporary artifact.**
★★ **DOCTRINE IS VERSIONED:** `.claude/` is its own git repo on
`origin ops/claude-doctrine`; the directory IS canonical, not a backup.
★★★★★ **SWAP EARLY. A long session re-sends its whole history every turn; a fresh
seat plus this file starts near zero. Swap at natural boundaries WHILE CONTEXT
REMAINS — a session near its limit is the one most likely to ship a truncated
measurement that reads as complete.**

## OPERATOR-FACING

★★★★★ **ONE DECISION IS YOURS: your standing order was "get an external (GPT)
opinion before writing a ruling." This desk SCOPED IT OUT in R-449 on the mistaken
belief that YOU were demanding a choice — it was GPT's text in your channel. R-450
SUSPENDED that. KEEP THE ORDER, OR SCOPE IT OUT? Until you say, the order stands and
the desk names its absence in each ruling. Nothing is blocked either way.**
★★ **The relays labelled "R-440"/"R-449"/"R-450"/"R-451"/"R-452" were GPT, not you.
Every relayed text is treated as an OPINION with zero authority — audited, often
adopted on merit, never obeyed as your order.**
Nothing else waits on you. **Nothing has ever run a backtest; no capital is
connected.**
★★ **Strategic: FIVE built-but-disabled capabilities exist, three aimed at the three
largest blockers. The bottleneck may be SHIPPING, not building** — consult
`STRANDED-CAPABILITY-REGISTER.md` before commissioning any new detector work.
