-- Wave 4: Automation Completeness — n8n tracking, DeepAR versioning

CREATE TABLE IF NOT EXISTS "n8n_execution_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workflow_id" text NOT NULL,
  "workflow_name" text NOT NULL,
  "execution_id" text,
  "status" text NOT NULL,
  "started_at" timestamp,
  "finished_at" timestamp,
  "duration_ms" integer,
  "error_message" text,
  "trigger_type" text,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "n8n_exec_workflow_idx" ON "n8n_execution_log" ("workflow_id");
CREATE INDEX IF NOT EXISTS "n8n_exec_status_idx" ON "n8n_execution_log" ("status");

CREATE TABLE IF NOT EXISTS "deepar_model_registry" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "version_hash" text NOT NULL,
  "training_run_id" uuid,
  "model_path" text NOT NULL,
  "validation_loss" numeric,
  "avg_hit_rate_30d" numeric,
  "status" text DEFAULT 'active' NOT NULL,
  "promoted_at" timestamp,
  "demoted_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "deepar_registry_status_idx" ON "deepar_model_registry" ("status");
