-- Migration 0070: backtest_provenance table (A2 — Backtest Provenance Tracking)
--
-- Purpose: record the inputs that produced every backtest result so drift can
-- be detected when re-running identical inputs produces a different result_hash.
--
-- Design notes:
--   - data_hash: SHA-256 of the raw market data slice used (symbol+range+timeframe).
--   - code_git_sha: git HEAD SHA at backtest time. Set by backtest-service.ts from
--     the FORGE_GIT_SHA env var (injected by the deploy pipeline) or falls back
--     to the runtime git rev-parse output.
--   - strategy_hash: SHA-256 of the canonical strategy DSL JSON (mirrors the
--     pre-flight cache key used in quantum-pre-flight.ts).
--   - result_hash: SHA-256 of canonicalize_result() output (Python determinism.py).
--     With determinism enforced (DETERMINISM_MODE=true), identical inputs produce
--     identical result_hash values. Divergent hashes signal nondeterminism.
--   - python_version / numpy_version: captured at backtest run time for
--     environment reproducibility auditing.
--   - determinism_env_set: true when DETERMINISM_MODE=true was set on the Python
--     subprocess — confirms the hash is comparable across runs.
--
-- Drift query (canonical — run in Drizzle Studio or pg admin):
--   SELECT data_hash, code_git_sha, strategy_hash,
--          count(DISTINCT result_hash) AS distinct_hashes,
--          array_agg(backtest_id ORDER BY created_at) AS backtest_ids
--   FROM backtest_provenance
--   GROUP BY data_hash, code_git_sha, strategy_hash
--   HAVING count(DISTINCT result_hash) > 1;
-- If any row appears: nondeterminism detected. Backtest IDs are the divergent runs.

CREATE TABLE backtest_provenance (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backtest_id          uuid REFERENCES backtests(id) NOT NULL,
  data_hash            text NOT NULL,
  code_git_sha         text NOT NULL,
  strategy_hash        text NOT NULL,
  result_hash          text NOT NULL,
  python_version       text,
  numpy_version        text,
  determinism_env_set  boolean,
  created_at           timestamp DEFAULT now() NOT NULL
);

-- Composite index for the drift detection query:
--   WHERE data_hash = $1 AND code_git_sha = $2 AND strategy_hash = $3
-- Also used by result-hasher.ts to check if a provenance row already exists
-- for a given (data_hash, code_git_sha, strategy_hash) triple before inserting.
CREATE INDEX idx_backtest_provenance_lookup
  ON backtest_provenance(data_hash, code_git_sha, strategy_hash);

-- Fast lookup by backtest (for "what provenance does this backtest have?")
CREATE INDEX idx_backtest_provenance_backtest_id
  ON backtest_provenance(backtest_id);
