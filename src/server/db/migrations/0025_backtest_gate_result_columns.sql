-- Migration 0025: Add gate_result and gate_rejections columns to backtests
--
-- H4: The Python backtester returns gate_result and gate_rejections but these
--     were not being persisted. Add JSONB columns to store performance gate
--     pass/fail status and rejection reasons.

ALTER TABLE backtests ADD COLUMN IF NOT EXISTS gate_result jsonb;
ALTER TABLE backtests ADD COLUMN IF NOT EXISTS gate_rejections jsonb;
