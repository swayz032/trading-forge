-- Top 1% Engine Upgrade: 2 new tables, 3 new columns
-- Gap 2: Run receipt on backtests
-- Gap 3: Walk-forward windows table
-- Gap 8: Search budget on strategies
-- Gap 9: Shadow mode + shadow signals table

-- Gap 2: Add run_receipt jsonb column to backtests
ALTER TABLE "backtests" ADD COLUMN IF NOT EXISTS "run_receipt" jsonb;

-- Gap 8: Add search_budget_used to strategies
ALTER TABLE "strategies" ADD COLUMN IF NOT EXISTS "search_budget_used" integer;

-- Gap 9: Add mode to paper_sessions
ALTER TABLE "paper_sessions" ADD COLUMN IF NOT EXISTS "mode" text NOT NULL DEFAULT 'paper';

-- Gap 3: Walk-forward windows table
CREATE TABLE IF NOT EXISTS "walk_forward_windows" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "backtest_id" uuid NOT NULL REFERENCES "backtests"("id") ON DELETE CASCADE,
    "window_index" integer NOT NULL,
    "is_start" text,
    "is_end" text,
    "oos_start" text,
    "oos_end" text,
    "best_params" jsonb,
    "is_metrics" jsonb,
    "oos_metrics" jsonb,
    "param_stability" jsonb,
    "confidence" text,
    "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "wf_windows_backtest_idx" ON "walk_forward_windows" ("backtest_id");

-- Gap 9: Shadow signals table
CREATE TABLE IF NOT EXISTS "shadow_signals" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "session_id" uuid NOT NULL REFERENCES "paper_sessions"("id") ON DELETE CASCADE,
    "signal_time" timestamp NOT NULL,
    "direction" text NOT NULL,
    "expected_entry" numeric NOT NULL,
    "expected_exit" numeric,
    "actual_market_price" numeric,
    "would_have_filled" boolean,
    "theoretical_pnl" numeric,
    "model_slippage" numeric,
    "actual_slippage" numeric,
    "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "shadow_signals_session_idx" ON "shadow_signals" ("session_id");
CREATE INDEX IF NOT EXISTS "shadow_signals_time_idx" ON "shadow_signals" ("signal_time");
