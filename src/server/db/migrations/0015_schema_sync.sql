-- Schema sync: fix defaults, add missing tables/columns
-- This migration brings the DB in line with schema.ts for anything missed by prior migrations.

-- Fix paper_sessions defaults (migration 0004 used 100000, schema uses 50000)
ALTER TABLE "paper_sessions" ALTER COLUMN "starting_capital" SET DEFAULT '50000';
ALTER TABLE "paper_sessions" ALTER COLUMN "current_equity" SET DEFAULT '50000';

-- Add mode column if missing (was added via drizzle-kit push but not in migrations)
ALTER TABLE "paper_sessions" ADD COLUMN IF NOT EXISTS "mode" text NOT NULL DEFAULT 'paper';

-- Fix strategies table: rename status->lifecycle_state if old column exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='strategies' AND column_name='status') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='strategies' AND column_name='lifecycle_state') THEN
      ALTER TABLE "strategies" RENAME COLUMN "status" TO "lifecycle_state";
      ALTER TABLE "strategies" ALTER COLUMN "lifecycle_state" SET DEFAULT 'CANDIDATE';
    END IF;
  END IF;
END $$;

-- Add missing columns to strategies (if not already present)
ALTER TABLE "strategies" ADD COLUMN IF NOT EXISTS "lifecycle_state" text NOT NULL DEFAULT 'CANDIDATE';
ALTER TABLE "strategies" ADD COLUMN IF NOT EXISTS "lifecycle_changed_at" timestamp DEFAULT now();
ALTER TABLE "strategies" ADD COLUMN IF NOT EXISTS "preferred_regime" text;
ALTER TABLE "strategies" ADD COLUMN IF NOT EXISTS "rolling_sharpe_30d" numeric;
ALTER TABLE "strategies" ADD COLUMN IF NOT EXISTS "forge_score" numeric;
ALTER TABLE "strategies" ADD COLUMN IF NOT EXISTS "tags" text[];
ALTER TABLE "strategies" ADD COLUMN IF NOT EXISTS "search_budget_used" integer;
ALTER TABLE "strategies" ADD COLUMN IF NOT EXISTS "parent_strategy_id" uuid;
ALTER TABLE "strategies" ADD COLUMN IF NOT EXISTS "generation" integer NOT NULL DEFAULT 0;

-- Add missing columns to backtest_trades
ALTER TABLE "backtest_trades" ADD COLUMN IF NOT EXISTS "gross_pnl" numeric;
ALTER TABLE "backtest_trades" ADD COLUMN IF NOT EXISTS "fill_probability" numeric;
ALTER TABLE "backtest_trades" ADD COLUMN IF NOT EXISTS "session_type" text;
ALTER TABLE "backtest_trades" ADD COLUMN IF NOT EXISTS "macro_regime" text;
ALTER TABLE "backtest_trades" ADD COLUMN IF NOT EXISTS "event_active" boolean;
ALTER TABLE "backtest_trades" ADD COLUMN IF NOT EXISTS "skip_signal" text;

-- Create tournament_results if not exists (0003 tried to ALTER it before CREATE)
CREATE TABLE IF NOT EXISTS "tournament_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tournament_date" timestamp NOT NULL,
  "candidate_name" text NOT NULL,
  "candidate_dsl" jsonb NOT NULL,
  "proposer_output" jsonb,
  "compiler_pass" boolean,
  "graveyard_pass" boolean,
  "critic_output" jsonb,
  "prosecutor_output" jsonb,
  "promoter_output" jsonb,
  "final_verdict" text NOT NULL,
  "revision_notes" text,
  "backtest_id" uuid REFERENCES "backtests"("id"),
  "expires_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "tournament_results_date_idx" ON "tournament_results" ("tournament_date");
CREATE INDEX IF NOT EXISTS "tournament_results_verdict_idx" ON "tournament_results" ("final_verdict");
CREATE INDEX IF NOT EXISTS "tournament_results_candidate_idx" ON "tournament_results" ("candidate_name");

-- Create compliance tables if not exist
CREATE TABLE IF NOT EXISTS "compliance_rulesets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "firm" text NOT NULL,
  "account_type" text NOT NULL DEFAULT 'default',
  "source_url" text,
  "content_hash" text,
  "raw_content" text,
  "parsed_rules" jsonb,
  "status" text NOT NULL DEFAULT 'pending',
  "drift_detected" boolean DEFAULT false,
  "drift_diff" text,
  "verified_by" text,
  "verified_at" timestamp,
  "retrieved_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "compliance_rulesets_firm_idx" ON "compliance_rulesets" ("firm");
CREATE INDEX IF NOT EXISTS "compliance_rulesets_status_idx" ON "compliance_rulesets" ("status");

CREATE TABLE IF NOT EXISTS "compliance_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "strategy_id" uuid REFERENCES "strategies"("id"),
  "firm" text NOT NULL,
  "account_type" text NOT NULL DEFAULT 'default',
  "ruleset_id" uuid REFERENCES "compliance_rulesets"("id"),
  "compliance_result" text NOT NULL,
  "risk_score" numeric DEFAULT '0',
  "violations" jsonb DEFAULT '[]',
  "warnings" jsonb DEFAULT '[]',
  "required_changes" jsonb DEFAULT '[]',
  "reasoning_summary" text,
  "execution_gate" text NOT NULL,
  "reviewed_by" text DEFAULT 'openclaw',
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "compliance_reviews_strategy_idx" ON "compliance_reviews" ("strategy_id");
CREATE INDEX IF NOT EXISTS "compliance_reviews_firm_idx" ON "compliance_reviews" ("firm");

CREATE TABLE IF NOT EXISTS "compliance_drift_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "firm" text NOT NULL,
  "account_type" text NOT NULL DEFAULT 'default',
  "ruleset_id" uuid REFERENCES "compliance_rulesets"("id"),
  "previous_hash" text,
  "new_hash" text,
  "drift_summary" text,
  "detected_at" timestamp DEFAULT now() NOT NULL,
  "resolved" boolean DEFAULT false,
  "resolved_at" timestamp,
  "resolved_by" text,
  "notes" text
);
CREATE INDEX IF NOT EXISTS "compliance_drift_log_firm_idx" ON "compliance_drift_log" ("firm");
CREATE INDEX IF NOT EXISTS "compliance_drift_log_resolved_idx" ON "compliance_drift_log" ("resolved");

-- Create skip_decisions if not exists
CREATE TABLE IF NOT EXISTS "skip_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "strategy_id" uuid REFERENCES "strategies"("id"),
  "decision_date" timestamp NOT NULL,
  "decision" text NOT NULL,
  "score" numeric NOT NULL,
  "signals" jsonb NOT NULL,
  "triggered_signals" text[],
  "reason" text,
  "override" boolean DEFAULT false,
  "override_reason" text,
  "actual_outcome" text,
  "actual_pnl" numeric,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "skip_decisions_strategy_idx" ON "skip_decisions" ("strategy_id");
CREATE INDEX IF NOT EXISTS "skip_decisions_date_idx" ON "skip_decisions" ("decision_date");
CREATE INDEX IF NOT EXISTS "skip_decisions_decision_idx" ON "skip_decisions" ("decision");

-- Create macro_snapshots if not exists
CREATE TABLE IF NOT EXISTS "macro_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "snapshot_date" timestamp NOT NULL UNIQUE,
  "fed_funds_rate" numeric,
  "treasury_10y" numeric,
  "treasury_2y" numeric,
  "treasury_3m" numeric,
  "vix" numeric,
  "yield_spread_10y2y" numeric,
  "unemployment" numeric,
  "cpi_yoy" numeric,
  "pce_yoy" numeric,
  "wti_crude" numeric,
  "natural_gas" numeric,
  "macro_regime" text,
  "regime_confidence" numeric,
  "raw_data" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "macro_snapshots_date_idx" ON "macro_snapshots" ("snapshot_date");
CREATE INDEX IF NOT EXISTS "macro_snapshots_regime_idx" ON "macro_snapshots" ("macro_regime");

-- Create strategy_graveyard if not exists
CREATE TABLE IF NOT EXISTS "strategy_graveyard" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "strategy_id" uuid REFERENCES "strategies"("id"),
  "name" text NOT NULL,
  "dsl_snapshot" jsonb NOT NULL,
  "failure_modes" text[] NOT NULL,
  "failure_details" jsonb,
  "backtest_summary" jsonb,
  "embedding" jsonb,
  "death_reason" text,
  "death_date" timestamp NOT NULL,
  "source" text DEFAULT 'auto',
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "graveyard_strategy_idx" ON "strategy_graveyard" ("strategy_id");
CREATE INDEX IF NOT EXISTS "graveyard_death_date_idx" ON "strategy_graveyard" ("death_date");
CREATE INDEX IF NOT EXISTS "graveyard_source_idx" ON "strategy_graveyard" ("source");

-- Create day_archetypes if not exists
CREATE TABLE IF NOT EXISTS "day_archetypes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "symbol" text NOT NULL,
  "trading_date" timestamp NOT NULL,
  "archetype" text NOT NULL,
  "confidence" numeric,
  "metrics" jsonb,
  "features" jsonb,
  "predicted_archetype" text,
  "prediction_correct" boolean,
  "created_at" timestamp DEFAULT now() NOT NULL,
  UNIQUE ("symbol", "trading_date")
);
CREATE INDEX IF NOT EXISTS "day_archetypes_archetype_idx" ON "day_archetypes" ("archetype");
