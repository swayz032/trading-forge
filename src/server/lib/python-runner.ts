import { spawn, type ChildProcess } from "child_process";
import { logger } from "../index.js";
import { parsePythonJson } from "../../shared/utils.js";
import { resolve as pathResolve } from "path";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");

// G5.1: Python subprocess concurrency cap.
// Without a cap, agent batch + matrix backtest + auto fire-and-forget runs can
// spawn 50+ Python processes on a busy day → OOM. The semaphore queues calls
// once `MAX_PYTHON_SUBPROCESSES` are active. Set the env var to tune for the
// host (default 6 — conservative for an 8-core dev box).
const MAX_PYTHON_SUBPROCESSES = Math.max(
  1,
  parseInt(process.env.MAX_PYTHON_SUBPROCESSES ?? "6", 10) || 6,
);
let _pythonActiveCount = 0;
let _pythonQueueDepth = 0;
const _pythonWaitQueue: Array<() => void> = [];

function _acquirePythonSlot(): Promise<void> {
  if (_pythonActiveCount < MAX_PYTHON_SUBPROCESSES) {
    _pythonActiveCount++;
    return Promise.resolve();
  }
  _pythonQueueDepth++;
  return new Promise<void>((resolve) => {
    _pythonWaitQueue.push(() => {
      _pythonQueueDepth--;
      _pythonActiveCount++;
      resolve();
    });
  });
}

function _releasePythonSlot(): void {
  _pythonActiveCount = Math.max(0, _pythonActiveCount - 1);
  const next = _pythonWaitQueue.shift();
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

/** Observability hook — used by /api/health and metrics endpoints. */
export function getPythonSubprocessStats(): { active: number; queued: number; cap: number } {
  return {
    active: _pythonActiveCount,
    queued: _pythonQueueDepth,
    cap: MAX_PYTHON_SUBPROCESSES,
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
}

/**
 * Robust Python subprocess runner for Trading Forge.
 * - Uses temporary files for JSON config (avoids CLI length limits on Windows).
 * - Uses robust JSON parsing (ignores logging noise).
 * - Automatic platform detection (python vs python3).
 * - Consistent timeout and process cleanup.
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
  } = options;

  let configTmpPath: string | null = null;
  let scriptTmpPath: string | null = null;

  // G5.1: acquire a subprocess slot before doing any work. Released in finally.
  await _acquirePythonSlot();

  try {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
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

    return await new Promise((resolve, reject) => {
      const proc = spawn(pythonCmd, finalArgs, {
        env: { ...process.env },
        cwd: PROJECT_ROOT,
      });
      // Register in the active set so gracefullyShutdownPythonSubprocesses()
      // can signal this process during SIGTERM. The "exit" listener inside
      // _registerSubprocess removes it automatically when it terminates.
      _registerSubprocess(proc);

      let settled = false;
      let stdout = "";
      let stderr = "";

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
        const msg = data.toString().trim();
        if (msg) {
          stderr += msg + "\n";
          // Log at warn so Python tracebacks are always visible in production (LOG_LEVEL=info).
          // correlationId is included here so Python stderr lines are linkable to the HTTP request
          // that spawned this subprocess. Python already emits the correlationId in its own prints
          // (via _metadata.correlationId injected into the config), so this makes the Node side
          // consistent with the Python side.
          logger.warn({ component: componentName, module, correlationId }, msg);
        }
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        if (settled) return;
        settled = true;

        if (code === 0) {
          try {
            resolve(parsePythonJson<T>(stdout));
          } catch (err) {
            reject(new Error(`Failed to parse ${componentName} output: ${err instanceof Error ? err.message : String(err)}`));
          }
        } else {
          const errorMsg = stderr.trim() || `Exit code ${code}`;
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
    // G5.1: always release the slot, even on throw / timeout.
    _releasePythonSlot();
  }
}
