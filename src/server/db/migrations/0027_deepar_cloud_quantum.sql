-- Migration 0027: DeepAR forecasting tables + cloud quantum metadata

CREATE TABLE IF NOT EXISTS deepar_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_date date NOT NULL,
  generated_at timestamp DEFAULT now(),
  symbol text NOT NULL,
  prediction_horizon integer DEFAULT 5,
  p_high_vol numeric,
  p_trending numeric,
  p_mean_revert numeric,
  p_correlation_stress numeric,
  forecast_confidence numeric,
  quantile_p10 numeric,
  quantile_p50 numeric,
  quantile_p90 numeric,
  actual_regime text,
  hit_rate numeric,
  model_version text,
  governance_labels jsonb NOT NULL DEFAULT '{"experimental":true,"authoritative":false,"decision_role":"challenger_only"}'
);

CREATE INDEX IF NOT EXISTS deepar_forecasts_symbol_idx ON deepar_forecasts (symbol);
CREATE INDEX IF NOT EXISTS deepar_forecasts_date_idx ON deepar_forecasts (forecast_date);

CREATE TABLE IF NOT EXISTS deepar_training_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trained_at timestamp DEFAULT now(),
  symbols jsonb,
  data_range_start date,
  data_range_end date,
  epochs integer,
  training_loss numeric,
  validation_loss numeric,
  model_path text,
  duration_ms integer,
  status text NOT NULL DEFAULT 'pending',
  governance_labels jsonb NOT NULL DEFAULT '{"experimental":true,"authoritative":false,"decision_role":"challenger_only"}'
);

CREATE INDEX IF NOT EXISTS deepar_training_status_idx ON deepar_training_runs (status);

ALTER TABLE quantum_mc_runs ADD COLUMN IF NOT EXISTS cloud_provider text;
ALTER TABLE quantum_mc_runs ADD COLUMN IF NOT EXISTS cloud_backend_name text;
ALTER TABLE quantum_mc_runs ADD COLUMN IF NOT EXISTS cloud_job_id text;
ALTER TABLE quantum_mc_runs ADD COLUMN IF NOT EXISTS cloud_qpu_time_seconds numeric;
ALTER TABLE quantum_mc_runs ADD COLUMN IF NOT EXISTS cloud_cost_dollars numeric;
ALTER TABLE quantum_mc_runs ADD COLUMN IF NOT EXISTS cloud_region text;

ALTER TABLE quantum_mc_benchmarks ADD COLUMN IF NOT EXISTS backend_type text;
