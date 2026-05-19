-- Migration 0102: TradingView Marker Collector (Track 8 / Pass 3)
-- Stores Pine alert webhooks as an expected-trade ledger for 5-source reconciliation.
-- HMAC-validated per (account_id, strategy_id) secret from account_strategy_assignments.
--
-- UP ─────────────────────────────────────────────────────────────────────────

CREATE TABLE tradingview_markers (
  id                BIGSERIAL PRIMARY KEY,
  strategy_id       UUID NOT NULL REFERENCES strategies(id),
  account_id        UUID NOT NULL REFERENCES broker_accounts(account_id),
  bar_timestamp     TIMESTAMPTZ NOT NULL,
  signal            SMALLINT NOT NULL CHECK (signal IN (-1, 0, 1)),
  pine_alert_payload JSONB NOT NULL,
  hmac_validated    BOOLEAN NOT NULL DEFAULT false,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  correlation_id    UUID
);

-- Index for reconciliation time-range queries (account + date)
CREATE INDEX idx_tradingview_markers_account_bar
  ON tradingview_markers (account_id, bar_timestamp DESC);

-- Index for correlation ID linkage across audit rows
CREATE INDEX idx_tradingview_markers_correlation
  ON tradingview_markers (correlation_id)
  WHERE correlation_id IS NOT NULL;

-- DOWN ───────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS tradingview_markers;
