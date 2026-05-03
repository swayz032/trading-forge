-- C1: CME Venue Outage Handling (W15 Team B)
-- Stores exchange outage events detected by exchange-status-service.ts.
-- On outage start: pending orders cancelled, new entries blocked, positions held.
-- On resume: NO auto-reissue — manual review required (lesson from Nov 28 2025 CME halt).

CREATE TABLE IF NOT EXISTS exchange_outages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange text NOT NULL,
  started_at timestamp NOT NULL,
  ended_at timestamp,
  reason text,
  affected_symbols text[],
  response_taken text,
  created_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exchange_outages_exchange_time
  ON exchange_outages(exchange, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_exchange_outages_active
  ON exchange_outages(exchange, ended_at)
  WHERE ended_at IS NULL;
