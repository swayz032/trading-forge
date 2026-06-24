-- Migration 0171 — server_mediated_orders (Fill Reconciliation Phase 1)
-- Journal entry idx: 173
--
-- Purpose:
--   Tracks the full order lifecycle for every order routed through
--   server-mediated-executor.ts → broker-router → TradersPost/TopstepX.
--
--   Phase 0 fires orders and emits audit rows but has no persistent order-state:
--   when the fill arrives asynchronously (TradersPost acks; broker fills later)
--   there is no row to update with actual fill price/qty. This table closes that gap.
--
--   Phase 1 (this migration + fill-reconciliation-service.ts):
--     - INSERT at 'routed' on every server-mediated dispatch
--     - UPDATE to 'acked' on routeOrder success, 'needs_reconcile' on failure
--     - UPDATE to 'filled' / 'partially_filled' when fill callback arrives
--     - UPDATE to 'needs_reconcile' when drift exceeds tolerance
--     - UPDATE to 'reconciled' after successful position sync
--
--   A position in 'needs_reconcile' BLOCKS new server-mediated entries for that
--   account until the operator (or auto-reconciliation) clears it.
--
-- Status enum values:
--   routed           — routeOrder() dispatched, awaiting broker ack
--   acked            — TradersPost acked the webhook (HTTP 200); broker fill pending
--   filled           — fill callback received; paper position synced to actual fill
--   partially_filled — partial fill received; qty accumulated; position adjusted
--   rejected         — broker rejected the order (fill callback status=rejected)
--   reconciled       — daily recon confirmed; production_trades.tradovate_fill_id populated
--   needs_reconcile  — routing failure OR unmatched fill OR drift detected — BLOCKS new entries
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Boot-migration-runner applies on next deploy.

CREATE TABLE IF NOT EXISTS server_mediated_orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key     TEXT NOT NULL,        -- bar-scoped: sha256(accountId+strategyId+ticker+action+barTs)
  account_id          UUID NOT NULL,
  strategy_id         UUID NOT NULL,
  session_id          UUID NOT NULL,
  correlation_id      UUID,

  -- Intended order parameters (what we tried to place)
  intended_action     TEXT NOT NULL,        -- 'enter_long' | 'enter_short' | 'exit_long' | 'exit_short'
  intended_symbol     TEXT NOT NULL,
  intended_qty        INTEGER NOT NULL,
  intended_order_type TEXT NOT NULL DEFAULT 'market',
  intended_limit_price  NUMERIC(18,6),
  intended_stop_price   NUMERIC(18,6),

  -- Broker response from TradersPost ack (may carry a broker order ref)
  broker_order_ref    TEXT,                 -- broker-side order ID from responseBody, if present
  broker_fill_id      TEXT,                 -- unique fill ID from fill callback (dedup key)

  -- Lifecycle state
  status              TEXT NOT NULL DEFAULT 'routed',

  -- Actual fill values (updated by fill callback)
  filled_qty          INTEGER NOT NULL DEFAULT 0,
  filled_avg_price    NUMERIC(18,6),

  -- Timestamps
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  filled_at           TIMESTAMPTZ,          -- when status transitioned to filled/partially_filled

  -- JSON blobs for extensibility
  broker_response     JSONB,               -- full TradersPost responseBody for audit
  fill_events         JSONB NOT NULL DEFAULT '[]'::jsonb  -- array of raw fill callback payloads
);

-- Unique on idempotency_key: same bar-scoped signal produces one order row.
-- ON CONFLICT on this index used for idempotent INSERT-or-ignore.
CREATE UNIQUE INDEX IF NOT EXISTS idx_smo_idempotency_key
  ON server_mediated_orders (idempotency_key);

-- Fast lookup for fill callback matching by broker_order_ref
CREATE INDEX IF NOT EXISTS idx_smo_broker_order_ref
  ON server_mediated_orders (broker_order_ref)
  WHERE broker_order_ref IS NOT NULL;

-- Dedup: one broker_fill_id must map to at most one order row
CREATE UNIQUE INDEX IF NOT EXISTS idx_smo_broker_fill_id
  ON server_mediated_orders (broker_fill_id)
  WHERE broker_fill_id IS NOT NULL;

-- Fail-closed block gate: fast scan for needs_reconcile accounts
CREATE INDEX IF NOT EXISTS idx_smo_account_needs_reconcile
  ON server_mediated_orders (account_id, status)
  WHERE status = 'needs_reconcile';

-- Audit / recon queries: orders by account + created_at descending
CREATE INDEX IF NOT EXISTS idx_smo_account_created
  ON server_mediated_orders (account_id, created_at DESC);
