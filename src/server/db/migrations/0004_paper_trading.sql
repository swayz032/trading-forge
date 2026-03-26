-- Paper Trading Tables (Phase 5)
CREATE TABLE IF NOT EXISTS "paper_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "strategy_id" uuid REFERENCES "strategies"("id"),
  "status" text NOT NULL DEFAULT 'active',
  "started_at" timestamp DEFAULT now() NOT NULL,
  "stopped_at" timestamp,
  "starting_capital" numeric NOT NULL DEFAULT '100000',
  "current_equity" numeric NOT NULL DEFAULT '100000',
  "config" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "paper_positions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "paper_sessions"("id") ON DELETE CASCADE,
  "symbol" text NOT NULL,
  "side" text NOT NULL,
  "entry_price" numeric NOT NULL,
  "current_price" numeric,
  "contracts" integer NOT NULL DEFAULT 1,
  "unrealized_pnl" numeric DEFAULT '0',
  "entry_time" timestamp DEFAULT now() NOT NULL,
  "closed_at" timestamp
);

CREATE TABLE IF NOT EXISTS "paper_trades" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "paper_sessions"("id") ON DELETE CASCADE,
  "symbol" text NOT NULL,
  "side" text NOT NULL,
  "entry_price" numeric NOT NULL,
  "exit_price" numeric NOT NULL,
  "pnl" numeric NOT NULL,
  "contracts" integer NOT NULL DEFAULT 1,
  "entry_time" timestamp NOT NULL,
  "exit_time" timestamp NOT NULL,
  "slippage" numeric,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "paper_sessions_strategy_idx" ON "paper_sessions" ("strategy_id");
CREATE INDEX IF NOT EXISTS "paper_sessions_status_idx" ON "paper_sessions" ("status");
CREATE INDEX IF NOT EXISTS "paper_positions_session_idx" ON "paper_positions" ("session_id");
CREATE INDEX IF NOT EXISTS "paper_trades_session_idx" ON "paper_trades" ("session_id");
