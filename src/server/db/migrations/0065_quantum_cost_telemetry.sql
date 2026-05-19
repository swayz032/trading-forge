-- ═══════════════════════════════════════════════════════════════════════════════
-- 0065: Quantum Run Costs telemetry table (Tier 0.2, Gemini Quantum Blueprint W1)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Plan agent flag: every quantum module must emit per-run wall-clock + (if
-- cloud) QPU-seconds + dollars. Without a typed cost table, "is quantum worth
-- the compute?" is unanswerable at graduation time (Tier 7 / W7a).
--
-- Module names (write side, populated as W2/W3/W4 modules ship):
--   quantum_mc          — IAE / target-hit estimation (existing module)
--   sqa                 — Simulated Quantum Annealing (existing)
--   rl_agent            — Quantum RL parameter search (existing)
--   entropy_filter      — QCNN-style noise score (W3a / Tier 3.1, future)
--   adversarial_stress  — Grover worst-case sequencer (W3b / Tier 3.4, future)
--   cloud_qmc           — IBM/Braket QPU runs (W4 / Tier 4.5, future)
--   ising_decoder       — Surface-code calibration (W4 / Tier 4.5, future)
--
-- Pending-row contract (per CLAUDE.md "Fire-and-Forget Tracking" pattern):
--   status starts as "pending" on insert (before Python subprocess spawn),
--   updated to "completed" or "failed" on resolve. Restart-safe.
--
-- FK posture: SET NULL on delete (forensics/audit pattern from PRODUCTION-
-- HARDENING.md Wave 4 #17). Cost rows MUST outlive the backtests/strategies
-- they reference — they are the audit trail for graduation decisions.
--
-- Idempotent: IF NOT EXISTS guards every CREATE.

CREATE TABLE IF NOT EXISTS quantum_run_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_name text NOT NULL,            -- see comment above for canonical names
  backtest_id uuid REFERENCES backtests(id) ON DELETE SET NULL,
  strategy_id uuid REFERENCES strategies(id) ON DELETE SET NULL,
  wall_clock_ms integer NOT NULL,
  qpu_seconds numeric DEFAULT 0,        -- only nonzero for cloud QPU runs
  cost_dollars numeric DEFAULT 0,       -- only nonzero for paid cloud
  cache_hit boolean DEFAULT false,
  status text NOT NULL,                 -- pending | completed | failed
  error_message text,
  created_at timestamp DEFAULT now() NOT NULL
);

-- "What did each module cost over the last N days?" — single index covers
-- the dashboard queries graduation will run at W7a/W7c.
CREATE INDEX IF NOT EXISTS idx_quantum_run_costs_module_created
  ON quantum_run_costs(module_name, created_at DESC);
