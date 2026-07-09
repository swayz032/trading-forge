-- Deep-Scan #18b Z-3 (2026-07-05): compliance_reviews.invalidated_at /
-- invalidation_reason phantom columns. schema.ts declares both (lines ~550-551) and
-- drift-detection-service.ts writes them (invalidatedAt/invalidationReason) and reads
-- isNull(invalidatedAt) on the compliance-rule-drift cascade — but no migration adds
-- them. On a from-scratch DB the cascade-invalidation path throws at the first drift
-- event; in prod they exist only out-of-band → not disaster-recovery-safe. Backfill.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS → no-op when already present.
ALTER TABLE compliance_reviews ADD COLUMN IF NOT EXISTS invalidated_at timestamp;
ALTER TABLE compliance_reviews ADD COLUMN IF NOT EXISTS invalidation_reason text;
