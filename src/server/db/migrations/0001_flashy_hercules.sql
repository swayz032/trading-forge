ALTER TABLE "backtests" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "backtests" ADD COLUMN IF NOT EXISTS "avg_daily_pnl" numeric;--> statement-breakpoint
ALTER TABLE "backtests" ADD COLUMN IF NOT EXISTS "forge_score" numeric;--> statement-breakpoint
ALTER TABLE "backtests" ADD COLUMN IF NOT EXISTS "tier" text;--> statement-breakpoint
ALTER TABLE "backtests" ADD COLUMN IF NOT EXISTS "daily_pnls" jsonb;--> statement-breakpoint
ALTER TABLE "backtests" ADD COLUMN IF NOT EXISTS "config" jsonb;--> statement-breakpoint
ALTER TABLE "backtests" ADD COLUMN IF NOT EXISTS "walk_forward_results" jsonb;--> statement-breakpoint
ALTER TABLE "backtests" ADD COLUMN IF NOT EXISTS "prop_compliance" jsonb;--> statement-breakpoint
ALTER TABLE "backtests" ADD COLUMN IF NOT EXISTS "error_message" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backtests_status_idx" ON "backtests" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backtests_tier_idx" ON "backtests" USING btree ("tier");