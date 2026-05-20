/**
 * Dead-Man's Heartbeat Service (Track 7)
 *
 * Two responsibilities:
 *
 * WRITE — every 15 min during RTH (9:30–16:00 ET). Inserts a row into
 *   system_health_heartbeat to prove the backend is alive.
 *
 * CHECK — every 30 min. If the most recent heartbeat is >2h old during RTH,
 *   fires SMS via Twilio (if configured) OR Discord critical fallback.
 *   Deduplicated: repeated stale cycles only alert once per stale window.
 *   Resets on backend restart.
 *
 * Pipeline pause guard: BYPASSED (safety signal — same pattern as C1/C2/C8).
 *
 * Env vars:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, TWILIO_TO
 *   DISCORD_ALERT_PORT or DISCORD_WEBHOOK_URL (fallback when Twilio absent)
 */

import { randomUUID } from "node:crypto";
import { desc, gte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { logger } from "../lib/logger.js";
import { AlertFactory } from "./alert-service.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";
import { notifyCritical } from "./notification-service.js";

const HEARTBEAT_TABLE = "system_health_heartbeat";
const RTH_START_ET_HOUR = 9;   // 9:30 AM ET (we check >= 9 for safety)
const RTH_END_ET_HOUR = 16;    // 4:00 PM ET
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

// ─── Stale-alert dedup ────────────────────────────────────────────────────────
// Track the last heartbeat timestamp we fired an alert for to avoid spam.
let _lastAlertedForTs: Date | null = null;
let _alertFiredAt: Date | null = null;

function resetAlertDedup(): void {
  _lastAlertedForTs = null;
  _alertFiredAt = null;
}

// Reset on process start (restart implies backend is alive again)
resetAlertDedup();

// ─── ET hours helper ──────────────────────────────────────────────────────────

function isEtRth(): boolean {
  // Track A F-2: Use Intl.DateTimeFormat.formatToParts() to extract the ET
  // hour without re-parsing a locale string. The toLocaleString→new Date()
  // round-trip re-parses in the *system* TZ on Windows (which is often UTC or
  // a non-ET TZ), producing a wrong hour value. formatToParts gives us the
  // numeric field directly — no string re-parse, no TZ ambiguity.
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hourPart = parts.find((p) => p.type === "hour");
  // "24" is returned at midnight by some ICU builds — normalise to 0.
  const hour = hourPart ? (Number(hourPart.value) % 24) : 0;
  return hour >= RTH_START_ET_HOUR && hour < RTH_END_ET_HOUR;
}

// ─── Schema-drift error code ──────────────────────────────────────────────────
// PostgreSQL error code for "table does not exist" (relation_not_found).
// Used to distinguish schema-drift (missing table) from transient write errors.
const PG_RELATION_NOT_FOUND = "42P01";

function isTableMissingError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === PG_RELATION_NOT_FOUND;
}

// ─── WRITE: heartbeat insert ──────────────────────────────────────────────────

/**
 * Inserts a heartbeat row during RTH. No-op outside RTH.
 * Idempotent — multiple calls in the same minute are fine (each writes a row).
 *
 * Track A F-7: Distinguishes schema-drift (table missing, 42P01) from
 * transient write errors. Table-missing fires a Discord CRITICAL so the operator
 * knows the migration hasn't been applied. Transient errors rethrow as before.
 */
export async function writeHeartbeat(): Promise<void> {
  if (!isEtRth()) {
    logger.debug("dead-mans-heartbeat: outside RTH — skipping write");
    return;
  }

  try {
    await db.execute(
      sql`INSERT INTO ${sql.identifier(HEARTBEAT_TABLE)} (ts, status, source) VALUES (NOW(), 'alive', 'backend')`
    );
    logger.debug("dead-mans-heartbeat: heartbeat written");
  } catch (err) {
    if (isTableMissingError(err)) {
      // Schema-drift: table hasn't been migrated yet. Fire Discord CRITICAL
      // so operator knows to run the migration. Do NOT rethrow — this is
      // recoverable once the migration runs; rethrowing would crash the cron.
      logger.error(
        { table: HEARTBEAT_TABLE, code: PG_RELATION_NOT_FOUND },
        `dead-mans-heartbeat: SCHEMA DRIFT — table "${HEARTBEAT_TABLE}" does not exist. Run pending migration.`,
      );
      await notifyCritical(
        "Heartbeat schema drift",
        `Table "${HEARTBEAT_TABLE}" is missing. The dead-man's heartbeat cannot write. Apply the pending migration immediately.`,
        { table: HEARTBEAT_TABLE, error_code: PG_RELATION_NOT_FOUND },
      );
      return; // Do not throw — schema drift is operator-actionable, not a crash
    }
    // Transient write error — fail loudly, a heartbeat write failure is itself a signal
    logger.error({ err }, "dead-mans-heartbeat: HEARTBEAT WRITE FAILED");
    throw err;
  }
}

// ─── CHECK: stale detection + alert ──────────────────────────────────────────

/**
 * Returns the most recent heartbeat timestamp, or null if no rows exist.
 */
// Track A F-7: getLastHeartbeatAt distinguishes "table missing" (schema drift,
// operator-actionable) from "no rows" (ok — first RTH start) from transient query
// failures. Returns null in all non-fatal cases; logs severity reflects the cause.
export async function getLastHeartbeatAt(): Promise<Date | null> {
  try {
    const rows = await db.execute<{ ts: string }>(
      sql`SELECT ts FROM ${sql.identifier(HEARTBEAT_TABLE)} ORDER BY ts DESC LIMIT 1`
    );
    // postgres.js returns an array directly (RowList)
    const arr = Array.isArray(rows) ? rows : (rows as unknown as { rows: Array<{ ts: string }> }).rows;
    // "no rows" = first RTH start this session — severity: ok, return null
    if (!arr || arr.length === 0) return null;
    return new Date((arr[0] as { ts: string }).ts);
  } catch (err) {
    if (isTableMissingError(err)) {
      // Schema drift — fire CRITICAL, not just a warn
      logger.error(
        { table: HEARTBEAT_TABLE, code: PG_RELATION_NOT_FOUND },
        `dead-mans-heartbeat: SCHEMA DRIFT — table "${HEARTBEAT_TABLE}" missing during stale check`,
      );
    } else {
      logger.warn({ err }, "dead-mans-heartbeat: last heartbeat query failed");
    }
    return null;
  }
}

async function sendSmsStalert(minutesSince: number, lastAt: Date): Promise<boolean> {
  const sid = process.env["TWILIO_ACCOUNT_SID"];
  const token = process.env["TWILIO_AUTH_TOKEN"];
  const from = process.env["TWILIO_FROM"];
  const to = process.env["TWILIO_TO"];

  if (!sid || !token || !from || !to) return false;

  try {
    // Lazy import — twilio may not be installed; use type-safe dynamic require pattern
    const twilio = (await import("twilio" as string)).default;
    const client = (twilio as (sid: string, token: string) => { messages: { create: (opts: Record<string, string>) => Promise<void> } })(sid, token);
    await client.messages.create({
      body: `Trading Forge DEAD-MAN'S ALERT: backend heartbeat is ${minutesSince}min stale (last: ${lastAt.toISOString()}). Check backend process.`,
      from,
      to,
    });
    logger.warn({ minutesSince }, "dead-mans-heartbeat: SMS alert sent via Twilio");
    return true;
  } catch (err) {
    logger.warn({ err }, "dead-mans-heartbeat: Twilio SMS failed — falling back to Discord");
    return false;
  }
}

/**
 * Runs the stale detection check.
 * Only alerts during RTH. Deduplicates per stale window (no spam).
 */
export async function runHeartbeatStaleCheck(): Promise<void> {
  if (!isEtRth()) {
    logger.debug("dead-mans-heartbeat: outside RTH — skipping stale check");
    return;
  }

  const lastAt = await getLastHeartbeatAt();
  const now = Date.now();

  if (!lastAt) {
    // No heartbeat ever written this session — not necessarily stale (first RTH start)
    logger.debug("dead-mans-heartbeat: no heartbeat row yet — cannot determine stale state");
    return;
  }

  const ageMs = now - lastAt.getTime();
  const minutesSince = Math.round(ageMs / 60_000);

  if (ageMs <= STALE_THRESHOLD_MS) {
    // Fresh — clear dedup state
    if (_lastAlertedForTs) {
      logger.info({ minutesSince }, "dead-mans-heartbeat: heartbeat recovered — clearing alert state");
      resetAlertDedup();
    }
    return;
  }

  // STALE — check dedup before alerting
  if (_lastAlertedForTs && lastAt.getTime() === _lastAlertedForTs.getTime()) {
    // Already alerted for this exact stale heartbeat — skip
    logger.debug(
      { minutesSince, lastAlertedFor: _lastAlertedForTs.toISOString() },
      "dead-mans-heartbeat: stale already alerted — skipping duplicate",
    );
    return;
  }

  // Fire alert
  const cronCorrelationId = randomUUID();
  _lastAlertedForTs = lastAt;
  _alertFiredAt = new Date();

  logger.error(
    { minutesSince, lastAt: lastAt.toISOString() },
    "dead-mans-heartbeat: STALE HEARTBEAT DETECTED — firing alert",
  );

  // Audit log
  await insertAuditRow({
    action: "dead_mans_heartbeat.stale_detected",
    entityType: "system",
    entityId: null,
    decisionAuthority: "system",
    input: { lastHeartbeatAt: lastAt.toISOString(), minutesSince } as Record<string, unknown>,
    result: { alertFiredAt: _alertFiredAt.toISOString() } as Record<string, unknown>,
    status: "success",
    correlationId: cronCorrelationId,
  }).catch((logErr) => {
    logger.error({ logErr }, "dead-mans-heartbeat: audit log write failed");
  });

  // Try Twilio first, fall back to Discord critical
  const smsSent = await sendSmsStalert(minutesSince, lastAt);
  if (!smsSent) {
    await AlertFactory.notifyHeartbeatStale(lastAt, minutesSince).catch((err) => {
      logger.error({ err }, "dead-mans-heartbeat: Discord alert also failed");
    });
  }
}

// ─── Accessors for production-status panel ───────────────────────────────────

export function getLastAlertFiredAt(): Date | null {
  return _alertFiredAt;
}
