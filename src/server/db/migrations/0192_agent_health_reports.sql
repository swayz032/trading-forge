-- Deep-Scan #18b Z-2 (2026-07-05): agent_health_reports table has NO migration.
-- schema.ts declares it (agentHealthReports, 9 cols + 2 indexes), agent-audit-service.ts
-- INSERTs into it, and admin.ts SELECTs from it — but no CREATE TABLE exists in any
-- migration. On any DB built strictly from the journaled set (DR restore / CI / new
-- operator) both the INSERT and SELECT throw "relation does not exist". In prod it
-- exists only via out-of-band creation → not reproducible, not boot-runner-covered.
-- Backfill it, matching schema.ts exactly.
--
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS → no-op when the out-of-band table
-- already exists with the matching shape.
CREATE TABLE IF NOT EXISTS agent_health_reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain            text NOT NULL,
  status            text NOT NULL DEFAULT 'healthy',
  last_checked_at   timestamp NOT NULL DEFAULT now(),
  latency_ms        integer,
  error_count       integer DEFAULT 0,
  details           jsonb,
  recommendations   jsonb,
  created_at        timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_health_domain_idx ON agent_health_reports (domain);
CREATE INDEX IF NOT EXISTS agent_health_status_idx ON agent_health_reports (status);
