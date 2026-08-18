# GPT EXTERNAL ADVISOR RULING — AR-1320A

**Date:** 2026-08-18  
**Repository:** `swayz032/trading-forge`  
**Worker branch:** `claude/worker1-h1-20260815`  
**Current Worker HEAD inspected:** `81fa62c31f4d86c3c24c377dcc04e3268283cd86`  
**Disposition:** **F36 LIVE-CLOSED. WORKER-1 RETURNS NOW TO ITS PERMANENT `compiler-factory` LANE. THE NEXT TASK IS THE PARKED DETERMINISTIC G2 / SOURCE-TRUTH EXTRACTION CORRECTION, FOLLOWED BY THE SAME STRICT REGRADE. NO NEW AGENT/OPUS CALLS.**

## 1. ROUTING CORRECTION — PERMANENT ROLE VS TEMPORARY INCIDENT

Worker-1's permanent lane is `compiler-factory` (`Graph Engineering -> Compiler -> Strategy Factory`). The F36/control-plane campaign was a temporary blocking incident inside that lane's dependency chain; it did not replace Worker-1's permanent role.

F36 is now live-closed on Worker-1 HEAD `81fa62c3...` after:

- AR-1319 live propagation commit `19c637738396ff58961dd578c1bfdc5163b12f57`;
- AR-1320 independent verification commit `43020542afc95e3f98251746e7ed069c15824e28`;
- top-level merge-back commit `81fa62c31f4d86c3c24c377dcc04e3268283cd86`.

Therefore a fresh Worker-1 session MUST NOT treat the newest historical F36 ruling as a standing assignment after F36 has landed. Once a temporary blocking packet is closed, routing returns automatically to the permanent lane unless a newer open ruling explicitly assigns another task.

**Current permanent work:** compiler-fidelity / source-truth extraction, then compiler continuation.

## 2. THE FROZEN EIGHT ARE HISTORY — DO NOT "FIX" THEM

The frozen queue artifact `isolated_fallback_queue_t1.json` intentionally remains historical and contains `attempts: {}`. Separately, the eight isolated calls were legitimately dispatched once, recovered, and deterministically graded in AR-1312/AR-1312A/AR-1313 history.

The existence of completed dispatch/permit/raw/completion receipts does NOT authorize rewriting the frozen queue ledger, deleting receipts, or re-dispatching those rows.

Accordingly:

- DO NOT delete or modify the existing isolated receipts;
- DO NOT rewrite `attempts` merely to make an old preflight say `spent > 0`;
- DO NOT use any `8 ready / 0 spent` launch preflight as an instruction to dispatch again;
- DO NOT make any new Agent/Task/Opus/model call for this slice;
- preserve all historical artifacts byte-for-byte unless an explicit later ruling authorizes a derived successor artifact.

The old launch preconditions served the one-shot call campaign. That campaign is over.

## 3. ACTUAL OPEN COMPILER-FIDELITY DEFECTS

The certified frozen extraction `docs/replay-results/svkm-extraction-certified/sVkmZklJDHI.json` contains source-strengthening language that the strict route correctly rejects. At minimum, the current slice exposes:

1. `entry_sequence[1].rationale` — extraction says **"The breakout confirms the market direction..."** while the pinned transcript evidence says **"That gives us an idea of the direction in which the market wants to go for the day."** This is certainty inflation.
2. `entry_sequence[2].rationale` — extraction says **"high-probability entry point"** without source support for that probability claim.
3. `entry_sequence[3].rationale` — extraction says the entry **"minimizes entry risk"** without source support for that causal/risk claim.
4. `confluences[0].description` — extraction widens the teacher's point-in-time `9:30 a.m. Eastern time` instruction into a `during ... session` window.
5. `entry_sequence[1].action` and `confluences[1].description` remain a duplicate-role authoring problem and must not be silently deduplicated merely to improve the grade.

These are upstream source-truth/compiler-fidelity defects, not a reason to loosen the relevance/fidelity/collision gates.

## 4. NEXT EXECUTION — FAST + ROBUST

Worker-1 is authorized to proceed immediately, without another GPT pause, on ONE bounded source-truth correction packet:

### Lane A — find the existing revision seam

Inspect the current repository for an existing derived extraction revision/correction mechanism that can take the frozen extraction as immutable input and produce a successor source-truth artifact with explicit provenance.

- Reuse an existing mechanism if it exists.
- Do not invent a new framework.
- Do not mutate the original certified extraction in place.

### Lane B — if no existing seam exists, create the smallest explicit derived revision artifact

If the repository genuinely has no existing correction seam, create the smallest derived artifact necessary to express only source-supported corrections while preserving:

- original extraction path/hash;
- transcript path/hash;
- exact field-level before/after values;
- literal transcript evidence supporting each correction;
- explicit statement that historical source artifacts remain unchanged.

This is a revision artifact, not a new extraction architecture.

### Lane C — same production grading path

Run the corrected derived condition set through the SAME existing deterministic grading machinery:

`g2d_finalizer.finalize()` -> `opus_phase1_route.run_route()`

with:

- the same strict collision law;
- the same relevance gate/floor;
- the same term-equivalence law;
- the same fidelity guard;
- zero new Agent/Task/model calls;
- no second comparator;
- no pick-the-greener fallback;
- no alias/synonym addition solely to improve this grade.

`scripts/g2d_ar1313_regrade_tmp.py` may be inspected as evidence of how the existing route is invoked, but **do not turn additional hard-coded `CORRECTED_EVIDENCE` entries in a temporary regrade script into the permanent source-truth fix.** Evidence packaging and source-condition correction are separate concerns.

### Lane D — report the exact result, even if still RED

Report:

1. exact Worker HEAD and changed-file set;
2. which source-truth fields changed and literal transcript support for each;
3. proof original frozen extraction/queue/receipts stayed unchanged;
4. zero Agent/Task/model calls;
5. exact same-pipeline before/after disposition for all 12 conditions;
6. accepted count and grade;
7. every remaining RED/HOLD with classification: source wording, duplicate authoring, evidence packaging, relevance discrimination, or other.

A negative result is acceptable. Do not weaken law to force GREEN.

## 5. WHAT HAPPENS AFTER THIS SLICE

Once this bounded source-truth correction/regrade is closed, Worker-1 continues automatically inside its permanent lane:

`source-truth extraction fidelity -> deterministic compiler -> Strategy Factory`

Do not return to F36/guard architecture unless a new, independently observed live defect appears. Do not ask the operator whether compiler work belongs to Worker-1; it does.

**FAST + ROBUST rule:** no guard side quests, no new Opus campaign, no architecture rewrite. Correct the source-truth input, prove it through the existing strict route, then continue the compiler path.
