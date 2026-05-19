-- Migration 0068: cloud_qmc_runs table (Tier 4.5 W4 — Ising-encoded IBM QPU runs)
--
-- Stores async best-effort enrichment rows created AFTER classical TESTING→PAPER
-- promotion completes. NEVER a promotion gate — shadow-only challenger evidence.
--
-- Status lifecycle: queued → running → completed | failed | budget_exhausted
-- Governance: all rows carry governance_labels.decision_role = "challenger_only"
--
-- FK cloud_qmc_run_id in lifecycle_transitions (migration 0064) is intentionally
-- unconstrained at column level. This migration adds the FK constraint now that
-- the referenced table exists.

CREATE TABLE cloud_qmc_runs (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  backtest_id              uuid        REFERENCES backtests(id) NOT NULL,
  strategy_id              uuid        REFERENCES strategies(id) NOT NULL,
  backend_name             text        NOT NULL,        -- ibm_fez | ibm_kingston | ibm_marrakesh
  surface_code_distance    integer     NOT NULL,        -- always 3 in current implementation
  n_logical_qubits         integer     NOT NULL,        -- default 5 for IAE
  n_physical_qubits        integer     NOT NULL,        -- n_logical * 17 for d=3
  ibm_job_id               text,                        -- populated after IBM submission
  submitted_at             timestamp,
  completed_at             timestamp,
  qpu_seconds_used         numeric,                     -- actual QPU time consumed
  raw_syndrome_count       integer,                     -- number of distinct syndrome bitstrings
  ising_corrected_estimate numeric,                     -- Ising decoder logical error prob [0,1]
  pymatching_estimate      numeric,                     -- PyMatching MWPM baseline [0,1]
  uncorrected_estimate     numeric,                     -- raw syndrome error rate [0,1]
  agreement_with_classical numeric,                     -- |ising_corrected - classical_mc_ruin|
  agreement_with_local_iae numeric,                     -- |ising_corrected - local_iae_estimate|
  status                   text        NOT NULL DEFAULT 'queued',  -- queued | running | completed | failed | budget_exhausted
  error_message            text,
  governance_labels        jsonb       NOT NULL DEFAULT '{"experimental":true,"authoritative":false,"decision_role":"challenger_only"}',
  created_at               timestamp   NOT NULL DEFAULT now()
);

-- Indexes for lifecycle_transitions join and Tier 7 measurement queries
CREATE INDEX idx_cloud_qmc_runs_backtest    ON cloud_qmc_runs(backtest_id, created_at DESC);
CREATE INDEX idx_cloud_qmc_runs_strategy    ON cloud_qmc_runs(strategy_id, created_at DESC);
CREATE INDEX idx_cloud_qmc_runs_status      ON cloud_qmc_runs(status) WHERE status IN ('queued', 'running');
CREATE INDEX idx_cloud_qmc_runs_ibm_job_id  ON cloud_qmc_runs(ibm_job_id) WHERE ibm_job_id IS NOT NULL;

-- Add FK from lifecycle_transitions.cloud_qmc_run_id to cloud_qmc_runs.id
-- (The column was added with no FK in migration 0064 — now safe to add constraint)
ALTER TABLE lifecycle_transitions
  ADD CONSTRAINT fk_lifecycle_transitions_cloud_qmc_run
  FOREIGN KEY (cloud_qmc_run_id) REFERENCES cloud_qmc_runs(id)
  ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;
