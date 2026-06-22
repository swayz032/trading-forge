# n8n JWT Rotation Runbook (`TF_N8N_API_KEY`)

> **Owner:** operator (manual steps required — n8n Public-API JWTs cannot be rotated programmatically without UI access).
> **Audience:** future me, future agents. Read before assuming a 401 means "JWT expired."
> **Last audit:** 2026-06-22 (Fix Wave B).

---

## TL;DR — when is a rotation actually needed?

The current `TF_N8N_API_KEY` (decoded 2026-06-22) **has no `exp` claim** and therefore does NOT expire by JWT spec. n8n public-api JWTs in this deployment are non-expiring by design (issued at `iat=1779065010` = 2026-05-18; payload contains only `sub`/`iss`/`aud`/`jti`/`iat`).

**A 401 from `https://n8n-production-84ff.up.railway.app/rest/workflows` is NOT proof the JWT expired.** Possible 401 causes, in order of likelihood:

1. **n8n service was wiped / redeployed without volume.** Wave 9 (2026-05-17) precedent: `railway redeploy --service n8n` on ephemeral sqlite wiped 29 workflows and all API keys. Confirm via `GET /healthz` and Railway dashboard before assuming key rot.
2. **JWT was manually rotated in the n8n UI by an operator** (Settings → API → "Generate new"). The previous JWT becomes invalid the moment a new one is generated.
3. **n8n major-version upgrade** changed the JWT signing key (`N8N_ENCRYPTION_KEY` mismatch).
4. **Genuine expiry** — only if `exp` claim is present (decode and check).

**Do NOT** apply the Tavily pinned fact ("401 ≠ expired key") to n8n JWT diagnosis — that fact is Tavily-specific. n8n JWTs CAN expire if the issuer adds an `exp` claim (default 0.7.x+); current Railway deployment does not.

---

## Step 0 — Diagnose before rotating

Run this decode first. Do NOT rotate if `exp` is missing or far in the future.

```bash
# From tower (Git Bash):
JWT=$(grep ^TF_N8N_API_KEY .env | cut -d= -f2)
node -e "
  const p = '$JWT'.split('.')[1];
  const payload = JSON.parse(Buffer.from(p, 'base64').toString());
  console.log(JSON.stringify(payload, null, 2));
  if (payload.exp) {
    const days = ((payload.exp - Date.now()/1000) / 86400).toFixed(1);
    console.log('Days until expiry:', days, 'Expired?', payload.exp < Date.now()/1000);
  } else {
    console.log('NO exp field — JWT does not expire by JWT spec');
  }
"
```

**Then independently probe the API:**

```bash
curl -sS -o /dev/null -w "HTTP %{http_code}\n" \
  https://n8n-production-84ff.up.railway.app/rest/workflows \
  -H "X-N8N-API-KEY: $JWT"
```

- `200 OK` → key valid; the original carry-forward (Wave A "JWT expired again") was misdiagnosed. Update AGENT-LOGS.
- `401 Unauthorized` → key invalid for some reason. Continue to Step 1.
- `5xx` → n8n service is down (NOT a key problem). Check Railway dashboard.

---

## Step 1 — Rotate the JWT (operator manual steps)

1. Open https://n8n-production-84ff.up.railway.app in a browser. Sign in with the owner account (creds: `tmp-n8n/n8n-owner-pw.txt` if you've lost the password manager entry).
2. Navigate **Settings → API → API Keys**.
3. Click **Create an API key**. Label it `tower-prod-YYYY-MM-DD`. Copy the JWT — it's shown ONCE.
4. Optionally delete the old key (only if you're confident no other consumer still uses it; the tower is the sole consumer per the Pass 21 topology).

## Step 2 — Update tower `.env`

```bash
# From the project root on the tower:
cd C:/Users/tonio/Projects/trading-forge/trading-forge
# Edit .env: replace TF_N8N_API_KEY=<old> with TF_N8N_API_KEY=<new>
```

The `.env` file is git-ignored. Do NOT commit.

## Step 3 — Push the new key to Railway

The Railway-hosted TradingForgeAPI also needs the new value (it does not call n8n REST today, but `audit:n8n` and any future Railway-side automation will).

```bash
# Requires RAILWAY_TOKEN in .env (memory: reference_railway_api_token)
railway variables set TF_N8N_API_KEY=<new-jwt> --service TradingForgeAPI
```

## Step 4 — Trigger backend self-restart (HMAC, SECONDS not ms)

`TF_N8N_API_KEY` is read at boot — process must restart to pick up the new value.

```bash
# CRITICAL: timestamp in SECONDS (admin.ts:97 multiplies *1000 internally).
# DO NOT use `date +%s%3N` (milliseconds) — see memory feedback_admin_restart_hmac_seconds.
TIMESTAMP=$(date +%s)
REASON="n8n-jwt-rotation-$(date +%Y-%m-%d)"
SIG=$(echo -n "${TIMESTAMP}:${REASON}" | openssl dgst -sha256 -hmac "$ADMIN_RESTART_HMAC_SECRET" | awk '{print $2}')

curl -sS -X POST https://tf-relay-production.up.railway.app/api/admin/self-restart \
  -H "Content-Type: application/json" \
  -H "X-Restart-Signature: $SIG" \
  -d "{\"timestamp\": $TIMESTAMP, \"reason\": \"$REASON\"}"
```

NSSM respawns the TradingForgeAPI process within ~2s (RestartDelay).

## Step 5 — Verify

```bash
curl -sS -o /dev/null -w "HTTP %{http_code}\n" \
  https://n8n-production-84ff.up.railway.app/rest/workflows \
  -H "X-N8N-API-KEY: <new-jwt>"
# Expect: HTTP 200
```

Re-run the affected audit:

```bash
npm run audit:n8n
```

## Step 6 — Document

Append a one-line entry to AGENT-LOGS.md under the latest Session Log:

```
- n8n JWT rotated YYYY-MM-DD. New iat=<unix>. Old jti=<uuid>. Reason: <what failed>.
```

---

## Known n8n → backend disconnects

> **Updated 2026-06-22 (Fix Wave B).** The Wave A snapshot claim that `tf-relay-production.up.railway.app` is "absent from backend code" is **WRONG** and was based on a too-narrow grep of `src/server/services/*.ts`. The correct picture:

### `tf-relay-production.up.railway.app` is the canonical Railway → tower relay

It is referenced in:

| File | Role |
|---|---|
| `ecosystem-relay-client.cjs:28` | PM2 boot config for the WebSocket relay client (`RELAY_SERVER: "wss://tf-relay-production.up.railway.app/__relay"`) |
| `ecosystem.config.cjs:95` | Same, fallback env block |
| `CLAUDE.md:893` (§15a Hosting Topology) | `TF_BACKEND_PUBLIC_URL=https://tf-relay-production.up.railway.app` — canonical |
| `docs/slumhouse-deployment.md`, `docs/slumdawg-analyst/README.md`, `docs/triage-2026-05-16.md` | OAuth + health probes |
| `src/server/__tests__/slumhouse/auth-route.test.ts:97` | Auth route test host-header |
| `src/server/db/migrations/0129_hmac_rotation_runbook.sql:70` | HMAC rotation runbook embedded in migration comment |

The relay is a **Railway-hosted Cloudflare-style forward proxy**. Traffic flows:

```
n8n (Railway)  →  https://tf-relay-production.up.railway.app/...  →  WSS  →  tower (NSSM)  →  localhost:4000 (TradingForgeAPI)
```

Workflow HTTP nodes calling `https://tf-relay-production.up.railway.app/api/...` are calling the **tower backend, just via the relay**. There is no service to "find in `src/`" — the relay is infrastructure, not code.

**Verdict:** the Wave A finding is **closed as misdiagnosis**. `tf-relay-production` is healthy and intentional. If `__relay/health` ever returns non-200, that IS a real outage — see `docs/triage-2026-05-16.md` for the recovery playbook.

### Real disconnects to watch

These are the *actual* drift risks, not the false positive above:

1. **Workflow URLs pointing at `host.docker.internal:4000`** — legacy local-dev URLs. Wave 9 Phase H swept these; spot-check after any large workflow import.
2. **Workflow URLs pointing at `localhost:4000`** — same class.
3. **`ollamaApi` credential `BLgLWvmLGaJQOYaF`** — historically pointed at the dead Docker URL; needs to be `https://tf-relay-production.up.railway.app/__ollama` (see AGENT-LOGS line 3683).
4. **`__archived` workflows** — `5I-tavily-scout_TMT3g7HenJ5etiwv.json` lives in `workflows/n8n/_archived/` but still references the relay. Archived means "do not deploy" — but if accidentally re-imported, the URLs are still valid.

---

## 03:00 UTC cron pile-up

> **Updated 2026-06-22 (Fix Wave B).** Full inventory from `src/server/scheduler.ts` + `workflows/n8n/*.json`. Wave A claimed "4 n8n workflows + 1 backend `idempotency-cleanup`" — the real count is larger.

### Backend (`src/server/scheduler.ts`) firing at 03:00 UTC (exact-minute conflicts)

| Line | Cron | Job | Pipeline-gated? |
|---|---|---|---|
| 1991 | `0 3 * * *` | `idempotency-cleanup` | yes |
| 3357 | `0 3 * * *` | `harsh-regime-phase-activation-check` | NO (deliberate — safety) |
| 1868 | `0 3 1 * *` | `meta-parameter-review` (monthly, 1st only) | yes |

Plus near-conflicts (same hour, different minute):

| Line | Cron | Job | Notes |
|---|---|---|---|
| 1812 | `0 3,4 * * *` | (line 1812 — verify) | dual-fire pattern |
| 1888 | `30 3 1 * *` | `validation-cadence-monthly` (Reality Check, 1st of month at 03:30 UTC) | NOT pipeline-gated |
| 2575 | `45 3 * * *` | `session-analytics-rollup` (11:45 PM ET) | yes |
| 2634 | `30 3,4 * * *` | (line 2634 — verify) | dual-fire pattern |

### n8n workflows (on-disk JSON) firing at 03:00 UTC

| File | Cron | Active in prod? |
|---|---|---|
| `11A-critic-optimization_MXTkxH5x8yjpLNXS.json` | `0 3 * * *` | check via live REST |
| `11A-critic-optimization_pVT6svNTljjBoQbW.json` | `0 3 * * *` | likely duplicate (two IDs same workflow) |
| `3A-workflow-backup_5bfT33w0TylM0Hbk.json` | `0 3 * * *` | check |
| `3A-workflow-backup_J0p8oYkONmN7pYn6.json` | `0 3 * * *` | duplicate |
| `7A-auto-evolution_MIIxmilbgZv3SUBh.json` | `0 3 * * *` | check |
| `7A-auto-evolution_eEt2dJrZbV6C7TRL.json` | `0 3 * * *` | duplicate |
| `Anti-Setup_Refresh_*.json` (2 files) | `0 3 1 * *` | monthly, 1st of month |

**Daily 03:00 UTC concurrency at peak:** 2 backend jobs (`idempotency-cleanup` + `harsh-regime-phase-activation-check`) + up to 3 unique n8n workflows (11A + 3A + 7A) = **5 concurrent jobs** if every duplicate-ID file is inactive and only one of each pair is live.

**First-of-month peak:** add `meta-parameter-review` (backend, 0 3 1 * *) + 2 `Anti-Setup_Refresh` workflows + `validation-cadence-monthly` at 03:30. Plausible to hit **8 concurrent jobs in a 30-min window** on the 1st.

### Risk assessment

- **`harsh-regime-phase-activation-check` is NOT pipeline-gated** by design (CLAUDE.md §12 — "must run when paused"). If it collides with `idempotency-cleanup` and the latter is mid-DELETE on `idempotency_keys`, the regime check will still run — but they touch disjoint tables, so DB-level conflict is unlikely.
- **3 n8n workflows (11A + 3A + 7A) all fire `0 3 * * *`.** All three invoke `https://tf-relay-production.up.railway.app/api/...` endpoints. The tower API has `MAX_CONCURRENT_BACKTESTS=3` (CLAUDE.md §14b) — if 11A-critic spawns a backtest while 7A-auto-evolution does too, the second hits 429.
- **Workflow duplicates (each name has 2 IDs).** Only one should be `active=true` per pair. Cannot verify without REST access. Carry-forward.

### Operator action — applies after JWT rotation OR after manual UI audit

Stagger the n8n workflows in n8n UI (cannot be patched via API without live REST):

| Workflow | Current | Recommended |
|---|---|---|
| `11A-critic-optimization` | `0 3 * * *` | `0 3 * * *` (keep) |
| `3A-workflow-backup` | `0 3 * * *` | `15 3 * * *` |
| `7A-auto-evolution` | `0 3 * * *` | `30 3 * * *` |

Backend (`harsh-regime-phase-activation-check` + `idempotency-cleanup`) can stay at `0 3` — they don't compete for the Python pool.

---

## SGL no-retry HTTP nodes (snapshot-stale finding)

> **Updated 2026-06-22 (Fix Wave B).** The on-disk SGL JSONs say:

| File | HTTP nodes | No-retry |
|---|---|---|
| `Strategy_Generation_Loop_1N8GcmcMKvQH4GRG.json` | 7 | **0** |
| `Strategy_Generation_Loop_eCr7cyb0aPArFCZc.json` | 0 | 0 (no HTTP nodes on disk; live version differs) |

**On disk, the SGL workflows have ZERO no-retry HTTP nodes** — every HTTP node has `retryOnFail: true`. The Wave A snapshot ("SGL has 5 no-retry HTTP nodes") referenced a 5-week-old export. Either:

1. The live workflow drifted from the on-disk JSON (operator added 5 new HTTP nodes without retry), OR
2. The snapshot was already wrong.

**Verdict:** cannot confirm without live REST access. **Re-audit after JWT rotation via `npm run audit:n8n`.**

If the audit confirms 5 no-retry HTTP nodes on the live SGL, the fix template is:

```jsonc
{
  "type": "n8n-nodes-base.httpRequest",
  "retryOnFail": true,
  "maxTries": 3,
  "waitBetweenTries": 1500,
  "onError": "continueRegularOutput"
}
```

Apply via `n8n_update_partial_workflow` MCP tool (see `feedback_updateNode_uses_updates_key.md`).

---

## IF v2 strict-typeValidation (true repo-wide)

> **Verified 2026-06-22 from on-disk JSONs.** Repo-wide tally:

```
Across 58 workflow JSONs:
  HTTP nodes: 297 (no-retry: 0)
  IF nodes:   56  (strict: 52)
```

**52 of 56 IF nodes use `typeValidation: "strict"`.** Wave A's "27" was an undercount — the real number is roughly double.

### Why this matters

n8n's IF v2 `strict` mode rejects type-coerced values. A JSON body field that comes back as a stringified number (`"42"` not `42`) routes to the FALSE branch even when the operator expects truthy logic. This silently drops downstream work without erroring.

### Fix template (per node)

```jsonc
{
  "parameters": {
    "conditions": {
      "options": {
        "typeValidation": "loose"
      }
    }
  }
}
```

Apply via `n8n_update_partial_workflow` `updateNode` op with `updates.parameters.conditions.options.typeValidation = "loose"` — but remember the **parameters-replaces-whole-object bug** (`feedback_updateNode_parameters_replaces_whole_object.md`): re-send the full `conditions` block, do NOT just send the nested `options`.

### Worth noting

- `Strategy_Generation_Loop_1N8GcmcMKvQH4GRG.json` has **4 strict IF nodes** on disk. Wave A said SGL had IF-strict issues — that's confirmed for the JSON variant `1N8G...`.
- `*Strategy_Generation_Loop_eCr7...json` has 0 strict IF (and 0 HTTP nodes — probably an older deactivated variant).

Operator action after JWT rotation: bulk-flip 52 strict→loose IF nodes. Script at `scripts/n8n-bulk-flip-if-loose.ts` (DOES NOT EXIST yet — write it in the follow-up session that has live REST access).

---

## Summary — operator action queue

1. **Verify JWT actually broken first** (Step 0 above). The 2026-06-22 decode shows NO `exp` claim — the carry-forward note "JWT expired again" was likely misdiagnosis.
2. If genuinely 401 after re-decode → run Steps 1-6.
3. Post-rotation: `npm run audit:n8n`, then bulk-fix the 52 IF strict nodes and verify SGL retry posture on the LIVE workflow (on-disk shows it's already healthy).
4. Stagger the 3 03:00 UTC n8n workflows to `0/15/30` past the hour.
5. Update AGENT-LOGS line 64 carry-forward: replace "JWT expired again" with "JWT decode shows no exp claim; 401 root cause was X" once X is known.
