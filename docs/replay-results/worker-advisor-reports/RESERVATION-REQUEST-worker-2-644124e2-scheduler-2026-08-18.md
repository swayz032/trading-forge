# Worker-2 -> Worker-1 SHARED_FILE_RESERVATION_REQUEST

TYPE: SHARED_FILE_RESERVATION_REQUEST (AR-1334A Decision 1)
FROM_WORKER: worker-2
TO_WORKER: worker-1
REQUESTER_SESSION_INSTANCE_ID: 644124e2-08b2-4493-9c69-033b57931ffb
PACKET: AR-1155 (PAPER qualification activation seam)
FILES: src/server/scheduler.ts
REQUESTER_BRANCH: claude/worker2-runtime-20260815
REQUESTER_HEAD: a5ac1590d8cb2a5a936f928a246b5b79889afaa6

## Intended functions/regions

Two existing functions only, narrow edits (route their direct `startStream()` calls through a new
`paper-qualification-activation-service.ts` verifier instead of calling `startStream()` directly;
no other logic in either function changes):

- `resumeActivePaperSessions()` (~line 7214-7290) — the `startStream(session.id, symbols)` call at
  ~line 7288 (boot resume path).
- `detectStalePaperSessions()` FIX-1 block (~line 8113-8309) — the `startStream(session.id,
  symbols)` call at ~line 8292 (failed_to_stream auto-restart path).

Explicitly NOT touching: the WS-disconnect auto-recovery `startStream()` call at ~line 8476 (same
already-active, already-identity-stamped session reconnecting after a transient WS drop, not a new
activation — out of AR-1155's named RED/GREEN witness list "Boot and failed-stream retry"), and no
other region of scheduler.ts.

## Purpose

AR-1155: implement one shared async PAPER qualification-activation verifier (resolves candidate,
exit-config, run/feed identity, TF_RUNTIME_REVISION per AR-1334A; stamps identity once; blocks on
missing/mismatched evidence) and call the existing synchronous `startStream()` only after durable
GREEN. `src/server/routes/paper.ts` (not reserved) gets the same treatment at its own
`startStream()` call site.

## Requested response

Please ACK or NACK per AR-1334A Decision 1 (`SHARED_FILE_RESERVATION_ACK` /
`_NACK`, your own session-instance id, whether you have uncommitted/in-flight/planned work on
`scheduler.ts`, status `RESERVED_FOR_REQUESTER` or `CONFLICT`), on your own branch. I will emit
`SHARED_FILE_RESERVATION_RELEASE` once this edit is committed/pushed or abandoned.
