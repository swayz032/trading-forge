-- Migration 0128: Encrypt HMAC secrets at rest
--
-- Purpose: account_strategy_assignments.hmac_secret currently stores 64-char hex
--   HMAC secrets as plaintext TEXT. This migration adds an encrypted BYTEA column
--   and backfills it using pgp_sym_encrypt with the operator-supplied GUC
--   app.hmac_encryption_key.
--
-- IMPORTANT — OPERATOR ACTIONS REQUIRED BEFORE APPLY:
--   1. Set the GUC in postgresql.conf (or via ALTER SYSTEM):
--        ALTER SYSTEM SET app.hmac_encryption_key = '<256-bit-hex-key>';
--        SELECT pg_reload_conf();
--   2. Set HMAC_ENCRYPTION_KEY in backend .env (same value):
--        HMAC_ENCRYPTION_KEY=<256-bit-hex-key>
--   3. After backfill, confirm all rows have hmac_secret_encrypted NOT NULL
--      before scheduling plaintext column drop (follow-up migration).
--
-- Transition period:
--   - hmac_secret (plaintext TEXT) is DEPRECATED but NOT dropped here.
--   - Both columns coexist during the transition window.
--   - pine-export-recipient-service.ts and tradingview-marker-service.ts both
--     read encrypted column first; fall back to plaintext when encrypted is NULL.
--   - Operator rotates by: running this migration, verifying encrypted reads,
--     then running follow-up migration to drop hmac_secret.
--
-- Encryption function: pgp_sym_encrypt (requires pgcrypto extension).
--   Key: current_setting('app.hmac_encryption_key', true) — 'true' = missing_ok.
--   When GUC is absent, backfill is SKIPPED with a NOTICE (safe default).
--
-- Apply via: node scripts/apply-migration.mjs 0128_hmac_secret_encryption.sql
-- DO NOT apply automatically — operator must set GUC first.

-- ─── Prerequisites ────────────────────────────────────────────────────────────

-- pgcrypto is required for pgp_sym_encrypt / pgp_sym_decrypt.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── UP MIGRATION ─────────────────────────────────────────────────────────────

-- 1. Add encrypted column (BYTEA — pgp_sym_encrypt output is binary).
ALTER TABLE account_strategy_assignments
  ADD COLUMN IF NOT EXISTS hmac_secret_encrypted BYTEA;

-- 2. Deprecate plaintext column via comment (do NOT drop yet — operator follow-up).
COMMENT ON COLUMN account_strategy_assignments.hmac_secret IS
  'DEPRECATED (migration 0128). '
  'Read hmac_secret_encrypted instead when populated. '
  'Plaintext column retained for rollback safety during transition window. '
  'Drop via follow-up migration after encrypted reads are verified in production.';

COMMENT ON COLUMN account_strategy_assignments.hmac_secret_encrypted IS
  'AES-256 encrypted HMAC secret (pgp_sym_encrypt output). '
  'Key sourced from GUC app.hmac_encryption_key (set by operator). '
  'Decrypt with: pgp_sym_decrypt(hmac_secret_encrypted, current_setting(''app.hmac_encryption_key'', true)). '
  'Added in migration 0128 — replaces plaintext hmac_secret column.';

-- 3. Backfill: only when GUC is set (missing_ok = true avoids error when absent).
--    DO NOTHING rows where hmac_secret is already NULL (nothing to encrypt).
DO $$
DECLARE
  v_key TEXT;
  v_count INTEGER;
BEGIN
  v_key := current_setting('app.hmac_encryption_key', true);

  IF v_key IS NULL OR v_key = '' THEN
    RAISE NOTICE '0128: app.hmac_encryption_key GUC is not set — skipping backfill. '
      'Set the GUC and re-run backfill manually: '
      'UPDATE account_strategy_assignments '
      'SET hmac_secret_encrypted = pgp_sym_encrypt(hmac_secret, current_setting(''app.hmac_encryption_key'')) '
      'WHERE hmac_secret IS NOT NULL AND hmac_secret_encrypted IS NULL;';
    RETURN;
  END IF;

  UPDATE account_strategy_assignments
     SET hmac_secret_encrypted = pgp_sym_encrypt(hmac_secret, v_key)
   WHERE hmac_secret IS NOT NULL
     AND hmac_secret_encrypted IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '0128: backfilled % rows with encrypted HMAC secrets.', v_count;
END;
$$;

-- ─── DOWN MIGRATION ───────────────────────────────────────────────────────────
-- To reverse:
--   ALTER TABLE account_strategy_assignments DROP COLUMN IF EXISTS hmac_secret_encrypted;
--   COMMENT ON COLUMN account_strategy_assignments.hmac_secret IS
--     'Per-recipient HMAC secret (64-char hex, crypto.randomBytes(32)). '
--     'Populated on first Pine export for this (account_id, strategy_id).';
