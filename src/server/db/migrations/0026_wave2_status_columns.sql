-- Migration 0026: Wave 2 — Add status columns for lifecycle tracking
--
-- Fixes 2.2 and 2.3: Add status text column (pending|running|completed|failed)
-- to MC, quantum MC, and all fire-and-forget quantum pipeline tables.
-- All columns default to 'pending' so existing rows are not broken.

ALTER TABLE monte_carlo_runs        ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE quantum_mc_runs         ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE sqa_optimization_runs   ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE qubo_timing_runs        ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE tensor_predictions      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE rl_training_runs        ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
