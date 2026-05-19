-- Migration: 0036_sqa_comparison_critic_regret
-- Phase 1.7: SQA vs Optuna benchmark — comparison_result column on sqa_optimization_runs
-- Phase 1.9: Critic candidate regret attribution — regret_score column on critic_candidates

-- ─── Phase 1.7: SQA vs Optuna benchmark ─────────────────────────────────────
-- Persists the side-by-side SQA vs Optuna comparison computed after every SQA run.
-- Schema: {sqa_wins, delta, speedup, sqa_objective, optuna_objective, sqa_time_ms,
--          optuna_time_ms, optuna_trials, notes, governance}
ALTER TABLE "sqa_optimization_runs"
  ADD COLUMN IF NOT EXISTS "comparison_result" jsonb;

-- ─── Phase 1.9: Critic candidate regret attribution ──────────────────────────
-- Closes the "did the candidate actually perform?" feedback loop.
-- regretScore = (predicted - actual) / predicted
-- Positive = candidate overpromised (child underperformed).
-- Negative = candidate exceeded expectations.
-- NULL until child strategy has 30+ days of PAPER or beyond with 20+ paper trades.
ALTER TABLE "critic_candidates"
  ADD COLUMN IF NOT EXISTS "regret_score" numeric;
