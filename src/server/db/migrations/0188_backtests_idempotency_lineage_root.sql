-- Migration 0188: backtests_idempotency_lineage_root
-- deepscan14 fix wave, Track 5 (infra hardening)
--
-- Two independent, unrelated fixes bundled into one migration number:
--
-- E7 [MED] — backtests had no idempotency key. n8n retry / dual-fire enqueued a
-- second row for the same logical backtest via a bare random-UUID insert, silently
-- double-counting downstream MC/WFE/pattern-aggregator statistics. Adds an optional
-- idempotency_key column + a PARTIAL unique index (only enforced when a caller
-- supplies a key — existing callers that don't are unaffected).
--
-- H4 [LOW] — evolution's 7-day cooldown gate checked only one generation up
-- (parentStrategyId), so gen2->gen3 mutations bypassed the cooldown entirely
-- (their parentStrategyId points at gen1, not the gen0 lineage root). Adds
-- lineage_root_id, stamped at every evolution INSERT with the TRUE root of the
-- chain going forward. Legacy pre-fix rows keep lineage_root_id = NULL and
-- evolution-service.ts falls back to a live parent-chain walk for those.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS throughout.
-- Boot-migration-runner keyed on meta/_journal.json idx 191 / tag 0188_backtests_idempotency_lineage_root

ALTER TABLE backtests ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS backtests_idempotency_key_uq
  ON backtests (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE strategies ADD COLUMN IF NOT EXISTS lineage_root_id UUID REFERENCES strategies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_strategies_lineage_root_id
  ON strategies (lineage_root_id)
  WHERE lineage_root_id IS NOT NULL;
