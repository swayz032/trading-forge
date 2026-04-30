-- Wave 1: Enterprise Observability — scheduler job persistence, dead-letter queue, AI inference tracking

CREATE TABLE IF NOT EXISTS "scheduler_job_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_name" text NOT NULL,
  "started_at" timestamp NOT NULL,
  "completed_at" timestamp,
  "status" text DEFAULT 'pending' NOT NULL,
  "duration_ms" integer,
  "error_message" text,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "scheduler_job_runs_name_idx" ON "scheduler_job_runs" ("job_name");
CREATE INDEX IF NOT EXISTS "scheduler_job_runs_status_idx" ON "scheduler_job_runs" ("status");

CREATE TABLE IF NOT EXISTS "dead_letter_queue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "operation_type" text NOT NULL,
  "entity_type" text,
  "entity_id" text,
  "error_message" text NOT NULL,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "max_retries" integer DEFAULT 3 NOT NULL,
  "first_failed_at" timestamp NOT NULL,
  "last_failed_at" timestamp NOT NULL,
  "resolved" boolean DEFAULT false NOT NULL,
  "resolved_at" timestamp,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "dlq_operation_type_idx" ON "dead_letter_queue" ("operation_type");
CREATE INDEX IF NOT EXISTS "dlq_resolved_idx" ON "dead_letter_queue" ("resolved");

CREATE TABLE IF NOT EXISTS "ai_inference_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "model_name" text NOT NULL,
  "provider" text NOT NULL,
  "role" text,
  "prompt_tokens" integer,
  "completion_tokens" integer,
  "latency_ms" integer,
  "status" text DEFAULT 'success' NOT NULL,
  "fallback_used" boolean DEFAULT false,
  "error_message" text,
  "correlation_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ai_inference_model_idx" ON "ai_inference_log" ("model_name");
CREATE INDEX IF NOT EXISTS "ai_inference_provider_idx" ON "ai_inference_log" ("provider");
CREATE INDEX IF NOT EXISTS "ai_inference_status_idx" ON "ai_inference_log" ("status");
