-- Migration 0053: Add result_extras JSONB column to backtests
-- Persists unpersisted Python engine outputs: governor, analytics, long_short_split,
-- bootstrap_ci_95, deflated_sharpe, recency_analysis, statistical_warnings,
-- confidence_intervals. Kept in one JSONB column to minimise schema churn.
ALTER TABLE backtests ADD COLUMN IF NOT EXISTS result_extras jsonb;
