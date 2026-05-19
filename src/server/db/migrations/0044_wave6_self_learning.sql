-- Wave 6: Advanced Self-Learning — Python execution tracking
CREATE TABLE IF NOT EXISTS "python_execution_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "module" text NOT NULL,
  "component_name" text,
  "correlation_id" text,
  "status" text DEFAULT 'success' NOT NULL,
  "duration_ms" integer,
  "exit_code" integer,
  "error_message" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "python_exec_module_idx" ON "python_execution_log" ("module");
CREATE INDEX IF NOT EXISTS "python_exec_status_idx" ON "python_execution_log" ("status");
