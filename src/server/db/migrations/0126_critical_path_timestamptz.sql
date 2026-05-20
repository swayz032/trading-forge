-- Migration 0126: TIMESTAMP → TIMESTAMPTZ for critical-path columns.
--
-- F-5 fix (bounded scope): only the 8 columns that participate in cross-table
-- date-boundary queries and audit replay. The wider TZ-correctness sweep is
-- intentionally deferred to a separate migration so this one can be reviewed
-- as a single semantic change.
--
-- Columns converted (TIMESTAMP WITHOUT TIME ZONE → TIMESTAMP WITH TIME ZONE):
--   • paper_trades.entry_time
--   • paper_trades.exit_time
--   • audit_log.created_at
--   • lifecycle_transitions.created_at
--   • paper_sessions.started_at
--   • paper_sessions.stopped_at
--   • backtests.start_date
--   • backtests.end_date
--
-- Conversion is loss-free: existing values are interpreted as UTC (the implicit
-- convention used by the writers throughout the codebase). If a writer was
-- ever producing local time, this migration is the right place to find that
-- bug — values will shift by the offset and fail replay tests.
--
-- HIGH RISK: this migration rewrites every row of paper_trades + audit_log.
-- Operator-only apply. Take a fresh backup before running.
--
-- Idempotent: the AT TIME ZONE 'UTC' cast is a no-op on columns already TZ-aware,
-- but Postgres will still execute it. The DO-block guards make it safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── paper_trades.entry_time / exit_time ──────────────────────────────────────
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'paper_trades' AND column_name = 'entry_time')
     = 'timestamp without time zone' THEN
    ALTER TABLE paper_trades
      ALTER COLUMN entry_time TYPE TIMESTAMPTZ USING (entry_time AT TIME ZONE 'UTC'),
      ALTER COLUMN exit_time  TYPE TIMESTAMPTZ USING (exit_time  AT TIME ZONE 'UTC');
  END IF;
END $$;

-- ── audit_log.created_at ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'audit_log' AND column_name = 'created_at')
     = 'timestamp without time zone' THEN
    ALTER TABLE audit_log
      ALTER COLUMN created_at TYPE TIMESTAMPTZ USING (created_at AT TIME ZONE 'UTC');
  END IF;
END $$;

-- ── lifecycle_transitions.created_at ─────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'lifecycle_transitions' AND column_name = 'created_at')
     = 'timestamp without time zone' THEN
    ALTER TABLE lifecycle_transitions
      ALTER COLUMN created_at TYPE TIMESTAMPTZ USING (created_at AT TIME ZONE 'UTC');
  END IF;
END $$;

-- ── paper_sessions.started_at / stopped_at ───────────────────────────────────
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'paper_sessions' AND column_name = 'started_at')
     = 'timestamp without time zone' THEN
    ALTER TABLE paper_sessions
      ALTER COLUMN started_at TYPE TIMESTAMPTZ USING (started_at AT TIME ZONE 'UTC'),
      ALTER COLUMN stopped_at TYPE TIMESTAMPTZ USING (stopped_at AT TIME ZONE 'UTC');
  END IF;
END $$;

-- ── backtests.start_date / end_date ──────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'backtests' AND column_name = 'start_date')
     = 'timestamp without time zone' THEN
    ALTER TABLE backtests
      ALTER COLUMN start_date TYPE TIMESTAMPTZ USING (start_date AT TIME ZONE 'UTC'),
      ALTER COLUMN end_date   TYPE TIMESTAMPTZ USING (end_date   AT TIME ZONE 'UTC');
  END IF;
END $$;

COMMIT;
