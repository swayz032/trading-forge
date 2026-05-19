-- Migration: 0044a_system_parameters_tables
-- Purpose: Create system_parameters + system_parameter_history tables.
--          These were defined in schema.ts (lines 1040-1069) but no migration
--          ever created them. Required by 0038a (FK), 0045 (INSERT), and the
--          pipeline-control-service / meta-optimizer / graveyard-intelligence /
--          nightly-critique / prompt-evolution consumers.
-- Date: 2026-04-28

CREATE TABLE IF NOT EXISTS "system_parameters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "param_name" text NOT NULL UNIQUE,
  "current_value" numeric NOT NULL,
  "min_value" numeric,
  "max_value" numeric,
  "description" text,
  "domain" text NOT NULL,
  "auto_tunable" boolean DEFAULT false,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "system_params_name_idx" ON "system_parameters" ("param_name");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "system_params_domain_idx" ON "system_parameters" ("domain");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "system_parameter_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "param_id" uuid NOT NULL REFERENCES "system_parameters"("id") ON DELETE CASCADE,
  "previous_value" numeric NOT NULL,
  "new_value" numeric NOT NULL,
  "reason" text NOT NULL,
  "source" text NOT NULL DEFAULT 'meta-optimizer',
  "gate_metrics" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "param_history_param_idx" ON "system_parameter_history" ("param_id");
