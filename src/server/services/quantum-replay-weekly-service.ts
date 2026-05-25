/**
 * quantum-replay-weekly-service.ts — Wave 27 Pass 1.5 (P1.5.A2)
 *
 * Weekly quantum replay analysis service. Spawns scripts/replay-grade-quantum.ts --apply
 * via TS subprocess, parses the verdict + statistical output, and emits a Discord
 * verdict notification via appendFamilyGradePostscript.
 *
 * Audit actions:
 *   - quantum_replay.weekly_verdict_emitted      (success — any verdict)
 *   - quantum_replay.weekly_analysis_failed      (script error — failure + notifyWarning)
 *   - quantum_replay.weekly_analysis_timeout     (>10min — failure + notifyWarning)
 *   - quantum_replay.weekly_analysis_skipped_no_data  (zero replay rows — info)
 *   - quantum_replay.weekly_analysis_loop_halted_skip (kill switch off — info)
 *
 * Kill switch: system_parameters.auto_patch_loop_enabled = "false" halts the job.
 * Timeout: QUANTUM_REPLAY_WEEKLY_TIMEOUT_MS env var (default 600000 = 10 min).
 */

import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { systemParameters } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { notifyWarning, notifyInfo } from "../services/notification-service.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type WeeklyVerdict = "SIGNAL" | "INCONCLUSIVE" | "NO SIGNAL" | "PRELIMINARY";

export type WeeklyAnalysisStatus =
  | "success"
  | "failed"
  | "timeout"
  | "skipped_no_data"
  | "loop_halted_skip";

export interface WeeklyAnalysisResult {
  status: WeeklyAnalysisStatus;
  verdict: WeeklyVerdict | null;
  spearmanRho: number | null;
  spearmanPValue: number | null;
  binomialPValue: number | null;
  sampleSize: number | null;
  durationMs: number;
  reportPath: string | null;
  correlationId: string;
  errorMsg?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const KILL_SWITCH_PARAM = "auto_patch_loop_enabled";
const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes

function _getTimeoutMs(): number {
  const envVal = process.env.QUANTUM_REPLAY_WEEKLY_TIMEOUT_MS;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_TIMEOUT_MS;
}

// ─── Kill switch ──────────────────────────────────────────────────────────────

async function _readKillSwitch(): Promise<boolean> {
  try {
    const rows = await db
      .select({ currentValue: systemParameters.currentValue })
      .from(systemParameters)
      .where(eq(systemParameters.paramName, KILL_SWITCH_PARAM))
      .limit(1);

    if (rows.length === 0) return true; // missing = enabled (fail-open)
    return String(rows[0].currentValue).trim() !== "false";
  } catch (err) {
    logger.warn(
      { err },
      "quantum-replay-weekly: failed to read kill switch — defaulting to enabled",
    );
    return true; // fail-open
  }
}

// ─── Stdout parsing ───────────────────────────────────────────────────────────

/**
 * Parse the structured stdout from replay-grade-quantum.ts CLI.
 *
 * Expected lines in the "=== Summary ===" section:
 *   Replay rows analyzed      : N
 *   Strategy-folds valid      : N
 *   Spearman rho              : X.XXXX
 *   Spearman p-value          : X.XXXX
 *   Verdict                   : SIGNAL|INCONCLUSIVE|NO SIGNAL|PRELIMINARY
 *
 * Report path line (when --apply is passed):
 *   [APPLY] Report written to: /path/to/docs/replay-results/YYYY-MM-DD-quantum-disagreement.md
 */
export function parseScriptOutput(stdout: string): {
  replayRowsAnalyzed: number | null;
  sampleSize: number | null;
  spearmanRho: number | null;
  spearmanPValue: number | null;
  verdict: WeeklyVerdict | null;
  reportPath: string | null;
} {
  const lines = stdout.split("\n");

  function extractNumeric(label: string): number | null {
    for (const line of lines) {
      if (line.includes(label)) {
        const parts = line.split(":");
        if (parts.length >= 2) {
          const val = parseFloat(parts[parts.length - 1].trim());
          if (!isNaN(val)) return val;
        }
      }
    }
    return null;
  }

  // Parse replay rows
  const replayRowsAnalyzed = extractNumeric("Replay rows analyzed");

  // Parse strategy-folds valid (the sample size used in stats)
  const sampleSize = extractNumeric("Strategy-folds valid");

  // Parse Spearman rho
  const spearmanRho = extractNumeric("Spearman rho");

  // Parse Spearman p-value
  const spearmanPValue = extractNumeric("Spearman p-value");

  // Parse verdict — must handle "NO SIGNAL" which contains a space
  let verdict: WeeklyVerdict | null = null;
  for (const line of lines) {
    if (line.includes("Verdict") && line.includes(":")) {
      const rawVerdict = line.split(":").slice(1).join(":").trim();
      if (
        rawVerdict === "SIGNAL" ||
        rawVerdict === "INCONCLUSIVE" ||
        rawVerdict === "NO SIGNAL" ||
        rawVerdict === "PRELIMINARY"
      ) {
        verdict = rawVerdict as WeeklyVerdict;
        break;
      }
    }
  }

  // Parse report path from [APPLY] line
  let reportPath: string | null = null;
  for (const line of lines) {
    if (line.startsWith("[APPLY] Report written to:")) {
      const pathPart = line.replace("[APPLY] Report written to:", "").trim();
      if (pathPart.length > 0) {
        reportPath = pathPart;
        break;
      }
    }
  }

  return { replayRowsAnalyzed, sampleSize, spearmanRho, spearmanPValue, verdict, reportPath };
}

// ─── Discord template builders ────────────────────────────────────────────────

function _buildDiscordBody(
  verdict: WeeklyVerdict,
  spearmanRho: number | null,
  spearmanPValue: number | null,
  binomialPValue: number | null,
  sampleSize: number | null,
  reportPath: string | null,
): string {
  const rho = spearmanRho !== null ? spearmanRho.toFixed(4) : "N/A";
  const pVal = spearmanPValue !== null ? spearmanPValue.toFixed(4) : "N/A";
  const bPVal = binomialPValue !== null ? binomialPValue.toFixed(4) : "N/A";
  const n = sampleSize !== null ? String(sampleSize) : "N/A";
  const report = reportPath ?? "(not written)";

  switch (verdict) {
    case "SIGNAL":
      return `🟢 [WEEKLY] Quantum Replay Verdict: SIGNAL\nSpearman ρ = ${rho} (p = ${pVal})\nBinomial test p = ${bPVal}\nSample size: ${n} strategy-folds\nReport: ${report}`;
    case "NO SIGNAL":
      return `⚪ [WEEKLY] Quantum Replay Verdict: NO SIGNAL\nSpearman ρ = ${rho} (p = ${pVal})\nSample size: ${n}\nReport: ${report}`;
    case "INCONCLUSIVE":
    case "PRELIMINARY": {
      const disclaimer =
        verdict === "PRELIMINARY"
          ? "(Preliminary — fewer than 50 strategy-folds, keep collecting data)"
          : "(Inconclusive — |ρ| in marginal zone, more data needed)";
      return `🟡 [WEEKLY] Quantum Replay Verdict: ${verdict}\nSpearman ρ = ${rho} (p = ${pVal})\nSample size: ${n}\n${disclaimer}\nReport: ${report}`;
    }
  }
}

function _buildFamilyPostscript(verdict: WeeklyVerdict): {
  plainWhat: string;
  plainAction: string;
} {
  switch (verdict) {
    case "SIGNAL":
      return {
        plainWhat:
          "The bot's experimental quantum check is showing useful signal — it predicts when strategies will underperform out-of-sample.",
        plainAction:
          "No action needed. Tony will review the report and decide whether to wire this into the promotion gate.",
      };
    case "NO SIGNAL":
      return {
        plainWhat:
          "The bot's experimental quantum check is not showing useful signal — disagreement is noise.",
        plainAction:
          "No action needed. The quantum stack stays in challenger-only mode.",
      };
    case "INCONCLUSIVE":
    case "PRELIMINARY":
      return {
        plainWhat:
          "Not enough data yet to know if the quantum check is useful — keep collecting.",
        plainAction: "No action needed.",
      };
  }
}

// ─── Main public function ─────────────────────────────────────────────────────

/**
 * runQuantumReplayWeeklyAnalysis
 *
 * Spawns scripts/replay-grade-quantum.ts --apply, parses the output,
 * sends a Discord verdict via appendFamilyGradePostscript, and writes
 * an audit_log row for every outcome.
 *
 * Returns a WeeklyAnalysisResult describing the outcome.
 */
export async function runQuantumReplayWeeklyAnalysis(): Promise<WeeklyAnalysisResult> {
  const correlationId = randomUUID();
  const t0 = Date.now();

  // ── 1. Kill switch check ──────────────────────────────────────────────────
  const killSwitchEnabled = await _readKillSwitch();
  if (!killSwitchEnabled) {
    logger.info(
      { job: "quantum-replay-weekly-analysis", correlationId },
      "quantum-replay-weekly: kill switch disengaged (auto_patch_loop_enabled=false) — skipping",
    );
    await insertAuditRow({
      action: "quantum_replay.weekly_analysis_loop_halted_skip",
      entityType: "quantum_replay_weekly",
      entityId: null,
      decisionAuthority: "system",
      input: { correlationId } as Record<string, unknown>,
      result: { reason: "kill_switch_disengaged", param: KILL_SWITCH_PARAM } as Record<string, unknown>,
      status: "success",
      correlationId,
    }).catch((err) =>
      logger.warn({ err, correlationId }, "quantum-replay-weekly: audit row write failed (loop_halted_skip)"),
    );
    return {
      status: "loop_halted_skip",
      verdict: null,
      spearmanRho: null,
      spearmanPValue: null,
      binomialPValue: null,
      sampleSize: null,
      durationMs: Date.now() - t0,
      reportPath: null,
      correlationId,
    };
  }

  // ── 2. Spawn replay-grade-quantum.ts --apply ──────────────────────────────
  const TIMEOUT_MS = _getTimeoutMs();

  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;
  let timedOut = false;

  try {
    await new Promise<void>((resolve, reject) => {
      import("child_process").then(({ execFile }) => {
        // npx tsx scripts/replay-grade-quantum.ts --apply
        // On Windows use npx.cmd; on POSIX use npx
        const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";
        const proc = execFile(
          npxBin,
          ["tsx", "scripts/replay-grade-quantum.ts", "--apply"],
          {
            cwd: process.cwd(),
            env: { ...process.env } as NodeJS.ProcessEnv,
            timeout: TIMEOUT_MS,
            maxBuffer: 2 * 1024 * 1024, // 2 MB — report can be large
          },
          (err, out, errOut) => {
            stdout = out ?? "";
            stderr = errOut ?? "";
            if (err) {
              const errWithExtras = err as NodeJS.ErrnoException & {
                killed?: boolean;
                status?: number;
              };
              if (errWithExtras.killed) timedOut = true;
              exitCode =
                errWithExtras.status != null ? errWithExtras.status : -1;
              reject(err);
            } else {
              exitCode = 0;
              resolve();
            }
          },
        );

        // Belt-and-suspenders hard timeout
        setTimeout(() => {
          timedOut = true;
          try {
            proc.kill("SIGTERM");
          } catch {
            /* already dead */
          }
        }, TIMEOUT_MS + 5_000);
      }).catch(reject);
    });

    // ── Exit 0: parse output ────────────────────────────────────────────────
    const parsed = parseScriptOutput(stdout);

    logger.info(
      {
        job: "quantum-replay-weekly-analysis",
        correlationId,
        verdict: parsed.verdict,
        sampleSize: parsed.sampleSize,
        spearmanRho: parsed.spearmanRho,
        spearmanPValue: parsed.spearmanPValue,
        replayRowsAnalyzed: parsed.replayRowsAnalyzed,
      },
      "quantum-replay-weekly: script exited 0",
    );

    // ── Check for zero replay rows ──────────────────────────────────────────
    if (parsed.replayRowsAnalyzed === 0 || parsed.sampleSize === 0) {
      await insertAuditRow({
        action: "quantum_replay.weekly_analysis_skipped_no_data",
        entityType: "quantum_replay_weekly",
        entityId: null,
        decisionAuthority: "system",
        input: { correlationId } as Record<string, unknown>,
        result: {
          replayRowsAnalyzed: parsed.replayRowsAnalyzed,
          sampleSize: parsed.sampleSize,
        } as Record<string, unknown>,
        status: "success",
        correlationId,
      }).catch((err) =>
        logger.warn({ err, correlationId }, "quantum-replay-weekly: audit row write failed (skipped_no_data)"),
      );
      return {
        status: "skipped_no_data",
        verdict: null,
        spearmanRho: parsed.spearmanRho,
        spearmanPValue: parsed.spearmanPValue,
        binomialPValue: null,
        sampleSize: parsed.sampleSize,
        durationMs: Date.now() - t0,
        reportPath: parsed.reportPath,
        correlationId,
      };
    }

    // ── Emit Discord verdict ────────────────────────────────────────────────
    const resolvedVerdict: WeeklyVerdict = parsed.verdict ?? "PRELIMINARY";

    const operatorBody = _buildDiscordBody(
      resolvedVerdict,
      parsed.spearmanRho,
      parsed.spearmanPValue,
      null, // binomialPValue not yet parsed from stdout; use null for now
      parsed.sampleSize,
      parsed.reportPath,
    );

    const { plainWhat, plainAction } = _buildFamilyPostscript(resolvedVerdict);
    const fullBody = appendFamilyGradePostscript(operatorBody, plainWhat, plainAction);

    notifyInfo(
      `[WEEKLY] Quantum Replay Verdict: ${resolvedVerdict}`,
      fullBody,
      {
        job: "quantum-replay-weekly-analysis",
        verdict: resolvedVerdict,
        sampleSize: parsed.sampleSize,
        correlationId,
      },
    );

    await insertAuditRow({
      action: "quantum_replay.weekly_verdict_emitted",
      entityType: "quantum_replay_weekly",
      entityId: null,
      decisionAuthority: "system",
      input: { correlationId } as Record<string, unknown>,
      result: {
        verdict: resolvedVerdict,
        spearman_rho: parsed.spearmanRho,
        spearman_p_value: parsed.spearmanPValue,
        sample_size: parsed.sampleSize,
        replay_rows_analyzed: parsed.replayRowsAnalyzed,
        report_path: parsed.reportPath,
        duration_ms: Date.now() - t0,
      } as Record<string, unknown>,
      status: "success",
      correlationId,
    }).catch((err) =>
      logger.warn({ err, correlationId }, "quantum-replay-weekly: audit row write failed (verdict_emitted)"),
    );

    return {
      status: "success",
      verdict: resolvedVerdict,
      spearmanRho: parsed.spearmanRho,
      spearmanPValue: parsed.spearmanPValue,
      binomialPValue: null,
      sampleSize: parsed.sampleSize,
      durationMs: Date.now() - t0,
      reportPath: parsed.reportPath,
      correlationId,
    };
  } catch (spawnErr) {
    const durationMs = Date.now() - t0;
    const stderrSummary = stderr.slice(-500);
    const errorMsg =
      spawnErr instanceof Error ? spawnErr.message : String(spawnErr);

    if (timedOut) {
      // ── Timeout path ──────────────────────────────────────────────────────
      logger.error(
        {
          job: "quantum-replay-weekly-analysis",
          correlationId,
          timeoutMs: TIMEOUT_MS,
          durationMs,
        },
        "quantum-replay-weekly: analysis script TIMED OUT",
      );

      await insertAuditRow({
        action: "quantum_replay.weekly_analysis_timeout",
        entityType: "quantum_replay_weekly",
        entityId: null,
        decisionAuthority: "system",
        input: { correlationId, timeoutMs: TIMEOUT_MS } as Record<string, unknown>,
        result: {
          timeout_ms: TIMEOUT_MS,
          duration_ms: durationMs,
          stderr_summary: stderrSummary,
        } as Record<string, unknown>,
        status: "failed",
        correlationId,
      }).catch((err) =>
        logger.warn({ err, correlationId }, "quantum-replay-weekly: audit row write failed (timeout)"),
      );

      const operatorBody = `🔴 [WEEKLY] Quantum Replay Analysis FAILED\nError: Script timed out after ${Math.round(TIMEOUT_MS / 60_000)} minutes\nCorrelation ID: ${correlationId}`;
      const fullBody = appendFamilyGradePostscript(
        operatorBody,
        "The weekly experimental check did not run. The bot is still trading normally.",
        "No action needed unless this repeats 3 weeks in a row.",
      );

      notifyWarning(
        "[WEEKLY] Quantum Replay Analysis TIMED OUT",
        fullBody,
        { correlationId, timeoutMs: TIMEOUT_MS },
      );

      return {
        status: "timeout",
        verdict: null,
        spearmanRho: null,
        spearmanPValue: null,
        binomialPValue: null,
        sampleSize: null,
        durationMs,
        reportPath: null,
        correlationId,
        errorMsg: `Script timed out after ${TIMEOUT_MS}ms`,
      };
    } else {
      // ── Script error path ─────────────────────────────────────────────────
      logger.error(
        {
          job: "quantum-replay-weekly-analysis",
          correlationId,
          exitCode,
          durationMs,
          stderrSummary,
        },
        "quantum-replay-weekly: analysis script exited non-zero or threw",
      );

      await insertAuditRow({
        action: "quantum_replay.weekly_analysis_failed",
        entityType: "quantum_replay_weekly",
        entityId: null,
        decisionAuthority: "system",
        input: { correlationId, exitCode } as Record<string, unknown>,
        result: {
          error: errorMsg,
          exit_code: exitCode,
          duration_ms: durationMs,
          stderr_summary: stderrSummary,
        } as Record<string, unknown>,
        status: "failed",
        correlationId,
      }).catch((err) =>
        logger.warn({ err, correlationId }, "quantum-replay-weekly: audit row write failed (failed)"),
      );

      const operatorBody =
        `🔴 [WEEKLY] Quantum Replay Analysis FAILED\nError: ${errorMsg.slice(0, 300)}\nCorrelation ID: ${correlationId}`;
      const fullBody = appendFamilyGradePostscript(
        operatorBody,
        "The weekly experimental check did not run. The bot is still trading normally.",
        "No action needed unless this repeats 3 weeks in a row.",
      );

      notifyWarning(
        "[WEEKLY] Quantum Replay Analysis FAILED",
        fullBody,
        { correlationId, errorMsg, exitCode },
      );

      return {
        status: "failed",
        verdict: null,
        spearmanRho: null,
        spearmanPValue: null,
        binomialPValue: null,
        sampleSize: null,
        durationMs,
        reportPath: null,
        correlationId,
        errorMsg,
      };
    }
  }
}
