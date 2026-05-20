-- Migration 0125: Schema invariants — FK ON DELETE policy, UNIQUE constraints, partial indexes.
--
-- Bundles four production-grade DB fixes (no TZ conversions — those are in 0126):
--
--   F-1  lifecycle_transitions.strategy_id ON DELETE CASCADE → SET NULL
--        Audit trail must survive strategy archival. Matches forensics policy
--        established in migration 0052 for other audit-bearing tables.
--
--   F-2  compliance_rulesets UNIQUE (firm, account_type)
--        Without this, refresh-cycle races inserted duplicate rulesets and
--        readers silently picked arbitrary versions, bypassing drift detection.
--
--   F-3  paper_sessions: exactly one ACTIVE session per strategy
--        Partial unique index prevents fragmented equity tracking from
--        concurrent SSE / lifecycle paths spawning duplicate sessions.
--
--   F-6  paper_positions(session_id, symbol) WHERE closed_at IS NULL
--        Hot-path partial index for the open-positions lookup that runs on
--        every bar tick.
--
-- Idempotent on re-run (uses IF EXISTS / IF NOT EXISTS where the DDL supports it
-- and dedup pre-steps where it does not).
--
-- OPERATOR: run `npm run db:migrate`. Safe to apply independently of 0126.
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── F-1: lifecycle_transitions FK CASCADE → SET NULL ─────────────────────────
-- Drizzle-generated FK name is conventionally <table>_<column>_<reftable>_id_fk.
-- Use a defensive lookup so this works regardless of historical naming.
DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT conname INTO fk_name
  FROM pg_constraint
  WHERE conrelid = 'lifecycle_transitions'::regclass
    AND contype = 'f'
    AND conkey = ARRAY[
      (SELECT attnum FROM pg_attribute
       WHERE attrelid = 'lifecycle_transitions'::regclass
         AND attname = 'strategy_id')
    ];

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE lifecycle_transitions DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

-- strategy_id is no longer NOT NULL (schema.ts already drops .notNull()).
ALTER TABLE lifecycle_transitions ALTER COLUMN strategy_id DROP NOT NULL;

ALTER TABLE lifecycle_transitions
  ADD CONSTRAINT lifecycle_transitions_strategy_id_fkey
  FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE SET NULL;

-- ── F-2: compliance_rulesets UNIQUE (firm, account_type) ─────────────────────
-- Dedup pre-step: keep the most recently retrieved row per (firm, account_type).
DELETE FROM compliance_rulesets a
USING compliance_rulesets b
WHERE a.firm = b.firm
  AND a.account_type = b.account_type
  AND a.retrieved_at < b.retrieved_at;

-- Tie-break for identical retrieved_at: keep the lowest id (stable).
DELETE FROM compliance_rulesets a
USING compliance_rulesets b
WHERE a.firm = b.firm
  AND a.account_type = b.account_type
  AND a.retrieved_at = b.retrieved_at
  AND a.id > b.id;

ALTER TABLE compliance_rulesets
  DROP CONSTRAINT IF EXISTS compliance_rulesets_firm_account_unique;

ALTER TABLE compliance_rulesets
  ADD CONSTRAINT compliance_rulesets_firm_account_unique
  UNIQUE (firm, account_type);

-- ── F-3: paper_sessions one active per strategy ──────────────────────────────
-- Close older duplicate-active sessions first so the partial index can land.
WITH ranked AS (
  SELECT id,
         strategy_id,
         started_at,
         ROW_NUMBER() OVER (
           PARTITION BY strategy_id
           ORDER BY started_at DESC, id DESC
         ) AS rn
  FROM paper_sessions
  WHERE status = 'active'
)
UPDATE paper_sessions
SET status = 'stopped',
    stopped_at = COALESCE(stopped_at, NOW())
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

DROP INDEX IF EXISTS paper_sessions_one_active_per_strategy;

CREATE UNIQUE INDEX paper_sessions_one_active_per_strategy
  ON paper_sessions (strategy_id)
  WHERE status = 'active';

-- ── F-6: paper_positions partial index for open positions ────────────────────
DROP INDEX IF EXISTS paper_positions_open_idx;

CREATE INDEX paper_positions_open_idx
  ON paper_positions (session_id, symbol)
  WHERE closed_at IS NULL;

COMMIT;
