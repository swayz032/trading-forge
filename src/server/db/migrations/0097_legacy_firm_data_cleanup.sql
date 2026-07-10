-- Migration 0097: Legacy Firm Data Cleanup
--
-- Purpose: Remove all rows for the 9 legacy prop firms from operational tables.
--   Removed firms: apex, tpt, ffn, alpha, tradeify, earn2trade, fundingpips, top_one, yrm_prop
--   Retained firms: mffu, topstep ONLY
--
-- Rationale: Operator decision 2026-05-10. Only MFFU and Topstep are actively used.
--   Legacy firm rows in these tables pollute survival math, health-check probing,
--   and firm-eligibility promotion outputs with stale/irrelevant data.
--
-- Reversibility:
--   DOWN migration below restores from backup tables created in this migration.
--   Backup tables are named <original>_legacy_backup (created once, never truncated).
--   If the backup tables already exist (re-run), the CREATE TABLE IF NOT EXISTS is safe.
--
-- Audit trail:
--   One audit_log row is written per deleted batch at the bottom of the UP migration.
--   action = 'migration_0097_legacy_firm_cleanup', category = 'compliance'.
--
-- Apply via direct SQL on Railway (drizzle-kit generate not needed — manual SQL only):
--   node scripts/apply-migration.mjs 0097_legacy_firm_data_cleanup.sql

-- ─── UP MIGRATION ─────────────────────────────────────────────────────────────

-- Step 1: Create backup tables (idempotent)
CREATE TABLE IF NOT EXISTS firm_adversarial_priors_legacy_backup AS
  SELECT * FROM firm_adversarial_priors WHERE 1=0;

CREATE TABLE IF NOT EXISTS prop_firm_health_checks_legacy_backup AS
  SELECT * FROM prop_firm_health_checks WHERE 1=0;

CREATE TABLE IF NOT EXISTS strategy_firm_eligibility_legacy_backup AS
  SELECT * FROM strategy_firm_eligibility WHERE 1=0;

-- Step 2: Copy legacy rows to backup tables before deletion
INSERT INTO firm_adversarial_priors_legacy_backup
  SELECT * FROM firm_adversarial_priors
  WHERE firm_id NOT IN ('mffu', 'topstep')
  ON CONFLICT DO NOTHING;

INSERT INTO prop_firm_health_checks_legacy_backup
  SELECT * FROM prop_firm_health_checks
  WHERE firm_id NOT IN ('mffu', 'topstep')
  ON CONFLICT DO NOTHING;

INSERT INTO strategy_firm_eligibility_legacy_backup
  SELECT * FROM strategy_firm_eligibility
  WHERE firm_id NOT IN ('mffu', 'topstep')
  ON CONFLICT DO NOTHING;

-- Step 3: Delete legacy rows
DELETE FROM firm_adversarial_priors
  WHERE firm_id NOT IN ('mffu', 'topstep');

DELETE FROM prop_firm_health_checks
  WHERE firm_id NOT IN ('mffu', 'topstep');

DELETE FROM strategy_firm_eligibility
  WHERE firm_id NOT IN ('mffu', 'topstep');

-- Step 4: Write audit log entry
-- deep-scan fresh-bootstrap fix: audit_log has never had `category` or `actor` columns (see
-- schema.ts / 0000_previous_nuke.sql's original CREATE TABLE — only id/action/entity_type/
-- entity_id/input/result/status/duration_ms/created_at). This INSERT would fail on a
-- genuinely fresh bootstrap ("column category of relation audit_log does not exist") and,
-- separately, also omitted the NOT NULL `status` column. Folding category/actor into the
-- existing `result` JSONB payload (alongside the rest of the audit detail) preserves the
-- original semantic information while using only real columns. No ON CONFLICT guard on this
-- INSERT is intentional and matches the accepted pattern elsewhere (e.g. 0152) — re-running
-- this migration against a DB where the legacy-firm rows are already gone is a safe idempotent
-- no-op for steps 1-3 and merely appends a second (harmless, duplicate) audit row here.
INSERT INTO audit_log (
  id,
  action,
  status,
  result,
  created_at
)
VALUES (
  gen_random_uuid(),
  'migration_0097_legacy_firm_cleanup',
  'success',
  jsonb_build_object(
    'category', 'compliance',
    'actor', 'migration',
    'retained_firms', ARRAY['mffu', 'topstep'],
    'removed_firms', ARRAY['apex', 'tpt', 'ffn', 'alpha', 'tradeify', 'earn2trade', 'fundingpips', 'top_one', 'yrm_prop'],
    'backup_tables', ARRAY['firm_adversarial_priors_legacy_backup', 'prop_firm_health_checks_legacy_backup', 'strategy_firm_eligibility_legacy_backup'],
    'applied_at', now()::text
  ),
  now()
);

-- ─── DOWN MIGRATION (restore from backups) ────────────────────────────────────
-- To reverse this migration, run the following SQL manually:
--
-- INSERT INTO firm_adversarial_priors
--   SELECT * FROM firm_adversarial_priors_legacy_backup
--   ON CONFLICT (firm_id, event_type) DO NOTHING;
--
-- INSERT INTO prop_firm_health_checks
--   SELECT * FROM prop_firm_health_checks_legacy_backup
--   ON CONFLICT DO NOTHING;
--
-- INSERT INTO strategy_firm_eligibility
--   SELECT * FROM strategy_firm_eligibility_legacy_backup
--   ON CONFLICT DO NOTHING;
--
-- Note: backup tables are preserved after DOWN migration to allow re-application.
-- They can be dropped manually once the rollback is confirmed stable:
--   DROP TABLE IF EXISTS firm_adversarial_priors_legacy_backup;
--   DROP TABLE IF EXISTS prop_firm_health_checks_legacy_backup;
--   DROP TABLE IF EXISTS strategy_firm_eligibility_legacy_backup;
