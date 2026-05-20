-- W23H.B (2026-05-20): Multi-regime strategies schema.
-- Adds preferred_regimes TEXT[] column to strategies table.
-- Backfills from existing preferred_regime (single) column.
-- Creates GIN index for array membership queries.
--
-- Idempotent: uses IF NOT EXISTS / safe UPDATE WHERE pattern.
-- No data loss: existing preferred_regime single column is preserved.
-- All new fields nullable — zero impact on existing 74 strategies pre-wipe.

-- 1. Add preferred_regimes array column (nullable, idempotent)
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS preferred_regimes TEXT[];

-- 2. Backfill: copy existing preferred_regime into preferred_regimes array
--    Only backfills rows where preferred_regime is not null AND preferred_regimes is still null.
--    Idempotent: skips rows that were already backfilled.
UPDATE strategies
SET preferred_regimes = ARRAY[preferred_regime]
WHERE preferred_regime IS NOT NULL
  AND preferred_regimes IS NULL;

-- 3. GIN index for fast array membership queries.
--    Used by: WHERE 'RANGE_BOUND' = ANY(preferred_regimes)
--    Idempotent: CREATE INDEX IF NOT EXISTS.
CREATE INDEX IF NOT EXISTS idx_strategies_preferred_regimes
  ON strategies USING GIN (preferred_regimes);

-- 4. Comment for documentation
COMMENT ON COLUMN strategies.preferred_regimes IS
  'W23H.B: array of regime labels where this strategy is eligible. '
  'TRENDING_UP, TRENDING_DOWN, RANGE_BOUND, or any combination. '
  'NULL = no regime preference (eligible in all regimes). '
  'Supersedes preferred_regime (single); both readable; single deprecated in W24.';
