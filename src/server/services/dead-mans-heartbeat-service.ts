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
  // ET offset: EDT = UTC-4, EST = UTC-5. Use "America/New_York" via toLocaleString trick.
  const nowNY = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  const hour = new Date(nowNY).getHours();
  return hour >= RTH_START_ET_HOUR && hour < RTH_END_ET_HOUR;
}

// ─── WRITE: heartbeat insert ──────────────────────────────────────────────────

/**
 * Inserts a heartbeat row during RTH. No-op outside RTH.
 * Idempotent — multiple calls in the same minute are fine (each writes a row).
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
    // Fail loudly — a heartbeat write failure is itself a signal of backend trouble
    logger.error({ err }, "dead-mans-heartbeat: HEARTBEAT WRITE FAILED");
    throw err;
  }
}

// ─── CHECK: stale detection + alert ──────────────────────────────────────────

/**
 * Returns the most recent heartbeat timestamp, or null if no rows exist.
 */
export async function getLastHeartbeatAt(): Promise<Date | null> {
  try {
    const rows = await db.execute<{ ts: string }>(
      sql`SELECT ts FROM ${sql.identifier(HEARTBEAT_TABLE)} ORDER BY ts DESC LIMIT 1`
    );
    // postgres.js returns an array directly (RowList)
    const arr = Array.isArray(rows) ? rows : (rows as unknown as { rows: Array<{ ts: string }> }).rows;
    if (!arr || arr.length === 0) return null;
    return new Date((arr[0] as { ts: string }).ts);
  } catch (err) {
    logger.warn({ err }, "dead-mans-heartbeat: last heartbeat query failed");
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
