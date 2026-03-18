import postgres from "postgres";
import { readFileSync } from "fs";

const envContent = readFileSync(".env", "utf-8");
const dbUrlLine = envContent.split("\n").find((l) => l.startsWith("DATABASE_URL="));
const dbUrl = dbUrlLine?.split("=").slice(1).join("=");
const sql = postgres(dbUrl);

// Check existing tables first
try {
  const tables = await sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `;
  console.log("Existing tables:", tables.map(t => t.tablename).join(", "));

  // Check if backtest_matrix already exists
  const hasMatrix = tables.some(t => t.tablename === "backtest_matrix");
  if (hasMatrix) {
    console.log("backtest_matrix already exists — skipping CREATE TABLE");
  }

  // Check existing columns on backtest_trades
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'backtest_trades'
    ORDER BY ordinal_position
  `;
  console.log("backtest_trades columns:", cols.map(c => c.column_name).join(", "));

  const existingCols = new Set(cols.map(c => c.column_name));

  // Apply migration piece by piece
  if (!hasMatrix) {
    await sql`
      CREATE TABLE "backtest_matrix" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "strategy_id" uuid NOT NULL,
        "status" text DEFAULT 'running' NOT NULL,
        "total_combos" integer NOT NULL,
        "completed_combos" integer DEFAULT 0 NOT NULL,
        "results" jsonb,
        "best_combo" jsonb,
        "tier_status" jsonb,
        "execution_time_ms" integer,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `;
    await sql`ALTER TABLE "backtest_matrix" ADD CONSTRAINT "backtest_matrix_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE no action ON UPDATE no action`;
    await sql`CREATE INDEX IF NOT EXISTS "matrix_strategy_idx" ON "backtest_matrix" USING btree ("strategy_id")`;
    await sql`CREATE INDEX IF NOT EXISTS "matrix_status_idx" ON "backtest_matrix" USING btree ("status")`;
    console.log("Created backtest_matrix table + indexes + FK");
  }

  // Add columns to backtest_trades if missing
  const newCols = [
    { name: "matrix_id", type: "uuid" },
    { name: "symbol", type: "text" },
    { name: "timeframe", type: "text" },
    { name: "net_pnl", type: "numeric" },
    { name: "hour_of_day", type: "integer" },
    { name: "day_of_week", type: "integer" },
    { name: "macro_regime", type: "text" },
    { name: "event_active", type: "boolean" },
    { name: "skip_signal", type: "text" },
  ];

  for (const col of newCols) {
    if (!existingCols.has(col.name)) {
      await sql.unsafe(`ALTER TABLE "backtest_trades" ADD COLUMN "${col.name}" ${col.type}`);
      console.log(`Added column: backtest_trades.${col.name}`);
    } else {
      console.log(`Column already exists: backtest_trades.${col.name}`);
    }
  }

  // Add FK for matrix_id if column was just added
  if (!existingCols.has("matrix_id")) {
    try {
      await sql`ALTER TABLE "backtest_trades" ADD CONSTRAINT "backtest_trades_matrix_id_backtest_matrix_id_fk" FOREIGN KEY ("matrix_id") REFERENCES "public"."backtest_matrix"("id") ON DELETE no action ON UPDATE no action`;
    } catch (e) {
      console.log("FK already exists or skipped:", e.message);
    }
  }

  await sql`CREATE INDEX IF NOT EXISTS "trades_matrix_idx" ON "backtest_trades" USING btree ("matrix_id")`;
  await sql`CREATE INDEX IF NOT EXISTS "trades_symbol_idx" ON "backtest_trades" USING btree ("symbol")`;

  console.log("\nMigration 0006 applied successfully!");
  await sql.end();
} catch (e) {
  console.error("Migration error:", e.message);
  await sql.end();
  process.exit(1);
}
