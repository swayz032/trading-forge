-- Add peak_equity column for trailing drawdown tracking (prop firm standard)
-- Initialize to current_equity so existing sessions get correct high-water mark
ALTER TABLE "paper_sessions" ADD COLUMN IF NOT EXISTS "peak_equity" NUMERIC NOT NULL DEFAULT '50000';

-- Backfill: set peak_equity = GREATEST(starting_capital, current_equity) for existing rows
UPDATE "paper_sessions" SET "peak_equity" = GREATEST("starting_capital"::numeric, "current_equity"::numeric);
