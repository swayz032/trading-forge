---
name: tf-debugging
description: >-
  Use when debugging ANY Trading Forge failure — API down / NSSM crash-loop,
  circuit-breaker or Discord CRITICAL alerts, ollama/extraction failures,
  401/503/timeout errors, sudden mass test failures, pytest hangs, n8n silence
  or workflow errors, "table missing but migration applied", stuck jobs,
  false-green detector reports, tower freezes — BEFORE forming hypotheses,
  proposing fixes, or restarting anything. Also use when a symptom looks like
  hardware (GPU/TDR/VRAM) or when tempted to "just restart it".
---

# TF Debugging — the misdiagnosis firewall

## Overview

This repo keeps a catalog of **proven** misdiagnoses — each row below cost a
real session hours (or took prod down) before the true cause was pinned.
Checking the firewall takes 60 seconds; re-deriving a pinned cause from logs
and code measurably costs 100K+ tokens (baseline test 2026-07-09: a capable
agent needed 21 tool calls / 184K tokens to reconstruct row A1 from scratch).

**REQUIRED BACKGROUND:** superpowers:systematic-debugging owns the process
(root cause before fixes, one hypothesis at a time). This skill supplies the
Trading Forge PRIORS: symptom→cause table, where truth lives, what NOT to
conclude, what NOT to "fix".

**Protocol:** match the symptom below → run that row's cheap verification →
confirmed: apply the pinned fix; not confirmed: fall back to
systematic-debugging Phase 1 (and update the pin if it's genuinely new).
The firewall replaces hypothesis-guessing, never verification.

## Firewall A — infrastructure / incidents

| Symptom | Do NOT conclude | Proven cause → verify → fix |
|---|---|---|
| A1. `Circuit breaker OPEN: ollama`, extractions failing | GPU dying / TDR / model corrupt / "re-pull the model" | Two causes, split via `GET :11434/api/ps`: **(a) empty** → cold-load spiral (client timeout aborts load, every retry re-aborts; server.log says `aborting load`) → `OLLAMA_KEEP_ALIVE=-1` + ONE patient warm call ≥180s (never `keep_alive:0`); **(b) "resident" but calls hang**, multiple `llama-server.exe` PIDs, server.log `cudaMalloc failed` / `TerminateProcess: Access is denied` → orphaned llama-server holding VRAM after a freeze/TDR (2026-06-29) → kill ALL `*llama*`/`*ollama*` processes, confirm VRAM freed via `nvidia-smi`, relaunch `ollama app.exe`, patient warm. Ollama is a plain USER-level process (no elevation, no NSSM, no HMAC needed). Since 2026-07-09 it IS supervised: `TF-OllamaWatchdog` scheduled task runs `scripts/ollama-watchdog.ps1` every 5 min (auto-detects both branches, busy-vs-wedged GPU-util guard, ≤3 kill-cycles/24h, disable via `bin\ollama-watchdog.DISABLED`) — check `bin\ollama-watchdog.log` FIRST; a live alert means the watchdog already tried and is rate-limited or failed. |
| A2. Whole API down, NSSM shows Paused, crash-loop | "restart the service" | You CANNOT (not elevated; HMAC self-restart needs the API up). Cause = fail-closed boot-migration: BOM in `_journal.json`/`.sql`, or a bad migration (type mismatch; `audit_log` has NO `payload` column and `status` is NOT NULL). Verify: audit_log `migration.auto_apply_failed` rows FIRST + boot log. Fix the working tree; NSSM auto-restarts after its throttle. See skill `migration-author`. |
| A3. Crash-loop right after a self-restart | code bug in new build | Partial node_modules wipe (2026-07-04) → verify deps exist → `npm install`. Always verify deps BEFORE any self-restart. |
| A4. Relay 401 `proxy_token_required` on `/__oc/*` or `/__ollama/*` | tower auth broken / endpoint down | Relay-side `OLLAMA_PROXY_TOKEN` gate → send header `X-Relay-Proxy-Token`. n8n nodes LOSE this header on Railway redeploy (ephemeral sqlite) → re-apply to the ~16 `/__oc/*` nodes when a Discord channel goes silent. |
| A5. `/api/*` returns 503 `auth_not_configured` | regression / "set AUTH_DEV_BYPASS" | INTENDED deep-scan #13 secure state (API_KEY unset). NEVER set `AUTH_DEV_BYPASS` (reopens a CRITICAL hole). Auth paths: `Authorization: Bearer <API_KEY>`, Office admin cookie, Discord cookie (GET only). |
| A6. Self-restart 401 `timestamp_drift_exceeded` with absurd drift | HMAC secret wrong | Endpoint multiplies by 1000 — send Unix SECONDS (`date +%s`), never ms. |
| A7. Double Discord replies / relay thrash | bot bug | PM2 silently duplicating services alongside NSSM → `pm2 list` → `pm2 delete` dupes + `pm2 save`. |
| A8. 404s for `deepseek-r1` / `qwen2.5` / `nomic-embed-text` / `gemma4:e2b` | "tower missing models — pull them" | Intentionally RETIRED (2026-07-03). Tower serves ONE model: `gemma4:e4b-it-qat`. Fix = repoint the stale reference, never re-pull. |
| A9. Table/column missing but journal says migration applied | runner broken / "re-run it" | File-drift-after-apply: runner keys on the JOURNAL, a rewritten already-applied file never re-runs. Fix FORWARD with a NEW migration; never edit an applied file expecting re-run. |
| A10. Jobs stuck `pending` / purge 500 / error `audit_log is append-only` | "drop the trigger" | The append-only trigger IS the Trust Spine. Mutable state belongs in `agent_jobs`; completion = NEW `.completed` row sharing correlation_id. Fix the caller. |
| A11. n8n MCP `NO_RESPONSE` | n8n down | MCP config points at localhost; live n8n is on Railway. Use REST: `curl -H "X-N8N-API-KEY: $TF_N8N_API_KEY" $N8N_BASE_URL/api/v1/workflows`. PUT body = ONLY `{name,nodes,connections,settings}`. Repo `workflows/n8n/*.json` are STALE backups, not live source. |
| A12. n8n workflow DELETE returns 500 (API and UI) | permissions / archived state | `workflow_published_version` RESTRICT FK bug → clear that row in n8n's Postgres (schema `n8n`, Railway), then delete. |
| A13. n8n branch silently does ZERO work | node broken | SplitInBatches v3: output 0 = "done", output 1 = "loop". Downstream wired to 0 runs nothing. Wire to 1. |
| A14. Tower froze / hard freeze during the day | backtest load | No backtests run yet. Suspects: Chrome/TradingView GPU contention, parallel subagent swarms, TDR (Event Viewer System 4101 `nvlddmkm`). |
| A15. WebFetch says 404 on `lab.anam.ai/frame/{id}` | link dead | WebFetch lies here — `curl -I` returns 200. Verify with curl before believing WebFetch on this host. |

## Firewall B — tests / CI

| Symptom | Do NOT conclude | Proven cause → fix |
|---|---|---|
| B1. EVERY DB-backed suite fails at once: `column "X" of relation "backtests" does not exist` | "my new test broke everything" | pglite harness drift: `helpers/pglite-db.ts` CORE_DDL must mirror schema.ts. Add the new column to CORE_DDL in the SAME change as the migration. |
| B2. ~90 vitest failures repo-wide | "the build is broken, fix everything" | Known pre-existing failure set. Measure the DELTA vs baseline; your gate is net-new failures = 0. (Anything you actively touch: fix-don't-skip.) |
| B3. pytest HANGS at collection on the tower | infinite loop in my test | Bare import transitively pulls the vectorbt-JIT backtester → hangs. Mock vectorbt; never bare-import engine modules in tests. |
| B4. `tsc` reports clean | Trust it blindly / distrust it blindly | Verified 2026-07-09: `tsc --noEmit -p .` on the MAIN checkout genuinely IS exit 0 / zero errors (the old "~7036 baseline" pin was stale, corrected). In a WORKTREE with no node_modules, `npx tsc` runs a troll stub that also prints exit 0 — same symptom, opposite cause. Discriminator: `echo $?` immediately after tsc, NEVER through a pipe (`tsc \| tail` swallows tsc's real exit code — tail's own 0 masks it). If genuinely suspicious, inject one deliberate type error and confirm tsc catches it before trusting either a 0 or a stub. See skill `worktree-session`. |
| B5. Previously-green test fails with a staleness/window rejection or off-by-a-fixed-amount number | logic regression | Real-clock drift past hardcoded timestamps. `stale_payload` 401 = replay-window, NOT auth. Fix: `vi.setSystemTime` or sign a FRESH `bar_timestamp`. Webhook HMAC canonical = fixed-field `strategy\|account\|bar_ts\|signal`, not sorted-JSON. |
| B6. A promotion gate "passes" a strategy that should block | gate logic fine | Wrong-key grandfather-PASS: producer writes JSONB under a different key than the reader → `undefined` → legacy-PASS. Add the chain to `gate-chain-integration.test.ts` (pglite, real readers). NEVER mock the DB for gate-chain tests — mocking created this blind spot. |
| B7. A detector/recon/dashboard reports green or zero | "we're clean" | False-green class: empty-table false-green (DS#18b), fabricated-mock-masks-null-column (hunt: `count(col)` vs `COALESCE(col,0)`; failure-inject the REAL null), gate citing its own self-report. Verify via accuracy-validator, two non-overlapping paths. |
| B8. `system-map:check` still RED after `system-map:sync` | sync broken | Sync does NOT reconcile the hand-maintained SSE inventory or `docs/system-subsystem-registry.json` — manual edits (grep-verify a real `broadcastSSE(` emitter). |

## Deliberate design — do NOT "fix" these

- 503 `auth_not_configured` (A5); `AUTH_DEV_BYPASS` stays unset. Ever.
- 0 backtests / all-CANDIDATE / nothing live — intentional hardening-first phase.
- DSL `entry_short = "high < low"` — deliberate never-true sentinel, not incoherence.
- Bare `close > X` DSL entries — engine auto-shifts +1 bar (`np.roll`); no "next bar" qualifiers needed.
- HTF MTF join +1-bar shift — look-ahead guard. Never remove/"optimize" it; when auditing, probe an exec bar INSIDE a forming HTF bar.
- Dead-man heartbeat AUTO-restart — never revert to alert-only (a real 5.8-day silent outage created it).
- ~66% null `correlation_id` in audit_log = cron/background noise; live-trade paths DO thread it.
- Style D is dead; `direction: both` is the soft default; win rate is never a target.
- Transcript-extractor strictness (refusing to fabricate parameters) is a feature — improve inputs, don't relax the prompt.
- n8n never pauses by design — the backend pauses; the queue keeps feeding.

## Where truth lives (evidence map)

- **audit_log** — append-only (trigger-enforced); body in `input`/`result` JSONB; `status` NOT NULL; there is NO `payload` column. For "migration not applied": check `migration.auto_apply_failed` rows FIRST.
- **correlation_id** — thread end-to-end: bar → handler → DB → SSE → audit_log. Any 90-day-old trade must reconstruct.
- **`GET /api/health`** — includes ollama status + `circuitBreakers` (state, consecutiveFailures, reopensAt) in one call.
- **Ollama** — `:11434/api/tags`, `/api/ps`; log at `%LOCALAPPDATA%\Ollama\server.log` (`aborting load` = spiral; `cudaMalloc failed` / `TerminateProcess: Access is denied` = orphan).
- **n8n** — REST API only (A11); global error sink = `0A-health-monitor` (`DGEk1D478xWJClKD`) errorWorkflow.
- **Windows** — Event Viewer System 4101 `nvlddmkm` = TDR timestamp; NSSM runs tsx SOURCE directly (no build step); `bin/*.log` (e.g. kasa-cycle.log).

## Hard constraints on YOU (the debugging agent)

- Cannot restart/stop the NSSM service (Access denied). Recovery = fix the tree and let NSSM auto-restart, HMAC self-restart (API must be up; SECONDS), or operator elevated.
- Never write `.sql`/`_journal.json` via PowerShell (BOM → A2). Use Write/Edit/node.
- Shared working tree: commit ONLY via `git commit -o <paths>` (or `git commit -- <paths>`). NEVER `git add <paths>` followed by a bare `git commit` — a bare commit snapshots the whole shared index and sweeps the other session's staged files (incident `b6de45a`). See skill `worktree-session` / CLAUDE.md §11b.

## Fix discipline (after the cause is confirmed)

1. Root cause, not workaround (CLAUDE.md §2); failing test before the fix.
2. Fix-don't-skip: bugs found while verifying get fixed in the current wave, never logged-and-skipped.
3. Failure-inject the REAL failure shape (the actual null/empty-table), never a fabricated mock value (B7).
4. Any "fixed"/"resolved" claim routes through skill `grading-integrity` — doer ≠ grader.
5. Commit-and-push after green per §11a.

## Red flags — STOP, you're about to repeat a documented mistake

- "Probably the GPU / driver / hardware" (A1, A14 — check the firewall first)
- "Just restart / reinstall / re-pull it" (A1, A2, A8)
- "Set AUTH_DEV_BYPASS to unblock" (A5)
- "Drop the trigger / remove the +1 shift / relax the gate to make it pass" (A10, design list)
- "Tests were already failing, ignore the reds" without a delta count (B2)
- "Mock the DB so the gate test passes" (B6)
- "Edit the applied migration so it re-runs" (A9)
- A green report accepted from the system's own self-report (B7)
