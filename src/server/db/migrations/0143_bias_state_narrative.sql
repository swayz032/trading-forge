-- Migration 0143: bias_state narrative_state column (Wave 25 Pass 6 W25.11)
--
-- Adds JSONB column `narrative_state` to bias_state table.
-- Stores the Accumulation / Manipulation / Distribution / REVERSAL_FORMING / NEUTRAL
-- phase computed by narrative-state-service.ts.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Backward-compat: NULL default means pre-Pass-6 rows are unaffected.
-- P6.A1 reserves idx 144 (0142_regime_expansion). This is idx 145.

ALTER TABLE bias_state ADD COLUMN IF NOT EXISTS narrative_state JSONB DEFAULT NULL;

-- Partial index over rows where narrative_state is populated — supports
-- "latest narrative state for symbol X" queries without scanning null rows.
CREATE INDEX IF NOT EXISTS idx_bias_state_narrative
  ON bias_state ((1))
  WHERE narrative_state IS NOT NULL;
