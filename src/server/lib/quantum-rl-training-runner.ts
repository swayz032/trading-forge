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

import { spawn, execSync, type ChildProcess } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { resolve as pathResolve, join as pathJoin } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { systemParameters, auditLog } from "../db/schema.js";
import { logger } from "./logger.js";
import { notifyCritical } from "../services/notification-service.js";
import { appendFamilyGradePostscript } from "./notification-helpers.js";
// FIX 7 (deepscan8): register spawned process with graceful-shutdown set
import { registerExternalPythonSubprocess } from "./python-runner.js";

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");

// FIX 2 (deepscan8): per-pid Numba JIT-cache dir — avoids multi-worker collisions
const _NUMBA_CACHE_DIR = pathJoin(tmpdir(), `tf-numba-cache-${process.pid}`);
try { mkdirSync(_NUMBA_CACHE_DIR, { recursive: true }); } catch { /* ignore — Numba falls back */ }

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

// ── Circuit breaker (persisted — mirrors quantum-replay-runner.ts Fix 10) ────
//
// Prior to this fix, breaker state was in module-level closure variables that
// reset to zero on every process restart. A crash-looping RL training job could
// open the breaker, restart the process, and immediately fire again (audit gap).
//
// Fix: breaker state is persisted to system_parameters using two rows:
//   quantum_rl_circuit_open            — "1" when open, "0" when closed
//   quantum_rl_consecutive_failures    — integer failure count
//
// On module init (first call to runRlTrainingForStrategy) the in-memory state
// is loaded from DB. On open/close, the DB rows are updated fire-and-forget
// (non-blocking). On DB failure the in-memory state is still mutated so the
// current process behaves correctly even if persist fails.
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
let _rlBreakerStateLoaded = false; // true once DB init has been attempted

const _RL_PARAM_OPEN = "quantum_rl_circuit_open";
const _RL_PARAM_FAILURES = "quantum_rl_consecutive_failures";

/** Persist circuit breaker state to system_parameters (fire-and-forget, never throws). */
async function _persistRlBreakerState(): Promise<void> {
  try {
    const pairs: Array<[string, string]> = [
      [_RL_PARAM_OPEN, _circuitOpen ? "1" : "0"],
      [_RL_PARAM_FAILURES, String(_consecutiveFailures)],
    ];
    for (const [paramName, val] of pairs) {
      const [row] = await db
        .select({ id: systemParameters.id })
        .from(systemParameters)
        .where(eq(systemParameters.paramName, paramName));
      if (row) {
        await db
          .update(systemParameters)
          .set({ currentValue: val, updatedAt: new Date() })
          .where(eq(systemParameters.paramName, paramName));
      } else {
        await db.insert(systemParameters).values({
          paramName,
          currentValue: val,
          domain: "scheduler",
          description:
            paramName === _RL_PARAM_OPEN
              ? "quantum-rl-training-runner circuit breaker open flag. 0=closed 1=open."
              : "quantum-rl-training-runner consecutive failure count. Resets to 0 on success.",
        });
      }
    }
  } catch (persistErr) {
    logger.warn(
      { err: String(persistErr) },
      "quantum-rl-training-runner: circuit breaker DB persist failed (non-blocking)",
    );
  }
}

/**
 * Load circuit breaker state from system_parameters on first call.
 * Fire-and-forget (never throws). Populates _consecutiveFailures and _circuitOpen.
 * Subsequent calls are no-ops.
 */
async function _initRlBreakerStateFromDb(): Promise<void> {
  if (_rlBreakerStateLoaded) return;
  _rlBreakerStateLoaded = true;
  try {
    const rows = await db
      .select({ paramName: systemParameters.paramName, currentValue: systemParameters.currentValue })
      .from(systemParameters)
      .where(eq(systemParameters.domain, "scheduler"));

    for (const row of rows) {
      if (row.paramName === _RL_PARAM_OPEN) {
        _circuitOpen = row.currentValue === "1";
      }
      if (row.paramName === _RL_PARAM_FAILURES) {
        const n = parseInt(String(row.currentValue), 10);
        _consecutiveFailures = Number.isFinite(n) ? n : 0;
      }
    }

    if (_circuitOpen) {
      logger.warn(
        { consecutiveFailures: _consecutiveFailures, threshold: _failureThreshold },
        "quantum-rl-training-runner: circuit breaker was OPEN from prior session — auto-fire will be skipped until cooldown expires",
      );
    }
  } catch (initErr) {
    logger.warn(
      { err: String(initErr) },
      "quantum-rl-training-runner: circuit breaker DB init failed — starting with safe defaults (non-blocking)",
    );
  }
}

/**
 * Check if the circuit is currently open.
 * Returns { isOpen, justReset } — justReset=true when the cooldown expired this call.
 * Callers that see justReset=true should emit a `quantum_rl.training_circuit_breaker_closed`
 * audit row so recovery is visible in audit_log.
 */
function _isCircuitOpen(): { isOpen: boolean; justReset: boolean } {
  if (!_circuitOpen) return { isOpen: false, justReset: false };
  // Auto-reset after cooldown
  if (_circuitOpenedAt !== null && Date.now() - _circuitOpenedAt >= _circuitBreakerCooldownMs) {
    _consecutiveFailures = 0;
    _circuitOpen = false;
    _circuitOpenedAt = null;
    logger.info(
      { cooldownMs: _circuitBreakerCooldownMs },
      "quantum-rl-training-runner: circuit breaker RESET after cooldown — resuming auto-fire",
    );
    _persistRlBreakerState().catch(() => { /* already logged inside */ });
    return { isOpen: false, justReset: true };
  }
  return { isOpen: true, justReset: false };
}

function _recordRlSuccess(): void {
  _consecutiveFailures = 0;
  _circuitOpen = false;
  _circuitOpenedAt = null;
  _persistRlBreakerState().catch(() => { /* already logged inside */ });
}

/**
 * Record a failure. Returns true when the circuit was NEWLY opened by this failure.
 * Caller should emit `quantum_rl.training_circuit_breaker_opened` audit + Discord on true.
 */
function _recordRlFailure(lastError?: string): boolean {
  _consecutiveFailures++;
  if (!_circuitOpen && _consecutiveFailures >= _failureThreshold) {
    _circuitOpen = true;
    _circuitOpenedAt = Date.now();
    logger.error(
      { consecutiveFailures: _consecutiveFailures, threshold: _failureThreshold, cooldownMs: _circuitBreakerCooldownMs },
      "quantum-rl-training-runner: circuit breaker OPENED",
    );
    // Discord escalation when circuit opens — operator on vacation won't know RL training stopped.
    // Mirrors quantum-replay-runner.ts notifyCritical pattern.
    try {
      notifyCritical(
        "Quantum-RL Training Circuit Breaker OPEN",
        appendFamilyGradePostscript(
          `Quantum-RL training circuit breaker OPEN after ${_consecutiveFailures} consecutive failures; auto-fire halted for ${Math.round(_circuitBreakerCooldownMs / 60_000)} min cooldown. Last error: ${lastError ?? "unknown"}`,
          "The quantum RL training background job stopped after repeated failures.",
          "No action needed — the bot will keep trading normally. Call Tony if this persists more than 2 hours.",
        ),
        { consecutiveFailures: _consecutiveFailures, threshold: _failureThreshold },
      );
    } catch (_discordErr) { /* non-blocking */ }
    _persistRlBreakerState().catch(() => { /* already logged inside */ });
    return true; // newly opened
  }
  _persistRlBreakerState().catch(() => { /* already logged inside */ });
  return false;
}

/** Reset circuit state — exposed for tests only. Also persists the reset. */
export function _resetRlCircuitBreakerForTests(): void {
  _consecutiveFailures = 0;
  _circuitOpen = false;
  _circuitOpenedAt = null;
  _rlBreakerStateLoaded = false; // allow re-init from DB in integration tests
  _persistRlBreakerState().catch(() => { /* already logged inside */ });
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
    // FIX 8 (deepscan8): operator-overridable user-site path
    PYTHONPATH: [
      process.env.TF_PYTHON_USER_SITE ?? "C:\\Users\\tonio\\AppData\\Roaming\\Python\\Python313\\site-packages",
      "C:\\Program Files\\Python313\\Lib\\site-packages",
      process.env.PYTHONPATH ?? "",
    ].filter(Boolean).join(";"),
    // FIX 1 (deepscan8): trigger enable_determinism() inside Python at startup
    DETERMINISM_MODE: "true",
    // FIX 2 (deepscan8): per-pid Numba JIT-cache dir
    NUMBA_CACHE_DIR: _NUMBA_CACHE_DIR,
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
  // ── Load persisted breaker state on first call (DB-durability fix) ──────
  await _initRlBreakerStateFromDb();

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
  const { isOpen, justReset } = _isCircuitOpen();

  // Emit recovery audit when the 1h cooldown just expired — makes recovery visible.
  if (justReset) {
    db.insert(auditLog).values({
      action: "quantum_rl.training_circuit_breaker_closed",
      entityType: "strategy",
      entityId: String(strategyId),
      status: "success",
      correlationId: correlationId ?? null,
      result: { reason: "cooldown_expired", cooldown_ms: _circuitBreakerCooldownMs },
    }).catch((auditErr) =>
      logger.warn(
        { err: String(auditErr), strategyId },
        "quantum-rl-training-runner: circuit_breaker_closed audit row failed (non-blocking)",
      ),
    );
  }

  if (isOpen) {
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
      // FIX 7 (deepscan8): register with graceful-shutdown process set
      registerExternalPythonSubprocess(proc);
    } catch (spawnErr) {
      _recordRlFailure(String(spawnErr));
      reject(spawnErr);
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Fix 7: Windows SIGTERM does not propagate to grandchildren (Python subprocesses).
      // Use taskkill /F /T to tree-kill on win32; SIGTERM on other platforms.
      const pid = proc.pid;
      if (process.platform === "win32" && pid != null) {
        try {
          execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
        } catch (taskkillErr) {
          logger.warn(
            { pid, strategyId, err: String(taskkillErr) },
            "quantum-rl-training-runner: taskkill /F /T failed — process may linger",
          );
        }
      } else {
        try { proc.kill("SIGTERM"); } catch { /* already dead */ }
        setTimeout(() => {
          try { proc.kill("SIGKILL"); } catch { /* already dead */ }
        }, 2000);
      }
      _recordRlFailure(`timed out after ${timeoutMs}ms`);
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
        _recordRlFailure(`exit ${code}: ${errMsg.slice(0, 200)}`);
        reject(new Error(`quantum_rl_agent train failed (exit ${code}) for strategyId=${strategyId}: ${errMsg.slice(0, 200)}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      logger.error({ strategyId, correlationId, err }, "quantum-rl-training-runner: spawn error");
      _recordRlFailure(String(err));
      reject(err);
    });
  });
}
