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
import { backtests, monteCarloRuns, auditLog, strategies, strategyExports } from "../db/schema.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../index.js";
import { runMatrix } from "./matrix-backtest-service.js";
import { runQuantumMC } from "./quantum-mc-service.js";
import { compilePineExport } from "./pine-export-service.js";
import { runPythonModule } from "../lib/python-runner.js";
import { tracer } from "../lib/tracing.js";

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

export async function runMonteCarlo(backtestId: string, options: MCOptions = {}, externalId?: string) {
  const mcSpan = tracer.startSpan("monte_carlo.run");
  mcSpan.setAttribute("backtestId", backtestId);
  mcSpan.setAttribute("numSimulations", options.numSimulations ?? 10_000);

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

  // Insert pending MC row (use pre-generated ID if provided to avoid race conditions)
  const [mcRow] = await db
    .insert(monteCarloRuns)
    .values({
      ...(externalId ? { id: externalId } : {}),
      backtestId,
      status: "running",
      numSimulations: options.numSimulations ?? 10_000,
      gpuAccelerated: options.useGpu ?? true,
    })
    .returning();

  const mcId = mcRow.id;
  mcSpan.setAttribute("mcId", mcId);

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
        status: "completed",
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
      decisionAuthority: "agent",
    });

    // ─── Broadcast MC completion SSE ──────────────────────────────
    {
      const ruin = Number(result.risk_metrics.probability_of_ruin ?? 1);
      broadcastSSE("mc:completed", {
        backtestId,
        strategyId: bt.strategyId ?? null,
        survivalRate: parseFloat((1 - ruin).toFixed(4)),
      });
    }

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
      // Only auto-export for PAPER or DEPLOY_READY strategies — avoid wasting compute on CANDIDATE/TESTING
      if (bt.strategyId && survivalRate > 0.8) {
        const [strat] = await db
          .select({ lifecycleState: strategies.lifecycleState, config: strategies.config })
          .from(strategies).where(eq(strategies.id, bt.strategyId)).limit(1);
        if (strat && ["PAPER", "DEPLOY_READY"].includes(strat.lifecycleState)) {
          // ── Fix 2.10: Resolve firm key from backtest propCompliance, then strategy config, then fallback ──
          // propCompliance shape expected: { firms: { <firm_key>: { passes: boolean, score?: number }, ... } }
          let resolvedFirmKey = "topstep_50k"; // safe fallback
          try {
            const propCompliance = bt.propCompliance as Record<string, unknown> | null;
            const firmsMap = propCompliance?.firms as Record<string, { passes?: boolean; score?: number }> | undefined;
            if (firmsMap && typeof firmsMap === "object" && Object.keys(firmsMap).length > 0) {
              // Pick the passing firm with the highest score; if scores are absent, take the first passer
              const passingFirms = Object.entries(firmsMap)
                .filter(([, v]) => v?.passes === true)
                .sort(([, a], [, b]) => (b?.score ?? 0) - (a?.score ?? 0));
              if (passingFirms.length > 0) {
                resolvedFirmKey = passingFirms[0][0];
                logger.info(
                  { strategyId: bt.strategyId, firmKey: resolvedFirmKey, source: "propCompliance" },
                  "Auto Pine export: resolved firm key from propCompliance",
                );
              }
            } else {
              // propCompliance has no firms map — check strategy config for an explicit firm preference
              const stratConfig = strat.config as Record<string, unknown> | null;
              const configFirm = stratConfig?.firm_key ?? stratConfig?.preferred_firm ?? stratConfig?.prop_firm;
              if (typeof configFirm === "string" && configFirm.length > 0) {
                resolvedFirmKey = configFirm;
                logger.info(
                  { strategyId: bt.strategyId, firmKey: resolvedFirmKey, source: "strategy.config" },
                  "Auto Pine export: resolved firm key from strategy config",
                );
              } else {
                logger.info(
                  { strategyId: bt.strategyId, firmKey: resolvedFirmKey, source: "fallback" },
                  "Auto Pine export: no firm key in propCompliance or strategy config, using fallback topstep_50k",
                );
              }
            }
          } catch (firmErr) {
            logger.warn(
              { strategyId: bt.strategyId, err: firmErr },
              "Auto Pine export: firm key resolution threw, using fallback topstep_50k",
            );
          }

          // Pass MC risk metrics directly — avoids a redundant DB round-trip inside compilePineExport
          const autoRiskIntelligence = {
            breach_probability: result.risk_metrics.breach_probability != null
              ? Number(result.risk_metrics.breach_probability) : null,
            ruin_probability: ruin,
            survival_rate: survivalRate,
            mc_sharpe_p50: result.confidence_intervals.sharpe_ratio?.p50 != null
              ? Number(result.confidence_intervals.sharpe_ratio.p50) : null,
            quantum_estimate: null, // quantum result not yet available at this trigger point
          };

          // ── Fix 2.11: Auto-select exportType by score band ──
          // Compile with pine_indicator as the default mode. After compile returns, check the
          // exportability score and patch the persisted exportType to alert_only for the 50-69
          // band. No re-compile is needed — the Pine content itself is the same; only the stored
          // export type and downstream consumer semantics change. Scores < 50 are blocked by the
          // compiler (status: failed) so no further action is required in that case.
          compilePineExport(bt.strategyId, resolvedFirmKey, "pine_indicator", autoRiskIntelligence).then(async (pineResult) => {
            const score = pineResult.exportabilityScore ?? 0;
            if (pineResult.status === "completed") {
              let effectiveExportType = "pine_indicator";
              if (score >= 50 && score < 70) {
                // Downgrade to alert_only for the 50-69 score band
                effectiveExportType = "alert_only";
                try {
                  await db.update(strategyExports)
                    .set({ exportType: "alert_only" })
                    .where(eq(strategyExports.id, pineResult.id));
                } catch (patchErr) {
                  logger.warn(
                    { exportId: pineResult.id, err: patchErr },
                    "Auto Pine export: failed to patch exportType to alert_only (non-blocking)",
                  );
                }
              }
              logger.info(
                {
                  strategyId: bt.strategyId,
                  exportId: pineResult.id,
                  score,
                  exportType: effectiveExportType,
                  firmKey: resolvedFirmKey,
                },
                score >= 70
                  ? "Auto Pine export compiled (score >= 70, pine_indicator)"
                  : "Auto Pine export compiled (score 50-69, downgraded to alert_only)",
              );
            } else {
              logger.info(
                {
                  strategyId: bt.strategyId,
                  exportId: pineResult.id,
                  score,
                  status: pineResult.status,
                  firmKey: resolvedFirmKey,
                },
                "Auto Pine export attempted (below threshold or failed)",
              );
            }
          }).catch((pineErr) => {
            logger.error({ strategyId: bt.strategyId, err: pineErr }, "Auto Pine export failed (non-blocking)");
          });
        } // end lifecycle guard
      }
    }

    mcSpan.setAttribute("status", "completed");
    mcSpan.end();
    return { id: mcId, status: "completed", ...result };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Mark the MC row as failed so it doesn't stay in running state
    await db
      .update(monteCarloRuns)
      .set({ status: "failed", riskMetrics: { error: errorMsg } })
      .where(eq(monteCarloRuns.id, mcId));

    await db.insert(auditLog).values({
      action: "mc.run",
      entityType: "monte_carlo",
      entityId: mcId,
      input: { backtestId, ...options },
      result: { error: errorMsg },
      status: "failure",
      decisionAuthority: "agent",
      errorMessage: errorMsg,
    });

    mcSpan.setAttribute("status", "failed");
    mcSpan.end();
    broadcastSSE("mc:failed", { backtestId, error: errorMsg });

    return { id: mcId, status: "failed", error: errorMsg };
  }
}
