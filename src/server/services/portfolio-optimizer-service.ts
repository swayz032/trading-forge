/**
 * Portfolio Optimizer Service — Phase 2.5: Correlation Learning
 *
 * Computes Pearson correlation between strategy daily P&L series
 * to detect over-concentrated portfolios. Target: correlation < 0.3
 * between active strategies. Pairs > 0.5 get flagged as "same bet".
 *
 * Runs daily (or on-demand) across all active paper sessions' last 30 days.
 */

import { eq, and, gte, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  strategies,
  paperSessions,
  paperTrades,
} from "../db/schema.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../index.js";

// ─── Pearson Correlation ────────────────────────────────────────────

export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 5) return 0;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);
  const sumX2 = x.reduce((a, b) => a + b * b, 0);
  const sumY2 = y.reduce((a, b) => a + b * b, 0);
  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2));
  return den === 0 ? 0 : num / den;
}

// ─── Build Daily Return Matrix ──────────────────────────────────────

interface DailyReturnSeries {
  strategyId: string;
  strategyName: string;
  symbol: string;
  dailyPnls: Map<string, number>; // date string -> daily P&L
}

/**
 * Build daily P&L series for each active paper session over the last N days.
 */
async function buildDailyReturnMatrix(
  lookbackDays: number = 30,
): Promise<DailyReturnSeries[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);

  // Get active paper sessions
  const sessions = await db
    .select()
    .from(paperSessions)
    .where(eq(paperSessions.status, "active"));

  if (sessions.length < 2) {
    logger.info("Portfolio optimizer: fewer than 2 active sessions, skipping");
    return [];
  }

  const strategyIds = sessions
    .map((s) => s.strategyId)
    .filter((id): id is string => id !== null);

  // Get strategy metadata
  const strats = await db
    .select({ id: strategies.id, name: strategies.name, symbol: strategies.symbol })
    .from(strategies)
    .where(inArray(strategies.id, strategyIds));

  const stratMap = new Map(strats.map((s) => [s.id, s]));

  const result: DailyReturnSeries[] = [];

  for (const session of sessions) {
    if (!session.strategyId) continue;
    const strat = stratMap.get(session.strategyId);
    if (!strat) continue;

    // Get trades for this session in the lookback window
    const trades = await db
      .select()
      .from(paperTrades)
      .where(
        and(
          eq(paperTrades.sessionId, session.id),
          gte(paperTrades.exitTime, cutoff),
        ),
      )
      .orderBy(paperTrades.exitTime);

    if (trades.length < 3) continue;

    // Aggregate daily P&L
    const dailyPnls = new Map<string, number>();
    for (const trade of trades) {
      if (!trade.exitTime || trade.pnl === null) continue;
      const dateKey = new Date(trade.exitTime).toISOString().split("T")[0];
      dailyPnls.set(dateKey, (dailyPnls.get(dateKey) ?? 0) + Number(trade.pnl));
    }

    result.push({
      strategyId: session.strategyId,
      strategyName: strat.name,
      symbol: strat.symbol,
      dailyPnls,
    });
  }

  return result;
}

// ─── Correlation Matrix ─────────────────────────────────────────────

export interface CorrelationPair {
  strategyA: string;
  strategyB: string;
  nameA: string;
  nameB: string;
  correlation: number;
  overlappingDays: number;
  flagged: boolean; // > 0.5
}

export interface PortfolioSnapshot {
  pairs: CorrelationPair[];
  matrix: Record<string, Record<string, number>>;
  activeStrategies: Array<{ id: string; name: string; symbol: string }>;
  totalHeat: number;
  recommendations: string[];
}

/**
 * Compute the full correlation matrix across all active paper strategies.
 * Aligns daily P&L series to shared trading dates before computing Pearson.
 */
export async function computeCorrelationSnapshot(
  lookbackDays: number = 30,
): Promise<PortfolioSnapshot | null> {
  const series = await buildDailyReturnMatrix(lookbackDays);

  if (series.length < 2) {
    return null;
  }

  // Collect all unique dates across all series
  const allDates = new Set<string>();
  for (const s of series) {
    for (const d of s.dailyPnls.keys()) {
      allDates.add(d);
    }
  }
  const sortedDates = [...allDates].sort();

  const pairs: CorrelationPair[] = [];
  const matrix: Record<string, Record<string, number>> = {};
  const recommendations: string[] = [];

  // Initialize matrix
  for (const s of series) {
    matrix[s.strategyId] = {};
  }

  // Compute pairwise correlations
  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length; j++) {
      const a = series[i];
      const b = series[j];

      // Find overlapping dates
      const sharedDates = sortedDates.filter(
        (d) => a.dailyPnls.has(d) && b.dailyPnls.has(d),
      );

      const xVals = sharedDates.map((d) => a.dailyPnls.get(d)!);
      const yVals = sharedDates.map((d) => b.dailyPnls.get(d)!);

      const corr = pearsonCorrelation(xVals, yVals);
      const roundedCorr = Math.round(corr * 1000) / 1000;
      const flagged = Math.abs(roundedCorr) > 0.5;

      matrix[a.strategyId][b.strategyId] = roundedCorr;
      matrix[b.strategyId][a.strategyId] = roundedCorr;

      pairs.push({
        strategyA: a.strategyId,
        strategyB: b.strategyId,
        nameA: a.strategyName,
        nameB: b.strategyName,
        correlation: roundedCorr,
        overlappingDays: sharedDates.length,
        flagged,
      });

      if (flagged) {
        recommendations.push(
          `HIGH CORRELATION (${roundedCorr.toFixed(2)}): "${a.strategyName}" and "${b.strategyName}" are correlated > 0.5 — treat as one strategy for sizing. Consider replacing one.`,
        );
      }
    }
  }

  // Self-correlations = 1
  for (const s of series) {
    matrix[s.strategyId][s.strategyId] = 1.0;
  }

  // Total portfolio heat = average absolute pairwise correlation
  const avgAbsCorr =
    pairs.length > 0
      ? pairs.reduce((sum, p) => sum + Math.abs(p.correlation), 0) / pairs.length
      : 0;
  const totalHeat = Math.round(avgAbsCorr * 100) / 100;

  if (totalHeat > 0.4) {
    recommendations.push(
      `PORTFOLIO HEAT WARNING: Average pairwise correlation is ${totalHeat.toFixed(2)} — portfolio is over-concentrated. Target < 0.3.`,
    );
  }

  if (series.length < 3) {
    recommendations.push(
      `Only ${series.length} active strategies in paper. Target 2-3 uncorrelated strategies for portfolio diversification.`,
    );
  }

  const activeStrategies = series.map((s) => ({
    id: s.strategyId,
    name: s.strategyName,
    symbol: s.symbol,
  }));

  return { pairs, matrix, activeStrategies, totalHeat, recommendations };
}

// ─── Persist + Broadcast ────────────────────────────────────────────

/**
 * Run the full portfolio correlation analysis, persist snapshot, and broadcast.
 * Called from scheduler or on-demand.
 */
export async function runPortfolioCorrelationCheck(): Promise<PortfolioSnapshot | null> {
  try {
    const snapshot = await computeCorrelationSnapshot(30);

    if (!snapshot) {
      logger.info("Portfolio optimizer: no snapshot generated (< 2 active strategies)");
      return null;
    }

    // NOTE: portfolioSnapshots table was dropped in migration 0055 (writer-only,
    // no readers). Snapshot is now broadcast-only — consumers use SSE.
    // If historical correlation analysis is wanted later, re-introduce a table
    // with an explicit reader endpoint at the same time.

    // Broadcast
    broadcastSSE("portfolio:correlation_snapshot", {
      totalHeat: snapshot.totalHeat,
      flaggedPairs: snapshot.pairs.filter((p) => p.flagged).length,
      activeStrategies: snapshot.activeStrategies.length,
      recommendations: snapshot.recommendations,
      timestamp: new Date().toISOString(),
    });

    if (snapshot.recommendations.length > 0) {
      logger.warn(
        { totalHeat: snapshot.totalHeat, flaggedPairs: snapshot.pairs.filter((p) => p.flagged).length },
        "Portfolio correlation check found issues",
      );
    } else {
      logger.info(
        { totalHeat: snapshot.totalHeat, activeStrategies: snapshot.activeStrategies.length },
        "Portfolio correlation check clean",
      );
    }

    return snapshot;
  } catch (err) {
    logger.error({ err }, "Portfolio correlation check failed");
    return null;
  }
}
