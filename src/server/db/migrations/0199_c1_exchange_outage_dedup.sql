-- 0199 (C1 fix — ratify packet 1): dedup exchange_outages + close phantom CME rows.
-- The dead CME venue-status probe (cmegroup.com bot-block → 403/000) opened a phantom
-- outage on every 60s poll, accumulating ~80 stale OPEN CME rows that re-engaged the
-- C1 entry block on every boot. This migration (1) closes those phantom rows, scoped
-- to the dead-probe reason signature so a genuinely-active outage is never closed on a
-- re-run, then (2) adds a partial unique index so at most one OPEN row per exchange
-- can exist — backstopping the DB-aware dedup in exchange-status-service.pollCmeStatus.
-- Idempotent (pattern-scoped UPDATE + CREATE UNIQUE INDEX IF NOT EXISTS); safe to re-apply.
-- No behavior flag: the phantom-block was a live defect, not a new feature.

-- 1. Close phantom CME outage rows produced by the dead venue-status probe.
--    Pattern-scoped to the dead-probe reason so a real future outage (which carries a
--    different reason, e.g. "Broker (Tradovate) unreachable ...") is NOT closed on re-run.
UPDATE exchange_outages
SET ended_at = now(),
    response_taken = 'phantom_cleanup_migration_0199'
WHERE ended_at IS NULL
  AND (
    reason LIKE 'CME status HTTP%'
    OR reason LIKE 'CME status fetch%'
  );

-- 2. At most one OPEN (ended_at IS NULL) outage row per exchange.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_exchange_outages_one_active_per_exchange"
  ON exchange_outages (exchange)
  WHERE ended_at IS NULL;
