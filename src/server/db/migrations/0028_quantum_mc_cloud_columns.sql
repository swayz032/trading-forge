-- Migration 0027: Add cloud execution metadata columns to quantum_mc_runs
-- These columns are populated only when IBM QPU or Braket backend is used.
-- All columns are nullable — existing local-only runs are unaffected.

ALTER TABLE quantum_mc_runs
  ADD COLUMN IF NOT EXISTS cloud_provider       text,
  ADD COLUMN IF NOT EXISTS cloud_backend_name   text,
  ADD COLUMN IF NOT EXISTS cloud_job_id         text,
  ADD COLUMN IF NOT EXISTS cloud_qpu_time_seconds numeric,
  ADD COLUMN IF NOT EXISTS cloud_cost_dollars   numeric,
  ADD COLUMN IF NOT EXISTS cloud_region         text;

-- Add backendType column to quantum_mc_benchmarks for benchmark provenance tracking
ALTER TABLE quantum_mc_benchmarks
  ADD COLUMN IF NOT EXISTS backend_type text; -- local | ibm | braket | classical_fallback
