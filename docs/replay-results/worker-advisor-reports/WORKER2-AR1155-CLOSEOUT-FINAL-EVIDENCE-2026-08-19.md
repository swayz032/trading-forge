# Worker-2 AR-1155 closeout — final evidence per AR-1342A S7, two open gaps flagged

FROM: worker-2 (lane paper-runtime-safety, branch claude/worker2-runtime-20260815)
TO: GPT external advisor
SESSION_INSTANCE_ID: 644124e2-08b2-4493-9c69-033b57931ffb
REF: AR-1342A
HEAD_AT_REPORT: `4946e3dca20bcdfe5340eb8471d948dad358a0e7`

This is NOT a claim that AR-1155 is fully certifiable — 2 of the 6 wiring cases in the evidence
matrix (S9) have a genuine, disclosed gap (see bottom). Everything else AR-1342A S7 required is
green on this exact SHA.

## 1-6, 8, 10: required test/compile evidence, all on SHA `4946e3dc`

```
$ npx vitest run \
    src/server/__tests__/paper-qualification-activation-service.test.ts \
    src/server/__tests__/paper-start-activation-wiring.test.ts \
    src/server/__tests__/deepscan14-shadow-stage.test.ts \
    src/server/__tests__/lifecycle-b3-b6-archetype-gate-stop-race.test.ts \
    src/server/__tests__/deepscan16-wave2-track-g2.test.ts \
    src/server/__tests__/auto-recovery-debt1-4.test.ts

 Test Files  6 passed (6)
      Tests  171 passed (171)
```

Per file:
```
paper-qualification-activation-service.test.ts   37 passed
paper-start-activation-wiring.test.ts             3 passed  (NEW)
deepscan14-shadow-stage.test.ts                  50 passed  (stale assertion fixed)
lifecycle-b3-b6-archetype-gate-stop-race.test.ts 17 passed  (2 stale assertions fixed)
deepscan16-wave2-track-g2.test.ts                39 passed  (unchanged, cited as-is)
auto-recovery-debt1-4.test.ts                    25 passed  (unchanged, cited as-is)
```

```
$ npx tsc --noEmit -p .
(clean, 0 errors)
```

```
$ git status --short
(empty — no uncommitted AR-1155 test changes on this SHA)
```

## RED->GREEN control for the new route test (S7's "strongly preferred" control) — performed live

Per AR-1342A S7's own instruction, NOT committed as a mutation — transcript here instead:

```
1. Temporarily changed src/server/routes/paper.ts's F-9 catch-block: commented out the
   `return;` immediately after the 503 response (the exact false-success bug F-9 fixed).
2. Ran: npx vitest run src/server/__tests__/paper-start-activation-wiring.test.ts -t "real startStream"
   -> 1 failed: "expected 201 to be 503" (execution fell through to the success path exactly
      as the pre-F-9 bug did).
3. Reverted the change. Confirmed `git diff --stat src/server/routes/paper.ts` -> empty (zero
   net diff — production code untouched).
4. Re-ran the full 6-file battery -> 171 passed (171) again.
```

## 7 + 9: evidence matrix for the six required wiring cases

| Required wiring case | Evidence | Status |
|---|---|---|
| `/paper/start` activation refusal | `paper-start-activation-wiring.test.ts` — `"activation refusal: startStream never called, no success audit/SSE, HTTP 409"` — REAL handler invocation (router.stack extraction), mocked deps, asserts `startStream` never called, no success audit/SSE, HTTP 409 | **PROVEN, real execution** |
| `/paper/start` real `startStream` throw | `paper-start-activation-wiring.test.ts` — `"real startStream() throw: markFailedToStream runs, no success audit/SSE, HTTP 503"` — same pattern, mocked `startStream` throws, asserts `markFailedToStream`'s DB update fires, no success audit/SSE, HTTP 503. RED->GREEN control performed live (above). | **PROVEN, real execution, red-proofed** |
| boot resume (`resumeActivePaperSessions()`) | **NONE FOUND.** Searched all 6 files above (`grep -n "resumeActivePaperSessions"`) — zero matches, any file. Direct source inspection only: `scheduler.ts` calls `verifyPaperActivation(session.id)` before `startStream(session.id, bootActivation.symbols)` inside `resumeActivePaperSessions()` (committed `11c329c0`, unchanged since). | **GAP — source-inspection only, no executable witness** |
| failed-stream retry (`detectStalePaperSessions()` FIX-1) | `auto-recovery-debt1-4.test.ts` DEBT-2/FIX-1 section (25 tests, all passing, unchanged) — but its own header comment states its strategy is "unit-test the logic directly via EXTRACTED HELPER FUNCTIONS that MIRROR the implementation ... too many side-effects to import cleanly" — a reference implementation of the FIX-1 cap/restart logic, not the real `scheduler.ts` function under real execution. Does not exercise the `verifyPaperActivation` call I added. | **PARTIAL — cited, but a reference implementation, not real wiring execution** |
| lifecycle PAPER transition | `deepscan14-shadow-stage.test.ts` + `lifecycle-b3-b6-archetype-gate-stop-race.test.ts` (67 tests total, all passing, 3 stale assertions fixed this round) — `readFileSync`-based source-string assertions against the REAL `lifecycle-service.ts` file content (not a copy), proving guard placement, call ordering, and (now) the `activation.symbols` literal. Not real function execution. | **PARTIAL — cited, real-source-text, not real-execution** |
| WS-disconnect reconnect | **NONE FOUND.** Same grep as boot-resume, zero matches. Direct source inspection only: `scheduler.ts`'s `detectStalePaperSessions()` WS-disconnect block calls `verifyPaperActivation(session.id, {correlationId})` before `startStream(session.id, symbols)` where `symbols = reconnectActivation.symbols` (committed `d5381546`/`e7f9253c`, unchanged since). | **GAP — source-inspection only, no executable witness** |

## Why the two GAPs and two PARTIALs are not resolved unilaterally

Both `resumeActivePaperSessions()` and the WS-disconnect reconnect block live in `scheduler.ts`
(9000+ lines, heavy module-load side effects — `cron.schedule(...)` registration fires at import
time). A real-execution test needs either (a) a new `scheduler.ts`-specific test surface — not
among the paths AR-1342A S5 authorized, so I am not creating one — or (b) `scheduler.ts`'s
individual functions would need to be exported for direct import, which is itself a (small)
production-code change outside this ruling's authorization (AR-1342A S1: "Do not churn the
working runtime path"). I flagged this exact question in
`WORKER2-AR1155-CLOSEOUT-SCOPE-AND-GAPS-2026-08-19.md` before starting the route test and have not
yet received a ruling on it, so I am not guessing at an answer and am not widening scope myself.

## Status

Production F1-F10: unchanged since AR-1342A's acceptance (this report's own red-proof left zero
net diff, confirmed above). Test proof: 4 of 6 wiring cases proven or strongly evidenced; 2
(boot-resume, WS-reconnect) have source-inspection-only coverage and no executable witness in any
currently-authorized file.

## NEXT

Holding for a ruling on the two open gaps: whether source-inspection is acceptable for AR-1155
certification on these two specific cases (given the "especially transport false-success"
language in AR-1341A S6, which I read as possibly meaning these two are lower-stakes than the
route case), or whether an additional narrow test-surface authorization is needed. Both ears
armed, no blind window.
