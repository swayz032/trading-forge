-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0115 — Wave 23D Carry-Forward: harsh_regime_phase activation table
-- 2026-05-19
--
-- Context: Wave 23 Pass 1 Track 23.D shipped the harsh-regime survival gate as
-- SOFT advisory (Phase 0). The carry-forward required a DB-persistent phase
-- tracker so the activation is auditable, survives pm2 reloads, and can be
-- reviewed by the operator. This migration creates that table.
--
-- Design decisions:
--   - Singleton table (one row, id=1). Only ever ONE phase record.
--   - phase: "advisory" | "hard" — irreversible under normal operation.
--   - activated_at / first_strategy_id / activated_by capture the evidence trail.
--   - Manual rollback only via POST /api/admin/harsh-regime-phase with reason.
--   - NOT using system_state: productionMode is operationally unrelated. Separate
--     table keeps concerns clean and makes the audit trail unambiguous.
--
-- Idempotent: all statements are conditional.
-- Operator: npm run db:migrate (or Railway Postgres apply).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS harsh_regime_phase (
  id             INTEGER PRIMARY KEY DEFAULT 1,
  phase          TEXT    NOT NULL    DEFAULT 'advisory',   -- 'advisory' | 'hard'
  activated_at   TIMESTAMPTZ,                              -- when phase flipped to 'hard'
  first_strategy_id UUID,                                  -- strategy whose 90-day activation triggered the flip
  activated_by   TEXT    NOT NULL    DEFAULT 'system',     -- 'cron_auto' | 'operator_override_admin'
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure the singleton row exists immediately after migration
INSERT INTO harsh_regime_phase (id, phase, activated_at, first_strategy_id, activated_by, updated_at)
VALUES (1, 'advisory', NULL, NULL, 'system', NOW())
ON CONFLICT (id) DO NOTHING;

-- Index for quick single-row reads (mostly a signal to query planners)
CREATE INDEX IF NOT EXISTS idx_harsh_regime_phase_id
  ON harsh_regime_phase(id);

-- Comment for future operators reading raw schema
COMMENT ON TABLE harsh_regime_phase IS
  'Singleton (id=1). Tracks whether the harsh-regime survival gate at TESTING→PAPER '
  'is in advisory (soft) or hard (blocking) phase. Set by the daily '
  'harsh-regime-phase-activation-check cron after 90 days of PAPER activation data, '
  'or manually via POST /api/admin/harsh-regime-phase. Irreversible under normal '
  'operation — manual override requires explicit reason in audit_log.';

COMMENT ON COLUMN harsh_regime_phase.phase IS
  'advisory = gate fires but never blocks promotion. '
  'hard = gate blocks TESTING→PAPER when any regime fails.';

COMMENT ON COLUMN harsh_regime_phase.first_strategy_id IS
  'UUID of the strategy whose lifecycle_transitions row (to_state=PAPER) had the '
  'earliest created_at >= 90 days ago, triggering the phase flip.';

COMMIT;
