-- 0197 (deep-scan A / Option B): TradersPost order-status confirmation timestamp.
--
-- Adds an INDEPENDENT reconciliation leg. Today reconciliation-service.ts checks 1 & 2 are
-- proxies of the production_trades count (self-comparison, gated OFF via
-- PROXY_COUNT_LEGS_INDEPENDENT). This column is stamped by the new
-- POST /api/traderspost/order-status webhook consumer when TradersPost confirms an order,
-- so a "confirmed" count (traderspost_confirmed_at IS NOT NULL) becomes genuinely independent
-- of the server-side "sent" count — closing the loop the F-7 GAP docstring describes.
--
-- Nullable + idempotent (ADD COLUMN IF NOT EXISTS); safe to re-apply. Inert until the operator
-- wires the TradersPost webhook + flips RECON_TRADERSPOST_CONFIRM_INDEPENDENT=true post go-live.
ALTER TABLE production_trades ADD COLUMN IF NOT EXISTS traderspost_confirmed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS production_trades_traderspost_confirmed_at_idx
  ON production_trades (traderspost_confirmed_at)
  WHERE traderspost_confirmed_at IS NOT NULL;
