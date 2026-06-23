# First-Strategy Launch Runbook

**Audience:** Operator (swayz032)
**Purpose:** Wave 5 Phase B — calendar-time-based portion of the Production Hardening Wave 5 plan. Cannot be completed in a single agent session; this is your day-by-day operator runbook for the next ~7-10 trading days.
**Strategy under test:** `trend_mes_ema921_pullback` (`3e6e94d6-4486-4a69-a0c2-b7f8eb8b5431`) — MES 5m, EMA 9/21 pullback, Style D framework overlay.

---

## B.1 Pre-flight (one time — do BEFORE B.2)

Run this checklist once. Each item ends with the command to verify.

- [ ] **TradersPost paper account credentials** present in Bitwarden vault. Verify:
      `bw get item "TradersPost - Paper - MFFU"` returns a record with username + password fields.
- [ ] **TradingView Premium subscription active.** Sign in to tradingview.com; check subscription page shows Premium tier (alert webhook + Strategy() panel require it).
- [ ] **MFFU paper account funded ≥ minimum margin.** MES base size = 4 contracts. Confirm available balance in MFFU dashboard ≥ $5K margin headroom.
- [ ] **`account_strategy_assignments` row exists** for operator + this strategy + MFFU firm. Verify:
      ```sql
      SELECT account_id, strategy_id, firm_id, created_at
      FROM account_strategy_assignments
      WHERE strategy_id='3e6e94d6-4486-4a69-a0c2-b7f8eb8b5431';
      ```
      If empty → create via `POST /api/admin/account-strategy-assignments` with the operator account_id.
- [ ] **Discord critical-alerts webhook live.** Verify:
      `echo $DISCORD_WEBHOOK_URL` (PowerShell: `$env:DISCORD_WEBHOOK_URL`) is set, then `curl -X POST $DISCORD_WEBHOOK_URL -H "Content-Type: application/json" -d '{"content":"Wave 5 preflight"}'` lands a message in #critical-alerts.
- [ ] **pm2 backend + relay client + Discord bot online.** Verify:
      `pm2 list` shows `trading-forge-api`, `tower-relay-client`, and `tf-discord-bot` all status `online`.
- [ ] **Pipeline ACTIVE.** Verify: `curl http://localhost:4000/api/admin/pipeline/status` returns `"mode":"ACTIVE"`. Wave 5 unpaused this on 2026-05-16; re-pause is operator-only.
- [ ] **Validation Cadence panel state captured.** Take a screenshot of the panel today (Wave 0 found it RED). Wave 5 completion is the remediation; you'll re-screenshot at end of B.6.

## B.1a Set LIVE_ORDER_GATEWAY_URL (one-time, before first deploy)

This must be done BEFORE step B.2. Path B (the canonical webhook path) requires the TF gateway URL to be wired in production `.env`.

1. **Set the env var in production `.env`:**
   ```env
   LIVE_ORDER_GATEWAY_URL=https://tf-relay.up.railway.app/api/live-order
   ```
   Adjust the hostname to match your actual `tf-relay` Railway service URL.

2. **Restart the API** after setting (use the HMAC self-restart per Pass 1 docs):
   ```bash
   TIMESTAMP=$(date +%s)
   REASON="set-live-order-gateway-url"
   SIG=$(echo -n "${TIMESTAMP}:${REASON}" | openssl dgst -sha256 -hmac "$ADMIN_RESTART_HMAC_SECRET" | awk '{print $2}')
   curl -X POST https://<relay>/api/admin/self-restart \
     -H "Content-Type: application/json" \
     -H "X-Restart-Signature: $SIG" \
     -d "{\"timestamp\": $TIMESTAMP, \"reason\": \"$REASON\"}"
   ```
   Note: `date +%s` produces Unix seconds (not milliseconds). The endpoint multiplies internally.

3. **Also set `LIVE_ORDER_HMAC_SECRET`** to a ≥32-character random value (Pass 1 already documented this; see `.env.example` Admin/HMAC section). This is the shared secret used to validate inbound Pine alerts at the TF gateway.

4. **Verify at startup:** `npm run dev` will emit a startup warning `LIVE_ORDER_GATEWAY_URL_NOT_SET` if the var is missing. A clean boot with no such warning confirms the var is present.

---

## B.2 Pine compile + deploy to TradingView (one time)

Strategy is in CANDIDATE state today. Once it completes its first successful backtest (in progress at end of Wave 5 session — verify by `SELECT id, status FROM backtests WHERE strategy_id='3e6e94d6-…' ORDER BY created_at DESC LIMIT 1` returning `status='completed'`), the auto-promotion cron will move it to TESTING within 1 hour.

Once it reaches PAPER:

1. **Generate per-recipient Pine:**
   ```js
   // From tmp script or via /api/pine-export-recipient/release endpoint:
   await releaseStrategyToFamily(
     '3e6e94d6-4486-4a69-a0c2-b7f8eb8b5431',
     'swayz032-mffu-paper',
     { correlationId: crypto.randomUUID() }
   );
   ```
   This writes the HMAC secret to `account_strategy_assignments.hmac_secret` (idempotent), and emits the `.pine` file artifact to `data/exports/pine/<strategy>/<account_label>.pine`.

2. **Copy generated `.pine` into TradingView:**
   - Open MES 5m chart on TradingView.
   - Pine Editor → Open → New Strategy → paste the `.pine` contents.
   - Add to chart → Strategy() panel appears with entry triangles + exit X marks once enough bars elapse.

3. **Configure alert webhook — Path B (canonical, recommended):**
   - Alert dropdown → New Alert.
   - Condition: `trend_mes_ema921_pullback` strategy → Order fills only.
   - Frequency: **Once Per Bar Close** (critical — not "Every bar" or "Only Once").
   - Webhook URL: paste the value of `LIVE_ORDER_GATEWAY_URL` from production `.env`
     (e.g., `https://tf-relay.up.railway.app/api/live-order`).
     This is ONE URL for all strategies — you never need to look up a per-strategy TradersPost URL.
   - Message: leave default Pine-generated payload (HMAC signature is embedded; the TF gateway
     validates it before forwarding to TradersPost via `routeOrder()`).
   - Save.

   Path B routes every alert through the full safety stack in this order:
   kill-switch → compliance gate → firm-cap clamp → TradersPost circuit breaker → TradersPost.
   All safety gates share one `correlation_id` traceable end-to-end in `audit_log`.

   ### Path A (legacy — bypasses safety stack)

   DO NOT use Path A for new strategies. Path A exists only to support legacy strategies
   that were exported before `gateway_mode='tf_gateway'` was the default.

   In Path A the operator pastes the per-strategy TradersPost webhook URL directly into the
   TradingView alert webhook field (retrieved from `bw get item "TradersPost - Paper - MFFU"`).
   Every alert goes straight to TradersPost with no kill-switch, no compliance gate, no
   firm-cap clamp, and no TradersPost circuit breaker applied.

   **DO NOT use Path A for new strategies. Path A bypasses kill-switch, compliance gate,
   firm-cap clamp, and TradersPost circuit breaker.**

   ### Path A vs Path B comparison

   | Aspect | Path A (legacy) | Path B (canonical) |
   |---|---|---|
   | Webhook URL | per-strategy traderspost.io URL | `LIVE_ORDER_GATEWAY_URL` (one URL for all) |
   | Kill-switch | bypassed | enforced |
   | Compliance gate | bypassed | enforced |
   | Firm-cap clamp | bypassed | enforced |
   | TradersPost circuit breaker | bypassed | enforced |
   | HMAC validation | not enforced | enforced via `LIVE_ORDER_HMAC_SECRET` |
   | Per-account routing | manual | via `account_strategy_assignments` |

4. **Verify TradersPost wired to PAPER account, NOT funded.** In TradersPost dashboard, the strategy mapping should point to `MFFU Paper 50k` not `MFFU Funded 50k`. Funded routing in B.5 only.

## B.3 Paper trading (3-5 trading days)

Daily routine (≤ 5 minutes/day):

1. **Morning (before market open):**
   - Glance at TradingView chart — strategy panel loaded, indicators showing.
   - Glance at ProductionStatusPanel (`/system-status` route) — 6 questions GREEN.
2. **During RTH:** Strategy() panel will paint entry triangles on signals. Don't manage; observe.
3. **End of day:** Compare two numbers:
   - TradingView Strategy Tester P&L for the day.
   - TradersPost paper account daily P&L.
   - They should match within 1-2 ticks per fill. If divergence >1 full point → flag for diagnostics (paper-parity subagent territory).
4. **Append observations** to `docs/first-strategy-trace-2026-05-16.md` §10 daily.

### Acceptance to advance past B.3 (need 3-5 clean trading days):
- ≥ 3 RTH sessions where Strategy Tester P&L vs TradersPost paper P&L match within 1-2 ticks.
- No SSE `system:critical` events from this strategy.
- No `kill_switch:triggered` events.
- `lifecycle_transitions` shows the strategy transitioned TESTING → PAPER with a `gate.frankenstein.evaluated` audit row.

### Operator approves PAPER → DEPLOY_READY:
Via the Strategy Detail dashboard or:
```bash
curl -X PATCH http://localhost:4000/api/strategies/3e6e94d6-4486-4a69-a0c2-b7f8eb8b5431/lifecycle \
  -H "Content-Type: application/json" \
  -d '{"fromState":"PAPER","toState":"DEPLOY_READY"}'
```
**Expected per Wave 2 fix:** an audit row lands with `action='lifecycle.promotion_allowed_signal_correlation'` and `result.ramp_up_mode: true` (because this is the FIRST strategy ever to reach DEPLOY_READY; no other DEPLOYED strategy exists for A7 to cross-correlate against).
**Expected per Wave 4 wiring:** the dashboard toast renders `"First strategy ramp-up — promoted via A7 ramp-up mode"`. If you see the generic "PASS" toast instead, file a Wave 4 regression issue against `useSSE.ts:555-588`.

## B.4 PILOT canary (5 trading sessions, 1-contract clamp)

Operator approval of DEPLOY_READY → PILOT is the human step:
```bash
curl -X POST http://localhost:4000/api/strategies/3e6e94d6-4486-4a69-a0c2-b7f8eb8b5431/deploy \
  -H "Content-Type: application/json" \
  -d '{}'
```
The deploy endpoint enters PILOT with the lifecycle-service 1-contract clamp active.

For the next 5 trading sessions:
- Bot trades at 1 MES contract (not the configured 4 base).
- **6-hourly cron evaluates every PILOT strategy** — produces a `pilot.auto_promotion.evaluated` audit row per sweep with a shared `sweepCorrelationId` (Wave 2 fix). You can confirm:
  ```sql
  SELECT correlation_id, COUNT(*) FROM audit_log
  WHERE action='pilot.auto_promotion.evaluated'
    AND created_at > NOW() - INTERVAL '6 hours'
  GROUP BY correlation_id;
  ```
  Should return rows where the same `correlation_id` appears N times (one per strategy in the sweep).

### Acceptance to advance past B.4:
- 5 consecutive PILOT sessions with **all** `compliancePassed=true` and `rollingSharpeFinal ≥ 1.0` → AUTOMATIC promotion PILOT → DEPLOYED.
- If **any** session has `outcome='killed'` → AUTOMATIC graveyard (no manual override; this is fail-CLOSED).

## B.5 DEPLOYED — first revenue

Once auto-promotion PILOT → DEPLOYED lands:

1. **TradersPost routing flip:** in TradersPost dashboard, retarget the alert from PAPER → FUNDED account. **Do this only after auto-promotion fires** — flipping pre-promotion bypasses the gate.
2. Bot now trades on funded MFFU 50k.
3. Profit-tier pyramid activates: base 4 MES, +2 contracts per +$3K cumulative P&L, cap at 6 (this strategy's configured `max_contracts`).
4. Personal DLL = 67% of MFFU's $2K firm DLL = $1,340/day stop.

### Daily operator routine (≤ 5 minutes/day):
- ProductionStatusPanel 6 questions GREEN.
- Discord ping → handle on phone.
- Bot trades; you observe.

## B.6 Validation Cadence panel turns GREEN

Confirm:
```sql
-- At least one transition to PAPER, DEPLOY_READY, PILOT, DEPLOYED in current calendar month
SELECT to_state, COUNT(*)
FROM lifecycle_transitions
WHERE created_at > date_trunc('month', NOW())
  AND to_state IN ('PAPER','DEPLOY_READY','PILOT','DEPLOYED')
GROUP BY to_state;

-- Days since last live backtest
SELECT EXTRACT(DAY FROM (NOW() - MAX(created_at))) AS days_since
FROM backtests WHERE status='completed';
```
Expected: at least one row per `to_state` in the month; `days_since < 7`.

Reality Check Score ≥ 50 — visible on ProductionStatusPanel. Per AGENTS.md "Validation Cadence" forcing function, once these all pass the panel flips GREEN and new-infra work is unblocked.

---

## Carry-forward to next agent session

When the strategy reaches PAPER (day 1-3 of B.3), open a Wave 6 session and ask the agent to:

1. Re-run the Wave 5 Phase A trace using the new correlation_id from the PAPER promotion request.
2. Verify the `gate.frankenstein.evaluated` audit row landed with non-null correlation_id.
3. Verify the `lifecycle_transitions` row landed (and flag if `correlation_id` column is still missing on that table — see trace doc §9).
4. Verify the frontend toast rendered correctly via screenshot.

When the strategy reaches DEPLOY_READY (day 3-5 of B.3 → B.4):
1. Verify `lifecycle.promotion_allowed_signal_correlation` row with `result.ramp_up_mode: true` lands.
2. Snapshot the Discord notification and the dashboard toast.

When the strategy reaches DEPLOYED (after B.4):
1. Re-run `SELECT * FROM lifecycle_transitions WHERE strategy_id=...` and attach full chain to a Wave 5 closeout report.
2. Re-screenshot Validation Cadence panel (should be GREEN).
3. Update AGENT-LOGS.md with the Wave 5 closeout entry.

---

## Quick-reference IDs

| Item | Value |
|---|---|
| strategy_id | `3e6e94d6-4486-4a69-a0c2-b7f8eb8b5431` |
| name | `trend_mes_ema921_pullback` |
| firm | MFFU 50k paper → MFFU 50k funded after B.4 promotion |
| Wave 5 trace correlation_id | `447a8d23-dbf3-4b9b-93cb-bd5ac888c394` (Phase A) |
| Wave 5 backtest_id | `1160688d-5242-4a7d-beca-f16d621b3bee` |
