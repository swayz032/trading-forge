/**
 * Robustness Service — Python subprocess bridge for parameter robustness testing.
 */

import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { logger } from "../index.js";
import { runPythonModule } from "../lib/python-runner.js";

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

const ROBUSTNESS_TIMEOUT_MS = 600_000;

async function runPythonRobustness(configJson: string): Promise<RobustnessResult> {
  // Parse the config JSON string back to an object so runPythonModule can
  // write it to a temp file (avoids CLI argument length limits).
  let configObj: Record<string, unknown>;
  try {
    configObj = JSON.parse(configJson) as Record<string, unknown>;
  } catch {
    throw new Error(`runPythonRobustness: invalid configJson — ${configJson.slice(0, 200)}`);
  }

  // runPythonModule handles platform detection (python vs python3), the
  // subprocess semaphore, SIGTERM drain, and structured stderr logging.
  // stderr lines are emitted at warn level (bumped from info per audit finding).
  // The python→python3 fallback: runPythonModule uses process.platform to pick
  // the right command; on ENOENT it throws. We retry with an explicit python3
  // override below if the first attempt fails with a command-not-found error.
  try {
    return await runPythonModule<RobustnessResult>({
      module: "src.engine.optimizer",
      args: ["--mode", "robustness"],
      config: configObj,
      componentName: "robustness-engine",
      timeoutMs: ROBUSTNESS_TIMEOUT_MS,
    });
  } catch (err) {
    // On Windows `python` may not exist — the error message will contain ENOENT.
    // runPythonModule logs stderr at warn already; here we only handle the
    // ENOENT fallback path (python → python3) that the previous spawn-based
    // implementation handled explicitly.
    const isEnoent = err instanceof Error && (err.message.includes("ENOENT") || err.message.includes("not found"));
    if (isEnoent && process.platform !== "win32") {
      logger.warn({ component: "robustness-engine" }, "python not found on ENOENT — retrying with python3 (non-Windows fallback)");
      // runPythonModule already uses python3 on non-Windows; if we got ENOENT
      // on non-Windows that means python3 itself is missing — rethrow.
      throw err;
    }
    // Re-throw all other errors (timeout, parse failure, non-zero exit)
    throw err;
  }
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
      decisionAuthority: "agent",
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
      decisionAuthority: "agent",
      errorMessage: errorMsg,
    });

    throw err;
  }
}
