-- Wave 1.4: Idempotency keys for request deduplication
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "key" text PRIMARY KEY NOT NULL,
  "response_status" integer NOT NULL,
  "response_body" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
