-- Wave 8 (2026-05-17) — fix 0107 partial-index mismatch.
--
-- 0107 created `uq_n8n_exec_execution_id` as a PARTIAL unique index
-- (`WHERE execution_id IS NOT NULL`). The Wave 7 scraper calls Drizzle's
-- `onConflictDoNothing({ target: executionId })` which emits
-- `ON CONFLICT (execution_id)` — Postgres rejects this with error 42P10
-- because the index spec includes a predicate the ON CONFLICT clause does
-- not. Result: every insert in every 5-min cycle fails silently; the
-- scraper has been swallowing the error into its (unlogged) errors[]
-- array since 0107 was applied. Live evidence: `fetched=92, inserted=0`
-- repeating in pm2 logs.
--
-- Fix: replace the partial unique index with a full one. Postgres unique
-- constraints on nullable columns already permit multiple NULLs (NULL is
-- not equal to NULL for uniqueness purposes), so the partial predicate
-- was redundant — full unique index preserves the same semantics and
-- matches the Drizzle ON CONFLICT spec.
--
-- Idempotent: DROP IF EXISTS + CREATE IF NOT EXISTS.

DROP INDEX IF EXISTS uq_n8n_exec_execution_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_n8n_exec_execution_id
  ON n8n_execution_log (execution_id);
