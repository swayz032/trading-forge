-- Wave 29 Pass B.1 — frozen-policy contract per CFA Institute Nov 2025 institutional 2026 mandate.
--
-- PURPOSE:
--   When CPCV + PBO + WFE gates ALL pass for a strategy, the winning parameter set is
--   "frozen" by stamping a SHA-256 hash of the canonical-sorted-JSON of the frozen
--   parameter set.  Subsequent re-optimization requires an operator HMAC override with
--   rationale ≥50 chars.
--
--   Also records `regime_trained_on` (institutional_regime at time of last full CPCV) so
--   that the Pass B.3 regime-drift-detector cron can compare against the current live
--   institutional_regime and auto-demote DEPLOYED → TESTING when persistent drift is
--   detected (≥5 consecutive days different).
--
-- REFERENCE:
--   CFA Institute Halperin/Kolm/Ritter (2025-11-18) — "Frozen-policy OOS contract is
--   the institutional 2026 mandate to prevent silent retraining drift."
--   Resonanz Capital DD framework (2026-02-10) — operator-HMAC override audit trail.
--
-- IDEMPOTENT: safe to re-run (ALTER TABLE ... ADD COLUMN IF NOT EXISTS for all 4 columns).
--
-- COLUMNS ADDED (strategies table):
--   frozen_policy_hash           TEXT NULL        — SHA-256 hex of canonical-sorted-JSON
--                                                   of the frozen parameter set; NULL until
--                                                   first freeze (CPCV+PBO+WFE all pass).
--   frozen_policy_set_at         TIMESTAMPTZ NULL — wall-clock UTC timestamp when the
--                                                   freeze was committed; NULL until freeze.
--   regime_trained_on            TEXT NULL        — institutional_regime value at time of
--                                                   last full CPCV run; feeds B.3 drift
--                                                   detector.  Values: TRENDING |
--                                                   RANGE_BOUND | HIGH_VOL_MACRO |
--                                                   COMPRESSION | EXPANSION | LOW_LIQ_CHOP.
--   frozen_policy_override_count INTEGER NOT NULL — incremented by 1 on each operator
--                                DEFAULT 0          HMAC override.  Observability signal for
--                                                   regime-drift audit trail.

-- ── 1. frozen_policy_hash ────────────────────────────────────────────────────────
ALTER TABLE strategies
    ADD COLUMN IF NOT EXISTS frozen_policy_hash TEXT NULL;

COMMENT ON COLUMN strategies.frozen_policy_hash IS
    'Wave 29 Pass B.1. SHA-256 hex of canonical-sorted-JSON of the frozen parameter set '
    '({entry_quality, position_size, stop_loss, take_profit, exit_plan_config}). '
    'NULL until first freeze (all of CPCV + PBO < 15% + WFE ≥ 0.70 pass simultaneously). '
    'Re-optimization requires POST /api/admin/frozen-policy-override with HMAC + rationale ≥50 chars. '
    'CFA Institute Halperin/Kolm/Ritter Nov 2025 institutional 2026 mandate.';

-- ── 2. frozen_policy_set_at ──────────────────────────────────────────────────────
ALTER TABLE strategies
    ADD COLUMN IF NOT EXISTS frozen_policy_set_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN strategies.frozen_policy_set_at IS
    'Wave 29 Pass B.1. UTC timestamp when frozen_policy_hash was first committed. '
    'NULL until first freeze. Updated on each valid HMAC override (re-freeze). '
    'Used with frozen_policy_override_count for audit timeline reconstruction.';

-- ── 3. regime_trained_on ─────────────────────────────────────────────────────────
ALTER TABLE strategies
    ADD COLUMN IF NOT EXISTS regime_trained_on TEXT NULL;

COMMENT ON COLUMN strategies.regime_trained_on IS
    'Wave 29 Pass B.1. institutional_regime value at time of the last full CPCV run. '
    'Values: TRENDING | RANGE_BOUND | HIGH_VOL_MACRO | COMPRESSION | EXPANSION | LOW_LIQ_CHOP. '
    'NULL for strategies that predate Wave 29 (no CPCV regime context recorded). '
    'Wave 29 Pass B.3 regime-drift-detector cron compares this against current '
    'institutional_regime; ≥5 consecutive days different → auto-demote DEPLOYED → TESTING '
    'with lifecycle.regime_drift_demotion audit + Discord WARN.';

-- ── 4. frozen_policy_override_count ─────────────────────────────────────────────
ALTER TABLE strategies
    ADD COLUMN IF NOT EXISTS frozen_policy_override_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN strategies.frozen_policy_override_count IS
    'Wave 29 Pass B.1. Incremented by 1 on each successful operator HMAC override '
    '(POST /api/admin/frozen-policy-override with rationale ≥50 chars). '
    'NOT NULL DEFAULT 0: strategies with no overrides read as 0 without NULL handling. '
    'Observability signal: high count indicates frequent re-optimization; '
    'Prometheus counter tf_frozen_policy_overrides_total{strategy_id} mirrors this for alerting.';
