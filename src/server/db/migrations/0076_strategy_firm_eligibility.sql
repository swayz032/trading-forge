-- Migration 0076: strategy_firm_eligibility (B5 — Auto-promotion multi-firm pipeline)
--
-- Purpose: Record per-firm deployment eligibility for every strategy that reaches
-- DEPLOY_READY. One row per (strategy_id, firm_id) tuple. Populated by
-- multi-firm-promotion-service.ts fire-and-forget after successful PAPER →
-- DEPLOY_READY promotion in lifecycle-service.ts.
--
-- Design decisions:
--   - NOT a gate. Does not block PAPER → DEPLOY_READY. Records results for human review.
--   - Independent per firm: one firm failing ≠ all firms failing.
--   - complianceCheckResult JSONB stores the full per-firm check output for debuggability.
--   - Index on (strategyId, firmId) for promotion-input queries (one lookup per firm).
--   - Index on eligible for "show all firms this strategy can deploy to" dashboard views.
--
-- Apply via Railway direct SQL (drizzle-kit migrate is broken per W10/W11 audits).

CREATE TABLE IF NOT EXISTS strategy_firm_eligibility (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id     uuid        NOT NULL REFERENCES strategies(id),
  firm_id         text        NOT NULL,  -- topstep | apex | mffu | tpt | ffn | alpha | tradeify | earn2trade
  eligible        boolean     NOT NULL,
  eligibility_reason text,               -- human-readable pass/fail reason
  compliance_check_result jsonb,         -- full per-firm compliance_gate.py output for audit
  checked_at      timestamp   NOT NULL DEFAULT now()
);

-- Lookup index: "which firms is this strategy eligible for?"
CREATE INDEX IF NOT EXISTS idx_sfe_strategy_firm
  ON strategy_firm_eligibility(strategy_id, firm_id);

-- Dashboard index: "all eligible rows for a strategy"
CREATE INDEX IF NOT EXISTS idx_sfe_strategy_eligible
  ON strategy_firm_eligibility(strategy_id, eligible);

-- Recency index: "latest check per strategy"
CREATE INDEX IF NOT EXISTS idx_sfe_checked_at
  ON strategy_firm_eligibility(strategy_id, checked_at DESC);
