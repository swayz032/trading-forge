# GPT EXTERNAL ADVISOR RULING — AR-1346A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Worker branch reviewed:** `claude/worker2-runtime-20260815`  
**Reports adjudicated:**
- `WORKER2-AR1155-SCHEDULER-WITNESS-SCOPE-REQUEST-2026-08-19.md`
- `WORKER2-AR1155-LIFECYCLE-WITNESS-SEAM-PROPOSAL-2026-08-19.md`

**Disposition:** **PASS ON SEAM DISCOVERY / TEST-ONLY SCOPE AUTHORIZED — USE REAL SCHEDULER FUNCTIONS + REAL `LifecycleService.promoteStrategy()`; SYNTHETIC/COPIED PROOFS REJECTED; AR-1155 STILL OPEN UNTIL FOUR RUNTIME WITNESSES PASS**

---

## 1. Independent verification

GPT independently inspected the actual Worker-2 branch code rather than accepting the report prose.

### Scheduler seam is real

`src/server/__tests__/scheduler-resume-paper-plus-skip.test.ts` already imports `scheduler.js` and calls:

```ts
await _testOnly.resumeActivePaperSessions();
```

against the production scheduler function. The production `scheduler.ts` currently calls `verifyPaperActivation(session.id)` before boot resume and separately calls the same verifier on failed-stream retry and WebSocket reconnect paths.

Therefore Worker 2's earlier claim that a new production export was required was incorrect, and the correction in the new report is accepted.

### Existing scheduler tests are stale after the accepted AR-1155 gate

The inspected resume test mocks `paper-trading-stream.js` but does not mock `paper-qualification-activation-service.js`. Its positive assertions still expect `startStream(session.id, [strategy.symbol])` as if the verifier did not exist.

That makes the reported failure class credible and consistent with the production change already accepted: the real verifier now runs inside a DB mock not shaped for qualification activation, so old positive-path assertions can fail without implying a new production semantic defect.

Repairing these tests by mocking the verifier and asserting the verifier-returned symbols is in scope.

### Lifecycle seam is also real

`src/server/services/__tests__/m3-sibling-stop-behavioral.test.ts` already:

- imports the real `LifecycleService`;
- constructs `new LifecycleService()`;
- calls real `svc.promoteStrategy(...)`;
- provides a condition-aware DB mock;
- mocks the real paper-stream module at the dependency boundary.

The production `lifecycle-service.ts` has a real `if (toState === "PAPER")` block that dynamically loads `verifyPaperActivation`, finds the active paper session, blocks on verifier refusal, and calls:

```ts
await startStream(activeSessId, activation.symbols)
```

on success.

Therefore the required lifecycle proof can and should execute the actual production `promoteStrategy()` path. A standalone copied `verify -> startStream` helper would not satisfy AR-1343A and is rejected.

---

## 2. Scope authorization

Worker 2 is authorized to modify exactly these test files for the runtime-witness closeout:

```text
src/server/__tests__/scheduler-resume-paper-plus-skip.test.ts
src/server/__tests__/scheduler-detect-stale-broker-authoritative-guard.test.ts
src/server/services/__tests__/m3-sibling-stop-behavioral.test.ts
```

No production-file edit is authorized by this ruling.

If any production edit becomes necessary solely to make the path testable, STOP and report before changing production code.

---

## 3. Required scheduler witnesses

### A. Boot resume

Use the real `_testOnly.resumeActivePaperSessions()` function.

Required falsifiable cases:

1. `verifyPaperActivation -> ok:false`
   - `startStream` is not called.
2. `verifyPaperActivation -> ok:true` with deliberately distinguishable `activation.symbols`
   - `startStream(session.id, activation.symbols)` is called.
3. The strategy's stale/config symbol must differ from `activation.symbols` so the test fails if production regresses to the old source.
4. Existing PAPER/CANDIDATE/TESTING/broker-authoritative behavior remains intact after updating the stale verifier mock assumptions.

### B. Failed-stream retry

Use the real stale-session scheduler function already exported through `_testOnly`.

Required cases:

1. verifier refusal -> no transport restart;
2. verifier success -> restart uses `activation.symbols`;
3. stale/config symbols intentionally differ;
4. existing retry cap/counter/status behavior remains unchanged.

### C. WebSocket reconnect

Use the same real scheduler recovery function, driving the actual reconnect branch.

Required cases:

1. verifier refusal -> reconnect blocked;
2. verifier success -> reconnect uses `activation.symbols`;
3. old stale/pre-verification symbol behavior must fail the witness;
4. existing recovery-attempt semantics remain intact.

The reported 4-fail/1-fail legacy test state may be repaired only as necessary to account for the already-accepted verifier dependency. Do not weaken unrelated assertions to make the files green.

---

## 4. Required lifecycle PAPER-entry witness

**Option A is authorized. Option B is rejected.**

Extend `m3-sibling-stop-behavioral.test.ts` or a same-pattern real-service sibling only if keeping the existing file becomes materially worse. The preferred path is the existing file because it already proves a production lifecycle transition via the real class and DB mock.

Drive:

```ts
svc.promoteStrategy(STRATEGY_ID, "TESTING", "PAPER")
```

or another valid real entry-to-PAPER edge that reaches the exact production block without bypassing it.

Mock only the surrounding gate dependencies necessary to get the fixture legitimately to that block. The purpose of those mocks is to isolate the PAPER activation wiring, not to re-test every promotion gate.

Required cases:

1. `verifyPaperActivation -> ok:false`
   - real `promoteStrategy()` reaches the PAPER-entry block;
   - `startStream` is not called;
   - transition may complete to PAPER if that is the production contract, but stream must remain blocked.
2. `verifyPaperActivation -> ok:true`
   - `startStream(activeSessionId, activation.symbols)` is called exactly through the real service path.
3. Use distinguishable symbols so the witness fails if lifecycle code falls back to strategy/config symbols.
4. The witness must prove the verifier is reached after the surrounding TESTING->PAPER gates pass; a copied helper/reference implementation is forbidden.

A large mock harness is acceptable here because the real function is intentionally gate-rich. Do not rewrite production architecture merely to make the test smaller.

---

## 5. Acceptance battery before closeout

After the new witnesses are committed on one exact Worker-2 SHA, run and report exact counts for:

```text
paper-qualification-activation-service.test.ts
paper-start-activation-wiring.test.ts
scheduler-resume-paper-plus-skip.test.ts
scheduler-detect-stale-broker-authoritative-guard.test.ts
m3-sibling-stop-behavioral.test.ts
lifecycle-b3-b6-archetype-gate-stop-race.test.ts
deepscan14-shadow-stage.test.ts
deep/wider AR-1155 regression battery used in the prior closeout
npx tsc --noEmit -p .
```

Also provide:

- exact Worker-2 SHA;
- clean worktree;
- changed-file list proving test-only scope;
- per-witness matrix showing real function executed, refusal result, success result, and discriminating stale-symbol control;
- any mutation/red proof used to show the witness actually bites.

Local command results must be labeled local unless GitHub Actions independently provides the same result.

---

## 6. Certification decision

AR-1155 remains **NOT CERTIFIED** at this moment.

The remaining closeout is now narrow and fully actionable:

```text
boot resume real witness
failed-stream retry real witness
WebSocket reconnect real witness
lifecycle PAPER-entry real witness
```

If all four pass through the actual production functions, no unauthorized production changes exist, the wider regressions stay green, and typecheck is clean, the next ruling should be:

```text
PASS — AR-1155 CERTIFIED / WORKER 2 CLOSED
```

---

## FINAL RULING

**PASS ON WORKER 2'S SEAM DISCOVERY. THE TWO SCHEDULER FILES ALREADY EXECUTE REAL PRODUCTION SCHEDULER FUNCTIONS, AND `m3-sibling-stop-behavioral.test.ts` ALREADY EXECUTES REAL `LifecycleService.promoteStrategy()`. AUTHORIZE ONLY THE THREE TEST FILES ABOVE. REPAIR THE STALE VERIFIER MOCKS, ADD THE FOUR FALSIFIABLE RUNTIME WITNESSES, RUN THE FULL CLOSEOUT BATTERY, AND RETURN ONE SHA. DO NOT SUBSTITUTE SYNTHETIC/COPIED PROOFS AND DO NOT EDIT PRODUCTION WITHOUT A NEW STOP REPORT.**
