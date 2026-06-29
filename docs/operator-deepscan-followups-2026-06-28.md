# Operator Follow-ups — Deep-Scan Fix Wave (2026-06-28)

These are the items from the `hardening/deepscan-wiring-2026-06-28` deep scan that **only the
operator can do** (live DB access, n8n UI, deployment decisions). Code fixes are already on the
branch. Work top-to-bottom; #1 and #2 are the highest value.

---

## 1. Verify the phantom-applied migration columns on the LIVE Railway DB  ⏱️ ~2 min, HIGH value

Your own pinned fact: migrations 0146/0148 were **journal-applied but the columns may be missing**
on the live DB (the boot-runner keys idempotency on the drizzle journal, not actual schema, so it
won't re-apply them). If they're missing:
- `backtests.firm_rules_version` missing → **MC firm-rule drift detection silently reads NULL** (MC
  could grade strategies against stale firm rules with no alert).
- `backtests.compliance_mode` missing → **compliance audit trail absent on every backtest row**.

**Check (read-only):**
```bash
psql "$DATABASE_URL" -c "
SELECT column_name FROM information_schema.columns
WHERE table_name='backtests'
  AND column_name IN ('firm_rules_version','compliance_mode','bif','k_eff')
ORDER BY column_name;"
# Also confirm the paper-side columns from this session's migrations:
psql "$DATABASE_URL" -c "
SELECT column_name FROM information_schema.columns
WHERE table_name='paper_positions'
  AND column_name IN ('initial_stop_price','high_since_entry_price','low_since_entry_price','correlation_id')
ORDER BY column_name;"
```

**Fix forward (idempotent — only if a column is missing).** Do NOT edit the already-applied
migration files (the runner won't re-run them). Apply directly:
```sql
ALTER TABLE backtests       ADD COLUMN IF NOT EXISTS firm_rules_version TEXT;
ALTER TABLE backtests       ADD COLUMN IF NOT EXISTS compliance_mode    TEXT DEFAULT 'enforce';
ALTER TABLE backtests       ADD COLUMN IF NOT EXISTS bif                NUMERIC;
ALTER TABLE backtests       ADD COLUMN IF NOT EXISTS k_eff              INTEGER;
-- paper_positions (migration 0179/0180) — only if the check above shows them missing:
ALTER TABLE paper_positions ADD COLUMN IF NOT EXISTS initial_stop_price      NUMERIC;
ALTER TABLE paper_positions ADD COLUMN IF NOT EXISTS high_since_entry_price  NUMERIC;
ALTER TABLE paper_positions ADD COLUMN IF NOT EXISTS low_since_entry_price   NUMERIC;
ALTER TABLE paper_positions ADD COLUMN IF NOT EXISTS correlation_id          TEXT;
```
Then restart the API (HMAC self-restart, **Unix SECONDS** not ms — see CLAUDE.md §15a) and confirm a
fresh backtest writes a non-null `firm_rules_version`.

**Audit trail check (diagnose WHY a migration didn't apply):** look for boot failures first —
```sql
SELECT action, status, error_message, created_at FROM audit_log
WHERE action LIKE 'migration.%' ORDER BY created_at DESC LIMIT 20;
```

---

## 2. Decide on `BACKTEST_STATIC_C_PARTIALS_ENABLED`  ⏱️ a deliberate session, NOT a quick toggle

The branch ships the **correct Style C 33/33/34 backtest path** (matching paper/live + spec) behind
this flag, **default OFF** (current single-TP behavior preserved, golden fixtures byte-identical).

**Do not just flip it.** Flipping ON shifts every backtest's Sharpe/PF/expectancy, and your gate
thresholds (WFE 0.70, B14 ci_high 0.20, PBO 0.15) were calibrated on the old shape. Adopt it like
this:
1. Set `BACKTEST_STATIC_C_PARTIALS_ENABLED=true` in a **research cohort only** (not prod default).
2. Re-run backtests across the real library; use the A/B harness
   (`src/engine/tests/test_static_c_partials_ab.py`) + compare to the OFF baseline.
3. Review whether the gate thresholds still make sense against the new economics.
4. Only then flip the default. This is a deployment decision; there's no rush pre-live.

---

## 3. n8n — deactivate retired `9A` + `11A` workflows  ⏱️ ~2 min, UI-only

Both are tagged `[RETIRED→14A]` but still firing on cron and duplicating the `14A` consolidation.
**Critically, `11A` (critic-optimization, 03:40) self-gates only on pipeline-pause (423), not on the
learning-loop mode — so at OBSERVE (mode=1) it still fires the critic mutation, bypassing your
two-tier kill switch.** REST `/activate` is 403 on your Railway instance, so this is editor-only:

1. Open `https://n8n-production-84ff.up.railway.app`.
2. Open **`9A-nightly-self-critique`** → toggle **Active → OFF**.
3. Open **`11A-critic-optimization`** → toggle **Active → OFF**.
4. Confirm `14A-master-nightly-intelligence` remains Active (it owns this work now).

---

## 4. n8n — fix `lifecycle_state` → `lifecycleState` query param  ⏱️ ~5 min, UI or code

`Monthly Robustness Check` and `Daily Portfolio Monitor` query
`/api/strategies?lifecycle_state=DEPLOYED`, but the route honors only `lifecycleState` (camelCase).
Express silently ignores the snake_case param and returns the **entire unfiltered library**, which
both workflows then loop over and `PATCH /lifecycle` against wrong-state strategies (spurious
DECLINING / drift demotions; illegal transitions bounce into the error sink).

**Fix:** in each workflow's `Fetch …Strategies` HTTP node, change the query param
`lifecycle_state` → `lifecycleState`. (`5A-weekly-tournament` already uses the correct form — copy
it.) While there, add `X-Idempotency-Key` headers to the `POST /api/journal` + `PATCH /lifecycle`
nodes so `retryOnFail` retries don't duplicate journal rows / re-apply transitions.

---

## 5. Power-resilience hardware (if running any PAPER+ / live strategy)  ⏱️ one-time purchase

Per CLAUDE.md §15a: any live/PAPER+ operation needs **UPS + Kasa** before the first live trade (the
entire institutional safety stack runs on the tower and can't fire when it's offline). KASA smart
plug (HS103/HS105 ~$15) + UPS (CyberPower CP1500AVRLCD ~$170), cabled **wall → Kasa → UPS → tower**,
then set `KASA_DEVICE_IP` / `KASA_USERNAME` / `KASA_PASSWORD` and BIOS "AC Power Recovery → On".

---

## Branch status
`hardening/deepscan-wiring-2026-06-28` — pushed, PR-ready, all CI/tests green. Merge it (after the
parallel carter session settles) so the CRITICAL fixes land on main. One pre-existing system-map
drift on the branch (`/api/carter/webhook`) belongs to the carter session, not this wave.
