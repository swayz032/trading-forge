-- Migration 0100b: Add hmac_secret column to account_strategy_assignments
--
-- Purpose: Each per-recipient Pine export embeds a unique HMAC secret in the
--   TradersPost alert payload. The TradingView marker collector route (Track 8,
--   Pass 3) validates this HMAC to authenticate inbound alert callbacks.
--
--   This column is nullable so pre-Track-6 rows remain valid. It is populated
--   by pine-export-recipient-service.ts on the first per-recipient export for
--   each (account_id, strategy_id) pair and is idempotent thereafter.
--
-- Coordination: Track 5 (paper-parity) owns the account_strategy_assignments
--   table (migration 0100). Track 6 (pine-export) adds this column via 0100b
--   to decouple delivery from the primary Track 5 schema change.
--
-- Apply via: node scripts/apply-migration.mjs 0100b_assignment_hmac_secret.sql

-- ─── UP MIGRATION ─────────────────────────────────────────────────────────────

ALTER TABLE account_strategy_assignments
  ADD COLUMN IF NOT EXISTS hmac_secret TEXT;

COMMENT ON COLUMN account_strategy_assignments.hmac_secret IS
  'Per-recipient HMAC secret (64-char hex, crypto.randomBytes(32)). '
  'Populated on first Pine export for this (account_id, strategy_id). '
  'Embedded in TradersPost alert payload for Track 8 marker collection validation.';

-- ─── DOWN MIGRATION ───────────────────────────────────────────────────────────
-- To reverse: ALTER TABLE account_strategy_assignments DROP COLUMN IF EXISTS hmac_secret;
