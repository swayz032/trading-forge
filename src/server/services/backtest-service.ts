/**
 * Backtest Service — Node↔Python bridge + DB persistence
 *
 * Follows the databento.ts subprocess spawn pattern:
 * - Platform detection (python vs python3)
 * - stdout → JSON.parse
 * - stderr → logging
 */

import { eq, and, sql } from "drizzle-orm";
import { backtests, backtestTrades, stressTestRuns, strategies, paperSessions, auditLog, walkForwardWindows, strategyNames, sqaOptimizationRuns, quboTimingRuns, tensorPredictions, rlTrainingRuns, monteCarloRuns } from "../db/schema.js";
import { broadcastSSE } from "../routes/sse.js";
import { startStream } from "./paper-trading-stream.js";
import { runMonteCarlo } from "./monte-carlo-service.js";
import { runQuantumMC } from "./quantum-mc-service.js";
import { queryInfo } from "../../data/loaders/duckdb-service.js";
import { getFirmLimit } from "../../shared/firm-config.js";
import { WFWindowMetricsSchema } from "../../shared/walk-forward-schema.js";
import { logger } from "../lib/logger.js";
import { runPythonModule } from "../lib/python-runner.js";
import { CircuitBreakerRegistry } from "../lib/circuit-breaker.js";
import { sqaRegistry } from "../lib/sqa-promise-registry.js";
import { captureToDLQ } from "../lib/dlq-service.js";
import { db } from "../db/index.js";
import { tracer } from "../lib/tracing.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";
import { backtestRuns } from "../lib/metrics-registry.js";

/**
 * Normalize gate_result from Python into a stable JSONB shape.
 *
 * Python backtester.py returns gate_result with the following top-level keys:
 *   score, passed, components: { survival_score, ... }, crisis_veto, ...
 *
 * CONTRACT (with architect agent): lifecycle-service.ts reads
 *   latestBt.gateResult.components.survival_score
 * so that path MUST exist in the persisted object.
 *
 * If Python omits gate_result entirely, returns null (no partial write).
 * If Python returns a gate_result that lacks components, we preserve whatever
 * Python sent — we do NOT manufacture a fake structure.
 */
function normalizeGateResult(raw: Record<string, unknown> | undefined | null): Record<string, unknown> | null {
  if (!raw) return null;
  // Pass through the full object as-is — Python owns the structure.
  // This function exists to make the contract explicit and to be a single
  // interception point if the key name ever changes in Python.
  return raw as Record<string, unknown>;
}

/**
 * Collect unpersisted top-level Python result fields into result_extras JSONB.
 * Fields already persisted in dedicated columns are excluded to avoid duplication.
 */
function buildResultExtras(result: BacktestResult): Record<string, unknown> | null {
  const extras: Record<string, unknown> = {};
  // Fields emitted by backtester.py that have no dedicated column
  const extraKeys = [
    "governor",
    "analytics",
    "long_short_split",
    "bootstrap_ci_95",
    "deflated_sharpe",
    "recency_analysis",
    "statistical_warnings",
    "confidence_intervals",
  ] as const;
  let hasAny = false;
  for (const key of extraKeys) {
    const value = (result as unknown as Record<string, unknown>)[key];
    if (value !== undefined && value !== null) {
      extras[key] = value;
      hasAny = true;
    }
  }
  return hasAny ? extras : null;
}

/**
 * Equity curve size guard.
 *
 * Long backtest periods (years of intraday data) can produce equity curves with
 * 10K+ points. Persisting them as JSONB on every backtest row blows up DB size
 * and makes /api/backtests responses multi-MB.
 *
 * Strategy: index-stride downsample. Element-type-agnostic (works whether the
 * curve is number[] or Array<{time, value}>). Always preserves the final point
 * so the displayed terminal equity matches reality.
 */
const EQUITY_CURVE_MAX_POINTS = 5000;

function downsampleEquityCurve<T>(curve: T[] | null | undefined): {
  downsampled: T[] | null;
  originalLength: number;
  stride: number;
} {
  if (!Array.isArray(curve) || curve.length === 0) {
    return { downsampled: (curve ?? null) as T[] | null, originalLength: 0, stride: 1 };
  }
  if (curve.length <= EQUITY_CURVE_MAX_POINTS) {
    return { downsampled: curve, originalLength: curve.length, stride: 1 };
  }
  const stride = Math.ceil(curve.length / EQUITY_CURVE_MAX_POINTS);
  const downsampled: T[] = [];
  for (let i = 0; i < curve.length; i += stride) {
    downsampled.push(curve[i]);
  }
  // Always include the final point (terminal equity)
  const last = curve[curve.length - 1];
  if (downsampled[downsampled.length - 1] !== last) {
    downsampled.push(last);
  }
  return { downsampled, originalLength: curve.length, stride };
}

/** Convert decay_analysis from Python snake_case to frontend camelCase. */
export function normalizeDecayAnalysis(raw: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  // FIX 3 — canonicalize on Python's `accelerating_decline` (more specific than
  // the generic "declining"). Frontend types in Trading_forge_frontend/amber-vision-main
  // have been updated to accept the canonical value. We pass through unchanged
  // so the downstream contract is "Python's trend keyword == DB trend keyword
  // == frontend trend keyword" (no translator drift).
  return {
    halfLifeDays: raw.half_life_days ?? null,
    decayDetected: raw.decay_detected ?? false,
    trend: raw.trend ?? "stable",
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
  overnight_hold?: boolean;       // True = swing strategy; gates overnight margin checks in prop sim
  fill_rate?: number;             // Fraction of orders that fill (0.0–1.0); default 1.0
  spread_multiplier?: number;     // Multiplier on bid-ask spread for slippage model; default 1.0
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

export async function runBacktest(strategyId: string, config: BacktestConfig, strategyClass?: string, externalId?: string, correlationId?: string) {
  // ─── Pipeline pause guard ─────────────────────────────────────
  // Block new backtests when pipeline is PAUSED/VACATION. Defence-in-depth:
  // upstream callers (runStrategy, route handlers) already gate, but any
  // direct caller (tests, future code) hits this guard. We log + return
  // before writing a backtests row so the DB doesn't accumulate orphaned
  // pending entries while paused.
  // The id is `null` — callers MUST check status before writing it as a FK
  // (systemJournal.backtestId references backtests.id). The runStrategy
  // path already gates upstream so this branch is rare-race-only.
  if (!(await isPipelineActive())) {
    logger.info(
      { fn: "runBacktest", strategyId, symbol: config.strategy.symbol },
      "Skipped: pipeline paused",
    );
    // Cast to the success shape with id=null. The TypeScript widening here is
    // acceptable: callers that ignore status="skipped" will see a null id which
    // is allowed by the schema (backtestId is nullable in systemJournal).
    return { id: null as unknown as string, status: "skipped", error: "pipeline_paused" };
  }

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

  // Insert directly as "running" — single atomic write eliminates the
  // window where a restart could leave the row stuck in "pending" forever.
  // NOTE: pending status removed; if reintroduced, add to scheduler.ts:874 sweeper.
  const [row] = await db
    .insert(backtests)
    .values({
      ...(externalId ? { id: externalId } : {}),
      strategyId,
      symbol: config.strategy.symbol,
      timeframe: config.strategy.timeframe,
      startDate: new Date(config.start_date),
      endDate: new Date(config.end_date),
      status: "running",
      config: config as unknown as Record<string, unknown>,
    })
    .returning();

  const backtestId = row.id;
  backtestSpan.setAttribute("backtestId", backtestId);

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
        correlationId,
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
      backtestRuns.labels({ status: "failed", mode, tier: "none" }).inc();
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
    //
    // Equity curve size guard: downsample before persisting. Long backtests
    // (years of intraday) can produce 10K+ point curves = many MB per row.
    // We keep originalLength + stride alongside so charts can show "showing
    // 5000 of 73,481 points (sampled every 15)".
    const rawEquityCurve = result.equity_curve ?? metrics.equity_curve ?? null;
    const equityCurveGuard = downsampleEquityCurve(rawEquityCurve as unknown[] | null);

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
          equityCurve: equityCurveGuard.downsampled,
          monthlyReturns: result.monthly_returns ?? null,
          dailyPnls: result.daily_pnls ?? metrics.daily_pnls ?? null,
          walkForwardResults: wfResults,
          propCompliance: result.prop_compliance ?? null,
          decayAnalysis: normalizeDecayAnalysis(result.decay_analysis as Record<string, unknown> | undefined),
          runReceipt: result.run_receipt ?? null,
          sanityChecks: result.sanity_checks ?? null,
          crossValidation: result.cross_validation ?? null,
          // Fix 3: persist full gate_result — normalizeGateResult is a passthrough
          // that makes the Python→DB contract explicit. The architect agent reads
          // gateResult.components.survival_score from this column.
          gateResult: normalizeGateResult(result.gate_result as Record<string, unknown> | undefined | null),
          gateRejections: result.gate_rejections ?? null,
          // Fix 4: persist additional Python engine outputs (migration 0053)
          // Equity curve guard: append downsample metadata so charts know the original length.
          resultExtras: (() => {
            const base = buildResultExtras(result) ?? {};
            if (equityCurveGuard.originalLength > 0) {
              base.equity_curve_original_length = equityCurveGuard.originalLength;
              base.equity_curve_stride = equityCurveGuard.stride;
            }
            return Object.keys(base).length > 0 ? base : null;
          })(),
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
        correlationId: correlationId ?? null,
      });
    });

    // ─── Broadcast completion SSE ─────────────────────────────────
    broadcastSSE("backtest:completed", {
      backtestId,
      strategyId,
      tier: result.tier ?? null,
      forgeScore: result.forge_score ?? null,
    });

    backtestRuns.labels({ status: "completed", mode, tier: result.tier ?? "none" }).inc();

    // ─── Optional SQA parameter optimization (fire-and-forget) ───
    // Fires for ALL qualifying backtests (non-REJECTED with walk-forward results),
    // not just those explicitly requesting the SQA optimizer.
    if (result.tier && result.tier !== "REJECTED" && wfResults && config.strategy?.indicators?.length) {
      // Register the SQA promise in the session-local registry so the critic
      // can await it with a bounded timeout instead of fire-and-forget polling.
      // The IIFE itself is still fire-and-forget (non-blocking to the backtest
      // response), but critic-optimizer-service can now observe its completion.
      const sqaTask = (async () => {
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
            governanceLabels: { experimental: true, authoritative: false, decision_role: "challenger_only" },
          }).returning();

          const sqaResult = await runPythonModule<SqaOptimizationResult>({
            module: "src.engine.quantum_annealing_optimizer",
            config: sqaConfig,
            componentName: "sqa-optimizer",
            correlationId,
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
                governance: { experimental: true, authoritative: false, decision_role: "challenger_only" },
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
          sqaRegistry.markSettled(backtestId, "completed");
        } catch (sqaErr) {
          const sqaErrMsg = sqaErr instanceof Error ? sqaErr.message : String(sqaErr);
          logger.error({ backtestId, err: sqaErr }, "SQA optimization failed (non-blocking)");
          sqaRegistry.markSettled(backtestId, "failed");
          // Mark any running SQA rows for this backtest as failed
          await db.update(sqaOptimizationRuns).set({ status: "failed" })
            .where(and(eq(sqaOptimizationRuns.backtestId, backtestId), eq(sqaOptimizationRuns.status, "running")));
          await captureToDLQ({
            operationType: "sqa_optimization:failure",
            entityType: "backtest",
            entityId: backtestId,
            errorMessage: sqaErrMsg,
            metadata: { backtestId, strategyId, correlationId: correlationId ?? null },
          }).catch(() => {});
        }
      })();
      // Register promise AFTER spawn so critic can await it with bounded timeout.
      sqaRegistry.register(backtestId, sqaTask);
    }

    // ─── Auto Monte Carlo for non-tier-qualifying backtests (fire-and-forget) ───
    // MC data is needed to evaluate ANY strategy. For tier-qualifying backtests
    // (TIER_1/2/3), MC is run synchronously inside the auto-promote gate below
    // so survival-rate is part of the promotion decision and atomicity is preserved.
    // For REJECTED / no-tier results, fire-and-forget MC for analytics only.
    //
    // FIX 1 — critic replay MC: when suppressAutoPromote=true (set during critic
    // replay), the blocking MC gate is intentionally skipped (replay shouldn't
    // gate the critic flow), but the fire-and-forget MC must STILL fire so the
    // lifecycle gate at TESTING→PAPER has MC data later. Without this, the child
    // strategy gets no MC record and the lifecycle gate silently blocks promotion
    // forever (it reads monteCarloRuns.probabilityOfRuin and finds nothing).
    // The condition !isTierQualifying already evaluates to true when suppressAutoPromote
    // is true (because the !config.suppressAutoPromote conjunct is false), so this
    // branch fires for critic replays — but we make the intent explicit and add an
    // audit row so the replay→MC linkage is queryable. We also write the audit row
    // synchronously BEFORE the fire-and-forget so the linkage survives even if MC
    // crashes or the process restarts.
    const isTierQualifying =
      !config.suppressAutoPromote &&
      result.tier &&
      ["TIER_1", "TIER_2", "TIER_3"].includes(result.tier);

    const isCriticReplay = config.suppressAutoPromote === true;

    if (result.daily_pnls?.length > 0 && (!isTierQualifying || isCriticReplay)) {
      // Critic-replay MC: write an explicit audit row marking this as a
      // critic-replay-triggered MC so the replay→MC link is queryable later.
      if (isCriticReplay) {
        try {
          await db.insert(auditLog).values({
            action: "strategy.critic-replay-mc-triggered",
            entityType: "strategy",
            entityId: strategyId,
            input: { backtestId, tier: result.tier ?? null },
            result: {
              note: "fire-and-forget MC triggered for critic-replay child so TESTING→PAPER lifecycle gate has MC data",
            },
            status: "success",
            decisionAuthority: "gate",
            correlationId: correlationId ?? null,
          });
        } catch (auditErr) {
          logger.warn({ backtestId, strategyId, err: auditErr }, "critic-replay-mc-triggered audit insert failed (non-blocking)");
        }
      }

      // P1-5: Pre-insert pending MC row BEFORE the fire-and-forget Python call.
      // Without this row, a Node crash between `runMonteCarlo()`'s entry and
      // its internal `.insert(monteCarloRuns)` leaves no pending record. The
      // stale-pending sweeper (scheduler.ts:1072 — 90 min cutoff for
      // monte_carlo_runs) cannot mark a run as failed if no row exists.
      // Result: the TESTING→PAPER lifecycle gate either waits forever
      // (looking for an MC row that never gets written) or, on critic-replay,
      // misses the survivor's MC evidence entirely.
      //
      // We pre-insert with a generated UUID and pass it as `externalId`.
      // monte-carlo-service.ts uses .onConflictDoNothing() and re-fetches the
      // row when externalId is provided, so the eventual `runMonteCarlo` call
      // is idempotent: it either uses our pre-inserted row, or (on retry from
      // a crash that did insert before failing) reuses the one already there.
      // The success/failure update at the end of `runMonteCarlo` then
      // transitions the row to "completed"/"failed".
      (async () => {
        const { randomUUID } = await import("crypto");
        const preInsertedMcId = randomUUID();
        try {
          await db.insert(monteCarloRuns).values({
            id: preInsertedMcId,
            backtestId,
            status: "running",
            numSimulations: 50_000,
            gpuAccelerated: true,
          });
        } catch (preInsertErr) {
          logger.warn(
            { backtestId, err: preInsertErr, isCriticReplay },
            "Auto MC: pre-insert pending row failed (proceeding — runMonteCarlo will create its own row)",
          );
          // Fall through with a fresh ID so runMonteCarlo can still self-insert.
        }

        runMonteCarlo(
          backtestId,
          {
            numSimulations: 50_000,
            method: "both",
            firms: ["topstep_50k", "mffu_50k", "tpt_50k", "apex_50k", "ffn_50k", "alpha_50k", "tradeify_50k", "earn2trade_50k"],
          },
          preInsertedMcId,
        )
          .then((mcResult) => {
            logger.info({ backtestId, mcId: mcResult.id, status: mcResult.status, isCriticReplay }, "Auto MC completed");
          })
          .catch((mcErr) => {
            logger.error({ backtestId, err: mcErr, isCriticReplay }, "Auto MC failed (non-blocking)");
          });
      })();
    } else if (isCriticReplay && (!result.daily_pnls || result.daily_pnls.length === 0)) {
      // Defensive: critic-replay with no daily_pnls — MC cannot run, but the
      // lifecycle gate at TESTING→PAPER will still look for an MC row. Record
      // the skip explicitly so the gate's lookup-failure is replayable.
      try {
        await db.insert(auditLog).values({
          action: "strategy.critic-replay-mc-skipped",
          entityType: "strategy",
          entityId: strategyId,
          input: { backtestId, tier: result.tier ?? null },
          result: {
            reason: "no daily_pnls — MC cannot be run on a replay backtest with empty daily_pnls",
          },
          status: "failure",
          decisionAuthority: "gate",
          correlationId: correlationId ?? null,
        });
      } catch (auditErr) {
        logger.warn({ backtestId, strategyId, err: auditErr }, "critic-replay-mc-skipped audit insert failed (non-blocking)");
      }
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
          governanceLabels: { experimental: true, authoritative: false, decision_role: "challenger_only" },
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
            correlationId,
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
          const quboErrMsg = quboErr instanceof Error ? quboErr.message : String(quboErr);
          logger.error({ backtestId, err: quboErr }, "Auto QUBO timing failed (non-blocking)");
          await db.update(quboTimingRuns).set({ status: "failed" }).where(eq(quboTimingRuns.id, quboRow.id));
          await captureToDLQ({
            operationType: "qubo_timing:failure",
            entityType: "backtest",
            entityId: backtestId,
            errorMessage: quboErrMsg,
            metadata: { backtestId, strategyId, quboRowId: quboRow.id, correlationId: correlationId ?? null },
          }).catch(() => {});
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
          governanceLabels: { experimental: true, authoritative: false, decision_role: "challenger_only" },
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
            correlationId,
          });

          // probability===null means model not trained — mark skipped, not completed,
          // so the critic evidence query omits this row rather than reading a fake 0.5.
          const tensorProbability = tensorResult.probability;
          if (tensorProbability === null || tensorProbability === undefined) {
            await db.update(tensorPredictions).set({
              status: "skipped_no_model",
              modelVersion: "no_model",
              signal: "no_model",
            }).where(eq(tensorPredictions.id, tensorRow.id));
            logger.info({ backtestId }, "Auto tensor evaluation skipped — model not trained");
          } else {
            await db.update(tensorPredictions).set({
              status: "completed",
              modelVersion: tensorResult.model_hash ?? "unknown",
              probability: String(tensorProbability),
              confidence: String(tensorResult.confidence ?? 0),
              signal: tensorResult.signal ?? "neutral",
              featureSnapshot: tensorResult.features ?? {},
              regimeAtPrediction: tensorResult.regime ?? null,
              fragilityScore: String(tensorResult.fragility_score ?? 0),
              regimeBreakdown: tensorResult.regime_breakdown ?? {},
            }).where(eq(tensorPredictions.id, tensorRow.id));
            logger.info({ backtestId }, "Auto tensor evaluation completed");
          }
        } catch (tensorErr) {
          const tensorErrMsg = tensorErr instanceof Error ? tensorErr.message : String(tensorErr);
          logger.error({ backtestId, err: tensorErr }, "Auto tensor evaluation failed (non-blocking)");
          await db.update(tensorPredictions).set({ status: "failed" }).where(eq(tensorPredictions.id, tensorRow.id));
          await captureToDLQ({
            operationType: "tensor_prediction:failure",
            entityType: "backtest",
            entityId: backtestId,
            errorMessage: tensorErrMsg,
            metadata: { backtestId, strategyId, tensorRowId: tensorRow.id, correlationId: correlationId ?? null },
          }).catch(() => {});
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
          governanceLabels: { experimental: true, authoritative: false, decision_role: "challenger_only" },
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
            correlationId,
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
          const rlErrMsg = err instanceof Error ? err.message : String(err);
          logger.error({ err, strategyId }, "Auto RL training failed");
          await db.update(rlTrainingRuns).set({ status: "failed" }).where(eq(rlTrainingRuns.id, rlRow.id));
          await captureToDLQ({
            operationType: "rl_training:failure",
            entityType: "strategy",
            entityId: strategyId,
            errorMessage: rlErrMsg,
            metadata: { backtestId, strategyId, rlRowId: rlRow.id, correlationId: correlationId ?? null },
          }).catch(() => {});
        }
      })();
    }

    // ─── Auto Quantum Monte Carlo (fire-and-forget) ───
    // Quantum-enhanced breach probability estimation for qualifying backtests.
    // Same guard pattern as QUBO/Tensor/RL: non-REJECTED tier with daily P&Ls.
    // CB key: "python-quantum-mc" — shared with any future direct QMC call sites.
    // runQuantumMC already inserts a "running" quantumMcRuns row before calling Python
    // (confirmed: quantum-mc-service.ts:125-136), so no pre-insert is needed here.
    if (result.tier && result.tier !== "REJECTED" && result.daily_pnls?.length > 0) {
      (async () => {
        try {
          const firmKey = config.firm_key ?? "topstep_50k";
          const qmcResult = await CircuitBreakerRegistry.get("python-quantum-mc", { failureThreshold: 3, cooldownMs: 30_000 }).call(
            () => runQuantumMC(backtestId, "breach", firmKey),
          );
          logger.info({ backtestId, qmcId: qmcResult.id, status: qmcResult.status }, "Auto quantum MC completed");
        } catch (qmcErr) {
          // Circuit open or Python failure — log and swallow (non-blocking)
          logger.error({ backtestId, err: qmcErr }, "Auto quantum MC failed (non-blocking)");
        }
      })();
    }

    // ─── Auto Critic Optimization (fire-and-forget) ───
    // Guard: critic needs walk-forward data for param stability analysis.
    // Trigger for any qualifying backtest that has walk-forward results,
    // regardless of optimizer type (covers n8n walk-forward runs too).
    // P2-3: suppress critic auto-trigger for replay backtests (suppressAutoPromote=true).
    // Replays are already inside a critic cycle — firing critic again would create an
    // uncontrolled recursive loop.
    if (!config.suppressAutoPromote && result.tier && result.tier !== "REJECTED" && wfResults) {
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

        // ─── FIX 2 — CANDIDATE→PAPER fast-track must enforce the same three
        // gates that lifecycle-service.checkAutoPromotions enforces on the
        // standard TESTING→PAPER path. Without them, a strategy with high
        // tier+forgeScore but poor survivability/exportability/compliance
        // bypasses the safety net and lands in PAPER.
        //
        // Gate order (fail fast on cheap checks, expensive MC last):
        //   2a. raw_survival_score >= 60 (cheap; reads gateResult JSONB on `result`)
        //   2b. compliance ruleset drift gate (cheap; per-firm DB read)
        //   2c. Pine exportability ok (medium; pine-export-service)
        //   --- existing MC survival gate (expensive; Python subprocess) ---

        // ── 2a. Survival score gate (raw_survival_score >= 60) ───────────
        // gate_result.components.raw_survival_score is the unscaled 0-100 score
        // from survival_scorer.py. Score < 60 means the strategy is likely to
        // hit daily loss limits or DD limits in live trading.
        try {
          const gateResultRaw = (result as unknown as Record<string, unknown>).gate_result;
          if (gateResultRaw && typeof gateResultRaw === "object") {
            const components = (gateResultRaw as Record<string, unknown>).components as
              | Record<string, number>
              | undefined;
            const rawSurvivalScore =
              components?.raw_survival_score ?? components?.survival_score ?? null;
            if (rawSurvivalScore !== null && rawSurvivalScore < 60) {
              logger.warn(
                { strategyId, backtestId, rawSurvivalScore },
                "CANDIDATE→PAPER fast-track blocked: survival-score-below-threshold",
              );
              await db.insert(auditLog).values({
                action: "strategy.fast-track.survival-score-blocked",
                entityType: "strategy",
                entityId: strategyId,
                input: { backtestId, fromState: "CANDIDATE", toState: "PAPER" },
                result: {
                  reason: "survival-score-below-threshold",
                  survival_score: rawSurvivalScore,
                  minimum_required: 60,
                },
                status: "failure",
                decisionAuthority: "gate",
                correlationId: correlationId ?? null,
              });
              return { id: backtestId, status: "completed", ...result };
            }
          }
          // No gateResult on the result is permissive — same fallback behavior as lifecycle-service.
        } catch (gateErr) {
          // Gate read failure is informational, not a strategy failure
          logger.warn(
            { strategyId, err: gateErr },
            "CANDIDATE→PAPER fast-track: survival-score gate read failed (proceeding)",
          );
        }

        // ── 2b. Compliance ruleset drift gate ─────────────────────────────
        // If the latest ruleset row for any qualifying firm has driftDetected=true,
        // the prop compliance result on this backtest is no longer trustworthy.
        try {
          const propComplianceRaw = (result as unknown as Record<string, unknown>).prop_compliance;
          const { passingFirmNamesFromCompliance, findFirmsWithComplianceDrift } = await import("./lifecycle-service.js");
          const passingFirmNames = passingFirmNamesFromCompliance(propComplianceRaw);
          if (passingFirmNames.length > 0) {
            const driftFirms = await findFirmsWithComplianceDrift(passingFirmNames);
            if (driftFirms.length > 0) {
              logger.warn(
                { strategyId, backtestId, driftFirms },
                "CANDIDATE→PAPER fast-track blocked: compliance ruleset drift detected",
              );
              await db.insert(auditLog).values({
                action: "strategy.fast-track.compliance-drift-blocked",
                entityType: "strategy",
                entityId: strategyId,
                input: { backtestId, fromState: "CANDIDATE", toState: "PAPER" },
                result: {
                  firms_with_drift: driftFirms,
                  qualifying_firms: passingFirmNames,
                  reason:
                    "compliance ruleset drift_detected — promotion held until human revalidation",
                },
                status: "failure",
                decisionAuthority: "gate",
                correlationId: correlationId ?? null,
              });
              return { id: backtestId, status: "completed", ...result };
            }
          }
        } catch (driftErr) {
          // Drift gate infra failure is informational — do not block promotion on infra errors
          logger.warn(
            { strategyId, err: driftErr },
            "CANDIDATE→PAPER fast-track: compliance drift gate read failed (proceeding)",
          );
        }

        // ── 2b'. Compliance gate (P0-2 part 2) ─────────────────────────────
        // Mirrors the TESTING→PAPER promotion-time gate in lifecycle-service.
        // The drift gate above only catches firms with driftDetected=true on
        // their latest ruleset. The compliance gate also blocks on stale
        // (>24h) rulesets and "no_ruleset" firms. Same fail-closed posture
        // as paper-execution-service: subprocess failure → block promotion.
        try {
          const propComplianceRaw = (result as unknown as Record<string, unknown>).prop_compliance;
          const { passingFirmNamesFromCompliance, runComplianceGateForFirms } = await import("./lifecycle-service.js");
          const passingFirmNames = passingFirmNamesFromCompliance(propComplianceRaw);
          if (passingFirmNames.length > 0) {
            const { firmsFailing, details } = await runComplianceGateForFirms(passingFirmNames);
            if (firmsFailing.length > 0) {
              logger.warn(
                { strategyId, backtestId, firmsFailing, details },
                "CANDIDATE→PAPER fast-track blocked: compliance gate (freshness) failed",
              );
              await db.insert(auditLog).values({
                action: "strategy.fast-track.compliance_blocked",
                entityType: "strategy",
                entityId: strategyId,
                input: { backtestId, fromState: "CANDIDATE", toState: "PAPER" },
                result: {
                  firms_failing: firmsFailing,
                  qualifying_firms: passingFirmNames,
                  details,
                  reason: "compliance_gate.check_freshness failed — fast-track promotion held",
                },
                status: "failure",
                decisionAuthority: "gate",
                correlationId: correlationId ?? null,
              });
              broadcastSSE("strategy:compliance_blocked", {
                strategyId,
                fromState: "CANDIDATE",
                toState: "PAPER",
                firmsFailing,
                details,
              });
              return { id: backtestId, status: "completed", ...result };
            }
          }
        } catch (complianceGateErr) {
          // Wrapper-level error (not a per-firm fail). Same posture as the
          // drift gate above: log and proceed. The per-firm fail-closed path
          // is inside runComplianceGateForFirms itself; reaching here means
          // something at the dynamic-import or aggregation layer broke.
          logger.warn(
            { strategyId, err: complianceGateErr },
            "CANDIDATE→PAPER fast-track: compliance gate wrapper threw (proceeding — per-firm fail-closed still applies inside the helper)",
          );
        }

        // ── 2c. Pine exportability pre-check ──────────────────────────────
        // A strategy that cannot be exported to Pine cannot be deployed to TradingView,
        // so promoting it to PAPER would create a stuck DEPLOY_READY downstream.
        try {
          const { checkExportability } = await import("./pine-export-service.js");
          const exportCheck = await checkExportability(strategyId);
          if (!exportCheck.ok) {
            logger.warn(
              {
                strategyId,
                backtestId,
                score: exportCheck.score,
                band: exportCheck.band,
                deductions: exportCheck.deductions,
              },
              "CANDIDATE→PAPER fast-track blocked: Pine exportability issues",
            );
            await db.insert(auditLog).values({
              action: "strategy.fast-track.exportability-blocked",
              entityType: "strategy",
              entityId: strategyId,
              input: { backtestId, fromState: "CANDIDATE", toState: "PAPER" },
              result: {
                reasons: (exportCheck as Record<string, unknown>).reasons ?? null,
                score: exportCheck.score,
                band: exportCheck.band,
                deductions: exportCheck.deductions,
              },
              status: "failure",
              decisionAuthority: "gate",
              correlationId: correlationId ?? null,
            });
            broadcastSSE("strategy:exportability_blocked", {
              strategyId,
              fromState: "CANDIDATE",
              toState: "PAPER",
              score: exportCheck.score,
              band: exportCheck.band,
              reasons: (exportCheck as Record<string, unknown>).reasons ?? null,
            });
            return { id: backtestId, status: "completed", ...result };
          }
        } catch (exportErr) {
          // checkExportability infra failure is informational — do not block on infra errors
          logger.warn(
            { strategyId, err: exportErr },
            "CANDIDATE→PAPER fast-track: exportability check failed (proceeding)",
          );
        }

        // ─── MC survival gate (BLOCKING) ────────────────────────────
        // MC must pass before auto-promote to PAPER. Latency tradeoff: MC can take
        // 30-90s for 50k simulations, which extends the backtest response time.
        // This is acceptable because the alternative (fire-and-forget MC) creates
        // the dual-promotion bypass that lets strategies into PAPER without ever
        // being evaluated for ruin probability — the very bug this gate fixes.
        // If MC is unavailable (Python subprocess fails), strategy stays CANDIDATE
        // and a "mc-unavailable-promotion-blocked" audit row is written.
        let mcSurvivalRate: number | null = null;
        let mcPassed = false;
        let mcUnavailable = false;
        if (result.daily_pnls?.length > 0) {
          try {
            // Wrap MC call with circuit breaker — "python-mc" is shared with any other
            // direct call site to monte-carlo-service. If the circuit is OPEN (3 failures
            // within the cooldown window), this throws CircuitOpenError immediately and
            // we fall through to the mcUnavailable block below. On success the semantics
            // of runMonteCarlo are completely unchanged.
            const mcResult = await CircuitBreakerRegistry.get("python-mc", { failureThreshold: 3, cooldownMs: 30_000 }).call(
              () => runMonteCarlo(backtestId, {
                numSimulations: 50_000,
                method: "both",
                firms: ["topstep_50k", "mffu_50k", "tpt_50k", "apex_50k", "ffn_50k", "alpha_50k", "tradeify_50k", "earn2trade_50k"],
              }),
            );
            if (mcResult.status === "completed") {
              // Narrowed: completed branch carries the full MCResult including risk_metrics
              const mcCompleted = mcResult as { id: string; status: "completed"; risk_metrics?: Record<string, unknown> };
              const ruinRaw = mcCompleted.risk_metrics?.probability_of_ruin;
              if (ruinRaw != null) {
                const ruin = Number(ruinRaw);
                mcSurvivalRate = 1 - ruin;
                mcPassed = mcSurvivalRate >= 0.70;
                logger.info(
                  { backtestId, strategyId, mcId: mcCompleted.id, survivalRate: mcSurvivalRate.toFixed(4), passed: mcPassed },
                  "Auto-promote MC gate evaluated",
                );
              } else {
                mcUnavailable = true;
                logger.warn({ backtestId, mcId: mcCompleted.id }, "Auto-promote MC gate: completed but probability_of_ruin missing, blocking promotion");
              }
            } else {
              // MC failed → block promotion
              mcUnavailable = true;
              logger.warn({ backtestId, mcStatus: mcResult.status }, "Auto-promote MC gate: MC did not complete, blocking promotion");
            }
          } catch (mcErr) {
            mcUnavailable = true;
            logger.error({ backtestId, err: mcErr }, "Auto-promote MC gate: MC threw, blocking promotion");
          }
        } else {
          // No daily_pnls → can't run MC → block promotion (strategy can't be evaluated for ruin)
          mcUnavailable = true;
          logger.warn({ backtestId, strategyId }, "Auto-promote MC gate: no daily_pnls, blocking promotion");
        }

        // If MC didn't pass, log a blocked audit row and skip promotion (strategy stays CANDIDATE)
        if (!mcPassed) {
          const blockedAction = mcUnavailable ? "mc-unavailable-promotion-blocked" : "mc-survival-promotion-blocked";
          await db.insert(auditLog).values({
            action: blockedAction,
            entityType: "strategy",
            entityId: strategyId,
            input: { backtestId, tier: result.tier },
            result: {
              survivalRate: mcSurvivalRate,
              threshold: 0.70,
              mcUnavailable,
            },
            status: "failure",
            decisionAuthority: "gate",
            correlationId: correlationId ?? null,
          });
          logger.warn(
            { strategyId, backtestId, tier: result.tier, survivalRate: mcSurvivalRate, mcUnavailable },
            "Auto-promote blocked at MC gate — strategy stays CANDIDATE",
          );
          return { id: backtestId, status: "completed", ...result };
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
        let promotionSucceeded = false;
        let promotionError: string | undefined;

        // All promotion writes are transactional: lifecycle state + paper session + audit log.
        // If any write fails, none persist — strategy stays in its prior state.
        // Lifecycle write goes through LifecycleService.promoteStrategy() so there is
        // ONE path to lifecycle state changes — closes the dual-promotion bypass.
        const { LifecycleService } = await import("./lifecycle-service.js");
        const lifecycle = new LifecycleService();

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
                  correlationId: correlationId ?? null,
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

          // Update forgeScore separately — promoteStrategy doesn't touch it
          if (result.forge_score != null) {
            await tx.update(strategies).set({
              forgeScore: String(result.forge_score),
            }).where(eq(strategies.id, strategyId));
          }

          // ── Single path lifecycle write: CANDIDATE → PAPER via LifecycleService ──
          // Passes the existing tx so the lifecycle update + audit row stay atomic
          // with the paper session creation and Forge name claim above.
          // Cast tx to typeof db — Drizzle's PgTransaction is structurally compatible
          // with the db handle for query/insert/update/select but lacks `$client`.
          // This matches the pattern used in src/server/lib/db-locks.ts.
          const promoteResult = await lifecycle.promoteStrategy(
            strategyId,
            "CANDIDATE",
            "PAPER",
            { actor: "system", reason: "tier-qualified-auto-promote" },
            tx as unknown as typeof db,
          );
          if (!promoteResult.success) {
            promotionError = promoteResult.error;
            // Throwing inside tx triggers rollback — paper session insert + Forge name claim
            // both revert so we don't end up with a paper session for a non-PAPER strategy.
            throw new Error(`Lifecycle promotion failed: ${promoteResult.error}`);
          }

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

          // Auto-promote context audit row — captures backtest+MC+tier metadata so
          // observers can join lifecycle audit row to its triggering backtest. The
          // canonical "strategy.lifecycle" audit row is written by promoteStrategy()
          // above; this is the supplementary context, NOT the lifecycle event itself.
          await tx.insert(auditLog).values({
            action: "strategy.auto-promote-context",
            entityType: "strategy",
            entityId: strategyId,
            input: { backtestId, tier: result.tier },
            result: {
              paperSessionId: paperSession.id,
              mcSurvivalRate,
              forgeScore: result.forge_score,
            },
            status: "success",
            decisionAuthority: "gate",
            correlationId: correlationId ?? null,
          });

          promotionSucceeded = true;
        });

        // If the tx rolled back, surface the error and bail before stream/SSE
        if (!promotionSucceeded) {
          logger.warn(
            { strategyId, backtestId, error: promotionError },
            "Auto-promote transaction rolled back — strategy not promoted",
          );
          return { id: backtestId, status: "completed", ...result };
        }

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
      correlationId: correlationId ?? null,
    });

    backtestSpan.setAttribute("status", "failed");
    backtestSpan.end();
    broadcastSSE("backtest:failed", { backtestId, strategyId, error: errorMsg });
    return { id: backtestId, status: "failed", error: errorMsg };
  }
}
