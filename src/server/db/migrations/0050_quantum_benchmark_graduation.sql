ALTER TABLE quantum_mc_benchmarks
  ADD COLUMN IF NOT EXISTS workload_key text DEFAULT 'portfolio_tail_risk',
  ADD COLUMN IF NOT EXISTS baseline_runtime_ms integer,
  ADD COLUMN IF NOT EXISTS quantum_runtime_ms integer,
  ADD COLUMN IF NOT EXISTS baseline_cost numeric,
  ADD COLUMN IF NOT EXISTS quantum_cost numeric,
  ADD COLUMN IF NOT EXISTS decision_delta numeric,
  ADD COLUMN IF NOT EXISTS paper_impact_delta numeric,
  ADD COLUMN IF NOT EXISTS maturity_level text DEFAULT 'shadow',
  ADD COLUMN IF NOT EXISTS benchmark_pass_status text DEFAULT 'failed';

CREATE INDEX IF NOT EXISTS qmc_bench_workload_idx ON quantum_mc_benchmarks (workload_key);
