-- Migration 0181: carter_issues — persistent store for the Carter proactive issue watcher
-- Boot-migration-runner keyed on meta/_journal.json idx 184 / tag 0181_carter_issues
-- Wave 4 backend, 2026-06-28
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS
-- Proved idempotent by pglite dry-run (applied twice, no error on second run).

CREATE TABLE IF NOT EXISTS carter_issues (
  id           BIGSERIAL PRIMARY KEY,
  issue_key    TEXT NOT NULL UNIQUE,          -- stable per-issue-class identifier (e.g. "alert:rl_kill_switch:strat-123")
  severity     TEXT NOT NULL,                 -- 'critical' | 'warning' | 'info'
  title        TEXT NOT NULL,
  detail       TEXT,                          -- optional one-line human description
  source_event TEXT,                          -- SSE event name or 'health_poll' that triggered this issue
  first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved     BOOLEAN NOT NULL DEFAULT false,
  resolved_at  TIMESTAMPTZ
);

-- Fast lookup for open issues sorted by severity (served by listOpenIssues())
CREATE INDEX IF NOT EXISTS carter_issues_open_idx ON carter_issues (resolved, severity);
