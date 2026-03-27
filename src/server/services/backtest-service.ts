/**
 * Backtest Service — Node↔Python bridge + DB persistence
 *
 * Follows the databento.ts subprocess spawn pattern:
 * - Platform detection (python vs python3)
 * - stdout → JSON.parse
 * - stderr → logging
 */

import { eq, and, sql } from "drizzle-orm";
import { backtests, backtestTrades, stressTestRuns, strategies, paperSessions, auditLog, walkForwardWindows, strategyNames } from "../db/schema.js";
import { broadcastSSE } from "../routes/sse.js";
import { startStream } from "./paper-trading-stream.js";
import { runMonteCarlo } from "./monte-carlo-service.js";
import { queryInfo } from "../../data/loaders/duckdb-service.js";
import { getFirmLimit } from "../../shared/firm-config.js";
import { logger } from "../index.js";
import { runPythonModule } from "../lib/python-runner.js";
import { db } from "../db/index.js";

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
  daily_pnl_records?: Array<{ date: string; pnl: number }>;
  oos_metrics?: Record<string, unknown>;
  confidence?: string;
  windows?: Array<Record<string, unknown>>;
  n_splits?: number;
  param_stability?: Record<string, unknown>;
  error?: string;
}

// 10 minutes max per backtest — prevents matrix from hanging on slow strategies
const BACKTEST_TIMEOUT_MS = 10 * 60 * 1000;

export async function runBacktest(strategyId: string, config: BacktestConfig, strategyClass?: string) {
  // Auto-resolve dates from S3 when omitted
  if (!config.start_date || !config.end_date) {
    const resolved = await resolveDataRange(config.strategy.symbol);
    if (!config.start_date) config.start_date = resolved.start_date;
    if (!config.end_date) config.end_date = resolved.end_date;
  }

  // Insert pending row
  const [row] = await db
    .insert(backtests)
    .values({
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

  // Update to running
  await db
    .update(backtests)
    .set({ status: "running" })
    .where(eq(backtests.id, backtestId));

  try {
    const mode = config.mode ?? "single";
    const result = await runPythonModule<BacktestResult>({
      module: "src.engine.backtester",
      args: [
        "--backtest-id", backtestId,
        "--mode", mode,
        ...(strategyClass ? ["--strategy-class", strategyClass] : []),
      ],
      config: config as unknown as Record<string, unknown>,
      timeoutMs: BACKTEST_TIMEOUT_MS,
      componentName: "backtest-engine",
    });

    if (result.error) {
      await db
        .update(backtests)
        .set({
          status: "failed",
          errorMessage: result.error,
          executionTimeMs: result.execution_time_ms,
        })
        .where(eq(backtests.id, backtestId));

      return { id: backtestId, status: "failed", error: result.error };
    }

    // Walk-forward returns metrics nested under oos_metrics — unwrap for DB storage
    const metrics = result.oos_metrics ?? result;
    // Store full walk-forward structure (windows, confidence, param_stability) separately
    const wfResults: { confidence?: string; windows?: Array<Record<string, unknown>>; n_splits?: number; param_stability?: Record<string, unknown> } | null = result.oos_metrics
      ? { confidence: result.confidence, windows: result.windows as Array<Record<string, unknown>>, n_splits: result.n_splits, param_stability: result.param_stability }
      : (result.walk_forward_results as { confidence?: string; windows?: Array<Record<string, unknown>>; n_splits?: number; param_stability?: Record<string, unknown> } ?? null);

    // Update backtest row with results
    await db
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
        executionTimeMs: result.execution_time_ms,
      })
      .where(eq(backtests.id, backtestId));

    // Persist walk-forward windows for queryability
    if (wfResults?.windows?.length) {
        await db.insert(walkForwardWindows).values(
            wfResults.windows.map((w: any, idx: number) => ({
                backtestId: backtestId,
                windowIndex: w.window ?? idx + 1,
                isStart: w.is_start ?? null,
                isEnd: w.is_end ?? null,
                oosStart: w.oos_start ?? null,
                oosEnd: w.oos_end ?? null,
                bestParams: w.optimization?.best_params ?? null,
                isMetrics: null,
                oosMetrics: w.oos_metrics ?? null,
                paramStability: null,
                confidence: w.confidence ?? null,
            }))
        );
    }

    // Track search budget (cumulative Optuna trials)
    if (wfResults?.windows?.length) {
      const totalTrials = wfResults.windows.reduce(
        (sum: number, w: Record<string, unknown>) => {
          const opt = w.optimization as Record<string, unknown> | undefined;
          return sum + (Number(opt?.trials_used ?? opt?.n_trials ?? 0));
        },
        0,
      );
      if (totalTrials > 0) {
        // Atomic increment to avoid race condition on concurrent backtests
        await db
          .update(strategies)
          .set({
            searchBudgetUsed: sql`COALESCE(${strategies.searchBudgetUsed}, 0) + ${totalTrials}`,
          })
          .where(eq(strategies.id, strategyId));
      }
    }

    // Bulk insert trades (walk-forward may not have trades at top level)
    const trades = result.trades ?? [];
    if (trades.length > 0) {
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

      await db.insert(backtestTrades).values(tradeRows);
    }

    // Persist crisis/stress test results if present
    if (result.crisis_results && typeof result.crisis_results === "object") {
      try {
        const cr = result.crisis_results as Record<string, unknown>;
        await db.insert(stressTestRuns).values({
          backtestId,
          passed: cr.passed === true,
          scenarios: cr.scenarios ?? [],
          failedScenarios: cr.failed_scenarios ?? [],
          executionTimeMs: typeof cr.execution_time_ms === "number" ? cr.execution_time_ms : null,
        });
      } catch (stressErr) {
        logger.warn(stressErr, "Failed to persist stress test results");
      }
    }

    // Audit log
    await db.insert(auditLog).values({
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

    // ─── Optional SQA parameter optimization (fire-and-forget) ───
    if (config.optimizer === "sqa" && config.strategy?.indicators?.length) {
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

          const sqaResult = await runPythonModule({
            module: "src.engine.quantum_annealing_optimizer",
            config: sqaConfig,
            componentName: "sqa-optimizer",
          });

          // Store SQA results on the backtest record
          await db.update(backtests).set({
            walkForwardResults: {
              ...((result.walk_forward_results ?? {}) as Record<string, unknown>),
              sqa_optimization: {
                best_params: (sqaResult as any).best_params,
                best_energy: (sqaResult as any).best_energy,
                robust_plateau: (sqaResult as any).robust_plateau,
                method: "sqa",
                governance: { experimental: true, decision_role: "challenger_only" },
              },
            },
          }).where(eq(backtests.id, backtestId));
          
          logger.info({ backtestId, bestParams: (sqaResult as any).best_params }, "SQA optimization completed");
        } catch (sqaErr) {
          logger.error({ backtestId, err: sqaErr }, "SQA optimization failed (non-blocking)");
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

    // ─── Auto-promote to paper trading if strategy passes gates ───
    if (result.tier && ["TIER_1", "TIER_2", "TIER_3"].includes(result.tier)) {
      try {
        // Auto-name assignment for TIER_1 strategies
        if (result.tier === "TIER_1") {
          try {
            // Idempotency: skip if strategy already has a Forge name
            const [existingName] = await db
              .select()
              .from(strategyNames)
              .where(eq(strategyNames.strategyId, strategyId))
              .limit(1);

            if (existingName) {
              logger.info({ strategyId, forgeName: existingName.fullName }, "Strategy already has Forge name, skipping");
            } else {
              // Atomic claim: UPDATE ... WHERE claimed=false RETURNING * (race-safe)
              const [claimedName] = await db
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
                    // Use a subquery-like approach: only claim the first unclaimed row
                    eq(strategyNames.id, sql`(SELECT id FROM strategy_names WHERE claimed = false AND retired = false LIMIT 1 FOR UPDATE SKIP LOCKED)`),
                  )
                )
                .returning();

              if (claimedName) {
                await db.update(strategies).set({
                  name: claimedName.fullName,
                }).where(eq(strategies.id, strategyId));

                logger.info({
                  strategyId,
                  forgeName: claimedName.fullName,
                  codename: claimedName.codename,
                }, "Strategy auto-named on TIER_1 promotion");

                await db.insert(auditLog).values({
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
                await db.update(strategies).set({
                  name: fallbackName,
                }).where(eq(strategies.id, strategyId));
                logger.warn({ strategyId, fallbackName }, "No codenames available, used fallback name");
              }
            }
          } catch (nameErr) {
            logger.warn(nameErr, "Auto-naming failed (non-blocking)");
          }
        }

        // Update strategy lifecycle to PAPER
        await db.update(strategies).set({
          lifecycleState: "PAPER",
          lifecycleChangedAt: new Date(),
          forgeScore: result.forge_score != null ? String(result.forge_score) : null,
        }).where(eq(strategies.id, strategyId));

        // Create paper trading session
        const [paperSession] = await db.insert(paperSessions).values({
          strategyId,
          startingCapital: "50000",
          currentEquity: "50000",
          config: {
            preferred_sessions: ["NY_RTH"],
            max_concurrent_positions: 1,
            cooldown_bars: 4,
            daily_loss_limit: (() => {
              const firmKey = config.firm_key;
              if (firmKey) {
                // firm_key may be "topstep_50k" — strip the account suffix for lookup
                const firmName = firmKey.replace(/_\d+k$/i, "");
                const limits = getFirmLimit(firmName);
                if (limits) {
                  return limits.dailyLossLimit ?? limits.maxDrawdown;
                }
              }
              return 2000; // fallback if no firm configured
            })(),
            backtestId,
            tier: result.tier,
            forge_score: result.forge_score,
          },
        }).returning();

        // Start live stream for the paper session
        try {
          startStream(paperSession.id, [config.strategy.symbol]);
        } catch (streamErr) {
          logger.warn(streamErr, "Auto-promoted session created but stream failed to start");
        }

        // Broadcast promotion event
        broadcastSSE("strategy:promoted", {
          strategyId,
          tier: result.tier,
          forgeScore: result.forge_score,
          paperSessionId: paperSession.id,
        });

        logger.info({
          strategyId,
          tier: result.tier,
          paperSessionId: paperSession.id,
        }, "Strategy auto-promoted to paper trading");

        await db.insert(auditLog).values({
          action: "strategy.auto-promote",
          entityType: "strategy",
          entityId: strategyId,
          input: { backtestId, tier: result.tier },
          result: { paperSessionId: paperSession.id },
          status: "success",
        });
      } catch (promoErr) {
        logger.error(promoErr, "Failed to auto-promote strategy to paper trading");
      }
    }

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
    });

    return { id: backtestId, status: "failed", error: errorMsg };
  }
}
