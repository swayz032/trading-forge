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
 *   Wave hardening 2026-06-22, autonomous-readiness A-1:
 *   After the stale alert fires, autonomously attempts self-restart via the
 *   HMAC-signed POST /api/admin/self-restart endpoint. Guard rails:
 *     (a) DB-backed attempt dedup — one attempt per stale window (survives restarts)
 *     (b) 3-attempt cap per 24h via audit_log count
 *     (c) Audit row written BEFORE the fetch with correlationId
 *     (d) Escalation alert if fetch fails (family-grade: power-cycle the tower)
 *
 * Pipeline pause guard: BYPASSED (safety signal — same pattern as C1/C2/C8).
 *
 * Env vars:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, TWILIO_TO
 *   DISCORD_ALERT_PORT or DISCORD_WEBHOOK_URL (fallback when Twilio absent)
 *   ADMIN_RESTART_HMAC_SECRET — required for autonomous self-restart
 */

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { logger } from "../lib/logger.js";
import { AlertFactory } from "./alert-service.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";
import { notifyCritical } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";

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
  const correlationId = randomUUID();
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
      correlationId,
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

  // Wave hardening 2026-06-22, autonomous-readiness A-1:
  // After the stale alert fires, autonomously attempt self-restart so a hung
  // backend heals without operator intervention during a 14-day vacation.
  await attemptAutoRestart(lastAt, minutesSince, cronCorrelationId);
}

// ─── Auto-restart constants (A-1) ────────────────────────────────────────────

const AUTO_RESTART_CAP_PER_24H = 3; // max auto-restart attempts within any 24h window
const AUTO_RESTART_FETCH_TIMEOUT_MS = 8_000; // 8s timeout for the self-restart HTTP call

/**
 * DB-backed count of auto-restart attempts in the last 24h.
 * Returns 0 on error (fail-open: better to attempt one extra restart than to
 * skip recovery because the audit query itself is broken).
 */
async function countAutoRestartAttemptsLast24h(): Promise<number> {
  try {
    const { auditLog } = await import("../db/schema.js");
    const { and, eq, gte, count } = await import("drizzle-orm");
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await db
      .select({ n: count() })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "dead_mans_heartbeat.auto_restart_attempted"),
          gte(auditLog.createdAt, windowStart),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  } catch (err) {
    logger.warn({ err }, "dead-mans-heartbeat: auto-restart count query failed (fail-open)");
    return 0;
  }
}

/**
 * DB-backed check: has an auto-restart already been attempted for the current
 * stale window (identified by the original lastAt heartbeat timestamp)?
 * Returns false on error (fail-open: same rationale as countAutoRestartAttemptsLast24h).
 */
async function hasAutoRestartAttemptedForWindow(lastAt: Date): Promise<boolean> {
  try {
    const { auditLog } = await import("../db/schema.js");
    const { and, eq, gte } = await import("drizzle-orm");
    // Consider anything written after the stale heartbeat timestamp as being
    // for this same stale window (only one attempt per staleness window).
    const rows = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "dead_mans_heartbeat.auto_restart_attempted"),
          gte(auditLog.createdAt, lastAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    logger.warn({ err }, "dead-mans-heartbeat: auto-restart dedup query failed (fail-open)");
    return false;
  }
}

/**
 * Autonomous self-restart attempt (A-1).
 *
 * Guard rails enforced:
 *   (a) DB-backed per-window dedup — one attempt per stale window.
 *   (b) 3-attempt cap per 24h — tracked via audit_log count query.
 *   (c) Audit row written BEFORE the fetch with correlationId.
 *   (d) Escalation alert if fetch fails with family-grade action.
 *
 * Skips gracefully when ADMIN_RESTART_HMAC_SECRET is absent.
 */
async function attemptAutoRestart(
  lastAt: Date,
  minutesSince: number,
  parentCorrelationId: string,
): Promise<void> {
  const secret = process.env["ADMIN_RESTART_HMAC_SECRET"];
  if (!secret) {
    logger.warn(
      { parentCorrelationId },
      "dead-mans-heartbeat: ADMIN_RESTART_HMAC_SECRET not set — auto-restart unavailable; " +
        "set env var to enable autonomous recovery (A-1)",
    );
    await notifyCritical(
      "Heartbeat stale — auto-restart unavailable",
      "The backend heartbeat is stale but autonomous restart is disabled because " +
        "ADMIN_RESTART_HMAC_SECRET is not configured. Manual intervention required.",
      { parentCorrelationId, reason: "secret_not_configured" },
    );
    return;
  }

  // (a) Per-window dedup — only one auto-restart attempt per stale heartbeat window.
  const alreadyAttempted = await hasAutoRestartAttemptedForWindow(lastAt);
  if (alreadyAttempted) {
    logger.debug(
      { lastAt: lastAt.toISOString(), parentCorrelationId },
      "dead-mans-heartbeat: auto-restart already attempted for this stale window — skipping",
    );
    return;
  }

  // (b) 24h cap — block the 4th+ attempt within any 24h window.
  const attemptsLast24h = await countAutoRestartAttemptsLast24h();
  if (attemptsLast24h >= AUTO_RESTART_CAP_PER_24H) {
    logger.warn(
      { attemptsLast24h, cap: AUTO_RESTART_CAP_PER_24H, parentCorrelationId },
      "dead-mans-heartbeat: auto-restart 24h cap reached — not attempting again this window",
    );

    // Pass 7 Track B — remote power-cycle escape valve.
    // When KASA_DEVICE_IP is configured, try to power-cycle the Skytech tower
    // via the TP-Link Kasa smart plug instead of just emitting a terminal alert.
    const kasaIp = process.env["KASA_DEVICE_IP"];
    if (kasaIp) {
      logger.warn(
        { kasaIp, attemptsLast24h, parentCorrelationId },
        "dead-mans-heartbeat: KASA_DEVICE_IP is set — attempting remote power-cycle instead of terminal alert",
      );
      try {
        const { triggerRemotePowerCycle } = await import("./remote-power-cycle-service.js");
        await triggerRemotePowerCycle(
          `heartbeat_stale_auto_restart_cap_reached_attempt_${attemptsLast24h + 1}`,
          parentCorrelationId,
        );
      } catch (kasaErr) {
        logger.error(
          { kasaErr, parentCorrelationId },
          "dead-mans-heartbeat: remote-power-cycle-service threw — falling through to terminal alert",
        );
        // Fall through to the terminal alert below.
        notifyCritical(
          "Heartbeat stale — auto-restart cap reached; remote power-cycle threw",
          appendFamilyGradePostscript(
            `Auto-restart has been attempted ${attemptsLast24h} times in the last 24h (cap: ${AUTO_RESTART_CAP_PER_24H}). ` +
              `Remote power-cycle via Kasa plug at ${kasaIp} threw an error. ` +
              "Manual intervention required. Check: pm2 logs / NSSM event log on the Skytech tower.",
            `The trading bot has been trying to restart itself but keeps failing — this is the ${attemptsLast24h + 1}th time today. The remote restart also failed.`,
            "Call Tony immediately. If you cannot reach him, hold the power button on the home computer for 5 seconds to reboot it — the bot restarts automatically.",
          ),
          { attemptsLast24h, cap: AUTO_RESTART_CAP_PER_24H, parentCorrelationId, kasaIp },
        );
      }
    } else {
      // No Kasa plug configured — emit the classic terminal-action alert.
      notifyCritical(
        "Heartbeat stale — auto-restart cap reached",
        appendFamilyGradePostscript(
          `Auto-restart has been attempted ${attemptsLast24h} times in the last 24h (cap: ${AUTO_RESTART_CAP_PER_24H}). ` +
            "Manual intervention required. Check: pm2 logs / NSSM event log on the Skytech tower.",
          `The trading bot has been trying to restart itself but keeps failing — this is the ${attemptsLast24h + 1}th time today.`,
          "Call Tony. If you can't reach him, hold the power button on the home computer for 5 seconds to reboot it — the bot restarts automatically.",
        ),
        { attemptsLast24h, cap: AUTO_RESTART_CAP_PER_24H, parentCorrelationId },
      );
    }
    return;
  }

  // (c) Write audit row BEFORE the fetch so the attempt is DB-visible even if
  // the process dies during the HTTP call.
  const autoRestartCorrelationId = randomUUID();
  const timestamp = Math.floor(Date.now() / 1000); // Unix seconds for HMAC
  const reason = "auto_restart_heartbeat_stale";

  try {
    const { auditLog } = await import("../db/schema.js");
    await db.insert(auditLog).values({
      action: "dead_mans_heartbeat.auto_restart_attempted",
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: {
        lastHeartbeatAt: lastAt.toISOString(),
        minutesSince,
        attempt: attemptsLast24h + 1,
        cap: AUTO_RESTART_CAP_PER_24H,
        parentCorrelationId,
      } as Record<string, unknown>,
      result: { status: "pending", correlationId: autoRestartCorrelationId } as Record<string, unknown>,
      status: "success",
      correlationId: autoRestartCorrelationId,
    });
  } catch (auditErr) {
    logger.warn({ auditErr }, "dead-mans-heartbeat: auto-restart audit row insert failed (non-blocking)");
    // Do NOT abort — the audit row failing should not prevent the restart attempt.
    // The attempt will be de-duped-as-missing on next tick (fail-open).
  }

  logger.warn(
    { minutesSince, lastAt: lastAt.toISOString(), correlationId: autoRestartCorrelationId, attempt: attemptsLast24h + 1 },
    "dead-mans-heartbeat: AUTO-RESTART attempting — heartbeat stale, backend may be hung",
  );

  // Compute HMAC signature: HMAC-SHA256(secret, "${timestamp}:${reason}")
  // Matches the contract in admin.ts verifyRestartHmac().
  const { createHmac } = await import("node:crypto");
  const sig = createHmac("sha256", secret)
    .update(`${timestamp}:${reason}`, "utf8")
    .digest("hex");

  const port = process.env["PORT"] ?? "4000";
  const selfRestartUrl = `http://localhost:${port}/api/admin/self-restart`;

  try {
    const resp = await fetch(selfRestartUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Restart-Signature": sig,
      },
      // Pass 6 Track D: plumb cronCorrelationId as parentCorrelationId so the
      // admin handler can reuse it as the audit row's correlation_id, linking
      // the stale-detected row, the auto_restart_attempted row, and the
      // self_restart_requested row under a single trace key.
      body: JSON.stringify({ timestamp, reason, parentCorrelationId }),
      signal: AbortSignal.timeout(AUTO_RESTART_FETCH_TIMEOUT_MS),
    });

    if (resp.ok) {
      logger.warn(
        { status: resp.status, correlationId: autoRestartCorrelationId },
        "dead-mans-heartbeat: auto-restart request accepted — NSSM will respawn backend",
      );
      // Success: NSSM will respawn. No further alert needed; post-restart heartbeat
      // writes will clear the stale state within ~15 min.
    } else {
      const body = await resp.text().catch(() => "<unreadable>");
      throw new Error(`Self-restart endpoint returned HTTP ${resp.status}: ${body}`);
    }
  } catch (fetchErr) {
    // (d) Fetch failed — port unreachable (truly dead) or HTTP error.
    // Escalate with family-grade action.
    const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    logger.error(
      { err: fetchErr, correlationId: autoRestartCorrelationId },
      "dead-mans-heartbeat: AUTO-RESTART FAILED — process may be unreachable; escalating",
    );
    await notifyCritical(
      "CRITICAL: Heartbeat stale — auto-restart FAILED",
      appendFamilyGradePostscript(
        `Backend heartbeat has been stale for ${minutesSince} minutes. ` +
          `Auto-restart was attempted (correlationId: ${autoRestartCorrelationId}) but FAILED: ${errMsg}. ` +
          "The backend process may be unreachable. Manual intervention required: " +
          "check NSSM status on the Skytech tower or power-cycle the machine.",
        `The trading bot has been silent for ${Math.round(minutesSince / 60)} hours. We tried to restart it automatically, but that also failed.`,
        "Hold the power button on the home computer for 5 seconds to force a reboot. The bot restarts automatically within 2 minutes. If the bot stays offline after reboot, call Tony.",
      ),
      {
        lastHeartbeatAt: lastAt.toISOString(),
        minutesSince,
        autoRestartCorrelationId,
        error: errMsg,
        parentCorrelationId,
      },
    );
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
  const cronCorrelationId = randomUUID();
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
          { ageHours, lastAt: bwLastAt.toISOString(), cronCorrelationId },
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
          correlationId: cronCorrelationId,
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
          { ageHours, lastAt: cookieLastAt.toISOString(), cronCorrelationId },
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
          correlationId: cronCorrelationId,
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

// ─── Wave 24 Pass 1.5 Item 6: operator-absent auto-flip ──────────────────────
//
// The vacation-mode autopilot (OPERATOR_ABSENT_AUTOPROMOTE) reads
// system_state.operator_absent_since. Before this fix, that column had NO
// production writer — the operator had to set it manually before vacation.
// Catastrophic loop: the very mode designed for vacation required presence
// to enable.
//
// Auto-flip uses a two-stage state machine to prevent flapping:
//   t=0    24h continuous silence → set operator_absent_pending = NOW()
//   t=24h  another 24h silence    → set operator_absent_since   = NOW()
//   any t  operator activity      → both columns cleared (mark-present route)
//
// "Operator activity" signal: any audit_log row with decision_authority='human'
// in the last 24h. The mark-present route itself writes such a row, so calling
// it is sufficient to clear the state. This intentionally avoids middleware
// coupling — every authenticated human-decision endpoint already audits.

const OPERATOR_ABSENT_ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000;     // 24h
const OPERATOR_ABSENT_CONFIRMATION_MS = 24 * 60 * 60 * 1000;        // 24h confirmation window

/**
 * Returns the timestamp of the most recent operator-driven action
 * (audit_log row with decision_authority='human') or null when none found
 * within the lookback window. Lookback is 2× the activity window so we can
 * distinguish "never active" from "active recently".
 */
export async function getLastOperatorActivityAt(): Promise<Date | null> {
  try {
    const { auditLog } = await import("../db/schema.js");
    const { eq: _eq, desc: _desc } = await import("drizzle-orm");
    const rows = await db
      .select({ createdAt: auditLog.createdAt })
      .from(auditLog)
      .where(_eq(auditLog.decisionAuthority, "human"))
      .orderBy(_desc(auditLog.createdAt))
      .limit(1);
    return rows.length > 0 ? new Date(rows[0].createdAt as unknown as string | number | Date) : null;
  } catch (err) {
    logger.warn({ err }, "operator-absent-detect: last-activity query failed (fail-open)");
    return null;
  }
}

/**
 * Reads current system_state row. Always returns id=1 row, creating it if
 * absent (production seed inserts it at startup; defensive null-handling here).
 */
async function readSystemState(): Promise<{
  operatorAbsentSince: Date | null;
  operatorAbsentPending: Date | null;
} | null> {
  try {
    const { systemState } = await import("../db/schema.js");
    const { eq: _eq } = await import("drizzle-orm");
    const rows = await db
      .select({
        operatorAbsentSince: systemState.operatorAbsentSince,
        operatorAbsentPending: systemState.operatorAbsentPending,
      })
      .from(systemState)
      .where(_eq(systemState.id, 1))
      .limit(1);
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      operatorAbsentSince: row.operatorAbsentSince ? new Date(row.operatorAbsentSince as unknown as string | number | Date) : null,
      operatorAbsentPending: row.operatorAbsentPending ? new Date(row.operatorAbsentPending as unknown as string | number | Date) : null,
    };
  } catch (err) {
    logger.warn({ err }, "operator-absent-detect: system_state read failed (fail-open)");
    return null;
  }
}

/**
 * Two-stage operator-absence auto-flip.
 * Idempotent — running twice in succession does NOT advance the state machine.
 * Fail-open — any DB error logs a warning and returns without mutating.
 */
export async function runOperatorAbsenceAutoDetect(): Promise<void> {
  const cronCorrelationId = randomUUID();
  const state = await readSystemState();
  if (!state) {
    logger.debug("operator-absent-detect: no system_state row — skipping");
    return;
  }
  const now = new Date();
  const lastActivity = await getLastOperatorActivityAt();
  const silenceMs = lastActivity ? now.getTime() - lastActivity.getTime() : Number.POSITIVE_INFINITY;

  // Recent activity → clear pending if it was set (and was not yet promoted).
  // Do NOT auto-clear operator_absent_since here — promotion is sticky and
  // requires explicit mark-present (operator must consciously re-engage).
  if (silenceMs < OPERATOR_ABSENT_ACTIVITY_WINDOW_MS) {
    if (state.operatorAbsentPending && !state.operatorAbsentSince) {
      try {
        const { systemState } = await import("../db/schema.js");
        const { eq: _eq } = await import("drizzle-orm");
        await db
          .update(systemState)
          .set({ operatorAbsentPending: null })
          .where(_eq(systemState.id, 1));
        logger.info("operator-absent-detect: activity observed within 24h — cleared pending flag");
      } catch (err) {
        logger.warn({ err }, "operator-absent-detect: pending-clear failed");
      }
    }
    return;
  }

  // Silence ≥ 24h. Idempotency: skip if since is already set (already promoted).
  if (state.operatorAbsentSince) return;

  // Stage 1 → Stage 2 promotion: pending set AND ≥ 24h old → promote to since.
  if (state.operatorAbsentPending) {
    const pendingAgeMs = now.getTime() - state.operatorAbsentPending.getTime();
    if (pendingAgeMs >= OPERATOR_ABSENT_CONFIRMATION_MS) {
      try {
        const { systemState } = await import("../db/schema.js");
        const { eq: _eq } = await import("drizzle-orm");
        await db
          .update(systemState)
          .set({ operatorAbsentSince: now })
          .where(_eq(systemState.id, 1));
      } catch (err) {
        logger.error({ err }, "operator-absent-detect: promote-to-since UPDATE failed");
        return;
      }
      logger.warn({ pendingSince: state.operatorAbsentPending.toISOString() },
        "operator-absent-detect: 48h silence confirmed — operator_absent_since SET (vacation autopilot engaged)");
      await insertAuditRow({
        action: "operator_absence.auto_detected",
        entityType: "system",
        entityId: null,
        decisionAuthority: "system",
        input: { pendingSince: state.operatorAbsentPending.toISOString(), confirmedAt: now.toISOString() } as Record<string, unknown>,
        result: { operatorAbsentSince: now.toISOString(), confirmationHours: Math.round(pendingAgeMs / (60 * 60 * 1000)) } as Record<string, unknown>,
        status: "success",
        correlationId: cronCorrelationId,
      }).catch((err) => logger.error({ err }, "operator-absent-detect: audit row failed"));
      notifyCritical(
        "Operator absence auto-detected — vacation autopilot engaged",
        // Wave 25 Pass 2 A-3: family-grade postscript appended so family members
        // can understand the alert without technical knowledge of the system.
        appendFamilyGradePostscript(
          "48h of continuous operator silence confirmed. Tier-1 auto-promotion (OPERATOR_ABSENT_AUTOPROMOTE) is now active. " +
            "POST /api/admin/operator-mark-present to clear and disengage vacation mode.",
          "The bot detected the operator has been offline for 48 hours and has switched to autopilot mode.",
          "No action needed if Tony's away. If he should be reachable, call him.",
        ),
        { operatorAbsentSince: now.toISOString(), pendingSince: state.operatorAbsentPending.toISOString() },
      );
      return;
    }
    // Pending set but not yet 24h old — wait for next tick.
    return;
  }

  // Stage 0 → Stage 1: 24h silence, no pending yet → set pending + alert.
  try {
    const { systemState } = await import("../db/schema.js");
    const { eq: _eq } = await import("drizzle-orm");
    await db
      .update(systemState)
      .set({ operatorAbsentPending: now })
      .where(_eq(systemState.id, 1));
  } catch (err) {
    logger.error({ err }, "operator-absent-detect: set-pending UPDATE failed");
    return;
  }
  logger.warn({ lastActivityAt: lastActivity?.toISOString() ?? null },
    "operator-absent-detect: 24h silence — operator_absent_pending SET (confirmation window started)");
  await insertAuditRow({
    action: "operator_absence.pending_detected",
    entityType: "system",
    entityId: null,
    decisionAuthority: "system",
    input: { lastActivityAt: lastActivity?.toISOString() ?? null, silenceHours: Number.isFinite(silenceMs) ? Math.round(silenceMs / (60 * 60 * 1000)) : null } as Record<string, unknown>,
    result: { operatorAbsentPending: now.toISOString() } as Record<string, unknown>,
    status: "success",
    correlationId: cronCorrelationId,
  }).catch((err) => logger.error({ err }, "operator-absent-detect: pending audit row failed"));
  notifyCritical(
    "Operator absence — confirmation window started",
    // Wave 25 Pass 2 A-3: family-grade postscript so family members understand
    // the pending state and know this is a 24h warning, not a crisis.
    appendFamilyGradePostscript(
      "24h of operator silence observed. If silence continues for another 24h, vacation autopilot will auto-engage. " +
        "POST /api/admin/operator-mark-present to cancel (or simply use any admin endpoint).",
      "The bot hasn't heard from the operator in 24 hours. Autopilot will engage in 24 more hours if no signal.",
      "If you can reach Tony, ask him to log into Trading Forge. Otherwise wait — this is automatic.",
    ),
    { lastActivityAt: lastActivity?.toISOString() ?? null, operatorAbsentPending: now.toISOString() },
  );
}

/**
 * Clear both operator_absent_since AND operator_absent_pending columns
 * atomically. Called by POST /api/admin/operator-mark-present. Returns
 * the prior state so the route can report what was cleared.
 */
export async function clearOperatorAbsenceMarkers(): Promise<{
  clearedSince: Date | null;
  clearedPending: Date | null;
}> {
  const prior = await readSystemState();
  if (!prior) {
    return { clearedSince: null, clearedPending: null };
  }
  try {
    const { systemState } = await import("../db/schema.js");
    const { eq: _eq } = await import("drizzle-orm");
    await db
      .update(systemState)
      .set({ operatorAbsentSince: null, operatorAbsentPending: null })
      .where(_eq(systemState.id, 1));
  } catch (err) {
    logger.error({ err }, "operator-absent-detect: clear-markers UPDATE failed");
    throw err;
  }
  return { clearedSince: prior.operatorAbsentSince, clearedPending: prior.operatorAbsentPending };
}
