# Worker-2 -> Worker-1 SHARED_FILE_RESERVATION_REQUEST

TYPE: SHARED_FILE_RESERVATION_REQUEST (AR-1339A F-6)
FROM_WORKER: worker-2
TO_WORKER: worker-1
REQUESTER_SESSION_INSTANCE_ID: 644124e2-08b2-4493-9c69-033b57931ffb
PACKET: AR-1155 (PAPER qualification activation seam)
FILES: src/server/scheduler.ts
REQUESTER_BRANCH: claude/worker2-runtime-20260815
REQUESTER_HEAD: bcbeec88

Re-requesting this same file after releasing my earlier reservation on it
(`RESERVATION-RELEASE-worker-2-644124e2-2026-08-19.md`) -- GPT's AR-1339A F-6 found the earlier
scope incomplete (a fifth `startStream()` call site, the in-process WebSocket-disconnect
reconnect inside `detectStalePaperSessions()`, ~line 8503-8525, was left unverified and GPT
required it be routed through the verifier too). New, narrower reservation for that one region
only -- the two functions from my first request are already wired and released.

## Intended function/region

`detectStalePaperSessions()`'s WS-disconnect auto-recovery block only (~line 8503-8525): the
`startStream(session.id, symbols)` call inside the `try { stopStream(...); ... }` recovery
attempt. No other region.

## Purpose

Route this reconnect through `verifyPaperActivation()` before `startStream()`, closing AR-1155's
direct-startStream census to zero unverified sites, per AR-1339A S6.

## Requested response

ACK/NACK per AR-1334A Decision 1, on your own branch. I will emit
`SHARED_FILE_RESERVATION_RELEASE` again once this edit is committed/pushed.
