/**
 * Windows Health Check Service — W17 / C8
 *
 * Wraps `scripts/pre-trading-day-health-check.ps1` in a typed, testable
 * service. Called by the 8:00 AM ET pre-trading-day-health-check cron in
 * scheduler.ts.
 *
 * Behavior on non-zero exit:
 *   1. Critical alert via notifyCritical()
 *   2. Pipeline paused via setMode("PAUSED", reason) — fail-CLOSED
 *   3. SSE event "windows:health-check-failed" for dashboard
 *
 * Bypass for testing: set BYPASS_PRE_MARKET_HEALTH_CHECK=true.
 *
 * Pause stickiness (deepscan7 DS7-C2 2026-07-02): pauses for failed_updates /
 * degraded / script_error remain sticky — the operator must explicitly resume.
 * The ONE exception is pending_reboot: a mid-vacation forced Windows reboot
 * would otherwise halt trading for the remainder of the absence. When THIS
 * service paused for reboot-pending (durable provenance row) and a later
 * health-check pass reports the RebootPending flag CLEAR, the pipeline
 * auto-resumes. Operator-initiated pauses are NEVER auto-resumed — provenance
 * is verified against the latest pipeline.mode_change audit row.
 */

import path from "path";
import { spawn } from "child_process";
import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger.js";
import { broadcastSSE } from "../routes/sse.js";
import { notifyCritical, notifyInfo } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";

export interface HealthCheckResult {
  exitCode: number;
  status: "healthy" | "pending_reboot" | "failed_updates" | "degraded" | "script_error" | "bypassed";
  reason: string;
  durationMs: number;
  /** Raw JSON payload from the PowerShell script (parsed). May be null on bypass or parse failure. */
  payload: unknown;
  /** True if the pipeline was paused as a result of this check. */
  pipelinePaused: boolean;
}

const SCRIPT_PATH_RELATIVE = path.join("scripts", "pre-trading-day-health-check.ps1");
const POWERSHELL_TIMEOUT_MS = 60_000; // 60s — should complete in ~2s
const DEFAULT_POWERSHELL = process.platform === "win32" ? "powershell.exe" : "pwsh";

// deepscan7 DS7-C2 2026-07-02: durable provenance marker for reboot-pending
// pauses. system_parameters.current_value is NUMERIC, so 1 = "this service
// paused the pipeline because RebootPending was set", 0/absent = it did not.
// The reason prefix is double-checked against the latest pipeline.mode_change
// audit row so an operator pause layered AFTER our reboot pause wins.
export const REBOOT_PAUSE_PROVENANCE_PARAM = "windows_reboot_pause_provenance";
const REBOOT_PAUSE_REASON_PREFIX = "pre-market-health-check: windows-pending-reboot";

/**
 * Map raw exit code to a structured status. Centralized so tests and the
 * cron handler agree on the failure mode taxonomy.
 */
export function classifyExitCode(exitCode: number): HealthCheckResult["status"] {
  switch (exitCode) {
    case 0:
      return "healthy";
    case 1:
      return "pending_reboot";
    case 2:
      return "failed_updates";
    case 3:
      return "degraded";
    case 99:
      return "script_error";
    default:
      // Any other non-zero is treated as script_error (fail-closed).
      return exitCode === 0 ? "healthy" : "script_error";
  }
}

/**
 * Build the human-readable reason string used both for the pause and the alert.
 */
export function buildReason(status: HealthCheckResult["status"], payload: unknown): string {
  const base = (() => {
    switch (status) {
      case "healthy":
        return "Pre-market health check passed";
      case "pending_reboot":
        return "windows-pending-reboot — reboot required before trading";
      case "failed_updates":
        return "windows-update-failures — failed install events in last 24h";
      case "degraded":
        return "host-degraded — Node/Python/disk/RAM check failed";
      case "script_error":
        return "health-check-crash — script exited unexpectedly";
      case "bypassed":
        return "Pre-market health check bypassed via BYPASS_PRE_MARKET_HEALTH_CHECK";
    }
  })();

  // Append the first failed check detail when available.
  if (payload && typeof payload === "object" && "checks" in payload) {
    const checks = (payload as { checks?: Array<{ status: string; check: string; detail: string }> }).checks ?? [];
    const firstFail = checks.find((c) => c.status === "fail");
    if (firstFail) {
      return `${base} (${firstFail.check}: ${firstFail.detail})`;
    }
  }
  return base;
}

interface RunHealthCheckScriptOptions {
  /** Absolute path to the PowerShell script. Defaults to scripts/ in CWD. */
  scriptPath?: string;
  /** PowerShell executable. Defaults to powershell.exe on Windows, pwsh elsewhere. */
  powershellExe?: string;
  /** Timeout in ms. Defaults to 60_000. */
  timeoutMs?: number;
  /** Override for testing — bypass the entire run. */
  forceBypass?: boolean;
}

/**
 * Spawn the PowerShell script and capture exit code + stdout JSON.
 * Internal — exported only for direct unit tests.
 */
export async function runHealthCheckScript(
  opts: RunHealthCheckScriptOptions = {},
): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }> {
  const scriptPath = opts.scriptPath ?? path.resolve(process.cwd(), SCRIPT_PATH_RELATIVE);
  const powershellExe = opts.powershellExe ?? DEFAULT_POWERSHELL;
  const timeoutMs = opts.timeoutMs ?? POWERSHELL_TIMEOUT_MS;
  const t0 = Date.now();

  return await new Promise((resolve, reject) => {
    const child = spawn(
      powershellExe,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      { windowsHide: true },
    );

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, timeoutMs);

    child.stdout?.on("data", (b: Buffer) => {
      stdout += b.toString("utf-8");
    });
    child.stderr?.on("data", (b: Buffer) => {
      stderr += b.toString("utf-8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        // Treat timeout as fail-closed (exit code 99 — script_error).
        resolve({ exitCode: 99, stdout, stderr: stderr + `\n[health-check] timed out after ${timeoutMs}ms`, durationMs: Date.now() - t0 });
        return;
      }
      resolve({ exitCode: code ?? 99, stdout, stderr, durationMs: Date.now() - t0 });
    });
  });
}

/**
 * Public entry point — run the check, parse the output, take action on failure.
 *
 * Pause-on-failure is performed via dynamic import of pipeline-control-service
 * so this module is testable without standing up the full DB.
 */
export async function runPreTradingDayHealthCheck(
  opts: RunHealthCheckScriptOptions = {},
): Promise<HealthCheckResult> {
  // Bypass short-circuit
  if (opts.forceBypass || process.env.BYPASS_PRE_MARKET_HEALTH_CHECK === "true") {
    logger.warn("Pre-trading-day health check BYPASSED via BYPASS_PRE_MARKET_HEALTH_CHECK env var");
    return {
      exitCode: 0,
      status: "bypassed",
      reason: buildReason("bypassed", null),
      durationMs: 0,
      payload: null,
      pipelinePaused: false,
    };
  }

  // Non-Windows hosts are a no-op (returns healthy). The plan targets Skytech
  // Windows; CI / Mac / Linux dev boxes should not block on a Windows-specific
  // check. Logged at info so it's visible in dev.
  if (process.platform !== "win32") {
    logger.info(
      { platform: process.platform },
      "Pre-trading-day health check skipped — non-Windows host, returning healthy",
    );
    return {
      exitCode: 0,
      status: "healthy",
      reason: "Skipped on non-Windows platform",
      durationMs: 0,
      payload: null,
      pipelinePaused: false,
    };
  }

  let scriptResult: { exitCode: number; stdout: string; stderr: string; durationMs: number };
  try {
    scriptResult = await runHealthCheckScript(opts);
  } catch (err) {
    // Spawn-level error — fail closed.
    logger.error({ err }, "Pre-trading-day health check spawn failed");
    const reason = `health-check-crash — could not spawn PowerShell: ${err instanceof Error ? err.message : String(err)}`;
    await pausePipelineSafely(reason);
    notifyCritical(
      "Pre-trading-day health check crashed",
      appendFamilyGradePostscript(
        `Could not spawn PowerShell. Pipeline paused.\n${reason}`,
        "The trading computer had a health issue.",
        "No action needed — the bot is self-healing. Call Tony if trading stops.",
      ),
      { error: String(err) },
    );
    broadcastSSE("windows:health-check-failed", {
      status: "script_error",
      reason,
      timestamp: new Date().toISOString(),
    });
    return {
      exitCode: 99,
      status: "script_error",
      reason,
      durationMs: 0,
      payload: null,
      pipelinePaused: true,
    };
  }

  // Parse JSON payload from stdout. Last non-empty line is the JSON; the
  // PowerShell script writes nothing else to stdout, but be defensive against
  // trailing whitespace or accidental Write-Host noise.
  let payload: unknown = null;
  const trimmed = scriptResult.stdout.trim();
  if (trimmed.length > 0) {
    try {
      payload = JSON.parse(trimmed);
    } catch {
      // Try last non-empty line as a fallback.
      const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const lastLine = lines[lines.length - 1];
      if (lastLine) {
        try {
          payload = JSON.parse(lastLine);
        } catch {
          payload = null;
        }
      }
    }
  }

  const status = classifyExitCode(scriptResult.exitCode);
  const reason = buildReason(status, payload);

  // Healthy — log and return.
  if (status === "healthy") {
    logger.info(
      { exitCode: scriptResult.exitCode, durationMs: scriptResult.durationMs, payload },
      "Pre-trading-day health check passed",
    );
    // deepscan7 DS7-C2 2026-07-02: healthy = RebootPending flag is CLEAR. If the
    // pipeline is still paused from OUR earlier reboot-pending pause, auto-resume.
    try {
      await maybeAutoResumeAfterReboot();
    } catch (err) {
      logger.error({ err }, "windows-health-check: auto-resume-after-reboot check failed (non-blocking)");
    }
    return {
      exitCode: scriptResult.exitCode,
      status,
      reason,
      durationMs: scriptResult.durationMs,
      payload,
      pipelinePaused: false,
    };
  }

  // Non-healthy — pause pipeline (fail-CLOSED), alert, broadcast SSE.
  logger.error(
    {
      exitCode: scriptResult.exitCode,
      status,
      reason,
      stderr: scriptResult.stderr.slice(0, 1000),
      payload,
    },
    "Pre-trading-day health check FAILED — pausing pipeline",
  );

  const paused = await pausePipelineSafely(reason);

  // deepscan7 DS7-C2 2026-07-02: record durable provenance ONLY for the
  // reboot-pending failure mode — that is the one class of pause the service
  // is allowed to auto-resume once the RebootPending registry flag clears.
  if (status === "pending_reboot" && paused) {
    try {
      await setRebootPauseProvenance(true);
    } catch (err) {
      logger.error({ err }, "windows-health-check: failed to record reboot-pause provenance — auto-resume will not engage");
    }
  }

  notifyCritical(
    `Pre-trading-day health check failed: ${status}`,
    appendFamilyGradePostscript(
      `${reason}\n\nPipeline has been PAUSED. Review infra/windows-update-policy.md and resume manually after the host is healthy.`,
      "The trading computer had a health issue.",
      "No action needed — the bot is self-healing. Call Tony if trading stops.",
    ),
    { exitCode: scriptResult.exitCode, status, payload },
  );

  broadcastSSE("windows:health-check-failed", {
    status,
    exitCode: scriptResult.exitCode,
    reason,
    timestamp: new Date().toISOString(),
  });

  return {
    exitCode: scriptResult.exitCode,
    status,
    reason,
    durationMs: scriptResult.durationMs,
    payload,
    pipelinePaused: true,
  };
}

/**
 * Pause the pipeline. Wrapped so a setMode failure does not mask the
 * original health-check failure — we still want the alert + SSE to fire.
 * Returns true when the pause succeeded (deepscan7 DS7-C2 — provenance is
 * only recorded for pauses that actually took effect).
 */
async function pausePipelineSafely(reason: string): Promise<boolean> {
  try {
    const { setMode } = await import("./pipeline-control-service.js");
    await setMode("PAUSED", `pre-market-health-check: ${reason}`);
    return true;
  } catch (err) {
    logger.error(
      { err, reason },
      "Failed to pause pipeline after health-check failure — operator MUST manually pause",
    );
    notifyCritical(
      "CRITICAL: Pipeline pause failed during health-check response",
      appendFamilyGradePostscript(
        `The pre-market health check detected a failure (${reason}) but setMode() threw. Pipeline state is UNCHANGED. Pause manually NOW.`,
        "The trading computer has a serious problem.",
        "Call Tony immediately — the computer may need attention.",
      ),
      { reason, error: String(err) },
    );
    return false;
  }
}

/**
 * deepscan7 DS7-C2 2026-07-02 — durable reboot-pause provenance.
 * Upserts the system_parameters row (numeric 1 = reboot pause owned by this
 * service, 0 = cleared). Dynamic imports keep the module testable without DB.
 */
export async function setRebootPauseProvenance(active: boolean): Promise<void> {
  const { db } = await import("../db/index.js");
  const { systemParameters } = await import("../db/schema.js");
  await db
    .insert(systemParameters)
    .values({
      paramName: REBOOT_PAUSE_PROVENANCE_PARAM,
      currentValue: active ? "1" : "0",
      domain: "scheduler",
      description: "1 = pipeline was paused by windows-health-check for a pending Windows reboot (auto-resume eligible)",
    })
    .onConflictDoUpdate({
      target: systemParameters.paramName,
      set: { currentValue: active ? "1" : "0", updatedAt: new Date() },
    });
}

export type AutoResumeOutcome =
  | "resumed"
  | "no_provenance"
  | "not_paused"
  | "operator_owns_pause";

/**
 * deepscan7 DS7-C2 2026-07-02 — auto-resume after a reboot-pending pause.
 *
 * Called from the HEALTHY branch of runPreTradingDayHealthCheck (healthy exit
 * code means the RebootPending registry flag is CLEAR). Resumes the pipeline
 * IF AND ONLY IF:
 *   1. the durable provenance row says THIS service paused for reboot-pending;
 *   2. the pipeline is currently PAUSED;
 *   3. the LATEST pipeline.mode_change audit row is still our reboot pause —
 *      any later operator mode change (pause or resume) transfers ownership
 *      and permanently disqualifies auto-resume for that pause.
 * If the flag is still set the health check exits non-zero (pending_reboot),
 * this function is never reached, and the pipeline stays paused.
 */
export async function maybeAutoResumeAfterReboot(): Promise<{ resumed: boolean; outcome: AutoResumeOutcome }> {
  const { db } = await import("../db/index.js");
  const { systemParameters, auditLog } = await import("../db/schema.js");
  const { eq, desc } = await import("drizzle-orm");

  const provRows = await db
    .select({ currentValue: systemParameters.currentValue })
    .from(systemParameters)
    .where(eq(systemParameters.paramName, REBOOT_PAUSE_PROVENANCE_PARAM))
    .limit(1);
  if (!provRows[0] || String(provRows[0].currentValue) !== "1") {
    return { resumed: false, outcome: "no_provenance" };
  }

  const { getMode, setMode } = await import("./pipeline-control-service.js");
  const mode = await getMode();
  if (mode !== "PAUSED") {
    // Someone (operator or another path) already resumed/changed mode — the
    // stale provenance marker must not linger into a FUTURE unrelated pause.
    await setRebootPauseProvenance(false);
    logger.info({ mode }, "windows-health-check: reboot-pause provenance cleared — pipeline no longer PAUSED");
    return { resumed: false, outcome: "not_paused" };
  }

  const lastModeChange = await db
    .select({ input: auditLog.input })
    .from(auditLog)
    .where(eq(auditLog.action, "pipeline.mode_change"))
    .orderBy(desc(auditLog.createdAt))
    .limit(1);
  const lastInput = (lastModeChange[0]?.input ?? null) as { newMode?: string; reason?: string } | null;
  const oursIsLatest =
    lastInput?.newMode === "PAUSED" &&
    typeof lastInput.reason === "string" &&
    lastInput.reason.startsWith(REBOOT_PAUSE_REASON_PREFIX);
  if (!oursIsLatest) {
    // An operator-initiated (or other) pause superseded ours — they own the
    // pause now. Clear provenance so we never auto-resume their decision.
    await setRebootPauseProvenance(false);
    logger.info(
      { lastModeChange: lastInput },
      "windows-health-check: pause ownership transferred (latest mode change is not our reboot pause) — auto-resume declined",
    );
    return { resumed: false, outcome: "operator_owns_pause" };
  }

  await setMode("ACTIVE", "windows_health.auto_resumed_after_reboot — RebootPending flag cleared on subsequent health check");
  await setRebootPauseProvenance(false);

  const { insertAuditRowSafe } = await import("../lib/audit-log-helper.js");
  await insertAuditRowSafe({
    action: "windows_health.auto_resumed_after_reboot",
    entityType: "system",
    entityId: null,
    decisionAuthority: "system",
    input: { provenance: REBOOT_PAUSE_PROVENANCE_PARAM, previousMode: "PAUSED" } as Record<string, unknown>,
    result: { newMode: "ACTIVE", reason: "reboot_pending_flag_cleared" } as Record<string, unknown>,
    status: "success",
    correlationId: randomUUID(),
  });

  notifyInfo(
    "Pipeline auto-resumed — Windows reboot completed",
    appendFamilyGradePostscript(
      "The pre-market health check paused trading earlier because Windows had a pending reboot. Today's check confirms the reboot completed (RebootPending flag clear), so the pipeline has been automatically resumed.",
      "The trading computer restarted for a Windows update and the bot resumed trading on its own.",
      "No action needed — everything recovered automatically.",
    ),
    { action: "windows_health.auto_resumed_after_reboot" },
  );

  broadcastSSE("windows:health-check-auto-resumed", {
    reason: "reboot_pending_flag_cleared",
    timestamp: new Date().toISOString(),
  });

  logger.info("windows-health-check: pipeline auto-resumed after reboot-pending pause (flag cleared)");
  return { resumed: true, outcome: "resumed" };
}
