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
