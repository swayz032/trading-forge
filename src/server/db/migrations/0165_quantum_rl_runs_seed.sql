-- Wave A Fix 8 — quantum_rl_runs: add seed column for reproducibility
--
-- The training seed used per regime-conditioned policy training run was not
-- persisted, making replay-grading non-reproducible: two independent callers
-- with the same strategy_id could not reconstruct the same policy gradient path.
--
-- This column is NULLABLE so existing rows (before this migration) are
-- backward-compatible. New training runs write the seed via INSERT.
--
-- Coordination note:
--   Claimed idx 165. Next available idx after 0164_slumhouse_users (idx 164).
--   Journal entry added in meta/_journal.json in the same commit per
--   BOOT_MIGRATION_ENABLED=true pinned fact (CLAUDE.md §2).
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS.

ALTER TABLE quantum_rl_runs
    ADD COLUMN IF NOT EXISTS seed INTEGER;

COMMENT ON COLUMN quantum_rl_runs.seed IS
    'RNG seed used for this training run batch. NULL for rows written before '
    'migration 0165. Enables deterministic replay-grading across sessions. '
    'Wave A Fix 8 (2026-06-22).';
