/**
 * DD Velocity Gate — drawdown velocity autopause (Wave 26 Pass G Pass F)
 *
 * Monitors session-cumulative P&L per account every minute. Computes a rolling
 * 2-hour drawdown (max equity in window − current equity). When the 2-hour DD
 * exceeds the configured threshold the gate:
 *
 *  1. Fires  risk.dd_velocity_warning  at 1.5% (warn-only, no pause)
 *  2. Fires  risk.dd_velocity_autopause at 3.0% (pause + operator alert)
 *  3. Sets   pipeline_mode = AUTOPAUSE_DD_VELOCITY via setMode()
 *  4. Broadcasts SSE risk:dd_velocity_autopause
 *  5. Sends Discord CRITICAL to operator
 *
 * Per-firm awareness:
 *   Topstep  (trailing EOD DD): gate is MORE sensitive when the account is within
 *            trailingBuffer × DD_VELOCITY_TOPSTEP_BUFFER_TIGHTEN of the trailing
 *            floor. The effective threshold is reduced proportionally.
 *   MFFU     (static 2% max draw): gate uses the plain pct threshold unchanged.
 *
 * Recovery:
 *   AUTOPAUSE_DD_VELOCITY is OPERATOR-ONLY clearable. No auto-clear, no cron reset.
 *   Clear via existing admin pipeline resume endpoint:
 *     POST /api/admin/pipeline/mode  { mode: "ACTIVE", reason: "..." }
 *
 * Env vars (all optional with documented defaults):
 *   DD_VELOCITY_AUTOPAUSE_PCT         default 0.03  (3%)
 *   DD_VELOCITY_WARNING_PCT           default 0.015 (1.5%)
 *   DD_VELOCITY_WINDOW_MINUTES        default 120   (2 hours)
 *   DD_VELOCITY_TOPSTEP_BUFFER_TIGHTEN default 0.7  (tighten threshold when
 *                                     within 70% of trailing buffer breach)
 *
 * Pipeline-paused behaviour:
 *   The gate is callable from the paper-engine harness even while the pipeline
 *   is paused, so it can be exercised for pre-unpaused verification.
 *   When already AUTOPAUSE_DD_VELOCITY, fire is idempotent (no duplicate audit).
 */

import { db } from "../db/index.js";
import { paperSessions, paperPositions, auditLog } from "../db/schema.js";
import { eq, and, isNull, gte } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { broadcastSSE } from "../routes/sse.js";
import { notifyCritical, notifyWarning } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { getFirmAccount } from "../../shared/firm-config.js";
import { ddVelocityAutopauseTotal, regimeTransitionTotal } from "../lib/metrics-registry.js";

// ─── Configuration ────────────────────────────────────────────────────────────

function getEnvFloat(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = parseFloat(v);
  return isNaN(n) ? def : n;
}

function getEnvInt(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = parseInt(v, 10);
  return isNaN(n) ? def : n;
}

// Exported for tests to read back the resolved configuration.
export function getDDVelocityConfig(): DDVelocityConfig {
  return {
    autopausePct: getEnvFloat("DD_VELOCITY_AUTOPAUSE_PCT", 0.03),
    warningPct: getEnvFloat("DD_VELOCITY_WARNING_PCT", 0.015),
    windowMinutes: getEnvInt("DD_VELOCITY_WINDOW_MINUTES", 120),
    topstepBufferTighten: getEnvFloat("DD_VELOCITY_TOPSTEP_BUFFER_TIGHTEN", 0.7),
  };
}

export interface DDVelocityConfig {
  autopausePct: number;        // fraction of account size (0.03 = 3%)
  warningPct: number;          // fraction of account size (0.015 = 1.5%)
  windowMinutes: number;       // rolling window in minutes
  topstepBufferTighten: number; // proportional tighten factor for Topstep near trailing floor
}

// ─── Equity snapshot store ────────────────────────────────────────────────────
// Per-session sliding window of (timestamp, equity) samples, one per minute.
// Kept in-process memory. On restart the window is empty — gate fires conservatively
// once 2+ minutes of data have accumulated. This is safe: at restart the operator
// has just cleared any pause, so a fresh 2hr window is appropriate.

interface EquitySample {
  capturedAt: number;   // Date.now() ms
  equity: number;       // account equity at sample time
}

// sessionId → chronological ring buffer (newest last)
const _equityWindows: Map<string, EquitySample[]> = new Map();

/** Maximum samples to retain per session (3h at 1/min = 180 samples) */
const MAX_SAMPLES = 180;

// ─── Public API ───────────────────────────────────────────────────────────────

export interface DDVelocityCheckResult {
  sessionId: string;
  accountId: string | null;
  firmId: string | null;
  currentEquity: number;
  accountSize: number;
  windowMinutes: number;
  windowPeakEquity: number;
  rollingDD: number;
  rollingDDPct: number;
  effectiveThreshold: number;  // after Topstep tightening, if applicable
  topstepTightenApplied: boolean;
  level: "ok" | "warning" | "autopause";
  alreadyPaused: boolean;
}

/**
 * Record the current equity snapshot for a session and evaluate DD velocity.
 *
 * Callers: paper-execution-service.ts (on every tick / bar evaluation) and the
 * dd-velocity-cron scheduler job (minute-level batch sweep of all active sessions).
 *
 * Returns the check result. Side effects (audit, SSE, Discord, setMode) fire
 * fire-and-forget — never block the caller.
 */
export async function recordEquityAndCheck(
  sessionId: string,
  currentEquity: number,
  accountSize: number,
  firmId: string | null | undefined,
): Promise<DDVelocityCheckResult> {
  const cfg = getDDVelocityConfig();
  const now = Date.now();

  // Append sample to window
  const window = _equityWindows.get(sessionId) ?? [];
  window.push({ capturedAt: now, equity: currentEquity });

  // Trim to max retention
  while (window.length > MAX_SAMPLES) window.shift();

  // Trim to rolling window (1-second tolerance handles ms skew between sample injection
  // and the internal Date.now() call — a sample at exactly windowMinutes old is kept).
  const windowCutoff = now - cfg.windowMinutes * 60_000 - 1_000;
  const trimmed = window.filter((s) => s.capturedAt >= windowCutoff);
  _equityWindows.set(sessionId, trimmed);

  // Need at least 2 samples to measure velocity
  if (trimmed.length < 2) {
    return {
      sessionId,
      accountId: null,
      firmId: firmId ?? null,
      currentEquity,
      accountSize,
      windowMinutes: cfg.windowMinutes,
      windowPeakEquity: currentEquity,
      rollingDD: 0,
      rollingDDPct: 0,
      effectiveThreshold: cfg.autopausePct,
      topstepTightenApplied: false,
      level: "ok",
      alreadyPaused: false,
    };
  }

  // Peak equity within the window
  const windowPeakEquity = Math.max(...trimmed.map((s) => s.equity));
  const rollingDD = Math.max(0, windowPeakEquity - currentEquity);
  const rollingDDPct = rollingDD / accountSize;

  // Compute effective threshold — Topstep tightening
  let effectiveAutopausePct = cfg.autopausePct;
  let effectiveWarningPct = cfg.warningPct;
  let topstepTightenApplied = false;

  const firmConfig = firmId ? getFirmAccount(firmId) : null;
  if (firmId === "topstep" && firmConfig) {
    // Trailing buffer = maxDrawdown (Topstep EOD trailing DD amount, e.g. $2000).
    // "How close to the trailing floor" = total drawdown from account starting equity,
    // NOT just the in-window rolling DD. The trailing floor erodes from the account's
    // all-time high (simplified here as accountSize minus current equity).
    const trailingBuffer = firmConfig.maxDrawdown;
    const totalAccountDD = Math.max(0, accountSize - currentEquity); // dollars already lost
    const remainingBuffer = Math.max(0, trailingBuffer - totalAccountDD);
    // "Within tighten%" of breach = remaining buffer < trailingBuffer * (1 - tighten)
    // e.g. tighten=0.7: fires when remaining buffer < 30% of trailingBuffer
    if (remainingBuffer < trailingBuffer * (1 - cfg.topstepBufferTighten)) {
      // Scale the threshold down proportionally to remaining room.
      const roomFraction = Math.max(0, remainingBuffer / trailingBuffer);
      effectiveAutopausePct = cfg.autopausePct * roomFraction;
      effectiveWarningPct = cfg.warningPct * roomFraction;
      topstepTightenApplied = true;
    }
  }

  // Determine level
  let level: "ok" | "warning" | "autopause" = "ok";
  if (rollingDDPct >= effectiveAutopausePct) {
    level = "autopause";
  } else if (rollingDDPct >= effectiveWarningPct) {
    level = "warning";
  }

  const result: DDVelocityCheckResult = {
    sessionId,
    accountId: null,  // resolved by caller if needed
    firmId: firmId ?? null,
    currentEquity,
    accountSize,
    windowMinutes: cfg.windowMinutes,
    windowPeakEquity,
    rollingDD,
    rollingDDPct,
    effectiveThreshold: effectiveAutopausePct,
    topstepTightenApplied,
    level,
    alreadyPaused: false,
  };

  // Fire side effects without blocking
  if (level === "autopause") {
    _handleAutopause(result).catch((err) =>
      logger.error({ err, sessionId }, "dd-velocity-gate: autopause handler error (non-blocking)"),
    );
  } else if (level === "warning") {
    _handleWarning(result).catch((err) =>
      logger.error({ err, sessionId }, "dd-velocity-gate: warning handler error (non-blocking)"),
    );
  }

  return result;
}

/**
 * Batch check all active sessions. Called by the dd-velocity-cron scheduler job.
 * Returns results for all active sessions that had equity data available.
 */
export async function batchCheckActiveSessions(): Promise<DDVelocityCheckResult[]> {
  const sessions = await db
    .select({
      id: paperSessions.id,
      firmId: paperSessions.firmId,
      currentEquity: paperSessions.currentEquity,
      startingCapital: paperSessions.startingCapital,
    })
    .from(paperSessions)
    .where(eq(paperSessions.status, "active"));

  const results: DDVelocityCheckResult[] = [];
  for (const session of sessions) {
    const equity = Number(session.currentEquity);
    const accountSize = Number(session.startingCapital);
    const result = await recordEquityAndCheck(session.id, equity, accountSize, session.firmId);
    results.push(result);
  }
  return results;
}

/**
 * Test-only: clear the equity windows for a specific session (or all sessions).
 * Production code must never call this.
 */
export function __resetEquityWindowsForTests(sessionId?: string): void {
  if (sessionId) {
    _equityWindows.delete(sessionId);
  } else {
    _equityWindows.clear();
  }
}

/**
 * Inject a synthetic equity curve for testing. Allows unit tests to drive
 * the gate without a live DB.
 *
 * @param sessionId  Session to inject into.
 * @param samples    Array of { capturedAt (ms), equity } — oldest first.
 */
export function __injectEquitySamplesForTests(
  sessionId: string,
  samples: { capturedAt: number; equity: number }[],
): void {
  _equityWindows.set(sessionId, [...samples]);
}

// ─── Private side-effect handlers ────────────────────────────────────────────

async function _handleWarning(result: DDVelocityCheckResult): Promise<void> {
  const pctDisplay = (result.rollingDDPct * 100).toFixed(2);
  const windowMin = result.windowMinutes;

  logger.warn(
    {
      sessionId: result.sessionId,
      firmId: result.firmId,
      rollingDDPct: result.rollingDDPct,
      effectiveThreshold: result.effectiveThreshold,
      topstepTightenApplied: result.topstepTightenApplied,
    },
    `DD velocity warning: ${pctDisplay}% in ${windowMin}min`,
  );

  await db.insert(auditLog).values({
    action: "risk.dd_velocity_warning",
    entityType: "paper_session",
    entityId: result.sessionId,
    decisionAuthority: "system",
    input: {
      sessionId: result.sessionId,
      firmId: result.firmId,
      windowMinutes: result.windowMinutes,
      windowPeakEquity: result.windowPeakEquity,
      currentEquity: result.currentEquity,
      accountSize: result.accountSize,
    } as Record<string, unknown>,
    result: {
      rollingDD: result.rollingDD,
      rollingDDPct: result.rollingDDPct,
      effectiveThreshold: result.effectiveThreshold,
      topstepTightenApplied: result.topstepTightenApplied,
      level: "warning",
    } as unknown as Record<string, unknown>,
    status: "success",
  });

  broadcastSSE("risk:dd_velocity_warning", {
    sessionId: result.sessionId,
    firmId: result.firmId,
    rollingDDPct: result.rollingDDPct,
    windowMinutes: result.windowMinutes,
    effectiveThreshold: result.effectiveThreshold,
    topstepTightenApplied: result.topstepTightenApplied,
    timestamp: new Date().toISOString(),
  });
}

async function _handleAutopause(result: DDVelocityCheckResult): Promise<void> {
  const pctDisplay = (result.rollingDDPct * 100).toFixed(2);
  const windowMin = result.windowMinutes;

  // Check current pipeline mode to avoid duplicate audit + notification
  const { getMode, setMode } = await import("./pipeline-control-service.js");
  const currentMode = await getMode();
  const alreadyPaused = currentMode === "AUTOPAUSE_DD_VELOCITY";
  result.alreadyPaused = alreadyPaused;

  if (alreadyPaused) {
    logger.debug({ sessionId: result.sessionId }, "dd-velocity-gate: already AUTOPAUSE_DD_VELOCITY, skipping duplicate fire");
    return;
  }

  logger.error(
    {
      sessionId: result.sessionId,
      firmId: result.firmId,
      rollingDDPct: result.rollingDDPct,
      effectiveThreshold: result.effectiveThreshold,
      topstepTightenApplied: result.topstepTightenApplied,
    },
    `DD velocity AUTOPAUSE: ${pctDisplay}% drawdown in ${windowMin}min — setting AUTOPAUSE_DD_VELOCITY`,
  );

  // 1. Write audit row
  await db.insert(auditLog).values({
    action: "risk.dd_velocity_autopause",
    entityType: "paper_session",
    entityId: result.sessionId,
    decisionAuthority: "system",
    input: {
      sessionId: result.sessionId,
      firmId: result.firmId,
      windowMinutes: result.windowMinutes,
      windowPeakEquity: result.windowPeakEquity,
      currentEquity: result.currentEquity,
      accountSize: result.accountSize,
    } as Record<string, unknown>,
    result: {
      rollingDD: result.rollingDD,
      rollingDDPct: result.rollingDDPct,
      effectiveThreshold: result.effectiveThreshold,
      topstepTightenApplied: result.topstepTightenApplied,
      level: "autopause",
      previousMode: currentMode,
    } as unknown as Record<string, unknown>,
    status: "success",
  });

  // 2. Set pipeline mode to AUTOPAUSE_DD_VELOCITY
  await setMode(
    "AUTOPAUSE_DD_VELOCITY",
    `DD velocity breach: ${pctDisplay}% in ${windowMin}min on session ${result.sessionId}`,
  );

  // 3. Prometheus counter
  ddVelocityAutopauseTotal.inc();

  // 4. SSE broadcast
  broadcastSSE("risk:dd_velocity_autopause", {
    sessionId: result.sessionId,
    firmId: result.firmId,
    rollingDDPct: result.rollingDDPct,
    windowMinutes: result.windowMinutes,
    windowPeakEquity: result.windowPeakEquity,
    currentEquity: result.currentEquity,
    effectiveThreshold: result.effectiveThreshold,
    topstepTightenApplied: result.topstepTightenApplied,
    timestamp: new Date().toISOString(),
  });

  // 5. Discord CRITICAL — operator must manually clear
  const accountLabel = result.sessionId.slice(0, 8);
  const operatorBody = [
    `**Account \`${accountLabel}\` PAUSED: drawdown velocity breach**`,
    ``,
    `Drawdown: **${pctDisplay}%** in **${windowMin} min** (threshold: ${(result.effectiveThreshold * 100).toFixed(2)}%)`,
    `Firm: ${result.firmId ?? "unknown"}`,
    result.topstepTightenApplied ? `Topstep trailing-buffer tightening was active.` : "",
    ``,
    `**Manual operator clear required.** See admin panel or call:`,
    `  POST /api/admin/pipeline/mode  { "mode": "ACTIVE", "reason": "dd_velocity_cleared" }`,
  ]
    .filter(Boolean)
    .join("\n");

  const body = appendFamilyGradePostscript(
    operatorBody,
    `The bot stopped trading because the account lost more than ${pctDisplay}% in ${windowMin} minutes — this is a safety pause.`,
    `No action needed from you. The operator will review and restart the bot when it is safe to trade again.`,
  );

  notifyCritical(
    `DD Velocity Autopause — Account ${accountLabel}`,
    body,
    {
      sessionId: result.sessionId,
      firmId: result.firmId,
      rollingDDPct: result.rollingDDPct,
      windowMinutes: result.windowMinutes,
    },
  );
}
