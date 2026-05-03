-- C11: Macro Regime Overlay (W18 Team A Step 2)
-- Two tables: macro_features (ingestion store) + macro_regime_states (HMM output)
--
-- Look-ahead safety design:
--   macro_features.publication_timestamp = when FRED/BLS/Treasury published it,
--   NOT the series_date the value applies to. Backtests must filter on
--   publication_timestamp <= simulated_now, not series_date.
--
-- Apply via direct SQL on Railway (drizzle-kit broken for this repo):
--   psql $DATABASE_URL -c "$(cat 0084_macro_features.sql)"

-- ─── macro_features ───────────────────────────────────────────────────────────
-- Stores every macro data observation with look-ahead-safe provenance.
-- Sources: FRED (daily), BLS (monthly releases), TreasuryDirect (auctions), H.4.1 (weekly)
CREATE TABLE IF NOT EXISTS macro_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id text NOT NULL,              -- e.g. T10Y2Y, DFF, VIXCLS, RRPONTSYD, NFP, CPI
  series_date date NOT NULL,            -- the date the value applies to
  publication_timestamp timestamp NOT NULL,  -- when this data became publicly available
                                             -- look-ahead barrier: backtests filter on this
  value numeric NOT NULL,
  revision_number integer NOT NULL DEFAULT 1,  -- 1=initial, 2=first revision, etc.
  source text NOT NULL,                 -- "fred" | "bls" | "treasury_direct"
  created_at timestamp DEFAULT now() NOT NULL,
  UNIQUE(series_id, series_date, revision_number)
);

-- Fast latest-value query per series (classifier reads most recent N days)
CREATE INDEX IF NOT EXISTS idx_macro_features_series_time
  ON macro_features(series_id, series_date DESC);

-- Look-ahead safety query index (filter by publication time in backtests)
CREATE INDEX IF NOT EXISTS idx_macro_features_publication
  ON macro_features(publication_timestamp DESC);

-- ─── macro_regime_states ─────────────────────────────────────────────────────
-- Stores daily HMM classification output (one row per trading day).
-- Written by macro-regime-service.ts after HMM classifier runs.
-- Read by:
--   - regime-state-service.ts (macro regime fusion with DeepAR)
--   - macro-gate-service.ts (hard gate evaluation)
--   - paper-signal-service.ts (entry blocking)
--   - sizing.py (FOMC size reduction)
CREATE TABLE IF NOT EXISTS macro_regime_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_date date NOT NULL,
  prob_growth numeric NOT NULL,         -- HMM P(Growth state)   0..1
  prob_inflation numeric NOT NULL,      -- HMM P(Inflation state) 0..1
  prob_crisis numeric NOT NULL,         -- HMM P(Crisis state)   0..1
  prob_easing numeric NOT NULL,         -- HMM P(Easing state)   0..1
  dominant_state text NOT NULL,         -- "Growth" | "Inflation" | "Crisis" | "Easing"
  crisis_gate_triggered boolean NOT NULL DEFAULT false,  -- prob_crisis > 0.60
  fomc_day_proximity integer,           -- days until (+) or since (-) next FOMC; null=unknown
  macro_release_day boolean NOT NULL DEFAULT false,  -- CPI/NFP/PPI published today?
  created_at timestamp DEFAULT now() NOT NULL,
  UNIQUE(state_date)
);

-- Fast current-state lookup (macro-gate-service reads today's row)
CREATE INDEX IF NOT EXISTS idx_macro_regime_states_date
  ON macro_regime_states(state_date DESC);

-- Active crisis gate fast query (paper-signal-service polls this)
CREATE INDEX IF NOT EXISTS idx_macro_regime_states_crisis
  ON macro_regime_states(crisis_gate_triggered, state_date DESC)
  WHERE crisis_gate_triggered = true;

COMMENT ON TABLE macro_features IS
  'C11: Look-ahead-safe macro data store. publication_timestamp is the barrier '
  'for backtest filters — never use series_date as the barrier.';

COMMENT ON TABLE macro_regime_states IS
  'C11: Daily 4-state HMM macro regime output. Read by macro-gate-service.ts '
  'and regime-state-service.ts. Updated nightly after FRED daily pull.';
