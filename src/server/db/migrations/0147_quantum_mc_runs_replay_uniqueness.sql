-- Migration 0147: quantum_mc_runs replay-row uniqueness
--
-- Problem: db_loader.py write_replay_row() used ON CONFLICT (id) DO NOTHING where
-- id is a fresh UUID on every call — the clause never fires as semantic deduplication.
-- The docstring correctly described the intent (backtest_id, method, reproducibility_hash)
-- but no DB-level constraint existed to enforce it.
--
-- Race condition: With Pass 1.5 auto-fire, multiple backtests can complete
-- simultaneously, each spawning a replay subprocess.  Without DB-level uniqueness,
-- concurrent INSERTs with the same (backtest_id, method, reproducibility_hash) would
-- create duplicate rows even if the SELECT-before-INSERT app check is bypassed under
-- contention.
--
-- Fix: Add a partial unique index restricted to replay rows
-- (governance_labels->>'replay_mode' = 'true').  Live cloud QMC rows are intentionally
-- excluded — they have valid duplicates by design (same strategy, different cloud run).
--
-- The partial index matches the ON CONFLICT clause added in db_loader.py line ~809:
--   ON CONFLICT (backtest_id, method, reproducibility_hash)
--   WHERE governance_labels->>'replay_mode' = 'true'
--   DO NOTHING
--
-- Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS

CREATE UNIQUE INDEX IF NOT EXISTS qmc_runs_replay_uniqueness_idx
    ON quantum_mc_runs (backtest_id, method, reproducibility_hash)
    WHERE governance_labels->>'replay_mode' = 'true';
