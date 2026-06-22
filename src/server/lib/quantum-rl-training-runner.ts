/**
 * quantum-rl-training-runner.ts — Wave 29 Pass C.2
 *
 * Fire-and-forget RL training invocation helper.
 * Spawns `python -m src.engine.quantum_rl_agent --mode train --strategy-id <id>`
 * as a child process from backtest-service.ts when a strategy has
 * `entry_quality.train_rl_policy: true`.
 *
 * Mirrors quantum-replay-runner.ts (Wave 27 Pass 1.5) pattern exactly.
 *
 * Design notes:
 *   - ET-hour cron guard: training ONLY fires at off-RTH windows
 *     {6, 7, 8, 16, 17} per Topstep April 2026 unattended-automation rule.
 *   - VRAM ceiling: serializes with MAX_CONCURRENT_BACKTESTS=1 during training.
 *   - Circuit breaker: 5 consecutive failures → opens for 1h (env-configurable).
 *   - Governance: RL training is challenger-only; rows carry RL_RUNS_GOVERNANCE
 *     (training_mode=true). This hook NEVER changes challenger governance.
 *
 * New audit actions:
 *   - quantum_rl.training_auto_fire_enqueued
 *   - quantum_rl.training_auto_fire_failed
 *   - quantum_rl.training_circuit_breaker_opened
 *
 * New env vars:
 *   - QUANTUM_RL_TRAINING_FAILURE_THRESHOLD  (default 5)
 *   - QUANTUM_RL_TRAINING_TIMEOUT_MS         (default 600000 = 10 min)
 *   - QUANTUM_RL_CIRCUIT_BREAKER_COOLDOWN_MS (default 3600000 = 1 hour)
 */

import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { resolve as pathResolve } from "path";
import { createHash } from "crypto";
import { logger } from "./logger.js";

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");

// ── Platform-correct Python interpreter (mirrors quantum-replay-runner.ts) ──
const SYSTEM_PYTHON_WIN = "C:\\Program Files\\Python313\\python.exe";
function getPythonCmd(): string {
  if (process.platform === "win32") {
    return existsSync(SYSTEM_PYTHON_WIN) ? SYSTEM_PYTHON_WIN : "python";
  }
  return "python3";
}

// ── Off-RTH ET-hour guard ─────────────────────────────────────────────────────
// Topstep April 2026 unattended-automation rule: training ONLY during off-RTH.
// Allowed ET hours: 6, 7, 8 (pre-market) and 16, 17 (post-market).
const _OFF_RTH_ET_HOURS = new Set<number>([6, 7, 8, 16, 17]);

/**
 * Returns the current ET hour using Intl.DateTimeFormat (DST-correct).
 * Returns the numeric hour [0-23] in US/Eastern time.
 */
function _getCurrentEtHour(): number {
  const etStr = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  });
  // Intl returns "24" for midnight in some environments — normalize to 0
  const hour = parseInt(etStr, 10);
  return isNaN(hour) ? -1 : hour % 24;
}

export function isOffRthTrainingWindow(): boolean {
  return _OFF_RTH_ET_HOURS.has(_getCurrentEtHour());
}

// ── Circuit breaker ───────────────────────────────────────────────────────────
const _failureThreshold = Math.max(
  1,
  parseInt(process.env.QUANTUM_RL_TRAINING_FAILURE_THRESHOLD ?? "5", 10) || 5,
);
const _circuitBreakerCooldownMs = Math.max(
  60_000,
  parseInt(process.env.QUANTUM_RL_CIRCUIT_BREAKER_COOLDOWN_MS ?? "3600000", 10) || 3_600_000,
);

let _consecutiveFailures = 0;
let _circuitOpen = false;
let _circuitOpenedAt: number | null = null;

function _isCircuitOpen(): boolean {
  if (!_circuitOpen) return false;
  // Auto-reset after cooldown
  if (_circuitOpenedAt !== null && Date.now() - _circuitOpenedAt >= _circuitBreakerCooldownMs) {
    _consecutiveFailures = 0;
    _circuitOpen = false;
    _circuitOpenedAt = null;
    logger.info(
      { cooldownMs: _circuitBreakerCooldownMs },
      "quantum-rl-training-runner: circuit breaker RESET after cooldown",
    );
    return false;
  }
  return true;
}

function _recordRlSuccess(): void {
  _consecutiveFailures = 0;
  _circuitOpen = false;
  _circuitOpenedAt = null;
}

/** Returns true when the circuit was newly opened by this failure. */
function _recordRlFailure(): boolean {
  _consecutiveFailures++;
  if (!_circuitOpen && _consecutiveFailures >= _failureThreshold) {
    _circuitOpen = true;
    _circuitOpenedAt = Date.now();
    logger.error(
      { consecutiveFailures: _consecutiveFailures, threshold: _failureThreshold, cooldownMs: _circuitBreakerCooldownMs },
      "quantum-rl-training-runner: circuit breaker OPENED",
    );
    return true;
  }
  return false;
}

/** Reset circuit state — exposed for tests only. */
export function _resetRlCircuitBreakerForTests(): void {
  _consecutiveFailures = 0;
  _circuitOpen = false;
  _circuitOpenedAt = null;
}

/** Expose consecutive failure count for tests. */
export function _getRlConsecutiveFailuresForTests(): number {
  return _consecutiveFailures;
}

// ── Deterministic per-strategy seed ──────────────────────────────────────────
/**
 * Derive a stable 32-bit unsigned integer seed from the strategy ID string.
 * SHA-256(strategyId).readUInt32BE(0) — deterministic per strategy, so two
 * RL training runs on the same strategy produce reproducible results.
 *
 * This ensures the Wave 27 replay-grading harness can compare runs across
 * sessions without silent non-determinism masking real policy drift.
 */
export function deriveRlTrainingSeed(strategyId: number | string): number {
  const buf = createHash("sha256").update(String(strategyId)).digest();
  return buf.readUInt32BE(0);
}

// ── Environment ───────────────────────────────────────────────────────────────

function getTrainingTimeoutMs(): number {
  const raw = process.env.QUANTUM_RL_TRAINING_TIMEOUT_MS;
  if (!raw) return 600_000; // 10 min default
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 600_000;
}

function _buildTrainingEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    MKL_CBWR: "COMPATIBLE",
    OPENBLAS_NUM_THREADS: "1",
    BLIS_NUM_THREADS: "1",
    OMP_NUM_THREADS: "1",
    // Serialize with VRAM ceiling (RTX 5060 8GB) — training runs alone
    MAX_CONCURRENT_BACKTESTS: "1",
    PYTHONUSERSITE: "1",
    PYTHONPATH: [
      "C:\\Users\\tonio\\AppData\\Roaming\\Python\\Python313\\site-packages",
      "C:\\Program Files\\Python313\\Lib\\site-packages",
      process.env.PYTHONPATH ?? "",
    ].filter(Boolean).join(";"),
  };
}

// ── Output type ───────────────────────────────────────────────────────────────

export interface RlTrainingAutoFireResult {
  status: "completed" | "failed" | "circuit_open" | "skipped_rth";
  regimesTrained: number;
  durationMs: number;
  stdoutSnippet: string;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Spawn the RL regime-conditioned training loop for a strategy.
 *
 * Guards:
 *   1. ET-hour cron window (off-RTH: 6-8, 16-17) — rejects during RTH with audit
 *   2. Process-level circuit breaker (5 failures → 1h cooldown)
 *
 * Returns a summary for audit logging. Never throws.
 */
export async function runRlTrainingForStrategy(
  strategyId: number | string,
  trainingEpochs: number = 200,
  correlationId?: string,
): Promise<RlTrainingAutoFireResult> {
  // ── ET-hour guard ────────────────────────────────────────────────────────
  const etHour = _getCurrentEtHour();
  if (!_OFF_RTH_ET_HOURS.has(etHour)) {
    logger.info(
      { strategyId, etHour, correlationId },
      "quantum-rl-training-runner: ET hour is within RTH — skipping training",
    );
    return {
      status: "skipped_rth",
      regimesTrained: 0,
      durationMs: 0,
      stdoutSnippet: `skipped: ET hour ${etHour} is in RTH window`,
    };
  }

  // ── Circuit breaker check ────────────────────────────────────────────────
  if (_isCircuitOpen()) {
    logger.warn(
      { strategyId, correlationId, consecutiveFailures: _consecutiveFailures },
      "quantum-rl-training-runner: circuit open — skipping auto-fire",
    );
    return { status: "circuit_open", regimesTrained: 0, durationMs: 0, stdoutSnippet: "" };
  }

  const timeoutMs = getTrainingTimeoutMs();
  const pythonCmd = getPythonCmd();

  // Derive deterministic per-strategy seed so two training runs on the same
  // strategy produce reproducible results (Wave 29 Pass 1 hardening Fix 4).
  const rlSeed = deriveRlTrainingSeed(strategyId);

  const args = [
    "-m",
    "src.engine.quantum_rl_agent",
    "--mode",
    "train",
    "--strategy-id",
    String(strategyId),
    "--training-epochs",
    String(trainingEpochs),
    "--seed",
    String(rlSeed),
  ];

  logger.info(
    { strategyId, correlationId, timeoutMs, trainingEpochs, etHour, rlSeed },
    "quantum-rl-training-runner: spawning RL training subprocess",
  );

  const start = Date.now();

  return new Promise<RlTrainingAutoFireResult>((resolve, reject) => {
    let proc: ChildProcess;
    try {
      proc = spawn(pythonCmd, args, {
        env: _buildTrainingEnv(),
        cwd: PROJECT_ROOT,
      });
    } catch (spawnErr) {
      _recordRlFailure();
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
      _recordRlFailure();
      reject(new Error(`quantum-rl-training-runner timed out after ${timeoutMs}ms for strategyId=${strategyId}`));
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
          logger.warn({ component: "quantum-rl-training-runner", strategyId, correlationId }, trimmed);
        }
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;

      const durationMs = Date.now() - start;
      const stdoutSnippet = stdout.slice(-500);

      if (code === 0) {
        // Parse regimes trained from JSON output
        let regimesTrained = 0;
        try {
          const parsed = JSON.parse(stdout.trim());
          if (parsed?.results && typeof parsed.results === "object") {
            regimesTrained = Object.keys(parsed.results).length;
          }
        } catch { /* non-JSON stdout — regimes unknown */ }

        _recordRlSuccess();
        logger.info(
          { strategyId, correlationId, durationMs, regimesTrained },
          "quantum-rl-training-runner: subprocess completed successfully",
        );
        resolve({ status: "completed", regimesTrained, durationMs, stdoutSnippet });
      } else {
        const errMsg = stderr.trim() || `exit code ${code}`;
        logger.error(
          { strategyId, correlationId, code, durationMs, errMsg: errMsg.slice(0, 300) },
          "quantum-rl-training-runner: subprocess exited with non-zero code",
        );
        _recordRlFailure();
        reject(new Error(`quantum_rl_agent train failed (exit ${code}) for strategyId=${strategyId}: ${errMsg.slice(0, 200)}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      logger.error({ strategyId, correlationId, err }, "quantum-rl-training-runner: spawn error");
      _recordRlFailure();
      reject(err);
    });
  });
}
