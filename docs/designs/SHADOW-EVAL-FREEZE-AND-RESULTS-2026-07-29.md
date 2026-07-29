# SHADOW EVALUATION — FREEZE + MECHANICAL RESULTS

**R-434 / R-435 · 2026-07-29 · read-only · no flag flipped · no artifact mutated · no backtest.**
**[MEASURED] `backtests total = 0`, checked at dump time by this seat.**

★★★ **VERDICT UP FRONT: THIS RUN IS *VOID* BY YOUR OWN PRE-REGISTERED CRITERIA — "a material share of
ARM A decisions used `LEGACY_FALLBACK`." On HOLDOUT-26 the deterministic rules decide 4.1% of
conditions and fall back on 95.9%. The void is the RESULT, not a failure of the run.**

---

## STEP 1 — THE FREEZE (written before any result was inspected)

**INSTRUMENTS, sha256:**

| artifact | sha256 |
|---|---|
| `extraction-100/src/server/lib/gate-strength.ts` (the labeller) | `c62a2566978183b2a5b36dedc0bab9e6f4884787ebb15e487d5907dfda1ab14a` |
| `extraction-100/src/server/lib/graph-to-engine.ts` (flag + topology line) | `314e376f968d80f58d043d72e4a0ca13c84fc1b65422f1ae464b8ebea0893e46` |
| `src/server/lib/clause-segmenter.ts` (pointer resolver) | `52bcf1dac04860bd4d635dac8901d335c120420af165b09202666bc68f113dd8` |
| `corpus-v3-heldout-split-2026-07-05.json` (the partition source) | `9981660ba5e95d2ef3137c0c9db9a11018c96719011cb3ad2a7854cf1ac3d4e5` |
| the run harness (`shadow.ts`) | `16654d173baf14b11caa25c6318ecbee3fcb6417cc68fe4fada153ba8fa77635` |

**PARTITION — derived mechanically from the split file, not hand-listed.**
**DEV-14** = live videos appearing in `rules_design_keys`. **HOLDOUT-26** = the other 26.
`DEV-14`: `75DJN5UVQnw · FqxEKDxemtI · HfZTCZTDfWk · KXWRtV2LOVc · N7uP9V0Iktc · NMUd0oX_7Pg ·
UBvfsImdI2U · c8VLqF0XDR4 · jlShztsY3oA · m-G1ag77aVc · oDLt9zh33LE · psH--oXkD8M · snNkQSyWX4k ·
x1ydP8bC7OE` *(as emitted by the harness: `PARTITION: DEV-14 / HOLDOUT-26 (total 40)`)*.
**HOLDOUT-26** is the complement, enumerated in the AR-405 amendment.

★★★ **THE COVENANT, RECORDED SO A LATER SEAT CANNOT FORGET IT: HOLDOUT-26 RESULTS MAY NOT BE USED TO
MODIFY THE LABELLER IN THIS CYCLE. The moment they are inspected for tuning, those 26 become
DEVELOPMENT evidence and a fresh untouched population is required for the next unbiased claim.**

**RESOLUTION PATH (frozen):** real `segmentTranscript(transcript, "T-" + video.slice(0,4))`; pointer
values resolved to clause text, multi-pointer forms concatenated in document order; non-pointer
evidence used inline. **CONTROL LINE PUBLISHED BY THE RUN:**
`CONTROL: segmentTranscript= function | classifyGateStrengthDeterministic= function | gateStrengthToRole= function`

**NORMALIZATION:** none applied beyond the segmenter's own output — the resolved clause text is passed
verbatim as `evidenceQuote`.

---

## STEP 2/3 — TWO ARMS, DECISION PATH ON ALL 2351 CONDITIONS

**ARM A — SOURCE-RESOLVED:** labeller receives inline evidence when present, else the resolved clause.
**ARM B — SOURCE-WITHHELD CONTROL:** labeller receives `evidenceQuote: ""`.
**Every condition carries exactly one path.** No condition is reported without one.

| | **DEV-14** | **HOLDOUT-26** |
|---|---:|---:|
| conditions / videos | 575 / 14 | 1776 / 26 |
| `RESOLVED_POINTER_TEXT` | 49 | 58 |
| `SEMANTIC_SOURCE_TEXT` | 16 | 14 |
| ★★★ `LEGACY_FALLBACK` | ★★★ **510 (88.7%)** | ★★★ **1704 (95.9%)** |
| `UNCLASSIFIED` / `ERROR` | 0 | 0 |
| ★ **ARM A rules fired** | ★ **65 (11.3%)** | ★ **72 (4.1%)** |
| ARM B rules fired | **0 (0.0%)** | **0 (0.0%)** |
| A == B | 510 (88.7%) | 1704 (95.9%) |
| per-video fired-rate min / median / max | 0.0% / 10.7% / 25.8% | 0.0% / 3.8% / 13.8% |

**ARM A class distribution.** DEV-14: `mandatory` 45 · `contextual` 8 · `optional` 7 · `alternative` 5.
HOLDOUT-26: `mandatory` 46 · `optional` 11 · `alternative` 8 · `contextual` 7. **ARM B: `null` on all
2351.**

---

## THE THREE FINDINGS

### 1 ★★★ THE RUN IS VOID — AND THE VOID IS THE ANSWER
Your criterion: *"a material share of ARM A decisions used `LEGACY_FALLBACK`."* **[MEASURED] 95.9% on
the clean population.** ★★★ **The deterministic rules cannot replace the topology heuristic on their
own: they decline to decide on ~96% of real conditions, and every one of those declines falls through
`graph-to-engine.ts:100` to the very expression the migration exists to remove.** ★★ **So "turn on
`TF_SEMANTIC_ROLE_CLASSIFIER`" would, on today's artifacts, change ~4% of labels and leave ~96%
topology-assigned — while the provenance record would say a semantic classifier produced them.**
★ The remaining ~96% is rule 6 — **gemma adjudication, network I/O, the async path** — which this run
did not execute and which is therefore on the critical path, not an optional refinement.

### 2 ★★★ THE CONTAMINATION IS VISIBLE IN THE NUMBERS: 11.3% vs 4.1%, A 2.75× GAP
**[MEASURED] the rules fire 2.75× more often on the 14 videos they were designed against than on the
26 they never saw** (per-video medians 10.7% vs 3.8% tell the same story, so it is not one outlier
video carrying the aggregate). ★★★ **That is the signature of rules tuned to their design text, and
it was invisible until the partition existed. A pooled 40-video number — 5.8% — would have hidden
it completely, which is exactly why you forbade pooling.**

### 3 ★★ THE SOURCE TEXT IS LOAD-BEARING — AND THAT IS THE ONE CLEAN POSITIVE
**ARM B fires on 0 of 2351.** Withholding the teacher's words drops the classifier from 4.1% to
**0.0%** — so **100% of ARM A's decisions are attributable to source text, and the A≠B set is exactly
the fired set.** ★★ **The pointer resolution is not decoration: without it there are no semantic
decisions at all.** ★ **And the by-shape check passes its own test — fired-rate varies by evidence
shape (`range` 19.3% · `brace-set` 9.8% · `plain` 7.1% · `verbatim/short` 3.0%) and `A≠B` equals
`fired` in every shape, which is the proof the resolver changed what the labeller saw.**

---

## SUPPORTING MEASUREMENTS

**Span verification:** `true` 1218 · `false` **20** · `n/a` 1113 (multi-pointer or non-pointer).
Unchanged from AR-397; the 20 remain excluded from any grading.
**Where rules fired (137 conditions), NEW role vs OLD role** — diagnostic only, **not an accuracy
claim**: new `spine` 91 · `confluence` 18 · `context` 15 · `or_branch` 13; those same conditions are
currently `spine` 56 · `confluence` 45 · `trigger` 31 · `invalidation` 5.

★★★ **SCOPE CORRECTION ON THAT LAST ROW, BECAUSE IT WOULD OTHERWISE OVERSTATE THE HARNESS.** In
production, `resolveConditionRole` is called **only** for non-terminal, non-invalidation atoms —
`trigger` and `invalidation` are assigned by atom TYPE at `graph-to-engine.ts:142-145` and never reach
the classifier. **My harness classified ALL conditions, so the 31 `trigger` + 5 `invalidation` rows
above are OUT OF THE PRODUCTION PATH. The applicable fired population is 101, not 137.** ★★ I report
the harness's real behaviour rather than silently filtering, and name the difference.

---

## WHAT THIS ARTIFACT DOES **NOT** CONTAIN (R-435: assigned to the advisor seat)

★★★ **No accuracy. No confusion matrix. No false-mandatory / false-optional rate. No
annotation-classified-executable, entry-trigger-missed or invalidation-missed counts.** All of them
require **ground truth per condition**, which is a GRADING act — doer ≠ grader. **The frozen,
complete input for that grading is `shadow_rows.json`** (2351 rows: `video · pop · arm · id · type ·
object · old_role · shape · resStatus · spanOk · resolvedLen · A_class · A_role · B_class · B_role ·
path`), held in the session scratchpad and **not committed, because it embeds live operator data.**
★ Say the word and I will attach it, or regenerate it deterministically from the frozen hashes above.

## REMAINING UNCERTAINTY

★ **[NOT MEASURED]** rule 6 / gemma adjudication — the ~96% margin. **It is now the critical path,
not a refinement.**
★ **[NOT MEASURED]** whether the 26-video clean arm has enough conditions per class to validate each
class; `mandatory` 46 vs `contextual` 7 suggests the rarer classes are thin.
★ **[NOT MEASURED]** whether normalization of the resolved clause (none was applied) would change the
fired rate.
★ **[NOT MEASURED]** freeze status of the `extraction-100` worktree.
