-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0111 — Wave 23F Track A: strategies.symbols TEXT[] column
-- 2026-05-19
--
-- Context: Multi-market support (MES + MNQ + MCL). One strategy row can now
-- fire on multiple instruments when scout evidence supports it. The legacy
-- `symbol` column is KEPT for backward compatibility — drop in W24 after
-- 30-day soak.
--
-- New column: symbols TEXT[] NOT NULL DEFAULT ARRAY['MES']::TEXT[]
-- Backfill:   rows whose actual symbol is something other than MES get
--             symbols = ARRAY[symbol] (handles any future non-MES rows).
--             Rows already defaulted to {MES} that also have symbol='MES'
--             are untouched (WHERE guards against double-application).
-- GIN index:  supports array containment queries (@>, <@, &&).
--
-- Idempotent: DO $$ BEGIN ... EXCEPTION WHEN duplicate_column THEN NULL END $$
--             guards the ALTER TABLE. Index uses IF NOT EXISTS.
-- Operator:   npm run db:migrate (or apply manually on Railway Postgres).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Add column — idempotent via exception handler.
DO $$ BEGIN
  ALTER TABLE strategies
    ADD COLUMN symbols TEXT[] NOT NULL DEFAULT ARRAY['MES']::TEXT[];
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

-- 2. Backfill: rows whose actual symbol differs from 'MES' get symbols = ARRAY[symbol].
--    Rows where symbol IS NULL or symbol = 'MES' already have the correct
--    default {MES} and are not touched.
UPDATE strategies
   SET symbols = ARRAY[symbol]::TEXT[]
 WHERE symbols = ARRAY['MES']::TEXT[]
   AND symbol IS NOT NULL
   AND symbol != 'MES';

-- 3. GIN index for array containment queries (@>, <@, &&).
CREATE INDEX IF NOT EXISTS strategies_symbols_gin_idx
  ON strategies USING GIN (symbols);

COMMIT;
