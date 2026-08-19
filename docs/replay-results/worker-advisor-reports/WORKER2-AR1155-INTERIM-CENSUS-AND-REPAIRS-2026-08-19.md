# Worker-2 AR-1155 — F-1/F-2/F-3/F-4 repairs done, census complete, still blocked on test scope

FROM: worker-2 (lane paper-runtime-safety, branch claude/worker2-runtime-20260815)
TO: GPT external advisor
SESSION_INSTANCE_ID: 644124e2-08b2-4493-9c69-033b57931ffb
REF: AR-1335A (Worker2 AR-1155 partial pass, repair identity integrity and test scope)
HEAD_AT_REPORT: 03c65b14 (lifecycle-service.ts wiring, just pushed)

This is an INTERIM status, not an AR-1155 completion claim — AR-1335A S9's continuation law puts
"commit focused tests -> run RED/GREEN + adversarial controls" BEFORE the completion report, and
that step is still blocked (see bottom). Reporting now because the repairs + census are done and
load-bearing enough to surface before the next wait.

## F-1 / F-2 — candidate + run/environment identity rebuilt around canonical hashes

`paper-qualification-activation-service.ts` rewritten:
- `candidate_version_hash` = `canonicalHash({strategy_id, symbols (sorted), timeframe,
  effective_config, exit_plan_config})` where `effective_config` is exactly the object
  `paper-signal-service.ts::getSessionConfig()` hands the live paper engine (now exported for this
  purpose, along with `CachedSession`) — the same post-translation `translateDSLToPaperConfig()`
  output, not a second raw-DB approximation, per AR-1335A S2's explicit requirement.
- `run_environment_hash` = `canonicalHash({mode, firm_id, feed_mode, session_risk_config})` where
  `session_risk_config` is `paper_sessions.config` with `qualification_identity` and
  `evidence_labels` stripped (avoid self-hashing the receipt / hashing an unrelated receipt).
- Hashing convention reused verbatim from `broker-router.ts::computeStrategyVersionHashForRouting`
  (`sortedKeyReplacer` + sha256), not invented.
- Resume/retry now compares BOTH hashes + `runtime_revision` for exact equality — nothing stamped
  is left unverified; a stale ad-hoc field-by-field diagnostic block is retained but is explicitly
  documented as non-gating (drift there without a hash change cannot occur, since the hashes cover
  the same source values).

Symbol resolution for market-data subscription deliberately stayed on the RAW strategy row
(`strategy.symbol` + `strategy.config.symbol`) rather than the translated config — conflating the
two would have silently changed which symbols get subscribed to, which is a different risk than
what F-1 asked for.

## F-3 — atomic set-once persistence

First-stamp write is now a compare-and-set `UPDATE ... WHERE (config->'qualification_identity')
IS NULL`. A losing concurrent caller (`written` empty) re-reads the winning row and re-runs
`decideActivation` against the winner's stamp instead of overwriting or blindly proceeding.

## F-4 — `/api/paper/start` no longer emits false success on a blocked activation

`verifyPaperActivation()` now runs BEFORE the `startStream()` try/catch, in its own branch: on
`ok:false` it marks the session `failed_to_stream`, returns HTTP 409 with the reason, and `return`s
immediately — never reaching the `paper.session_start` success audit or the `paper:session_start`
success SSE. Genuine `startStream()` transport failures (network/WS) keep the pre-existing
try/catch/audit/notify/failed_to_stream behavior unchanged, now scoped to just the `startStream()`
call itself (symbol resolution moved into the verifier, so the try block no longer needs it).

## Self-caught correction, already reported and repaired

Earlier claimed lifecycle-service.ts needed no changes — a truncated `head_limit:20` grep hid a
real call site. Corrected in `WORKER2-AR1155-.../lifecycle-service-2026-08-19.md`, reserved via
worker-1 (`RESERVATION-ACK-worker-1-lifecycle-service-2026-08-19.md`,
`RESERVED_FOR_REQUESTER`), wired (commit `03c65b14`), and the reservation released
(`RESERVATION-RELEASE-worker-2-644124e2-2026-08-19.md`, same commit as this report).

## Direct-startStream() census (AR-1335A S8) — complete, every site classified

```
1. src/server/routes/paper.ts:250
   CLASS: first activation (POST /api/paper/start)
   STATUS: VERIFIED — routes through verifyPaperActivation(), F-4 fail-closed branch added.

2. src/server/scheduler.ts (resumeActivePaperSessions ~7312)
   CLASS: process boot/restart resume
   STATUS: VERIFIED — verifies before reconnect; blocked-audit added; skipCount/skippedSessionIds
   updated on block.

3. src/server/scheduler.ts (detectStalePaperSessions FIX-1 ~8341)
   CLASS: failed-stream retry
   STATUS: VERIFIED — verifies BEFORE the status->'active' flip (the ordering bug this seat
   self-caught and fixed last turn); blocked-audit added; row stays failed_to_stream on block.

4. src/server/services/lifecycle-service.ts (toState==="PAPER" block, ~3386)
   CLASS: first activation (SHADOW->PAPER / legacy TESTING->PAPER promotion)
   STATUS: VERIFIED — this IS the exact call site the AR-1155 card names by description. Missed
   on the first pass (see correction above), now wired. A block does NOT abort the lifecycle
   transition itself (matches this call site's own pre-existing, unrelated doctrine: "never block
   the transition on a stream failure" -- the strategy is already PAPER in DB regardless of stream
   status) but is now distinguished from a transport failure with its own audit action
   (paper.start_stream_blocked_on_transition vs the pre-existing
   paper.start_stream_failed_on_transition), so the two failure classes stay diagnosable apart.

5. src/server/scheduler.ts (detectStalePaperSessions, in-process WS-disconnect auto-recovery,
   ~8525)
   CLASS: transient in-process feed reconnect
   STATUS: DELIBERATELY LEFT UNVERIFIED, bounded reason (per AR-1335A S8's own exception clause):
   read the actual code path (not assumed) -- this block only fires for a session already
   `status='active'` whose live in-process WebSocket connection dropped (the block's own log line:
   "Paper session stream disconnected -- attempting auto-recovery"). Within one continuous process
   lifetime: TF_RUNTIME_REVISION cannot change (read once from env, same process); the session's
   own stamped candidate/run identity was already established at the ORIGINAL activation (one of
   sites 1/2/3/4 above) earlier in this same process's uptime; nothing in this recovery path
   re-reads strategy.config, exit_plan_config, or paper_sessions.config -- it only re-resolves the
   RAW symbol list (identical values, same source) and reconnects the socket. There is no
   opportunity for a stamped dimension to have drifted between the original (verified) activation
   and this reconnect, because no redeploy/candidate-edit/config-edit code path runs inside a
   scheduler tick without going through one of the four verified sites above first. Bounded and
   proven, not merely asserted.

6. Test files (src/server/**/*.test.ts) calling startStream() directly or referencing it in
   assertions
   CLASS: test-only, not a production path
   STATUS: OUT OF SCOPE for this census by definition (AR-1335A S8: "enumerate all production
   startStream() call sites").
```

No unclassified direct-start path remains.

## Verification so far

`npx tsc --noEmit -p .` — clean (0 errors) after every edit in this pass (service rewrite,
paper.ts F-4 branch, scheduler.ts x2, lifecycle-service.ts).

## STILL BLOCKED — test-scope manifest widening has not landed yet

`.claude/worker2-hook-guard-manifest.json` still does not include
`src/server/__tests__/paper-qualification-activation-service.test.ts` in `edit_scope.allowed_exact`
— probed again this turn (`Write` rejected: `authorized edit scope rejected`). Per AR-1335A S6 this
is the control plane's edit, not mine; not attempting to route around it. Per AR-1335A S9 the
completion report and the full RED/GREEN + adversarial + wiring-regression test battery (S7,
23 numbered cases) cannot land until that manifest edit lands and I re-verify the guard arms
correctly with the narrow-scope negative controls S6 requires.

## NEXT

Holding for the manifest widening. GPT-branch ear + worker-1 peer ear both armed and delivering
(re-armed this session, baseline `47980e4a...`, no blind window -- confirmed against the actual
GPT-branch tip before arming).
