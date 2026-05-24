-- Migration 0140 — Persistent Liquidity Map Engine (W25.6 / Pass 3)
-- Creates the liquidity_levels table for the ranked institutional liquidity engine.
-- idx 142 in _journal.json.
--
-- Design:
--   - One row per active level per (symbol, session_date, level_type, price bucket).
--   - expired_at IS NULL = active.  Set by expireOldLevels() when levels age out.
--   - Partial indexes on active rows keep hot-path queries fast.
--   - UPSERT callers use (symbol, session_date, level_type, price_rounded) as a
--     de-duplication key to prevent double-inserts within ±0.25pt tolerance.
--   - htf_significance 1-5: 1=intraday, 2=session, 3=daily, 4=weekly, 5=monthly.
--   - sweep_probability is computed lazily on query; stored after first compute.

CREATE TABLE IF NOT EXISTS liquidity_levels (
  id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol              TEXT            NOT NULL,
  session_date        DATE            NOT NULL,
  level_type          TEXT            NOT NULL,
  -- Enum for level_type (enforced by CHECK at DB layer):
  --   intraday:  'hod' | 'lod' | 'asian_high' | 'asian_low' | 'london_high' | 'london_low'
  --   session:   'naked_poc' | 'untouched_fvg' | 'untouched_ob'
  --   daily:     'pdh' | 'pdl' | 'eqh' | 'eql'
  --   weekly:    'pwh_iso' | 'pwl_iso'
  --   monthly:   'pmh' | 'pml'
  price               NUMERIC(20, 5)  NOT NULL,
  htf_significance    INTEGER         NOT NULL DEFAULT 1,
  sweep_probability   NUMERIC(5, 4)   DEFAULT NULL,
  touched_count       INTEGER         NOT NULL DEFAULT 0,
  source_meta         JSONB           NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  expired_at          TIMESTAMPTZ     DEFAULT NULL
);

-- Symbol CHECK: only the 3 live symbols are valid
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'liquidity_levels'
      AND constraint_name = 'liquidity_levels_symbol_check'
  ) THEN
    ALTER TABLE liquidity_levels
      ADD CONSTRAINT liquidity_levels_symbol_check
        CHECK (symbol IN ('MES', 'MNQ', 'MCL'));
  END IF;
END;
$$;

-- htf_significance range CHECK
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'liquidity_levels'
      AND constraint_name = 'liquidity_levels_htf_significance_check'
  ) THEN
    ALTER TABLE liquidity_levels
      ADD CONSTRAINT liquidity_levels_htf_significance_check
        CHECK (htf_significance BETWEEN 1 AND 5);
  END IF;
END;
$$;

-- level_type enum CHECK — 17 canonical values (contract for Pass 7 adaptive exits)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'liquidity_levels'
      AND constraint_name = 'liquidity_levels_level_type_check'
  ) THEN
    ALTER TABLE liquidity_levels
      ADD CONSTRAINT liquidity_levels_level_type_check
        CHECK (level_type IN (
          'pdh', 'pdl', 'pwh_iso', 'pwl_iso', 'pmh', 'pml',
          'asian_high', 'asian_low', 'london_high', 'london_low',
          'naked_poc', 'untouched_fvg', 'untouched_ob',
          'eqh', 'eql',
          'hod', 'lod'
        ));
  END IF;
END;
$$;

-- sweep_probability range CHECK
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'liquidity_levels'
      AND constraint_name = 'liquidity_levels_sweep_probability_check'
  ) THEN
    ALTER TABLE liquidity_levels
      ADD CONSTRAINT liquidity_levels_sweep_probability_check
        CHECK (sweep_probability IS NULL OR (sweep_probability >= 0 AND sweep_probability <= 1));
  END IF;
END;
$$;

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_liquidity_levels_symbol_session
  ON liquidity_levels (symbol, session_date);

CREATE INDEX IF NOT EXISTS idx_liquidity_levels_active
  ON liquidity_levels (symbol, level_type)
  WHERE expired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_liquidity_levels_price
  ON liquidity_levels (symbol, price)
  WHERE expired_at IS NULL;

-- Composite index for the ranked-query hot path:
--   SELECT * FROM liquidity_levels WHERE symbol=? AND expired_at IS NULL AND price > ?
--   ORDER BY htf_significance DESC, sweep_probability DESC
CREATE INDEX IF NOT EXISTS idx_liquidity_levels_rank
  ON liquidity_levels (symbol, htf_significance DESC, sweep_probability DESC)
  WHERE expired_at IS NULL;
