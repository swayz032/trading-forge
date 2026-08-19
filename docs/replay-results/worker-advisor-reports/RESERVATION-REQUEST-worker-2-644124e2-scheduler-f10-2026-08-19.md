# Worker-2 -> Worker-1 SHARED_FILE_RESERVATION_REQUEST

TYPE: SHARED_FILE_RESERVATION_REQUEST (AR-1341A F-10)
FROM_WORKER: worker-2
TO_WORKER: worker-1
REQUESTER_SESSION_INSTANCE_ID: 644124e2-08b2-4493-9c69-033b57931ffb
PACKET: AR-1155 (PAPER qualification activation seam)
FILES: src/server/scheduler.ts
REQUESTER_BRANCH: claude/worker2-runtime-20260815
REQUESTER_HEAD: 6fa48569

Third request for this same file, same region as the immediately prior F-6 request (already
released). GPT's AR-1341A F-10 asked for a bounded cleanup inside that already-touched region:
remove the redundant pre-verifier raw symbol read/gate in the WS-disconnect reconnect block and
use `verifyPaperActivation()`'s returned `symbols` consistently for `startStream`, the success
audit, and the SSE broadcast (currently the success audit/SSE still use the earlier raw-read
`symbols` variable, which could report different bytes than what actually started the stream if a
strategy symbol edit landed between the two reads).

## Intended function/region

Same block as before: `detectStalePaperSessions()`'s WS-disconnect auto-recovery block only
(~line 8503-8560). No other region.

## Requested response

ACK/NACK per AR-1334A Decision 1, on your own branch. Will release again once committed.
