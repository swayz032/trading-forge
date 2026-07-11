ALTER TABLE "backtests" ADD COLUMN IF NOT EXISTS "sanity_checks" jsonb;
ALTER TABLE "backtests" ADD COLUMN IF NOT EXISTS "cross_validation" jsonb;
