-- Step 5: Strategy self-evolution — ancestry tracking
ALTER TABLE "strategies" ADD COLUMN IF NOT EXISTS "parent_strategy_id" uuid;
ALTER TABLE "strategies" ADD COLUMN IF NOT EXISTS "generation" integer NOT NULL DEFAULT 0;
