# Railway Cloud Failover Runbook — B6

**Purpose:** When Skytech (primary compute) goes down, route backtest and paper
signal jobs to Railway compute as an emergency fallback. Trading Forge runs on
Railway's **paid $20/month plan** — plenty of usage-based compute headroom. No
artificial "$5 credit window" constraint applies; can run multi-hour backtests,
async paper signal generation, and emergency failover freely.

---

## Architecture Overview

```
Skytech (primary)
  Node API Server
  Python backtest engine    ← normal path
  PostgreSQL on Railway     ← always cloud-hosted (shared DB)

Railway (emergency failover)
  Python backtest worker    ← activated only on failover
  Reads/writes same PostgreSQL DB as Skytech
```

The failover state machine lives at `src/server/lib/compute-failover.ts`.
It pings local Python every 30 s. After 3 consecutive failures it transitions
to `CLOUD_FAILOVER` and routes new backtest/paper-signal jobs to Railway.
After 5 consecutive successful local pings it returns to `LOCAL_HEALTHY`.

---

## Free-Tier Limits

### Railway ($5/mo credit — PRIMARY)
- $5/mo credit = approximately 500 CPU-hours/month at Railway's $0.01/CPU-hour rate
- Sufficient for emergency-only use (< 50 backtests/month during hardware failure)
- No always-on cost: Railway bills only for active compute time
- Shared PostgreSQL DB: already Railway-hosted, no extra DB cost
- Credit resets monthly; unused credit does NOT roll over

### Fly.io (3 shared-cpu-1x VMs — ALTERNATIVE)
- 3 shared-cpu-1x VMs with 256 MB RAM each, always free
- 3 GB persistent storage (for Parquet cache)
- Sufficient for lightweight paper signal generation; not recommended for full
  backtests (RAM constraint with vectorbt on large datasets)
- Use Fly.io if Railway free credit is exhausted before hardware recovery

---

## One-Time Setup: Railway Compute Service

### Prerequisites
- Railway account: https://railway.app (free tier, no credit card for $5 credit)
- Railway CLI: `npm install -g @railway/cli`
- Trading Forge repo cloned on the Railway service (or Docker image)

### Step 1: Create a Railway project

```bash
# Log in
railway login

# Create project from the Trading Forge repo root
railway init
# Name it: trading-forge-failover
```

### Step 2: Add environment variables to Railway

In the Railway dashboard → your project → Variables, set:

```
DATABASE_URL=<same PostgreSQL URL as Skytech>
COMPUTE_WORKER_MODE=true
LOG_LEVEL=info
NODE_ENV=production
```

Do NOT set `RAILWAY_COMPUTE_URL` on Railway itself — that variable is only for
Skytech to know where Railway is.

### Step 3: Deploy a minimal compute worker

Railway runs the same Node + Python codebase. For failover, only the Python
backtest engine needs to be reachable via HTTP. Create a minimal Express
endpoint at `src/server/compute-worker.ts` (future work — see "Upgrade Path"
below).

For now, the runbook documents **manual failover** (copy config to Railway,
run backtest manually) since the automated HTTP route is not yet built.

### Step 4: Note your Railway service URL

After deployment:
```bash
railway domain
# → something like: trading-forge-failover.up.railway.app
```

Set this on Skytech:
```bash
export RAILWAY_COMPUTE_URL=https://trading-forge-failover.up.railway.app
```

Or in `.env`:
```
RAILWAY_COMPUTE_URL=https://trading-forge-failover.up.railway.app
```

---

## Manual Failover Procedure (Hardware Failure)

When Skytech is unreachable and `compute-failover.ts` has auto-transitioned to
`CLOUD_FAILOVER`, any callers that check `getComputeTarget()` will route to cloud.
If automated routing is not yet wired in your backtest service, follow these steps:

### Step 1: Verify failover state

Check the health endpoint on any reachable Trading Forge instance (e.g., a
secondary dev machine or Railway's own API if deployed):

```bash
curl https://trading-forge-failover.up.railway.app/api/health | jq .computeMode
```

Or via `getPipelineStatus()` response which includes `computeMode.state`.

### Step 2: Force cloud mode (if auto-detection hasn't triggered yet)

```bash
export FORCE_CLOUD_COMPUTE=true
# Restart the Node server on any available machine
```

### Step 3: Submit backtests to Railway

Until the automated `submitToCloud()` route is wired, submit manually via
Railway's run command:

```bash
railway run python -m engine.backtester --config /path/to/config.json
```

Or copy the strategy config and run the backtest script directly on Railway:

```bash
railway shell
python -m engine.backtester --config config.json
```

Results write to the shared PostgreSQL DB, visible in the Trading Forge dashboard
once Skytech recovers.

### Step 4: Recover to Skytech

Once Skytech hardware is restored:

1. Restart the Python engine on Skytech
2. The compute-failover monitor will run probes every 30 s
3. After 5 consecutive successful probes, state returns to `LOCAL_HEALTHY`
4. If `FORCE_CLOUD_COMPUTE=true` was set, unset it and restart:
   ```bash
   unset FORCE_CLOUD_COMPUTE
   systemctl restart trading-forge
   ```

---

## Automated Failover (Current State)

The `compute-failover.ts` state machine and `getComputeTarget()` API are live.
The health-check loop broadcasts SSE events on every state transition.

What IS wired:
- Health probe every 30 s
- State machine: LOCAL_HEALTHY → DEGRADED → CLOUD_FAILOVER → LOCAL_HEALTHY
- `getComputeTarget()` returns `"cloud"` when in CLOUD_FAILOVER
- `submitToCloud()` function ready to accept job payloads
- Dashboard SSE event: `compute:failover-state-change`
- `getPipelineStatus()` exposes `computeMode` alongside pipeline mode
- Manual override: `FORCE_CLOUD_COMPUTE=true`

What is NOT yet wired (upgrade path):
- Backtest service does not yet call `getComputeTarget()` before spawning Python
- `submitToCloud()` HTTP route on Railway is not yet deployed
- Paper signal service does not yet check compute target

---

## Fly.io Alternative Setup

If Railway credit is exhausted:

### Prerequisites
- Fly.io account: https://fly.io (free, no card for free tier)
- flyctl: `curl -L https://fly.io/install.sh | sh`

### Deploy

```bash
cd trading-forge
fly launch
# App name: trading-forge-failover
# Region: ord (Chicago — closest to CME)
# No PostgreSQL (use same Railway DB)
# No Redis
fly deploy
```

### Set DATABASE_URL

```bash
fly secrets set DATABASE_URL="<same Railway PostgreSQL URL>"
```

### Update Skytech env

```bash
export RAILWAY_COMPUTE_URL=https://trading-forge-failover.fly.dev
```

Note: Fly.io shared-cpu-1x has 256 MB RAM. Large vectorbt backtests (>500K bars)
may OOM. Use Fly.io for paper signal generation only; upgrade to a paid Fly VM
($2.24/month for 1 shared CPU + 512 MB RAM) for full backtest support.

---

## Monitoring

### SSE event: `compute:failover-state-change`
Dashboard receives this whenever state changes. Fields:
- `prev`: previous state
- `next`: new state
- `consecutiveFailures`: how many probes have failed
- `consecutiveSuccesses`: how many recovery probes have succeeded
- `reason`: human-readable failure reason
- `timestamp`: ISO 8601

### Health endpoint
`GET /api/health` → `body.computeMode` (via `getPipelineStatus()`):
```json
{
  "state": "LOCAL_HEALTHY",
  "target": "local",
  "consecutiveFailures": 0,
  "consecutiveSuccesses": 12,
  "lastCheckedAt": "2026-04-30T14:00:00.000Z",
  "lastFailureReason": null,
  "failoverTriggeredAt": null,
  "forceCloud": false,
  "cloudConfigured": true,
  "cloudBaseUrl": "https://trading-forge-failover.up.railway.app"
}
```

### Alerts
The compute failover SSE is the primary alert mechanism. Wire a dashboard
notification or Discord webhook to `compute:failover-state-change` where
`next === "CLOUD_FAILOVER"` for immediate operator awareness.

---

## Cost Controls

- Railway: $5/mo credit. Monitor usage at https://railway.app/account/billing
  If you expect extended Skytech downtime (days not hours), upgrade the Railway
  service to avoid unexpected bills after credit exhaustion.
- Fly.io: Free tier has 3 VMs and 3 GB storage. No overage billing — service
  is paused, not charged, when quota is hit.
- In both cases: stop the cloud worker as soon as Skytech recovers.

---

## Upgrade Path (Future)

To make the automated failover fully functional:

1. Add `getComputeTarget()` check in `backtest-service.ts` before spawning Python
2. Implement `POST /api/compute/backtest` endpoint on the Railway worker
3. Implement `POST /api/compute/paper_signal` endpoint on the Railway worker
4. Set `RAILWAY_COMPUTE_URL` in Skytech production environment
5. Wire dashboard alert on `compute:failover-state-change` → `CLOUD_FAILOVER`
