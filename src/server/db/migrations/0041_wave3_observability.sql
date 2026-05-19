-- Wave 3: Observability — circuit breaker events
CREATE TABLE IF NOT EXISTS "circuit_breaker_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "endpoint" text NOT NULL,
  "from_state" text NOT NULL,
  "to_state" text NOT NULL,
  "consecutive_failures" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "cb_events_endpoint_idx" ON "circuit_breaker_events" ("endpoint");
