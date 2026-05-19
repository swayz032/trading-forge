-- Add config_hash to strategy_exports for pre-compile deduplication.
-- SHA-256 of (strategy config JSON + firm_key + export_type) computed before
-- each compile run. A matching hash on the latest completed export means the
-- inputs are identical and the compile can be skipped.
ALTER TABLE "strategy_exports"
    ADD COLUMN IF NOT EXISTS "config_hash" text;
