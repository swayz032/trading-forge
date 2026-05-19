-- B-fix 2026-05-17 — n8n_execution_log dedupe constraint
-- Backend scraper pulls Railway n8n executions every 5 min into this table.
-- Without a uniqueness constraint, retries / overlap on the rolling window
-- would create duplicate rows for the same execution.
--
-- Partial unique index on execution_id WHERE execution_id IS NOT NULL —
-- preserves the existing nullable contract from earlier writes that may have
-- skipped the field, while making future scraped rows fully idempotent via
-- ON CONFLICT DO NOTHING.
--
-- Idempotent: IF NOT EXISTS guards on both index and supporting indexes.

CREATE UNIQUE INDEX IF NOT EXISTS uq_n8n_exec_execution_id
  ON n8n_execution_log (execution_id)
  WHERE execution_id IS NOT NULL;

-- Recent-window scans (scraper checks "what's newest in DB" + dashboard tails)
CREATE INDEX IF NOT EXISTS idx_n8n_exec_started_at
  ON n8n_execution_log (started_at DESC NULLS LAST)
  WHERE started_at IS NOT NULL;
