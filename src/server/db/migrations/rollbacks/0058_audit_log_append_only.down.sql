-- Migration 0058 — DOWN / rollback
-- Drop the append-only trigger and recency index.
-- Run manually with `psql -f` if you need to roll back migration 0058.

DROP TRIGGER IF EXISTS audit_log_append_only_trigger ON audit_log;
DROP FUNCTION IF EXISTS prevent_audit_log_mutation();
DROP INDEX IF EXISTS idx_audit_log_created_at_desc;
