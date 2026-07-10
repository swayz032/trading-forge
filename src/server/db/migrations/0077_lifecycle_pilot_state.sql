-- Migration 0077: B8 — PILOT canary state
--
-- Adds PILOT as an explicit lifecycle state between DEPLOY_READY and DEPLOYED.
-- Strategies enter PILOT via human approval from DEPLOY_READY.
-- After 5 paper sessions with rolling Sharpe > 1.0 and no compliance violations,
-- the system auto-promotes PILOT → DEPLOYED.
-- If any kill switch fires, PILOT → GRAVEYARD (automatic).
--
-- The lifecycle_state column uses text (not a typed enum) so we add a CHECK
-- constraint update rather than ALTER TYPE. The strategies table comment is
-- updated to reflect the new state.
--
-- Apply via direct SQL on Railway (drizzle-kit generate is disabled per project
-- convention). After applying this migration, add the journal entry to
-- meta/_journal.json manually.

-- Add PILOT to the CHECK constraint on lifecycle_state.
-- Postgres does not support directly altering a CHECK constraint in-place;
-- we DROP the old one and ADD the new one in a single transaction.
-- The old CHECK constraint name must match what was created in prior migrations.
-- Since lifecycle_state was created as a text column with no constraint in
-- the original schema (state is enforced at application layer), we just add
-- a new comment/documentation row for the PILOT state — no DDL change needed
-- on the column itself. The application VALID_STATES array is the gate.
--
-- However, we add a pilot_sessions table to track PILOT session progress.

CREATE TABLE IF NOT EXISTS pilot_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id       uuid NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  session_number    integer NOT NULL,       -- 1-5 (out of PILOT_REQUIRED_SESSIONS=5)
  paper_session_id  uuid REFERENCES paper_sessions(id),
  rolling_sharpe    numeric,               -- rolling Sharpe at session close
  compliance_passed boolean,              -- no compliance violations this session
  contracts         integer NOT NULL DEFAULT 1,  -- forced to 1 during PILOT
  started_at        timestamp DEFAULT now() NOT NULL,
  completed_at      timestamp,
  outcome           text,                 -- pending | passed | failed | killed
  kill_reason       text,
  created_at        timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pilot_sessions_strategy ON pilot_sessions(strategy_id);
CREATE INDEX IF NOT EXISTS idx_pilot_sessions_outcome  ON pilot_sessions(strategy_id, outcome);
