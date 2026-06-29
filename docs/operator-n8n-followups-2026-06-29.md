# Operator n8n follow-ups — deep-scan #4 (2026-06-29)

Two n8n findings from deep-scan #4 are **live-workflow-body edits** that must be applied on the
Railway n8n instance. The session's n8n MCP/REST client points at `localhost:5678` and cannot
reach Railway, so these are operator actions. Apply via the n8n UI, or re-point a REST client at
`https://n8n-production-84ff.up.railway.app` with `TF_N8N_API_KEY` (workflow-body PUT is allowed
via REST; only the activation toggle is UI-gated on this instance).

Durable repo DR is already done (this commit): `14A-master-nightly-intelligence` now has a
committed copy in `workflows/n8n/`, and `workflows/n8n/_live-snapshot-2026-06-29.json` holds all
32 live workflows. A future n8n wipe is now recoverable from the repo.

> NOTE: a parallel session is wiring a backend `workflow_backups` table + `/api/journal`
> idempotency_key (see memory `project_deepscan4_fixwave_worktree_2026_06_29`). That is the
> automated DR path; the repo snapshot here is the manual belt-and-suspenders copy. They do not
> conflict.

---

## 1. [HIGH] `3A-workflow-backup` (id `5bfT33w0TylM0Hbk`) — backup persists nothing

**Problem:** the "Store Backup" Code node emits only `{id, name, active, nodeCount}` to the
workflow's own output, then SSE-broadcasts "Backup Complete". There is no durable write (no git,
no S3, no DB, no file) — every nightly run falsely reported success while backing up nothing.
Railway n8n is ephemeral sqlite with no attached volume (this is how the Wave-9 incident wiped 29
workflows).

**Fix:** change "Store Backup" to POST the **full** workflow JSON (the output of the
`Fetch Workflow Detail` node, which already contains the complete node graph) to a durable sink.
Cheapest option that requires no new infra: POST to the new backend endpoint the parallel session
is adding (`POST /api/admin/workflow-backup` → `workflow_backups` table). Until that lands, POST to
an external store (S3 bucket / GitHub Gist) or write each workflow to the repo via a CI job.

Acceptance: after a manual run, the full node graph for at least `14A` is retrievable from the
durable sink (not just metadata).

---

## 2. [HIGH] `lifecycle_state` snake_case query drift — wrong-scope processing

**Affected workflows:**
- `Daily Portfolio Monitor` (id `eZSbajXAi7v7tGPx`) — weekday 17:00 ET
- `Monthly Robustness Check` (id `RIK5eQ0rFEG78Vtd`) — 1st 06:00 ET

**Problem:** both call `GET /api/strategies?lifecycle_state=DEPLOYED` (snake_case). The route
(`src/server/routes/strategies.ts:70`) only destructures `lifecycleState` (camelCase), so the
filter is silently dropped and the endpoint returns ALL non-archived strategies. `Daily Portfolio`
then reads `strategy.lifecycle_state` (snake, `undefined` on the camelCase row) and defaults every
strategy to `DEPLOYED`. Result: drift/robustness machinery runs over the whole library every
weekday/month → false drift alerts + wasted `POST /api/agents/robustness` jobs on CANDIDATEs.

**Mitigant (no corruption):** both lifecycle PATCH writes hardcode
`{fromState:"DEPLOYED", toState:"DECLINING"}` and the lifecycle endpoint enforces the `fromState`
match, so wrong-scope strategies get a rejected (fail-closed) PATCH. Damage is wasted compute +
alert noise, not wrong demotions.

**Fix (2 string edits per workflow):**
1. In each fetch HTTP node URL: `lifecycle_state=DEPLOYED` → `lifecycleState=DEPLOYED`.
2. In `Daily Portfolio Monitor` → "Compute Rolling Sharpe" Code node: `strategy.lifecycle_state`
   → `strategy.lifecycleState`.

Acceptance: with 0 DEPLOYED strategies (current hardening phase), both workflows process an empty
set and emit no drift alerts / robustness jobs.

---

## 3. [LOW] Stale repo exports (folds into the DR commit)

`workflows/n8n/` still carried stale top-level `9A-` / `11A-` exports (both now archived live) and
was missing `14A`. The `_live-snapshot-2026-06-29.json` added this commit is the authoritative
current state; regenerate per-file exports from it (or from a future automated backup) when
convenient. Non-gating.
