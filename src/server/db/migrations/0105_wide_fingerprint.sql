-- Pass 21 (2026-05-16): variant-aware wide fingerprint for graduation dedup.
--
-- Background:
--   Pass 20 fingerprint = sha256(market | canonical_concept_name) — collapses
--   all variants of the same concept (5m-ORB + 15m-ORB → same bucket). That's
--   correct for DISCOVERY (cross-source convergence) but wrong for GRADUATION
--   (5m-ORB and 15m-ORB are different real edges, both should backtest).
--
-- This migration:
--   1. Adds `wide_fingerprint_hash` column to strategy_pending_buckets
--   2. Backfills it for existing buckets by computing
--      sha256("v2|market|canonical_concept|timeframe|direction|entry_params")
--      from the graduated strategy's config (where graduated_strategy_id is set)
--   3. Indexes the column for fast dedup queries at graduation time
--
-- Used by: src/server/services/direct-bucket-graduator.ts (Pass 21 dedup logic)
-- Hashing function: computeWideConceptFingerprintHash() in strategy-fingerprint.ts
--
-- Backfill is best-effort: buckets without graduated_strategy_id get NULL.
-- The graduator computes the hash live for incoming buckets going forward.

ALTER TABLE strategy_pending_buckets
  ADD COLUMN IF NOT EXISTS wide_fingerprint_hash TEXT;

-- Index for the dedup join in direct-bucket-graduator.ts
CREATE INDEX IF NOT EXISTS idx_pending_buckets_wide_fingerprint
  ON strategy_pending_buckets (wide_fingerprint_hash)
  WHERE wide_fingerprint_hash IS NOT NULL;

-- Audit comment to make it discoverable
COMMENT ON COLUMN strategy_pending_buckets.wide_fingerprint_hash IS
  'Pass 21 variant-aware fingerprint: sha256(v2|market|canonical_concept|timeframe|direction|entry_params_sig). NULL for pre-Pass-21 buckets without a graduated strategy. Computed at graduation time by direct-bucket-graduator.ts.';
