-- ═══════════════════════════════════════════════════════════════════════════════
-- 0052: FK Cascade Hardening (schema.ts ↔ DB state alignment)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 0038a hand-applied ON DELETE CASCADE / SET NULL to all FKs flagged
-- by the H3 audit, but src/server/db/schema.ts inline references() never carried
-- the matching `{ onDelete: ... }` option. This caused source-of-truth drift:
--   - Drizzle's snapshot tracked schema.ts (NO ACTION)
--   - Production DB tracked 0038a (CASCADE / SET NULL)
--
-- This migration is idempotent: it re-applies the SAME constraints as 0038a so
-- that Drizzle's snapshot now matches reality. After schema.ts was updated to
-- carry inline onDelete clauses, future db:generate runs will be stable.
--
-- Pattern (per PRODUCTION-HARDENING.md Wave 4 #17):
--   - Run-results that cannot exist without parent  → CASCADE
--   - Audit/journal/forensics                       → SET NULL
--
-- TEST IN DEV BEFORE RUNNING IN PROD. Verify FK constraint names match your DB
-- (these match Drizzle's auto-naming convention `<table>_<col>_<reftable>_<refcol>_fk`).
-- All ALTER TABLE statements use DROP CONSTRAINT IF EXISTS so re-application is safe.

-- ─── backtests.strategy_id → strategies.id (CASCADE) ───
ALTER TABLE "backtests" DROP CONSTRAINT IF EXISTS "backtests_strategy_id_strategies_id_fk";
ALTER TABLE "backtests" ADD CONSTRAINT "backtests_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── backtest_matrix.strategy_id → strategies.id (CASCADE) ───
ALTER TABLE "backtest_matrix" DROP CONSTRAINT IF EXISTS "backtest_matrix_strategy_id_strategies_id_fk";
ALTER TABLE "backtest_matrix" ADD CONSTRAINT "backtest_matrix_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── monte_carlo_runs.backtest_id → backtests.id (CASCADE) ───
ALTER TABLE "monte_carlo_runs" DROP CONSTRAINT IF EXISTS "monte_carlo_runs_backtest_id_backtests_id_fk";
ALTER TABLE "monte_carlo_runs" ADD CONSTRAINT "monte_carlo_runs_backtest_id_backtests_id_fk"
  FOREIGN KEY ("backtest_id") REFERENCES "backtests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── stress_test_runs.backtest_id → backtests.id (CASCADE) ───
ALTER TABLE "stress_test_runs" DROP CONSTRAINT IF EXISTS "stress_test_runs_backtest_id_backtests_id_fk";
ALTER TABLE "stress_test_runs" ADD CONSTRAINT "stress_test_runs_backtest_id_backtests_id_fk"
  FOREIGN KEY ("backtest_id") REFERENCES "backtests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── system_journal.strategy_id → strategies.id (SET NULL — preserve AI learning history) ───
ALTER TABLE "system_journal" DROP CONSTRAINT IF EXISTS "system_journal_strategy_id_strategies_id_fk";
ALTER TABLE "system_journal" ADD CONSTRAINT "system_journal_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── system_journal.backtest_id → backtests.id (SET NULL) ───
ALTER TABLE "system_journal" DROP CONSTRAINT IF EXISTS "system_journal_backtest_id_backtests_id_fk";
ALTER TABLE "system_journal" ADD CONSTRAINT "system_journal_backtest_id_backtests_id_fk"
  FOREIGN KEY ("backtest_id") REFERENCES "backtests"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── compliance_reviews.strategy_id → strategies.id (SET NULL — audit forensics) ───
ALTER TABLE "compliance_reviews" DROP CONSTRAINT IF EXISTS "compliance_reviews_strategy_id_strategies_id_fk";
ALTER TABLE "compliance_reviews" ADD CONSTRAINT "compliance_reviews_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── skip_decisions.strategy_id → strategies.id (SET NULL) ───
ALTER TABLE "skip_decisions" DROP CONSTRAINT IF EXISTS "skip_decisions_strategy_id_strategies_id_fk";
ALTER TABLE "skip_decisions" ADD CONSTRAINT "skip_decisions_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── strategy_graveyard.strategy_id → strategies.id (SET NULL — graveyard outlives strategy) ───
ALTER TABLE "strategy_graveyard" DROP CONSTRAINT IF EXISTS "strategy_graveyard_strategy_id_strategies_id_fk";
ALTER TABLE "strategy_graveyard" ADD CONSTRAINT "strategy_graveyard_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── tournament_results.backtest_id → backtests.id (SET NULL — preserve verdict history) ───
ALTER TABLE "tournament_results" DROP CONSTRAINT IF EXISTS "tournament_results_backtest_id_backtests_id_fk";
ALTER TABLE "tournament_results" ADD CONSTRAINT "tournament_results_backtest_id_backtests_id_fk"
  FOREIGN KEY ("backtest_id") REFERENCES "backtests"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── paper_sessions.strategy_id → strategies.id (SET NULL — preserve paper history) ───
ALTER TABLE "paper_sessions" DROP CONSTRAINT IF EXISTS "paper_sessions_strategy_id_strategies_id_fk";
ALTER TABLE "paper_sessions" ADD CONSTRAINT "paper_sessions_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── quantum_mc_runs.backtest_id → backtests.id (CASCADE) ───
ALTER TABLE "quantum_mc_runs" DROP CONSTRAINT IF EXISTS "quantum_mc_runs_backtest_id_backtests_id_fk";
ALTER TABLE "quantum_mc_runs" ADD CONSTRAINT "quantum_mc_runs_backtest_id_backtests_id_fk"
  FOREIGN KEY ("backtest_id") REFERENCES "backtests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── strategy_names.strategy_id → strategies.id (SET NULL — codename pool preserved) ───
ALTER TABLE "strategy_names" DROP CONSTRAINT IF EXISTS "strategy_names_strategy_id_strategies_id_fk";
ALTER TABLE "strategy_names" ADD CONSTRAINT "strategy_names_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── strategy_exports.strategy_id → strategies.id (CASCADE — exports meaningless without strategy) ───
ALTER TABLE "strategy_exports" DROP CONSTRAINT IF EXISTS "strategy_exports_strategy_id_strategies_id_fk";
ALTER TABLE "strategy_exports" ADD CONSTRAINT "strategy_exports_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── sqa_optimization_runs.backtest_id → backtests.id (CASCADE) ───
ALTER TABLE "sqa_optimization_runs" DROP CONSTRAINT IF EXISTS "sqa_optimization_runs_backtest_id_backtests_id_fk";
ALTER TABLE "sqa_optimization_runs" ADD CONSTRAINT "sqa_optimization_runs_backtest_id_backtests_id_fk"
  FOREIGN KEY ("backtest_id") REFERENCES "backtests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── sqa_optimization_runs.strategy_id → strategies.id (CASCADE) ───
ALTER TABLE "sqa_optimization_runs" DROP CONSTRAINT IF EXISTS "sqa_optimization_runs_strategy_id_strategies_id_fk";
ALTER TABLE "sqa_optimization_runs" ADD CONSTRAINT "sqa_optimization_runs_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── qubo_timing_runs.backtest_id → backtests.id (CASCADE) ───
ALTER TABLE "qubo_timing_runs" DROP CONSTRAINT IF EXISTS "qubo_timing_runs_backtest_id_backtests_id_fk";
ALTER TABLE "qubo_timing_runs" ADD CONSTRAINT "qubo_timing_runs_backtest_id_backtests_id_fk"
  FOREIGN KEY ("backtest_id") REFERENCES "backtests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── qubo_timing_runs.strategy_id → strategies.id (CASCADE) ───
ALTER TABLE "qubo_timing_runs" DROP CONSTRAINT IF EXISTS "qubo_timing_runs_strategy_id_strategies_id_fk";
ALTER TABLE "qubo_timing_runs" ADD CONSTRAINT "qubo_timing_runs_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── tensor_predictions.backtest_id → backtests.id (CASCADE) ───
ALTER TABLE "tensor_predictions" DROP CONSTRAINT IF EXISTS "tensor_predictions_backtest_id_backtests_id_fk";
ALTER TABLE "tensor_predictions" ADD CONSTRAINT "tensor_predictions_backtest_id_backtests_id_fk"
  FOREIGN KEY ("backtest_id") REFERENCES "backtests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── tensor_predictions.strategy_id → strategies.id (CASCADE) ───
ALTER TABLE "tensor_predictions" DROP CONSTRAINT IF EXISTS "tensor_predictions_strategy_id_strategies_id_fk";
ALTER TABLE "tensor_predictions" ADD CONSTRAINT "tensor_predictions_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── rl_training_runs.strategy_id → strategies.id (CASCADE) ───
ALTER TABLE "rl_training_runs" DROP CONSTRAINT IF EXISTS "rl_training_runs_strategy_id_strategies_id_fk";
ALTER TABLE "rl_training_runs" ADD CONSTRAINT "rl_training_runs_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── critic_optimization_runs.strategy_id → strategies.id (CASCADE) ───
ALTER TABLE "critic_optimization_runs" DROP CONSTRAINT IF EXISTS "critic_optimization_runs_strategy_id_strategies_id_fk";
ALTER TABLE "critic_optimization_runs" ADD CONSTRAINT "critic_optimization_runs_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── critic_optimization_runs.backtest_id → backtests.id (CASCADE) ───
ALTER TABLE "critic_optimization_runs" DROP CONSTRAINT IF EXISTS "critic_optimization_runs_backtest_id_backtests_id_fk";
ALTER TABLE "critic_optimization_runs" ADD CONSTRAINT "critic_optimization_runs_backtest_id_backtests_id_fk"
  FOREIGN KEY ("backtest_id") REFERENCES "backtests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── critic_candidates.strategy_id → strategies.id (CASCADE) ───
ALTER TABLE "critic_candidates" DROP CONSTRAINT IF EXISTS "critic_candidates_strategy_id_strategies_id_fk";
ALTER TABLE "critic_candidates" ADD CONSTRAINT "critic_candidates_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── critic_candidates.replay_backtest_id → backtests.id (SET NULL — keep candidate row) ───
ALTER TABLE "critic_candidates" DROP CONSTRAINT IF EXISTS "critic_candidates_replay_backtest_id_backtests_id_fk";
ALTER TABLE "critic_candidates" ADD CONSTRAINT "critic_candidates_replay_backtest_id_backtests_id_fk"
  FOREIGN KEY ("replay_backtest_id") REFERENCES "backtests"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── paper_session_feedback.strategy_id → strategies.id (SET NULL) ───
ALTER TABLE "paper_session_feedback" DROP CONSTRAINT IF EXISTS "paper_session_feedback_strategy_id_strategies_id_fk";
ALTER TABLE "paper_session_feedback" DROP CONSTRAINT IF EXISTS "paper_session_feedback_strategy_id_fkey";
ALTER TABLE "paper_session_feedback" ADD CONSTRAINT "paper_session_feedback_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── mutation_outcomes.strategy_id → strategies.id (SET NULL — preserve learning history) ───
ALTER TABLE "mutation_outcomes" DROP CONSTRAINT IF EXISTS "mutation_outcomes_strategy_id_strategies_id_fk";
ALTER TABLE "mutation_outcomes" ADD CONSTRAINT "mutation_outcomes_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
