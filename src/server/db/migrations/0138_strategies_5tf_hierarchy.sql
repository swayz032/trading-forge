-- Migration 0137: Add 5-TF hierarchy columns to strategies table (Wave 25 Pass 2 W25.4)
--
-- Purpose: Expand strategy metadata from 2-TF (bias_timeframe + execution_timeframe)
-- to 5-TF institutional top-down hierarchy:
--   daily_tf  ("1d")  — dealing range + bias narrative
--   htf_tf    ("4h")  — structure (BOS/CHoCH/MSS reference)
--   itf_tf    ("1h")  — execution narrative (institutional middle layer)
--   trigger_tf ("1m"|"5m") — fine entry trigger
--
-- The existing bias_timeframe + execution_timeframe columns are UNCHANGED (back-compat).
-- All 4 new columns are nullable TEXT so strategies that do not declare them keep
-- existing 2-TF behaviour. Daily data ALWAYS loads (engine invariant, backtester.py:3892).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS guards re-runs.

ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS daily_tf    TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS htf_tf      TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS itf_tf      TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS trigger_tf  TEXT DEFAULT NULL;

-- Comment for documentation
COMMENT ON COLUMN strategies.daily_tf   IS 'W25.4: Daily TF for dealing range + narrative (e.g. "1d"). Always loaded by engine invariant regardless of this column.';
COMMENT ON COLUMN strategies.htf_tf     IS 'W25.4: HTF for structure (BOS/CHoCH/MSS) — typically "4h". If NULL, engine falls back to bias_timeframe.';
COMMENT ON COLUMN strategies.itf_tf     IS 'W25.4: ITF for execution narrative — typically "1h". The 2026 institutional middle layer absent from prior builds.';
COMMENT ON COLUMN strategies.trigger_tf IS 'W25.4: Fine entry trigger TF — typically "1m" or "5m". If NULL, execution_timeframe is the finest TF loaded.';
