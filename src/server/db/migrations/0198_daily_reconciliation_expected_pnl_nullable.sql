-- deep-scan Accuracy re-verify (2026-07-06): daily_reconciliation.expected_pnl must be NULLABLE.
-- production_trades.expected_pnl is written NULL unconditionally by broker-router.ts (no server-mediated
-- fill ingest yet). reconciliation-service persisted that as a placeholder 0 into this NOT-NULL column,
-- and production-status.ts::buildPnlToday() then read the placeholder 0 as a real baseline →
-- delta = actual - 0 = actual → false YELLOW/RED on the operator's front-door ProductionStatusPanel the
-- day the MFFU scraper (Phase 4C) returns a real actual. Making the column nullable lets recon persist a
-- genuine NULL for "expected_pnl unpopulated", which every consumer null-guards (P&L delta skipped, not
-- fabricated). Idempotent: DROP NOT NULL on an already-nullable column is a no-op.
ALTER TABLE daily_reconciliation ALTER COLUMN expected_pnl DROP NOT NULL;
