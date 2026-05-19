-- Wave 5: Resilience — data quality checks
CREATE TABLE IF NOT EXISTS "data_quality_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "symbol" text NOT NULL,
  "timeframe" text NOT NULL,
  "check_type" text NOT NULL,
  "passed" boolean NOT NULL,
  "details" jsonb,
  "checked_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "data_quality_symbol_idx" ON "data_quality_checks" ("symbol");
