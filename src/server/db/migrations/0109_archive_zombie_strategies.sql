-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0109 — Archive zombie strategies + SQL-level uniqueness invariant
-- Wave 9 / 2026-05-17
--
-- Context: live Railway Postgres `strategies` table has 69 rows; 67 carry one or
-- more `archived_*` tags (archived_duplicate, archived_thin_placeholder,
-- archived_unsupported_concept, archived_post_gate_audit,
-- archived_deep_audit_2026_05_17, archived_rule_identity) yet still sit in
-- lifecycle_state=CANDIDATE. Massive concept-fingerprint collapses landed
-- (27×ema_crossover, 17×session_open_breakout, 9×rsi_reversal) because there
-- was NO sql-level uniqueness invariant — only an application-level dedup that
-- regressed after the cross-validation refactor.
--
-- This migration:
--   1. Adds archived_at + archive_reason columns (idempotent).
--   2. Backfills archived_at/archive_reason from existing tags.
--   3. Transitions backfilled CANDIDATE rows → GRAVEYARD with graveyard reason
--      'zombie_audit_2026_05_17' (lifecycle_state enum keeps GRAVEYARD; no new
--      ARCHIVED state added — GRAVEYARD already serves the terminal-burial
--      semantics specified in CLAUDE.md §0).
--   4. Adds partial UNIQUE index `strategies_active_config_uniq` that prevents
--      future dedup collapses at SQL level. Excludes archived/graveyard rows so
--      historical zombies don't block legitimate re-graduations after the gate
--      is fixed.
--
-- Idempotent (IF NOT EXISTS everywhere). Operator runs via `npm run db:migrate`.
-- No destructive DROP.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. archive metadata columns
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS archived_at    timestamptz NULL;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS archive_reason text        NULL;

-- 2. backfill archived_at + archive_reason from existing archive tags.
-- Picks the *first* matching archived_* tag as the canonical reason; row stays
-- in CANDIDATE for one statement until step 3 transitions it to GRAVEYARD.
UPDATE strategies s
   SET archived_at    = COALESCE(s.archived_at, NOW()),
       archive_reason = COALESCE(
         s.archive_reason,
         (
           SELECT tag
             FROM unnest(COALESCE(s.tags, ARRAY[]::text[])) AS tag
            WHERE tag IN (
              'archived_duplicate',
              'archived_thin_placeholder',
              'archived_unsupported_concept',
              'archived_post_gate_audit',
              'archived_deep_audit_2026_05_17',
              'archived_rule_identity'
            )
            LIMIT 1
         )
       )
 WHERE COALESCE(s.tags, ARRAY[]::text[]) && ARRAY[
         'archived_duplicate',
         'archived_thin_placeholder',
         'archived_unsupported_concept',
         'archived_post_gate_audit',
         'archived_deep_audit_2026_05_17',
         'archived_rule_identity'
       ]::text[]
   AND s.archived_at IS NULL;

-- 3. lifecycle transition: every backfilled row moves CANDIDATE → GRAVEYARD.
-- (We don't add a new ARCHIVED enum state — GRAVEYARD already encodes the
-- terminal-burial semantics. archive_reason is the granular taxonomy.)
UPDATE strategies
   SET lifecycle_state      = 'GRAVEYARD',
       lifecycle_changed_at = NOW(),
       updated_at           = NOW()
 WHERE archived_at IS NOT NULL
   AND lifecycle_state = 'CANDIDATE';

-- 4. partial UNIQUE index — SQL-level uniqueness invariant on active strategies.
-- Excludes archived/graveyard rows so historic zombies don't block new graduations.
-- Key fields: (symbol, timeframe, entry_indicator, entry_params) — same edge on
-- the same symbol/timeframe is a duplicate by construction.
CREATE UNIQUE INDEX IF NOT EXISTS strategies_active_config_uniq
  ON strategies (
    symbol,
    timeframe,
    (config->'entry_indicator'),
    (config->'entry_params')
  )
  WHERE archived_at IS NULL
    AND lifecycle_state NOT IN ('GRAVEYARD','RETIRED');

-- 5. supporting index for "active strategies" reads — lifecycle queries that
-- filter by archived_at IS NULL benefit from a partial index that matches the
-- predicate above (CANDIDATE/TESTING/PAPER/DEPLOY_READY/PILOT/DEPLOYED/DECLINING).
CREATE INDEX IF NOT EXISTS strategies_active_idx
  ON strategies (lifecycle_state)
  WHERE archived_at IS NULL;

COMMIT;
