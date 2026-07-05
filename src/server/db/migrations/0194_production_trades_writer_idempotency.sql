-- Deep-Scan #18b X-1 option a (2026-07-05): production_trades writer idempotency.
--
-- broker-router.ts now INSERTs one production_trades row per successful TradersPost
-- order submission (previously: the table had NO writer at all — reconciliation-
-- service.ts's fetchProxyCountsFromProductionTrades() always read zero rows, so daily
-- recon could only ever report yellow/UNVERIFIABLE, never a genuine green). The row is
-- keyed on traderspost_webhook_id, populated with the deterministic bar-scoped
-- idempotency key TradersPost itself dedupes on — SHA-256(accountId|strategyId|ticker|
-- action|barTs), see src/server/integrations/traderspost/client.ts::
-- buildDeterministicIdempotencyKey(). A retry of the same bar/signal event (network
-- retry, DLQ replay, TradingView re-fire) produces the SAME key; the insert uses
-- ON CONFLICT (traderspost_webhook_id) DO NOTHING against this index, so retries are a
-- silent no-op rather than a duplicate row.
--
-- Partial (WHERE NOT NULL) mirrors the smo_broker_fill_id_uq pattern on
-- server_mediated_orders (migration 0171) — rows without a TradersPost webhook id
-- (e.g. a future TopstepX writer) are not constrained against each other.
--
-- Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS → no-op when already present.
CREATE UNIQUE INDEX IF NOT EXISTS production_trades_traderspost_webhook_id_uq
  ON production_trades (traderspost_webhook_id)
  WHERE traderspost_webhook_id IS NOT NULL;
