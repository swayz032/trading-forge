-- 0183_agent_jobs_started_at.sql
--
-- Fix 3b (2026-06-29): agent_jobs.started_at — accurate stale-job sweeper threshold.
-- The stale-pending-sweeper used created_at as a proxy for runtime duration, causing
-- false failures: a job created at T=0 but starting at T=80min is swept at T=90min
-- (only 10min into real work). This column records actual pickup/execution start time.
-- The sweeper now uses COALESCE(started_at, created_at) so the threshold is measured
-- from actual work-start, not job creation, preventing premature failure marking.
--
-- Idempotent via ADD COLUMN IF NOT EXISTS (safe on re-run after restart).

ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NULL;
