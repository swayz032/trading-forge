CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb,
	"acknowledged" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"input" jsonb,
	"result" jsonb,
	"status" text NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backtest_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backtest_id" uuid NOT NULL,
	"entry_time" timestamp NOT NULL,
	"exit_time" timestamp,
	"direction" text NOT NULL,
	"entry_price" numeric NOT NULL,
	"exit_price" numeric,
	"pnl" numeric,
	"contracts" integer DEFAULT 1 NOT NULL,
	"commission" numeric,
	"slippage" numeric,
	"mae" numeric,
	"mfe" numeric,
	"hold_duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "backtests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"timeframe" text NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"total_return" numeric,
	"sharpe_ratio" numeric,
	"max_drawdown" numeric,
	"win_rate" numeric,
	"profit_factor" numeric,
	"total_trades" integer,
	"avg_trade_pnl" numeric,
	"equity_curve" jsonb,
	"monthly_returns" jsonb,
	"execution_time_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"source" text DEFAULT 'databento' NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"cost_usd" numeric,
	"rows_downloaded" integer,
	"rolls_detected" integer,
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "market_data_meta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"timeframe" text NOT NULL,
	"earliest_date" timestamp NOT NULL,
	"latest_date" timestamp NOT NULL,
	"total_bars" integer NOT NULL,
	"s3_path" text,
	"last_sync_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "monte_carlo_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backtest_id" uuid NOT NULL,
	"num_simulations" integer NOT NULL,
	"max_drawdown_p5" numeric,
	"max_drawdown_p50" numeric,
	"max_drawdown_p95" numeric,
	"sharpe_p5" numeric,
	"sharpe_p50" numeric,
	"sharpe_p95" numeric,
	"probability_of_ruin" numeric,
	"var_95" numeric,
	"var_99" numeric,
	"cvar_95" numeric,
	"paths" jsonb,
	"risk_metrics" jsonb,
	"execution_time_ms" integer,
	"gpu_accelerated" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"symbol" text NOT NULL,
	"timeframe" text NOT NULL,
	"config" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"forge_score" numeric,
	"tags" text[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_journal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid,
	"backtest_id" uuid,
	"source" text NOT NULL,
	"generation_prompt" text,
	"strategy_code" text,
	"strategy_params" jsonb,
	"simulated_equity" jsonb,
	"daily_pnls" jsonb,
	"forge_score" numeric,
	"prop_compliance_results" jsonb,
	"performance_gate_result" jsonb,
	"tier" text,
	"analyst_notes" text,
	"parent_journal_id" uuid,
	"status" text DEFAULT 'tested' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"name" text,
	"exchange" text,
	"active" boolean DEFAULT true,
	"notes" text,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
ALTER TABLE "backtest_trades" ADD CONSTRAINT "backtest_trades_backtest_id_backtests_id_fk" FOREIGN KEY ("backtest_id") REFERENCES "public"."backtests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtests" ADD CONSTRAINT "backtests_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monte_carlo_runs" ADD CONSTRAINT "monte_carlo_runs_backtest_id_backtests_id_fk" FOREIGN KEY ("backtest_id") REFERENCES "public"."backtests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_journal" ADD CONSTRAINT "system_journal_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_journal" ADD CONSTRAINT "system_journal_backtest_id_backtests_id_fk" FOREIGN KEY ("backtest_id") REFERENCES "public"."backtests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "trades_backtest_idx" ON "backtest_trades" USING btree ("backtest_id");--> statement-breakpoint
CREATE INDEX "backtests_strategy_idx" ON "backtests" USING btree ("strategy_id");--> statement-breakpoint
CREATE INDEX "sync_jobs_symbol_idx" ON "data_sync_jobs" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "sync_jobs_status_idx" ON "data_sync_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "market_data_symbol_tf_idx" ON "market_data_meta" USING btree ("symbol","timeframe");--> statement-breakpoint
CREATE INDEX "journal_strategy_idx" ON "system_journal" USING btree ("strategy_id");--> statement-breakpoint
CREATE INDEX "journal_status_idx" ON "system_journal" USING btree ("status");--> statement-breakpoint
CREATE INDEX "journal_tier_idx" ON "system_journal" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "journal_source_idx" ON "system_journal" USING btree ("source");