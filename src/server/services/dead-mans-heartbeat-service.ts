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
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { logger } from "../lib/logger.js";
import { AlertFactory } from "./alert-service.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";
import { notifyCritical } from "./notification-service.js";

const HEARTBEAT_TABLE = "system_health_heartbeat";
const RTH_START_ET_HOUR = 9;   // 9:30 AM ET (we check >= 9 for safety)
const RTH_END_ET_HOUR = 16;    // 4:00 PM ET
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

// ─── Process start time (M-8) ─────────────────────────────────────────────────
// Module-level timestamp capturing when the process loaded this module.
// Included in stale-heartbeat alerts so operators can correlate a stale
// alert with a recent backend restart.
const _processStartTime = Date.now();

// ─── Stale-alert dedup ────────────────────────────────────────────────────────
// Track the last heartbeat timestamp we fired an alert for to avoid spam.
let _lastAlertedForTs: Date | null = null;
let _alertFiredAt: Date | null = null;

// ─── Schema-drift read-path dedup (F-3, was F-5 in Pass 6 Track C) ───────────
// Originally an in-process variable, but pm2 reload reset the var and caused
// duplicate Discord alerts. F-3 (Pass 6 / Track A 2026-05-21) moves the dedup
// to the audit_log table: we check whether an audit row with
//   action='dead_mans_heartbeat.schema_drift_alerted'
// already exists for today_et BEFORE firing notifyCritical. The audit row is
// the single source of truth; the in-process variable is kept as a fast-path
// cache (avoids one DB query per 30-min check inside a single process lifetime)
// but is NEVER trusted alone.
let _lastSchemaDriftReadAlertAt: string | null = null;

/**
 * Compute today's calendar date in America/New_York (ET) as "YYYY-MM-DD".
 * Used as the dedup key in audit_log — one schema-drift alert per ET day.
 */
function todayEtDateString(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/**
 * DB-backed check: has the schema-drift read-path alert already fired today
 * (ET calendar)? Returns true if a prior audit row exists. Returns false on
 * lookup error (fail-open — better to risk one duplicate alert than to skip
 * a critical schema-drift notification entirely).
 */
async function hasSchemaDriftAlertedToday(): Promise<boolean> {
  const today = todayEtDateString();
  try {
    // Lazy import to keep this module importable when db/schema are partially
    // mocked in unit tests (matches the helper-logger contract from CLAUDE.md).
    const { auditLog } = await import("../db/schema.js");
    const { and, eq, gte, lt } = await import("drizzle-orm");
    // ET day boundary in UTC: ET is UTC-4 (DST) or UTC-5 (standard). Use the
    // worst-case earliest-start / latest-end so we never miss a row that landed
    // on the ET calendar day under either DST regime.
    const todayStart = new Date(`${today}T00:00:00-05:00`);
    const todayEnd = new Date(`${today}T23:59:59-04:00`);
    const rows = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "dead_mans_heartbeat.schema_drift_alerted"),
          gte(auditLog.createdAt, todayStart),
          lt(auditLog.createdAt, todayEnd),
        ),
      )
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    logger.warn({ err }, "dead-mans-heartbeat: schema-drift dedup lookup failed (fail-open — may double-alert)");
    return false;
  }
}

async function recordSchemaDriftAlert(): Promise<void> {
  try {
    const { auditLog } = await import("../db/schema.js");
    await db.insert(auditLog).values({
      action: "dead_mans_heartbeat.schema_drift_alerted",
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: { table: HEARTBEAT_TABLE, path: "read", todayEt: todayEtDateString() } as Record<string, unknown>,
      result: { alerted: true } as Record<string, unknown>,
      status: "success",
      correlationId: null,
    });
  } catch (err) {
    logger.warn({ err }, "dead-mans-heartbeat: schema-drift audit row insert failed (non-blocking)");
  }
}

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
      // F-3: Schema drift on the READ path — fire notifyCritical, but dedup via
      // audit_log so pm2 reload (which resets in-process state) does not cause a
      // duplicate alert. We still keep the in-process variable as a fast-path
      // cache so a single process doesn't query audit_log 48 times per RTH day.
      const todayEt = todayEtDateString();
      logger.error(
        { table: HEARTBEAT_TABLE, code: PG_RELATION_NOT_FOUND },
        `dead-mans-heartbeat: SCHEMA DRIFT — table "${HEARTBEAT_TABLE}" missing during stale check`,
      );
      if (_lastSchemaDriftReadAlertAt !== todayEt) {
        // Cache miss — consult audit_log before alerting.
        const alreadyAlerted = await hasSchemaDriftAlertedToday();
        if (alreadyAlerted) {
          // Another process (e.g. before pm2 reload) already alerted today;
          // refresh the in-process cache and skip the notify.
          _lastSchemaDriftReadAlertAt = todayEt;
        } else {
          _lastSchemaDriftReadAlertAt = todayEt;
          // Record FIRST so a concurrent process sees the row even if notify
          // takes time. notifyCritical is fire-and-forget (matches write-path).
          await recordSchemaDriftAlert();
          notifyCritical(
            "Heartbeat schema drift (read-path)",
            `Table "${HEARTBEAT_TABLE}" is missing during the stale heartbeat check. ` +
              `The dead-man's heartbeat cannot verify backend liveness. Apply the pending migration immediately.`,
            { table: HEARTBEAT_TABLE, error_code: PG_RELATION_NOT_FOUND, path: "read" },
          );
        }
      }
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
    // M-8: Include backend_restarted_at so operators can correlate stale alerts
    // with a recent restart (process started but heartbeat writes haven't fired yet).
    const backendRestartedAt = new Date(_processStartTime).toISOString();
    await AlertFactory.notifyHeartbeatStale(lastAt, minutesSince, backendRestartedAt).catch((err) => {
      logger.error({ err }, "dead-mans-heartbeat: Discord alert also failed");
    });
  }
}

// ─── Accessors for production-status panel ───────────────────────────────────

export function getLastAlertFiredAt(): Date | null {
  return _alertFiredAt;
}

// ─── Wave 24 Pass 1 Item 1: Scheduled-refresh staleness check ─────────────────
// Complements runHeartbeatStaleCheck() — detects when the BW/cookie refresh
// crons have stopped writing heartbeat rows. Both are safety-critical for
// 30-day unattended vacation operation.
//
// Thresholds use 2× the job cadence as the staleness threshold:
//   bw_refresh.heartbeat    — job runs every 6h → stale if >13h old
//   cookie_refresh.heartbeat — job runs every 1h → stale if >2.5h old
//
// Dedup: fires at most once per stale window (same pattern as main heartbeat).
// Does NOT throw — every error path is logged and the function returns.

const BW_HEARTBEAT_STALE_MS = 13 * 60 * 60 * 1000;       // 13h (2× 6h cadence)
const COOKIE_HEARTBEAT_STALE_MS = 2.5 * 60 * 60 * 1000;  // 2.5h (2× 1h cadence + buffer)

let _lastBwAlertAt: Date | null = null;
let _lastCookieAlertAt: Date | null = null;

/**
 * Queries audit_log for the most recent heartbeat row for a given action.
 * Returns null when no row exists or query fails.
 */
async function getLastRefreshHeartbeatAt(action: string): Promise<Date | null> {
  try {
    const { auditLog } = await import("../db/schema.js");
    const { eq: _eq, desc: _desc } = await import("drizzle-orm");
    const rows = await db
      .select({ createdAt: auditLog.createdAt })
      .from(auditLog)
      .where(_eq(auditLog.action, action))
      .orderBy(_desc(auditLog.createdAt))
      .limit(1);
    return rows.length > 0 ? new Date(rows[0].createdAt as unknown as string | number | Date) : null;
  } catch (err) {
    logger.warn({ err, action }, "dead-mans-heartbeat: refresh-heartbeat query failed");
    return null;
  }
}

/**
 * Check whether BW and cookie refresh jobs are still writing heartbeat rows.
 * Fires Discord CRITICAL if either job's last heartbeat row is older than the
 * staleness threshold. Deduplicates per stale window.
 */
export async function runScheduledRefreshStalenessCheck(): Promise<void> {
  const now = Date.now();

  // ── BW refresh heartbeat check ─────────────────────────────────────────────
  const bwLastAt = await getLastRefreshHeartbeatAt("bw_refresh.heartbeat");
  if (bwLastAt) {
    const ageMs = now - bwLastAt.getTime();
    if (ageMs > BW_HEARTBEAT_STALE_MS) {
      // Dedup: only alert once per stale window
      if (!_lastBwAlertAt || now - _lastBwAlertAt.getTime() > BW_HEARTBEAT_STALE_MS) {
        _lastBwAlertAt = new Date();
        const ageHours = (ageMs / (60 * 60 * 1000)).toFixed(1);
        logger.error(
          { ageHours, lastAt: bwLastAt.toISOString() },
          "dead-mans-heartbeat: BW session refresh cron NOT RUNNING — heartbeat stale",
        );
        await insertAuditRow({
          action: "dead_mans_heartbeat.bw_refresh_stale",
          entityType: "system",
          entityId: null,
          decisionAuthority: "system",
          input: { last_heartbeat_at: bwLastAt.toISOString(), age_hours: ageHours } as Record<string, unknown>,
          result: { alert_fired_at: _lastBwAlertAt.toISOString() } as Record<string, unknown>,
          status: "success",
          correlationId: null,
        }).catch((err) => logger.error({ err }, "dead-mans-heartbeat: BW stale audit row failed"));
        notifyCritical(
          "CRITICAL: BW session refresh cron not running",
          `Bitwarden session refresh heartbeat is ${ageHours}h stale (last: ${bwLastAt.toISOString()}). ` +
            `The bw-session-refresh scheduled job may be disabled or throwing. ` +
            `BW vault access will degrade if BW_SESSION expires. ` +
            `Check: POST /api/admin/scheduler/jobs/bw-session-refresh/enable`,
          { lastHeartbeatAt: bwLastAt.toISOString(), ageHours, thresholdHours: "13" },
        );
      }
    } else {
      // Fresh — clear dedup
      if (_lastBwAlertAt) {
        logger.info("dead-mans-heartbeat: BW refresh heartbeat recovered — clearing alert state");
        _lastBwAlertAt = null;
      }
    }
  }

  // ── Cookie refresh heartbeat check ─────────────────────────────────────────
  const cookieLastAt = await getLastRefreshHeartbeatAt("cookie_refresh.heartbeat");
  if (cookieLastAt) {
    const ageMs = now - cookieLastAt.getTime();
    if (ageMs > COOKIE_HEARTBEAT_STALE_MS) {
      if (!_lastCookieAlertAt || now - _lastCookieAlertAt.getTime() > COOKIE_HEARTBEAT_STALE_MS) {
        _lastCookieAlertAt = new Date();
        const ageHours = (ageMs / (60 * 60 * 1000)).toFixed(1);
        logger.error(
          { ageHours, lastAt: cookieLastAt.toISOString() },
          "dead-mans-heartbeat: prop-firm cookie refresh cron NOT RUNNING — heartbeat stale",
        );
        await insertAuditRow({
          action: "dead_mans_heartbeat.cookie_refresh_stale",
          entityType: "system",
          entityId: null,
          decisionAuthority: "system",
          input: { last_heartbeat_at: cookieLastAt.toISOString(), age_hours: ageHours } as Record<string, unknown>,
          result: { alert_fired_at: _lastCookieAlertAt.toISOString() } as Record<string, unknown>,
          status: "success",
          correlationId: null,
        }).catch((err) => logger.error({ err }, "dead-mans-heartbeat: cookie stale audit row failed"));
        notifyCritical(
          "CRITICAL: Prop-firm cookie refresh cron not running",
          `Cookie refresh heartbeat is ${ageHours}h stale (last: ${cookieLastAt.toISOString()}). ` +
            `C2 evidence captures may be failing. ` +
            `Check: POST /api/admin/scheduler/jobs/prop-firm-cookie-refresh/enable`,
          { lastHeartbeatAt: cookieLastAt.toISOString(), ageHours, thresholdHours: "2.5" },
        );
      }
    } else {
      if (_lastCookieAlertAt) {
        logger.info("dead-mans-heartbeat: cookie refresh heartbeat recovered — clearing alert state");
        _lastCookieAlertAt = null;
      }
    }
  }
}
