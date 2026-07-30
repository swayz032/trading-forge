# C8-PROVENANCE-LEDGER — Gate A · 2026-07-29

> **Deliverable of R-466 §1 as revised by R-467 (bridge keys · opposing paths · per-boundary
> conservation) and R-468 §6 (the `232 / 1` split · no model execution).**
> Produced by AR-459's worker seat. **READ-ONLY throughout: no model was run, no DB row
> written, no frozen byte altered, no re-extraction, no `--relock`.**
>
> ★★★★★ **EVERY SEMANTIC CELL IN THIS LEDGER IS `[ARTIFACT-SOURCED]` TO THE FROZEN
> CLASSIFIER. THE WORKER PUBLISHES NO SEMANTIC LABEL OF ITS OWN** (AR-459's defect flag,
> upheld as binding contract by R-468 §5). Deciding whether a clause is *genuinely* chart
> context or a *genuine* market session is a grading act, and the doer does not grade.
>
> ★★★ **INSTRUMENT:** `docs/replay-results/h1-battery/c8_provenance_ledger.py` — every
> number below is its output, not a transcription. Re-run it; do not trust this table.
> `--mutate` runs the broken-join fixture (§6); `--break-reconcile` proves the
> reconciliation gate can fire.
>
> ★★★★★ **REVISION 2 — THIS DOCUMENT AND BOTH ITS INSTRUMENTS WERE REJECTED AND
> REPAIRED (R-469). Three defects were mine and all three are fixed at the source,
> not annotated around:** (1) **a FALSE REFUTATION** of R-466's prompt hypothesis,
> measured on the wrong copy of a 50-copy file — **withdrawn in §9, with the producer's
> line 60 now carried**; (2) **`JOIN_RESIDUAL = 0` was a HARDCODED STRING LITERAL** in
> the conservation table while the C8 table computed `1`, and the run exited `0`
> regardless — **now one shared bucket computation, non-zero exit on any internal
> disagreement**; (3) **the evidence figures UNDERCOUNTED** a contract that fails
> `232/232` byte-exact — **corrected in §7 and now EMITTED by the instrument.**
> ★★★ **The absence-guard shipped with a FALSE-GREEN that confirmed a nonexistent
> capability — the inverse of the class it exists to catch.**
>
> ★★★★★ **REVISION 3 (R-470). TWO FURTHER CORRECTIONS, BOTH MEASURED AGAINST ME:**
> **(a) MY "THE FALSE-GREEN IS CLOSED" WAS FALSE — I CLOSED `1` OF `3` AND ANNOUNCED THE
> CLASS SHUT.** The guard's POSITIVE CONTROL, the mechanism licensing every absence
> verdict it issues, was satisfiable **BY A COMMENT**: pointed at its own `.py` source as
> the control for the Node API `writeFileSync` it returned `CONTROL HIT (4 matches)`,
> exit `0` — and a Python file cannot import `fs` in principle. A second false-green
> survived my name-binding repair entirely: `fs[("write"+"File"+"Sync")](p,data)`, which
> has **zero literal occurrences** of the symbol. ★★★ **The guard is therefore REBUILT,
> not patched: capability mode is now syntax-aware and MODULE-QUALIFIED, comments and
> string literals are stripped, a bare identifier is no longer evidence, and an
> unsupported language or undecidable construct FAILS CLOSED (`VERDICT UNAVAILABLE`,
> non-zero) instead of reporting an admissible absence. `A GUARD INHERITS EVERY WEAKNESS
> OF THE METHOD IT AUTOMATES.`**
> **(b) THE BRIDGE-KEY TABLE IN §2 WAS WRONG WHILE THE INSTRUMENT WAS RIGHT** — see §2.
>
> ★★★★★ **REVISION 4 (R-472). THE ABSENCE GUARD'S CAPABILITY MODE IS RETIRED, AND
> NOTHING IN THIS LEDGER EVER DEPENDED ON IT.** Four repair rounds each closed every
> named shape, went green on its own fixtures, and then failed on a new unnamed one;
> the diagnosing defect was that its fail-closed behaviour was scoped to its CONTROL
> and never to its CLAIM — it certified absence over files it had declared it could
> not read. ★★★ **`A FAIL-CLOSED CLASSIFIER IS NOT FAIL-CLOSED WHEN ONLY ITS CONTROL
> MUST BE DECIDABLE.`** The tool now certifies exactly one proposition — literal text
> present/absent over an enumerated surface — and refuses capability verdicts outright.
> ★★★★★ **THE QUESTION THAT STARTED THAT LANE IS ANSWERED BY POSITIVE EVIDENCE, NOT BY
> AN ABSENCE TOOL: the producer persists at `dc8a150:229`,
> `const { writeFileSync } = await import("fs")` inside the `--emit-spec` branch.**
> ★★★ **AND THE PINS ARE NOW REAL: `A COUNT IS NOT A PIN.` All four inputs — raw census,
> classified artifact, the complete spec set and the complete transcript set — are
> CONTENT-hashed and asserted (the previous version checked spec COUNT and transcript
> COUNT+BYTES, which any same-sized substitution satisfies). Every governing bridge-key
> figure is now EMITTED by the instrument: `1368` · `456` · `{3: 456}` · `359` · `32` ·
> `28` · `96`. ★★ And `--mutate` now EXITS NON-ZERO (`9`) — it previously printed
> *"[UNEXPLAINED — a real one is a BROKEN JOIN]"* and returned success.**
> ★★★★★ **GATE A's TOTALS ARE RE-VERIFIED AFTER ALL OF IT, NOT ASSUMED: `456 / 233 /
> 232 / 1`.**

---

## 1 — POPULATION AND TREE, BESIDE EVERY COUNT

★★★ **A number without a tree is not a measurement of anything in particular.**

| input | identity | tree / repo |
|---|---|---|
| frozen classified census | `pop120_classified.json` · sha256 `eed65514a126adb136b5430939223965a12909b6e21cda4fba87d547326051d1` · `175,347` B · **re-hashed in-process at every run** | `backups\h1-census\unknown-dbtime-ad4335f0\` — ★ **outside every git working tree** (`git rev-parse --show-toplevel` → `fatal: not a git repository`) |
| canonical specs | `40` × `*.spec.json`, `2,351` conditions (`entry_conditions` 2,150 + `invalidations` 201) | **`tf-deep-scan` — A SEPARATE GIT REPOSITORY.** No campaign-tree search reaches it |
| preserved transcripts | `40` files, `913,668` frozen hashed bytes | `backups\h1-shadow-eval\transcripts-78fe8ea7\transcripts\` |
| refusal engine | `spec_execution_preflight.py` @ `83efd34e` | `wt-preflight-blockers-20260729` (census lane) |
| **PRODUCER** | `atomize-transcript.ts` **@ `dc8a150`, `21,518` B git blob** | `tf-deep-scan` — ★★★ **this version exists on NO disk; 4 on-disk sizes are `16,565`/`16,785`/`22,903`/`26,423`** |

**POPULATION:** `POP-120-LIVE`, **per-video** (`456` rows = `1368 ÷ 3`; the `÷3` is confirmed, not assumed). **NOT `corpus_A`.** ★ `backtests_total = 0` in the frozen census — the stop condition does not fire.

## 2 — BRIDGE KEY, WRITTEN DOWN PER HOP

★★★★★ **THE GOVERNING LAW, AND IT COST FOUR WRONG RULES IN ONE LINEAGE TO REACH IT (R-470 §3): `A KEY'S SAFETY IS A PROPERTY OF THE ARTIFACT, NOT OF THE KEY.` Every join key below is named WITH the artifact it is admissible on — never alone. `(video, condition_id)` was first permitted universally, then forbidden universally, and BOTH were wrong for the same reason: each was a measurement of one artifact stated as a property of the key.**

**THE THREE-WAY CONTRACT, BINDING:**

| artifact | admissible key | [MEASURED] |
|---|---|---|
| **collapsed per-video classified artifact** (456 rows) → canonical spec | ★★★ **`(video, condition_id)`** | `455` distinct, max multiplicity **`1`** |
| **raw 120-row census payload** → persisted refusal | ★★★ **`(strategy_id, condition_id)`** | `1368` distinct, max multiplicity **`1`** |
| any artifact | ★★★★★ **`condition_id` ALONE — INADMISSIBLE** | over the `455` non-empty rows: only **`359`** distinct · **`32`** ids duplicated · max multiplicity **`28`** · ★★★★★ **`96` ROWS SILENTLY MERGED** |
| census payload | ★★★★★ **`(video, condition_id)` — INADMISSIBLE THERE** | `456` distinct but max multiplicity **`3`**, histogram `{3: 456}` — fuses the `_mcl_`/`_mes_`/`_mnq_` triple, turning `1368` into `456`, **exactly the figure the desk expects, so the table would BALANCE while merging three copies** |

★★★★★ **DOC-vs-ARTIFACT DRIFT, CORRECTED (R-470 §3): revision 1 of this table said the refusal→spec key was `condition_id`, while the instrument has always actually used `(video, condition_id)`. THE INSTRUMENT WAS RIGHT AND THIS DOCUMENT WAS THE LIAR — the fourth doc/artifact drift this campaign has caught and the first where the DOC was wrong. A reader who implemented the documented contract would have merged `96` rows and produced a balanced-looking table.**

| hop | bridge key | status |
|---|---|---|
| refusal row → canonical spec condition | ★★★ **`(video, condition_id)`** ≡ (spec envelope `video`, condition `id`) | **`455/456`** |
| spec condition → preserved transcript | `span {start,end}` char range into `<video>.transcript.txt` | **`232/232`** in-bounds for C8 |
| video-level | `video` ≡ spec envelope `video` ≡ transcript filename stem | `40/40` |
| at/after condition creation (census payload) | **`(strategy_id, condition_id)`** — unique, `1368`, multiplicity `1` | binding |

★★★★★ **R-467 §2's PRESCRIBED COLLISION DEFEATER IS WITHDRAWN AS INERT, AND R-468 §6 CONFIRMS IT: `condition_id` is `{TYPE}:{text}#{ordinal}`, and [MEASURED] the ordinal distribution across all 456 rows is `{0: 455}` + 1 empty key. EVERY ordinal is `#0`. It never increments, so "raw-span hash + OCCURRENCE ORDINAL" cannot break any collision here.** ★★★ **Uniqueness comes ENTIRELY from the embedded text — and it is SUFFICIENT: `455/456` distinct, `0` duplicate matches, `0` repeated `rule_text` within any single strategy.** ★★ **CONSEQUENCE: whether the teacher said "timeframe" once or five times is `[UNRECOVERABLE FROM THIS ARTIFACT]` — repeats were collapsed upstream and no count survives. `timeframe` occurs `28`× but across `28` DIFFERENT strategies, never within one.**

## 3 — JOIN COVERAGE. THE FOUR BUCKETS SUM TO THE POPULATION.

```
matched 1:1     = 455
duplicate keys  = 0
miss            = 1
JOIN_RESIDUAL   = 0
SUM             = 456  vs population 456  -> BALANCES
MISS: video='75DJN5UVQnw' cond_id='' reason='non_executable_empty_spine'
```
★★★ **`JOIN_RESIDUAL` is MY bucket for unresolved joins and is a DIFFERENT OBJECT from the frozen taxonomy's own `C9_RESIDUAL_none_of_these` (`3` rows). They are never summed.**

## 4 — THE C8 SPLIT: TWO POPULATIONS, NO GLOBAL REMEDY (R-468 §4)

| bucket | n | boundary | disposition |
|---|--:|---|---|
| **`C8-ANNOTATION`** | **`232`** | **ATOM-ADMISSION** | the treatment population |
| **`C8-EMPTY-SPINE`** | **`1`** | **PREFLIGHT** | ★★★★★ **SAFETY BEHAVIOUR — stays FAIL-CLOSED, its own row, EXCLUDED from any treatment** |

**`C8-ANNOTATION` signature** — `semantic_type WAIT_SESSION` `232/232` · `reason no_recognized_session_keyword` `232/232` · `rule_class MANDATORY` `233/233` · `role` confluence `158` / spine `75` · `166` distinct texts (`timeframe` 28 · `time frame` 15 · `timeframe selection` 9 · `daily time frame` 4 · `chart timeframe` 3).

★★★★★ **`C8-EMPTY-SPINE` IS VERIFIED BY THIS SEAT AT THE EXECUTABLE LINE — R-468 recorded it `[RELAYED, UNVERIFIED BY THIS DESK]` and assigned it to me.** `spec_execution_preflight.py` @ `83efd34e:296-306`:
```python
executable_spine = [b for b in plan.bindings if b.role == "spine" and b.bindable and b.executed]
if not executable_spine:
    refusals.append(PreflightRefusal(strategy_id=strategy_id,
        condition_id="", rule_text="<no executable spine predicate in this spec>",
        semantic_type="<plan>", role="spine", reason=NON_EXECUTABLE_EMPTY_SPINE, ...))
```
★★★ **`condition_id=""` IS HARDCODED AT THE CONSTRUCTION SITE. The empty key is MANUFACTURED BY DESIGN — it is not a lost or corrupted identifier, and it is not a transcript clause or an atomizer mistype.** ★★ **It belongs to `75DJN5UVQnw`, one of the two distance-0 videos R-466 §3 names as a TARGET — so a global C8 remedy would have corrupted a spearhead candidate first.**

## 5 — PER-BOUNDARY SEMANTIC CONSERVATION (R-467 §4)

| boundary | population / tree | in→out identity | semantic state (frozen classifier ONLY) | executable | matched / dup / miss / JOIN_RESIDUAL |
|---|---|---|---|---|---|
| transcript clause → atom | `[UNRECOVERABLE]` for raw PASS membership | clause id `T-xxxx-Cnnnn` | **`[NOT LABELLED AT THIS LAYER]`** | — | — / — / — / **all** |
| atom → spec condition | 2,351 conditions / `tf-deep-scan` | atom `id` → condition `id` | `[ARTIFACT-SOURCED]` | yes | see §3 |
| spec condition → persisted refusal | 456 / census lane `83efd34e` | `condition_id` | `[ARTIFACT-SOURCED]` `WAIT_SESSION` | **yes — refused** | `455` / `0` / `1` / `0` |

★★★★★ **THE FIRST BOUNDARY AT WHICH `context` BECOMES `executable` — the one field the whole gate exists to produce — IS `ATOM ADMISSION`, FOR THE `232`.** The entailment (a retained condition implies prior atom admission) rests on two executable lines **which R-468 §3 walked and this seat re-derived**: atom creation is gated on `is_decision` (`dc8a150:112`, four-part conjunction) and conditions are built ONLY by iterating `graph.atoms` (`graph-to-engine.ts:69-84`, every push inside the loop). ★★★ **THAT ENTAILMENT REMAINS ON THE GRADER'S ATTACK LIST. Two walks by two parties who both wanted it true is not an independent grade.**

★★★ **AND ONE OPEN ITEM I CLOSED THAT BEARS DIRECTLY ON IT: R-468 left "does the CENSUS lane convert graph→spec by a different module?" OPEN. [MEASURED] the census-lane atomizer contains ZERO occurrences of `entry_conditions`, `EngineCondition` or `--emit-spec`; it is REPORT-ONLY. `graph-to-engine.ts` exists in exactly `2` trees (`tf-deep-scan`, `.claude/worktrees/extraction-100`) — neither the census lane nor `runtime-production`.** ★★ **The census lane does not build conditions at all; it CONSUMES specs already built. The hop-2 entailment is therefore not weakened by lane divergence — but `graph.atoms` IS read in the census lane by `conservation-ledgers.ts:91-112`, for ledger checks only, NOT condition construction. I name that so the next reader does not mistake those hits for a second producer.**

## 6 — THE BROKEN-JOIN FIXTURE **DISCRIMINATES** (both halves stated)

★★★★★ **A GREEN-ONLY TRACE IS NOT EVIDENCE — including my own.** `--mutate` corrupts ONE `C8-ANNOTATION` join key inside the REAL instrument (not a reimplementation).

| arm | matched | miss | C8-ANNOTATION | C8-EMPTY-SPINE | JOIN_RESIDUAL | SUM |
|---|--:|--:|--:|--:|--:|--:|
| **CONTROL (unmutated)** | `455` | `1` | `232` | `1` | `0` | `456` **BALANCES** |
| **MUTATED** | **`454`** | **`2`** | **`231`** | `1` | **`1`** | `456` **BALANCES** |

★★★ **PRE-DECLARED BEFORE RUNNING: "matched 455→454, miss 1→2, C8-ANNOTATION 232→231." OBSERVED EXACTLY THAT. The mutated row is NAMED in the residual output, the genuine empty-spine classification is UNAFFECTED, and the totals balance in BOTH arms — so the mutation could not hide inside a residual.** ★★★★★ **THE CONTROL STAYS GREEN AND THE MUTATION GOES RED: the fixture BITES and it DISCRIMINATES.**
★★ **DISCLOSED: the fixture's first version labelled every C8 miss `EMPTY-SPINE`, which under mutation asserted a class membership it had not checked. `A CAPTION IS A CLAIM` — the bucket label is now COMPUTED from the `reason` field, and the fix is in the committed instrument.**

## 7 — FORWARD / REVERSE CONVERGENCE: THE PATHS DIVERGE, AND THE DIVERGENCE IS A FINDING

★★★★★ **R-468 §2 reports `evidence present: 232/232`. THAT IS A NULL CHECK AND IT IS TRUE. I MEASURED THE CONTENT, AND THE `evidence` FIELD IS NOT AN EVIDENCE QUOTE IN `212 OF 232` ROWS:**

| `evidence` content class | n | example |
|---|--:|---|
| **CLAUSE-ID token** | `123` | `T-h6Tn-C0267` |
| **JSON DEBRIS** | `58` | `},{` |
| clause-ID range / braced | `28` | `T-jlSh-C0008 to T-jlSh-C0009` · `{T-lRMF-C0136}` |
| **PROSE (a real quote)** | **`20`** | `Step two, scale down to the low time frames.` |
| JSON debris (other) | `3` | `{C0203}` · `{0:1}` · `{0199}` |

★★★ **Population-wide, not C8-specific: across all `455` matched rows — CLAUSE-ID `242`, DEBRIS `121`, PROSE `29`, OTHER `63`.**
★★★★★ **THE QUOTE CONTRACT FAILS COMPLETELY, AND MY FIRST NUMBER HERE WAS AN UNDERCOUNT (corrected per R-469 §4, then RE-DERIVED by this instrument).** `SPAN`'s declared invariant is `evidence_quote === transcript.slice(start, end)`. Measured over the `232`:

| check | result |
|---|---|
| span numeric AND in-bounds | **`232 / 232`** |
| **INVARIANT HOLDS — byte-exact `evidence == slice`** | ★★★★★ **`0 / 232`** |
| equal only after whitespace/case normalisation | `20 / 232` |
| **DIVERGENT even normalised** | **`212 / 232` (91.4%)** |

★★★★★ **AN EARLIER REVISION OF THIS LEDGER SAID `~26%` — COUNTING ONLY THE VISIBLE JSON DEBRIS. THE CONTRACT ACTUALLY FAILS `232/232` BYTE-EXACT. AND THE DISTINCTION THAT PRODUCED MY ERROR IS THE ONE WORTH KEEPING: `IN-BOUNDS PROVES THE ADDRESS IS VALID; IT DOES NOT PROVE THE SPAN IS SEMANTICALLY CORRECT.` I sampled slices, saw coherent on-topic teacher speech, and let NECESSARY read as SUFFICIENT.**
★★★ **WHAT STILL STANDS: `232/232` addresses are VALID, and the sampled slices ARE coherent on-topic speech —** `'This strategy performs best on the 15minut, 1 hour, and 4hou'` · `'We can scale down to the low time frames.'` **— which is why the span remains the usable bridge. But "the spans are correct" is `[UNPROVEN]`: sampling is not the invariant, and the invariant is the test.**
★★★★★ **TWO CONSEQUENCES: (1) `evidence` CANNOT SERVE AS THE INDEPENDENT SECOND RESOLUTION PATH, so the convergence R-467 §3 ordered is **SINGLE-PATH ON THE SPAN** — declared, not faked. (2) THE PROVENANCE LAYER OF THE PRODUCER IS BROKEN, not the classifier and not the refusal engine.**
★★★ **REQUIRED FIX, FORWARD-ONLY (R-469 §4): derive `evidence_quote` DETERMINISTICALLY from `transcript.slice(start, end)` and keep any model-produced hint in a SEPARATE, EXPLICITLY UNTRUSTED field. DO NOT backfill it into historical artifacts (R-463's forward-baseline law).**

## 8 — PROVENANCE OF THE PRODUCER (recorded, NOT adjudicated)

`extraction_provenance`, identical across all `40` specs: `extraction_pipeline_version=compiler-v3-union-1.0` · `pipeline_commit=dc8a150` · `prompt_sha256=c75a2da8f5c473e8c1204788db7b9dcb5a972d9e141cf0c10544745618a47c0a` · `model=gemma4:e4b-it-qat` · `model_digest=ee665637121887cf3befff38` · `atomization=2-pass-union` · `certified_gate=6-video-46of46-2026-07-02` · ★★★ **`provenance_backfilled=True`**.
★★★★★ **`dc8a150`'s AUTHORITY IS `[CORROBORATED, NOT PROVEN]` AND R-468 ASSIGNS IT TO THE GRADER: the stamp was written AFTER the fact. What corroborates it — the `--emit-spec` persistence path and the `MODEL` default `gemma4:e4b-it-qat` (`dc8a150:29`) both match the stamp. What is NOT established — that the run which produced these 40 specs used that commit.**

## 9 — LIMITS. READ THESE BEFORE CITING ANYTHING ABOVE.

- ★★★★★ **RAW PASS MEMBERSHIP — `[UNRECOVERABLE]`.** Which of the two union passes introduced each atom is gone; the producer persisted the FINAL SPEC, not the per-pass response arrays. ★★★ **NOT to be confused with ATOM MEMBERSHIP, which §5 establishes.**
- ★★★★★ **THE SEMANTIC LABELS ARE HAND-CORRECTED JUDGMENT, NOT MEASUREMENT** (`CENSUS-REPRODUCIBILITY-MANIFEST` §7: the mechanical layer NOMINATED and every bucket was hand-corrected). Keying to them removes the WORKER from the grading loop; **it does not make the labels true.** Re-grading them is the `accuracy-validator`'s act.
- ★★★ **THE LIVE DB — NOT MEASURED BY THIS SEAT; CLOSED ON ONE EXTERNAL PATH ONLY.** R-468 §6 step 2 (compare each live `compiled_spec`/`spec_hash` against its canonical on-disk spec) **was NOT run by me.** ★★ **[RELAYED, external read, `[UNVERIFIED BY THIS SEAT]`, inside `BEGIN READ ONLY`] `120` live rows with `compiled_spec` · `40` distinct videos · `40 × 3` multiplicity · `0` missing disk artifacts · `0` `spec_hash` disagreements · `0` canonical inner-spec disagreements · `backtests_total = 0`.** ★★★★★ **SO THE RISK IS SUBSTANTIVELY RETIRED ON ONE PATH AND IS NOT CLOSED: R-469 §3 deliberately did NOT cancel the second path (`accuracy-validator` `a5a70a93c66262a61`, dispatched BEFORE that read existed, with this as its item 1). A single unreplicated read closing a deliverable's largest risk is exactly where this campaign has been burned. TWO PATHS OR IT IS NOT CLOSED.**
- ★★ **`[UNMEASURED]`** whether `runtime-production`'s post-census commit `0b0d6617` (`record UNKNOWN_REQUIREDNESS`, `+72/−15`, 2 of 3 engine files moved off the manifest's recorded hashes) changes the C8 count. It touches REQUIREDNESS — the census's own `C6` class — so "it leaves C8 alone" would be an unmeasured mechanism claim. **Any Gate-B treatment must be re-verified against the executing lane; lane equivalence NO LONGER HOLDS.**
- ★★ **`[UNMEASURED]`** the population OVERLAP MAP (`corpus_A` ↔ `POP-120-LIVE` ↔ tier-A) — v4 §0's own gap. **Any sentence joining `0/16` to `51.1%` is a claim about an unenumerated overlap.**
- ★ **`[UNRECOVERABLE AT ORIGIN]`** original transcript identity · **`[UNRECOVERABLE]`** the DB read timestamp of the census.
- ★★★ **THE UNREACHABLE `context` ENUM MEMBER IS *NOT* OFFERED AS THE CAUSE.** [MEASURED] `CLASS_MAP` has `13` keys, the schema enum offers `12`, difference exactly `{context}`; the schema is the decision boundary under constrained sampling, so that branch is dead. **BUT `observation`/`explanation`/`justification`/`recap`/`example` all map to the same `"contextual"` disposition and all ARE offerable — the functional outcome stays reachable by five routes. Hygiene defect, not the leak.** Filed so nobody promotes it into a cause later.
- ★★★★★ **WITHDRAWN IN FULL, AND THE WITHDRAWAL IS THE MOST IMPORTANT LINE IN THIS DOCUMENT (R-469 §1, §6).** An earlier revision of this ledger stated that R-466 §1's leading hypothesis was *"REFUTED AS WORDED"* — that the atomizer does not instruct chart/instrument context to become `WAIT_SESSION`. **THAT WAS FALSE AND IT IS RETRACTED. It was measured on the CENSUS-LANE copy (`16,565` B) and published as a conclusion about "the atomizer" as a program.** ★★★ **A false refutation left standing in a deliverable is worse than an open question, so it is corrected HERE in the artifact and not only in a report.**
  ★★★★★ **[MEASURED, tree named IN the command: `git -C .../tf-deep-scan show dc8a150:scripts/atomize-transcript.ts`] THE PRODUCER CONTAINS `WAIT_SESSION` `3`× (`:32`, `:60`, `:61`); THE CENSUS-LANE COPY CONTAINS IT `1`× (the `ATOM_TYPES` array only). PRODUCER LINE `60`, VERBATIM:**
  > `"we trade this on crude oil" / "we're sitting on the 30-minute chart today"  -> YES (WAIT_SESSION — execution context: removing it changes what the engine runs on)`
  ★★★★★ **SO R-466's HYPOTHESIS IS RESTORED AND STRENGTHENED: THE ACTUAL PRODUCER EXPLICITLY INSTRUCTS INSTRUMENT AND CHART CONTEXT TO PASS THE DECISION GATE AND BECOME `WAIT_SESSION`.**
  ★★★★★ **ROOT CAUSE, NOW MECHANISTIC RATHER THAN MERELY LOCATED (R-469 §2): THE ADMISSION CONTRACT CONFLATES *"removing it changes what the engine runs on"* (RUN CONFIGURATION) WITH *"is an entry predicate"* (A PER-BAR CONDITION). Instrument and chart timeframe genuinely matter to execution and are NOT per-bar conditions; `:60` admits them as decisions on the first ground, and `ATOM_TYPES` (`:32`) offers 14 types none of which represents non-executable context — so `WAIT_SESSION` is the FORCED LANDING SPOT.**
  ★★★ **AND IT IS A DESIGN DEFECT, NOT A TYPO: `:61` draws the opposite boundary carefully on the very next line — *"mark the high and low of the first 30 minutes" … -> YES (WAIT_STRUCTURE / FILTER — a price LEVEL, never `WAIT_SESSION`)*. The same author distinguishes precisely one line later. The conflation at `:60` is reasoned, and the reasoning is the defect.**
  ★★ **CONSEQUENCE FOR §4/§5, WHICH SURVIVE AND STRENGTHEN: the `232` → `ATOM-ADMISSION` routing is no longer located by elimination — it is EXPLAINED by an instruction anyone can read. The fix target is the ADMISSION CONTRACT itself, and per R-469 §6 Gate B must be DETERMINISTIC: a prompt edit is a request, not a fix.**
