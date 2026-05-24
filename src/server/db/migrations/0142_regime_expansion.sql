-- Migration 0142: regime_expansion
-- Wave 25 Pass 6 (W25.10) — 5-regime institutional expansion
--
-- Extends the bias_state table with:
--   1. regime_evidence JSONB  — captures raw metrics that drove the
--      classification (ATR percentile, volume ratio, gap status, etc.)
--      for forensic replay without re-running the engine.
--
-- NOTE: bias_state.regime_label is text (no CHECK constraint) — free-form
-- text already supports the 4 new regime tokens without schema change.
-- strategies.preferred_regimes is TEXT[] — array values are not constrained
-- by schema; runtime validation happens in direct-bucket-graduator.ts.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS

-- 1. Add regime_evidence JSONB column to bias_state
--    Shape (canonical, matches RegimeEvidence dataclass in bias_engine.py):
--    {
--      "atr_percentile_vs_30d": float,       -- [0,100] ATR rank vs 30-day lookback
--      "volume_ratio_vs_session_avg": float, -- ratio of current bar vol to session avg
--      "range_size_vs_atr": float,           -- bar range / current ATR (tight < 0.8)
--      "is_macro_event_day": bool,           -- from calendar/skipDecisions
--      "session_health": str,                -- "rth_open"|"rth_lunch"|"rth_close"|"globex"|"holiday"
--      "primary_driver": str                 -- which metric flipped the classification
--    }
ALTER TABLE bias_state
  ADD COLUMN IF NOT EXISTS regime_evidence JSONB;

-- 2. Index on session_health inside the JSONB for forensic queries
--    (e.g., "show me all Globex regimes this month")
CREATE INDEX IF NOT EXISTS idx_bias_state_regime_evidence_session_health
  ON bias_state ((regime_evidence->>'session_health'))
  WHERE regime_evidence IS NOT NULL;

-- 3. Index on primary_driver inside JSONB for regime classification audits
CREATE INDEX IF NOT EXISTS idx_bias_state_regime_evidence_primary_driver
  ON bias_state ((regime_evidence->>'primary_driver'))
  WHERE regime_evidence IS NOT NULL;
