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
import { backtests, backtestTrades, monteCarloRuns, auditLog, strategies, strategyExports } from "../db/schema.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../index.js";
import { runMatrix } from "./matrix-backtest-service.js";
import { runQuantumMC } from "./quantum-mc-service.js";
import { compilePineExport } from "./pine-export-service.js";
import { runPythonModule } from "../lib/python-runner.js";
import { tracer } from "../lib/tracing.js";
import { captureToDLQ } from "../lib/dlq-service.js";
import { notifyCritical } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
// Wave 27.5 Pass A.1 — CRITICAL #1: firm rules version drift detection
import { computeFirmRulesVersion } from "../lib/firm-rules-version.js";

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
  correlationId?: string;
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

  // Fetch backtest data (equity_curve, daily_pnls) + individual trades (separate table)
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

  // Critical #5: query individual trade records (backtest_trades table) and extract pnl.
  // Individual trades give the true bootstrap distribution.  Sending daily_pnls as
  // "trades" collapses 180 trades → 60 daily aggregates, smoothing the distribution
  // and systematically understating drawdowns.
  const rawTrades = await db
    .select({ pnl: backtestTrades.pnl })
    .from(backtestTrades)
    .where(eq(backtestTrades.backtestId, backtestId));

  const tradePnls: number[] = rawTrades
    .map((t) => (t.pnl != null ? Number(t.pnl) : null))
    .filter((v): v is number => v !== null && isFinite(v));

  // Fall back to daily_pnls when trade records are absent or too sparse (< 30).
  // Emit a structured warning event so the operator can see this in SSE.
  const MIN_TRADE_COUNT = 30;
  let tradesForMC: number[];
  let tradesFallbackUsed = false;
  if (tradePnls.length >= MIN_TRADE_COUNT) {
    tradesForMC = tradePnls;
  } else {
    tradesFallbackUsed = true;
    tradesForMC = (bt.dailyPnls as number[] | null) ?? [];
    logger.warn(
      { backtestId, tradeCount: tradePnls.length, minRequired: MIN_TRADE_COUNT },
      "monte_carlo.trades_fallback_used: backtest_trades too sparse — falling back to daily_pnls for MC bootstrap",
    );
    broadcastSSE("monte_carlo.trades_fallback_used", {
      backtestId,
      tradeCount: tradePnls.length,
      minRequired: MIN_TRADE_COUNT,
      message: "MC bootstrap using daily P&L aggregates (trade records absent or < 30). Drawdown estimates may be understated.",
    });
  }

  // Insert pending MC row (use pre-generated ID if provided to avoid race conditions).
  //
  // P1-5 (idempotency): when callers pre-insert a pending row to guarantee the
  // stale-pending sweeper can catch crashes between row-insert and Python call,
  // they pass the pre-insert UUID as `externalId`. We .onConflictDoNothing()
  // and re-fetch the existing row so a second .insert() with the same id is
  // safe and the function reuses the caller's row instead of creating a
  // duplicate. Without externalId the legacy behavior is unchanged.
  let mcId: string;
  if (externalId) {
    const inserted = await db
      .insert(monteCarloRuns)
      .values({
        id: externalId,
        backtestId,
        status: "running",
        numSimulations: options.numSimulations ?? 10_000,
        gpuAccelerated: options.useGpu ?? true,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted.length > 0) {
      mcId = inserted[0].id;
    } else {
      // Row was pre-inserted by the caller — reuse it.
      const [existing] = await db
        .select({ id: monteCarloRuns.id })
        .from(monteCarloRuns)
        .where(eq(monteCarloRuns.id, externalId))
        .limit(1);
      if (!existing) {
        throw new Error(`runMonteCarlo: externalId ${externalId} did not insert and no existing row found`);
      }
      mcId = existing.id;
    }
  } else {
    const [mcRow] = await db
      .insert(monteCarloRuns)
      .values({
        backtestId,
        status: "running",
        numSimulations: options.numSimulations ?? 10_000,
        gpuAccelerated: options.useGpu ?? true,
      })
      .returning();
    mcId = mcRow.id;
  }

  mcSpan.setAttribute("mcId", mcId);

  // F-8 FIX: stamp mc_provisional=true on the backtest row while MC is in-flight.
  // Promotion gates (lifecycle-service.ts) must check this sentinel before reading
  // MC results — a NULL mc_completed_at or mc_provisional=true means MC output is
  // not yet reliable.  We set it to false atomically on MC completion (below).
  // This is additive to resultExtras; existing fields are preserved via JSON merge.
  try {
    const existingExtras = (bt.resultExtras as Record<string, unknown> | null) ?? {};
    await db
      .update(backtests)
      .set({
        resultExtras: { ...existingExtras, mc_provisional: true, mc_completed_at: null },
      })
      .where(eq(backtests.id, backtestId));
  } catch (stampErr) {
    // Non-blocking — log but don't abort the MC run
    logger.warn({ backtestId, err: stampErr }, "F-8: failed to stamp mc_provisional=true on backtest row (non-blocking)");
  }

  try {
    const config = {
      backtest_id: backtestId,
      num_simulations: options.numSimulations ?? 10_000,
      method: options.method ?? "both",
      use_gpu: options.useGpu ?? true,
      initial_capital: options.initialCapital ?? 50_000.0,
      max_paths_to_store: options.maxPathsToStore ?? 100,
      ruin_threshold: options.ruinThreshold ?? 0.0,
      // Critical #5: send individual trade P&Ls (from backtest_trades table) not daily aggregates.
      // Falls back to daily_pnls only when trade records are absent/sparse (< 30).
      trades: tradesForMC,
      trades_fallback_used: tradesFallbackUsed,
      daily_pnls: (bt.dailyPnls as number[] | null) ?? [],
      // Normalize equity_curve: handle both flat number[] and {time,value}[] formats
      equity_curve: Array.isArray(bt.equityCurve)
        ? bt.equityCurve.map((pt: any) => typeof pt === "number" ? pt : pt.value ?? 0)
        : [],
      firms: options.firms ?? [],
      is_oos_trades: options.isOosTrades ?? false,
      run_permutation_test: options.runPermutationTest ?? false,
      permutation_n: options.permutationN ?? 1000,
      n_variants: options.nVariants ?? 1,
      // F-10: pass actual round-trip commission so simulate_firm_survival uses correct delta.
      // commission_per_side is the backtest default (e.g. 0.62 MES); *2 = round-trip.
      backtest_commission_rt: typeof bt.config === "object" && bt.config !== null
        ? ((bt.config as Record<string, unknown>).commission_per_side != null
          ? Number((bt.config as Record<string, unknown>).commission_per_side) * 2
          : 1.24)
        : 1.24,
      // F-12: pass observed avg trades per day so commission delta uses real frequency.
      // totalTrades / totalTradingDays — both fields come from the backtest result.
      avg_trades_per_day: (() => {
        const totalTrades = typeof (bt as any).totalTrades === "number" ? (bt as any).totalTrades : null;
        const totalDays = typeof (bt as any).totalTradingDays === "number" ? (bt as any).totalTradingDays : null;
        if (totalTrades != null && totalDays != null && totalDays > 0) {
          return Math.max(1.0, totalTrades / totalDays);
        }
        return 1.5; // safe fallback (1 A+ trade/day system design)
      })(),
      // Wave 27.5 Pass A.1 — CRITICAL #1: pass stored firm rules version so Python
      // MC can assert no rule drift has occurred between backtest time and MC time.
      backtest_firm_rules_version: (bt as any).firmRulesVersion ?? null,
    };

    // ─── CRITICAL #1: Firm-rule version drift check (TS side, pre-Python) ────
    // We also do this check TS-side so we can write the audit row with full context
    // (correlationId, strategyId, backtestId) before handing off to Python.
    {
      const currentVersion = computeFirmRulesVersion();
      const storedVersion = (bt as any).firmRulesVersion as string | null | undefined;
      if (storedVersion != null && storedVersion !== currentVersion) {
        // Mismatch: firm rules have drifted since the backtest was run.
        // Audit row written here (TS has the full context); Python also writes its own.
        await db.insert(auditLog).values({
          action: "monte_carlo.firm_rule_version_mismatch",
          entityType: "monte_carlo",
          entityId: mcId,
          input: { backtestId, backtestVersion: storedVersion, currentVersion },
          result: {
            status: "rule_version_mismatch",
            backtest_version: storedVersion,
            current_version: currentVersion,
          },
          status: "critical",
          decisionAuthority: "agent",
          correlationId: options.correlationId ?? null,
        });
        logger.error(
          { backtestId, mcId, storedVersion, currentVersion },
          "monte_carlo.firm_rule_version_mismatch: firm rules drifted between backtest and MC — refusing to run",
        );
        // Update MC row to failed state
        await db.update(monteCarloRuns).set({ status: "failed" }).where(eq(monteCarloRuns.id, mcId));
        throw new Error(
          `MC refused: firm rules version mismatch. ` +
          `Backtest was run with rules version '${storedVersion}' ` +
          `but current rules version is '${currentVersion}'. ` +
          `Re-run the backtest to sync firm rules before running MC.`,
        );
      }
      if (storedVersion == null) {
        // Pre-drift-check backtest — warn but allow (backward compat).
        logger.warn(
          { backtestId, currentVersion },
          "monte_carlo: backtest.firm_rules_version is null (pre-W27.5 row) — skipping drift check. Re-run backtest to enable drift detection.",
        );
      }
    }

    const result = await runPythonModule<MCResult>({
      module: "src.engine.monte_carlo",
      args: ["--mc-id", mcId],
      config: config as unknown as Record<string, unknown>,
      timeoutMs: 600_000, // 10m
      componentName: "monte-carlo-engine",
      correlationId: options.correlationId,
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

    // F-8 FIX: clear mc_provisional sentinel now that MC is complete and results are persisted.
    // Promotion gates can now safely read MC output from the monteCarloRuns row.
    try {
      const latestExtras = (bt.resultExtras as Record<string, unknown> | null) ?? {};
      const completedAt = new Date().toISOString();
      await db
        .update(backtests)
        .set({
          resultExtras: { ...latestExtras, mc_provisional: false, mc_completed_at: completedAt },
        })
        .where(eq(backtests.id, backtestId));
    } catch (clearErr) {
      logger.warn({ backtestId, err: clearErr }, "F-8: failed to clear mc_provisional on backtest row (non-blocking)");
    }

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
        // Critical #5: record whether trade-level data was available.
        trades_fallback_used: tradesFallbackUsed,
        trade_count: tradePnls.length,
      },
      status: "success",
      durationMs: result.execution_time_ms,
      decisionAuthority: "agent",
      correlationId: options.correlationId ?? null,
    });

    // ─── Broadcast MC completion SSE ──────────────────────────────
    // deep-scan #8 2026-07-02: prefer firm-breach ci.point_estimate when present;
    // fall back to terminal-negative scalar for legacy runs. Column write is
    // unchanged — all downstream consumers (carter, lifecycle, critic) expect
    // the terminal-negative probability_of_ruin scalar in the DB column.
    {
      type RuinCi = { point_estimate?: number; ruin_basis?: string } | null | undefined;
      const ruinCi = result.risk_metrics.probability_of_ruin_ci as RuinCi;
      const usingCi = ruinCi?.point_estimate != null;
      const ruin = usingCi
        ? Number(ruinCi!.point_estimate)
        : Number(result.risk_metrics.probability_of_ruin ?? 1);
      const ruinBasis = usingCi ? (ruinCi?.ruin_basis ?? "firm_breach") : "terminal_negative_legacy";
      broadcastSSE("mc:completed", {
        backtestId,
        strategyId: bt.strategyId ?? null,
        survivalRate: parseFloat((1 - ruin).toFixed(4)),
        ruin_basis: ruinBasis,
      });
    }

    // ─── Auto Cross Matrix if MC survival is strong (fire-and-forget) ───
    if (bt.strategyId && result.risk_metrics) {
      type RuinCi = { point_estimate?: number } | null | undefined;
      const ruinCi = result.risk_metrics.probability_of_ruin_ci as RuinCi;
      const ruin = ruinCi?.point_estimate != null
        ? Number(ruinCi.point_estimate)
        : Number(result.risk_metrics.probability_of_ruin ?? 1);
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
                    .where(eq(strategyExports.id, pineResult.id ?? ""));
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
      correlationId: options.correlationId ?? null,
    });

    // Capture to DLQ so the failure is not silent
    await captureToDLQ({
      operationType: "monte_carlo:failure",
      entityType: "monte_carlo",
      entityId: mcId,
      errorMessage: errorMsg,
      metadata: {
        backtestId,
        strategyId: bt.strategyId ?? null,
        numSimulations: options.numSimulations ?? 10_000,
        correlationId: options.correlationId ?? null,
      },
    });

    // MC failure blocks the TESTING→PAPER promotion gate (MC survival > 70% required)
    notifyCritical(
      "MC failed — promotion gate blocked",
      appendFamilyGradePostscript(
        `Monte Carlo run ${mcId} failed for strategy ${bt.strategyId ?? "unknown"} (backtest ${backtestId}). ` +
        `The TESTING→PAPER promotion gate is now blocked until MC re-runs successfully. Error: ${errorMsg}`,
        "The bot's risk simulation failed.",
        "No action needed — the bot will retry. Call Tony if this keeps happening.",
      ),
      { mcId, backtestId, strategyId: bt.strategyId ?? null },
    );

    mcSpan.setAttribute("status", "failed");
    mcSpan.end();
    broadcastSSE("mc:failed", { backtestId, error: errorMsg });

    return { id: mcId, status: "failed", error: errorMsg };
  }
}
