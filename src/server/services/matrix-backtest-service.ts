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
  // Atomic index: each worker grabs-and-increments before awaiting,
  // so no two workers process the same combo even though JS is
  // single-threaded (the race was between the check and the await).
  let nextIdx = 0;

  async function runNext(): Promise<void> {
    while (nextIdx < combos.length) {
      const myIdx = nextIdx++;
      const combo = combos[myIdx];
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

// ─── Cross-Instrument Correlation ──────────────────────────

interface CorrelationResult {
  symbol1: string;
  symbol2: string;
  correlation: number;
  warning: string | null;
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 30) return 0; // Not enough data

  const meanX = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const meanY = y.slice(0, n).reduce((a, b) => a + b, 0) / n;

  let sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    sumXY += dx * dy;
    sumX2 += dx * dx;
    sumY2 += dy * dy;
  }

  const denom = Math.sqrt(sumX2 * sumY2);
  return denom === 0 ? 0 : sumXY / denom;
}

// Known correlation priors for futures pairs (empirical baselines)
const KNOWN_CORRELATIONS: Record<string, number> = {
  "ES-NQ": 0.90,
  "ES-YM": 0.85,
  "NQ-YM": 0.80,
  "ES-RTY": 0.75,
  "NQ-RTY": 0.70,
  "CL-GC": 0.25,
};

async function computeCorrelations(
  results: MatrixResult[],
): Promise<CorrelationResult[]> {
  // Pick the best-scoring result per symbol (forgeScore >= 30 only)
  const symbolBest = new Map<string, MatrixResult>();
  for (const r of results) {
    if (r.forgeScore < 30) continue;
    const current = symbolBest.get(r.symbol);
    if (!current || r.forgeScore > current.forgeScore) {
      symbolBest.set(r.symbol, r);
    }
  }

  const symbols = Array.from(symbolBest.keys());
  const correlations: CorrelationResult[] = [];

  // Try to load daily P&Ls from backtests table for real correlation
  const dailyPnlsBySymbol = new Map<string, number[]>();
  for (const [symbol, best] of symbolBest) {
    if (!best.backtestId) continue;
    try {
      const [bt] = await db
        .select({ dailyPnls: backtests.dailyPnls })
        .from(backtests)
        .where(eq(backtests.id, best.backtestId))
        .limit(1);
      if (bt?.dailyPnls && Array.isArray(bt.dailyPnls)) {
        dailyPnlsBySymbol.set(symbol, bt.dailyPnls as number[]);
      }
    } catch {
      // Silently fall back to known priors
    }
  }

  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const s1 = symbols[i];
      const s2 = symbols[j];

      // Compute real correlation if we have daily P&L data for both
      const pnl1 = dailyPnlsBySymbol.get(s1);
      const pnl2 = dailyPnlsBySymbol.get(s2);
      let corr: number;

      if (pnl1 && pnl2 && Math.min(pnl1.length, pnl2.length) >= 30) {
        corr = pearsonCorrelation(pnl1, pnl2);
      } else {
        // Fall back to known priors
        const pair = [s1, s2].sort().join("-");
        corr = KNOWN_CORRELATIONS[pair] ?? 0.3;
      }

      let warning: string | null = null;
      if (corr > 0.7) {
        warning = `${s1} and ${s2} highly correlated (${corr.toFixed(2)}) — pick the better one, don't run both`;
      } else if (corr > 0.5) {
        warning = `${s1} and ${s2} correlated (${corr.toFixed(2)}) — treat as one strategy for sizing`;
      }

      correlations.push({ symbol1: s1, symbol2: s2, correlation: corr, warning });
    }
  }

  return correlations;
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

    broadcastSSE("backtest:matrix-tier", {
      matrixId, tier: "tier2",
      survivingSymbols: Array.from(survivingSymbols),
      tier1Completed: tier1Results.length,
    });

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
    // Rank symbols by best score across tier 1+2, gate by promotion cutoff.
    // 1min backtests are expensive; only run for symbols that earned it.
    const symbolScores = new Map<string, number>();
    for (const r of [...tier1Results, ...tier2Results]) {
      const current = symbolScores.get(r.symbol) ?? 0;
      symbolScores.set(r.symbol, Math.max(current, r.forgeScore));
    }
    const tier3Symbols = Array.from(symbolScores.entries())
      .filter(([, score]) => score >= FORGE_SCORE_PROMOTION_CUTOFF)
      .sort((a, b) => b[1] - a[1])
      .slice(0, TIER3_MAX_SYMBOLS)
      .map(([sym]) => sym);

    broadcastSSE("backtest:matrix-tier", {
      matrixId, tier: "tier3",
      tier3Symbols,
      tier2Completed: tier2Results.length,
    });

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
    if (allResults.length === 0) {
      await db.update(backtestMatrix).set({
        status: "completed",
        completedCombos: 0,
        results: [],
        tierStatus: { tier1: "completed", tier2: "completed", tier3: "completed" },
        executionTimeMs: Date.now() - startTime,
      }).where(eq(backtestMatrix.id, matrixId));
      return { id: matrixId, status: "completed", totalCombos: 0, results: [], correlations: [] };
    }

    const bestCombo = allResults.reduce((best, r) =>
      r.forgeScore > best.forgeScore ? r : best, allResults[0]);

    // ─── Cross-Instrument Correlation Check ──────────────
    const correlations = await computeCorrelations(allResults);
    const highCorrWarnings = correlations.filter((c) => c.warning !== null);
    if (highCorrWarnings.length > 0) {
      logger.warn(
        { matrixId, warnings: highCorrWarnings.map((c) => c.warning) },
        "Matrix correlation warnings — review before deploying multiple symbols",
      );
    }

    const elapsedMs = Date.now() - startTime;

    await db.update(backtestMatrix).set({
      status: "completed",
      completedCombos: allResults.length,
      results: allResults as any,
      bestCombo: bestCombo as any,
      correlations: correlations as any,
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
      correlations,
      executionTimeMs: elapsedMs,
    });

    logger.info({
      matrixId, strategyId,
      totalCombos: allResults.length,
      bestScore: bestCombo.forgeScore,
      bestCombo: `${bestCombo.symbol}/${bestCombo.timeframe}`,
      correlationPairs: correlations.length,
      highCorrWarnings: highCorrWarnings.length,
      elapsedMs,
    }, "Matrix completed");

    // Enforce correlation: flag highly correlated symbols for downstream consumers
    const correlationBlocked = correlations
      .filter((c) => c.correlation > 0.7)
      .map((c) => ({ pair: [c.symbol1, c.symbol2], correlation: c.correlation }));

    return {
      id: matrixId,
      status: "completed",
      totalCombos: allResults.length,
      bestCombo,
      results: allResults,
      correlations,
      correlationBlocked,
      executionTimeMs: elapsedMs,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await db.update(backtestMatrix).set({
      status: "failed",
      executionTimeMs: Date.now() - startTime,
    }).where(eq(backtestMatrix.id, matrixId));

    broadcastSSE("backtest:matrix-failed", {
      matrixId,
      strategyId,
      error: errorMsg,
      completedCombos,
    });

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
