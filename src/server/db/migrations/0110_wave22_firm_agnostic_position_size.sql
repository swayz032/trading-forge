-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0110 — Wave 22: Firm-agnostic position_size block backfill
-- 2026-05-18
--
-- Context: Wave 22 adds firm-aware sizing to the backtester and signal path.
-- The strategy DSL must remain firm-agnostic (CLAUDE.md §4 + operator directive
-- 2026-05-18). This migration backfills the `firm_configs` sub-object into the
-- `position_size` block of all active strategies that have
-- position_size.type="risk_derived_pyramid" but don't yet have firm_configs.
--
-- firm_configs shape (canonical per Wave 22 framework-overlay.ts):
--   {
--     "topstep": { "max_risk_pct_per_trade": 0.02 },
--     "mffu":    { "max_risk_pct_per_trade": 0.02 }
--   }
--
-- The strategy DSL is portable across firms. The sizing engine picks the right
-- branch at signal time based on broker_accounts.firm_id. No firm-specific
-- lock-in in the strategy row.
--
-- Idempotent: only updates rows where firm_configs is NOT already present.
-- Operator runs via: npm run db:migrate (or apply manually on Railway).
--
-- Audit: writes to audit_log action="strategy.firm_agnostic_migration" for
-- each updated row so the transition is fully reconstructable.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Backfill firm_configs into all active strategies with risk_derived_pyramid
-- that don't have firm_configs yet. Idempotent: WHERE clause guards against
-- double-application.
UPDATE strategies
   SET config    = jsonb_set(
                     config,
                     '{strategy,position_size,firm_configs}',
                     '{"topstep": {"max_risk_pct_per_trade": 0.02}, "mffu": {"max_risk_pct_per_trade": 0.02}}'::jsonb,
                     true
                   ),
       updated_at = NOW()
 WHERE archived_at IS NULL
   AND lifecycle_state NOT IN ('GRAVEYARD', 'RETIRED')
   AND (config->'strategy'->'position_size'->>'type') = 'risk_derived_pyramid'
   AND (config->'strategy'->'position_size'->'firm_configs') IS NULL;

-- 2. Record the count of updated rows in audit_log for traceability.
-- Written as a single summary row (not per-strategy) to keep audit_log lean.
-- entity_id is UUID — use NULL for a batch migration row (no single entity).
-- Idempotency: guard on action alone (sufficient; only one 0110 batch row needed).
INSERT INTO audit_log (
  action,
  entity_type,
  entity_id,
  decision_authority,
  input,
  result,
  status,
  created_at
)
SELECT
  'strategy.firm_agnostic_migration',
  'strategies_batch',
  NULL,
  'migration',
  '{"migration": "0110", "wave": "22", "change": "firm_agnostic_position_size_backfill"}'::jsonb,
  jsonb_build_object(
    'updated_count',
    (
      SELECT COUNT(*)
        FROM strategies
       WHERE archived_at IS NULL
         AND lifecycle_state NOT IN ('GRAVEYARD', 'RETIRED')
         AND (config->'strategy'->'position_size'->>'type') = 'risk_derived_pyramid'
         AND (config->'strategy'->'position_size'->'firm_configs') IS NOT NULL
    ),
    'timestamp', NOW()::text,
    'firm_configs_shape', '{"topstep": {"max_risk_pct_per_trade": 0.02}, "mffu": {"max_risk_pct_per_trade": 0.02}}'::jsonb
  ),
  'success',
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM audit_log
   WHERE action = 'strategy.firm_agnostic_migration'
);

COMMIT;
