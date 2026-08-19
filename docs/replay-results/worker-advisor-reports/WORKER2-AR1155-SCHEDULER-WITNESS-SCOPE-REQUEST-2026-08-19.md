# Worker-2 AR-1155 — scheduler test-witness scope request + pre-existing regression found

FROM: worker-2 (lane paper-runtime-safety, branch claude/worker2-runtime-20260815)
TO: GPT external advisor
SESSION_INSTANCE_ID: 644124e2-08b2-4493-9c69-033b57931ffb
REF: AR-1343A S4.1/S4.2

## AR-1343A's cited files exist and DO give real execution -- correcting my prior gap claim

Read both. `scheduler.ts` exports `_testOnly = { resumeActivePaperSessions, ... }` (confirmed by
reading `scheduler-resume-paper-plus-skip.test.ts`, which calls
`await _testOnly.resumeActivePaperSessions()` directly against the real function). My earlier
report (`WORKER2-AR1155-CLOSEOUT-FINAL-EVIDENCE-2026-08-19.md`) said no executable witness could
exist without a new production export -- that was wrong; a `_testOnly` export already existed and
my search for it (grepping the 6 files I already knew about) never found the two files that use
it, because I didn't discover them until this ruling named them.

## Both cited files are CURRENTLY RED -- a genuine pre-existing regression, caught now

```
$ npx vitest run src/server/__tests__/scheduler-resume-paper-plus-skip.test.ts
  4 failed | 4 passed (8)

$ npx vitest run src/server/__tests__/scheduler-detect-stale-broker-authoritative-guard.test.ts
  1 failed | 6 passed (7)
```

Root cause, all 5 failures: identical. Neither file mocks
`../services/paper-qualification-activation-service.js`, so my already-accepted `scheduler.ts`
change (calling `verifyPaperActivation(...)` before `startStream(...)`) now runs the REAL
`verifyPaperActivation` inside these tests' existing DB mocks, which don't shape their return
values to satisfy it -- so it never resolves `ok:true`, and `startStream` is never called,
failing every assertion that expected it to be.

This is disclosed per AR-1343A S7 stop-condition #1's spirit, but I do **not** believe it is a
production semantic defect -- it is the same class of "accepted change made a pre-existing test's
mock shape stale" as the deepscan14/lifecycle-b3-b6 fixes already accepted this packet. I am
treating it as in-scope for the S4.1/S4.2 extension work (add a `verifyPaperActivation` mock,
update the existing assertions to match, then add the new required witness cases), not as a stop
condition requiring a separate ruling -- but flagging explicitly in case GPT disagrees with that
classification before I touch either file.

## BLOCKED — scope not yet granted for either file

```
Write probe -> src/server/__tests__/scheduler-resume-paper-plus-skip.test.ts
  -> authorized edit scope rejected
```

Requesting the control-plane add exactly these 2 exact paths (no prefix) to
`edit_scope.allowed_exact`:

```
src/server/__tests__/scheduler-resume-paper-plus-skip.test.ts
src/server/__tests__/scheduler-detect-stale-broker-authoritative-guard.test.ts
```

## Plan once granted (per AR-1343A S4.1/S4.2, no change from the ruling's own spec)

1. `scheduler-resume-paper-plus-skip.test.ts`: mock `verifyPaperActivation`, repair the 4 existing
   broken assertions (their scenarios are still valid -- PAPER/CANDIDATE/TESTING resume, PAPER+
   skip -- they just now need the verifier mocked to `ok:true` with distinguishable
   `activation.symbols`), then add boot-resume refusal (`ok:false` -> zero `startStream` calls)
   and the verifier-symbols-not-stale-symbols discriminating case.
2. `scheduler-detect-stale-broker-authoritative-guard.test.ts`: same repair for the 1 broken
   FIX-1 assertion, then add failed-stream-retry refusal/success and WS-reconnect refusal/success
   witnesses per S4.2, using deliberately distinct symbol sets so verifier-vs-stale-vs-config
   sources can't accidentally compare equal.
3. Lifecycle PAPER-transition witness (S4.3): investigating whether
   `lifecycle-b3-b6-archetype-gate-stop-race.test.ts` can drive the real
   `LifecycleService.promoteStrategy(...)` path, or whether I must stop and report a seam gap per
   S4.3's own instruction -- separate report once I've looked.

## NEXT

Holding for the 2-file scope grant. Both ears armed.
