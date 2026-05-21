# n8n Operator Runbook — Pass 6 / Track C Fixes

These two fixes must be applied **inside the n8n editor** because the
workflows live on Railway n8n cloud (`https://n8n-production-84ff.up.railway.app`)
and the repo has no source-of-truth JSON for them. The drift detector
(`scripts/audit-n8n-workflows.mjs`) now asserts both fixes so future
regressions surface in CI / monthly cron.

Take a workflow JSON export (Editor → ⋯ → Download) before each change.
The ZZ global error sink is `BbCvlV1ARyyvY3NI`.

---

## F-2 — Weekly Strategy Hunt: SplitInBatches v3 wired to wrong output

**Workflow:** `sAIrnCVB4iOsodsy` ("Weekly Strategy Hunt")
**Severity:** CRITICAL — pinned-fact violation per `CLAUDE.md` §2b.

### Background
`SplitInBatches` v3 exposes **two** output indices:

| Index | Meaning |
|---|---|
| `0` | `done` — terminal exit after the loop finishes |
| `1` | `loop` — per-batch body, fires once per batch |

Wiring downstream work to index 0 silently runs **zero** iterations.
The "Batch 3 Strategies" node currently has its successor (`Generate Strategy DSL`
or equivalent) wired to index 0, so the workflow looks green but produces no
strategies.

### Fix
1. Open `https://n8n-production-84ff.up.railway.app/workflow/sAIrnCVB4iOsodsy`.
2. Locate the `Batch 3 Strategies` (SplitInBatches v3) node.
3. The node will show two output sockets. The **bottom** socket (index 1) is
   the loop body; the **top** socket (index 0) is the done branch.
4. Delete the connection from the top socket to the next node.
5. Drag a new connection from the bottom socket to that next node.
6. Save (`Ctrl+S`).
7. Toggle Active OFF → ON (n8n 2.10.3 sometimes needs this to re-register).
8. Trigger a manual execution and confirm at least one batch fires through
   the loop body (check execution log → step output count > 0).

### Verify
```bash
npm run audit:n8n
```
The `split_batches` section in `tmp-n8n/n8n-drift-report.md` must be empty
for workflow `sAIrnCVB4iOsodsy`.

---

## F-4 — Strategy Generation Loop webhook: unauthenticated trigger

**Workflow:** `eCr7…` ("Strategy Generation Loop")
**Severity:** HIGH — anyone with the relay URL can spam workflow runs.

### Background
The trigger node is a public `Webhook` (HTTP POST). It currently has
`Authentication = None`, so any caller can POST to the relay path and start
a strategy-generation cycle. We need shared-secret auth using the same
`N8N_WEBHOOK_SECRET` value that the backend uses to sign
`POST /api/n8n/execution-log` payloads.

### Fix
1. Open `https://n8n-production-84ff.up.railway.app/workflow/eCr7…` (use the
   live ID — see `reference_workflow_ids.md` in agent memory).
2. Click the `Webhook` trigger node.
3. Change `Authentication` from `None` to `Header Auth`.
4. Create a new credential `n8n-webhook-shared-secret`:
   - Name: `X-N8N-Signature` (or `Authorization` for Bearer style)
   - Value: paste the value of `N8N_WEBHOOK_SECRET` from Railway env
     (Settings → Variables on the backend service). DO NOT type it into
     plain text — use n8n's credentials vault.
5. Save the workflow.
6. Toggle Active OFF → ON.
7. Repeat for any other public-facing webhook trigger nodes — the drift
   detector flags ALL unauthenticated webhook nodes.

### Verify
```bash
npm run audit:n8n
```
`webhook_auth` section in `tmp-n8n/n8n-drift-report.md` must be empty for
`eCr7…` and any other production trigger.

### Backend side (already shipped Pass 6)
`POST /api/n8n/execution-log` now:
- Rejects requests with `X-N8N-Signature` header missing/invalid (401)
- Fails CLOSED in production if `N8N_WEBHOOK_SECRET` is unset
- Computes signature as
  `sha256=<hex of HMAC-SHA256(secret, JSON.stringify(body))>`

So when n8n calls back into the backend with execution telemetry, it must
attach the matching header — see the same credential when wiring the
"Notify Trading Forge" HTTP nodes.

---

## Drift detector coverage matrix

`scripts/audit-n8n-workflows.mjs` now asserts:

| Check | Flags |
|---|---|
| `error_workflow` | Non-ZZ active workflow without `settings.errorWorkflow == "BbCvlV1ARyyvY3NI"` |
| `split_batches` | SplitInBatches v3 with loop body wired only to index 0 |
| `webhook_auth` | Webhook trigger with `authentication` empty / `"none"` |
| `http_retry` | External-host httpRequest node with `retryOnFail !== true` |

Plus the pre-existing checks: API key drift, single-symbol prompts, scout
signal_type, port-4100 alerts, outdated typeVersions.

The detector exits non-zero on any violation so it can run as a CI gate or
monthly cron.
