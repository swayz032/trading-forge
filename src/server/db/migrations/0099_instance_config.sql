-- Migration 0099: Instance Config Singleton
--
-- Purpose: Single-row configuration for this Trading Forge instance.
--   The singleton pattern (id INT PRIMARY KEY DEFAULT 1 CHECK id=1) ensures
--   only one config row can ever exist, preventing multi-row confusion.
--
--   enabled_firms:      JSONB array of firm_ids active on this instance.
--                       Runtime validation enforces subset of ['mffu','topstep'].
--   active_strategies:  JSONB object mapping account_id (UUID string) → strategy_id
--                       (UUID string). Updated by strategy-assignment-service (Track 5).
--   tradeify_exclusive_mode: Future-proof boolean, always false today. Reserved for
--                       a hypothetical future where one firm requires exclusive mode.
--                       Explicitly named for auditability — "exclusive_mode" alone
--                       is ambiguous in a multi-firm context.
--   updated_at:         Set on every upsert for compliance_gate_service per-instance
--                       scope reads.
--
-- Apply via: node scripts/apply-migration.mjs 0099_instance_config.sql

-- ─── UP MIGRATION ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS instance_config (
  id                      INT         PRIMARY KEY DEFAULT 1,
  instance_id             TEXT        NOT NULL,
  enabled_firms           JSONB       NOT NULL DEFAULT '[]'::jsonb,
  active_strategies       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  tradeify_exclusive_mode BOOLEAN     NOT NULL DEFAULT false,
  updated_at              TIMESTAMPTZ,

  CONSTRAINT instance_config_singleton_check
    CHECK (id = 1)
);

-- ─── DOWN MIGRATION ───────────────────────────────────────────────────────────
-- To reverse: DROP TABLE IF EXISTS instance_config;
