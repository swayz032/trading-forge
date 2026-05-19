-- Migration: 0038_referential_integrity_pine_version
-- Phase 5.2: Add ON DELETE CASCADE/SET NULL to existing FK constraints
-- Phase 5.3: Fix pine_version default from 'v6' to 'v5'
--
-- Most FK constraints already exist (created in migrations 0000–0022) but use
-- ON DELETE NO ACTION.  This migration drops and re-creates them with correct
-- cascade/set-null behaviour, after cleaning any orphan rows that would block
-- the tighter constraints.

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 1: Clean orphan rows that would violate FK constraints
-- ═══════════════════════════════════════════════════════════════════════════════

-- backtests referencing deleted strategies
DELETE FROM backtests WHERE strategy_id IS NOT NULL
  AND strategy_id NOT IN (SELECT id FROM strategies);

-- paper_sessions referencing deleted strategies (SET NULL path — keep session history)
UPDATE paper_sessions SET strategy_id = NULL
  WHERE strategy_id IS NOT NULL
  AND strategy_id NOT IN (SELECT id FROM strategies);

-- paper_trades referencing deleted sessions
DELETE FROM paper_trades WHERE session_id NOT IN (SELECT id FROM paper_sessions);

-- paper_positions referencing deleted sessions
DELETE FROM paper_positions WHERE session_id NOT IN (SELECT id FROM paper_sessions);

-- paper_signal_logs referencing deleted sessions
DELETE FROM paper_signal_logs WHERE session_id NOT IN (SELECT id FROM paper_sessions);

-- shadow_signals referencing deleted sessions
DELETE FROM shadow_signals WHERE session_id NOT IN (SELECT id FROM paper_sessions);

-- monte_carlo_runs referencing deleted backtests
DELETE FROM monte_carlo_runs WHERE backtest_id NOT IN (SELECT id FROM backtests);

-- stress_test_runs referencing deleted backtests
DELETE FROM stress_test_runs WHERE backtest_id NOT IN (SELECT id FROM backtests);

-- backtest_trades referencing deleted backtests
DELETE FROM backtest_trades WHERE backtest_id NOT IN (SELECT id FROM backtests);

-- walk_forward_windows referencing deleted backtests
DELETE FROM walk_forward_windows WHERE backtest_id NOT IN (SELECT id FROM backtests);

-- quantum_mc_runs referencing deleted backtests
DELETE FROM quantum_mc_runs WHERE backtest_id NOT IN (SELECT id FROM backtests);

-- sqa_optimization_runs referencing deleted backtests or strategies
DELETE FROM sqa_optimization_runs WHERE backtest_id NOT IN (SELECT id FROM backtests);
DELETE FROM sqa_optimization_runs WHERE strategy_id NOT IN (SELECT id FROM strategies);

-- qubo_timing_runs referencing deleted backtests or strategies
DELETE FROM qubo_timing_runs WHERE backtest_id NOT IN (SELECT id FROM backtests);
DELETE FROM qubo_timing_runs WHERE strategy_id NOT IN (SELECT id FROM strategies);

-- tensor_predictions referencing deleted backtests or strategies
DELETE FROM tensor_predictions WHERE backtest_id NOT IN (SELECT id FROM backtests);
DELETE FROM tensor_predictions WHERE strategy_id NOT IN (SELECT id FROM strategies);

-- rl_training_runs referencing deleted strategies
DELETE FROM rl_training_runs WHERE strategy_id NOT IN (SELECT id FROM strategies);

-- critic_optimization_runs referencing deleted strategies or backtests
DELETE FROM critic_optimization_runs WHERE strategy_id NOT IN (SELECT id FROM strategies);
DELETE FROM critic_optimization_runs WHERE backtest_id NOT IN (SELECT id FROM backtests);

-- critic_candidates referencing deleted runs or strategies
DELETE FROM critic_candidates WHERE run_id NOT IN (SELECT id FROM critic_optimization_runs);
DELETE FROM critic_candidates WHERE strategy_id NOT IN (SELECT id FROM strategies);

-- strategy_exports referencing deleted strategies
DELETE FROM strategy_exports WHERE strategy_id NOT IN (SELECT id FROM strategies);

-- strategy_export_artifacts referencing deleted exports
DELETE FROM strategy_export_artifacts WHERE export_id NOT IN (SELECT id FROM strategy_exports);

-- backtest_matrix referencing deleted strategies
DELETE FROM backtest_matrix WHERE strategy_id NOT IN (SELECT id FROM strategies);

-- system_journal soft refs — SET NULL for orphans
UPDATE system_journal SET strategy_id = NULL
  WHERE strategy_id IS NOT NULL
  AND strategy_id NOT IN (SELECT id FROM strategies);
UPDATE system_journal SET backtest_id = NULL
  WHERE backtest_id IS NOT NULL
  AND backtest_id NOT IN (SELECT id FROM backtests);

-- strategy_graveyard soft refs — SET NULL for orphans
UPDATE strategy_graveyard SET strategy_id = NULL
  WHERE strategy_id IS NOT NULL
  AND strategy_id NOT IN (SELECT id FROM strategies);

-- skip_decisions soft refs — SET NULL for orphans
UPDATE skip_decisions SET strategy_id = NULL
  WHERE strategy_id IS NOT NULL
  AND strategy_id NOT IN (SELECT id FROM strategies);

-- strategy_names soft refs — SET NULL for orphans
UPDATE strategy_names SET strategy_id = NULL
  WHERE strategy_id IS NOT NULL
  AND strategy_id NOT IN (SELECT id FROM strategies);

-- mutation_outcomes soft refs — SET NULL for orphans
UPDATE mutation_outcomes SET strategy_id = NULL
  WHERE strategy_id IS NOT NULL
  AND strategy_id NOT IN (SELECT id FROM strategies);

-- compliance_reviews soft refs
UPDATE compliance_reviews SET strategy_id = NULL
  WHERE strategy_id IS NOT NULL
  AND strategy_id NOT IN (SELECT id FROM strategies);
UPDATE compliance_reviews SET ruleset_id = NULL
  WHERE ruleset_id IS NOT NULL
  AND ruleset_id NOT IN (SELECT id FROM compliance_rulesets);

-- compliance_drift_log soft refs
UPDATE compliance_drift_log SET ruleset_id = NULL
  WHERE ruleset_id IS NOT NULL
  AND ruleset_id NOT IN (SELECT id FROM compliance_rulesets);

-- tournament_results soft refs
UPDATE tournament_results SET backtest_id = NULL
  WHERE backtest_id IS NOT NULL
  AND backtest_id NOT IN (SELECT id FROM backtests);

-- quantum_mc_benchmarks refs
DELETE FROM quantum_mc_benchmarks WHERE quantum_run_id NOT IN (SELECT id FROM quantum_mc_runs);
UPDATE quantum_mc_benchmarks SET classical_run_id = NULL
  WHERE classical_run_id IS NOT NULL
  AND classical_run_id NOT IN (SELECT id FROM monte_carlo_runs);

-- system_parameter_history refs
DELETE FROM system_parameter_history WHERE param_id NOT IN (SELECT id FROM system_parameters);

-- critic_candidates replay_backtest_id soft ref
UPDATE critic_candidates SET replay_backtest_id = NULL
  WHERE replay_backtest_id IS NOT NULL
  AND replay_backtest_id NOT IN (SELECT id FROM backtests);


-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 1.5: Drop duplicate _fkey constraints created by inline REFERENCES syntax
-- (migrations 0004, 0015, 0018, 0019, 0022 used inline REFERENCES which creates
--  auto-named _fkey constraints alongside the Drizzle-named _fk ones)
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE "critic_candidates" DROP CONSTRAINT IF EXISTS "critic_candidates_replay_backtest_id_fkey";
ALTER TABLE "critic_candidates" DROP CONSTRAINT IF EXISTS "critic_candidates_run_id_fkey";
ALTER TABLE "critic_candidates" DROP CONSTRAINT IF EXISTS "critic_candidates_strategy_id_fkey";
ALTER TABLE "critic_optimization_runs" DROP CONSTRAINT IF EXISTS "critic_optimization_runs_backtest_id_fkey";
ALTER TABLE "critic_optimization_runs" DROP CONSTRAINT IF EXISTS "critic_optimization_runs_strategy_id_fkey";
ALTER TABLE "mutation_outcomes" DROP CONSTRAINT IF EXISTS "mutation_outcomes_strategy_id_fkey";
ALTER TABLE "paper_positions" DROP CONSTRAINT IF EXISTS "paper_positions_session_id_fkey";
ALTER TABLE "paper_sessions" DROP CONSTRAINT IF EXISTS "paper_sessions_strategy_id_fkey";
ALTER TABLE "paper_signal_logs" DROP CONSTRAINT IF EXISTS "paper_signal_logs_session_id_fkey";
ALTER TABLE "paper_signal_log" DROP CONSTRAINT IF EXISTS "paper_signal_log_session_id_fkey";
ALTER TABLE "paper_trades" DROP CONSTRAINT IF EXISTS "paper_trades_session_id_fkey";
ALTER TABLE "quantum_mc_benchmarks" DROP CONSTRAINT IF EXISTS "quantum_mc_benchmarks_classical_run_id_fkey";
ALTER TABLE "quantum_mc_benchmarks" DROP CONSTRAINT IF EXISTS "quantum_mc_benchmarks_quantum_run_id_fkey";
ALTER TABLE "quantum_mc_runs" DROP CONSTRAINT IF EXISTS "quantum_mc_runs_backtest_id_fkey";
ALTER TABLE "qubo_timing_runs" DROP CONSTRAINT IF EXISTS "qubo_timing_runs_backtest_id_fkey";
ALTER TABLE "qubo_timing_runs" DROP CONSTRAINT IF EXISTS "qubo_timing_runs_strategy_id_fkey";
ALTER TABLE "rl_training_runs" DROP CONSTRAINT IF EXISTS "rl_training_runs_strategy_id_fkey";
ALTER TABLE "shadow_signals" DROP CONSTRAINT IF EXISTS "shadow_signals_session_id_fkey";
ALTER TABLE "sqa_optimization_runs" DROP CONSTRAINT IF EXISTS "sqa_optimization_runs_backtest_id_fkey";
ALTER TABLE "sqa_optimization_runs" DROP CONSTRAINT IF EXISTS "sqa_optimization_runs_strategy_id_fkey";
ALTER TABLE "strategy_export_artifacts" DROP CONSTRAINT IF EXISTS "strategy_export_artifacts_export_id_fkey";
ALTER TABLE "strategy_exports" DROP CONSTRAINT IF EXISTS "strategy_exports_strategy_id_fkey";
ALTER TABLE "strategy_names" DROP CONSTRAINT IF EXISTS "strategy_names_strategy_id_fkey";
ALTER TABLE "tensor_predictions" DROP CONSTRAINT IF EXISTS "tensor_predictions_backtest_id_fkey";
ALTER TABLE "tensor_predictions" DROP CONSTRAINT IF EXISTS "tensor_predictions_strategy_id_fkey";
ALTER TABLE "walk_forward_windows" DROP CONSTRAINT IF EXISTS "walk_forward_windows_backtest_id_fkey";


-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 2: Drop existing FK constraints and re-create with ON DELETE CASCADE/SET NULL
-- ═══════════════════════════════════════════════════════════════════════════════
-- Pattern: child tables that are meaningless without parent → CASCADE
--          soft/optional references                       → SET NULL

-- ─── backtests.strategy_id → strategies.id (CASCADE — backtest belongs to strategy) ───
ALTER TABLE "backtests" DROP CONSTRAINT IF EXISTS "backtests_strategy_id_strategies_id_fk";
ALTER TABLE "backtests" ADD CONSTRAINT "backtests_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── backtest_matrix.strategy_id → strategies.id (CASCADE) ───
ALTER TABLE "backtest_matrix" DROP CONSTRAINT IF EXISTS "backtest_matrix_strategy_id_strategies_id_fk";
ALTER TABLE "backtest_matrix" ADD CONSTRAINT "backtest_matrix_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── backtest_trades.backtest_id → backtests.id (CASCADE — already exists, ensure) ───
ALTER TABLE "backtest_trades" DROP CONSTRAINT IF EXISTS "backtest_trades_backtest_id_backtests_id_fk";
ALTER TABLE "backtest_trades" ADD CONSTRAINT "backtest_trades_backtest_id_backtests_id_fk"
  FOREIGN KEY ("backtest_id") REFERENCES "backtests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── backtest_trades.matrix_id → backtest_matrix.id (SET NULL — optional ref) ───
ALTER TABLE "backtest_trades" DROP CONSTRAINT IF EXISTS "backtest_trades_matrix_id_backtest_matrix_id_fk";
ALTER TABLE "backtest_trades" ADD CONSTRAINT "backtest_trades_matrix_id_backtest_matrix_id_fk"
  FOREIGN KEY ("matrix_id") REFERENCES "backtest_matrix"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- ─── monte_carlo_runs.backtest_id → backtests.id (CASCADE) ───
ALTER TABLE "monte_carlo_runs" DROP CONSTRAINT IF EXISTS "monte_carlo_runs_backtest_id_backtests_id_fk";
ALTER TABLE "monte_carlo_runs" ADD CONSTRAINT "monte_carlo_runs_backtest_id_backtests_id_fk"
  FOREIGN KEY ("backtest_id") REFERENCES "backtests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── stress_test_runs.backtest_id → backtests.id (CASCADE) ───
ALTER TABLE "stress_test_runs" DROP CONSTRAINT IF EXISTS "stress_test_runs_backtest_id_backtests_id_fk";
ALTER TABLE "stress_test_runs" ADD CONSTRAINT "stress_test_runs_backtest_id_backtests_id_fk"
  FOREIGN KEY ("backtest_id") REFERENCES "backtests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── walk_forward_windows.backtest_id → backtests.id (CASCADE) ───
ALTER TABLE "walk_forward_windows" DROP CONSTRAINT IF EXISTS "walk_forward_windows_backtest_id_backtests_id_fk";
ALTER TABLE "walk_forward_windows" ADD CONSTRAINT "walk_forward_windows_backtest_id_backtests_id_fk"
  FOREIGN KEY ("backtest_id") REFERENCES "backtests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── paper_sessions.strategy_id → strategies.id (SET NULL — keep session history) ───
ALTER TABLE "paper_sessions" DROP CONSTRAINT IF EXISTS "paper_sessions_strategy_id_strategies_id_fk";
ALTER TABLE "paper_sessions" ADD CONSTRAINT "paper_sessions_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- ─── paper_trades.session_id → paper_sessions.id (CASCADE — already exists, ensure) ───
ALTER TABLE "paper_trades" DROP CONSTRAINT IF EXISTS "paper_trades_session_id_paper_sessions_id_fk";
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_session_id_paper_sessions_id_fk"
  FOREIGN KEY ("session_id") REFERENCES "paper_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── paper_positions.session_id → paper_sessions.id (CASCADE — already exists, ensure) ───
ALTER TABLE "paper_positions" DROP CONSTRAINT IF EXISTS "paper_positions_session_id_paper_sessions_id_fk";
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_session_id_paper_sessions_id_fk"
  FOREIGN KEY ("session_id") REFERENCES "paper_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── paper_signal_logs.session_id → paper_sessions.id (CASCADE) ───
ALTER TABLE "paper_signal_logs" DROP CONSTRAINT IF EXISTS "paper_signal_logs_session_id_paper_sessions_id_fk";
ALTER TABLE "paper_signal_logs" ADD CONSTRAINT "paper_signal_logs_session_id_paper_sessions_id_fk"
  FOREIGN KEY ("session_id") REFERENCES "paper_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── shadow_signals.session_id → paper_sessions.id (CASCADE) ───
ALTER TABLE "shadow_signals" DROP CONSTRAINT IF EXISTS "shadow_signals_session_id_paper_sessions_id_fk";
ALTER TABLE "shadow_signals" ADD CONSTRAINT "shadow_signals_session_id_paper_sessions_id_fk"
  FOREIGN KEY ("session_id") REFERENCES "paper_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── quantum_mc_runs.backtest_id → backtests.id (CASCADE) ───
ALTER TABLE "quantum_mc_runs" DROP CONSTRAINT IF EXISTS "quantum_mc_runs_backtest_id_backtests_id_fk";
ALTER TABLE "quantum_mc_runs" ADD CONSTRAINT "quantum_mc_runs_backtest_id_backtests_id_fk"
  FOREIGN KEY ("backtest_id") REFERENCES "backtests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── quantum_mc_benchmarks.quantum_run_id → quantum_mc_runs.id (CASCADE) ───
ALTER TABLE "quantum_mc_benchmarks" DROP CONSTRAINT IF EXISTS "quantum_mc_benchmarks_quantum_run_id_quantum_mc_runs_id_fk";
ALTER TABLE "quantum_mc_benchmarks" ADD CONSTRAINT "quantum_mc_benchmarks_quantum_run_id_quantum_mc_runs_id_fk"
  FOREIGN KEY ("quantum_run_id") REFERENCES "quantum_mc_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── quantum_mc_benchmarks.classical_run_id → monte_carlo_runs.id (SET NULL) ───
ALTER TABLE "quantum_mc_benchmarks" DROP CONSTRAINT IF EXISTS "quantum_mc_benchmarks_classical_run_id_monte_carlo_runs_id_fk";
ALTER TABLE "quantum_mc_benchmarks" ADD CONSTRAINT "quantum_mc_benchmarks_classical_run_id_monte_carlo_runs_id_fk"
  FOREIGN KEY ("classical_run_id") REFERENCES "monte_carlo_runs"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- ─── sqa_optimization_runs.backtest_id → backtests.id (CASCADE) ───
ALTER TABLE "sqa_optimization_runs" DROP CONSTRAINT IF EXISTS "sqa_optimization_runs_backtest_id_backtests_id_fk";
ALTER TABLE "sqa_optimization_runs" ADD CONSTRAINT "sqa_optimization_runs_backtest_id_backtests_id_fk"
  FOREIGN KEY ("backtest_id") REFERENCES "backtests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── sqa_optimization_runs.strategy_id → strategies.id (CASCADE) ───
ALTER TABLE "sqa_optimization_runs" DROP CONSTRAINT IF EXISTS "sqa_optimization_runs_strategy_id_strategies_id_fk";
ALTER TABLE "sqa_optimization_runs" ADD CONSTRAINT "sqa_optimization_runs_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── qubo_timing_runs.backtest_id → backtests.id (CASCADE) ───
ALTER TABLE "qubo_timing_runs" DROP CONSTRAINT IF EXISTS "qubo_timing_runs_backtest_id_backtests_id_fk";
ALTER TABLE "qubo_timing_runs" ADD CONSTRAINT "qubo_timing_runs_backtest_id_backtests_id_fk"
  FOREIGN KEY ("backtest_id") REFERENCES "backtests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── qubo_timing_runs.strategy_id → strategies.id (CASCADE) ───
ALTER TABLE "qubo_timing_runs" DROP CONSTRAINT IF EXISTS "qubo_timing_runs_strategy_id_strategies_id_fk";
ALTER TABLE "qubo_timing_runs" ADD CONSTRAINT "qubo_timing_runs_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── tensor_predictions.backtest_id → backtests.id (CASCADE) ───
ALTER TABLE "tensor_predictions" DROP CONSTRAINT IF EXISTS "tensor_predictions_backtest_id_backtests_id_fk";
ALTER TABLE "tensor_predictions" ADD CONSTRAINT "tensor_predictions_backtest_id_backtests_id_fk"
  FOREIGN KEY ("backtest_id") REFERENCES "backtests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── tensor_predictions.strategy_id → strategies.id (CASCADE) ───
ALTER TABLE "tensor_predictions" DROP CONSTRAINT IF EXISTS "tensor_predictions_strategy_id_strategies_id_fk";
ALTER TABLE "tensor_predictions" ADD CONSTRAINT "tensor_predictions_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── rl_training_runs.strategy_id → strategies.id (CASCADE) ───
ALTER TABLE "rl_training_runs" DROP CONSTRAINT IF EXISTS "rl_training_runs_strategy_id_strategies_id_fk";
ALTER TABLE "rl_training_runs" ADD CONSTRAINT "rl_training_runs_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── critic_optimization_runs.strategy_id → strategies.id (CASCADE) ───
ALTER TABLE "critic_optimization_runs" DROP CONSTRAINT IF EXISTS "critic_optimization_runs_strategy_id_strategies_id_fk";
ALTER TABLE "critic_optimization_runs" ADD CONSTRAINT "critic_optimization_runs_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── critic_optimization_runs.backtest_id → backtests.id (CASCADE) ───
ALTER TABLE "critic_optimization_runs" DROP CONSTRAINT IF EXISTS "critic_optimization_runs_backtest_id_backtests_id_fk";
ALTER TABLE "critic_optimization_runs" ADD CONSTRAINT "critic_optimization_runs_backtest_id_backtests_id_fk"
  FOREIGN KEY ("backtest_id") REFERENCES "backtests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── critic_candidates.run_id → critic_optimization_runs.id (CASCADE — already exists, ensure) ───
ALTER TABLE "critic_candidates" DROP CONSTRAINT IF EXISTS "critic_candidates_run_id_critic_optimization_runs_id_fk";
ALTER TABLE "critic_candidates" ADD CONSTRAINT "critic_candidates_run_id_critic_optimization_runs_id_fk"
  FOREIGN KEY ("run_id") REFERENCES "critic_optimization_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── critic_candidates.strategy_id → strategies.id (CASCADE) ───
ALTER TABLE "critic_candidates" DROP CONSTRAINT IF EXISTS "critic_candidates_strategy_id_strategies_id_fk";
ALTER TABLE "critic_candidates" ADD CONSTRAINT "critic_candidates_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── critic_candidates.replay_backtest_id → backtests.id (SET NULL) ───
ALTER TABLE "critic_candidates" DROP CONSTRAINT IF EXISTS "critic_candidates_replay_backtest_id_backtests_id_fk";
ALTER TABLE "critic_candidates" ADD CONSTRAINT "critic_candidates_replay_backtest_id_backtests_id_fk"
  FOREIGN KEY ("replay_backtest_id") REFERENCES "backtests"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- ─── strategy_exports.strategy_id → strategies.id (CASCADE) ───
ALTER TABLE "strategy_exports" DROP CONSTRAINT IF EXISTS "strategy_exports_strategy_id_strategies_id_fk";
ALTER TABLE "strategy_exports" ADD CONSTRAINT "strategy_exports_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── strategy_export_artifacts.export_id → strategy_exports.id (CASCADE — already exists, ensure) ───
ALTER TABLE "strategy_export_artifacts" DROP CONSTRAINT IF EXISTS "strategy_export_artifacts_export_id_strategy_exports_id_fk";
ALTER TABLE "strategy_export_artifacts" ADD CONSTRAINT "strategy_export_artifacts_export_id_strategy_exports_id_fk"
  FOREIGN KEY ("export_id") REFERENCES "strategy_exports"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── strategy_names.strategy_id → strategies.id (SET NULL — keep name pool) ───
ALTER TABLE "strategy_names" DROP CONSTRAINT IF EXISTS "strategy_names_strategy_id_strategies_id_fk";
ALTER TABLE "strategy_names" ADD CONSTRAINT "strategy_names_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- ─── system_journal.strategy_id → strategies.id (SET NULL — preserve journal history) ───
ALTER TABLE "system_journal" DROP CONSTRAINT IF EXISTS "system_journal_strategy_id_strategies_id_fk";
ALTER TABLE "system_journal" ADD CONSTRAINT "system_journal_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- ─── system_journal.backtest_id → backtests.id (SET NULL — preserve journal history) ───
ALTER TABLE "system_journal" DROP CONSTRAINT IF EXISTS "system_journal_backtest_id_backtests_id_fk";
ALTER TABLE "system_journal" ADD CONSTRAINT "system_journal_backtest_id_backtests_id_fk"
  FOREIGN KEY ("backtest_id") REFERENCES "backtests"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- ─── strategy_graveyard.strategy_id → strategies.id (SET NULL — graveyard is the archive) ───
ALTER TABLE "strategy_graveyard" DROP CONSTRAINT IF EXISTS "strategy_graveyard_strategy_id_strategies_id_fk";
ALTER TABLE "strategy_graveyard" ADD CONSTRAINT "strategy_graveyard_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- ─── skip_decisions.strategy_id → strategies.id (SET NULL — keep skip history) ───
ALTER TABLE "skip_decisions" DROP CONSTRAINT IF EXISTS "skip_decisions_strategy_id_strategies_id_fk";
ALTER TABLE "skip_decisions" ADD CONSTRAINT "skip_decisions_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- ─── mutation_outcomes.strategy_id → strategies.id (SET NULL — keep learning data) ───
ALTER TABLE "mutation_outcomes" DROP CONSTRAINT IF EXISTS "mutation_outcomes_strategy_id_strategies_id_fk";
ALTER TABLE "mutation_outcomes" ADD CONSTRAINT "mutation_outcomes_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- ─── tournament_results.backtest_id → backtests.id (SET NULL) ───
ALTER TABLE "tournament_results" DROP CONSTRAINT IF EXISTS "tournament_results_backtest_id_backtests_id_fk";
ALTER TABLE "tournament_results" ADD CONSTRAINT "tournament_results_backtest_id_backtests_id_fk"
  FOREIGN KEY ("backtest_id") REFERENCES "backtests"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- ─── compliance_reviews.strategy_id → strategies.id (SET NULL) ───
ALTER TABLE "compliance_reviews" DROP CONSTRAINT IF EXISTS "compliance_reviews_strategy_id_strategies_id_fk";
ALTER TABLE "compliance_reviews" ADD CONSTRAINT "compliance_reviews_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- ─── compliance_reviews.ruleset_id → compliance_rulesets.id (SET NULL) ───
ALTER TABLE "compliance_reviews" DROP CONSTRAINT IF EXISTS "compliance_reviews_ruleset_id_compliance_rulesets_id_fk";
ALTER TABLE "compliance_reviews" ADD CONSTRAINT "compliance_reviews_ruleset_id_compliance_rulesets_id_fk"
  FOREIGN KEY ("ruleset_id") REFERENCES "compliance_rulesets"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- ─── compliance_drift_log.ruleset_id → compliance_rulesets.id (SET NULL) ───
ALTER TABLE "compliance_drift_log" DROP CONSTRAINT IF EXISTS "compliance_drift_log_ruleset_id_compliance_rulesets_id_fk";
ALTER TABLE "compliance_drift_log" ADD CONSTRAINT "compliance_drift_log_ruleset_id_compliance_rulesets_id_fk"
  FOREIGN KEY ("ruleset_id") REFERENCES "compliance_rulesets"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- ─── system_parameter_history.param_id → system_parameters.id (CASCADE) ───
ALTER TABLE "system_parameter_history" DROP CONSTRAINT IF EXISTS "system_parameter_history_param_id_system_parameters_id_fk";
ALTER TABLE "system_parameter_history" ADD CONSTRAINT "system_parameter_history_param_id_system_parameters_id_fk"
  FOREIGN KEY ("param_id") REFERENCES "system_parameters"("id") ON DELETE CASCADE ON UPDATE NO ACTION;


-- ─── paper_session_feedback.strategy_id → strategies.id (SET NULL) ───
ALTER TABLE "paper_session_feedback" DROP CONSTRAINT IF EXISTS "paper_session_feedback_strategy_id_strategies_id_fk";
-- The inline REFERENCES in 0037 created a constraint with an auto-generated name.
-- Drop it by the Postgres auto-naming convention too:
ALTER TABLE "paper_session_feedback" DROP CONSTRAINT IF EXISTS "paper_session_feedback_strategy_id_fkey";
ALTER TABLE "paper_session_feedback" ADD CONSTRAINT "paper_session_feedback_strategy_id_strategies_id_fk"
  FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE NO ACTION;


-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 3 (Phase 5.3): Fix pine_version default from 'v6' to 'v5'
-- The Pine compiler emits v5 but DB defaults were set to 'v6'.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE "strategy_exports" ALTER COLUMN "pine_version" SET DEFAULT 'v5';
ALTER TABLE "strategy_export_artifacts" ALTER COLUMN "pine_version" SET DEFAULT 'v5';
