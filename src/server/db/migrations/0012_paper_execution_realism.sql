-- Paper Trading Execution Realism (Phase 2)
-- TCA columns on paper_positions

ALTER TABLE "paper_positions" ADD COLUMN IF NOT EXISTS "arrival_price" numeric;
ALTER TABLE "paper_positions" ADD COLUMN IF NOT EXISTS "implementation_shortfall" numeric;
ALTER TABLE "paper_positions" ADD COLUMN IF NOT EXISTS "fill_ratio" numeric DEFAULT 1.0;
