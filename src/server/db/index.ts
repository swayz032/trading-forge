import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}

function resolveDbPoolMax(): number {
  const fallback = process.env.NODE_ENV === "production" ? 20 : 4;
  const raw = Number.parseInt(process.env.DB_POOL_MAX ?? `${fallback}`, 10);
  if (Number.isNaN(raw)) return fallback;
  return Math.max(1, Math.min(raw, 50));
}

export const client = postgres(connectionString, {
  max: resolveDbPoolMax(),
  idle_timeout: 10,
  connect_timeout: 10,
  // Statement-level timeout applied to every query in the pool.
  // Prevents a runaway query (large result serialization, missing index, lock wait)
  // from holding a connection indefinitely. 30s is high enough for legitimate
  // slow queries (large backtest result writes, walk-forward aggregations) while
  // still bounding pathological cases. Critical-path callers (advisory locks in
  // db-locks.ts) already set SET LOCAL statement_timeout = 5000 to override to
  // a shorter budget without affecting the pool default.
  connection: {
    statement_timeout: 30_000,
  },
});
export const db = drizzle(client, { schema });
