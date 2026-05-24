-- Migration 0141: trade_critique table
-- Wave 26 Pass 1 — event-driven trade critique service
--
-- Soft FK to paper_positions (no hard FK — Wave 25 is still mutating
-- paper_positions schema; add FK constraint in a follow-up migration once
-- Wave 25 schema is stable).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS

CREATE TABLE IF NOT EXISTS trade_critique (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id          UUID NOT NULL,
  session_id           UUID,
  account_id           UUID,
  strategy_id          UUID,
  critiqued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  grade                TEXT NOT NULL,
  technical_diagnosis  JSONB NOT NULL,
  plain_english_summary JSONB NOT NULL,
  data_completeness    TEXT NOT NULL DEFAULT 'full',
  missing_fields       TEXT[] NOT NULL DEFAULT '{}',
  provider             TEXT NOT NULL,
  model                TEXT NOT NULL,
  correlation_id       TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trade_critique_position_id
  ON trade_critique (position_id);

CREATE INDEX IF NOT EXISTS idx_trade_critique_account_strategy
  ON trade_critique (account_id, strategy_id, critiqued_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_critique_grade
  ON trade_critique (grade)
  WHERE grade IN ('D','F');
