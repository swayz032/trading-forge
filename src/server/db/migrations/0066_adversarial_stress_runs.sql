-- Migration 0066: adversarial_stress_runs table (Tier 3.4 Grover Adversarial Stress)
-- Challenger-only evidence table — governance_labels always enforces
--   experimental:true, authoritative:false, decision_role:challenger_only
-- Phase 0 shadow: lifecycle gate is 100% classical; this table is observation-only.
-- Phase 1 block (W7b Day 52): worst_case_breach_prob > 0.5 AND breach_minimal_n_trades < 4
--   will block TESTING->PAPER promotion ONLY after graduation from Phase 0.

CREATE TABLE adversarial_stress_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backtest_id uuid REFERENCES backtests(id) NOT NULL,
  strategy_id uuid REFERENCES strategies(id) NOT NULL,
  n_qubits integer NOT NULL DEFAULT 0,
  n_trades integer NOT NULL DEFAULT 0,
  daily_loss_limit numeric NOT NULL,
  worst_case_breach_prob numeric,              -- [0, 1]; NULL when status != completed
  breach_minimal_n_trades integer,             -- Smallest consecutive window that can breach
  worst_sequence_examples jsonb,               -- top-K breach orderings [{sequence, loss_sum, ...}]
  qpu_seconds numeric DEFAULT 0,              -- 0 for local sim; nonzero only for cloud QPU (future)
  wall_clock_ms integer,
  method text NOT NULL,                        -- grover_quantum | brute_force_classical | random_sample_classical
  status text NOT NULL DEFAULT 'pending',      -- pending | completed | failed | aborted
  error_message text,
  governance_labels jsonb DEFAULT '{"experimental":true,"authoritative":false,"decision_role":"challenger_only"}',
  created_at timestamp DEFAULT now() NOT NULL
);

-- Lookup by backtest (most common query: "what did adversarial stress find for this backtest?")
CREATE INDEX idx_adversarial_stress_backtest
  ON adversarial_stress_runs(backtest_id, created_at DESC);

-- Lookup by strategy (Tier 7 graduation queries — all runs for a strategy over 30d)
CREATE INDEX idx_adversarial_stress_strategy
  ON adversarial_stress_runs(strategy_id, created_at DESC);

-- Partial index for high-risk rows (Phase 1 decision rule queries)
CREATE INDEX idx_adversarial_stress_high_risk
  ON adversarial_stress_runs(worst_case_breach_prob, breach_minimal_n_trades)
  WHERE status = 'completed' AND worst_case_breach_prob IS NOT NULL;
