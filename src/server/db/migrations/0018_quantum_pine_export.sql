-- Quantum Risk Lab + Pine Export tables
-- Pass 1+2 of Quantum Risk Lab plan (2026-03-23)

CREATE TABLE IF NOT EXISTS "quantum_mc_runs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "backtest_id" uuid NOT NULL REFERENCES "backtests"("id"),
    "method" text NOT NULL,
    "backend" text,
    "num_qubits" integer,
    "estimated_value" numeric,
    "classical_value" numeric,
    "tolerance_delta" numeric,
    "within_tolerance" boolean,
    "confidence_interval" jsonb,
    "execution_time_ms" integer,
    "gpu_accelerated" boolean DEFAULT false,
    "governance_labels" jsonb NOT NULL DEFAULT '{}',
    "raw_result" jsonb,
    "reproducibility_hash" text,
    "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "quantum_mc_benchmarks" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "quantum_run_id" uuid NOT NULL REFERENCES "quantum_mc_runs"("id"),
    "classical_run_id" uuid REFERENCES "monte_carlo_runs"("id"),
    "metric" text NOT NULL,
    "quantum_value" numeric,
    "classical_value" numeric,
    "absolute_delta" numeric,
    "relative_delta" numeric,
    "tolerance_threshold" numeric,
    "passes" boolean,
    "notes" text,
    "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "strategy_exports" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "strategy_id" uuid NOT NULL REFERENCES "strategies"("id"),
    "export_type" text NOT NULL,
    "pine_version" text DEFAULT 'v6',
    "exportability_score" numeric,
    "exportability_details" jsonb,
    "status" text NOT NULL DEFAULT 'pending',
    "error_message" text,
    "prop_overlay_firm" text,
    "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "strategy_export_artifacts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "export_id" uuid NOT NULL REFERENCES "strategy_exports"("id") ON DELETE CASCADE,
    "artifact_type" text NOT NULL,
    "file_name" text NOT NULL,
    "content" text NOT NULL,
    "size_bytes" integer,
    "pine_version" text DEFAULT 'v6',
    "created_at" timestamp DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS "qmc_runs_backtest_idx" ON "quantum_mc_runs" USING btree ("backtest_id");
CREATE INDEX IF NOT EXISTS "qmc_runs_method_idx" ON "quantum_mc_runs" USING btree ("method");
CREATE INDEX IF NOT EXISTS "qmc_bench_quantum_run_idx" ON "quantum_mc_benchmarks" USING btree ("quantum_run_id");
CREATE INDEX IF NOT EXISTS "qmc_bench_metric_idx" ON "quantum_mc_benchmarks" USING btree ("metric");
CREATE INDEX IF NOT EXISTS "strat_exports_strategy_idx" ON "strategy_exports" USING btree ("strategy_id");
CREATE INDEX IF NOT EXISTS "strat_exports_status_idx" ON "strategy_exports" USING btree ("status");
CREATE INDEX IF NOT EXISTS "strat_export_artifacts_export_idx" ON "strategy_export_artifacts" USING btree ("export_id");
