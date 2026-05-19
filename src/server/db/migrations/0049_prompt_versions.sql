-- Wave 4.2: Prompt versioning and A/B testing
CREATE TABLE IF NOT EXISTS "prompt_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "prompt_type" text NOT NULL,
  "version" integer NOT NULL,
  "content" text NOT NULL,
  "is_active" boolean DEFAULT false NOT NULL,
  "metrics" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "prompt_versions_type_idx" ON "prompt_versions" ("prompt_type");
CREATE INDEX IF NOT EXISTS "prompt_versions_active_idx" ON "prompt_versions" ("is_active");

CREATE TABLE IF NOT EXISTS "prompt_ab_tests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "prompt_type" text NOT NULL,
  "version_a_id" uuid REFERENCES "prompt_versions"("id"),
  "version_b_id" uuid REFERENCES "prompt_versions"("id"),
  "started_at" timestamp NOT NULL,
  "ended_at" timestamp,
  "metrics_a" jsonb,
  "metrics_b" jsonb,
  "winner" text,
  "status" text DEFAULT 'running' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "prompt_ab_tests_status_idx" ON "prompt_ab_tests" ("status");
CREATE INDEX IF NOT EXISTS "prompt_ab_tests_type_idx" ON "prompt_ab_tests" ("prompt_type");
