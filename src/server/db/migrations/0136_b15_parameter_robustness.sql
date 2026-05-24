-- Migration 0136: B15 Parameter Robustness Battery
-- Wave 25 Item 5 — QuantForgeAnalytics 2026-05-16 institutional spec
-- Adds b15_battery JSONB column to backtests table.
-- Stores SDR/PSI/RWS results + pass/fail + thresholds + failure reasons.
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE backtests
  ADD COLUMN IF NOT EXISTS b15_battery JSONB NULL;

--> statement-breakpoint

-- GIN index on the 'passed' key so lifecycle-service can efficiently query
-- "which deployed strategies have a passing b15 battery?"
-- Example: WHERE (b15_battery->>'passed')::boolean = false
CREATE INDEX IF NOT EXISTS backtests_b15_passed_idx
  ON backtests USING GIN ((b15_battery -> 'passed'));
