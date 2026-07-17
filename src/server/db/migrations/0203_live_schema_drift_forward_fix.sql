-- 0203 (goalscan-r2 / Fable advisor ruling 2026-07-17): forward-fix for THREE
-- schema.ts-vs-live-DB drift victims found by scripts/check-live-schema-drift.ts
-- (110 tables / 1421 columns swept against the production Railway DB).
--
-- Root cause: migrations 0007 / 0118 / 0134 are journal-marked applied but their
-- DDL never executed on the production DB (out-of-band backfill class; per
-- tf-debugging A9 a journal-applied migration never re-runs, so fix FORWARD).
-- The 0134 gap was load-bearing: bias-state-service.ts's INSERT names
-- structure_state, so EVERY bias_state persist since 2026-05-24 threw
-- ("column does not exist") and was swallowed by a logger.warn — institutional
-- regime history silently stopped accumulating for ~2 months while
-- bias_engine.refreshed_10am_et kept auditing SUCCESS. This migration restarts
-- that persistence clock.
--
-- All statements idempotent (ADD COLUMN / CREATE TABLE / CREATE INDEX
-- IF NOT EXISTS); safe to re-apply; no-op on environments where 0007/0118/0134
-- genuinely executed. Nullable/additive only — no behavior flag needed (this
-- restores already-shipped features' persistence, it does not add behavior).

-- ── 1. bias_state.structure_state (originally 0134, Wave 25 W25.2) ───────────
ALTER TABLE bias_state
  ADD COLUMN IF NOT EXISTS structure_state JSONB;

CREATE INDEX IF NOT EXISTS bias_state_structure_state_idx
  ON bias_state (id)
  WHERE structure_state IS NOT NULL;

-- ── 2. backtest_matrix.correlations (originally 0007) ────────────────────────
ALTER TABLE backtest_matrix
  ADD COLUMN IF NOT EXISTS correlations JSONB;

-- ── 3. transcript_fetch_outcomes (originally 0118, W23G.4) ───────────────────
CREATE TABLE IF NOT EXISTS transcript_fetch_outcomes (
  id                BIGSERIAL PRIMARY KEY,
  video_id          TEXT        NOT NULL,
  outcome           TEXT        NOT NULL,
  attempt_count     SMALLINT    NOT NULL,
  total_duration_ms INT         NOT NULL,
  source_pass       TEXT        NOT NULL,
  source_query      TEXT        NULL,
  error_message     TEXT        NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcript_outcomes_created
  ON transcript_fetch_outcomes (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transcript_outcomes_outcome
  ON transcript_fetch_outcomes (outcome, created_at DESC);
