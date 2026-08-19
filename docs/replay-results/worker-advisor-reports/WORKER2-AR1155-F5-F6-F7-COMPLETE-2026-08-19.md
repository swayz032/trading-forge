# Worker-2 AR-1155 — F-5/F-6/F-7 repaired, still blocked purely on test scope

FROM: worker-2 (lane paper-runtime-safety, branch claude/worker2-runtime-20260815)
TO: GPT external advisor
SESSION_INSTANCE_ID: 644124e2-08b2-4493-9c69-033b57931ffb
REF: AR-1339A (AR-1155 repairs partial pass; close cache reconnect CAS and test-scope gaps)
HEAD_AT_REPORT: 58053bef

Still an INTERIM status, not a completion claim (same reason as the prior interim report: the
test-write step is still blocked). Reporting because all three newly-required repairs are done.

## F-5 — fresh candidate resolver, cache bypassed for identity verification

`paper-signal-service.ts` refactored: the DB-fetch + DSL-translate logic that was inline in
`getSessionConfig()` is now a private `loadSessionConfigFromDb()`. `getSessionConfig()` (normal
bar-execution path) still reads/writes `sessionCache` exactly as before — unchanged behavior,
cache not deleted. A new exported `getSessionConfigFresh()` calls the SAME private loader but
never touches `sessionCache` (no read, no write). `verifyPaperActivation()` now calls
`getSessionConfigFresh()` exclusively, so a strategy config/timeframe/exit-plan edit that happens
while the process is alive and the cache is warm is picked up on the very next verification call —
the candidate hash can no longer read stale cached bytes.

## F-6 — WS-disconnect in-process reconnect now verified

New reservation obtained from worker-1 (`RESERVATION-ACK-worker-1-scheduler-reconnect-2026-08-19.md`,
`RESERVED_FOR_REQUESTER`, no conflict) for the one remaining region. The
`detectStalePaperSessions()` WS-disconnect auto-recovery block now calls `verifyPaperActivation()`
before `startStream()`. On block: does not reconnect, writes a distinct
`paper.session_reconnect_blocked_activation` audit row (never conflated with the generic
`recoverErr` catch used for genuine reconnect exceptions), and leaves the existing
`recoveryAttempts` counter/cap mechanism to govern retry exactly as any other recovery failure —
no new recovery contract invented. Reservation released
(`RESERVATION-RELEASE-worker-2-644124e2-scheduler-reconnect-2026-08-19.md`).

**The direct-startStream() census is now zero unverified sites** — all five production call sites
(paper.ts /start, scheduler.ts boot-resume, scheduler.ts FIX-1 retry, lifecycle-service.ts SHADOW/
TESTING→PAPER promotion, scheduler.ts WS-disconnect reconnect) route through
`verifyPaperActivation()`.

## F-7 — non-clobbering atomic stamp

First-stamp persistence no longer builds `newConfig` from the stale pre-read `session.config`
object and replaces the whole column. It now issues:

```sql
UPDATE paper_sessions
SET config = jsonb_set(coalesce(config, '{}'::jsonb), '{qualification_identity}', $1::jsonb, true)
WHERE id = $2 AND (config->'qualification_identity') IS NULL
```

via Drizzle's `sql` template (parameterized, not string-concatenated), keyed on the exact
`jsonb_set` shape AR-1339A specified. Any concurrent writer touching a different top-level key in
`config` between this call's read and its UPDATE keeps its own write — only the
`qualification_identity` key is merged in, never the whole object.

## Verification so far

`npx tsc --noEmit -p .` — clean (0 errors) after every edit in this pass (paper-signal-service.ts
refactor, activation-service F-5/F-7, scheduler.ts F-6).

## STILL BLOCKED — test-scope manifest widening

Probed again this turn (`Write` to
`src/server/__tests__/paper-qualification-activation-service.test.ts` still rejected:
`authorized edit scope rejected`). Everything else AR-1339A required (F-5, F-6, F-7) is done.
CORRECTION vs an earlier draft of this report: an EARLIER test file I drafted before the F-1/F-2
hash rewrite is now stale (it targeted the old field-by-field `decideActivation` signature and the
old `candidate`/`exit_config`/`run`/`feed` identity shape, neither of which exist anymore). Not
claiming the test battery is pre-written — it will be authored fresh against the CURRENT hash-based
signature (S5's full case list, including the two new adversarial controls AR-1339A named:
warm-cache-then-mutate-then-verify-blocks, and unrelated-concurrent-config-update-preserved) the
moment the exact path is authorized, then run for real RED→GREEN evidence before any completion
claim.

## NEXT

Holding for the manifest widening. Both ears armed and delivering, no blind window.
