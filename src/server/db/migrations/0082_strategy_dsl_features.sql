-- C9: DSL Diversity Check (W17 Team B)
-- Stores compressed DSL feature vectors for pre-backtest template similarity detection.
-- Defense-in-depth complement to A7 (signal-correlation-service.ts):
--   A7 catches POST-backtest signal duplication (different code, same signals)
--   C9 catches PRE-backtest DSL template repetition (same code pattern, different name)
--
-- Feature vector contract:
--   Float32 array extracted from DSL fields:
--     [entry_indicator_bucket, exit_type_bucket, direction_bucket, symbol_bucket,
--      timeframe_bucket, regime_bucket, sl_atr_bucket, tp_atr_bucket,
--      ...entry_param_values (up to 5, padded with 0.0)...]
--   Total: 13 dimensions, gzip-compressed to bytea for storage.
--
-- Threshold: 0.85 cosine similarity → reject (env STRATEGY_DSL_SIMILARITY_THRESHOLD).
-- Lookback: last 50 strategies per check (ordered by created_at DESC).

CREATE TABLE IF NOT EXISTS strategy_dsl_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id uuid REFERENCES strategies(id) NOT NULL,
  feature_vector_compressed bytea NOT NULL,  -- gzip(float32[])
  feature_dim integer NOT NULL,              -- uncompressed vector length
  dsl_fingerprint text NOT NULL,             -- sha256(canonical DSL JSON) for fast exact-match
  created_at timestamp DEFAULT now() NOT NULL,
  UNIQUE(strategy_id)
);

-- Fast gate check: similarity scan over the last N strategies
CREATE INDEX IF NOT EXISTS idx_dsl_features_created ON strategy_dsl_features(created_at DESC);
-- Fast exact-match skip: if fingerprint already exists → reject immediately
CREATE INDEX IF NOT EXISTS idx_dsl_features_fingerprint ON strategy_dsl_features(dsl_fingerprint);
