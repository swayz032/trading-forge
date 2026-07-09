import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { logger } from "../lib/logger.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";

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

// ─── A-9: Postgres connection health monitoring ───────────────────────────────
//
// postgres.js (the `postgres` npm package) reconnects transparently — there is
// no Pool.on('error') event emitter like node-postgres (`pg`). Connection errors
// only surface at query time. Without monitoring, a 30-day run could silently
// experience frequent reconnects with zero visibility.
//
// We detect connectivity loss via periodic SELECT 1 health probes:
//   • Success after prior failure  → log recovery + write audit row
//   • Failure with alert cooldown  → log error + write audit row + Discord warning
//   • Probe itself is fail-soft    → never throws, never crashes the process
//
// Audit rows use raw client.unsafe() to avoid circular import (this IS the db
// module — importing notification-service or audit-log-helper creates a cycle).
// Discord notification uses a dynamic import for the same reason.

let _dbHealthy = true;
let _lastDbReconnectAlertAt = 0; // epoch ms

const DB_HEALTH_PROBE_INTERVAL_MS = 5 * 60 * 1000;    // 5 min between probes
const DB_RECONNECT_ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 alert per hour max
const DB_HEALTH_BOOT_DELAY_MS = 30_000;                 // 30s before first probe

/** Exported for testing only. Not part of the public API. */
export async function runDbHealthProbe(): Promise<void> {
  try {
    await client.unsafe("SELECT 1");
    if (!_dbHealthy) {
      _dbHealthy = true;
      logger.info("db-pool: A-9: connection recovered — SELECT 1 succeeded after prior failure");
      // Write recovery audit row using raw client (avoids circular import)
      void client
        .unsafe(
          "INSERT INTO audit_log (id, action, entity_type, decision_authority, input, result, status) " +
          "VALUES (gen_random_uuid(), $1, 'system', 'system', '{}', '{}', 'success')",
          ["db_pool.connection_recovered"],
        )
        .catch((auditErr: unknown) => {
          logger.warn({ err: auditErr }, "db-pool: A-9: recovery audit row failed (non-blocking)");
        });
    }
  } catch (err: unknown) {
    const wasHealthy = _dbHealthy;
    _dbHealthy = false;
    const errorMsg = err instanceof Error ? err.message : String(err);

    logger.error(
      { err, wasHealthy },
      "db-pool: A-9: SELECT 1 health probe FAILED — Postgres connection may be lost",
    );

    // Rate-limited audit + alert (1/hour max to avoid flooding during sustained outage)
    const now = Date.now();
    if (now - _lastDbReconnectAlertAt > DB_RECONNECT_ALERT_COOLDOWN_MS) {
      _lastDbReconnectAlertAt = now;

      // Write error audit row using raw client
      void client
        .unsafe(
          "INSERT INTO audit_log (id, action, entity_type, decision_authority, input, result, status) " +
          "VALUES (gen_random_uuid(), $1, 'system', 'system', $2, '{}', 'warning')",
          [
            "db_pool.connection_error",
            JSON.stringify({ error: errorMsg, was_healthy: wasHealthy }),
          ],
        )
        .catch((auditErr: unknown) => {
          logger.warn({ err: auditErr }, "db-pool: A-9: error audit row failed (non-blocking)");
        });

      // Dynamic import for notification service — breaks potential circular dep chain
      void import("../services/notification-service.js")
        .then(({ notifyWarning }) => {
          notifyWarning(
            "DB Pool: Postgres connection health probe failing",
            appendFamilyGradePostscript(
              `SELECT 1 health probe failed: ${errorMsg}. ` +
                `The Postgres connection pool may be experiencing reconnects. ` +
                `This is surfaced proactively for 30-day unattended operation — ` +
                `check database server status and network connectivity.`,
              "The bot is having trouble talking to its database, which stores every trade and setting.",
              "If the dashboard turns red or stops updating, tell Tony to check the database and internet connection.",
            ),
            { error: errorMsg, wasHealthy },
          );
        })
        .catch((notifyErr: unknown) => {
          logger.warn({ err: notifyErr }, "db-pool: A-9: connection error notification failed (non-blocking)");
        });
    }
  }
}

// Start health monitoring after a boot delay (allows the app to fully
// initialize and run initial migrations before the first probe fires).
// Both timers are unref'd so they don't prevent clean process exit.
const _dbHealthBootTimer = setTimeout(() => {
  const probeInterval = setInterval(() => { void runDbHealthProbe(); }, DB_HEALTH_PROBE_INTERVAL_MS);
  probeInterval.unref();
  // Run first probe immediately after boot delay (don't wait 5min for first signal)
  void runDbHealthProbe();
}, DB_HEALTH_BOOT_DELAY_MS);
_dbHealthBootTimer.unref();
