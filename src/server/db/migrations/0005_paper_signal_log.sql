CREATE TABLE IF NOT EXISTS "paper_signal_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" uuid NOT NULL REFERENCES "paper_sessions"("id") ON DELETE CASCADE,
  "symbol" text NOT NULL,
  "signal_type" text NOT NULL,
  "action" text NOT NULL,
  "reason" text,
  "price" numeric,
  "indicator_values" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "paper_signal_log_session_idx" ON "paper_signal_log" ("session_id");
