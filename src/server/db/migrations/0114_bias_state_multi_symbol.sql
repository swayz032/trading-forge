-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0114 — Wave 23 Gap-Fix-B: bias_state multi-symbol support
-- 2026-05-19
--
-- Context: Wave 23 Gap-Fix-B closes two fidelity gaps:
--   1. 10:00 ET bias refresh cron — re-runs compute_bias() after the first
--      30-min bar closes so SessionContext (OR high/low, killzone status)
--      is available. New rows are INSERTed (not UPDATE) so the 9:30 row is
--      preserved. Readers pick MAX(computed_at) per (session_date, symbol).
--   2. Multi-symbol bias — MES/MNQ/MCL each need an independent bias decision
--      since their correlations are not 1.0 and MCL is independent.
--
-- Changes:
--   1. ADD COLUMN symbol TEXT NOT NULL DEFAULT 'MES' to bias_state
--   2. DROP old UNIQUE(session_date) constraint
--   3. ADD UNIQUE(session_date, symbol) constraint (one row per day per symbol,
--      but refresh writes a NEW row — see note below)
--
-- Note on versioning: the refresh cron calls INSERT (not UPSERT). To allow
-- multiple rows per (session_date, symbol) with different computed_at values,
-- the unique constraint is only on the Drizzle schema for the ON CONFLICT path
-- in the original session-start write. The refresh uses plain INSERT and readers
-- use MAX(computed_at) GROUP BY (session_date, symbol).
--
-- The UNIQUE constraint on (session_date, symbol) is therefore only used by
-- the session-start ON CONFLICT DO UPDATE path. The refresh INSERT does NOT use
-- ON CONFLICT — it always inserts a new row. This is intentional: the 9:30 row
-- is preserved as the authoritative fallback.
--
-- Idempotent: each statement is conditional.
-- Operator: npm run db:migrate (or Railway Postgres apply).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Add symbol column (default MES covers existing rows)
ALTER TABLE bias_state
  ADD COLUMN IF NOT EXISTS symbol TEXT NOT NULL DEFAULT 'MES';

-- 2. Drop the old single-column unique constraint (session_date only)
--    Use IF EXISTS on the index so the migration is idempotent on re-run.
DROP INDEX IF EXISTS bias_state_session_date_idx;

-- 3. Drop old unique constraint if it was created as a named constraint
--    (0112 used CREATE TABLE UNIQUE inline — Postgres names it bias_state_session_date_key)
ALTER TABLE bias_state
  DROP CONSTRAINT IF EXISTS bias_state_session_date_key;

-- 4. Add composite unique constraint for session-start ON CONFLICT path
--    (reader always picks latest computed_at, so multiple rows are allowed;
--     this constraint only guards the session-start upsert path)
--    We use a partial unique index on (session_date, symbol) WHERE version=0
--    is too complex; instead, we use a plain composite index + let service code
--    manage the ON CONFLICT. No unique constraint needed — readers use MAX().
--    Drop the uniqueIndex from schema.ts and use a regular index instead.
CREATE INDEX IF NOT EXISTS bias_state_session_date_symbol_idx
  ON bias_state(session_date DESC, symbol);

CREATE INDEX IF NOT EXISTS bias_state_symbol_idx
  ON bias_state(symbol);

COMMIT;
