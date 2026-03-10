ALTER TABLE "backtests" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "backtests" ADD COLUMN "avg_daily_pnl" numeric;--> statement-breakpoint
ALTER TABLE "backtests" ADD COLUMN "forge_score" numeric;--> statement-breakpoint
ALTER TABLE "backtests" ADD COLUMN "tier" text;--> statement-breakpoint
ALTER TABLE "backtests" ADD COLUMN "daily_pnls" jsonb;--> statement-breakpoint
ALTER TABLE "backtests" ADD COLUMN "config" jsonb;--> statement-breakpoint
ALTER TABLE "backtests" ADD COLUMN "walk_forward_results" jsonb;--> statement-breakpoint
ALTER TABLE "backtests" ADD COLUMN "prop_compliance" jsonb;--> statement-breakpoint
ALTER TABLE "backtests" ADD COLUMN "error_message" text;--> statement-breakpoint
CREATE INDEX "backtests_status_idx" ON "backtests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "backtests_tier_idx" ON "backtests" USING btree ("tier");