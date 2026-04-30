-- Wave 2.4: Universal subsystem metrics collection
CREATE TABLE IF NOT EXISTS "subsystem_metrics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "subsystem" text NOT NULL,
  "metric_name" text NOT NULL,
  "metric_value" numeric NOT NULL,
  "tags" jsonb,
  "measured_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "subsystem_metrics_subsystem_idx" ON "subsystem_metrics" ("subsystem");
CREATE INDEX IF NOT EXISTS "subsystem_metrics_name_idx" ON "subsystem_metrics" ("metric_name");
CREATE INDEX IF NOT EXISTS "subsystem_metrics_measured_at_idx" ON "subsystem_metrics" ("measured_at");
CREATE INDEX IF NOT EXISTS "subsystem_metrics_subsystem_name_idx" ON "subsystem_metrics" ("subsystem", "metric_name");
