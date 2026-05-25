/**
 * quantum-replay-runner.ts — Fire-and-forget quantum replay invocation helper.
 *
 * Spawns `python -m src.engine.replay.quantum_replay --backtest-id <uuid> --apply --seed 42`
 * as a child process with a configurable timeout. Used by backtest-service.ts
 * post-completion auto-fire hook (Wave 27 Pass 1.5).
 *
 * Design notes:
 *   - Uses child_process directly (not runPythonModule) because quantum_replay.py
 *     emits human-readable text to stdout, not JSON. runPythonModule requires JSON.
 *   - Respects the python-runner.ts global semaphore indirectly: this subprocess
 *     runs outside the semaphore but defaults OFF under QUANTUM_REPLAY_AUTO_FIRE_ENABLED.
 *     Process-level circuit breaker (QUANTUM_REPLAY_FAILURE_THRESHOLD, default 5)
 *     prevents thundering-herd on repeated failures.
 *   - Opt-OUT default (QUANTUM_REPLAY_AUTO_FIRE_ENABLED unset or "true" → enabled)
 *     per operator's autonomous-agents-drive-everything mandate.
 *   - 5-minute timeout (env QUANTUM_REPLAY_TIMEOUT_MS, default 300000).
 *
 * Parity note:
 *   Challenger-only governance applies — quantum replay rows carry
 *   governance_labels.replay_mode=true and are advisory-only (never block promotion).
 *   This hook does NOT change that governance; it only makes the computation
 *   automatic so operators don't need to trigger it manually after each backtest.
 */

import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { resolve as pathResolve } from "path";
import { logger } from "./logger.js";

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");

// ── Platform-correct Python interpreter path (mirrors python-runner.ts) ────────
const SYSTEM_PYTHON_WIN = "C:\\Program Files\\Python313\\python.exe";
function getPythonCmd(): string {
  if (process.platform === "win32") {
    return existsSync(SYSTEM_PYTHON_WIN) ? SYSTEM_PYTHON_WIN : "python";
  }
  return "python3";
}

// ── Process-level circuit breaker (in-memory, resets on restart) ──────────────
const _threshold = Math.max(
  1,
  parseInt(process.env.QUANTUM_REPLAY_FAILURE_THRESHOLD ?? "5", 10) || 5,
);
let _consecutiveFailures = 0;
let _circuitOpen = false;

function _recordSuccess(): void {
  _consecutiveFailures = 0;
  _circuitOpen = false;
}

function _recordFailure(): boolean {
  _consecutiveFailures++;
  if (!_circuitOpen && _consecutiveFailures >= _threshold) {
    _circuitOpen = true;
    logger.error(
      { consecutiveFailures: _consecutiveFailures, threshold: _threshold },
      "quantum-replay-runner: circuit breaker OPENED — auto-fire disabled for this process lifetime",
    );
    return true; // newly opened
  }
  return false;
}

/** Reset circuit state — exposed for tests only. */
export function _resetCircuitBreakerForTests(): void {
  _consecutiveFailures = 0;
  _circuitOpen = false;
}

/** Read current consecutive failure count — exposed for tests only. */
export function _getConsecutiveFailuresForTests(): number {
  return _consecutiveFailures;
}

// ── Environment gates ──────────────────────────────────────────────────────────

/**
 * Returns true when QUANTUM_REPLAY_AUTO_FIRE_ENABLED is unset or "true".
 * Operator must explicitly set "false" to opt out — per autonomous-agents mandate.
 */
export function isQuantumReplayEnabled(): boolean {
  const val = process.env.QUANTUM_REPLAY_AUTO_FIRE_ENABLED;
  if (val === undefined || val === null) return true;
  return val.trim().toLowerCase() !== "false";
}

function getTimeoutMs(): number {
  const raw = process.env.QUANTUM_REPLAY_TIMEOUT_MS;
  if (!raw) return 300_000; // 5 minutes default
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
}

// ── Output type ────────────────────────────────────────────────────────────────

export interface QuantumReplayResult {
  status: "completed" | "failed" | "circuit_open";
  /** Rows written to quantum_mc_runs (parsed from stdout summary). */
  rowsWritten: number;
  durationMs: number;
  /** Raw stdout snippet for audit logging. */
  stdoutSnippet: string;
}

// ── Summary parser ─────────────────────────────────────────────────────────────

/**
 * Parse the human-readable summary printed by quantum_replay.py CLI.
 * Line format:
 *   "  Completed:    N"
 *
 * Returns rows written (completed count) or 0 on parse failure.
 */
function _parseRowsWritten(stdout: string): number {
  const match = /Completed:\s+(\d+)/i.exec(stdout);
  if (match && match[1]) {
    const n = parseInt(match[1], 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// ── Python env (mirrors python-runner.ts deterministic env) ───────────────────

function _buildPythonEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    MKL_CBWR: "COMPATIBLE",
    OPENBLAS_NUM_THREADS: "1",
    BLIS_NUM_THREADS: "1",
    OMP_NUM_THREADS: "1",
    TF_STRESS_TEST_MODE: process.env.TF_STRESS_TEST_MODE ?? "pipeline",
    WF_PARALLEL: process.env.WF_PARALLEL ?? "1",
    PYTHONUSERSITE: "1",
    PYTHONPATH: [
      "C:\\Users\\tonio\\AppData\\Roaming\\Python\\Python313\\site-packages",
      "C:\\Program Files\\Python313\\Lib\\site-packages",
      process.env.PYTHONPATH ?? "",
    ].filter(Boolean).join(";"),
  };
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Spawn `python -m src.engine.replay.quantum_replay --backtest-id <uuid> --apply --seed 42`.
 *
 * Returns a summary object for audit logging. Never throws — caller must handle
 * rejection (fire-and-forget pattern in backtest-service.ts).
 *
 * Circuit breaker: after QUANTUM_REPLAY_FAILURE_THRESHOLD consecutive failures,
 * all subsequent calls reject immediately with a "circuit_open" status and the
 * outer auto-fire hook logs a critical + disables for the process lifetime.
 * Resets on process restart (in-memory only — acceptable per spec).
 */
export async function runQuantumReplayForBacktest(
  backtestId: string,
  correlationId?: string,
): Promise<QuantumReplayResult> {
  // ── Circuit breaker check ───────────────────────────────────────────────────
  if (_circuitOpen) {
    logger.warn(
      { backtestId, correlationId, consecutiveFailures: _consecutiveFailures },
      "quantum-replay-runner: circuit open — skipping auto-fire",
    );
    return { status: "circuit_open", rowsWritten: 0, durationMs: 0, stdoutSnippet: "" };
  }

  const timeoutMs = getTimeoutMs();
  const pythonCmd = getPythonCmd();

  const args = [
    "-m",
    "src.engine.replay.quantum_replay",
    "--backtest-id",
    backtestId,
    "--apply",
    "--seed",
    "42",
  ];

  logger.info(
    { backtestId, correlationId, timeoutMs, module: "src.engine.replay.quantum_replay" },
    "quantum-replay-runner: spawning quantum replay subprocess",
  );

  const start = Date.now();

  return new Promise<QuantumReplayResult>((resolve, reject) => {
    let proc: ChildProcess;
    try {
      proc = spawn(pythonCmd, args, {
        env: _buildPythonEnv(),
        cwd: PROJECT_ROOT,
      });
    } catch (spawnErr) {
      _recordFailure();
      reject(spawnErr);
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill("SIGTERM"); } catch { /* already dead */ }
      setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch { /* already dead */ }
      }, 2000);
      _recordFailure();
      reject(new Error(`quantum-replay-runner timed out after ${timeoutMs}ms for backtestId=${backtestId}`));
    }, timeoutMs);

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) {
          logger.warn(
            { component: "quantum-replay-runner", backtestId, correlationId },
            trimmed,
          );
        }
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;

      const durationMs = Date.now() - start;
      const stdoutSnippet = stdout.slice(-500); // last 500 chars for audit

      if (code === 0) {
        const rowsWritten = _parseRowsWritten(stdout);
        _recordSuccess();
        logger.info(
          { backtestId, correlationId, durationMs, rowsWritten },
          "quantum-replay-runner: subprocess completed successfully",
        );
        resolve({ status: "completed", rowsWritten, durationMs, stdoutSnippet });
      } else {
        const errMsg = stderr.trim() || `exit code ${code}`;
        logger.error(
          { backtestId, correlationId, code, durationMs, errMsg: errMsg.slice(0, 300) },
          "quantum-replay-runner: subprocess exited with non-zero code",
        );
        _recordFailure();
        reject(new Error(`quantum_replay failed (exit ${code}) for backtestId=${backtestId}: ${errMsg.slice(0, 200)}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      logger.error(
        { backtestId, correlationId, err },
        "quantum-replay-runner: subprocess spawn error",
      );
      _recordFailure();
      reject(err);
    });
  });
}
