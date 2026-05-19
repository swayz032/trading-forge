/**
 * One-shot — apply migration 0101 manually because Drizzle journal shows it
 * was never applied (no row matching the 0101 hash in __drizzle_migrations).
 * The dead-mans-heartbeat job has been failing every 15min all day with
 * `relation "system_health_heartbeat" does not exist` and firing CRITICAL alerts.
 */
import "dotenv/config";
import postgres from "postgres";
import fs from "fs";
import path from "path";

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  // Strip the system_state ALTER (that table predates this DB).
  // We only need the two CREATE TABLEs to silence the heartbeat alerts.
  const ddl = `
    CREATE TABLE IF NOT EXISTS system_health_heartbeat (
      id        BIGSERIAL PRIMARY KEY,
      ts        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status    TEXT NOT NULL DEFAULT 'alive',
      source    TEXT NOT NULL DEFAULT 'backend'
    );
    CREATE INDEX IF NOT EXISTS idx_heartbeat_ts_desc
      ON system_health_heartbeat (ts DESC);
    CREATE TABLE IF NOT EXISTS operator_absent_periods (
      id         BIGSERIAL PRIMARY KEY,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at   TIMESTAMPTZ,
      reason     TEXT,
      ended_by   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_operator_absent_active
      ON operator_absent_periods (started_at DESC)
      WHERE ended_at IS NULL;
  `;
  console.log("Applying migration 0101 (heartbeat + absent_periods only)...");
  await sql.unsafe(ddl);
  console.log("Migration applied.");

  const tables = await sql<{ tbl: string | null; p: string | null }[]>`
    SELECT to_regclass('public.system_health_heartbeat')::text AS tbl,
           to_regclass('public.operator_absent_periods')::text AS p
  `;
  console.log("system_health_heartbeat:", tables[0].tbl);
  console.log("operator_absent_periods:", tables[0].p);

  await sql`INSERT INTO system_health_heartbeat (ts, status, source) VALUES (NOW(), 'alive', 'backend')`;
  const c = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM system_health_heartbeat`;
  console.log("Initial heartbeat rows:", c[0].n);

  await sql.end();
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
