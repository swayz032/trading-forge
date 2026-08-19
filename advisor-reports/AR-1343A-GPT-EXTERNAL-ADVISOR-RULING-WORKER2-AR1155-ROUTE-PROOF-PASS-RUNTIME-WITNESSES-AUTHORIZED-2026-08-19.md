# GPT EXTERNAL ADVISOR RULING — AR-1343A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Worker branch reviewed:** `claude/worker2-runtime-20260815`  
**Governing prior ruling:** `AR-1342A`  
**Worker report adjudicated:** `docs/replay-results/worker-advisor-reports/WORKER2-AR1155-CLOSEOUT-FINAL-EVIDENCE-2026-08-19.md`  
**Evidence SHA adjudicated:** `4946e3dca20bcdfe5340eb8471d948dad358a0e7`  
**Disposition:** **PARTIAL PASS — REAL `/api/paper/start` EXECUTION PROOF ACCEPTED; NARROW TEST-ONLY RUNTIME WITNESSES AUTHORIZED BEFORE AR-1155 CERTIFICATION**

---

## 1. Executive ruling

Worker 2 handled the closeout correctly: it did not claim certification beyond its evidence and did not churn already-accepted production code merely to manufacture testability.

The AR-1155 production implementation remains **accepted and frozen** under AR-1342A. My independent inspection of evidence SHA `4946e3dca20bcdfe5340eb8471d948dad358a0e7` does not establish a new production defect.

The new `/api/paper/start` regression is accepted as a **real executable production-path witness**. It invokes the actual route handler, controls the activation verifier and stream transport, and falsifiably demonstrates the F-9 false-success boundary. The worker's reported live mutation — removing the catch-path `return` and observing the route test fail — is also directionally strong evidence. The fact that the test landed as `paper-start-activation-wiring.test.ts` rather than the strongly preferred `paper-qualification-route.test.ts` does **not** justify duplicating a semantically adequate test merely to satisfy a filename preference.

AR-1155 is **not yet certified**. AR-1342A's proof contract requires executable/falsifiable evidence on the actual runtime wiring, not source-text inspection or copied/mirrored helper logic. The worker's own matrix correctly discloses that boot resume and WebSocket reconnect have no executable witness, while failed-stream retry and lifecycle PAPER transition remain below that bar.

This ruling therefore authorizes the **smallest test-only scope** needed to finish certification. No production rewrite is authorized.

---

## 2. Scope independently inspected

I inspected or re-inspected:

1. Worker report `WORKER2-AR1155-CLOSEOUT-FINAL-EVIDENCE-2026-08-19.md`.
2. Evidence commit `4946e3dca20bcdfe5340eb8471d948dad358a0e7`.
3. `src/server/routes/paper.ts` at the evidence SHA.
4. `src/server/__tests__/paper-start-activation-wiring.test.ts` at the evidence SHA.
5. `src/server/scheduler.ts` at the evidence SHA, including the AR-1155 activation gates for boot resume, failed-stream retry, and WebSocket reconnect.
6. Existing real scheduler test seams, including:
   - `src/server/__tests__/scheduler-resume-paper-plus-skip.test.ts`
   - `src/server/__tests__/scheduler-detect-stale-broker-authoritative-guard.test.ts`
7. `src/server/services/lifecycle-service.ts`, including the PAPER-transition call to `verifyPaperActivation(...)` and `startStream(activeSessId, activation.symbols)`.
8. The prior AR-1342A proof contract.

I did **not** treat the worker-reported command transcript (`171 passed`, clean `tsc`) as independently rerun by GPT; the GitHub connector establishes the committed code/test evidence, while those local command counts remain worker-reported unless backed by a GitHub Actions run on that exact SHA. This does not change the present ruling because the remaining blocker is proof topology, not a claimed green count.

---

## 3. Verified evidence and adjudication

### A. F1-F10 production implementation — **PASS RETAINED / FROZEN**

AR-1342A's production-code acceptance remains in force. The inspected runtime continues to contain the intended activation verification and fail-closed stream boundaries. No new semantic regression was established by the closeout report or my inspection.

**Instruction:** do not edit the accepted AR-1155 production path during this proof closeout unless a newly executable regression test proves a real production defect.

### B. `/api/paper/start` activation refusal — **PASS, REAL EXECUTION**

The route regression executes the actual handler and proves activation refusal prevents `startStream` and prevents a success outcome.

### C. `/api/paper/start` transport throw / false-success boundary — **PASS, REAL EXECUTION**

The route regression makes the real `startStream` dependency throw and proves the request remains on the failure path rather than falling through to success. This is the highest-risk F-9 seam and it is now properly witnessed.

### D. Boot resume — **NOT YET CERTIFIED**

The production source verifies activation before stream start and uses verifier-returned symbols, but the report supplies source inspection only. That is insufficient under AR-1342A.

### E. Failed-stream retry — **NOT YET CERTIFIED**

The cited `auto-recovery-debt1-4.test.ts` logic is explicitly a mirrored/extracted reference implementation and does not execute the real `scheduler.ts` activation call. Passing mirror tests cannot certify this wiring seam.

### F. Lifecycle PAPER transition — **NOT YET CERTIFIED**

The production source contains the correct verifier-before-stream sequence and passes `activation.symbols`, but the currently cited evidence is source-string inspection. Source-string assertions prove presence/order textually; they do not prove runtime behavior under refusal/success controls.

### G. WebSocket reconnect — **NOT YET CERTIFIED**

The production source contains the intended verifier gate, but no executable witness currently proves refusal blocks reconnect or that success uses verifier-returned symbols.

---

## 4. Exact next task — AR-1155 final proof-only closeout

Worker 2 is authorized to modify **tests only** for the following narrow surfaces.

### 4.1 Boot-resume witness

Extend `src/server/__tests__/scheduler-resume-paper-plus-skip.test.ts` using its existing real scheduler seam. Execute the actual production `resumeActivePaperSessions()` behavior and prove:

1. `verifyPaperActivation` refusal => `startStream` is never called.
2. verifier success => `startStream(sessionId, activation.symbols)` is called with the verifier-returned symbols, not stale session/config symbols.
3. If verifier rejection/throw is reachable under the production contract, it must fail closed with zero stream start.

Use spies/call counts and deliberately distinct symbol values so the success assertion can discriminate verifier output from every rival source.

### 4.2 Failed-stream retry + WebSocket reconnect witnesses

Extend `src/server/__tests__/scheduler-detect-stale-broker-authoritative-guard.test.ts` through its existing real `detectStalePaperSessions()` seam. Prove on actual production execution:

**failed_to_stream retry**
1. activation refusal => no `startStream`.
2. activation success => stream starts with `activation.symbols`.

**WebSocket disconnect reconnect**
3. activation refusal => no restart/reconnect stream call.
4. activation success => restart uses `reconnectActivation.symbols`.

The controls must be falsifiable: use distinguishable stale/config/verifier symbol sets and assert exact calls, not merely that a source string exists.

### 4.3 Lifecycle PAPER-transition witness

Upgrade the lifecycle proof to real production execution. Prefer the smallest existing lifecycle test surface already touching the PAPER transition (including `lifecycle-b3-b6-archetype-gate-stop-race.test.ts` if it can cleanly drive the real service). Exercise the actual lifecycle production function/method — e.g. the real `promoteStrategy(..., ..., "PAPER", ...)` path — and prove:

1. activation refusal => `startStream` is not called.
2. activation success => `startStream(activeSessId, activation.symbols)` receives verifier-returned symbols.

Do **not** satisfy this with another source scan, copied helper, or reference implementation.

If the current lifecycle module cannot be executed with existing test seams without a production export/refactor, **STOP** and report the exact missing seam. Do not add a production seam under this authorization.

### 4.4 Preserve accepted route proof

Keep `paper-start-activation-wiring.test.ts` and its real-handler assertions intact. No duplicate file is required solely to rename it to the earlier preferred path.

### 4.5 Preserve legacy assertion repairs

Keep the stale literal/assertion corrections that made the current legacy battery reflect the accepted AR-1155 implementation. Do not weaken those tests to broad existence checks.

---

## 5. Required final evidence run

On one final Worker 2 SHA, report the exact command and exact per-file/aggregate counts for:

1. `paper-qualification-activation-service.test.ts`
2. `paper-start-activation-wiring.test.ts`
3. the newly expanded boot-resume scheduler witness
4. the newly expanded retry/reconnect scheduler witness
5. the executable lifecycle PAPER-transition witness
6. the previously repaired legacy regression files from the AR-1342A closeout battery
7. the reported wider AR-1155 regression set
8. `npx tsc --noEmit -p .`

Also report `git diff --stat` (or equivalent commit diff evidence) demonstrating that this closeout is test-only unless a semantic failure triggered the stop condition below.

---

## 6. Acceptance criteria for final AR-1155 certification

A subsequent report is eligible for **PASS — AR-1155 CERTIFIED / WORKER 2 CLOSED** only if all of the following are true on one evidence SHA:

1. F1-F10 accepted production implementation remains unchanged, unless a new executable test first proved a real defect and a separate ruling authorized repair.
2. `/api/paper/start` refusal and transport-throw witnesses remain green.
3. Boot resume refusal is executable and proves zero stream calls.
4. Boot resume success is executable and proves verifier-returned symbols reach `startStream`.
5. Failed-stream retry refusal/success is executable on the real scheduler path.
6. WebSocket reconnect refusal/success is executable on the real scheduler path.
7. Lifecycle PAPER transition refusal/success is executable on the real lifecycle path.
8. Success-path tests use deliberately different candidate symbol sources so stale/config/verifier inputs cannot accidentally compare equal.
9. No mirrored helper or source-text assertion is used as the sole certification evidence for any required runtime wiring case.
10. The focused activation service suite remains green (37 tests or an intentionally expanded count).
11. The accepted route proof remains green.
12. Previously stale legacy failures remain gone.
13. Wider regression run shows no new failure attributable to AR-1155.
14. `npx tsc --noEmit -p .` exits with zero errors.
15. All evidence corresponds to the same committed SHA.

---

## 7. Stop conditions

Stop immediately and report rather than silently widening scope if either occurs:

1. A newly executable witness fails because the **accepted production implementation is semantically wrong**. Return the minimal failing case, expected/actual behavior, implicated production lines, and exact SHA. Do not repair production until a new ruling authorizes it.
2. A required real-execution witness cannot be built through an existing test seam without changing production exports/module structure. Return the exact seam limitation and the smallest proposed seam; do not create it unilaterally.

A test-environment mocking/import inconvenience by itself is not permission to replace real execution with another mirrored implementation.

---

## 8. Cross-lane coordination / reservations

This authorization is **test-only** and intentionally narrow.

Worker 2 may reserve/edit only the named scheduler/lifecycle test surfaces necessary for the witnesses above plus its existing AR-1155 test files. It must not touch compiler, strategy-factory, source-graph, or unrelated runtime production files.

If another worker currently owns either scheduler test file or the lifecycle test surface, coordinate the reservation before editing. Do not create competing copies of production logic to avoid a reservation conflict.

---

## 9. Final advisor status

**AR-1155 remains OPEN for one proof-only closeout.**

The important engineering state is now narrow and favorable:

- production implementation: **accepted**
- F-9 route false-success proof: **accepted with real execution**
- remaining blocker: **executable witnesses for scheduler/lifecycle activation wiring**
- production redesign authorized: **NO**
- scope expansion authorized: **tests only, as specified above**

Worker 2's next conforming report can be the final certification report. If every acceptance criterion above is satisfied on one SHA, the next ruling should close this lane with **PASS — AR-1155 CERTIFIED / WORKER 2 CLOSED**.
