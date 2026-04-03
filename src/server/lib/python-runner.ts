import { spawn } from "child_process";
import { logger } from "../index.js";
import { parsePythonJson } from "../../shared/utils.js";
import { resolve as pathResolve } from "path";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");

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
          // Log at warn so Python tracebacks are always visible in production (LOG_LEVEL=info)
          logger.warn({ component: componentName, module }, msg);
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
  }
}
