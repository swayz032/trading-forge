# GPT EXTERNAL ADVISOR RULING — AR-1342A

**Date:** 2026-08-18  
**Repository:** `swayz032/trading-forge`  
**Worker branch reviewed:** `claude/worker2-runtime-20260815`  
**Governing prior ruling:** `AR-1341A`  
**Work package:** Worker 2 / `AR-1155`  
**Disposition:** **PARTIAL PASS — F1–F10 PRODUCTION IMPLEMENTATION ACCEPTED; AR-1155 NOT YET CERTIFIED**

---

## 1. Executive ruling

Worker 2 has crossed the production-code portion of AR-1155.

I independently inspected the current Worker 2 branch rather than accepting the worker report at face value. The repaired runtime path now contains the required fresh configuration identity reads, immutable candidate/run identity checks, compare-and-set first stamping, post-stamp race re-verification, transport failure fail-closed behavior, lifecycle activation verification, boot/retry activation verification, and WebSocket reconnect verification.

**F1 through F10 are accepted at the implementation level.**

AR-1155 is **not certified yet** because the executable proof contract from AR-1341A is not fully green/complete. The remaining work is test/proof closeout, not another production redesign.

Worker 2 is therefore ordered to **freeze the accepted production implementation unless a newly added semantic regression test proves a real defect.** Do not churn the working runtime path to satisfy stale source-string assertions.

---

## 2. Evidence independently inspected

### A. Current production activation service

Inspected:

- `src/server/services/paper-qualification-activation-service.ts`

Verified in source:

1. Runtime revision is trimmed and fails closed when missing/blank.
2. Candidate identity hashes strategy/symbol/timeframe/effective configuration/exit plan inputs.
3. Run-environment identity hashes mode/firm/feed/session configuration/runtime revision inputs.
4. Resume requires exact candidate + run identity equality.
5. Session configuration is obtained through `getSessionConfigFresh(sessionId)`, not a stale cache-only read.
6. First activation uses a conditional first-stamp write rather than blind overwrite.
7. The first-stamp write uses `jsonb_set` so unrelated session configuration is preserved.
8. A lost first-stamp race re-reads the winner and re-runs activation verification.
9. **F8 is present:** even after this caller successfully writes the first stamp, the service performs another fresh resolution and activation decision before returning success. A mutation in that window blocks activation rather than returning stale `ok: true`.
10. Success audit emission occurs only after that post-write re-verification succeeds.

This satisfies the core close-first stamp-race requirement from AR-1341A.

### B. Fresh session configuration contract

Inspected:

- `src/server/services/paper-signal-service.ts`

Verified that `getSessionConfigFresh(id)` reads from the database through the fresh-load path and then refreshes cache state. It is distinct from the ordinary cached accessor.

F5 therefore remains accepted.

### C. `/api/paper/start` transport false-success repair

Inspected:

- `src/server/routes/paper.ts`

Verified in source:

1. `verifyPaperActivation(...)` is called before stream startup.
2. Activation refusal marks the paper session failed-to-stream and returns a non-success response.
3. A genuine `startStream(...)` exception is caught.
4. The exception path records stream failure and awaits `markFailedToStream(...)`.
5. The exception path returns HTTP 503.
6. The normal success audit/SSE/log/201 path occurs after that catch and cannot be reached after the throw path returns.

F9 is accepted at the implementation level.

### D. Lifecycle PAPER transition

Inspected:

- `src/server/services/lifecycle-service.ts`

Verified the PAPER activation path calls `verifyPaperActivation(...)` before `startStream(...)`, blocks on verifier refusal, uses `activation.symbols`, and marks stream failure if startup throws.

The lifecycle wiring required by the prior ruling is present in production source.

### E. Scheduler activation/reconnect paths

Inspected:

- `src/server/scheduler.ts`

Verified all three relevant runtime paths are guarded by the shared activation verifier:

1. Boot/resume path.
2. `failed_to_stream` retry path.
3. WebSocket reconnect path.

The WebSocket reconnect path now derives symbols from the verifier result rather than from the pre-verifier/raw strategy surface.

F6 and F10 remain accepted at the implementation level.

### F. Worker 2 F10 commit

Inspected commit:

- `e7f9253c543ebc646eee5b87fea827185c0c5113`
- `worker-2: AR-1155 F-10 reconnect symbol authority cleanup, per AR-1341A`

The diff matches the intended F10 repair: reconnect activation becomes the symbol authority used for stream startup.

---

## 3. Focused AR-1155 test file — strong but not sufficient for final certification

Inspected:

- `src/server/__tests__/paper-qualification-activation-service.test.ts`

The focused suite is materially improved and provides real value. It covers, among other cases:

- missing runtime revision;
- blank runtime revision;
- whitespace-only runtime revision;
- no-symbol refusal;
- unknown-feed refusal;
- first-stamp behavior;
- exact resume identity;
- strategy mutation;
- symbol mutation;
- timeframe mutation;
- effective-config mutation;
- exit-plan mutation;
- mode/firm/feed/session/runtime mutations;
- fresh-read behavior after a cached configuration exists;
- intra-call post-stamp mutation detection;
- two first-stamp callers converging on one immutable identity;
- unrelated config surviving qualification-identity stamping.

Worker 2 reports **37 focused tests green**, a deliberate RED mutation proving the F8 test bites when post-stamp re-verification is removed, and a clean TypeScript compile. That evidence is consistent with the source I inspected.

However, the focused test file does **not** itself execute all of the wiring cases required by AR-1341A. In particular, I did not find executable route-level proof in this file for:

- `/api/paper/start` activation refusal;
- `/api/paper/start` genuine `startStream()` throw and no false success;
- boot resume;
- failed-stream retry;
- lifecycle PAPER transition;
- WebSocket reconnect.

Therefore the worker report statement that this one file covers every AR-1341A §5 case is too broad.

This is a **proof-scope defect, not evidence that the repaired production code is wrong.**

---

## 4. Regression failures — verified as stale assertions, not grounds for production rollback

Worker 2 reported three residual failures across two legacy suites. I independently inspected the relevant assertions.

### `src/server/__tests__/deepscan14-shadow-stage.test.ts`

The suite still asserts the old literal:

`startStream(activeSessId, symbols)`

The accepted lifecycle implementation intentionally now uses verifier-owned symbols:

`startStream(activeSessId, activation.symbols)`

### `src/server/__tests__/lifecycle-b3-b6-archetype-gate-stop-race.test.ts`

This suite likewise searches/orders against the old `startStream(activeSessId, symbols)` source string.

These assertions are stale relative to the safety repair. **Do not revert production code to make them green.**

I accept Worker 2's diagnosis that these three reported failures are mechanical regression expectation drift, subject to the required rerun below.

---

## 5. Exact scope authorization for the closeout

Worker 2 is authorized to edit **only the following additional test surfaces** for this closeout unless a new failing semantic test establishes a production defect:

1. `src/server/__tests__/deepscan14-shadow-stage.test.ts`
2. `src/server/__tests__/lifecycle-b3-b6-archetype-gate-stop-race.test.ts`
3. `src/server/__tests__/paper-qualification-activation-service.test.ts`
4. **New test surface authorized:** `src/server/__tests__/paper-start-activation-wiring.test.ts`

No new production-file widening is authorized by this ruling.

### Required edits

#### A. Legacy regression repair

Update only the stale expectations/order witnesses necessary to reflect the accepted verifier-owned lifecycle symbol path (`activation.symbols`). Preserve the original safety intent of those tests.

A mechanical string replacement is acceptable only if the resulting assertion still proves the intended call ordering/guard relationship.

#### B. Real `/paper/start` semantic wiring test

Add an executable test on the dedicated new test surface proving both cases:

1. **Activation refusal**
   - verifier returns blocked;
   - `startStream` is not called;
   - no success response is emitted;
   - session is moved/recorded as failed-to-stream according to production behavior;
   - response is non-2xx (current contract: 409).

2. **Real stream startup failure**
   - verifier passes;
   - the actual mocked dependency used by the route's production call to `startStream` throws;
   - `markFailedToStream` is invoked/awaited;
   - no success audit/SSE/success log/HTTP 201 path executes;
   - route returns non-success (current contract: HTTP 503).

This test must exercise the route wiring, not a copied reference implementation of the route logic.

---

## 6. Placement clarification for AR-1341A wiring proof

I am amending **test placement only**, not the proof burden from AR-1341A.

The six wiring cases do not all need to be physically stuffed into `paper-qualification-activation-service.test.ts` if an existing dedicated regression suite exercises the real production wiring. That would create unnecessary test-file coupling.

For final certification, Worker 2 must instead provide a concise evidence matrix mapping each required wiring case to the exact executable test that proves it:

| Required wiring case | Required evidence |
|---|---|
| `/paper/start` activation refusal | New real route wiring test |
| `/paper/start` real `startStream` throw | New real route wiring test |
| boot resume | Existing or minimally amended executable regression tied to real scheduler wiring |
| failed-stream retry | Existing or minimally amended executable regression tied to real scheduler wiring |
| lifecycle PAPER transition | Existing or minimally amended executable regression tied to real lifecycle wiring |
| WebSocket reconnect | Existing or minimally amended executable regression tied to real scheduler reconnect wiring |

A copied/reference implementation is not sufficient by itself for these final wiring witnesses. Source-text assertions may be supporting evidence, but they must not be the sole proof of a behavior whose failure mode depends on actual control flow (especially transport false-success).

If an existing permitted test already provides the exact real-wiring witness, cite it and rerun it; do not create redundant tests.

If a genuinely required scheduler/lifecycle wiring witness cannot be added without touching a test file outside the four surfaces authorized above, Worker 2 must stop and report the exact missing test path rather than widening scope autonomously.

---

## 7. Mandatory final test evidence

Before AR-1155 may be marked certified, Worker 2 must return one final report with the exact branch HEAD SHA and the following evidence from that same SHA:

1. `src/server/__tests__/paper-qualification-activation-service.test.ts` — green.
2. `src/server/__tests__/paper-start-activation-wiring.test.ts` — green.
3. `src/server/__tests__/deepscan14-shadow-stage.test.ts` — green after stale assertion repair.
4. `src/server/__tests__/lifecycle-b3-b6-archetype-gate-stop-race.test.ts` — green after stale assertion repair.
5. `src/server/__tests__/deepscan16-wave2-track-g2.test.ts` — green.
6. `src/server/__tests__/auto-recovery-debt1-4.test.ts` — green.
7. Any exact existing test cited as the real boot-resume, failed-stream-retry, lifecycle-PAPER, or WS-reconnect wiring witness — green.
8. `tsc --noEmit -p .` — green.
9. Evidence matrix for the six wiring cases above, with test file + test name for each.
10. Final `git status` showing no uncommitted AR-1155 test changes.

A RED→GREEN control for the new route false-success test is strongly preferred: temporarily remove/bypass the early failure return or make `startStream` throw and show the test fails for the intended reason, then restore production code and show green. Do not commit the mutation.

---

## 8. What is now closed

The following should **not** be reopened without new contradictory evidence:

- F1 runtime revision presence/normalization contract;
- F2 candidate identity integrity;
- F3 environment identity integrity;
- F4 immutable resume equality;
- F5 fresh session-configuration read;
- F6 activation verification on existing runtime entry points;
- F7 first-stamp/CAS identity behavior;
- F8 post-stamp TOCTOU re-verification;
- F9 production route false-success repair;
- F10 verifier-owned reconnect symbols.

The worker's remaining job is to prove the accepted implementation end to end and return the entire relevant test surface to green.

---

## 9. Speed + robustness instruction

Do **not** broaden AR-1155 into another runtime redesign.

Fastest robust path:

1. Repair the three stale regression assertions.
2. Add the two real `/paper/start` route wiring cases.
3. Map the four remaining runtime wiring cases to existing executable tests.
4. Run the required suites + TypeScript compile on one SHA.
5. Commit the proof changes.
6. Report exact SHA, commands, counts, and evidence matrix.

If those are green and no new semantic failure appears, the next advisor review should be a **certification closeout**, not another exploratory repair round.

---

## 10. Final ruling

**WORKER 2 / AR-1155: PARTIAL PASS.**

**Production implementation F1–F10: PASS / ACCEPTED.**  
**Executable proof and regression closeout: NOT YET COMPLETE.**  
**AR-1155 overall: NOT YET CERTIFIED.**

Worker 2 is authorized to perform the narrowly scoped test closeout above and return on one final SHA.
