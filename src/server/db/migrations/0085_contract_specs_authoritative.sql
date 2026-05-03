-- W19 Schema 1: Authoritative Contract Specs from Databento Definition schema
-- Replaces hardcoded CONTRACT_SPECS in firm-config.ts with CME-sourced data.
-- Supports CME fee restructuring detection (e.g. Apex 4.0 EOD trail changes).
--
-- Apply via direct SQL on Railway (drizzle-kit broken for this repo):
--   psql $DATABASE_URL -c "$(cat 0085_contract_specs_authoritative.sql)"

CREATE TABLE IF NOT EXISTS contract_specs_authoritative (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,                -- e.g. 'ES', 'NQ', 'MES', 'MNQ', 'MCL'
  multiplier numeric NOT NULL,         -- dollar value per point (ES=$50, NQ=$20, etc.)
  tick_size numeric NOT NULL,          -- minimum price increment (ES=0.25, NQ=0.25, etc.)
  point_value numeric NOT NULL,        -- dollar value per full point = multiplier * tick_size / tick_value
  expiry_date date,                    -- nearest front-month expiry pulled from definition record
  pulled_at timestamp NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'databento_definition',
  raw_definition jsonb                 -- full Databento definition record for audit
);

-- One row per symbol per calendar day (function-based unique index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_specs_symbol_day
  ON contract_specs_authoritative(symbol, date_trunc('day', pulled_at));

-- Fast latest-spec lookup (contract-specs-service reads most recent row per symbol)
CREATE INDEX IF NOT EXISTS idx_contract_specs_symbol_pulled
  ON contract_specs_authoritative(symbol, pulled_at DESC);

COMMENT ON TABLE contract_specs_authoritative IS
  'W19 Schema 1: CME contract specifications pulled weekly from Databento Definition schema. '
  'Authoritative source for multiplier/tick_size/point_value. Falls back to firm-config.ts hardcoded values if empty.';
