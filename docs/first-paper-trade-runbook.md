# First Paper Trade Runbook

**Pass 8 Track D — First Paper Trade Smoke Test & Operator Guide**

> Use this runbook the first time you wire the 7-step critical loop end-to-end.
> Run after Pass 7 closure; keep it open alongside your TradingView window.

---

## When to Use This Runbook

- After all 8 hardening passes are closed and CI gates are GREEN
- First time you are wiring a strategy from PAPER state through TradingView → TradersPost → broker paper → Discord
- Any time you suspect the alert webhook or TradersPost routing is broken and want a repeatable pre-flight check

---

## Prerequisites

Before running the smoke test, confirm:

| Requirement | Where to Set |
|---|---|
| `DATABASE_URL` | `.env` — Postgres connection string |
| `LIVE_ORDER_GATEWAY_URL` | `.env` — full URL to your TF backend `/api/live-order` |
| `LIVE_ORDER_HMAC_SECRET` | `.env` — 32+ char random secret for Pine alert auth |
| `ADMIN_OVERRIDE_HMAC_SECRET` | `.env` — 32+ char secret for frozen-policy HMAC override (Wave 29 Pass B) |
| `DISCORD_WEBHOOK_URL` | `.env` — Discord webhook URL for fill/error notifications |
| TradersPost paper account | TradersPost dashboard — paper account configured for Topstep or MFFU |
| TradingView paid plan | Required for webhook alerts (Basic plan cannot fire webhooks) |
| At least one strategy in CANDIDATE or higher lifecycle state | DB |

---

## Step-by-Step: Running the Smoke Test

### 1. Run the pre-flight (READ-ONLY)

```bash
cd /c/Users/tonio/Projects/trading-forge/trading-forge
npx tsx scripts/first-paper-trade-smoke.ts
```

Expected output: each check prints `PASS`, `WARN`, or `FAIL`.

- `PASS` = fully ready
- `WARN` = advisory — loop will work but something is not configured optimally
- `FAIL` = loop will not work — action required before firing

The script writes structured results to `docs/first-paper-trade-smoke-preflight.json`.

### 2. Interpret the pre-flight output

Key sections to watch:

| Section | What it checks | Action on failure |
|---|---|---|
| 1. Parametric CANDIDATE strategy | Strategy exists in CANDIDATE pool | Run scout pipeline or promote a test strategy manually |
| 2. Paper-to-DeployReady gates | Gate evaluator runs without throwing | Advisory — requires full server context at promotion time |
| 3. Pine export compilation | `compileDualPineExport` returns success with gateway markers | Check Python path; verify `entry_indicator` in strategy config |
| 4. Environment variables | `LIVE_ORDER_GATEWAY_URL`, `LIVE_ORDER_HMAC_SECRET`, etc. | Set missing vars in `.env` before proceeding |
| 5. Broker accounts | At least one enabled `broker_accounts` row | Insert a broker_account row via migration or seed |
| 6. Discord webhook | Webhook ping returns 200/204 | Check `DISCORD_WEBHOOK_URL` is valid |
| 7. Paper sessions | Active paper sessions in DB | Promote a strategy to PAPER state first |

### 3. Promote a strategy to PAPER (if needed)

The lifecycle ladder for a new strategy is:
```
CANDIDATE → TESTING → SHADOW → PAPER → DEPLOY_READY → PILOT → DEPLOYED
```

To get the promotion commands, run with `--operator-fire`:

```bash
npx tsx scripts/first-paper-trade-smoke.ts --operator-fire
```

This will prompt for confirmation and then print the curl commands.
You run the curl commands yourself — the smoke test never auto-promotes.

### 4. Generate the Pine artifact

After strategy reaches PAPER state:

```bash
# Generate and persist Pine artifact
curl -X POST http://localhost:4000/api/pine-export/compile \
  -H "Content-Type: application/json" \
  -d '{"strategyId":"<your-strategy-id>","persist":true}'
```

The response contains `exportId` and a list of artifact IDs.

Download the STRATEGY.pine (TradersPost / TF-gateway path):
```bash
curl http://localhost:4000/api/pine-export/<exportId>/artifacts/<strategyArtifactId>/download \
  -o STRATEGY.pine
```

### 5. Load Pine into TradingView

1. Open TradingView → set chart to the strategy's symbol and timeframe
2. Click **Pine Script Editor** (bottom panel) → **Open** → paste the STRATEGY.pine contents
3. Click **Add to chart** (not "Publish to Pine Script Library")
4. The Strategy Tester panel should appear with historical backtest results

### 6. Configure the TradingView alert

1. Right-click on chart → **Add Alert**
2. **Condition:** select your strategy name from the dropdown
3. **Alert Actions:** check "Webhook URL"
4. **Webhook URL:** paste your `LIVE_ORDER_GATEWAY_URL` value (e.g., `https://your-backend/api/live-order`)
5. **Message:** LEAVE EMPTY — Pine populates this at alert-fire time with the full gateway payload
6. **Frequency:** **"Once Per Bar Close"** — this is mandatory; "Every Bar" would fire intra-bar and create duplicate orders
7. **Expiration:** "Open-ended alert"
8. Click **Create**

### 7. Watch Discord and the audit log

When the strategy fires its first signal at bar close:

- TradingView fires the webhook → `POST /api/live-order`
- TF gateway validates the `live_order_token` in the payload
- `broker-router.ts` routes the order to TradersPost
- TradersPost routes to your paper broker account
- Fill or rejection comes back
- Discord channel receives a notification

**Expected correlation_id audit trace:**

```sql
SELECT action, entity_id, status, created_at, correlation_id
FROM audit_log
WHERE action LIKE 'broker_router%' OR action LIKE 'webhook%'
  OR action LIKE 'live_order%'
ORDER BY created_at DESC
LIMIT 20;
```

Expected sequence:
1. `live_order.received` — gateway ingested the webhook payload
2. `broker_router.route_order` — routing decision made (TradersPost selected)
3. `broker_router.traderspost_submitted` — order sent to TradersPost
4. `webhook.broker_ack` — TradersPost acknowledged the order
5. `broker_router.fill_received` — fill or rejection arrived

All five rows should share the same `correlation_id`.

### 8. Verify paper account fill in TradersPost

1. Log into TradersPost → **Paper Trading** → check the fill appeared
2. Compare fill price vs TradingView Strategy() fill price — should be ≤1-2 ticks

If there is a large fill discrepancy, check:
- Are you using "Once Per Bar Close" (not bar open) for the alert?
- Is the Pine alert body correct (account_id, strategy_id, quantity)?

---

## Troubleshooting

### Alert fires but TF gateway returns 401

Cause: `live_order_token` in the Pine payload does not match `LIVE_ORDER_HMAC_SECRET` in `.env`.

Fix:
1. Verify `LIVE_ORDER_HMAC_SECRET` is the same value in `.env` and the compiled Pine artifact
2. Regenerate the Pine artifact after setting the correct secret: `POST /api/pine-export/compile`
3. Re-load the new STRATEGY.pine in TradingView

### Alert fires but TradersPost shows no order

Cause: TradersPost is not configured for the account, or the webhook destination is wrong.

Fix:
1. In TradersPost: go to Settings → Webhooks → verify the paper account destination
2. Check `broker_accounts` table: `SELECT * FROM broker_accounts WHERE enabled=true;`
3. Verify the `account_id_external` matches your TradersPost paper account ID
4. Review audit_log: `SELECT * FROM audit_log WHERE action LIKE 'broker_router%' ORDER BY created_at DESC LIMIT 5;`

### Discord notification not appearing

Cause: `DISCORD_WEBHOOK_URL` is missing or the webhook URL was deleted/rotated.

Fix:
1. Run `npx tsx scripts/first-paper-trade-smoke.ts` — Section 6 will show the health status
2. Check the server logs for `discord-fanout-audit:` lines
3. Regenerate the Discord webhook URL in your server settings and update `.env`
4. Restart the TF backend: `POST /api/admin/self-restart` (with HMAC signature)

### No CANDIDATE strategies in DB

Cause: Scout pipeline has not graduated any strategies yet.

Fix:
1. Run the n8n strategy discovery workflow manually
2. OR create a test CANDIDATE manually:
   ```sql
   INSERT INTO strategies (name, symbol, timeframe, config, lifecycle_state)
   VALUES (
     'test-sma-crossover',
     'MES',
     '5m',
     '{"entry_quality": {"entry_indicator": "sma_crossover", "fast_period": 9, "slow_period": 21}}',
     'CANDIDATE'
   );
   ```

### Strategy stuck in CANDIDATE (cannot promote to TESTING)

Cause: Strategy needs a backtest run first.

Fix:
1. POST `/api/backtests` with `{"strategyId": "<id>", "mode": "standard"}`
2. Wait for backtest to complete (status = `completed`)
3. Then promote: POST `/api/strategies/<id>/promote` with `{"targetState":"TESTING"}`

### WFE gate blocks TESTING → PAPER

Cause: Walk-forward efficiency < 0.70 (institutional 2026 floor per Wave 27.5 Pass B).

Fix:
1. Review walk-forward results: `SELECT * FROM backtests WHERE strategy_id = '<id>' ORDER BY created_at DESC LIMIT 3;`
2. Check `walk_forward_results.wfe_overall` value
3. A genuine WFE < 0.70 means the strategy is not institutional-grade — do not bypass
4. If you need to test the loop with a placeholder strategy, set WFE_HARD_FLOOR=0 in .env temporarily (test environment only)

---

## Smoke Test Results Template

After running the first real paper trade, fill in this template and save as:
`docs/first-paper-trade-2026-MM-DD-trace.md`

---

# First Paper Trade Trace — YYYY-MM-DD

**Strategy:** `<strategy_name>` (ID: `<strategy_id>`)
**Symbol/TF:** `<symbol>` / `<timeframe>`
**Trade direction:** `long` / `short`
**Entry price:** `<price>`
**Bar timestamp:** `<bar close timestamp in ISO 8601>`
**Correlation ID:** `<correlation_id from audit_log>`

## Audit Trace

| Step | action | status | entity_id | correlation_id | created_at |
|---|---|---|---|---|---|
| 1 | `live_order.received` | | | | |
| 2 | `broker_router.route_order` | | | | |
| 3 | `broker_router.traderspost_submitted` | | | | |
| 4 | `webhook.broker_ack` | | | | |
| 5 | `broker_router.fill_received` | | | | |

## Fill Comparison

| Source | Price | Qty | Side |
|---|---|---|---|
| TradingView Strategy() | | | |
| TradersPost paper account | | | |
| Drift (ticks) | | | |

## Discord Notification Received

- [ ] Fill notification appeared in Discord channel
- Timestamp: `<Discord message timestamp>`
- Message: `<copy the Discord message here>`

## Pre-flight JSON Reference

Saved at: `docs/first-paper-trade-smoke-preflight.json`

## Notes

`<any observations, surprises, timing issues>`

---

*Template — replace all `<placeholder>` values after the actual first trade fires.*
