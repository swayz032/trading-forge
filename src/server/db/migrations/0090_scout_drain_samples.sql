-- Migration 0090: Scout Drain Samples (Pass 10 — Scout Observability Hardening)
--
-- Purpose: support the drain-rate watchdog (`scout-watchdog-service.ts`).
-- The watchdog needs to compute "scouted backlog count delta over the last
-- 2 hours" — the simplest deterministic source of that historical count
-- is a tiny self-populated sample table the watchdog appends to every
-- 30-min tick. The watchdog also auto-prunes rows older than 7 days, so
-- this table never grows unbounded.
--
-- Authority surface:
--   scout_drain_samples — pure observability. NEVER blocks the pipeline.
--                         Producer = scout-drain-stall-check cron only.
--                         Consumer = same cron, reading its own history.
--
-- Additive only: no destructive ops. CREATE TABLE IF NOT EXISTS pattern.
--
-- Apply via direct SQL on Railway (drizzle-kit broken for this repo):
--   node scripts/apply-scout-drain-samples-migration.mjs

CREATE TABLE IF NOT EXISTS scout_drain_samples (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sampled_at      timestamp NOT NULL DEFAULT NOW(),
  scouted_count   integer NOT NULL,                       -- system_journal status='scouted' AND signal_type='strategy_candidate' count
  pipeline_mode   text                                    -- ACTIVE | PAUSED | VACATION at sample time (informational)
);

-- Recency index — the watchdog only ever reads "samples newer than X" and
-- "samples older than 7 days for prune". Both are sampled_at scans.
CREATE INDEX IF NOT EXISTS idx_scout_drain_samples_sampled_at
  ON scout_drain_samples (sampled_at DESC);
