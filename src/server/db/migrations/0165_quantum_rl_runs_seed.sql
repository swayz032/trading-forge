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
--
-- GO-LIVE UNBLOCK (autonomous-readiness fix, 2026-06-22):
--   quantum_rl_runs does NOT exist in prod — migration 0158 was rewritten after
--   it was first applied (old form created rl_training_runs), so the runner sees
--   0158 as applied (by journal hash/when) and never re-runs the corrected file.
--   This left 0165's bare ALTER to throw `relation "quantum_rl_runs" does not exist`
--   at first apply — and since the boot-migration-runner is fail-CLOSED (throws to
--   block boot), that collision would HALT the entire go-live deploy: API won't boot,
--   no subsequent migration applies. Self-contain the table CREATE here so 0165
--   applies cleanly regardless of 0158's drift. Full def mirrors 0158_quantum_rl_runs.sql.
CREATE TABLE IF NOT EXISTS quantum_rl_runs (
    id                      BIGSERIAL PRIMARY KEY,
    strategy_id             UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
    evaluated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    regime                  TEXT NOT NULL,
    state_vector            JSONB NOT NULL,
    action                  TEXT NOT NULL,
    confidence_score        REAL NOT NULL,
    effective_confidence    REAL NOT NULL,
    reward                  REAL NOT NULL,
    ci_high_at_evaluation   REAL,
    drawdown_penalty        REAL,
    governance_labels       JSONB NOT NULL,
    cpcv_fold_id            INTEGER,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE quantum_rl_runs
    ADD COLUMN IF NOT EXISTS seed INTEGER;

COMMENT ON COLUMN quantum_rl_runs.seed IS
    'RNG seed used for this training run batch. NULL for rows written before '
    'migration 0165. Enables deterministic replay-grading across sessions. '
    'Wave A Fix 8 (2026-06-22).';
