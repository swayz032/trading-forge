-- Migration 0098: Broker Accounts
--
-- Purpose: Stores per-account broker configuration. Each account maps to a
--   specific prop firm (mffu or topstep) and a broker integration type
--   (traderspost or topstepx). The api_key_vault_ref is a pointer into the
--   Bitwarden credential vault — never the raw API key itself.
--
-- Schema note (Track 4 + Track 5 alignment):
--   account_id UUID is the primary key (per Track 5's references in migration 0100).
--   UNIQUE on (firm_id, account_id_external) prevents duplicate registrations
--   of the same external account under the same firm.
--
-- broker_type constraints:
--   'traderspost' — active TradersPost webhook integration
--   'topstepx'    — deferred stub (until operator opens Topstep + TopstepX API)
--
-- Apply via: node scripts/apply-migration.mjs 0098_broker_accounts.sql

-- ─── UP MIGRATION ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS broker_accounts (
  account_id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id             TEXT            NOT NULL,
  broker_type         TEXT            NOT NULL,
  api_key_vault_ref   TEXT,
  account_id_external TEXT,
  enabled             BOOLEAN         NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT broker_accounts_firm_id_check
    CHECK (firm_id IN ('mffu', 'topstep')),

  CONSTRAINT broker_accounts_broker_type_check
    CHECK (broker_type IN ('traderspost', 'topstepx'))
);

-- Unique account per (firm, external id) to prevent duplicate registrations
CREATE UNIQUE INDEX IF NOT EXISTS idx_broker_accounts_firm_external
  ON broker_accounts (firm_id, account_id_external)
  WHERE account_id_external IS NOT NULL;

-- Index for enabled account listing per firm
CREATE INDEX IF NOT EXISTS idx_broker_accounts_firm_id
  ON broker_accounts (firm_id);

CREATE INDEX IF NOT EXISTS idx_broker_accounts_enabled
  ON broker_accounts (enabled);

-- ─── DOWN MIGRATION ───────────────────────────────────────────────────────────
-- To reverse: DROP TABLE IF EXISTS broker_accounts CASCADE;
-- (CASCADE removes the FK in account_strategy_assignments)
