/**
 * Remote Power-Cycle Service — Pass 7 Track B
 *
 * Escape valve for the dead-man's heartbeat when the 24h auto-restart cap is
 * reached (3 failed self-restarts in 24h) and the operator is on vacation.
 *
 * When KASA_DEVICE_IP is set, this service:
 *   1. Invokes scripts/remote-power-cycle.ps1 via child_process.spawn.
 *   2. Awaits script stdout/stderr (30-second OFF + ON cycle; 60s hard timeout).
 *   3. Writes a 'recovery.remote_power_cycle_triggered' CRITICAL audit row.
 *   4. Emits a Discord CRITICAL alert with:
 *        - Operator version: full technical details + audit ID.
 *        - Family-grade postscript: plain English + "check heartbeat in 10 min".
 *
 * When KASA_DEVICE_IP is NOT set, this service is never called (caller checks
 * the env var before invoking).
 *
 * Import logger from ./logger.js per CLAUDE.md §13.
 */

import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger.js";
import { notifyCritical } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");

/** Hard timeout for the PowerShell script (OFF wait 30s + ON + margins). */
const SCRIPT_TIMEOUT_MS = 75_000; // 75 seconds

// ─── A-12: Daily KASA cycle cap ──────────────────────────────────────────────
// Prevents a boot-loop from firing KASA repeatedly during a 30-day unattended run.
// Cap defaults to 2 per 24h; overrideable via KASA_DAILY_CYCLE_CAP env var.
const KASA_DAILY_CYCLE_CAP = Math.max(
  1,
  parseInt(process.env["KASA_DAILY_CYCLE_CAP"] ?? "2", 10) || 2,
);

/**
 * DB-backed count of KASA power-cycle attempts in the last 24h.
 * Counts 'recovery.remote_power_cycle_triggered' audit rows — written BEFORE
 * each cycle — so even cycles that crash mid-script are counted.
 * Returns 0 on error (fail-open: better to attempt one extra cycle than to
 * skip recovery because the count query is broken).
 */
async function countKasaCyclesLast24h(): Promise<number> {
  try {
    const { auditLog } = await import("../db/schema.js");
    const { and, eq, gte, count } = await import("drizzle-orm");
    const { db } = await import("../db/index.js");
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await db
      .select({ n: count() })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "recovery.remote_power_cycle_triggered"),
          gte(auditLog.createdAt, windowStart),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  } catch (err) {
    logger.warn({ err }, "remote-power-cycle: daily cap count query failed (fail-open → counting 0)");
    return 0;
  }
}

/**
 * Invoke the TP-Link Kasa smart-plug power-cycle script.
 *
 * @param reason       Human-readable reason for the cycle (logged to audit + Discord).
 * @param correlationId Parent correlation ID from dead-mans-heartbeat.
 * @returns            true if the script exited 0, false on any failure.
 */
export async function triggerRemotePowerCycle(
  reason: string,
  correlationId: string,
): Promise<boolean> {
  // ─── M13: Partial-config guard ─────────────────────────────────────────────
  // All three KASA env vars must be set or all absent. A partial config creates
  // a false impression the escape valve is active when it will fail at invocation.
  const kasaIpSet   = Boolean(process.env["KASA_DEVICE_IP"]);
  const kasaUserSet = Boolean(process.env["KASA_USERNAME"]);
  const kasaPassSet = Boolean(process.env["KASA_PASSWORD"]);
  const allSet  = kasaIpSet && kasaUserSet && kasaPassSet;
  const noneSet = !kasaIpSet && !kasaUserSet && !kasaPassSet;

  if (!allSet && !noneSet) {
    // Partial config — emit audit BEFORE throw so it's DB-visible even if caller doesn't catch.
    const missingVars = [
      !kasaIpSet   ? "KASA_DEVICE_IP"  : null,
      !kasaUserSet ? "KASA_USERNAME"   : null,
      !kasaPassSet ? "KASA_PASSWORD"   : null,
    ].filter(Boolean);

    const guardCorrelationId = randomUUID();

    try {
      const { auditLog } = await import("../db/schema.js");
      const { db }       = await import("../db/index.js");
      await db.insert(auditLog).values({
        action: "recovery.remote_power_cycle_partial_config",
        entityType: "system",
        entityId: null,
        decisionAuthority: "system",
        input: { reason, parentCorrelationId: correlationId, missingVars } as Record<string, unknown>,
        result: { status: "partial_config_rejected", guardCorrelationId } as Record<string, unknown>,
        status: "failure",
        correlationId: guardCorrelationId,
      });
    } catch (auditErr) {
      logger.error(
        { auditErr, guardCorrelationId },
        "remote-power-cycle: partial-config audit write failed",
      );
    }

    logger.error(
      { missingVars, reason, correlationId: guardCorrelationId },
      "remote-power-cycle: partial Kasa config — all 3 env vars must be set or all absent",
    );

    throw new Error(
      `remote_power_cycle_partial_config: KASA_DEVICE_IP/USERNAME/PASSWORD must all be set or all absent. ` +
      `Missing: ${missingVars.join(", ")}`,
    );
  }

  // ─── A-12: Daily KASA cycle cap ──────────────────────────────────────────────
  // Check BEFORE writing the cycle audit row so cap is enforced against cycles
  // that have already had their audit row written (the count query targets the
  // 'recovery.remote_power_cycle_triggered' action, written pre-script).
  const cyclesInLast24h = await countKasaCyclesLast24h();
  if (cyclesInLast24h >= KASA_DAILY_CYCLE_CAP) {
    const capCorrelationId = randomUUID();
    logger.error(
      { cyclesInLast24h, cap: KASA_DAILY_CYCLE_CAP, reason, correlationId: capCorrelationId },
      "remote-power-cycle: daily KASA cap reached — blocking cycle to prevent boot-loop destruction",
    );

    try {
      const { auditLog } = await import("../db/schema.js");
      const { db } = await import("../db/index.js");
      await db.insert(auditLog).values({
        action: "recovery.remote_power_cycle_cap_reached",
        entityType: "system",
        entityId: null,
        decisionAuthority: "system",
        input: {
          reason,
          parentCorrelationId: correlationId,
          cyclesInLast24h,
          cap: KASA_DAILY_CYCLE_CAP,
        } as Record<string, unknown>,
        result: { status: "cap_blocked", capCorrelationId } as Record<string, unknown>,
        status: "failure",
        correlationId: capCorrelationId,
      });
    } catch (auditErr) {
      logger.error({ auditErr, capCorrelationId }, "remote-power-cycle: cap-reached audit write failed");
    }

    notifyCritical(
      `Heartbeat: KASA daily cap reached (${cyclesInLast24h}/${KASA_DAILY_CYCLE_CAP}) — cycle BLOCKED`,
      appendFamilyGradePostscript(
        `Remote power-cycle was requested but the daily cap of ${KASA_DAILY_CYCLE_CAP} cycles in 24h has ` +
          `been reached (${cyclesInLast24h} already fired). The cycle was BLOCKED to prevent equipment ` +
          `damage from a boot-loop. Trigger reason: ${reason}. Audit ID: ${capCorrelationId}. ` +
          `Manual intervention required — check NSSM event log and power-cycle manually if needed.`,
        "The trading system tried to restart the computer too many times today. The automatic restart was blocked to protect the hardware.",
        "Call Tony immediately. If the trading is stopped, you may manually power-cycle the tower by holding the power button for 5 seconds, but only after calling Tony.",
      ),
      { cyclesInLast24h, cap: KASA_DAILY_CYCLE_CAP, reason, capCorrelationId, parentCorrelationId: correlationId },
    );

    return false;
  }

  const cycleCorrelationId = randomUUID();
  const scriptPath = pathResolve(PROJECT_ROOT, "scripts", "remote-power-cycle.ps1");

  logger.warn(
    { reason, correlationId, cycleCorrelationId, scriptPath },
    "remote-power-cycle: initiating TP-Link Kasa smart-plug power-cycle",
  );

  // ─── Write audit row BEFORE the script so the attempt is DB-visible even if
  //     the process dies mid-cycle.
  try {
    const { auditLog } = await import("../db/schema.js");
    const { db } = await import("../db/index.js");
    await db.insert(auditLog).values({
      action: "recovery.remote_power_cycle_triggered",
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: {
        reason,
        parentCorrelationId: correlationId,
        kasaDeviceIp: process.env["KASA_DEVICE_IP"] ?? "unknown",
        scriptPath,
      } as Record<string, unknown>,
      result: { status: "pending", cycleCorrelationId } as Record<string, unknown>,
      status: "success",
      correlationId: cycleCorrelationId,
    });
  } catch (auditErr) {
    logger.warn(
      { auditErr, cycleCorrelationId },
      "remote-power-cycle: audit row insert failed (non-blocking — proceeding with cycle)",
    );
  }

  // ─── Spawn the PowerShell script ─────────────────────────────────────────
  const scriptSucceeded = await new Promise<boolean>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const proc = spawn(
      "powershell.exe",
      ["-NonInteractive", "-File", scriptPath],
      {
        env: {
          ...process.env,
          // Ensure Kasa vars are present — they come from process.env already,
          // but be explicit so the spawned shell inherits them.
          KASA_DEVICE_IP: process.env["KASA_DEVICE_IP"] ?? "",
          KASA_USERNAME: process.env["KASA_USERNAME"] ?? "",
          KASA_PASSWORD: process.env["KASA_PASSWORD"] ?? "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    proc.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    const hardTimeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        logger.error(
          { cycleCorrelationId, timeoutMs: SCRIPT_TIMEOUT_MS },
          "remote-power-cycle: script timed out — killing process",
        );
        proc.kill("SIGTERM");
        resolve(false);
      }
    }, SCRIPT_TIMEOUT_MS);

    proc.on("close", (code) => {
      clearTimeout(hardTimeout);
      if (!settled) {
        settled = true;
        logger.info(
          { code, stdout: stdout.trim(), stderr: stderr.trim(), cycleCorrelationId },
          "remote-power-cycle: script exited",
        );
        resolve(code === 0);
      }
    });

    proc.on("error", (err) => {
      clearTimeout(hardTimeout);
      if (!settled) {
        settled = true;
        logger.error(
          { err, cycleCorrelationId },
          "remote-power-cycle: failed to spawn PowerShell script",
        );
        resolve(false);
      }
    });
  });

  // ─── Discord CRITICAL alert ───────────────────────────────────────────────
  const kasaIp = process.env["KASA_DEVICE_IP"] ?? "unknown";
  const statusLabel = scriptSucceeded ? "SUCCESS" : "FAILED";

  const operatorBody = scriptSucceeded
    ? `TP-Link Kasa smart-plug at ${kasaIp} was cycled OFF→30s→ON. ` +
      `Tower should be rebooting now. NSSM will auto-restart TradingForgeAPI. ` +
      `Confirm the heartbeat resumes in the next 10 minutes. ` +
      `Trigger reason: ${reason}. Audit ID: ${cycleCorrelationId}.`
    : `TP-Link Kasa power-cycle FAILED for plug at ${kasaIp}. ` +
      `Auto-restart has been attempted ${3} times in 24h and the remote power-cycle also failed. ` +
      `Manual intervention required. Trigger reason: ${reason}. Audit ID: ${cycleCorrelationId}. ` +
      `Check: pm2 logs / NSSM event log / kasa-cycle.log at C:/Users/tonio/bin/kasa-cycle.log`;

  const familyBody = scriptSucceeded
    ? `The trading bot was not responding and the system tried to restart the home computer using the smart plug. This may work — wait 10 minutes and check if the bot is trading again.`
    : `The trading bot stopped working and the computer could not be restarted automatically. The smart plug also failed to power-cycle the tower.`;

  const familyAction = scriptSucceeded
    ? `Wait 10 minutes. If the bot is still not trading, call Tony.`
    : `Call Tony immediately. If you cannot reach him, go to the home computer and hold the power button for 5 seconds to reboot it manually — the bot will restart on its own.`;

  notifyCritical(
    `Heartbeat: remote power-cycle ${statusLabel} (audit ${cycleCorrelationId.slice(0, 8)})`,
    appendFamilyGradePostscript(
      operatorBody,
      familyBody,
      familyAction,
    ),
    { kasaIp, scriptSucceeded, reason, cycleCorrelationId, parentCorrelationId: correlationId },
  );

  return scriptSucceeded;
}
