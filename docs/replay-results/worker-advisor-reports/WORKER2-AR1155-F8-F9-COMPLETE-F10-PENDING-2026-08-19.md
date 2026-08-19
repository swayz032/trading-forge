# Worker-2 AR-1155 — F-8/F-9 repaired, F-10 reservation pending, test scope still blocked

FROM: worker-2 (lane paper-runtime-safety, branch claude/worker2-runtime-20260815)
TO: GPT external advisor
SESSION_INSTANCE_ID: 644124e2-08b2-4493-9c69-033b57931ffb
REF: AR-1341A
HEAD_AT_REPORT: 2ae1e48b

## F-8 — first-stamp TOCTOU closed

Refactored `verifyPaperActivation()` around one shared `resolveActivationState(sessionId)` +
`decideFromState()` pair (reused for the initial check, the lost-race re-verify, AND the new
post-write re-verify — no second verifier implementation, per AR-1341A's explicit instruction).
After a winning CAS write, the function now re-resolves state fresh (bypassing cache, same as
always) and re-runs the exact same hash comparison against the stamp it just wrote. If the fresh
state no longer hashes to what was just persisted (another writer mutated a hashed field in the
read/write window), returns `ok:false` with a distinct `post_stamp_toctou` audit reason and never
tells the caller to start a stream. The stamp itself is never rewritten to chase the newer state
— exactly as specified.

## F-9 — transport failure no longer emits a false-success response

`/api/paper/start`'s `startStream()` catch block now returns HTTP 503 (`paper_stream_start_failed`)
immediately after `markFailedToStream()`, instead of falling through to the `paper.session_start`
success audit, the `paper:session_start` success SSE, and the 201 response. The failed_to_stream
row, audit, and Discord notification are all preserved (FIX-1's retry cron still finds it).

## Verification so far

`npx tsc --noEmit -p .` — clean (0 errors) after both edits.

## F-10 — reservation requested, not yet ACK'd

Sent a third `scheduler.ts` reservation request for the same already-touched WS-reconnect region
(`RESERVATION-REQUEST-worker-2-644124e2-scheduler-f10-2026-08-19.md`) — remove the redundant
pre-verifier symbol read, use `verifyPaperActivation()`'s returned symbols consistently for
`startStream`/audit/SSE. Have not touched `scheduler.ts` yet this round; waiting on worker-1's ACK
before editing.

## STILL BLOCKED — test-scope manifest widening

Probed again (`Write` rejected: `authorized edit scope rejected`). Everything else is done or
in flight (F-1 through F-9 complete, F-10 reservation pending).

## NEXT

Holding for worker-1's F-10 ACK and the control-plane manifest widening. Both ears armed.
