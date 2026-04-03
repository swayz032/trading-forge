-- Phase 1: Quantum Persistence Layer + Critic Optimization Tables
-- 6 new tables for first-class quantum evidence storage and critic loop

-- SQA Optimization Runs (promoted from jsonb sub-key to first-class table)
CREATE TABLE IF NOT EXISTS "sqa_optimization_runs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "backtest_id" uuid NOT NULL REFERENCES "backtests"("id"),
    "strategy_id" uuid NOT NULL REFERENCES "strategies"("id"),
    "param_ranges" jsonb,
    "best_params" jsonb,
    "best_energy" numeric,
    "robust_plateau" jsonb,
    "all_solutions" jsonb,
    "num_reads" integer,
    "num_sweeps" integer,
    "execution_time_ms" integer,
    "governance_labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "sqa_runs_backtest_idx" ON "sqa_optimization_runs" ("backtest_id");
CREATE INDEX IF NOT EXISTS "sqa_runs_strategy_idx" ON "sqa_optimization_runs" ("strategy_id");

-- QUBO Timing Runs
CREATE TABLE IF NOT EXISTS "qubo_timing_runs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "backtest_id" uuid NOT NULL REFERENCES "backtests"("id"),
    "strategy_id" uuid NOT NULL REFERENCES "strategies"("id"),
    "session_type" text,
    "window_size" integer,
    "schedule" jsonb,
    "expected_return" numeric,
    "cost_savings" numeric,
    "backtest_improvement" numeric,
    "governance_labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "qubo_timing_backtest_idx" ON "qubo_timing_runs" ("backtest_id");
CREATE INDEX IF NOT EXISTS "qubo_timing_strategy_idx" ON "qubo_timing_runs" ("strategy_id");

-- Tensor Predictions
CREATE TABLE IF NOT EXISTS "tensor_predictions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "backtest_id" uuid NOT NULL REFERENCES "backtests"("id"),
    "strategy_id" uuid NOT NULL REFERENCES "strategies"("id"),
    "model_version" text,
    "probability" numeric,
    "confidence" numeric,
    "signal" text,
    "feature_snapshot" jsonb,
    "regime_at_prediction" text,
    "fragility_score" numeric,
    "regime_breakdown" jsonb,
    "governance_labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "tensor_pred_backtest_idx" ON "tensor_predictions" ("backtest_id");
CREATE INDEX IF NOT EXISTS "tensor_pred_strategy_idx" ON "tensor_predictions" ("strategy_id");

-- RL Training Runs
CREATE TABLE IF NOT EXISTS "rl_training_runs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "strategy_id" uuid NOT NULL REFERENCES "strategies"("id"),
    "method" text NOT NULL,
    "n_qubits" integer,
    "n_layers" integer,
    "episodes" integer,
    "max_steps" integer,
    "total_return" numeric,
    "sharpe_ratio" numeric,
    "win_rate" numeric,
    "total_trades" integer,
    "policy_weights" jsonb,
    "comparison_result" jsonb,
    "governance_labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "execution_time_ms" integer,
    "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "rl_runs_strategy_idx" ON "rl_training_runs" ("strategy_id");
CREATE INDEX IF NOT EXISTS "rl_runs_method_idx" ON "rl_training_runs" ("method");

-- Critic Optimization Runs
CREATE TABLE IF NOT EXISTS "critic_optimization_runs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "strategy_id" uuid NOT NULL REFERENCES "strategies"("id"),
    "backtest_id" uuid NOT NULL REFERENCES "backtests"("id"),
    "status" text DEFAULT 'pending' NOT NULL,
    "candidates_generated" integer,
    "survivor_candidate_id" uuid,
    "survivor_backtest_id" uuid,
    "parent_composite_score" numeric,
    "survivor_composite_score" numeric,
    "evidence_sources" jsonb,
    "evidence_packet" jsonb,
    "composite_weights" jsonb,
    "execution_time_ms" integer,
    "completed_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "critic_runs_strategy_idx" ON "critic_optimization_runs" ("strategy_id");
CREATE INDEX IF NOT EXISTS "critic_runs_backtest_idx" ON "critic_optimization_runs" ("backtest_id");
CREATE INDEX IF NOT EXISTS "critic_runs_status_idx" ON "critic_optimization_runs" ("status");

-- Critic Candidates
CREATE TABLE IF NOT EXISTS "critic_candidates" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "run_id" uuid NOT NULL REFERENCES "critic_optimization_runs"("id") ON DELETE CASCADE,
    "strategy_id" uuid NOT NULL REFERENCES "strategies"("id"),
    "rank" integer NOT NULL,
    "changed_params" jsonb NOT NULL,
    "parent_params" jsonb,
    "source_of_change" text NOT NULL,
    "expected_uplift" numeric,
    "risk_penalty" numeric,
    "composite_score" numeric,
    "actual_composite_score" numeric,
    "confidence" text,
    "reasoning" text,
    "replay_status" text DEFAULT 'pending' NOT NULL,
    "replay_backtest_id" uuid REFERENCES "backtests"("id"),
    "replay_tier" text,
    "replay_forge_score" numeric,
    "selected" boolean DEFAULT false,
    "governance_labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "critic_cand_run_idx" ON "critic_candidates" ("run_id");
CREATE INDEX IF NOT EXISTS "critic_cand_strategy_idx" ON "critic_candidates" ("strategy_id");
CREATE INDEX IF NOT EXISTS "critic_cand_status_idx" ON "critic_candidates" ("replay_status");
CREATE INDEX IF NOT EXISTS "critic_cand_selected_idx" ON "critic_candidates" ("selected");
