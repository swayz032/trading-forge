-- Wave hardening 2026-06-22: separate mutable agent job state from the
-- append-only audit_log table (migration 0058 installs a BEFORE UPDATE OR
-- DELETE trigger that raises 'audit_log is append-only').  agent.ts was
-- updating audit_log rows to track job completion — those UPDATEs silently
-- threw, leaving every agent job stuck at "pending" forever.
--
-- This table holds the mutable lifecycle state. audit_log continues to receive
-- append-only immutable event rows for the audit trail.
--
-- NO trigger on this table — mutations are the whole point.
-- Applied by boot-migration-runner on next deploy.

CREATE TABLE IF NOT EXISTS agent_jobs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action         TEXT NOT NULL,
  strategy_id    UUID,
  status         TEXT NOT NULL DEFAULT 'pending',
  input          JSONB,
  result         JSONB,
  error_message  TEXT,
  correlation_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_jobs_action
  ON agent_jobs (action);

CREATE INDEX IF NOT EXISTS idx_agent_jobs_status
  ON agent_jobs (status);

CREATE INDEX IF NOT EXISTS idx_agent_jobs_created_at_desc
  ON agent_jobs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_jobs_correlation_id
  ON agent_jobs (correlation_id);
