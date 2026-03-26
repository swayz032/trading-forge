-- Step 5: Strategy self-evolution — ancestry tracking
ALTER TABLE "strategies" ADD COLUMN "parent_strategy_id" uuid;
ALTER TABLE "strategies" ADD COLUMN "generation" integer NOT NULL DEFAULT 0;
