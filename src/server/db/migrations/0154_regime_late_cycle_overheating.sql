-- Migration 0154: Add LATE_CYCLE_OVERHEATING to regime enum documentation
--
-- The 7th institutional regime: LATE_CYCLE_OVERHEATING.
-- Detected when:
--   ATR > 2.5× rolling-30-day avg
--   AND volume > 2× rolling-30-day avg
--   AND VIX-proxy ATR percentile > 80th percentile
--   AND multi-day melt-up > 5% in last 5 sessions
--
-- This regime routes to mean-reversion playbooks only (REDUCED_SIZING path).
-- Continuation/breakout strategies are suppressed — they blow up at the top.
-- Size multiplier: 0.5× (same as HIGH_VOL_MACRO + REDUCED_SIZING playbook).
--
-- bias_state.institutional_regime TEXT column already accepts any string
-- (migration 0142). No DDL change required. This migration registers the
-- extension in the migration history so the boot-migration-runner records it.
--
-- Idempotent: safe to run multiple times.

DO $$
BEGIN
  -- Extend the regime evidence column comment if bias_state.regime_evidence exists.
  -- This is a no-op on column comments — purely documentation.
  COMMENT ON TABLE bias_state IS
    'Bias engine state per session. institutional_regime values: TRENDING_UP | TRENDING_DOWN | RANGE_BOUND | EXPANSION | COMPRESSION | HIGH_VOL_MACRO | LOW_LIQ_CHOP | LATE_CYCLE_OVERHEATING | NO_TRADE';
EXCEPTION
  WHEN undefined_table THEN
    -- bias_state table may not exist in all environments (test DBs)
    NULL;
END;
$$;
