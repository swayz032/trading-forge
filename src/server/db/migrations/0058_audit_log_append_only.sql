-- Migration 0058: Audit Log Append-Only + recency index
--
-- ─── TASK 1: Append-Only Trust Spine ─────────────────────────────────────────
-- The audit_log is the system's Trust Spine — it MUST NOT be silently rewritten.
-- Pre-2026-04 audit, the table permitted UPDATE and DELETE, meaning a privileged
-- write could erase or alter recorded actions. This migration installs a
-- BEFORE UPDATE OR DELETE trigger that raises a SQL exception, making the
-- table strictly append-only at the database level.
--
-- Rationale: enforcing this in the DB (not application code) means even direct
-- psql access, raw SQL bugs, or rogue services cannot mutate the trust spine.
--
-- ─── TASK 2: created_at recency index ────────────────────────────────────────
-- The dashboard queries audit_log ORDER BY created_at DESC LIMIT N on every
-- load. Without an index this scans the entire table. We add a btree DESC
-- index purpose-built for the recency queries.
--
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction, and
-- drizzle-kit wraps each migration file in a transaction. We use the
-- non-CONCURRENT form here. If the audit_log table is large enough that a
-- regular CREATE INDEX would block writes for too long, apply this manually
-- with `psql -c "CREATE INDEX CONCURRENTLY ..."` outside the migration runner.
-- For Trading Forge's single-tenant scale (one trader), the locking window
-- is acceptable.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ TASK 1: Append-only trigger ════════════════════════════════════════════

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_append_only_trigger ON audit_log;

CREATE TRIGGER audit_log_append_only_trigger
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_log_mutation();

-- ═══ TASK 2: Recency index ══════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at_desc
    ON audit_log (created_at DESC);
