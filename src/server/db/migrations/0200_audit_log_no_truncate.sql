-- 0200 (deep-scan MIG-1 2026-07-11): close the TRUNCATE hole in the audit_log append-only guard.
-- 0058 installed a BEFORE UPDATE OR DELETE ... FOR EACH ROW trigger, but Postgres row-level triggers
-- NEVER fire for TRUNCATE — so `TRUNCATE audit_log` (a bad reset script, TRUNCATE ... CASCADE, or a
-- rogue service) silently wiped the entire trust spine while 0058's header promised "even direct psql
-- access, raw SQL bugs, or rogue services cannot mutate the trust spine". This adds the companion
-- statement-level BEFORE TRUNCATE trigger, reusing 0058's prevent_audit_log_mutation() RAISE function
-- (it only RAISEs — safe for a FOR EACH STATEMENT trigger, which cannot reference OLD/NEW).
-- Idempotent (DROP TRIGGER IF EXISTS before CREATE); safe to re-apply. No behavior flag — the audit
-- trail is already contractually append-only, this only makes the DB-level guarantee match the claim.
DROP TRIGGER IF EXISTS audit_log_no_truncate_trigger ON audit_log;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate_trigger
    BEFORE TRUNCATE ON audit_log
    FOR EACH STATEMENT
    EXECUTE FUNCTION prevent_audit_log_mutation();
