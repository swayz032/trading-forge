/**
 * Robustness Service — Python subprocess bridge for parameter robustness testing.
 */

import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { logger } from "../index.js";

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");

export interface RobustnessResult {
  best_params: Record<string, number>;
  best_score: number;
  n_trials: number;
  param_importance: Record<string, number>;
  robustness: {
    is_robust: boolean;
    plateau_variance: number;
    top_trial_count: number;
    best_score: number;
    worst_top_score: number;
    score_range: number;
  };
  robust_ranges: Record<string, [number, number]>;
  error?: string;
}

function runPythonRobustness(configJson: string): Promise<RobustnessResult> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const args = ["-m", "src.engine.optimizer", "--mode", "robustness", "--config", configJson];

    const proc = spawn(pythonCmd, args, {
      env: { ...process.env },
      cwd: PROJECT_ROOT,
    });

    const ROBUSTNESS_TIMEOUT_MS = 600_000;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        reject(new Error(`Robustness test timed out after ${ROBUSTNESS_TIMEOUT_MS / 1000}s`));
      }
    }, ROBUSTNESS_TIMEOUT_MS);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      logger.info({ component: "robustness-engine" }, data.toString().trim());
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          reject(new Error(`Failed to parse robustness output: ${stdout}`));
        }
      } else {
        reject(new Error(`Robustness test failed (exit ${code}): ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      if (pythonCmd === "python") {
        const proc2 = spawn("python3", args, {
          env: { ...process.env },
          cwd: PROJECT_ROOT,
        });
        let stdout2 = "";
        let stderr2 = "";
        proc2.stdout.on("data", (data) => (stdout2 += data.toString()));
        proc2.stderr.on("data", (data) => (stderr2 += data.toString()));
        proc2.on("close", (code) => {
          if (code === 0) {
            try { resolve(JSON.parse(stdout2.trim())); }
            catch { reject(new Error(`Failed to parse: ${stdout2}`)); }
          } else {
            reject(new Error(`Robustness test failed: ${stderr2}`));
          }
        });
        proc2.on("error", () => reject(err));
      } else {
        reject(err);
      }
    });
  });
}

export async function runRobustnessTest(
  strategyId: string,
  configJson: string,
): Promise<RobustnessResult> {
  const startTime = Date.now();

  try {
    const result = await runPythonRobustness(configJson);

    await db.insert(auditLog).values({
      action: "agent.robustness",
      entityType: "strategy",
      entityId: strategyId,
      input: { strategyId },
      result: {
        is_robust: result.robustness.is_robust,
        best_score: result.best_score,
        n_trials: result.n_trials,
      },
      status: "success",
      durationMs: Date.now() - startTime,
    });

    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    await db.insert(auditLog).values({
      action: "agent.robustness",
      entityType: "strategy",
      entityId: strategyId,
      input: { strategyId },
      result: { error: errorMsg },
      status: "failure",
      durationMs: Date.now() - startTime,
    });

    throw err;
  }
}
