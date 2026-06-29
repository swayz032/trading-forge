-- 0184_workflow_backups.sql
--
-- Deep-scan #4 backend-DR (2026-06-29): durable sink for the n8n `3A-workflow-backup`
-- workflow. The 3A workflow previously emitted only {id,name,active,nodeCount} to its
-- own output and SSE-broadcast "Backup Complete" while persisting NOTHING — every
-- nightly run falsely reported success. Railway n8n is ephemeral sqlite with no attached
-- volume (this is how the Wave-9 incident wiped 29 workflows). This table is the durable
-- sink `POST /api/admin/workflow-backup` writes to; 3A now POSTs the FULL node graph here.
--
-- content_hash dedups identical consecutive backups (skip-insert when the latest row for a
-- workflow_id matches) so the table holds a history of DISTINCT versions, not one row per
-- nightly tick. Append-only by design (DR history); prune by created_at if it ever grows.
--
-- Idempotent via CREATE TABLE IF NOT EXISTS (safe on re-run / boot-migration-runner).

CREATE TABLE IF NOT EXISTS workflow_backups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id   TEXT NOT NULL,
  workflow_name TEXT,
  active        BOOLEAN,
  node_count    INTEGER,
  full_json     JSONB NOT NULL,
  content_hash  TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'n8n_3a_backup',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_backups_workflow_id ON workflow_backups (workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_backups_created_at_desc ON workflow_backups (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_backups_wf_hash ON workflow_backups (workflow_id, content_hash);
