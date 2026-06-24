# Trading Forge Admin Runbook

Operational procedures for the Trading Forge production system.
Created: 2026-06-24 (L3 cosmetic hardening batch).

---

## Scheduler re-enable {#scheduler-re-enable}

When a scheduler job auto-disables after 5 consecutive failures, the Discord CRITICAL
alert references this section. The enable endpoint itself does not require HMAC
signing — it is protected by the tf-relay auth layer (the relay only forwards
authenticated requests from the operator's Discord/phone workflow).

### Via tf-relay (standard path)

```bash
# Replace {name} with the job name from the Discord alert (e.g. "pattern-aggregator")
curl -X POST https://tf-relay-production.up.railway.app/api/admin/scheduler/jobs/{name}/enable \
  -H "Content-Type: application/json"
```

The relay forwards the request to the tower's TradingForgeAPI. The response is:

```json
{ "enabled": true, "job": "{name}" }
```

### Via direct tower access (if relay is down)

If the relay itself is unavailable, call the tower API directly while on the same LAN:

```bash
curl -X POST http://localhost:4000/api/admin/scheduler/jobs/{name}/enable \
  -H "Content-Type: application/json"
```

### Diagnosing before re-enabling

Before re-enabling, check why the job failed:

```sql
-- Last 10 audit rows for the job (replace pattern_aggregator with job's audit namespace)
SELECT action, status, result, created_at
FROM audit_log
WHERE action LIKE 'pattern_aggregator.%'
ORDER BY created_at DESC
LIMIT 10;
```

Common failure causes by job:

| Job | Common causes |
|-----|---------------|
| `pattern-aggregator` | DB read timeout; OpenAI quota; insufficient trade critiques |
| `quantum-replay-weekly-analysis` | Script timeout (>10 min); zero replay rows yet |
| `composite-health-daily-digest` | Discord webhook unreachable; strategy_health_scores empty |
| `regime-drift-detector` | DB connection issue; lifecycle-service timeout |
| `ab-comparison-weekly-digest` | broker_accounts A/B rows not seeded (migration 0159) |

### Kill switch (halts autonomous loops without disabling jobs)

To pause the `pattern-aggregator` and `quantum-replay-weekly-analysis` loops without
disabling the jobs themselves, flip the shared kill switch:

```sql
UPDATE system_parameters SET value = 'false' WHERE key = 'auto_patch_loop_enabled';
```

To re-engage:

```sql
UPDATE system_parameters SET value = 'true' WHERE key = 'auto_patch_loop_enabled';
```

This is the operator's phone-tappable halt for all autonomous mutation loops.

---

## Self-restart (HMAC-signed) {#self-restart}

For a full graceful restart of TradingForgeAPI on the tower, use the HMAC-signed
self-restart endpoint. The scheduler enable endpoint above does NOT use HMAC —
this section is for the API process restart only.

```bash
TIMESTAMP=$(date +%s)
REASON="deploy_$(date +%Y-%m-%d)"
SIG=$(echo -n "${TIMESTAMP}:${REASON}" | openssl dgst -sha256 -hmac "$ADMIN_RESTART_HMAC_SECRET" | awk '{print $2}')
curl -X POST https://tf-relay-production.up.railway.app/api/admin/self-restart \
  -H "Content-Type: application/json" \
  -H "X-Restart-Signature: $SIG" \
  -d "{\"timestamp\": $TIMESTAMP, \"reason\": \"$REASON\"}"
```

Note: `date +%s` produces Unix SECONDS (not milliseconds). The endpoint internally
multiplies by 1000. Do not use `date +%s%3N`.

NSSM auto-respawns TradingForgeAPI within ~2 seconds.

---

## Ollama health recheck (HMAC-signed) {#ollama-health-recheck}

If the Ollama circuit breaker is open and gemma cold-load has stabilised, force a
health recheck without restarting the process:

```bash
TIMESTAMP=$(date +%s)
REASON="manual_health_recheck"
SIG=$(echo -n "${TIMESTAMP}:${REASON}" | openssl dgst -sha256 -hmac "$ADMIN_RESTART_HMAC_SECRET" | awk '{print $2}')
curl -X POST https://tf-relay-production.up.railway.app/api/admin/ollama-health-recheck \
  -H "Content-Type: application/json" \
  -H "X-Restart-Signature: $SIG" \
  -d "{\"timestamp\": $TIMESTAMP, \"reason\": \"$REASON\"}"
```

Uses the same `ADMIN_RESTART_HMAC_SECRET` as the self-restart endpoint.
