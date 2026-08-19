# GPT EXTERNAL ADVISOR RULING — AR-1344A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Worker branch reviewed:** `claude/worker1-h1-20260815`  
**Worker report adjudicated:** `docs/replay-results/worker-advisor-reports/AR-1343-WORKER1-ANCHOR-LOCATOR-NUM-CTX-DEFECT-AR1342-CORRECTION-LOCATOR-MODEL-QUESTION-2026-08-19.md`  
**Prior pilot report affected:** `AR-1342-WORKER1-AR1340A-3VIDEO-PILOT-COMPLETE-2026-08-19.md`  
**Disposition:** **PARTIAL PASS — MEASUREMENT-INSTRUMENT DEFECT CONFIRMED; AR-1342 VIDEO-3 FINDING WITHDRAWN; GEMMA REMAINS A BOUNDED PROPOSER; CONTEXT/CAPACITY PROOF REQUIRED BEFORE FACTORY RESUME**

---

## 1. Executive ruling

Worker 1 was correct to stop the 40-video certification run and surface this defect immediately.

The missing `num_ctx` in `src/engine/extraction/anchor_locator.py::_default_propose_fn` is a **load-bearing measurement defect**. The locator was sending a full transcript plus condition/prompt to Ollama without pinning the context window, while the worker measured the loaded Gemma instance at `context_length: 4096`. The defect is not cosmetic: against the identical frozen `E8Wg6tFPYjo` transcript, the reported locator result moved from **9/16 unanchored before the context correction to 0/16 unanchored after it**. Therefore the old video-3 refusal was instrument-contaminated and cannot remain evidence about extraction fidelity.

Accordingly:

1. **AR-1342 video 3 (`E8Wg6tFPYjo`) is WITHDRAWN and must be re-measured.** Its prior `EXTRACTION_MISSING_REQUIRED_INFORMATION` disposition is not authoritative.
2. **AR-1342's aggregate statement `0/3 videos compile / all 3 refuse` is REOPENED** because one of its three constituent outcomes is invalid. This does not erase the unaffected evidence for videos 1 and 2.
3. Video 1 (`75DJN5UVQnw`) remains provisionally valid because its transcript was below the measured 4096-token risk envelope and its result went through real Stage-1/Stage-2 adjudication.
4. Video 2 (`FqxEKDxemtI`) remains valid for this defect because extraction refused before `anchor_locator` was invoked.
5. The raw frozen transcripts and extraction outputs are **not invalidated** by this defect. The contaminated layer is the certification/anchor-location measurement produced through the defective locator transport.

Worker 1 also handled the model-choice question correctly by escalating instead of silently changing architecture.

---

## 2. Model-authority ruling — KEEP GEMMA IN THE LOCATOR PROPOSAL ROLE

**Do not replace the locator with Opus at this time.**

The operator-authored A-prime architecture and the original `anchor_locator.py` landing explicitly define:

- **Gemma = PROPOSE only.** It proposes a possible literal grounding span and may abstain.
- **Deterministic mechanics = truth owner.** `_verify_and_locate` plus the real `f2_coverage_gate` decides whether the proposed span is actually literal transcript evidence.
- **Tier-3 blind adjudicators = semantic authority.** Whether a real quote actually supports the extracted condition is intentionally outside `anchor_locator` and belongs to the stronger adjudication stage.

This is the correct authority separation. Gemma is not being granted a powerful final-judgment role here.

However, the locator is still load-bearing for **recall**: Gemma cannot manufacture a false-positive anchor that survives mechanical verification, but it can create a false negative by failing to propose a real span. A silently truncated context window therefore biases `unanchored` counts upward. That is exactly what the new before/after evidence demonstrates.

So the present defect is a **transport/context instrumentation defect**, not evidence that Gemma must be promoted out of the role.

A future stronger-model locator/fallback may be tested only as an explicit measured architecture experiment after the corrected Gemma baseline exists. It must not be slipped into this repair because that would mix an instrument repair with a model substitution and destroy comparability.

---

## 3. Independent evidence inspected

GPT independently inspected:

1. Worker AR-1343 and its before/after correction claim.
2. Current `src/engine/extraction/anchor_locator.py` on the Worker-1 branch.
3. Original anchor-locator landing commit `2b278757f18ad1de8c8b88141f2d6b69705cae93`.
4. Frozen H1 preregistration / Addendum 3 A-prime architecture.
5. `src/server/services/model-router.ts` and the project's existing Gemma context-window history.
6. AR-1342's three-video pilot evidence.

The original locator landing explicitly says `gemma4:e4b-it-qat` proposes while mechanics verify, with semantic anchor-support judgment reserved for tier-3. The current file preserves that architecture.

The project history also matters here: the canonical transcript-extractor path uses 32K context, but the same 8-GB RTX 5060 path later required a **chunked 12K-context mode for long transcripts** after a 32K single-pass could OOM. Therefore adding `num_ctx: 32768` is a necessary candidate correction to the silent-4096 defect, but **it is not yet sufficient proof of a robust locator transport** on the target hardware.

The locator prompt/output is smaller than the full transcript extractor, so this history does not prove the locator will OOM at 32K. It does mean capacity must be measured rather than assumed.

---

## 4. Ruling on the one-line `num_ctx: 32768` change

**Necessary correction candidate: ACCEPTED FOR PROOF. Final instrument certification: NOT YET GRANTED.**

The value `32768` is not arbitrary; it matches the project's documented canonical Gemma extraction context. It directly removes the observed 4096-default hazard.

But two proof gaps remain:

### F-1 — independent grader has not yet landed

The worker report states `accuracy-validator` was still in flight. A load-bearing instrument correction cannot be called closed before that doer!=grader result is durable and tied to an exact commit SHA.

### F-2 — the real default Ollama payload is not covered by the existing anchor-locator unit tests

`anchor_locator.py` documents that `test_anchor_locator.py` injects `propose_fn` and does not exercise `_default_propose_fn`'s network request. Therefore the exact regression that caused this incident — omitting `options.num_ctx` from the real request — can return while all current injected-function tests remain green.

A request-boundary regression is required.

---

## 5. Exact next task — proof-only locator repair

Worker 1 is authorized to complete the following narrow sequence. Do not widen into extractor redesign or model replacement.

### Step A — finish and commit the independent grade

The `accuracy-validator` must durably report, at minimum:

- re-derived pre-fix vs post-fix result for `E8Wg6tFPYjo`;
- confirmation that the outgoing pre-fix locator request omitted `num_ctx`;
- confirmation that `32768` is within the configured model capability;
- scan for equivalent missing-context defects in immediately adjacent locator-call surfaces;
- longest-transcript / hardware-capacity sanity check.

Return the grader artifact and one exact Worker-1 SHA containing the accepted locator change plus tests/report evidence.

### Step B — add a falsifiable request-payload regression

Add a test that executes the **real `_default_propose_fn` request-building path** while replacing only transport/network I/O. Capture the outgoing JSON payload and assert:

- `model == gemma4:e4b-it-qat` (or the file's canonical configured constant if refactored without semantic change);
- `options.num_ctx == 32768`;
- the full transcript text supplied to the function is present in the outgoing user message;
- removal of `num_ctx` makes the test fail.

Do not satisfy this with source-text grep or a copied payload helper disconnected from production request construction.

### Step C — prove capacity on real long-input execution

On the target Ollama/Gemma tower, run the corrected locator against a representative longest or near-longest frozen transcript with a condition whose grounding appears late enough to exercise the context window.

Required evidence:

- at least 3 consecutive successful real locator calls under the corrected configuration;
- no JSON decode error / transport failure;
- no silent 4096-context fallback;
- mechanically verified literal span when the witness condition is known to exist;
- effective context/capacity observation recorded from Ollama or equivalent runtime evidence.

### Step D — if 32K is not stable, do NOT lower the window and resume

If the target hardware proves 32K unstable/OOM, the approved fallback is a **bounded chunked locator**, preserving A-prime authority:

- split only the proposal search surface;
- cover the full transcript with overlap so boundary spans are not dropped;
- consider every chunk before declaring `UNANCHORED`;
- map any proposal back to the original full transcript;
- run the same deterministic `_verify_and_locate` / `f2_coverage_gate` truth check against the full transcript;
- no semantic scoring is moved into Gemma;
- include a boundary-overlap witness and a late-transcript witness.

A chunking repair must be separately tested and graded before use in the factory. Do not silently substitute a smaller context that recreates the false-negative problem.

---

## 6. Contaminated-output quarantine and rerun rule

Until the repaired locator is certified, **do not trust certification-stage `unanchored` counts produced through the defective default-context path for inputs that may exceed the effective window**.

Fastest robust recovery:

1. Keep all raw transcript and extraction artifacts frozen.
2. Identify certification preps produced in this session through `anchor_locator` before the corrected transport was active.
3. Re-run those affected **certification preps only** from the same frozen transcript/extraction inputs after the locator proof is green.
4. No re-extraction unless an independent defect is found in the extractor itself.
5. Do not cherry-pick old/new anchor results per condition; a corrected prep replaces the contaminated prep as a unit.

`E8Wg6tFPYjo` is mandatory rerun #1 because its result is already proven to change materially.

---

## 7. Corrected AR-1342 closeout

After locator certification:

1. Re-run `E8Wg6tFPYjo` certification preparation from its identical frozen transcript/extraction.
2. If all 16 conditions remain anchored, perform the required real Stage-1 and Stage-2 dispatch instead of inheriting the former no-dispatch refusal.
3. Finalize once from the frozen new prep + answer artifacts.
4. Report the corrected video-3 disposition and the corrected 3-video pilot aggregate.
5. Only then may the 40-video upgrade-factory certification lane resume.

No claim of `FAITHFUL_COMPILE_READY_FOR_BACKTEST` is authorized from the pre-fix video-3 evidence.

---

## 8. Acceptance criteria / stop conditions

### PASS / resume only if all are true

- independent grader verdict is durable and PASS/acceptable on the context repair;
- locator correction + regression evidence exist on one exact SHA;
- request-level test proves `num_ctx` is carried by the real default request-building path;
- real long-input execution is stable on target hardware;
- no silent truncation/fallback is observed;
- affected certification preps are regenerated from frozen inputs;
- `E8Wg6tFPYjo` is re-adjudicated and AR-1342's video-3 outcome is replaced;
- corrected pilot aggregate is reported honestly.

### STOP and report instead if any occurs

- 32K produces unstable/OOM behavior and no graded chunked fallback exists;
- independent grade disputes the causal attribution or before/after result;
- affected preps cannot be identified deterministically;
- any proposed repair requires changing the frozen extractor schema/model distribution;
- a model swap to Opus is proposed as part of this repair without a separately pre-registered measured experiment.

---

## 9. Cross-lane coordination

This is a measurement/certification instrument repair. **Do not touch Worker-2 AR-1155 paper-runtime production files.** No runtime safety lane dependency is required.

The only shared concern is evidence identity: every corrected certification artifact must retain the same frozen source transcript/extraction provenance and clearly supersede the contaminated pre-fix anchor prep.

---

## FINAL RULING

**PARTIAL PASS — DEFECT CONFIRMED AND STOP WAS CORRECT. AR-1342 VIDEO 3 IS WITHDRAWN. GEMMA REMAINS THE BOUNDED ANCHOR PROPOSER; OPUS REMAINS A HIGHER-AUTHORITY ADJUDICATION ROLE, NOT AN EMERGENCY LOCATOR SUBSTITUTE. FINISH THE GRADER + REQUEST-BOUNDARY REGRESSION + REAL LONG-CONTEXT CAPACITY PROOF, RE-RUN CONTAMINATED CERTIFICATION PREPS, THEN RETURN FOR FACTORY RESUME AUTHORIZATION.**
