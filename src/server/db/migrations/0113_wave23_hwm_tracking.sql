-- Wave 23 B.2 — High-water balance tracking for paper_sessions
-- Adds high_water_balance column to paper_sessions.
-- Purpose: enables accurate Topstep trailing-DD buffer math at signal time.
--   computeRiskDerivedContracts() previously defaulted HWM = currentBalance
--   (conservative, over-restrictive). With actual HWM tracking, Topstep buffer
--   math reflects the true trailing floor: buffer = balance - min(HWM - trailingDD, startingFloor).
--
-- Default: startingCapital value (50000) for all existing rows.
-- Idempotent: can be re-run; IF NOT EXISTS guards the column add.

-- Add column with default matching existing starting_capital values
ALTER TABLE paper_sessions
  ADD COLUMN IF NOT EXISTS high_water_balance NUMERIC(20, 8) NOT NULL DEFAULT 50000;

-- Backfill existing rows: set HWM = starting_capital (safest default).
-- realizedPeakEquity is kept as the authoritative W12 MTM-HWM display column.
-- high_water_balance is the CLOSED-EQUITY HWM for risk sizing only.
UPDATE paper_sessions
SET high_water_balance = COALESCE(starting_capital, 50000)
WHERE high_water_balance = 50000
  AND COALESCE(starting_capital, 50000) != 50000;

-- Audit log: record migration execution
-- entity_id is a UUID column — schema migrations don't have an entity row, leave NULL
INSERT INTO audit_log (action, entity_type, entity_id, decision_authority, result, status, created_at)
VALUES (
  'db_migration.applied',
  'schema',
  NULL,
  'system',
  '{"migration": "0113_wave23_hwm_tracking", "column_added": "paper_sessions.high_water_balance", "default": 50000, "wave": 23}'::jsonb,
  'success',
  NOW()
)
ON CONFLICT DO NOTHING;
