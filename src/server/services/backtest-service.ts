/**
 * Backtest Service — Node↔Python bridge + DB persistence
 *
 * Follows the databento.ts subprocess spawn pattern:
 * - Platform detection (python vs python3)
 * - stdout → JSON.parse
 * - stderr → logging
 */

import { eq, and, sql } from "drizzle-orm";
import { backtests, backtestTrades, stressTestRuns, strategies, paperSessions, auditLog, walkForwardWindows, strategyNames, sqaOptimizationRuns, quboTimingRuns, tensorPredictions, rlTrainingRuns } from "../db/schema.js";
import { broadcastSSE } from "../routes/sse.js";
import { startStream } from "./paper-trading-stream.js";
import { runMonteCarlo } from "./monte-carlo-service.js";
import { runQuantumMC } from "./quantum-mc-service.js";
import { queryInfo } from "../../data/loaders/duckdb-service.js";
import { getFirmLimit } from "../../shared/firm-config.js";
import { WFWindowMetricsSchema } from "../../shared/walk-forward-schema.js";
import { logger } from "../index.js";
import { runPythonModule } from "../lib/python-runner.js";
import { CircuitBreakerRegistry } from "../lib/circuit-breaker.js";
import { db } from "../db/index.js";
import { tracer } from "../lib/tracing.js";

/** Convert decay_analysis from Python snake_case to frontend camelCase. */
function normalizeDecayAnalysis(raw: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  return {
    halfLifeDays: raw.half_life_days ?? null,
    decayDetected: raw.decay_detected ?? false,
    trend: raw.trend === "accelerating_decline" ? "declining" : (raw.trend ?? "stable"),
    compositeScore: raw.composite_score ?? 0,
    decaying: raw.decaying ?? false,
    signals: raw.signals ?? {},
  };
}

interface BacktestConfig {
  strategy: {
    name: string;
    symbol: string;
    timeframe: string;
    indicators: Array<{ type: string; period: number; [key: string]: unknown }>;
    entry_long: string;
    entry_short: string;
    exit: string;
    stop_loss: { type: string; multiplier: number };
    position_size: { type: string; target_risk_dollars?: number; fixed_contracts?: number };
  };
  start_date?: string;
  end_date?: string;
  slippage_ticks?: number;
  commission_per_side?: number;
  mode?: "single" | "walkforward";
  walk_forward_splits?: number;
  embargo_bars?: number;  // Bars to skip between IS/OOS windows (prevents data leakage)
  max_trades_per_day?: number;
  firm_key?: string;
  fill_model?: {
    order_type: string;
    limit_at_current?: number;
    limit_1_tick?: number;
    limit_at_sr?: number;
    limit_at_extreme?: number;
    partial_fill_threshold?: number;
    latency_ms?: number;
  };
  event_calendar?: {
    policies: Array<{ event_type: string; action: string; window_minutes: number }>;
    calendar_source: string;
  };
  optimizer?: "optuna" | "sqa";
  refinement_stage?: number;  // 1=param refinement, 2=logic variant, 3=concept pivot
  refinement_iteration?: number;  // 0-8 iteration counter
  suppressAutoPromote?: boolean;  // When true, skip auto-promote (e.g. critic replay backtests)
}

/**
 * Resolve date range from S3 data when dates are omitted.
 * Uses DuckDB queryInfo() to find min/max timestamps for a symbol.
 */
async function resolveDataRange(symbol: string): Promise<{ start_date: string; end_date: string }> {
  try {
    const info = await queryInfo(symbol);
    // queryInfo returns JS Date strings like "Sun Aug 02 2015 18:00:00 GMT-0400..."
    // Parse to Date, then format as YYYY-MM-DD
    const startDt = new Date(info.earliest);
    const endDt = new Date(info.latest);
    const start = startDt.toISOString().slice(0, 10);
    const end = endDt.toISOString().slice(0, 10);
    logger.info({ symbol, start, end, totalBars: info.totalBars }, "Auto-resolved data range from S3");
    return { start_date: start, end_date: end };
  } catch (err) {
    logger.warn({ symbol, err }, "Failed to resolve data range from S3, using fallback");
    return { start_date: "2010-01-01", end_date: "2030-12-31" };
  }
}

interface BacktestResult {
  total_return: number;
  sharpe_ratio: number;
  max_drawdown: number;
  win_rate: number;
  profit_factor: number;
  total_trades: number;
  avg_trade_pnl: number;
  avg_daily_pnl: number;
  winning_days: number;
  total_trading_days: number;
  max_consecutive_losing_days: number;
  expectancy_per_trade: number;
  avg_winner_to_loser_ratio: number;
  equity_curve: Array<{ time: string; value: number }>;
  monthly_returns?: Array<{ year: number; month: number; pnl: number }>;
  trades: Array<Record<string, unknown>>;
  daily_pnls: number[];
  execution_time_ms: number;
  tier?: string;
  forge_score?: number;
  walk_forward_results?: Record<string, unknown>;
  prop_compliance?: Record<string, unknown>;
  crisis_results?: Record<string, unknown>;
  decay_analysis?: Record<string, unknown>;
  run_receipt?: Record<string, unknown>;
  sanity_checks?: Record<string, unknown>;
  cross_validation?: Record<string, unknown>;
  gate_result?: Record<string, unknown>;
  gate_rejections?: Record<string, unknown>;
  daily_pnl_records?: Array<{ date: string; pnl: number }>;
  oos_metrics?: Record<string, unknown>;
  confidence?: string;
  windows?: Array<Record<string, unknown>>;
  n_splits?: number;
  param_stability?: Record<string, unknown>;
  error?: string;
}

interface SqaOptimizationResult {
  best_params?: Record<string, unknown>;
  best_energy?: number | string;
  robust_plateau?: Record<string, unknown>;
  all_solutions?: unknown[];
  execution_time_ms?: number;
}

interface QuboTimingResult {
  schedule?: unknown[];
  expected_return?: number | string;
  cost_savings?: number | string;
  backtest_improvement?: number | string;
}

interface TensorSignalResult {
  model_hash?: string;
  probability?: number | string;
  confidence?: number | string;
  signal?: string;
  features?: Record<string, unknown>;
  regime?: string | null;
  fragility_score?: number | string;
  regime_breakdown?: Record<string, unknown>;
}

interface RlTrainingResult {
  total_return?: number | string;
  sharpe_ratio?: number | string;
  win_rate?: number | string | null;
  total_trades?: number | null;
  n_episodes?: number | null;
  execution_time_ms?: number | null;
  policy_weights?: Record<string, unknown> | null;
  comparison_result?: Record<string, unknown> | null;
}

// 10 minutes max per backtest — prevents matrix from hanging on slow strategies
const BACKTEST_TIMEOUT_MS = 10 * 60 * 1000;

export async function runBacktest(strategyId: string, config: BacktestConfig, strategyClass?: string, externalId?: string) {
  const backtestSpan = tracer.startSpan("backtest.run");
  backtestSpan.setAttribute("strategyId", strategyId);
  backtestSpan.setAttribute("symbol", config.strategy.symbol);
  backtestSpan.setAttribute("mode", config.mode ?? "single");

  // Auto-resolve dates from S3 when omitted
  if (!config.start_date || !config.end_date) {
    const resolved = await resolveDataRange(config.strategy.symbol);
    if (!config.start_date) config.start_date = resolved.start_date;
    if (!config.end_date) config.end_date = resolved.end_date;
  }

  // Insert pending row (use pre-generated ID if provided to avoid race conditions)
  const [row] = await db
    .insert(backtests)
    .values({
      ...(externalId ? { id: externalId } : {}),
      strategyId,
      symbol: config.strategy.symbol,
      timeframe: config.strategy.timeframe,
      startDate: new Date(config.start_date),
      endDate: new Date(config.end_date),
      status: "pending",
      config: config as unknown as Record<string, unknown>,
    })
    .returning();

  const backtestId = row.id;
  backtestSpan.setAttribute("backtestId", backtestId);

  // Update to running
  await db
    .update(backtests)
    .set({ status: "running" })
    .where(eq(backtests.id, backtestId));

  try {
    const mode = config.mode ?? "single";
    const result = await CircuitBreakerRegistry.get("python-backtest").call(() =>
      runPythonModule<BacktestResult>({
        module: "src.engine.backtester",
        args: [
          "--backtest-id", backtestId,
          "--mode", mode,
          ...(strategyClass ? ["--strategy-class", strategyClass] : []),
        ],
        config: config as unknown as Record<string, unknown>,
        timeoutMs: BACKTEST_TIMEOUT_MS,
        componentName: "backtest-engine",
      }),
    );

    if (result.error) {
      await db
        .update(backtests)
        .set({
          status: "failed",
          errorMessage: result.error,
          executionTimeMs: result.execution_time_ms,
        })
        .where(eq(backtests.id, backtestId));

      backtestSpan.setAttribute("status", "failed");
      backtestSpan.setAttribute("errorFromPython", true);
      backtestSpan.end();
      broadcastSSE("backtest:failed", { backtestId, strategyId, error: result.error });
      return { id: backtestId, status: "failed", error: result.error };
    }

    // Walk-forward returns metrics nested under oos_metrics — unwrap for DB storage
    const metrics = result.oos_metrics ?? result;
    // Store full walk-forward structure (windows, confidence, param_stability) separately
    const wfResults: { confidence?: string; windows?: Array<Record<string, unknown>>; n_splits?: number; param_stability?: Record<string, unknown> } | null = result.oos_metrics
      ? { confidence: result.confidence, windows: result.windows as Array<Record<string, unknown>>, n_splits: result.n_splits, param_stability: result.param_stability }
      : (result.walk_forward_results as { confidence?: string; windows?: Array<Record<string, unknown>>; n_splits?: number; param_stability?: Record<string, unknown> } ?? null);

    // ─── Pre-compute trade rows (pure computation — outside the transaction) ───
    const trades = result.trades ?? [];
    const tradeRows = trades.map((t) => {
      // vectorbt records_readable columns:
      //   "Entry Timestamp" (int index or ISO string), "Exit Timestamp",
      //   "Avg Entry Price", "Avg Exit Price", "PnL", "Direction", "Size"
      const entryTs = t["Entry Timestamp"] ?? t["entry_time"];
      const exitTs = t["Exit Timestamp"] ?? t["exit_time"];

      // Entry/exit timestamps may be integer indices or ISO date strings
      const parseTs = (v: unknown): Date => {
        if (v == null) return new Date();
        if (typeof v === "string" && v.includes("-")) return new Date(v);
        // Integer index from vectorbt — use backtest start date + offset
        return config.start_date ? new Date(config.start_date + "T00:00:00Z") : new Date();
      };

      const direction = (t["Direction"] as string ?? t["direction"] as string ?? "long");

      return {
        backtestId,
        entryTime: parseTs(entryTs),
        exitTime: exitTs != null ? parseTs(exitTs) : null,
        direction: direction.toLowerCase().includes("short") ? "short" : "long",
        entryPrice: String(t["Avg Entry Price"] ?? t["Entry Price"] ?? t["entry_price"] ?? 0),
        exitPrice: t["Avg Exit Price"] != null || t["Exit Price"] != null || t["exit_price"] != null
          ? String(t["Avg Exit Price"] ?? t["Exit Price"] ?? t["exit_price"])
          : null,
        pnl: t["PnL"] != null || t["pnl"] != null
          ? String(t["PnL"] ?? t["pnl"])
          : null,
        netPnl: t["PnL"] != null || t["pnl"] != null
          ? String(t["PnL"] ?? t["pnl"])
          : null,
        grossPnl: t["GrossPnL"] != null || t["gross_pnl"] != null
          ? String(t["GrossPnL"] ?? t["gross_pnl"])
          : null,
        slippage: t["SlippageCost"] != null || t["slippage_cost"] != null
          ? String(t["SlippageCost"] ?? t["slippage_cost"])
          : null,
        commission: t["CommissionCost"] != null || t["commission_cost"] != null
          ? String(t["CommissionCost"] ?? t["commission_cost"])
          : null,
        contracts: Math.round(Number(t["Size"] ?? t["size"] ?? 1)),
        mae: t["MAE"] != null || t["mae"] != null
          ? String(t["MAE"] ?? t["mae"])
          : null,
        mfe: t["MFE"] != null || t["mfe"] != null
          ? String(t["MFE"] ?? t["mfe"])
          : null,
      };
    });

    // ─── Transactional completion writes ─────────────────────────────────────
    // All core persistence for a completed backtest runs in one transaction.
    // If the process crashes mid-write, the backtest row stays in "running"
    // and the incomplete partial writes are rolled back — no inconsistent state.
    await db.transaction(async (tx) => {
      // 1. Update backtest row with full results
      await tx
        .update(backtests)
        .set({
          status: "completed",
          totalReturn: metrics.total_return != null ? String(metrics.total_return) : null,
          sharpeRatio: metrics.sharpe_ratio != null ? String(metrics.sharpe_ratio) : null,
          maxDrawdown: metrics.max_drawdown != null ? String(metrics.max_drawdown) : null,
          winRate: metrics.win_rate != null ? String(metrics.win_rate) : null,
          profitFactor: metrics.profit_factor != null ? String(metrics.profit_factor) : null,
          totalTrades: (metrics.total_trades as number) ?? null,
          avgTradePnl: metrics.avg_trade_pnl != null ? String(metrics.avg_trade_pnl) : null,
          avgDailyPnl: metrics.avg_daily_pnl != null ? String(metrics.avg_daily_pnl) : null,
          tier: result.tier ?? null,
          forgeScore: result.forge_score != null ? String(result.forge_score) : null,
          equityCurve: result.equity_curve ?? metrics.equity_curve ?? null,
          monthlyReturns: result.monthly_returns ?? null,
          dailyPnls: result.daily_pnls ?? metrics.daily_pnls ?? null,
          walkForwardResults: wfResults,
          propCompliance: result.prop_compliance ?? null,
          decayAnalysis: normalizeDecayAnalysis(result.decay_analysis as Record<string, unknown> | undefined),
          runReceipt: result.run_receipt ?? null,
          sanityChecks: result.sanity_checks ?? null,
          crossValidation: result.cross_validation ?? null,
          gateResult: result.gate_result ?? null,
          gateRejections: result.gate_rejections ?? null,
          executionTimeMs: result.execution_time_ms,
        })
        .where(eq(backtests.id, backtestId));

      // 2. Persist walk-forward windows for queryability
      if (wfResults?.windows?.length) {
        // Aggregate param_stability from the top-level result — applies to all windows equally
        const aggregateParamStability = wfResults.param_stability ?? null;
        await tx.insert(walkForwardWindows).values(
          wfResults.windows.map((w: any, idx: number) => {
            // Validate per-window OOS metrics against canonical schema before persisting.
            // A parse failure is a non-fatal warning — the window still inserts with
            // whatever the engine returned. This protects downstream consumers from
            // silently receiving partial metrics without crashing the backtest run.
            const metricsParseResult = WFWindowMetricsSchema.safeParse(w.oos_metrics);
            if (!metricsParseResult.success) {
              logger.warn(
                {
                  backtestId,
                  windowIndex: w.window ?? idx + 1,
                  issues: metricsParseResult.error.issues,
                  rawMetrics: w.oos_metrics,
                },
                "WFWindowMetrics schema mismatch — engine output missing expected fields",
              );
            }

            // IS metrics: the optimizer's IS Sharpe is the only per-window IS performance metric.
            // If optimization ran, surface it; otherwise null.
            const isMetrics = w.optimization
              ? {
                  sharpe_ratio: w.optimization.best_sharpe ?? null,
                  best_params: w.optimization.best_params ?? null,
                  trials_used: w.optimization.trials_used ?? null,
                }
              : null;

            return {
              backtestId: backtestId,
              windowIndex: w.window ?? idx + 1,
              isStart: w.is_start ?? null,
              isEnd: w.is_end ?? null,
              oosStart: w.oos_start ?? null,
              oosEnd: w.oos_end ?? null,
              bestParams: w.optimization?.best_params ?? null,
              isMetrics,
              oosMetrics: w.oos_metrics ?? null,
              paramStability: aggregateParamStability,
              confidence: w.confidence ?? null,
            };
          })
        );
      }

      // 3. Track search budget (cumulative Optuna trials)
      if (wfResults?.windows?.length) {
        const totalTrials = wfResults.windows.reduce(
          (sum: number, w: Record<string, unknown>) => {
            const opt = w.optimization as Record<string, unknown> | undefined;
            return sum + (Number(opt?.trials_used ?? opt?.n_trials ?? 0));
          },
          0,
        );
        if (totalTrials > 0) {
          await tx
            .update(strategies)
            .set({
              searchBudgetUsed: sql`COALESCE(${strategies.searchBudgetUsed}, 0) + ${totalTrials}`,
            })
            .where(eq(strategies.id, strategyId));
        }
      }

      // 4. Bulk insert trades
      if (tradeRows.length > 0) {
        await tx.insert(backtestTrades).values(tradeRows);
      }

      // 5. Persist crisis/stress test results
      if (result.crisis_results && typeof result.crisis_results === "object") {
        const cr = result.crisis_results as Record<string, unknown>;
        await tx.insert(stressTestRuns).values({
          backtestId,
          passed: cr.passed === true,
          scenarios: cr.scenarios ?? [],
          failedScenarios: cr.failed_scenarios ?? [],
          executionTimeMs: typeof cr.execution_time_ms === "number" ? cr.execution_time_ms : null,
        });
      }

      // 6. Audit log — written inside the transaction so it only exists if everything committed
      await tx.insert(auditLog).values({
        action: "backtest.run",
        entityType: "backtest",
        entityId: backtestId,
        input: config as unknown as Record<string, unknown>,
        result: {
          total_return: result.total_return,
          sharpe_ratio: result.sharpe_ratio,
          total_trades: result.total_trades,
          tier: result.tier,
        },
        status: "success",
        durationMs: result.execution_time_ms,
      });
    });

    // ─── Broadcast completion SSE ─────────────────────────────────
    broadcastSSE("backtest:completed", {
      backtestId,
      strategyId,
      tier: result.tier ?? null,
      forgeScore: result.forge_score ?? null,
    });

    // ─── Optional SQA parameter optimization (fire-and-forget) ───
    // Fires for ALL qualifying backtests (non-REJECTED with walk-forward results),
    // not just those explicitly requesting the SQA optimizer.
    if (result.tier && result.tier !== "REJECTED" && wfResults && config.strategy?.indicators?.length) {
      (async () => {
        try {
          // Build param ranges from strategy indicator parameters
          const paramRanges: Array<{ name: string; min_val: number; max_val: number; n_bits: number }> = [];
          for (const ind of config.strategy.indicators) {
            if (ind.period) {
              paramRanges.push({
                name: `${ind.type}_period`,
                min_val: Math.max(1, Math.round(ind.period * 0.5)),
                max_val: Math.round(ind.period * 2.0),
                n_bits: 4,
              });
            }
          }
          if (config.strategy.stop_loss?.multiplier) {
            paramRanges.push({
              name: "stop_loss_multiplier",
              min_val: config.strategy.stop_loss.multiplier * 0.5,
              max_val: config.strategy.stop_loss.multiplier * 2.0,
              n_bits: 4,
            });
          }

          if (paramRanges.length === 0) return;

          const sqaConfig = {
            param_ranges: paramRanges,
            num_reads: 100,
            num_sweeps: 1000,
            objective: "maximize_sharpe",
          };

          // Insert running row before Python call so status is visible during execution
          const [sqaRow] = await db.insert(sqaOptimizationRuns).values({
            backtestId,
            strategyId,
            status: "running",
            paramRanges: paramRanges as any,
            bestParams: {},
            bestEnergy: "0",
            robustPlateau: {},
            allSolutions: [],
            numReads: sqaConfig.num_reads,
            numSweeps: sqaConfig.num_sweeps,
            executionTimeMs: 0,
            governanceLabels: { experimental: false, authoritative: true, decision_role: "pre_deploy_autonomous" },
          }).returning();

          const sqaResult = await runPythonModule<SqaOptimizationResult>({
            module: "src.engine.quantum_annealing_optimizer",
            config: sqaConfig,
            componentName: "sqa-optimizer",
          });

          // Store SQA results on the backtest record.
          // Fresh DB read before merge — avoids clobbering concurrent writes to
          // walkForwardResults that may have occurred since backtest completion.
          const [freshBacktest] = await db
            .select({ walkForwardResults: backtests.walkForwardResults })
            .from(backtests)
            .where(eq(backtests.id, backtestId));
          const freshWfr = (freshBacktest?.walkForwardResults ?? {}) as Record<string, unknown>;

          await db.update(backtests).set({
            walkForwardResults: {
              ...freshWfr,
              sqa_optimization: {
                best_params: sqaResult.best_params,
                best_energy: sqaResult.best_energy,
                robust_plateau: sqaResult.robust_plateau,
                method: "sqa",
                governance: { experimental: false, authoritative: true, decision_role: "pre_deploy_autonomous" },
              },
            },
          }).where(eq(backtests.id, backtestId));

          // Update first-class sqa_optimization_runs row with results
          await db.update(sqaOptimizationRuns).set({
            status: "completed",
            bestParams: sqaResult.best_params ?? {},
            bestEnergy: String(sqaResult.best_energy ?? 0),
            robustPlateau: sqaResult.robust_plateau ?? {},
            allSolutions: sqaResult.all_solutions ?? [],
            executionTimeMs: sqaResult.execution_time_ms ?? 0,
          }).where(eq(sqaOptimizationRuns.id, sqaRow.id));

          logger.info({ backtestId, bestParams: sqaResult.best_params }, "SQA optimization completed");
        } catch (sqaErr) {
          logger.error({ backtestId, err: sqaErr }, "SQA optimization failed (non-blocking)");
          // Mark any running SQA rows for this backtest as failed
          await db.update(sqaOptimizationRuns).set({ status: "failed" })
            .where(and(eq(sqaOptimizationRuns.backtestId, backtestId), eq(sqaOptimizationRuns.status, "running")));
        }
      })();
    }

    // ─── Auto Monte Carlo for all completed backtests (fire-and-forget) ───
    // MC data is needed to evaluate ANY strategy properly — don't gate behind tier
    if (result.daily_pnls?.length > 0) {
      runMonteCarlo(backtestId, {
        numSimulations: 50_000,
        method: "both",
        firms: ["topstep_50k", "mffu_50k", "tpt_50k", "apex_50k", "ffn_50k", "alpha_50k", "tradeify_50k", "earn2trade_50k"],
      }).then((mcResult) => {
        logger.info({ backtestId, mcId: mcResult.id, status: mcResult.status }, "Auto MC completed");
      }).catch((mcErr) => {
        logger.error({ backtestId, err: mcErr }, "Auto MC failed (non-blocking)");
      });
    }

    // ─── Auto QUBO timing optimization (fire-and-forget) ───
    if (result.daily_pnls?.length > 0 && result.tier && result.tier !== "REJECTED") {
      (async () => {
        // Insert running row before Python call
        const [quboRow] = await db.insert(quboTimingRuns).values({
          backtestId,
          strategyId,
          status: "running",
          sessionType: "rth",
          windowSize: 30,
          schedule: [],
          expectedReturn: "0",
          costSavings: "0",
          backtestImprovement: "0",
          governanceLabels: { experimental: false, authoritative: true, decision_role: "pre_deploy_autonomous" },
        }).returning();

        try {
          const quboConfig = {
            historical_returns: result.daily_pnls,
            session_type: "rth",
            window_size: 30,
            num_reads: 100,
          };

          const quboResult = await runPythonModule<QuboTimingResult>({
            module: "src.engine.qubo_trade_timing",
            config: quboConfig,
            componentName: "qubo-timing",
          });

          await db.update(quboTimingRuns).set({
            status: "completed",
            schedule: quboResult.schedule ?? [],
            expectedReturn: String(quboResult.expected_return ?? 0),
            costSavings: String(quboResult.cost_savings ?? 0),
            backtestImprovement: String(quboResult.backtest_improvement ?? 0),
          }).where(eq(quboTimingRuns.id, quboRow.id));

          logger.info({ backtestId }, "Auto QUBO timing completed");
        } catch (quboErr) {
          logger.error({ backtestId, err: quboErr }, "Auto QUBO timing failed (non-blocking)");
          await db.update(quboTimingRuns).set({ status: "failed" }).where(eq(quboTimingRuns.id, quboRow.id));
        }
      })();
    }

    // ─── Auto tensor signal evaluation (fire-and-forget) ───
    if (result.daily_pnls?.length > 0 && result.tier && result.tier !== "REJECTED") {
      (async () => {
        // Insert running row before Python call
        const [tensorRow] = await db.insert(tensorPredictions).values({
          backtestId,
          strategyId,
          status: "running",
          modelVersion: "pending",
          probability: "0",
          confidence: "0",
          signal: "neutral",
          featureSnapshot: {},
          regimeAtPrediction: null,
          fragilityScore: "0",
          regimeBreakdown: {},
          governanceLabels: { experimental: false, authoritative: true, decision_role: "pre_deploy_autonomous" },
        }).returning();

        try {
          // Build regime labels from daily P&Ls (simple volatility-based bucketing)
          const pnls = result.daily_pnls as number[];
          const regimeLabels: number[] = [];
          const windowSize = 20;
          for (let i = 0; i < pnls.length; i++) {
            const start = Math.max(0, i - windowSize);
            const window = pnls.slice(start, i + 1);
            const mean = window.reduce((a, b) => a + b, 0) / window.length;
            const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / window.length;
            // Simple regime: 0=low-vol, 1=mid-vol, 2=high-vol
            regimeLabels.push(variance < 50000 ? 0 : variance < 200000 ? 1 : 2);
          }

          const tensorConfig = {
            daily_pnls: pnls,
            trades: result.trades?.slice(0, 200) ?? [],
            strategy_config: config.strategy ?? {},
            regime_labels: regimeLabels,
            compute_fragility: true,
          };

          const tensorResult = await runPythonModule<TensorSignalResult>({
            module: "src.engine.tensor_signal_model",
            config: { ...tensorConfig, mode: "predict" },
            componentName: "tensor-predict",
          });

          await db.update(tensorPredictions).set({
            status: "completed",
            modelVersion: tensorResult.model_hash ?? "unknown",
            probability: String(tensorResult.probability ?? 0),
            confidence: String(tensorResult.confidence ?? 0),
            signal: tensorResult.signal ?? "neutral",
            featureSnapshot: tensorResult.features ?? {},
            regimeAtPrediction: tensorResult.regime ?? null,
            fragilityScore: String(tensorResult.fragility_score ?? 0),
            regimeBreakdown: tensorResult.regime_breakdown ?? {},
          }).where(eq(tensorPredictions.id, tensorRow.id));

          logger.info({ backtestId }, "Auto tensor evaluation completed");
        } catch (tensorErr) {
          logger.error({ backtestId, err: tensorErr }, "Auto tensor evaluation failed (non-blocking)");
          await db.update(tensorPredictions).set({ status: "failed" }).where(eq(tensorPredictions.id, tensorRow.id));
        }
      })();
    }

    // ─── Auto RL training (fire-and-forget) ───
    // Requires 50+ daily P&L samples for a meaningful training episode set.
    if (result.tier && result.tier !== "REJECTED" && result.daily_pnls?.length >= 50) {
      (async () => {
        // Insert running row before Python call
        const [rlRow] = await db.insert(rlTrainingRuns).values({
          strategyId,
          status: "running",
          method: "pennylane_vqc",
          totalReturn: "0",
          sharpeRatio: "0",
          governanceLabels: { experimental: false, authoritative: true, decision_role: "pre_deploy_autonomous" },
        }).returning();

        try {
          const rlConfig = {
            strategy_id: strategyId,
            daily_pnls: result.daily_pnls,
            n_episodes: 100,
            max_steps: result.daily_pnls.length,
          };
          const rlResult = await runPythonModule<RlTrainingResult>({
            module: "src.engine.quantum_rl_agent",
            config: rlConfig,
            componentName: "rl-agent",
          });
          if (rlResult) {
            await db.update(rlTrainingRuns).set({
              status: "completed",
              totalReturn: String(rlResult.total_return ?? 0),
              sharpeRatio: String(rlResult.sharpe_ratio ?? 0),
              winRate: rlResult.win_rate != null ? String(rlResult.win_rate) : null,
              totalTrades: rlResult.total_trades ?? null,
              episodes: rlResult.n_episodes ?? null,
              executionTimeMs: rlResult.execution_time_ms ?? null,
              policyWeights: rlResult.policy_weights ?? null,
              comparisonResult: rlResult.comparison_result ?? null,
            }).where(eq(rlTrainingRuns.id, rlRow.id));
            logger.info({ backtestId, strategyId }, "Auto RL training completed");
          }
        } catch (err) {
          logger.error({ err, strategyId }, "Auto RL training failed");
          await db.update(rlTrainingRuns).set({ status: "failed" }).where(eq(rlTrainingRuns.id, rlRow.id));
        }
      })();
    }

    // ─── Auto Quantum Monte Carlo (fire-and-forget) ───
    // Quantum-enhanced breach probability estimation for qualifying backtests.
    // Same guard pattern as QUBO/Tensor/RL: non-REJECTED tier with daily P&Ls.
    if (result.tier && result.tier !== "REJECTED" && result.daily_pnls?.length > 0) {
      (async () => {
        try {
          const firmKey = config.firm_key ?? "topstep_50k";
          const qmcResult = await runQuantumMC(backtestId, "breach", firmKey);
          logger.info({ backtestId, qmcId: qmcResult.id, status: qmcResult.status }, "Auto quantum MC completed");
        } catch (qmcErr) {
          logger.error({ backtestId, err: qmcErr }, "Auto quantum MC failed (non-blocking)");
        }
      })();
    }

    // ─── Auto Critic Optimization (fire-and-forget) ───
    // Guard: critic needs walk-forward data for param stability analysis.
    // Trigger for any qualifying backtest that has walk-forward results,
    // regardless of optimizer type (covers n8n walk-forward runs too).
    if (result.tier && result.tier !== "REJECTED" && wfResults) {
      import("./critic-optimizer-service.js")
        .then(({ triggerCriticOptimizer }) =>
          triggerCriticOptimizer(backtestId, strategyId, config as unknown as Record<string, unknown>),
        )
        .then((criticResult) => {
          logger.info({ backtestId, runId: criticResult.runId, status: criticResult.status }, "Auto critic optimizer triggered");
        })
        .catch((criticErr) => {
          logger.error({ backtestId, err: criticErr }, "Auto critic optimizer failed (non-blocking)");
        });
    }

    // ─── Auto-promote to paper trading if strategy passes gates ───
    // suppressAutoPromote: skip promotion for critic replay backtests — the critic
    // loop decides promotion authority, not individual replay runs.
    if (!config.suppressAutoPromote && result.tier && ["TIER_1", "TIER_2", "TIER_3"].includes(result.tier)) {
      try {
        // Check graveyard similarity before promoting
        try {
          const { GraveyardGate } = await import("./graveyard-gate.js");
          const gate = new GraveyardGate();
          const graveyardCheck = await gate.check(config.strategy.name || "");
          if (graveyardCheck.blocked) {
            logger.warn({ strategyId, similarity: graveyardCheck.similarity }, "Strategy blocked by graveyard similarity");
            return { id: backtestId, status: "completed", ...result };
          }
        } catch (err) {
          logger.warn({ err }, "Graveyard check failed, proceeding anyway");
        }

        // Determine paper session config before entering the transaction
        const dailyLossLimit = (() => {
          const firmKey = config.firm_key;
          if (firmKey) {
            const firmName = firmKey.replace(/_\d+k$/i, "");
            const limits = getFirmLimit(firmName);
            if (limits) {
              return limits.dailyLossLimit ?? limits.maxDrawdown;
            }
          }
          return 2000;
        })();

        let paperSessionId: string;

        // All promotion writes are transactional: lifecycle state + paper session + audit log.
        // If any write fails, none persist — strategy stays in its prior state.
        await db.transaction(async (tx) => {
          // Auto-name assignment for TIER_1 strategies
          if (result.tier === "TIER_1") {
            // Idempotency: skip if strategy already has a Forge name
            const [existingName] = await tx
              .select()
              .from(strategyNames)
              .where(eq(strategyNames.strategyId, strategyId))
              .limit(1);

            if (existingName) {
              logger.info({ strategyId, forgeName: existingName.fullName }, "Strategy already has Forge name, skipping");
            } else {
              // Atomic claim: UPDATE ... WHERE claimed=false RETURNING * (race-safe)
              const [claimedName] = await tx
                .update(strategyNames)
                .set({
                  claimed: true,
                  claimedAt: new Date(),
                  strategyId,
                  originClass: strategyClass ?? null,
                })
                .where(
                  and(
                    eq(strategyNames.claimed, false),
                    eq(strategyNames.retired, false),
                    eq(strategyNames.id, sql`(SELECT id FROM strategy_names WHERE claimed = false AND retired = false LIMIT 1 FOR UPDATE SKIP LOCKED)`),
                  )
                )
                .returning();

              if (claimedName) {
                await tx.update(strategies).set({
                  name: claimedName.fullName,
                }).where(eq(strategies.id, strategyId));

                logger.info({
                  strategyId,
                  forgeName: claimedName.fullName,
                  codename: claimedName.codename,
                }, "Strategy auto-named on TIER_1 promotion");

                await tx.insert(auditLog).values({
                  action: "strategy.auto-named",
                  entityType: "strategy",
                  entityId: strategyId,
                  input: { codename: claimedName.codename },
                  result: { fullName: claimedName.fullName },
                  status: "success",
                });
              } else {
                // Fallback: generate unique name with crypto random suffix
                const { randomUUID } = await import("crypto");
                const fallbackName = `Forge Alpha-${randomUUID().slice(0, 8).toUpperCase()}`;
                await tx.update(strategies).set({
                  name: fallbackName,
                }).where(eq(strategies.id, strategyId));
                logger.warn({ strategyId, fallbackName }, "No codenames available, used fallback name");
              }
            }
          }

          // Update strategy lifecycle to PAPER
          await tx.update(strategies).set({
            lifecycleState: "PAPER",
            lifecycleChangedAt: new Date(),
            forgeScore: result.forge_score != null ? String(result.forge_score) : null,
          }).where(eq(strategies.id, strategyId));

          // Create paper trading session
          const [paperSession] = await tx.insert(paperSessions).values({
            strategyId,
            startingCapital: "50000",
            currentEquity: "50000",
            config: {
              preferred_sessions: ["NY_RTH"],
              max_concurrent_positions: 1,
              cooldown_bars: 4,
              daily_loss_limit: dailyLossLimit,
              backtestId,
              tier: result.tier,
              forge_score: result.forge_score,
            },
          }).returning();

          paperSessionId = paperSession.id;

          await tx.insert(auditLog).values({
            action: "strategy.auto-promote",
            entityType: "strategy",
            entityId: strategyId,
            input: { backtestId, tier: result.tier },
            result: { paperSessionId: paperSession.id },
            status: "success",
          });
        });

        // Start live stream outside the transaction (I/O side-effect, not DB)
        try {
          startStream(paperSessionId!, [config.strategy.symbol]);
        } catch (streamErr) {
          logger.warn(streamErr, "Auto-promoted session created but stream failed to start");
        }

        // Broadcast promotion event (outside transaction — SSE is best-effort)
        broadcastSSE("strategy:promoted", {
          strategyId,
          tier: result.tier,
          forgeScore: result.forge_score,
          paperSessionId: paperSessionId!,
        });

        logger.info({
          strategyId,
          tier: result.tier,
          paperSessionId: paperSessionId!,
        }, "Strategy auto-promoted to paper trading");
      } catch (promoErr) {
        logger.error(promoErr, "Failed to auto-promote strategy to paper trading");
      }
    }

    backtestSpan.setAttribute("status", "completed");
    backtestSpan.setAttribute("tier", result.tier ?? "unknown");
    backtestSpan.end();
    return { id: backtestId, status: "completed", ...result };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await db
      .update(backtests)
      .set({ status: "failed", errorMessage: errorMsg })
      .where(eq(backtests.id, backtestId));

    await db.insert(auditLog).values({
      action: "backtest.run",
      entityType: "backtest",
      entityId: backtestId,
      input: config as unknown as Record<string, unknown>,
      result: { error: errorMsg },
      status: "failure",
      decisionAuthority: "agent",
      errorMessage: errorMsg,
    });

    backtestSpan.setAttribute("status", "failed");
    backtestSpan.end();
    broadcastSSE("backtest:failed", { backtestId, strategyId, error: errorMsg });
    return { id: backtestId, status: "failed", error: errorMsg };
  }
}
