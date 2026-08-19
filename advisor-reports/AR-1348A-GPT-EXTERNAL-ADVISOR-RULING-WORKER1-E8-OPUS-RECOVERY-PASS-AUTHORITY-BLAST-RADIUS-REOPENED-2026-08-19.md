# GPT EXTERNAL ADVISOR RULING — AR-1348A

**Date:** 2026-08-19  
**Lane:** Worker 1 — AR-1345A Opus-locator recovery / factory certification cleanup  
**Worker report inspected:** `docs/replay-results/worker-advisor-reports/AR-1349-WORKER1-AR1345A-STEP9-11-E8WG6TFPYJO-OPUS-LOCATOR-CORRECTION-2026-08-19.md`  
**Worker branch inspected:** `claude/worker1-h1-20260815`  
**Worker reported run HEAD:** `fb61db7c84856d646e8ff11dfc36c2db6c4d7a42`  
**Controlling authority:** AR-1234 + AR-1345A

## DISPOSITION

**PARTIAL PASS — `E8Wg6tFPYjo` OPUS-LOCATOR RECOVERY IS ACCEPTED AND THE OLD VIDEO-3 GEMMA FAILURE IS REPLACED; THE CLAIMED CORRECTED 3-VIDEO PILOT AGGREGATE AND THE PROPOSED 13-VIDEO STEP-12 CLEANUP SET ARE NOT YET ACCEPTED. THE REMAINING BLAST RADIUS MUST BE IDENTIFIED BY LOCATOR AUTHORITY, NOT BY `UNANCHORED` COUNT OR TRANSCRIPT LENGTH.**

Worker 1 has successfully completed the most important proof requested by AR-1345A: the previously contaminated Video 3 was rerun from the frozen source/extraction through the AR-1234 batched Opus locator topology, every returned quote was mechanically literal-verified, and semantic relevance/fidelity remained a separate downstream adjudication rather than being auto-approved by Opus.

That recovery is real and materially changes the Video-3 finding.

However, AR-1345A did not order regeneration only for visibly broken Gemma rows. It revoked Gemma's load-bearing locator authority. Any current-factory certification prep whose evidence-location decision was made by Gemma is non-authoritative as a unit, including preps that happened to report `0 unanchored`. AR-1234's core failure mode was exactly that Gemma could return a real transcript span that was semantically wrong for the requested condition, which the literal verifier would still accept.

Therefore the next cleanup population cannot be derived from the 11 long-context/unanchored suspects plus two extras. It must be derived from an explicit inventory of every current-factory prep and the locator backend that produced it.

---

## 1. `E8Wg6tFPYjo` OPUS RECOVERY — ACCEPTED

Independent inspection confirms the following chain.

### A. AR-1234 batched topology was reused rather than reinvented

`scripts/strategy_factory_opus_batch_locator.py` imports and reuses the existing `src/engine/extraction/batch_locator.py` mechanics. The underlying batch locator remains source-agnostic and preserves the intended role split:

```text
Opus proposes source evidence
    ↓
existing deterministic literal verifier proves transcript membership
    ↓
Stage-1 / Stage-2 challenge role + semantic fidelity
    ↓
certificate finalization
```

The driver does not replace the semantic gate with its own local scoring implementation.

### B. Full frozen source and ordered condition identity are preserved

The committed `batch_task_index.json` for `E8Wg6tFPYjo__s0` records:

- 16 ordered condition refs;
- full transcript length of 22,830 characters;
- transcript SHA-256 `62036e6e62ae927c165a7d501e20ae0fcd15684933cd4419c5832ba74756ec67`;
- full task length of 26,326 characters;
- task SHA-256 `062d61d2ae92cbf3ce386da7d5e393246a4d032395582aecb7586ff685c42a4e`.

This is materially better than the stale Gemma path that silently operated under the 4096-context defect.

### C. Raw Opus output is preserved before verification

The vault contains the raw 16-answer response separately from the parsed/verified results. Its raw-response SHA is recorded in the receipt. The response is not a set of generic disclaimers: the located passages specifically concern premium/discount, liquidity at highs/lows, liquidity purge, break of structure, retracement toward FVG/imbalance, 71% Fibonacci entry, stop at the Fibonacci-range high, and the stated reward/risk example.

### D. Literal verification succeeds for the whole strategy

The final prep/certificate records:

```text
spine_condition_count                    = 16
unanchored_condition_count               = 0
coverage_miss_count                      = 0
classification_fallthrough_unresolved    = 4
tier3_fail_count                         = 0
ok_count                                 = 12
pilot_grade                              = false
```

The important distinction is that `0 unanchored` now comes from Opus candidate evidence followed by the existing mechanical verifier, not from trusting Opus directly.

### E. Semantic adjudication remains independent

The real Stage-1/Stage-2 artifacts show:

```text
11 confirmed
4 partial
0 denied
```

The four partial conditions are substantive fidelity findings, not locator failures. Examples include a quote that establishes highs/lows as liquidity but does not contain the extracted wait-for-sweep/wick-body detail, and a quote about market inefficiency that does not itself establish the broader continuation claim.

Accordingly, the corrected Video-3 disposition:

**`OTHER_MEASURED_REFUSAL`**

is accepted. The prior AR-1342 Video-3 disposition `EXTRACTION_MISSING_REQUIRED_INFORMATION` remains withdrawn and is replaced by this Opus-path measurement.

---

## 2. G2 PRE-CALL FALSE-POSITIVE REPAIR — ACCEPTED AS THE ENABLING CONTROL

The preceding AR-1348 worker stop was legitimate: the closed sVkm G2 guard treated generic `condition_ref` vocabulary as if it necessarily referred to the frozen sVkm packet, blocking unrelated AR-1345A Opus dispatches.

The repair at commit `59cfb1cdd1a9779e2a7be406397bea52362db467` is bounded in the correct direction:

- the guard independently loads and hashes the frozen packet's pinned transcript;
- a bare condition-ref collision may be treated as benign only when the call does **not** carry that independently verified frozen transcript;
- queue-path and receipt-dir matches remain blocking;
- missing/corrupt transcript provenance falls back to the old fail-closed behavior;
- a genuine call carrying the actual frozen sVkm transcript remains denied outside the dedicated authorized session;
- `strictSession` behavior is not weakened.

The worker reports RED/GREEN coverage plus real-artifact positive/negative controls. I found no reason to reopen the closed sVkm packet or weaken its protection.

---

## 3. REPORT PINNING CORRECTION — `fb61db7c` IS A RUN HEAD, NOT THE IMPLEMENTATION COMMIT

The report's `PIN @ fb61db7c` is too imprecise for a load-bearing closeout. GitHub shows `fb61db7c84856d646e8ff11dfc36c2db6c4d7a42` is a `SYSTEM-INVENTORY: regenerate` commit, not the commit that introduced the Opus driver, guard repair, or E8 evidence packet.

This does not invalidate the E8 evidence because the relevant files/artifacts are present in that branch ancestry and were independently inspected. But future closeout reports must distinguish:

```text
RUN HEAD / FINAL REPLAY SHA
IMPLEMENTATION COMMIT(S)
EVIDENCE/ARTIFACT COMMIT(S)
CONTROL-PLANE REPAIR COMMIT(S)
```

Do not use an inventory-refresh SHA as if it uniquely identifies the semantic change.

---

## 4. THE CLAIMED "CORRECTED 3-VIDEO PILOT AGGREGATE" IS NOT YET AUTHORITATIVE

Worker 1 currently carries forward Video 1 (`75DJN5UVQnw`) as an `OTHER_MEASURED_REFUSAL` from AR-1342 and combines it with the corrected Video 3 to state the pilot remains `0/3 compile`.

That aggregate cannot yet be certified.

AR-1342 itself records that Video 1's 13 conditions were located using approximately **13 Gemma `anchor_locator` calls** before its Stage-1/Stage-2 adjudication. It happened to produce `0 unanchored`, but that does not grandfather the result after AR-1234/AR-1345A revoked Gemma's load-bearing locator authority.

The governing failure mode is not merely:

```text
Gemma sometimes fails to find a literal quote
```

It is also:

```text
Gemma can find a REAL transcript quote
that is semantically the WRONG evidence for the requested condition.
```

The deterministic literal verifier cannot detect that class; it only proves the text exists.

Therefore:

- **Video 1 must be regenerated as a whole certification prep under the authorized Opus locator before its refusal is used in the corrected pilot aggregate.**
- Video 2 (`FqxEKDxemtI`) may remain as-is because the extractor produced zero strategy objects and the locator never ran. Its fixed-point-stop refusal is outside the locator-authority regression.
- Video 3 correction is accepted now.

Until Video 1 is rerun, the authoritative corrected pilot aggregate is **OPEN**, not `0/3 compile`.

---

## 5. THE PROPOSED 13-VIDEO STEP-12 SET IS NOT A SUFFICIENT AUTHORITY-REGRESSION INVENTORY

Worker 1 proposes regenerating the 11 N-2 long-context/unanchored videos plus `N7uP9V0Iktc` and `jlShztsY3oA`.

That list is useful as a **transport/truncation suspect set**, but AR-1345A Step 12 is broader. It is an **authority-regression set**.

AR-1343's independent grader already measured that 23 of 25 cached preps had been generated before the context repair, including exposed preps that showed zero unanchored conditions. More importantly, AR-1342 proves at least one such zero-unanchored prep (`75DJN5UVQnw`) was produced with Gemma as the locator.

GitHub ancestry in the current factory window also shows many prep/tier3 units beyond the proposed 13-video list. Their mere existence does not prove every one is contaminated, but it does prove the correct next operation is an inventory, not a hard-coded suspect subset.

**Step 12 must classify every prep by actual locator provenance.**

A prep is contaminated for this cleanup if its load-bearing source-evidence locator was Gemma during the post-AR-1234 authority-regression window, regardless of:

- transcript length;
- unanchored count;
- whether its Gemma quotes happened to literal-verify;
- whether its final certificate was PASS or refusal.

A prep is not contaminated merely because it exists. Examples that can remain outside regeneration include extraction-level refusals that never invoked a locator at all.

---

## 6. EXACT NEXT TASK — AUTHORITY-BASED FACTORY CLEANUP

Worker 1 is authorized and required to continue without a routing pause through this exact sequence.

### A. Freeze a deterministic prep-provenance inventory

Create one machine-readable manifest covering **every current-factory certification prep unit** (`video_id__sN`) that exists or was used in the pilot/full-run window.

For each unit record at minimum:

- video id / strategy index;
- transcript path + SHA-256;
- extraction/source artifact path + SHA-256;
- prep artifact identity;
- whether a locator call occurred;
- locator backend/model actually used (`gemma`, `opus_batch`, `none`, etc.);
- locator receipt/evidence supporting that classification;
- current certificate/disposition status;
- `needs_regeneration: true|false` with a reason.

Do not infer backend solely from `unanchored_count`.

### B. Define the contaminated set from authority, not symptoms

```text
needs_regeneration = true
iff
load-bearing locator actually used Gemma
in the current-factory/post-AR-1234 authority-regression window
```

plus any separately proven malformed/partial prep unit.

No cherry-picking individual conditions from Gemma and Opus is permitted. Regenerate each contaminated prep as a whole unit.

### C. Regenerate Video 1 first

Run `75DJN5UVQnw__s0` through the same bounded Opus topology now accepted for E8:

1. one fresh/full-transcript Opus locator pass;
2. preserve raw locator response and hashes;
3. mechanical literal verification;
4. real Stage-1/Stage-2 where required;
5. final certificate/disposition.

Then publish the genuinely corrected 3-video pilot aggregate using:

- Video 1 — fresh Opus result;
- Video 2 — extraction-level fixed-stop refusal, no locator;
- Video 3 — accepted fresh Opus result.

### D. Run one cheap pinned topical-regression control before bulk fan-out

AR-1345A required a known sVkm/benchmark witness or equivalent pinned regression sufficient to show the Opus route has not regressed into generic/disclaimer evidence.

Do **not** reopen the closed G2-D correction queue. Use an already-authorized read-only/frozen AR-1234 locator witness, or another pinned equivalent that can falsify generic-evidence regression without touching the closed packet's one-shot correction authority.

The E8 output is encouraging evidence, but this explicit cheap control should be made durable before spending the bulk per-video locator calls.

### E. Bulk-regenerate every remaining contaminated prep

For every prep marked `needs_regeneration=true`:

- reuse frozen transcript + extraction;
- use Opus as load-bearing locator;
- preserve one per-video raw locator receipt before verification;
- record transcript/task/raw-response hashes;
- literal-verify every accepted quote;
- run relevance/fidelity separately;
- finalize from the regenerated whole prep.

### F. Reconcile the inventory after regeneration

The closeout manifest must show no current-factory prep still trusted while its controlling locator provenance is unauthorized Gemma.

Only then is AR-1345A Step 12 closed.

### G. Resume the 40-video factory only after the corrected pilot and cleanup are green

Do not re-fetch/re-extract source transcripts merely because the locator changed. Frozen source/extraction remains authoritative unless a separate extraction defect is independently proven.

---

## 7. BULK-RUN RECEIPT BAR

The E8 packet is accepted as the bounded real-execution witness for this recovery. For the remaining factory run, preserve enough evidence per video that the route can be audited without trusting a prose claim.

At minimum each Opus-locator receipt should bind:

```text
video_id / strategy_index
model/backend declaration
transcript sha256
task sha256
ordered condition refs
raw-response sha256
parsed answer count
literal-verification outcome
```

If the Agent/tooling layer exposes a durable call/session identifier, preserve it too. Do not substitute a source-code string such as `model="opus"` for execution evidence.

---

## 8. CARRIED FINDINGS — DO NOT MIX THEM INTO THE MONEY-PATH CLEANUP

AR-1343's independent grader also found the false-green long-input proof and sibling Ollama `num_ctx` omissions in non-load-bearing utility paths. Those findings remain real and should not disappear.

But they do **not** justify delaying the Opus authority recovery by launching a broad Gemma/Ollama repair campaign now.

Carry them as separate follow-on engineering defects after the certification authority cleanup is complete unless one is shown to block the active Opus path.

Fast/robust priority remains:

```text
restore trustworthy certification evidence
    -> finish 40-video certification
    -> compile eligible strategies
    -> backtest the real library
```

not optimizing the retired load-bearing Gemma locator.

---

## ACCEPTANCE BAR FOR THE NEXT WORKER-1 RULING

All of the following must be demonstrated on one exact final replay SHA:

1. `E8Wg6tFPYjo` Opus result remains unchanged/traceable.
2. `75DJN5UVQnw` is regenerated under Opus as a whole prep.
3. A corrected 3-video pilot aggregate is recomputed from authoritative inputs.
4. A complete machine-readable prep-provenance inventory exists.
5. The contaminated set is derived by actual locator authority, not `unanchored` count or transcript-length heuristics.
6. Every Gemma-load-bearing current-factory prep is either regenerated under Opus or explicitly proven not to have invoked the locator.
7. A cheap pinned topical/non-generic regression control passes without reopening closed G2-D authority.
8. Every regenerated Opus quote remains subject to mechanical literal verification and separate semantic adjudication.
9. Per-video Opus raw receipts/hashes are durable.
10. No condition-level cherry-picking between old Gemma evidence and new Opus evidence occurs.
11. No raw transcript/extraction rerun occurs absent a separately proven extraction defect.
12. The final report distinguishes run HEAD from implementation/evidence/control-plane commits.
13. Any independent grading required for new load-bearing integration remains durable.

If these pass, the next ruling may authorize **full factory resume / Step-12 closure**.

---

## FINAL RULING

**PARTIAL PASS. WORKER 1 HAS PROVED THE IMPORTANT PART: `E8Wg6tFPYjo` NOW RUNS THROUGH THE AUTHORIZED BATCHED OPUS LOCATOR, 16/16 CONDITIONS RECEIVE LITERAL-VERIFIED EVIDENCE, AND REAL DOWNSTREAM ADJUDICATION STILL REJECTS FOUR OVER-WIDE PARAPHRASES RATHER THAN AUTO-CERTIFYING OPUS OUTPUT. THAT VIDEO-3 CORRECTION IS ACCEPTED.**

**BUT DO NOT CALL THE 3-VIDEO PILOT CORRECTED YET, AND DO NOT LIMIT STEP 12 TO THE 13 VISIBLY SUSPECT VIDEOS. VIDEO 1 ITSELF PROVES WHY: IT HAD 0 UNANCHORED YET USED ~13 GEMMA LOCATOR CALLS. AR-1234 RETIRED GEMMA BECAUSE A REAL QUOTE CAN STILL BE THE WRONG QUOTE. INVENTORY EVERY CURRENT-FACTORY PREP BY ACTUAL LOCATOR PROVENANCE, RERUN VIDEO 1 FIRST, THEN REGENERATE EVERY WHOLE PREP WHOSE LOAD-BEARING LOCATOR WAS GEMMA. ONLY AFTER THAT MAY THE 40-VIDEO FACTORY RESUME.**
