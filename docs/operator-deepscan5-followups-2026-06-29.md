# Operator Runbook — Deep-Scan #5 Follow-ups (2026-06-29)

Code items 1–3 from the deep-scan #5 close-out are **fixed in code and verified** on branch
`hardening/deepscan5-closeout-2026-06-29` (see AGENT-LOGS). The items below are **operator-action only**
— they require the n8n UI, the tower (`ollama`), or infra/hardware that cannot be changed safely from
code. Each is self-contained; do them in any order. None blocks paper-trading today.

---

## 1. n8n `3A-workflow-backup` — make the backup actually durable (HIGH)

**Why:** The workflow emits "Backup Complete" via SSE but its "Store Backup" Code node never POSTs the
workflow JSON anywhere durable. If Railway n8n storage is wiped (happened in Wave-9 — 29 workflows lost),
the backup is a no-op and you get a false-success. The backend sink is already live:
`POST /api/admin/workflow-backup` → `workflow_backups` table (migration 0184). Only the n8n node is unwired.

**Fix (n8n UI — Railway `n8n-production-84ff.up.railway.app`, workflow id `5bfT33w0TylM0Hbk`):**
1. Open the workflow → "Store Backup" Code node.
2. Make it iterate every workflow item and POST each to the backend. Replace the node body with:
   ```js
   const items = $input.all();
   const base = $env.TF_BACKEND_PUBLIC_URL || 'https://tf-relay-production.up.railway.app';
   const secret = $env.WORKFLOW_BACKUP_SECRET || '';
   let ok = 0, fail = 0;
   for (const it of items) {
     const wf = it.json;
     try {
       await $helpers.httpRequest({
         method: 'POST',
         url: `${base}/api/admin/workflow-backup`,
         headers: secret ? { 'X-Backup-Secret': secret } : {},
         body: { id: wf.id, name: wf.name, full_json: wf },
         json: true,
       });
       ok++;
     } catch (e) { fail++; }
   }
   return [{ json: { backed_up: ok, failed: fail, total: items.length } }];
   ```
3. Move the "Broadcast Backup Complete" node so it fires ONLY after this node succeeds with `failed === 0`
   (wire it off the success output; add an IF node on `{{$json.failed}} === 0`).
4. **Verify:** run the workflow manually → confirm a row appears in `workflow_backups` with a non-empty
   `full_json.nodes` array. (The 2:15 AM `scripts/n8n-workflow-sync.ts` repo snapshot is a working
   secondary backup, but it is not family-recoverable — this is the durable primary.)

---

## 2. n8n `0A-health-monitor` — the 5-minute health schedule has NEVER fired (HIGH)

**Why:** n8n activates only a workflow's PRIMARY trigger. `0A-health-monitor`'s primary trigger is the
`executeWorkflowTrigger` (its error-sink role, id `DGEk1D478xWJClKD`). The co-resident "Every 5 Minutes"
schedule node never activates → the proactive health-aggregation + alert path is dark. (The every-minute
`TF Health Watchdog` gives liveness cover, so this is not a total outage — but 0A's richer health/alert
logic doesn't run.)

**Fix (n8n UI):** Split the 5-minute health check into its OWN standalone workflow whose PRIMARY trigger
is the Schedule node:
1. Create a new workflow "0A-health-check-5min".
2. Add a Schedule Trigger (every 5 minutes) as its primary trigger.
3. Copy the health-check nodes from 0A (`GET /api/health` → evaluate → `POST /api/alerts` on RED).
4. Set its `settings.errorWorkflow = "DGEk1D478xWJClKD"`.
5. Activate it. Leave `0A-health-monitor` as the error-sink only.
6. **Verify:** after ~10 min, confirm the new workflow shows ≥1 execution in the n8n executions list.

---

## 3. Watchdog self-restart — move restart authority OFF the dying process (HIGH)

**Why:** `TF Health Watchdog` POSTs `/api/admin/self-restart` — a route on the SAME backend it's trying to
restart, reached through the SAME relay. If the backend is truly down, the POST can't be served, so
self-restart only helps a hung-but-alive process, never a crashed one. (All 7 of the period's watchdog
errors died here; recovery was external.) Also, a restart-failure currently aborts the run before the
Discord alert node, so no operator alert fires.

**Fix (two parts):**
- **n8n UI (immediate, partial):** On `TF Health Watchdog` (`pajWJxqX37zKkooV`), set the
  `POST self-restart` node to `onError: continueRegularOutput` + `continueOnFail: true`, and wire the
  Discord/`__oc` alert node off the FAILURE branch so an operator alert fires when restart fails.
- **Infra (real fix):** Restart authority must not live inside the process being restarted. Options:
  - Railway: add a service **healthcheck** that auto-restarts the container on repeated health failure
    (Railway Settings → Healthcheck Path → `/api/health`, restart policy on failure), OR
  - Tower: the dead-man's-heartbeat → KASA remote power-cycle path already exists (CLAUDE.md §15a) for the
    tower-side backend; ensure `KASA_DEVICE_IP` + creds are set so the 4th-attempt power-cycle is armed.

---

## 4. Pull the degraded-tower models BEFORE reactivating the research workflows (operator, tower)

**Why:** The tower's Ollama serves ONLY `gemma4:e2b` today. `deepseek-r1:14b` + `nomic-embed-text` return
404. These dead models are referenced ONLY by the **inactive** research/strategy-gen workflows (Strategy
Generation Loop, Nightly Strategy Research Loop, Weekly Strategy Hunt, Strategy Deep Analysis Pipeline,
Strategy Tournament, Nightly Self-Correction). **Zero ACTIVE workflow is blocked.** They will fail the
moment those research workflows are reactivated.

**Fix (tower shell, only when you intend to turn the research front-end back on):**
```bash
ollama pull deepseek-r1:14b
ollama pull nomic-embed-text
# verify both resolve:
curl -s https://tf-relay-production.up.railway.app/__ollama/api/tags | grep -E "deepseek-r1:14b|nomic-embed-text"
```
Then reactivate the research workflows in the n8n UI. Do NOT reactivate them before the pulls complete.

---

## Minor (low urgency, n8n UI)
- `Slumdawg Analyst — Anam Tools Gateway` (`4mlEUCez5FJ90GiT`): 5 tool HTTP nodes have `onError=None` —
  set `continueRegularOutput` + a normalized error body so the agent gets a usable tool error instead of a
  hard webhook failure. (Gateway is idle today.)
- Monthly cron near-collision at 03:00 on the 1st: `14A-master-nightly-intelligence` (`0 3 * * *`) and
  `Anti-Setup Refresh` (`0 3 1 * *`) collide monthly. Stagger Anti-Setup to `10 3 1 * *`.
- Export per-workflow repo backups for the 10 inactive research/strategy-gen workflows (covered only by
  `_live-snapshot-2026-06-29.json` today) so version control covers the dark research front-end.
