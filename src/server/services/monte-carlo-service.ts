/**
 * Monte Carlo Service — Node↔Python bridge + DB persistence
 *
 * Follows backtest-service.ts pattern exactly:
 * - Platform detection (python vs python3)
 * - Temp file for large JSON payloads (trade lists)
 * - stdout → JSON.parse
 * - stderr → logging
 */

import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { backtests, monteCarloRuns, auditLog } from "../db/schema.js";
import { logger } from "../index.js";

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../..");

interface MCOptions {
  numSimulations?: number;
  method?: "trade_resample" | "return_bootstrap" | "both";
  useGpu?: boolean;
  initialCapital?: number;
  maxPathsToStore?: number;
  ruinThreshold?: number;
}

interface MCResult {
  num_simulations: number;
  method: string;
  confidence_intervals: {
    max_drawdown: Record<string, number>;
    sharpe_ratio: Record<string, number>;
  };
  risk_metrics: Record<string, unknown>;
  paths: number[][];
  execution_time_ms: number;
  gpu_accelerated: boolean;
}

function runPythonMonteCarlo(configPath: string, mcId: string): Promise<MCResult> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const args = [
      "-m", "src.engine.monte_carlo",
      "--config", configPath,
      "--mc-id", mcId,
    ];

    const proc = spawn(pythonCmd, args, {
      env: { ...process.env },
      cwd: PROJECT_ROOT,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      logger.info({ component: "monte-carlo-engine" }, data.toString().trim());
    });

    proc.on("close", (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          reject(new Error(`Failed to parse MC output: ${stdout.slice(0, 500)}`));
        }
      } else {
        reject(new Error(`Monte Carlo failed (exit ${code}): ${stderr}`));
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
            catch { reject(new Error(`Failed to parse: ${stdout2.slice(0, 500)}`)); }
          } else {
            reject(new Error(`Monte Carlo failed: ${stderr2}`));
          }
        });
        proc2.on("error", () => reject(err));
      } else {
        reject(err);
      }
    });
  });
}

export async function runMonteCarlo(backtestId: string, options: MCOptions = {}) {
  // Fetch backtest data (trades, daily_pnls, equity_curve)
  const [bt] = await db
    .select()
    .from(backtests)
    .where(eq(backtests.id, backtestId))
    .limit(1);

  if (!bt) {
    throw new Error(`Backtest ${backtestId} not found`);
  }

  if (bt.status !== "completed") {
    throw new Error(`Backtest ${backtestId} is not completed (status: ${bt.status})`);
  }

  // Insert pending MC row
  const [mcRow] = await db
    .insert(monteCarloRuns)
    .values({
      backtestId,
      numSimulations: options.numSimulations ?? 10_000,
      gpuAccelerated: options.useGpu ?? true,
    })
    .returning();

  const mcId = mcRow.id;

  try {
    // Build config JSON — write to temp file (trade lists can be large)
    const config = {
      backtest_id: backtestId,
      num_simulations: options.numSimulations ?? 10_000,
      method: options.method ?? "both",
      use_gpu: options.useGpu ?? true,
      initial_capital: options.initialCapital ?? 100_000.0,
      max_paths_to_store: options.maxPathsToStore ?? 100,
      ruin_threshold: options.ruinThreshold ?? 0.0,
      trades: bt.dailyPnls ?? [], // Daily P&Ls used as trade proxy if no individual trades
      daily_pnls: bt.dailyPnls ?? [],
      equity_curve: bt.equityCurve ?? [],
    };

    const tmpPath = pathResolve(tmpdir(), `mc-config-${randomUUID()}.json`);
    writeFileSync(tmpPath, JSON.stringify(config));

    let result: MCResult;
    try {
      result = await runPythonMonteCarlo(tmpPath, mcId);
    } finally {
      try { unlinkSync(tmpPath); } catch { /* ignore cleanup errors */ }
    }

    // Update MC row with results
    const ci = result.confidence_intervals;
    await db
      .update(monteCarloRuns)
      .set({
        maxDrawdownP5: ci.max_drawdown?.p5 != null ? String(ci.max_drawdown.p5) : null,
        maxDrawdownP50: ci.max_drawdown?.p50 != null ? String(ci.max_drawdown.p50) : null,
        maxDrawdownP95: ci.max_drawdown?.p95 != null ? String(ci.max_drawdown.p95) : null,
        sharpeP5: ci.sharpe_ratio?.p5 != null ? String(ci.sharpe_ratio.p5) : null,
        sharpeP50: ci.sharpe_ratio?.p50 != null ? String(ci.sharpe_ratio.p50) : null,
        sharpeP95: ci.sharpe_ratio?.p95 != null ? String(ci.sharpe_ratio.p95) : null,
        probabilityOfRuin: result.risk_metrics.probability_of_ruin != null
          ? String(result.risk_metrics.probability_of_ruin)
          : null,
        var95: result.risk_metrics.var_95 != null ? String(result.risk_metrics.var_95) : null,
        var99: result.risk_metrics.var_99 != null ? String(result.risk_metrics.var_99) : null,
        cvar95: result.risk_metrics.cvar_95 != null ? String(result.risk_metrics.cvar_95) : null,
        paths: result.paths,
        riskMetrics: result.risk_metrics,
        executionTimeMs: result.execution_time_ms,
        gpuAccelerated: result.gpu_accelerated,
      })
      .where(eq(monteCarloRuns.id, mcId));

    // Audit log
    await db.insert(auditLog).values({
      action: "mc.run",
      entityType: "monte_carlo",
      entityId: mcId,
      input: { backtestId, ...options },
      result: {
        num_simulations: result.num_simulations,
        probability_of_ruin: result.risk_metrics.probability_of_ruin,
        gpu_accelerated: result.gpu_accelerated,
      },
      status: "success",
      durationMs: result.execution_time_ms,
    });

    return { id: mcId, status: "completed", ...result };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    await db.insert(auditLog).values({
      action: "mc.run",
      entityType: "monte_carlo",
      entityId: mcId,
      input: { backtestId, ...options },
      result: { error: errorMsg },
      status: "failure",
    });

    return { id: mcId, status: "failed", error: errorMsg };
  }
}
