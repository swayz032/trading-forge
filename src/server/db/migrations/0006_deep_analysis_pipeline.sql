-- Deep Analysis Pipeline: matrix backtesting + extended trade metadata
-- Wave 3 schema: backtest_matrix table + backtest_trades extensions

CREATE TABLE "backtest_matrix" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"total_combos" integer NOT NULL,
	"completed_combos" integer DEFAULT 0 NOT NULL,
	"results" jsonb,
	"best_combo" jsonb,
	"tier_status" jsonb,
	"execution_time_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backtest_matrix" ADD CONSTRAINT "backtest_matrix_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matrix_strategy_idx" ON "backtest_matrix" USING btree ("strategy_id");--> statement-breakpoint
CREATE INDEX "matrix_status_idx" ON "backtest_matrix" USING btree ("status");--> statement-breakpoint

-- Extend backtest_trades with matrix + analytics columns
ALTER TABLE "backtest_trades" ADD COLUMN "matrix_id" uuid;--> statement-breakpoint
ALTER TABLE "backtest_trades" ADD COLUMN "symbol" text;--> statement-breakpoint
ALTER TABLE "backtest_trades" ADD COLUMN "timeframe" text;--> statement-breakpoint
ALTER TABLE "backtest_trades" ADD COLUMN "net_pnl" numeric;--> statement-breakpoint
ALTER TABLE "backtest_trades" ADD COLUMN "hour_of_day" integer;--> statement-breakpoint
ALTER TABLE "backtest_trades" ADD COLUMN "day_of_week" integer;--> statement-breakpoint
ALTER TABLE "backtest_trades" ADD COLUMN "macro_regime" text;--> statement-breakpoint
ALTER TABLE "backtest_trades" ADD COLUMN "event_active" boolean;--> statement-breakpoint
ALTER TABLE "backtest_trades" ADD COLUMN "skip_signal" text;--> statement-breakpoint
ALTER TABLE "backtest_trades" ADD CONSTRAINT "backtest_trades_matrix_id_backtest_matrix_id_fk" FOREIGN KEY ("matrix_id") REFERENCES "public"."backtest_matrix"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trades_matrix_idx" ON "backtest_trades" USING btree ("matrix_id");--> statement-breakpoint
CREATE INDEX "trades_symbol_idx" ON "backtest_trades" USING btree ("symbol");
