-- Migration 0072: strategy_signal_vectors table (A7 — Empirical Signal-Correlation Check)
--
-- Purpose: Store compressed per-bar signal vectors for every completed backtest.
-- Signal vector: int8 array per bar (1 = long entry, -1 = short entry, 0 = no signal).
-- Compressed with gzip (Node zlib.gzipSync) before storage.
--
-- Why: Two Sigma 2025 — $165M loss from attestation-based uniqueness checks on model
-- outputs. LLM-generated strategies have the same failure mode: different code, identical
-- signals. Post-backtest cosine similarity on actual signal vectors catches this.
--
-- Downstream:
--   signal-correlation-service.ts — pairwise cosine similarity, alert if any pair > 0.85
--   lifecycle-service.ts — PAPER→DEPLOY_READY hard gate (fail-closed if missing vector)
--   GET /api/signal-correlation/matrix — visual matrix for human review
--
-- Authority: HARD GATE at PAPER→DEPLOY_READY (fail-closed if signal vector missing).
--   Does NOT replace classical performance gates — additive gate only.
--
-- Drizzle-kit note: drizzle-kit is broken against Railway (confirmed W10 audit).
-- This migration is applied via client.unsafe(sql) in the db:migrate path or
-- directly via the Railway console. The drizzle journal entry is added manually.
--
-- UNIQUE(strategy_id, backtest_id): one vector per (strategy, backtest) pair.
-- Multiple backtests for the same strategy are fine — gate uses the LATEST completed one.

CREATE TABLE IF NOT EXISTS strategy_signal_vectors (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id             uuid REFERENCES strategies(id) NOT NULL,
  backtest_id             uuid REFERENCES backtests(id) NOT NULL,
  signal_vector_compressed bytea NOT NULL,   -- gzip(int8[] as bytes): 1=long, -1=short, 0=none
  n_bars                  integer NOT NULL,  -- number of bars in the uncompressed vector
  created_at              timestamp DEFAULT now() NOT NULL,
  UNIQUE(strategy_id, backtest_id)
);

-- Fast lookup by strategy (gate check: "does this strategy have a signal vector?")
CREATE INDEX IF NOT EXISTS idx_signal_vectors_strategy
  ON strategy_signal_vectors(strategy_id, created_at DESC);

-- Fast lookup by backtest (for joining to the latest completed backtest)
CREATE INDEX IF NOT EXISTS idx_signal_vectors_backtest
  ON strategy_signal_vectors(backtest_id);
