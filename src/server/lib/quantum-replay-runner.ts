/**
 * quantum-replay-runner.ts — Fire-and-forget quantum replay invocation helper.
 *
 * Spawns `python -m src.engine.replay.quantum_replay --backtest-id <uuid> --apply --seed <N>`
 * as a child process with a configurable timeout. Used by backtest-service.ts
 * post-completion auto-fire hook (Wave 27 Pass 1.5).
 * Fix 9: seed is derived per-backtestId via SHA-256 (not hardcoded "42").
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
 *   - Circuit breaker state persisted to system_parameters (Fix 10, Wave A) so
 *     breaker state survives process restarts; params:
 *       quantum_replay_circuit_open (0/1)
 *       quantum_replay_consecutive_failures (integer count)
 *
 * Parity note:
 *   Challenger-only governance applies — quantum replay rows carry
 *   governance_labels.replay_mode=true and are advisory-only (never block promotion).
 *   This hook does NOT change that governance; it only makes the computation
 *   automatic so operators don't need to trigger it manually after each backtest.
 */

import { spawn, type ChildProcess } from "child_process";
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

// ── Platform-correct Python interpreter path (mirrors python-runner.ts) ────────
const SYSTEM_PYTHON_WIN = "C:\\Program Files\\Python313\\python.exe";
function getPythonCmd(): string {
  if (process.platform === "win32") {
    return existsSync(SYSTEM_PYTHON_WIN) ? SYSTEM_PYTHON_WIN : "python";
  }
  return "python3";
}

// ── Process-level circuit breaker (persisted to system_parameters — Fix 10) ───
//
// Prior to Fix 10, breaker state was in module-level closure (_consecutiveFailures
// and _circuitOpen) and reset on every process restart. This meant a repeated-crash
// pattern could open the breaker, restart the process, and immediately fire again.
//
// Fix 10: breaker state is persisted to system_parameters using two parameter rows:
//   quantum_replay_circuit_open       — "1" when open, "0" when closed
//   quantum_replay_consecutive_failures — integer failure count
//
// On module init (first call to runQuantumReplayForBacktest), the in-memory state
// is initialised from the DB.  On open/close, the DB rows are updated as
// fire-and-forget (non-blocking). On DB failure, the in-memory state is still
// mutated so the current process behaves correctly even if persist fails.
//
// Env vars documented here:
//   QUANTUM_REPLAY_FAILURE_THRESHOLD — failure count before opening (default 5)
//
// system_parameters domain: "scheduler" (matches pipeline-control-service.ts pattern)

const _threshold = Math.max(
  1,
  parseInt(process.env.QUANTUM_REPLAY_FAILURE_THRESHOLD ?? "5", 10) || 5,
);
let _consecutiveFailures = 0;
let _circuitOpen = false;
let _circuitOpenedAt: number | null = null; // epoch-ms when the breaker last opened (for cooldown)
let _stateLoaded = false; // true once DB init has been attempted

// Auto-cooldown: after this long the breaker self-resets (parity with quantum-rl-training-runner).
const _circuitBreakerCooldownMs = Math.max(
  60_000,
  parseInt(process.env.QUANTUM_REPLAY_CIRCUIT_BREAKER_COOLDOWN_MS ?? "3600000", 10) || 3_600_000,
);

const _PARAM_OPEN = "quantum_replay_circuit_open";
const _PARAM_FAILURES = "quantum_replay_consecutive_failures";
const _PARAM_OPENED_AT = "quantum_replay_circuit_opened_at";

/** Persist breaker state to system_parameters (fire-and-forget; never throws). */
async function _persistBreakerState(): Promise<void> {
  try {
    const openVal = _circuitOpen ? "1" : "0";
    const failVal = String(_consecutiveFailures);
    const openedAtVal = _circuitOpenedAt === null ? "" : String(_circuitOpenedAt);

    for (const [paramName, val] of [[_PARAM_OPEN, openVal], [_PARAM_FAILURES, failVal], [_PARAM_OPENED_AT, openedAtVal]] as const) {
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
            paramName === _PARAM_OPEN
              ? "quantum-replay-runner circuit breaker open flag (Fix 10). 0=closed 1=open."
              : paramName === _PARAM_OPENED_AT
                ? "quantum-replay-runner epoch-ms the breaker last opened (for auto-cooldown reset). Empty when closed."
                : "quantum-replay-runner consecutive failure count (Fix 10). Resets to 0 on success.",
        });
      }
    }
  } catch (persistErr) {
    // Non-blocking — log warn and continue; in-memory state is still correct.
    logger.warn(
      { err: String(persistErr) },
      "quantum-replay-runner: circuit breaker DB persist failed (non-blocking)",
    );
  }
}

/**
 * Load breaker state from system_parameters on first call.
 * Fire-and-forget (never throws). Populates _consecutiveFailures and _circuitOpen.
 * Subsequent calls are no-ops.
 */
async function _initBreakerStateFromDb(): Promise<void> {
  if (_stateLoaded) return;
  _stateLoaded = true;
  try {
    const rows = await db
      .select({ paramName: systemParameters.paramName, currentValue: systemParameters.currentValue })
      .from(systemParameters)
      .where(
        eq(systemParameters.domain, "scheduler"),
      );

    for (const row of rows) {
      if (row.paramName === _PARAM_OPEN) {
        _circuitOpen = row.currentValue === "1";
      }
      if (row.paramName === _PARAM_FAILURES) {
        const n = parseInt(String(row.currentValue), 10);
        _consecutiveFailures = Number.isFinite(n) ? n : 0;
      }
      if (row.paramName === _PARAM_OPENED_AT) {
        const ts = parseInt(String(row.currentValue), 10);
        _circuitOpenedAt = Number.isFinite(ts) ? ts : null;
      }
    }

    if (_circuitOpen) {
      logger.warn(
        { consecutiveFailures: _consecutiveFailures, threshold: _threshold },
        "quantum-replay-runner: circuit breaker was OPEN from prior session — auto-fire will be skipped",
      );
    }
  } catch (initErr) {
    // Non-blocking — start with safe defaults (closed, 0 failures).
    logger.warn(
      { err: String(initErr) },
      "quantum-replay-runner: circuit breaker DB init failed — starting with defaults (non-blocking)",
    );
  }
}

/**
 * Returns { isOpen, justReset } — justReset=true when the cooldown expired this call.
 * Callers that see justReset=true should emit a `quantum_replay.circuit_breaker_closed`
 * audit row so recovery is visible in audit_log. Parity with quantum-rl-training-runner.
 */
function _isCircuitOpen(): { isOpen: boolean; justReset: boolean } {
  if (!_circuitOpen) return { isOpen: false, justReset: false };
  // Auto-reset after cooldown — the breaker self-heals (was: stuck-open until manual SQL).
  if (_circuitOpenedAt !== null && Date.now() - _circuitOpenedAt >= _circuitBreakerCooldownMs) {
    _consecutiveFailures = 0;
    _circuitOpen = false;
    _circuitOpenedAt = null;
    logger.info(
      { cooldownMs: _circuitBreakerCooldownMs },
      "quantum-replay-runner: circuit breaker RESET after cooldown — resuming auto-fire",
    );
    _persistBreakerState().catch(() => { /* already logged inside */ });
    return { isOpen: false, justReset: true };
  }
  return { isOpen: true, justReset: false };
}

function _recordSuccess(): void {
  _consecutiveFailures = 0;
  _circuitOpen = false;
  _circuitOpenedAt = null;
  _persistBreakerState().catch(() => { /* already logged inside */ });
}

function _recordFailure(lastError?: string): boolean {
  _consecutiveFailures++;
  if (!_circuitOpen && _consecutiveFailures >= _threshold) {
    _circuitOpen = true;
    _circuitOpenedAt = Date.now();
    const cooldownMin = Math.round(_circuitBreakerCooldownMs / 60_000);
    logger.error(
      { consecutiveFailures: _consecutiveFailures, threshold: _threshold, cooldownMs: _circuitBreakerCooldownMs },
      "quantum-replay-runner: circuit breaker OPENED — auto-fire disabled; self-resets after cooldown",
    );
    // Wave 29 prod hardening: Discord escalation when circuit breaker opens
    try {
      notifyCritical(
        "Quantum-Replay Circuit Breaker OPEN",
        appendFamilyGradePostscript(
          `Quantum-replay circuit breaker OPEN after ${_consecutiveFailures} consecutive failures; auto-fire halted. It self-resets automatically after ~${cooldownMin} min. To clear immediately: UPDATE system_parameters SET current_value='0' WHERE param_name='quantum_replay_circuit_open'; (also set quantum_replay_consecutive_failures='0'). Last error: ${lastError ?? "unknown"}`,
          "The quantum analysis background job stopped after repeated failures.",
          `No action needed — the bot keeps trading normally and the job auto-resumes in about ${cooldownMin} minutes. Call Tony if it keeps failing past a day.`,
        ),
        { consecutiveFailures: _consecutiveFailures, threshold: _threshold, cooldownMs: _circuitBreakerCooldownMs },
      );
    } catch (_discordErr) { /* non-blocking */ }
    _persistBreakerState().catch(() => { /* already logged inside */ });
    return true; // newly opened
  }
  _persistBreakerState().catch(() => { /* already logged inside */ });
  return false;
}

/** Reset circuit state — exposed for tests only. Also persists the reset. */
export function _resetCircuitBreakerForTests(): void {
  _consecutiveFailures = 0;
  _circuitOpen = false;
  _circuitOpenedAt = null;
  _stateLoaded = false; // allow re-init from DB in integration tests
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

// ── Per-backtest seed derivation ───────────────────────────────────────────────

/**
 * Derive a stable 32-bit unsigned integer seed from a backtest ID string.
 *
 * SHA-256(backtestId).readUInt32BE(0) — deterministic per backtest, so two
 * quantum-replay runs on the same backtest produce reproducible Monte Carlo results.
 *
 * Mirrors deriveRlTrainingSeed in quantum-rl-training-runner.ts.
 * The seed is passed to quantum_replay.py via --seed <N> instead of the hardcoded "42".
 *
 * Fix 9 (Wave A hardening 2026-06-22).
 */
export function deriveReplaySeed(backtestId: string): number {
  const buf = createHash("sha256").update(String(backtestId)).digest();
  return buf.readUInt32BE(0);
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

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Spawn `python -m src.engine.replay.quantum_replay --backtest-id <uuid> --apply --seed <N>`.
 *
 * Fix 9: seed is SHA-256(backtestId).readUInt32BE(0) — deterministic per backtest.
 *
 * Returns a summary object for audit logging. Never throws — caller must handle
 * rejection (fire-and-forget pattern in backtest-service.ts).
 *
 * Circuit breaker: after QUANTUM_REPLAY_FAILURE_THRESHOLD consecutive failures,
 * all subsequent calls reject immediately with a "circuit_open" status and the
 * outer auto-fire hook logs a critical + disables.
 * Fix 10: breaker state is persisted to system_parameters so it survives process
 * restarts (quantum_replay_circuit_open + quantum_replay_consecutive_failures).
 */
export async function runQuantumReplayForBacktest(
  backtestId: string,
  correlationId?: string,
): Promise<QuantumReplayResult> {
  // ── Load persisted breaker state on first call (Fix 10) ───────────────────
  // fire-and-forget — mutates _circuitOpen/_consecutiveFailures in-place.
  await _initBreakerStateFromDb();

  // ── Circuit breaker check (auto-resets after cooldown) ──────────────────────
  const { isOpen, justReset } = _isCircuitOpen();
  if (justReset) {
    // Recovery audit — makes the auto-reset visible in audit_log (parity with RL breaker).
    db.insert(auditLog).values({
      action: "quantum_replay.circuit_breaker_closed",
      entityType: "backtest",
      entityId: String(backtestId),
      status: "success",
      correlationId: correlationId ?? null,
      result: { reason: "cooldown_expired", cooldown_ms: _circuitBreakerCooldownMs },
    }).catch((auditErr) =>
      logger.warn(
        { err: String(auditErr), backtestId },
        "quantum-replay-runner: circuit_breaker_closed audit row failed (non-blocking)",
      ),
    );
  }
  if (isOpen) {
    logger.warn(
      { backtestId, correlationId, consecutiveFailures: _consecutiveFailures },
      "quantum-replay-runner: circuit open — skipping auto-fire",
    );
    return { status: "circuit_open", rowsWritten: 0, durationMs: 0, stdoutSnippet: "" };
  }

  const timeoutMs = getTimeoutMs();
  const pythonCmd = getPythonCmd();

  // Fix 9: derive per-backtest seed so two replay runs on the same backtest
  // produce reproducible results (rather than hardcoded "42" for all).
  // SHA-256(backtestId).readUInt32BE(0) — deterministic, mirrors deriveRlTrainingSeed.
  const replaySeed = deriveReplaySeed(backtestId);

  const args = [
    "-m",
    "src.engine.replay.quantum_replay",
    "--backtest-id",
    backtestId,
    "--apply",
    "--seed",
    String(replaySeed),
  ];

  logger.info(
    { backtestId, correlationId, timeoutMs, replaySeed, module: "src.engine.replay.quantum_replay" },
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
      // FIX 7 (deepscan8): register with graceful-shutdown process set
      registerExternalPythonSubprocess(proc);
    } catch (spawnErr) {
      _recordFailure(String(spawnErr));
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
      _recordFailure(`timed out after ${timeoutMs}ms`);
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
        _recordFailure(errMsg.slice(0, 200));
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
      _recordFailure(String(err));
      reject(err);
    });
  });
}
