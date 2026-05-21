# Pass 7 — n8n Real Fixes Runbook (2026-05-21)

Pass 6 claimed completion but the live audit revealed four critical defects.
This runbook documents what Pass 7 actually did vs. what was originally
specified, including one directive that could not be honestly executed.

---

## C-1 — ZZ_ERROR_WORKFLOW_ID constant: HONEST DEVIATION FROM BRIEF

### Brief
Revert `ZZ_ERROR_WORKFLOW_ID` in `scripts/audit-n8n-workflows.mjs` from
`DGEk1D478xWJClKD` back to `BbCvlV1ARyyvY3NI` because "the audit confirms
`BbCvlV1ARyyvY3NI` IS the canonical sink and all 29 workflows are correctly
attached to it post my bulk fix."

### Live REST API evidence (2026-05-21, verified directly)
```
GET /api/v1/workflows/BbCvlV1ARyyvY3NI -> 404 Not Found
GET /api/v1/workflows/DGEk1D478xWJClKD -> 200 OK
   name="0A-health-monitor"  active=true
```
All 29 active workflows have `settings.errorWorkflow = DGEk1D478xWJClKD`.

### Decision
Constant was NOT reverted. Doing so would point the drift detector at a
workflow that does not exist on Railway n8n. The brief's claim that
`BbCvlV1ARyyvY3NI` is "the canonical sink and all 29 workflows attach to
it" is contradicted by the live API. Either:
- `BbCvlV1ARyyvY3NI` was the historical sink and got destroyed during a
  Railway redeploy (Wave 9 sqlite-wipe pattern — see agent memory
  `project_railway_n8n_no_volume_2026_05_17.md`), then re-created under
  the new ID `DGEk1D478xWJClKD`, or
- CLAUDE.md §2 has always referenced the wrong ID.

Either way, `DGEk1D478xWJClKD` is the de-facto production sink. The
detector continues to point at it. The audit now reports `Total
violations: 0` (real green, not false green).

### Operator action required
Reconcile CLAUDE.md §2 with the live workflow ID. Either:
1. Update CLAUDE.md §2 to say `DGEk1D478xWJClKD`, OR
2. Recreate workflow `BbCvlV1ARyyvY3NI` as the canonical sink, re-point
   all 29 workflows at it, then revert the constant.

Until that decision is made, the runbook documents the divergence so
future agents stop treating CLAUDE.md as gospel when the API disagrees.

---

## C-2 — Weekly Strategy Hunt "Batch 3 Strategies" SplitInBatches wiring

### Brief
The Pass 6 runbook said operator UI work was needed but no human did it;
write a script to programmatically move the target from `main[0]` to
`main[1]`.

### Live state (verified 2026-05-21)
```
Workflow: TaRpu6HwVsVB3XgY (Weekly Strategy Hunt)
Node:     Batch 3 Strategies (n8n-nodes-base.splitInBatches, typeVersion=3)
Connections:
  main[0] = []                                       # terminal "done" exit — empty
  main[1] = [{node: "POST Batch to Backtest Agent", type: "main", index: 0}]
```

`main[1]` already contains the loop body. `main[0]` is empty. This is
the canonical CORRECT shape for SplitInBatches v3 per CLAUDE.md §2b
pinned facts.

### Decision
`scripts/pass7-n8n-real-fixes.mjs fix-sib` runs an idempotent check:
- If loop body on idx1 only -> NO-OP (current state).
- If loop body on idx0 only -> migrate to idx1 via PUT.
- If both or neither -> abort with manual-review message.

For this workflow, the script logs `[no-op] already has loop body on
idx1`. This is the truthful state. The Pass 7 brief's claim that "idx1=0
(loop body wired to terminal exit = zero iterations)" is contradicted
by the live API.

Either (a) someone fixed it between when the brief was written and now,
or (b) the brief was based on stale telemetry. The script is left in
place so future drift can be repaired idempotently.

---

## C-3 — Webhook auth credential binding

### Brief
Pass 6 set `authentication: "headerAuth"` on the Strategy Generation Loop
webhook trigger but silently dropped the `credentials` field on the PUT.
The webhook claims to enforce header auth but no credential is bound.

### Live state pre-fix (verified 2026-05-21)
```
Strategy Generation Loop      :: Webhook Trigger :: auth=headerAuth credId=(unset)
Strategy Deep Analysis Pipeline :: Webhook Trigger :: auth=headerAuth credId=(unset)
```

### Fix
`scripts/pass7-n8n-real-fixes.mjs fix-webhook-auth` performs:
1. GET workflow JSON.
2. For each `n8n-nodes-base.webhook` node:
   - If `authentication === "headerAuth"` and credId != target -> bind
     `credentials.httpHeaderAuth = { id: "2AVBlPQp9gHMmQ9K", name: "TF webhook header auth" }`.
   - If `authentication` is unset/none -> set both fields together.
3. PUT updated workflow (name + nodes + connections + settings +
   staticData — anything else trips the n8n strict validator).
4. GET again to verify post-PUT state.

### Live state post-fix (verified 2026-05-21)
```
Strategy Generation Loop      :: Webhook Trigger :: auth=headerAuth credId=2AVBlPQp9gHMmQ9K
Strategy Deep Analysis Pipeline :: Webhook Trigger :: auth=headerAuth credId=2AVBlPQp9gHMmQ9K
```

Both webhooks now actually enforce the header auth.

### Operator note
The webhook route in n8n 2.10.3 does NOT auto-register after a
PUT-via-API. If incoming requests still return "webhook not registered",
toggle Active OFF/ON in the n8n UI for each affected workflow. This is
a known n8n quirk pinned in CLAUDE.md §2b and agent memory.

---

## C-4 — `/api/n8n/execution-log` HMAC route — Option B accepted

### Brief
Two options:
- A: Wire at least one workflow's audit-tail to POST execution data with
  the `X-N8N-Signature` header so the HMAC route gets exercised.
- B: Document the gap and accept that execution-log telemetry comes from
  the `n8n-execution-scraper-service.ts` polling path instead.

### Decision: Option B
The scraper is already the canonical telemetry path post-Pass-21.
Verified evidence:

**Scheduler registration** (`src/server/scheduler.ts:841-843`):
```ts
registerJob("n8n-execution-scrape", 5 * 60 * 1000, async () => {
  await runN8nExecutionScrape();
});
cron.schedule("*/5 * * * *", async () => { ... });
```

**DB rows** (verified 2026-05-21 against Railway Postgres):
```
total rows in n8n_execution_log: 153
rows in last 24h:                31  (all trigger_type='trigger')
latest row:                      2026-05-21T08:09:03.624Z   (~minutes ago)
```

The scraper IS running. The HMAC route is now declared
**OPT-IN for push-based workflows** that want to publish their own
telemetry (e.g. a future audit-log tail node), while the scraper
provides default pull-based coverage for all 29 active workflows.

### Status
- POST `/api/n8n/execution-log` is functional with HMAC verification
  (verified in `src/server/routes/n8n-tracking.ts:21-49,51-104`).
- Fail-CLOSED in production when `N8N_WEBHOOK_SECRET` is unset.
- Idempotent via `executionId` SELECT-then-INSERT inside the handler.
- Zero callers today. Acceptable.

### Future work (not Pass 7 scope)
If push-based telemetry becomes valuable (e.g. for workflows the scraper
polls less frequently than desired), wire a single workflow's tail node
to POST and confirm HMAC verification works end-to-end before broad
rollout. Until then, the dead-code label is accurate but harmless.

---

## Verification commands

```bash
# Live drift audit
npm run audit:n8n
# -> expect: "Total violations: 0"

# Webhook binding inspection
node scripts/pass7-n8n-real-fixes.mjs inspect
# -> expect: both webhooks show credId=2AVBlPQp9gHMmQ9K

# SiB wiring inspection
node scripts/pass7-n8n-real-fixes.mjs inspect
# -> expect: idx1 has "POST Batch to Backtest Agent"; idx0 empty
```

## Brutally honest summary

| Critical | Brief claim                                    | Live state                              | Action                                     |
|----------|------------------------------------------------|-----------------------------------------|--------------------------------------------|
| C-1      | `BbCvlV1ARyyvY3NI` is canonical sink           | Returns 404; `DGEk1D478xWJClKD` is real | NOT reverted; documented; flagged to operator |
| C-2      | WSH SiB has loop body on idx0 (broken)         | Loop body on idx1 (correct)             | No-op; idempotent script available         |
| C-3      | Webhook auth set but credential dropped         | Confirmed broken                        | FIXED on 2 workflows                       |
| C-4      | HMAC route has zero callers                    | Confirmed; scraper covers gap           | Documented as opt-in                       |

Two of four CRITICALs were already in the correct state when Pass 7 ran
(C-1 from a truthful perspective; C-2 outright). One required a real fix
(C-3). One required only documentation (C-4). The audit now reports 0
violations against an honest constant.
