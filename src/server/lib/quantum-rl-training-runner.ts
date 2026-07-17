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
import { systemParameters, auditLog, rlTrainingRuns } from "../db/schema.js";
import { logger } from "./logger.js";
import { notifyCritical } from "../services/notification-service.js";
import { appendFamilyGradePostscript } from "./notification-helpers.js";
// FIX 7 (deepscan8): register spawned process with graceful-shutdown set
// FIX H2 (deepscan15 2026-07-03): acquire/release a shared python-runner semaphore
// slot around this bespoke spawn so it counts toward MAX_PYTHON_SUBPROCESSES and
// the pythonSubprocess{Active,Queued} stats — previously this spawn bypassed the
// semaphore entirely.
import { registerExternalPythonSubprocess, acquireExternalPythonSlot, releaseExternalPythonSlot } from "./python-runner.js";

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

// ── AUDIT_EVENT_JSON stderr bridge (Deep-Scan #18, 2026-07-05) ──────────────────
//
// The spawned Python training subprocess (quantum_rl_agent → db_loader.py
// load_backtest_bar_data) cannot write audit_log directly. It emits canonical
// `AUDIT_EVENT_JSON {json}` stderr sentinels (mirrors backtester.py) for CPCV purge
// events. Parse them from the child's full stderr on close and write the documented
// audit rows here (the runner already owns a DB handle). Closes the Band-H gap where
// quantum_rl.training_cpcv_purge_violation was documented but never actually fired.
const _AUDIT_EVENT_SENTINEL = "AUDIT_EVENT_JSON ";
const _MAX_AUDIT_EVENTS_PER_RUN = 50; // flood guard

export function _writeStderrAuditEvents(
  stderrText: string,
  strategyId: number | string,
  correlationId?: string,
): number {
  let emitted = 0;
  for (const rawLine of stderrText.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed.startsWith(_AUDIT_EVENT_SENTINEL)) continue;
    if (emitted >= _MAX_AUDIT_EVENTS_PER_RUN) break;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(trimmed.slice(_AUDIT_EVENT_SENTINEL.length));
    } catch {
      continue; // malformed sentinel — skip
    }
    const action = typeof payload.event === "string" ? payload.event : null;
    if (!action) continue;
    emitted++;
    const status = typeof payload.status === "string" ? payload.status : "info";
    const { event: _event, status: _status, ...rest } = payload;
    void _event;
    void _status;
    db.insert(auditLog)
      .values({
        action,
        entityType: "strategy",
        entityId: String(strategyId),
        status,
        correlationId: correlationId ?? null,
        result: rest,
      })
      .catch((auditErr: unknown) =>
        logger.warn(
          { err: String(auditErr), strategyId, action },
          "quantum-rl-training-runner: AUDIT_EVENT_JSON audit row write failed (non-blocking)",
        ),
      );
  }
  return emitted;
}

// ── Output type ───────────────────────────────────────────────────────────────

export interface RlTrainingAutoFireResult {
  status: "completed" | "failed" | "circuit_open" | "skipped_rth" | "degraded_regime_unwired";
  regimesTrained: number;
  durationMs: number;
  stdoutSnippet: string;
}

// ── DS#20 T-G2: rl_training_runs pending-row lifecycle helper ──────────────────
/**
 * Transitions the pending-row inserted before spawn to a terminal status.
 * Fail-soft (never throws) — a finalize-write failure must not affect the
 * caller's resolve/reject path, it only means the bookkeeping row is left in
 * `running` until scheduler.ts's stale-pending-sweeper (30-min cutoff) sweeps it.
 */
function _finalizeRlTrainingRunRow(
  rlTrainingRunId: string | null,
  status: "completed" | "failed" | "skipped_regime_unwired",
  extra: { executionTimeMs?: number; comparisonResult?: Record<string, unknown> } = {},
): void {
  if (!rlTrainingRunId) return;
  db.update(rlTrainingRuns)
    .set({
      status,
      executionTimeMs: extra.executionTimeMs ?? null,
      comparisonResult: extra.comparisonResult ?? null,
    })
    .where(eq(rlTrainingRuns.id, rlTrainingRunId))
    .catch((err: unknown) =>
      logger.warn(
        { err: String(err), rlTrainingRunId, status },
        "quantum-rl-training-runner: rl_training_runs finalize update failed (non-blocking)",
      ),
    );
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
    }).catch((auditErr: unknown) =>
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

  // ── DS#20 T-G2: pending job-tracking row BEFORE spawn ──────────────────────
  // §13 "Don't create fire-and-forget runs without a pending DB row" — prior to
  // this fix the subprocess was spawned with no DB row at all, so a both-process
  // death (OS OOM-kill / power loss) left the training attempt invisible AND the
  // circuit-breaker counter never incremented (the process never reached a
  // close/error/timeout handler to record the failure).
  //
  // Target table: rl_training_runs — NOT quantum_rl_runs. quantum_rl_runs
  // (Wave 29 Pass C.1) has no status column at all and its NOT-NULL columns
  // (regime, state_vector, action, confidence_score, effective_confidence,
  // reward, governance_labels) are real per-decision RL outputs that don't
  // exist until training completes; rl-signal-fetcher.ts reads the LATEST
  // quantum_rl_runs row per strategy to drive the composite-health kill-switch
  // + DSR-floor gate (score-normalization.ts), so a fabricated placeholder row
  // there would corrupt that advisory signal the moment it's inserted. Instead
  // this mirrors the existing legacy pattern in backtest-service.ts:2336
  // ("Insert running row before Python call" into rl_training_runs), which is
  // already covered by scheduler.ts's stale-pending-sweeper (rl_training_runs,
  // 30-min cutoff) — so the boot-time orphan sweep is already in place for this
  // table with no further scheduler changes needed.
  //
  // Fail-soft: an insert failure must NOT block the spawn (challenger-only,
  // advisory-only research signal — losing one data point is fine; blocking
  // training on a DB hiccup is not).
  let rlTrainingRunId: string | null = null;
  try {
    const [rlRow] = await db.insert(rlTrainingRuns).values({
      strategyId: String(strategyId),
      status: "running",
      method: "pennylane_vqc",
      episodes: trainingEpochs,
      governanceLabels: {
        experimental: true,
        authoritative: false,
        decision_role: "challenger_only",
        training_mode: true,
        source: "quantum-rl-training-runner_auto_fire",
      },
    }).returning({ id: rlTrainingRuns.id });
    rlTrainingRunId = rlRow?.id ?? null;
  } catch (pendingRowErr) {
    logger.warn(
      { err: String(pendingRowErr), strategyId, correlationId },
      "quantum-rl-training-runner: rl_training_runs pending-row insert failed (non-blocking) — spawn proceeds without crash-visibility row",
    );
  }

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

  // FIX H2 (deepscan15): acquire a backtest-lane slot BEFORE spawning so this
  // subprocess counts toward MAX_PYTHON_SUBPROCESSES / getPythonSubprocessStats().
  // Released once the wrapped promise settles (resolve or reject), covering the
  // timeout / close / spawn-error paths below.
  await acquireExternalPythonSlot("backtest");
  try {
    return await new Promise<RlTrainingAutoFireResult>((resolve, reject) => {
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
      _finalizeRlTrainingRunRow(rlTrainingRunId, "failed");
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
      _finalizeRlTrainingRunRow(rlTrainingRunId, "failed");
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

    proc.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;

      const durationMs = Date.now() - start;
      const stdoutSnippet = stdout.slice(-500);

      // Deep-Scan #18: surface any AUDIT_EVENT_JSON sentinels the training subprocess
      // emitted (e.g. quantum_rl.training_cpcv_purge_violation from db_loader.py) as
      // real audit_log rows. Runs regardless of exit code — a purge is worth recording
      // even if training later failed.
      _writeStderrAuditEvents(stderr, strategyId, correlationId);

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
        _finalizeRlTrainingRunRow(rlTrainingRunId, "completed", {
          executionTimeMs: durationMs,
          comparisonResult: { regimesTrained },
        });
        logger.info(
          { strategyId, correlationId, durationMs, regimesTrained },
          "quantum-rl-training-runner: subprocess completed successfully",
        );
        resolve({ status: "completed", regimesTrained, durationMs, stdoutSnippet });
      } else if (code === 3) {
        // ── DEGRADED / known-gap (exit 3 = regime_grouping_failed) ────────────
        // The Python CLI signals that bars loaded but NOT ONE carried an
        // institutional_regime key — regime wiring for historical training bars
        // is a DOCUMENTED, DEFERRED design decision, not a runtime incident.
        // Treat as a THIRD outcome distinct from both success and failure:
        //   * NOT _recordRlSuccess → kills the false-green (no breaker RESET,
        //     no status="completed" — the original r2fix bug closure holds).
        //   * NOT _recordRlFailure → does NOT page the operator or advance the
        //     circuit breaker for a feature that isn't built yet (alert-fatigue
        //     anti-pattern — every auto-fire hits this until regime wiring ships).
        // The degraded state stays VISIBLE via a distinct audit row + the run
        // row status, so the operator can see it without a Discord CRITICAL.
        let groupingDetail: Record<string, unknown> | null = null;
        try {
          const parsed = JSON.parse(stdout.trim());
          if (parsed?.grouping_failure_detail && typeof parsed.grouping_failure_detail === "object") {
            groupingDetail = parsed.grouping_failure_detail as Record<string, unknown>;
          }
        } catch { /* non-JSON stdout — detail unknown */ }
        logger.warn(
          { strategyId, correlationId, durationMs, groupingDetail },
          "quantum-rl-training-runner: subprocess reported DEGRADED regime_grouping_failed (known deferred design gap — not paging)",
        );
        db.insert(auditLog)
          .values({
            action: "quantum_rl.training_skipped_regime_unwired",
            entityType: "strategy",
            entityId: String(strategyId),
            status: "warning",
            correlationId: correlationId ?? null,
            result: {
              reason: "regime_grouping_failed",
              detail: groupingDetail,
              note:
                "Historical training bars carry no institutional_regime key; " +
                "regime wiring is a deferred design decision. Advisory challenger — " +
                "no live impact. Surfaced without paging by design.",
              governance_labels: { experimental: true, authoritative: false, decision_role: "challenger_only", degraded: true },
            },
          })
          .catch((auditErr: unknown) =>
            logger.warn(
              { err: String(auditErr), strategyId },
              "quantum-rl-training-runner: regime_unwired degraded audit write failed (non-blocking)",
            ),
          );
        _finalizeRlTrainingRunRow(rlTrainingRunId, "skipped_regime_unwired", { executionTimeMs: durationMs });
        resolve({ status: "degraded_regime_unwired", regimesTrained: 0, durationMs, stdoutSnippet });
      } else {
        const errMsg = stderr.trim() || `exit code ${code}`;
        logger.error(
          { strategyId, correlationId, code, durationMs, errMsg: errMsg.slice(0, 300) },
          "quantum-rl-training-runner: subprocess exited with non-zero code",
        );
        _recordRlFailure(`exit ${code}: ${errMsg.slice(0, 200)}`);
        _finalizeRlTrainingRunRow(rlTrainingRunId, "failed", { executionTimeMs: durationMs });
        reject(new Error(`quantum_rl_agent train failed (exit ${code}) for strategyId=${strategyId}: ${errMsg.slice(0, 200)}`));
      }
    });

    proc.on("error", (err: unknown) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      logger.error({ strategyId, correlationId, err }, "quantum-rl-training-runner: spawn error");
      _recordRlFailure(String(err));
      _finalizeRlTrainingRunRow(rlTrainingRunId, "failed");
      reject(err);
    });
    });
  } finally {
    releaseExternalPythonSlot("backtest");
  }
}
