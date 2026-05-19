-- Migration 0089: Prop-Firm Survival Twin (W20 / B14)
--
-- Purpose: Persist per-firm adversarial-behavior priors (Apex May 2025 mass
-- profitable-trader ban, MFFU 2023-2025 fund freezes, "VPN-detected" payout
-- denials, etc.) and extend the existing strategy_firm_eligibility table
-- with optional survival-probability columns so the B14 survival twin can
-- record per-strategy survival curves without disturbing B5 multi-firm
-- promotion behavior.
--
-- Lifecycle integration:
--   Phase 0 (Day 0-60): challenger_only / advisory. Survival probability is
--     computed and persisted alongside eligibility; lifecycle gate logs at
--     WARN when p_180d < 0.50 but never blocks promotion.
--   Phase 1 (Day 60+): tiebreaker in /api/prop-firm/rank. When ROI deltas
--     are close, the higher-survival eligible firm is preferred.
--
-- Authority surface:
--   firm_adversarial_priors          — manual + recalibrated priors (LOWEST
--                                       authority is manual_seed; observed
--                                       prop_firm_health_checks history
--                                       overrides as evidence accumulates).
--   strategy_firm_eligibility (new   — additive only. survivalProbability,
--   columns)                            survivalCurve, survivalEvidenceWeight,
--                                       survivalLastFittedAt are all NULLABLE
--                                       so existing B5 reads (pre-B14 rows)
--                                       continue to work unchanged.
--
-- Additive only: no destructive ops anywhere in this migration.
--   - CREATE TABLE for the new priors table
--   - ADD COLUMN IF NOT EXISTS for the four new optional columns
--   - All existing eligibility rows survive with new columns defaulting to NULL
--
-- Apply via direct SQL on Railway (drizzle-kit broken for this repo):
--   node scripts/apply-w20-migration.mjs

CREATE TABLE IF NOT EXISTS firm_adversarial_priors (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id             text NOT NULL,                            -- mffu | topstep (legacy firms removed via migration 0097)
  event_type          text NOT NULL,                            -- account_suspension | payout_denial | fund_freeze | profitable_trader_ban | vpn_detection
  base_rate           numeric(5,4) NOT NULL,                    -- 0.0000-1.0000 — probability per 30-day window
  evidence_weight     integer NOT NULL DEFAULT 0,               -- count of dispute events factored in
  evidence_sources    jsonb,                                    -- array of { source, url, observed_at, severity }
  last_observed_at    timestamp,
  fit_method          text NOT NULL DEFAULT 'manual_seed',      -- manual_seed | health_check_history | dashboard_anomaly
  last_fitted_at      timestamp NOT NULL DEFAULT now(),
  created_at          timestamp NOT NULL DEFAULT now(),
  updated_at          timestamp NOT NULL DEFAULT now(),
  CONSTRAINT idx_firm_priors_unique UNIQUE(firm_id, event_type)
);

-- Per-firm prior lookup (hot path: survival service reads all priors for a firm)
CREATE INDEX IF NOT EXISTS idx_firm_priors_firm
  ON firm_adversarial_priors(firm_id);

-- Cross-firm event-type rollups ("which firms have profitable_trader_ban risk?")
CREATE INDEX IF NOT EXISTS idx_firm_priors_event
  ON firm_adversarial_priors(event_type);

-- Recency scan ("most recently fitted priors" for staleness checks)
CREATE INDEX IF NOT EXISTS idx_firm_priors_recent
  ON firm_adversarial_priors(last_fitted_at DESC);

-- Additive columns on existing strategy_firm_eligibility (B5 W13 table).
-- All NULLABLE so pre-B14 rows remain valid and existing B5 reads ignore them.
-- survival_curve shape: { p_30d: 0.97, p_90d: 0.91, p_180d: 0.83, p_365d: 0.71 }
ALTER TABLE strategy_firm_eligibility
  ADD COLUMN IF NOT EXISTS survival_probability numeric(5,4);
ALTER TABLE strategy_firm_eligibility
  ADD COLUMN IF NOT EXISTS survival_curve jsonb;
ALTER TABLE strategy_firm_eligibility
  ADD COLUMN IF NOT EXISTS survival_evidence_weight integer;
ALTER TABLE strategy_firm_eligibility
  ADD COLUMN IF NOT EXISTS survival_last_fitted_at timestamp;

COMMENT ON TABLE firm_adversarial_priors IS
  'W20 / B14: Per-firm adversarial-behavior priors (account_suspension, '
  'payout_denial, fund_freeze, profitable_trader_ban, vpn_detection). '
  'fit_method=manual_seed is the lowest-authority input; observed '
  'prop_firm_health_checks history and dashboard_snapshots evidence override '
  'as data accumulates. UNIQUE(firm_id, event_type) enforced. See CLAUDE.md '
  '"Prop-Firm Survival Twin" section for governance.';
