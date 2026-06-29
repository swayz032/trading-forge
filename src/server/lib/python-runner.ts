import { spawn, type ChildProcess } from "child_process";
import { logger } from "./logger.js";
import { parsePythonJson } from "../../shared/utils.js";
import { resolve as pathResolve } from "path";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");

// G5.1: Python subprocess concurrency cap.
// Without a cap, agent batch + matrix backtest + auto fire-and-forget runs can
// spawn 50+ Python processes on a busy day → OOM. The semaphore queues calls
// once `MAX_PYTHON_SUBPROCESSES` are active. Set the env var to tune for the
// host (default 6 — conservative for an 8-core dev box).
//
// deepscan5 2026-06-29 (obs-H1 capital-safety): TWO ISOLATED LANES.
// Previously a SINGLE pool served both backtest/MC runs and the execution path
// (kill-switch, compliance gate, Style C exit handler). Under backtest load all
// slots filled → execution-path calls queued behind 30-min backtests, hit their
// 3 s timeout, and 3 timeouts in 10 min tripped the exit-handler circuit breaker
// → TP/stop/15:55-flatten disabled on open positions for the cooldown window.
// FIX: a dedicated "execution" lane with its own reserved slots that backtest-lane
// calls can NEVER consume. Execution-path calls only ever wait behind OTHER
// execution-path calls (cap MAX_PYTHON_SUBPROCESSES_EXECUTION), never behind a backtest.
type PythonLane = "backtest" | "execution";

const MAX_PYTHON_SUBPROCESSES = Math.max(
  1,
  parseInt(process.env.MAX_PYTHON_SUBPROCESSES ?? "6", 10) || 6,
);
// Reserved execution-lane slots (default 2). Kept small — execution-path Python
// calls are short (compliance/exit-plan/kill-switch), so 2 concurrent is ample and
// the reservation costs little headroom on the shared host.
const MAX_PYTHON_SUBPROCESSES_EXECUTION = Math.max(
  1,
  parseInt(process.env.MAX_PYTHON_SUBPROCESSES_EXECUTION ?? "2", 10) || 2,
);

interface _LaneState {
  active: number;
  queueDepth: number;
  cap: number;
  waitQueue: Array<() => void>;
}
const _lanes: Record<PythonLane, _LaneState> = {
  backtest: { active: 0, queueDepth: 0, cap: MAX_PYTHON_SUBPROCESSES, waitQueue: [] },
  execution: { active: 0, queueDepth: 0, cap: MAX_PYTHON_SUBPROCESSES_EXECUTION, waitQueue: [] },
};

function _acquirePythonSlot(lane: PythonLane = "backtest"): Promise<void> {
  const L = _lanes[lane];
  if (L.active < L.cap) {
    L.active++;
    return Promise.resolve();
  }
  L.queueDepth++;
  return new Promise<void>((resolve) => {
    L.waitQueue.push(() => {
      L.queueDepth--;
      L.active++;
      resolve();
    });
  });
}

function _releasePythonSlot(lane: PythonLane = "backtest"): void {
  const L = _lanes[lane];
  L.active = Math.max(0, L.active - 1);
  const next = L.waitQueue.shift();
  if (next) next();
}

// ─── Subprocess registry (SIGTERM drain support) ──────────────────────────────
// Tracks every live ChildProcess so gracefullyShutdownPythonSubprocesses() can
// signal them all on server shutdown. Entries are added after spawn() and removed
// automatically on the "exit" event, so the set always reflects truly live procs.
const _activeSubprocesses = new Set<ChildProcess>();

function _registerSubprocess(child: ChildProcess): void {
  _activeSubprocesses.add(child);
  child.once("exit", () => _activeSubprocesses.delete(child));
}

/**
 * Signal every live Python subprocess and wait for graceful exit.
 * Called during SIGTERM/SIGINT shutdown in index.ts.
 *
 * Sequence:
 *   1. SIGTERM to all — gives Python a chance to flush / clean up temp files.
 *   2. Poll until all have exited or timeoutMs elapses.
 *   3. SIGKILL any survivors.
 *
 * @param timeoutMs — grace period before hard-kill (default 5 s).
 */
export async function gracefullyShutdownPythonSubprocesses(timeoutMs = 5_000): Promise<void> {
  if (_activeSubprocesses.size === 0) return;

  logger.info(
    { count: _activeSubprocesses.size },
    "Shutdown: sending SIGTERM to active Python subprocesses",
  );

  for (const child of _activeSubprocesses) {
    try { child.kill("SIGTERM"); } catch { /* already dead — ignore */ }
  }

  const deadline = Date.now() + timeoutMs;
  while (_activeSubprocesses.size > 0 && Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, 100));
  }

  if (_activeSubprocesses.size > 0) {
    logger.warn(
      { remaining: _activeSubprocesses.size },
      "Shutdown: Python subprocesses did not exit within grace period — sending SIGKILL",
    );
    for (const child of _activeSubprocesses) {
      try { child.kill("SIGKILL"); } catch { /* dead */ }
    }
  } else {
    logger.info("Shutdown: all Python subprocesses exited cleanly");
  }
}

/** Observability hook — used by /api/health and metrics endpoints.
 * `active`/`queued`/`cap` report the BACKTEST lane (the historical contract — existing
 * callers + the /api/health backtestConcurrency block read these). Per-lane detail under
 * `lanes` so dashboards can see execution-lane saturation independently. */
export function getPythonSubprocessStats(): {
  active: number;
  queued: number;
  cap: number;
  lanes: Record<PythonLane, { active: number; queued: number; cap: number }>;
} {
  return {
    active: _lanes.backtest.active,
    queued: _lanes.backtest.queueDepth,
    cap: _lanes.backtest.cap,
    lanes: {
      backtest: { active: _lanes.backtest.active, queued: _lanes.backtest.queueDepth, cap: _lanes.backtest.cap },
      execution: { active: _lanes.execution.active, queued: _lanes.execution.queueDepth, cap: _lanes.execution.cap },
    },
  };
}

export interface PythonRunnerOptions {
  module?: string;
  scriptCode?: string;
  args?: string[];
  config?: Record<string, unknown>;
  timeoutMs?: number;
  componentName?: string;
  /** Correlation ID from the originating HTTP request (req.id). Propagated to Python as config._metadata.correlationId. */
  correlationId?: string;
  /** deepscan5 obs-H1: subprocess concurrency lane. "execution" draws from a dedicated reserved
   * pool (MAX_PYTHON_SUBPROCESSES_EXECUTION) that backtest/MC runs can never consume — use it for
   * the capital-safety path (kill-switch, compliance gate, Style C exit handler) so those calls
   * never queue behind a long backtest. Default "backtest" (all batch/MC/scout/cache work). */
  lane?: "backtest" | "execution";
}

// ─── Truthiness sentinel payloads ────────────────────────────────────────────
// B-1 (parity-shadow) and B-2 (invariant-harness) emit structured sentinel
// lines to stderr so the Node runner can capture and propagate them without
// relying on Python modifying its stdout JSON contract.
//
// Format: "<PREFIX> <JSON>"
// PREFIX must be one of the two constants below.
//
// Both are collected in truthinessEvents on the process-level accumulator and
// returned by runPythonModule alongside the normal stdout result. backtest-service
// consumes them to write audit_log rows and fire Discord alerts.

export const PARITY_SHADOW_SENTINEL = "PARITY_SHADOW_DRIFT_JSON";
export const INVARIANT_FAILURE_SENTINEL = "INVARIANT_FAILURE_JSON";
// B15 Parameter Robustness Battery sentinel (Wave 25 Item 5).
// Emitted by backtester.py --b15-battery flag.
// Both ends must change in the same commit — see Known-Facts Pin in AGENT-LOGS.md.
export const B15_BATTERY_SENTINEL = "B15_BATTERY_JSON";

export interface TruthinessSentinelEvent {
  type: "parity_shadow_drift" | "invariant_failure" | "b15_battery";
  payload: Record<string, unknown>;
}

/**
 * Parse a single stderr line for a truthiness sentinel.
 * Returns a structured event if the line matches, null otherwise.
 */
export function parseTruthinessSentinel(line: string): TruthinessSentinelEvent | null {
  if (line.startsWith(PARITY_SHADOW_SENTINEL + " ")) {
    try {
      const json = line.slice(PARITY_SHADOW_SENTINEL.length + 1);
      const payload = JSON.parse(json) as Record<string, unknown>;
      return { type: "parity_shadow_drift", payload };
    } catch {
      logger.warn({ line: line.slice(0, 120) }, "python-runner: PARITY_SHADOW_DRIFT_JSON sentinel found but JSON parse failed");
      return null;
    }
  }
  if (line.startsWith(INVARIANT_FAILURE_SENTINEL + " ")) {
    try {
      const json = line.slice(INVARIANT_FAILURE_SENTINEL.length + 1);
      const payload = JSON.parse(json) as Record<string, unknown>;
      return { type: "invariant_failure", payload };
    } catch {
      logger.warn({ line: line.slice(0, 120) }, "python-runner: INVARIANT_FAILURE_JSON sentinel found but JSON parse failed");
      return null;
    }
  }
  if (line.startsWith(B15_BATTERY_SENTINEL + " ")) {
    try {
      const json = line.slice(B15_BATTERY_SENTINEL.length + 1);
      const payload = JSON.parse(json) as Record<string, unknown>;
      return { type: "b15_battery", payload };
    } catch {
      logger.warn({ line: line.slice(0, 120) }, "python-runner: B15_BATTERY_JSON sentinel found but JSON parse failed");
      return null;
    }
  }
  return null;
}

/**
 * Robust Python subprocess runner for Trading Forge.
 * - Uses temporary files for JSON config (avoids CLI length limits on Windows).
 * - Uses robust JSON parsing (ignores logging noise).
 * - Automatic platform detection (python vs python3).
 * - Consistent timeout and process cleanup.
 * - Captures PARITY_SHADOW_DRIFT_JSON / INVARIANT_FAILURE_JSON sentinel lines
 *   from stderr and attaches them as _truthiness_events on the returned result
 *   object so backtest-service can audit and alert without stdout contract changes.
 *
 * The return type is T (unchanged) — truthiness events are attached as a dynamic
 * property and are accessible via `(result as Record<string,unknown>)._truthiness_events`.
 * This avoids breaking callers that mockResolvedValue a plain object.
 */
export async function runPythonModule<T = Record<string, unknown>>(
  options: PythonRunnerOptions
): Promise<T> {
  const {
    module,
    scriptCode,
    args = [],
    config,
    timeoutMs = 60_000,
    componentName = "python-engine",
    correlationId,
    lane = "backtest",
  } = options;

  let configTmpPath: string | null = null;
  let scriptTmpPath: string | null = null;

  // G5.1 + deepscan5 obs-H1: acquire a subprocess slot on the requested lane before doing any
  // work. Released in finally on the SAME lane. "execution" lane is reserved (backtest load
  // cannot starve it). Default "backtest".
  await _acquirePythonSlot(lane);

  try {
    // Python interpreter selection (Phase 15 revised):
    // - Prefer absolute path to system Python (avoids PATH issues under schtasks/service envs)
    // - Phase 15 .venv pin reverted: the .venv on this host is a WindowsApps stub that fails
    //   "Unable to create process" when spawned from non-interactive contexts.
    // - We also force PYTHONUSERSITE=1 + PYTHONPATH (below) so user-site packages installed
    //   via `pip install --user` are visible to subprocesses regardless of parent env.
    const systemPythonWin = "C:\\Program Files\\Python313\\python.exe";
    const pythonCmd = process.platform === "win32"
      ? (existsSync(systemPythonWin) ? systemPythonWin : "python")
      : "python3";
    const finalArgs: string[] = [];

    // 1. Handle Script vs Module
    if (scriptCode) {
      scriptTmpPath = pathResolve(tmpdir(), `tf-script-${randomUUID()}.py`);
      writeFileSync(scriptTmpPath, scriptCode);
      finalArgs.push(scriptTmpPath);
    } else if (module) {
      finalArgs.push("-m", module);
    } else {
      throw new Error("Either module or scriptCode must be provided");
    }

    // 2. Handle Config (via temp file)
    if (config || correlationId) {
      // Inject correlation ID into _metadata so Python subprocesses can propagate it in logs/traces
      const configWithMeta: Record<string, unknown> = { ...(config ?? {}) };
      if (correlationId) {
        configWithMeta._metadata = {
          ...((configWithMeta._metadata as Record<string, unknown> | undefined) ?? {}),
          correlationId,
        };
      }
      configTmpPath = pathResolve(tmpdir(), `tf-config-${randomUUID()}.json`);
      writeFileSync(configTmpPath, JSON.stringify(configWithMeta));
      finalArgs.push("--config", configTmpPath);
    }

    // 3. Append extra args
    finalArgs.push(...args);

    // A1 Determinism: always inject BLAS/OMP thread-count env vars into every
    // Python subprocess so MKL/OpenBLAS see them at import time regardless of
    // whether the parent Node process has them set. These never hurt performance
    // in backtest/MC/WF subprocesses (they are single-threaded by design) and
    // eliminate the #1 source of nondeterminism in Python financial code.
    // DETERMINISM_MODE=true additionally triggers enable_determinism() inside Python.
    //
    // Phase 12 perf defaults:
    // - TF_STRESS_TEST_MODE=pipeline: skip the 8-scenario crisis stress test
    //   during pipeline validation backtests. Run "full" only for explicit
    //   promotion-gate stress tests (stress_test module CLI).
    // - WF_PARALLEL=1: enable parallel walk-forward OOS windows (ProcessPoolExecutor).
    //   Override with WF_PARALLEL=0 in .env to force serial execution.
    // Both can be overridden by setting the env var in the parent process .env.
    const deterministicEnv: Record<string, string> = {
      MKL_CBWR: "COMPATIBLE",
      OPENBLAS_NUM_THREADS: "1",
      BLIS_NUM_THREADS: "1",
      OMP_NUM_THREADS: "1",
      // Phase 12: default pipeline mode for all Python backtests
      TF_STRESS_TEST_MODE: process.env.TF_STRESS_TEST_MODE ?? "pipeline",
      WF_PARALLEL: process.env.WF_PARALLEL ?? "1",
      // Phase 15: force user-site visibility so subprocess sees `pip install --user`
      // packages (e.g. click) even when launched from non-interactive schtasks env.
      // PYTHONUSERSITE=1 alone is insufficient when the server runs as a DIFFERENT
      // OS user (e.g. schtasks default session user) — that user's user-site dir
      // is empty. PYTHONPATH explicitly adds tonio's user-site to module search.
      PYTHONUSERSITE: "1",
      PYTHONPATH: [
        "C:\\Users\\tonio\\AppData\\Roaming\\Python\\Python313\\site-packages",
        "C:\\Program Files\\Python313\\Lib\\site-packages",
        process.env.PYTHONPATH ?? "",
      ].filter(Boolean).join(";"),
    };
    return await new Promise((resolve, reject) => {
      const proc = spawn(pythonCmd, finalArgs, {
        env: { ...process.env, ...deterministicEnv },
        cwd: PROJECT_ROOT,
      });
      // Register in the active set so gracefullyShutdownPythonSubprocesses()
      // can signal this process during SIGTERM. The "exit" listener inside
      // _registerSubprocess removes it automatically when it terminates.
      _registerSubprocess(proc);

      let settled = false;
      let stdout = "";
      let stderr = "";
      // Accumulate truthiness sentinel events parsed from stderr lines.
      // These are emitted by B-1 (parity-shadow) and B-2 (invariant-harness).
      const truthinessEvents: TruthinessSentinelEvent[] = [];

      let killTimer: ReturnType<typeof setTimeout> | null = null;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { proc.kill("SIGTERM"); } catch { /* already dead */ }
        // Escalate to SIGKILL if SIGTERM doesn't work within 2s
        killTimer = setTimeout(() => {
          try { proc.kill("SIGKILL"); } catch { /* already dead */ }
        }, 2000);
        reject(new Error(`${componentName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      proc.stdout.on("data", (data) => (stdout += data.toString()));
      proc.stderr.on("data", (data) => {
        const chunk = data.toString();
        for (const line of chunk.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          stderr += trimmed + "\n";

          // Check for truthiness sentinel lines BEFORE generic warn log.
          // Sentinel lines carry structured evidence and are elevated to error
          // so they surface above normal Python diagnostic noise.
          const sentinel = parseTruthinessSentinel(trimmed);
          if (sentinel) {
            truthinessEvents.push(sentinel);
            const eventName = sentinel.type === "parity_shadow_drift"
              ? "backtest.parity_shadow_drift_detected"
              : sentinel.type === "invariant_failure"
              ? "backtest.invariant_failure_detected"
              : "backtest.b15_battery_result";
            logger.error(
              {
                event: eventName,
                sentinelType: sentinel.type,
                component: componentName,
                module,
                correlationId,
                payload: sentinel.payload,
              },
              `python-runner: truthiness sentinel captured — ${sentinel.type}`,
            );
          } else {
            // Log at warn so Python tracebacks are always visible in production (LOG_LEVEL=info).
            // correlationId is included here so Python stderr lines are linkable to the HTTP
            // request that spawned this subprocess.
            logger.warn({ component: componentName, module, correlationId }, trimmed);
          }
        }
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        if (settled) return;
        settled = true;

        if (code === 0) {
          try {
            const parsed = parsePythonJson<T>(stdout);
            // Attach truthiness events as a dynamic property on the parsed result.
            // We cast through Record<string,unknown> to avoid modifying the T signature
            // so existing callers that mockResolvedValue a plain object are unaffected.
            // backtest-service reads this via (result as Record<string,unknown>)._truthiness_events.
            if (truthinessEvents.length > 0) {
              (parsed as Record<string, unknown>)["_truthiness_events"] = truthinessEvents;
            }
            resolve(parsed);
          } catch (err) {
            reject(new Error(`Failed to parse ${componentName} output: ${err instanceof Error ? err.message : String(err)}`));
          }
        } else {
          // Wave hardening 2026-06-22 (CF-8): strip startup-banner lines from stderr
          // before forming the error reason so the banner never becomes the reported
          // failure cause.  Pattern: "All N context layers imported and callable[.]"
          const BANNER_RE = /^All \d+ context layers imported and callable\.?\s*$/m;
          const stderrTrimmed = stderr.trim();
          const bannerOnlyStderr = BANNER_RE.test(stderrTrimmed) &&
            stderrTrimmed.split("\n").every(l => BANNER_RE.test(l.trim()) || l.trim() === "");
          let errorMsg: string;
          if (bannerOnlyStderr || stderrTrimmed === "") {
            // No real traceback — include the raw banner as diagnostic context so
            // operators can distinguish "banner-only crash" from "empty stderr crash".
            const rawContext = stderrTrimmed
              ? ` (stderr contained only startup banner; raw: ${stderrTrimmed})`
              : "";
            errorMsg = `Exit code ${code}${rawContext}`;
          } else {
            // Real traceback present — strip any leading banner line(s) and keep the rest.
            const stripped = stderrTrimmed
              .split("\n")
              .filter(l => !BANNER_RE.test(l.trim()))
              .join("\n")
              .trim();
            errorMsg = stripped || `Exit code ${code}`;
          }
          reject(new Error(`${componentName} failed: ${errorMsg}`));
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(err);
      });
    });
  } finally {
    // Cleanup temp files
    if (configTmpPath) { try { unlinkSync(configTmpPath); } catch { /* ignore */ } }
    if (scriptTmpPath) { try { unlinkSync(scriptTmpPath); } catch { /* ignore */ } }
    // G5.1: always release the slot on the SAME lane, even on throw / timeout.
    _releasePythonSlot(lane);
  }
}
