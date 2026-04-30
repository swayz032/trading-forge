-- Migration 0054: Add correlation_id column to audit_log
-- Enables tracing HTTP requests through the full audit trail.
-- Nullable for backward compatibility — existing rows remain unaffected.
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS correlation_id TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_log_correlation_id ON audit_log(correlation_id);
