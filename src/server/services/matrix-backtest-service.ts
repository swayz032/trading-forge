/**
 * Matrix Backtest Service — Tiered cross-symbol × timeframe testing.
 *
 * Runs 42 combos (6 symbols × 7 timeframes) in 3 tiers:
 *   Tier 1: Fast scan (30min, 1hr, 4hr, daily × 6 symbols) — ~2 min
 *   Tier 2: Medium (15min, 5min × survivors scoring > 30) — ~5 min
 *   Tier 3: Heavy (1min × top 3-4 from Tier 2) — ~4 min
 *
 * Total wall time on Skytech (8-16 cores, 32-64GB RAM): ~11 min
 */

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { backtestMatrix, backtests, strategies } from "../db/schema.js";
import { runBacktest } from "./backtest-service.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../index.js";

const ALL_SYMBOLS = ["ES", "NQ", "CL", "YM", "RTY", "GC"] as const;
const TIER1_TIMEFRAMES = ["30min", "1hour", "4hour", "daily"];
const TIER2_TIMEFRAMES = ["15min", "5min"];
const TIER3_TIMEFRAMES = ["1min"];

const FORGE_SCORE_TIER1_CUTOFF = 30;
const FORGE_SCORE_PROMOTION_CUTOFF = 60;
const TIER2_MAX_SYMBOLS = 6; // All survivors
const TIER3_MAX_SYMBOLS = 4;

// Concurrency limits per tier
const TIER1_CONCURRENCY = 6;
const TIER2_CONCURRENCY = 4;
const TIER3_CONCURRENCY = 3;

interface MatrixCombo {
  symbol: string;
  timeframe: string;
}

interface MatrixResult {
  symbol: string;
  timeframe: string;
  forgeScore: number;
  sharpe: number;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  avgDailyPnl: number;
  maxDrawdown: number;
  tier: string;
  backtestId: string;
  executionTimeMs: number;
}

/**
 * Run combos with a concurrency limit using Promise pool pattern.
 */
async function runWithConcurrency(
  combos: MatrixCombo[],
  strategyId: string,
  strategyConfig: Record<string, unknown>,
  concurrency: number,
  matrixId: string,
  onComplete: (result: MatrixResult) => void,
): Promise<MatrixResult[]> {
  const results: MatrixResult[] = [];
  let idx = 0;

  async function runNext(): Promise<void> {
    while (idx < combos.length) {
      const combo = combos[idx++];
      try {
        const config = {
          strategy: {
            ...strategyConfig,
            symbol: combo.symbol,
            timeframe: combo.timeframe,
          },
          mode: "walkforward" as const,
        };

        const result = await runBacktest(strategyId, config as any);
        const matrixResult: MatrixResult = {
          symbol: combo.symbol,
          timeframe: combo.timeframe,
          forgeScore: result.forge_score ?? 0,
          sharpe: result.sharpe_ratio ?? 0,
          totalTrades: result.total_trades ?? 0,
          winRate: result.win_rate ?? 0,
          profitFactor: result.profit_factor ?? 0,
          avgDailyPnl: result.avg_daily_pnl ?? 0,
          maxDrawdown: result.max_drawdown ?? 0,
          tier: result.tier ?? "REJECTED",
          backtestId: result.id,
          executionTimeMs: result.execution_time_ms ?? 0,
        };
        results.push(matrixResult);
        onComplete(matrixResult);
      } catch (err) {
        logger.error({ combo, err }, "Matrix combo failed");
        const failResult: MatrixResult = {
          symbol: combo.symbol,
          timeframe: combo.timeframe,
          forgeScore: 0,
          sharpe: 0,
          totalTrades: 0,
          winRate: 0,
          profitFactor: 0,
          avgDailyPnl: 0,
          maxDrawdown: 0,
          tier: "REJECTED",
          backtestId: "",
          executionTimeMs: 0,
        };
        results.push(failResult);
        onComplete(failResult);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, combos.length) }, () => runNext());
  await Promise.allSettled(workers);
  return results;
}

export async function runMatrix(strategyId: string) {
  const startTime = Date.now();

  // Load strategy config
  const [strat] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, strategyId))
    .limit(1);

  if (!strat) throw new Error(`Strategy ${strategyId} not found`);

  const strategyConfig = strat.config as Record<string, unknown>;

  // Calculate total combos
  const tier1Combos: MatrixCombo[] = [];
  for (const symbol of ALL_SYMBOLS) {
    for (const tf of TIER1_TIMEFRAMES) {
      tier1Combos.push({ symbol, timeframe: tf });
    }
  }
  // Tier 2 and 3 combos determined after tier 1 results
  const totalEstimate = ALL_SYMBOLS.length * (TIER1_TIMEFRAMES.length + TIER2_TIMEFRAMES.length + TIER3_TIMEFRAMES.length);

  // Create matrix row
  const [matrixRow] = await db
    .insert(backtestMatrix)
    .values({
      strategyId,
      status: "tier1",
      totalCombos: totalEstimate,
      tierStatus: { tier1: "running", tier2: "pending", tier3: "pending" },
    })
    .returning();

  const matrixId = matrixRow.id;
  let completedCombos = 0;
  const allResults: MatrixResult[] = [];

  const updateProgress = async (result: MatrixResult, tierLabel: string) => {
    completedCombos++;
    allResults.push(result);

    // Update DB progress
    await db
      .update(backtestMatrix)
      .set({
        completedCombos,
        results: allResults as any,
      })
      .where(eq(backtestMatrix.id, matrixId));

    // SSE broadcast
    broadcastSSE("backtest:matrix-progress", {
      matrixId,
      tier: tierLabel,
      completed: completedCombos,
      total: totalEstimate,
      latest: {
        symbol: result.symbol,
        timeframe: result.timeframe,
        forgeScore: result.forgeScore,
        tier: result.tier,
      },
    });
  };

  try {
    // ─── Tier 1: Fast scan ─────────────────────────────────
    logger.info({ matrixId, combos: tier1Combos.length }, "Matrix Tier 1 starting");

    const tier1Results = await runWithConcurrency(
      tier1Combos, strategyId, strategyConfig,
      TIER1_CONCURRENCY, matrixId,
      (r) => updateProgress(r, "tier1"),
    );

    // Filter: symbols that scored > cutoff in ANY timeframe
    const survivingSymbols = new Set<string>();
    for (const r of tier1Results) {
      if (r.forgeScore >= FORGE_SCORE_TIER1_CUTOFF) {
        survivingSymbols.add(r.symbol);
      }
    }

    await db.update(backtestMatrix).set({
      status: "tier2",
      tierStatus: { tier1: "completed", tier2: "running", tier3: "pending" },
    }).where(eq(backtestMatrix.id, matrixId));

    // ─── Tier 2: Medium (5min, 15min × survivors) ──────────
    const tier2Symbols = Array.from(survivingSymbols).slice(0, TIER2_MAX_SYMBOLS);
    const tier2Combos: MatrixCombo[] = [];
    for (const symbol of tier2Symbols) {
      for (const tf of TIER2_TIMEFRAMES) {
        tier2Combos.push({ symbol, timeframe: tf });
      }
    }

    logger.info({ matrixId, combos: tier2Combos.length, symbols: tier2Symbols }, "Matrix Tier 2 starting");

    let tier2Results: MatrixResult[] = [];
    if (tier2Combos.length > 0) {
      tier2Results = await runWithConcurrency(
        tier2Combos, strategyId, strategyConfig,
        TIER2_CONCURRENCY, matrixId,
        (r) => updateProgress(r, "tier2"),
      );
    }

    await db.update(backtestMatrix).set({
      status: "tier3",
      tierStatus: { tier1: "completed", tier2: "completed", tier3: "running" },
    }).where(eq(backtestMatrix.id, matrixId));

    // ─── Tier 3: Heavy (1min × top symbols) ────────────────
    // Rank symbols by best score across tier 1+2
    const symbolScores = new Map<string, number>();
    for (const r of [...tier1Results, ...tier2Results]) {
      const current = symbolScores.get(r.symbol) ?? 0;
      symbolScores.set(r.symbol, Math.max(current, r.forgeScore));
    }
    const tier3Symbols = Array.from(symbolScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TIER3_MAX_SYMBOLS)
      .map(([sym]) => sym);

    const tier3Combos: MatrixCombo[] = tier3Symbols.map((symbol) => ({
      symbol,
      timeframe: "1min",
    }));

    logger.info({ matrixId, combos: tier3Combos.length, symbols: tier3Symbols }, "Matrix Tier 3 starting");

    if (tier3Combos.length > 0) {
      await runWithConcurrency(
        tier3Combos, strategyId, strategyConfig,
        TIER3_CONCURRENCY, matrixId,
        (r) => updateProgress(r, "tier3"),
      );
    }

    // ─── Finalize ──────────────────────────────────────────
    const bestCombo = allResults.reduce((best, r) =>
      r.forgeScore > best.forgeScore ? r : best, allResults[0]);

    const elapsedMs = Date.now() - startTime;

    await db.update(backtestMatrix).set({
      status: "completed",
      completedCombos: allResults.length,
      results: allResults as any,
      bestCombo: bestCombo as any,
      tierStatus: { tier1: "completed", tier2: "completed", tier3: "completed" },
      executionTimeMs: elapsedMs,
    }).where(eq(backtestMatrix.id, matrixId));

    broadcastSSE("backtest:matrix-completed", {
      matrixId,
      strategyId,
      totalCombos: allResults.length,
      bestCombo: {
        symbol: bestCombo.symbol,
        timeframe: bestCombo.timeframe,
        forgeScore: bestCombo.forgeScore,
      },
      executionTimeMs: elapsedMs,
    });

    logger.info({
      matrixId, strategyId,
      totalCombos: allResults.length,
      bestScore: bestCombo.forgeScore,
      bestCombo: `${bestCombo.symbol}/${bestCombo.timeframe}`,
      elapsedMs,
    }, "Matrix completed");

    return {
      id: matrixId,
      status: "completed",
      totalCombos: allResults.length,
      bestCombo,
      results: allResults,
      executionTimeMs: elapsedMs,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await db.update(backtestMatrix).set({
      status: "failed",
    }).where(eq(backtestMatrix.id, matrixId));

    logger.error({ matrixId, err }, "Matrix failed");
    return { id: matrixId, status: "failed", error: errorMsg };
  }
}

export async function getMatrixStatus(matrixId: string) {
  const [row] = await db
    .select()
    .from(backtestMatrix)
    .where(eq(backtestMatrix.id, matrixId))
    .limit(1);

  return row ?? null;
}
