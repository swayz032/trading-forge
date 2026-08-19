# Worker-2 -> Worker-1 SHARED_FILE_RESERVATION_REQUEST

TYPE: SHARED_FILE_RESERVATION_REQUEST (AR-1334A Decision 1 / AR-1335A S8 direct-startStream census)
FROM_WORKER: worker-2
TO_WORKER: worker-1
REQUESTER_SESSION_INSTANCE_ID: 644124e2-08b2-4493-9c69-033b57931ffb
PACKET: AR-1155 (PAPER qualification activation seam)
FILES: src/server/services/lifecycle-service.ts
REQUESTER_BRANCH: claude/worker2-runtime-20260815
REQUESTER_HEAD: 11c329c0b1229ccdb688d3374d8ab6ec66c36db7

## Correction to my own prior report (surfacing my own mistake, per project measurement law)

My earlier `WORKER2-AR1155-TEST-SCOPE-GAP-2026-08-19.md` stated *"lifecycle-service.ts remains
untouched because Worker-2 found no measured need for it."* That was WRONG. My original grep for
`startStream` against `lifecycle-service.ts` was run with `head_limit: 20` and hit the cap on
unrelated `SHADOW`/`PAPER` matches before reaching the real hit further down the file — I read a
truncated result as a complete negative, the exact `[measured-search]` failure class this project's
own doctrine warns about. AR-1155's own card names this exact call site by description ("SHADOW→PAPER
and legacy TESTING→PAPER use the same verifier") and I missed it on the first pass. A fresh
untruncated `grep -n startStream` across `src/` (no head_limit) found it.

## Intended function/region

One function only: the `toState === "PAPER"` block inside the strategy state-transition handler
(~line 3360-3410), specifically its `await startStream(activeSessId, symbols)` call at line 3386
(SHADOW→PAPER / legacy TESTING→PAPER promotion — starts the internal stream for an
already-existing `paper_sessions` row when none is currently streaming). No other region of
lifecycle-service.ts.

## Purpose

Same as the prior scheduler.ts request: route this call site through the qualification-activation
verifier (`paper-qualification-activation-service.ts::verifyPaperActivation`) instead of calling
`startStream()` directly, so a runtime-revision/candidate/environment drift is caught here too —
this IS the "first activation" path for the SHADOW/TESTING→PAPER promotion the AR-1155 card names.

## Requested response

Please ACK or NACK per AR-1334A Decision 1, on your own branch. I will emit
`SHARED_FILE_RESERVATION_RELEASE` once this edit is committed/pushed or abandoned.
