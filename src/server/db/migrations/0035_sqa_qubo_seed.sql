-- Migration 0035: Add seed column to sqa_optimization_runs and qubo_timing_runs
-- Purpose: Store the RNG seed passed to Python so each run can be exactly replayed.
-- Nullable integer — NULL for runs created before this migration.

ALTER TABLE sqa_optimization_runs ADD COLUMN IF NOT EXISTS seed integer;
ALTER TABLE qubo_timing_runs      ADD COLUMN IF NOT EXISTS seed integer;
