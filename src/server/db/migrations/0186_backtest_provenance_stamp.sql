-- Migration 0186: backtest_provenance_stamp
-- Layer 4 research conveyor item 3 (2026-07-02): provenance stamping as a hard gate
--
-- Adds provenance_stamp JSONB column to the backtests table.
-- Every new backtest row carries a stamp with 5 mandatory fields:
--   engine_version       — codebase version + git SHA
--   data_snapshot_id     — SHA-256 of data slice descriptor
--   gate_battery_version — versioned gate-chain constant
--   overlay_config_hash  — SHA-256 of effective framework overlay config
--   spec_provenance_ref  — compiled-spec identifier linking to extraction chain
--
-- Existing rows (pre-2026-07-02) will have provenance_stamp = NULL.
-- Use the backfill script with PROVENANCE_ALLOW_LEGACY_BACKFILL=true to stamp
-- those rows with legacy=true sentinel values.
-- Pre-stamp rows are documented as non-comparable with post-stamp rows.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS
-- Boot-migration-runner keyed on meta/_journal.json idx 189 / tag 0186_backtest_provenance_stamp

ALTER TABLE backtests ADD COLUMN IF NOT EXISTS provenance_stamp JSONB;

-- Index for filtering by engine_version (support comparability queries)
CREATE INDEX IF NOT EXISTS idx_backtests_provenance_engine_version
  ON backtests ((provenance_stamp->>'engine_version'))
  WHERE provenance_stamp IS NOT NULL;

-- Index for filtering by gate_battery_version
CREATE INDEX IF NOT EXISTS idx_backtests_provenance_gate_battery
  ON backtests ((provenance_stamp->>'gate_battery_version'))
  WHERE provenance_stamp IS NOT NULL;

-- Index for legacy backfill rows (null-stamp rows are non-comparable)
CREATE INDEX IF NOT EXISTS idx_backtests_provenance_null
  ON backtests (id)
  WHERE provenance_stamp IS NULL;
