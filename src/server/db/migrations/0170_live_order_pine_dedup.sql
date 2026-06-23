-- Migration 0170 — live_order_pine_dedup (Pass 1 Track C, 2026-06-22)
--
-- Creates the dedup table referenced by live-order.ts:203 (insertPineDedupRow).
-- Pine alerts fire once per bar close; bar_timestamp is structurally unique per
-- (account, strategy, bar, action).  A fresh INSERT with ON CONFLICT DO NOTHING
-- lets the route detect replayed alerts without a SELECT-then-INSERT race.
--
-- The route stores correlation_id for cross-table traceability and uses RETURNING id
-- so the caller can distinguish first-insert from a no-op conflict (empty RETURNING).
--
-- Retention: rows accumulate indefinitely (each row is ~90 bytes).
-- At 1-2 alerts per day per strategy the table stays well below 10K rows per year.
-- A periodic cleanup cron (not in this migration) can sweep rows > 30 days old.
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Boot-migration-runner applies on next deploy.

CREATE TABLE IF NOT EXISTS live_order_pine_dedup (
  id             BIGSERIAL PRIMARY KEY,
  account_id     UUID NOT NULL,
  strategy_id    UUID NOT NULL,
  bar_timestamp  TIMESTAMPTZ NOT NULL,
  action         TEXT NOT NULL,
  correlation_id UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique index enforces dedup semantics and is the implicit target for
-- ON CONFLICT DO NOTHING in insertPineDedupRow().
-- correlation_id is intentionally excluded from the unique key: two alerts with the
-- same (account, strategy, bar, action) are the same Pine bar fire regardless of
-- which correlation_id was generated for each inbound HTTP request.
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_order_pine_dedup_key
  ON live_order_pine_dedup (account_id, strategy_id, bar_timestamp, action);

-- Fast lookup by account for cleanup / audit queries.
CREATE INDEX IF NOT EXISTS idx_live_order_pine_dedup_account
  ON live_order_pine_dedup (account_id, created_at DESC);
