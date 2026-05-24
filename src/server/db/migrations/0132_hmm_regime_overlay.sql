-- Migration 0132: HMM Regime Overlay advisory fields (W24-P2 Item 21, 2026-05-23)
--
-- Adds:
--   bias_state.hmm_probability_used  BOOLEAN NOT NULL DEFAULT false
--     True when the HMM overlay was computed for this bias_state row
--     (does NOT mean HMM overrode the decision — rule-based is always PRIMARY).
--
--   regime_hmm_models — stores serialised HMM parameters keyed by (symbol, fit_date).
--     Fitted weekly (Sunday 17:00 ET) so the overlay can run without live Python cost.
--     JSON blob = {means, covars, transmat, startprob, label_map, n_states}.
--
-- Both changes are idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

-- ── bias_state.hmm_probability_used ────────────────────────────────────────────
ALTER TABLE bias_state
  ADD COLUMN IF NOT EXISTS hmm_probability_used BOOLEAN NOT NULL DEFAULT false;

-- ── regime_hmm_models ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS regime_hmm_models (
  id            BIGSERIAL PRIMARY KEY,
  symbol        TEXT      NOT NULL,                         -- 'MES' | 'MNQ' | 'MCL'
  fit_date      DATE      NOT NULL,                         -- Sunday of weekly refit
  n_states      INTEGER   NOT NULL DEFAULT 3,
  params_json   JSONB     NOT NULL,                         -- serialised HmmRegimeModel
  bar_count     INTEGER,                                    -- bars used in training
  fit_duration_ms INTEGER,                                  -- wall-clock fit time
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT regime_hmm_models_symbol_fit_date_uq UNIQUE (symbol, fit_date)
);

CREATE INDEX IF NOT EXISTS regime_hmm_models_symbol_idx
  ON regime_hmm_models (symbol, fit_date DESC);
