-- 0117_recover_missing_tables.sql
--
-- Phase 10 Recovery — schema-side reconstruction for tables that consumer
-- services reference but that vanished from schema.ts in the 2026-05-19 86-file
-- null-byte corruption rollback.
--
-- DISCOVERY (2026-05-19 live-DB introspection): all 12 tables originally
-- believed missing from BOTH schema.ts AND Postgres actually EXIST in
-- Postgres. The corruption only wiped the Drizzle TypeScript declarations,
-- not the live tables. Therefore this migration is intentionally LIGHTWEIGHT:
--   - Adds `account_strategy_assignments.hmac_secret` (a column that consumer
--     code references via raw SQL — see tradingview-marker-service.ts
--     `lookupHmacSecret()` — and that the live DB lacked).
--   - Bootstraps the `system_state` singleton row if missing (id=1, mode=HALT).
--   - Bootstraps the `instance_config` singleton row if missing (id=1).
--
-- All statements are idempotent (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING`)
-- and safe to re-apply.
--
-- The audit_log row at the end uses entity_id=NULL because audit_log.entity_id
-- is UUID-typed (cannot be a free-form string like "table_name").

BEGIN;

-- ─── account_strategy_assignments: ADD hmac_secret ───────────────────────────
-- Consumer requirement: tradingview-marker-service.ts.lookupHmacSecret() reads
-- this column to validate Pine alert HMACs. The live DB previously lacked it
-- (the lookup falls back to null when the column is missing).
ALTER TABLE account_strategy_assignments
  ADD COLUMN IF NOT EXISTS hmac_secret TEXT;

-- ─── system_state singleton row bootstrap ────────────────────────────────────
-- Kill-switch reads id=1 with fail-CLOSED default (HALT). If the row is absent
-- after a fresh DB or test reset, kill-switch sees missing-row and treats it
-- as HALT. Insert here so the row exists immediately post-migration.
INSERT INTO system_state (id, production_mode, kill_reason, set_by, set_at)
VALUES (1, 'HALT', 'phase10_recovery_bootstrap_2026_05_19', 'migration:0117', NOW())
ON CONFLICT (id) DO NOTHING;

-- ─── instance_config singleton row bootstrap ─────────────────────────────────
-- compliance-gate-service.ts + strategy-assignment-service.ts read id=1. The
-- live schema has `instance_id NOT NULL` so the bootstrap row must populate
-- that column (use the deployment slug "trading-forge-primary" as the default).
INSERT INTO instance_config (
  id, instance_id, enabled_firms, active_strategies, tradeify_exclusive_mode
)
VALUES (
  1,
  'trading-forge-primary',
  '["mffu","topstep"]'::jsonb,
  '{}'::jsonb,
  false
)
ON CONFLICT (id) DO NOTHING;

-- ─── Audit log row (entity_id is UUID-typed; use NULL for schema migrations) ─
INSERT INTO audit_log (
  action, entity_type, entity_id, decision_authority, input, result, status, created_at
)
VALUES (
  'migration.0117_recover_missing_tables',
  'migration',
  NULL,
  'system',
  '{"migration":"0117_recover_missing_tables","reason":"Phase 10 recovery — restore Drizzle declarations for 12 tables that vanished in 2026-05-19 86-file null-byte corruption rollback. Live DB introspection showed all tables still exist; only schema.ts needed restoration. SQL adds account_strategy_assignments.hmac_secret and bootstraps system_state + instance_config singletons."}'::jsonb,
  '{"columns_added":["account_strategy_assignments.hmac_secret"],"singletons_bootstrapped":["system_state.id=1","instance_config.id=1"],"tables_already_present_in_db":["system_state","weekly_drift_reports","production_trades","daily_reconciliation","bias_decisions","bias_calibration_curves","bias_ablation_results","broker_accounts","instance_config","nemo_scenario_bank","account_strategy_assignments","tradingview_markers"]}'::jsonb,
  'success',
  NOW()
);

COMMIT;
