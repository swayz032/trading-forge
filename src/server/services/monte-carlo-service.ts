/**
 * Monte Carlo Service — Node↔Python bridge + DB persistence
 *
 * Follows backtest-service.ts pattern exactly:
 * - Platform detection (python vs python3)
 * - Temp file for large JSON payloads (trade lists)
 * - stdout → JSON.parse
 * - stderr → logging
 */

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { backtests, monteCarloRuns, auditLog } from "../db/schema.js";
import { logger } from "../index.js";
import { runMatrix } from "./matrix-backtest-service.js";
import { runQuantumMC } from "./quantum-mc-service.js";
import { compilePineExport } from "./pine-export-service.js";
import { runPythonModule } from "../lib/python-runner.js";

interface MCOptions {
  numSimulations?: number;
  method?: "trade_resample" | "return_bootstrap" | "block_bootstrap" | "both";
  firms?: string[];
  isOosTrades?: boolean;
  useGpu?: boolean;
  initialCapital?: number;
  maxPathsToStore?: number;
  ruinThreshold?: number;
  runPermutationTest?: boolean;
  permutationN?: number;
  nVariants?: number;
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
  permutation_test?: {
    p_value: number;
    has_edge: boolean;
    bonferroni_threshold?: number;
    bonferroni_passes?: boolean;
  };
  deflated_sharpe?: {
    dsr: number;
    p_value: number;
    passes: boolean;
    sr_expected_max: number;
    interpretation: string;
  };
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
    const config = {
      backtest_id: backtestId,
      num_simulations: options.numSimulations ?? 10_000,
      method: options.method ?? "both",
      use_gpu: options.useGpu ?? true,
      initial_capital: options.initialCapital ?? 50_000.0,
      max_paths_to_store: options.maxPathsToStore ?? 100,
      ruin_threshold: options.ruinThreshold ?? 0.0,
      trades: bt.dailyPnls ?? [], // Daily P&Ls used as trade proxy if no individual trades
      daily_pnls: bt.dailyPnls ?? [],
      // Normalize equity_curve: handle both flat number[] and {time,value}[] formats
      equity_curve: Array.isArray(bt.equityCurve)
        ? bt.equityCurve.map((pt: any) => typeof pt === "number" ? pt : pt.value ?? 0)
        : [],
      firms: options.firms ?? [],
      is_oos_trades: options.isOosTrades ?? false,
      run_permutation_test: options.runPermutationTest ?? false,
      permutation_n: options.permutationN ?? 1000,
      n_variants: options.nVariants ?? 1,
    };

    const result = await runPythonModule<MCResult>({
      module: "src.engine.monte_carlo",
      args: ["--mc-id", mcId],
      config: config as unknown as Record<string, unknown>,
      timeoutMs: 600_000, // 10m
      componentName: "monte-carlo-engine",
    });

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

    // ─── Auto Cross Matrix if MC survival is strong (fire-and-forget) ───
    if (bt.strategyId && result.risk_metrics) {
      const ruin = Number(result.risk_metrics.probability_of_ruin ?? 1);
      const survivalRate = 1 - ruin;
      if (survivalRate > 0.8) {
        runMatrix(bt.strategyId).then((matrixResult) => {
          logger.info(
            { strategyId: bt.strategyId, matrixId: matrixResult.id, status: matrixResult.status },
            "Auto matrix completed after MC survival > 80%",
          );
        }).catch((matrixErr) => {
          logger.error({ strategyId: bt.strategyId, err: matrixErr }, "Auto matrix failed (non-blocking)");
        });
      }

      // ─── Auto Quantum Challenger (fire-and-forget) ───
      // Run quantum breach estimation as experimental challenger alongside classical MC
      if (result.risk_metrics && result.risk_metrics.probability_of_ruin != null) {
        runQuantumMC(backtestId, "breach", "topstep_50k").then((qmcResult) => {
          logger.info(
            { backtestId, qmcId: qmcResult.id, status: qmcResult.status },
            "Auto quantum challenger completed",
          );
        }).catch((qmcErr) => {
          logger.error({ backtestId, err: qmcErr }, "Auto quantum challenger failed (non-blocking)");
        });
      }

      // ─── Auto Pine Export for deployment-ready strategies (fire-and-forget) ───
      if (bt.strategyId && survivalRate > 0.8) {
        compilePineExport(bt.strategyId, "topstep_50k").then((pineResult) => {
          const score = pineResult.exportabilityScore ?? 0;
          if (pineResult.status === "completed" && score >= 70) {
            logger.info(
              { strategyId: bt.strategyId, exportId: pineResult.id, score },
              "Auto Pine export compiled (score >= 70)",
            );
          } else {
            logger.info(
              { strategyId: bt.strategyId, exportId: pineResult.id, score, status: pineResult.status },
              "Auto Pine export attempted (below threshold or failed)",
            );
          }
        }).catch((pineErr) => {
          logger.error({ strategyId: bt.strategyId, err: pineErr }, "Auto Pine export failed (non-blocking)");
        });
      }
    }

    return { id: mcId, status: "completed", ...result };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Mark the MC row as failed so it doesn't stay in pending state
    await db
      .update(monteCarloRuns)
      .set({ riskMetrics: { error: errorMsg } })
      .where(eq(monteCarloRuns.id, mcId));

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
