CREATE TABLE "stress_test_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backtest_id" uuid NOT NULL,
	"passed" boolean NOT NULL,
	"scenarios" jsonb NOT NULL,
	"failed_scenarios" jsonb,
	"execution_time_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stress_test_runs" ADD CONSTRAINT "stress_test_runs_backtest_id_backtests_id_fk" FOREIGN KEY ("backtest_id") REFERENCES "public"."backtests"("id") ON DELETE no action ON UPDATE no action;