-- ═══════════════════════════════════════════════════════════════════════════════
-- 0064: Lifecycle Transitions table (Tier 0.1, Gemini Quantum Blueprint W1)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Architect-flagged blocker: lifecycle history currently lives ONLY in
-- audit_log.action="strategy.lifecycle" JSONB blobs. JSONB is queryable but
-- not indexable for the high-volume quantum-agreement queries Tier 7
-- (graduation) needs. A first-class typed table with quantum_agreement_score
-- and quantum_advantage_delta columns makes "show me all strategies with low
-- quantum-classical agreement over 30 days" a single indexed SQL query.
--
-- Dual-write contract (lifecycle-service.ts):
--   Every successful state transition writes BOTH:
--     1. audit_log row with action="strategy.lifecycle" (existing, preserved)
--     2. lifecycle_transitions row (new, this table)
--   Both inserts run inside the same db.transaction() — synchronous, no
--   fire-and-forget. On rollback, neither row commits.
--
-- Quantum columns are nullable for now. Tier 1.1 (QAE shadow) will populate
-- them. Cloud QMC FK is documented but NOT installed at the column level
-- because cloud_qmc_runs table does not yet exist (lands in W4 / Tier 4.5).
-- Once that table ships, a follow-up migration will add the FK constraint
-- (cannot retroactively constrain a column that may already hold non-FK uuids,
-- but the column is reserved for that purpose).
--
-- Idempotent: IF NOT EXISTS guards every CREATE.

CREATE TABLE IF NOT EXISTS lifecycle_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id uuid NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  from_state text NOT NULL,
  to_state text NOT NULL,
  decision_authority text NOT NULL,           -- gate | human | scheduler | n8n | quantum_challenger
  reason text,
  backtest_id uuid REFERENCES backtests(id) ON DELETE SET NULL,
  forge_score numeric,
  mc_survival_rate numeric,
  -- Quantum challenger evidence (Tier 1.1+, populated as modules land)
  quantum_agreement_score numeric,            -- 0-1, how well classical and quantum agree
  quantum_advantage_delta numeric,            -- signed delta (quantum - classical)
  quantum_fallback_triggered boolean DEFAULT false,
  quantum_classical_disagreement_pct numeric,
  -- Reserved for W4/Tier 4.5 cloud_qmc_runs FK link.
  -- FK constraint deferred: column exists; constraint added once cloud_qmc_runs lands.
  cloud_qmc_run_id uuid,
  created_at timestamp DEFAULT now() NOT NULL
);

-- Recency index for "latest N transitions for strategy X" queries.
CREATE INDEX IF NOT EXISTS idx_lifecycle_transitions_strategy_created
  ON lifecycle_transitions(strategy_id, created_at DESC);

-- Partial index for graduation queries: only rows where quantum has actually
-- emitted an agreement score. Until Tier 1.1 lands, this index is empty —
-- which is correct (zero index maintenance cost while quantum is shadowed).
CREATE INDEX IF NOT EXISTS idx_lifecycle_transitions_quantum_agreement
  ON lifecycle_transitions(quantum_agreement_score)
  WHERE quantum_agreement_score IS NOT NULL;
