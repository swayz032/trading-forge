import { db } from "../db/index.js";
import { backtests, paperTrades, complianceReviews, paperSessions, strategies } from "../db/schema.js";
import { eq, desc, and, isNull, inArray } from "drizzle-orm";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../index.js";

export interface DriftReport {
  strategyId: string;
  metric: string;
  backtestValue: number;
  liveValue: number;
  deviationStdDevs: number;
  severity: "ok" | "investigate" | "alert";
  message: string;
}

// Calculate standard deviation
function stdDev(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

// Compare live paper trading metrics against backtest expectations
export async function detectDrift(strategyId: string, sessionId: string): Promise<DriftReport[]> {
  // Get latest completed backtest for this strategy
  const [backtest] = await db.select().from(backtests)
    .where(and(eq(backtests.strategyId, strategyId), eq(backtests.status, "completed")))
    .orderBy(desc(backtests.createdAt))
    .limit(1);

  if (!backtest) return [];

  // Get paper trades for this session (ordered by exit time — critical for drawdown calc)
  const trades = await db.select().from(paperTrades)
    .where(eq(paperTrades.sessionId, sessionId))
    .orderBy(paperTrades.exitTime);

  if (trades.length < 5) return []; // Need enough data to compare

  const reports: DriftReport[] = [];

  // Compare win rate
  const liveWins = trades.filter(t => Number(t.pnl) > 0).length;
  const liveWinRate = liveWins / trades.length;
  const backtestWinRate = Number(backtest.winRate ?? 0);

  if (backtestWinRate > 0) {
    const winRateDiff = Math.abs(liveWinRate - backtestWinRate);
    const expectedStdDev = Math.sqrt(backtestWinRate * (1 - backtestWinRate) / trades.length);
    const deviationStdDevs = expectedStdDev > 0 ? winRateDiff / expectedStdDev : 0;

    reports.push({
      strategyId,
      metric: "winRate",
      backtestValue: backtestWinRate,
      liveValue: liveWinRate,
      deviationStdDevs: Math.round(deviationStdDevs * 100) / 100,
      severity: deviationStdDevs > 2 ? "alert" : deviationStdDevs > 1 ? "investigate" : "ok",
      message: deviationStdDevs > 2
        ? `Win rate drifted ${deviationStdDevs.toFixed(1)}\u03C3 from backtest (${(backtestWinRate * 100).toFixed(0)}% \u2192 ${(liveWinRate * 100).toFixed(0)}%)`
        : `Win rate within expected range`,
    });
  }

  // Compare avg trade P&L
  const livePnls = trades.map(t => Number(t.pnl));
  const liveAvgPnl = livePnls.reduce((a, b) => a + b, 0) / livePnls.length;
  const backtestAvgPnl = Number(backtest.avgTradePnl ?? 0);
  const pnlStdDev = stdDev(livePnls);

  if (pnlStdDev > 0 && backtestAvgPnl !== 0) {
    const pnlDeviation = Math.abs(liveAvgPnl - backtestAvgPnl) / pnlStdDev;

    reports.push({
      strategyId,
      metric: "avgTradePnl",
      backtestValue: backtestAvgPnl,
      liveValue: Math.round(liveAvgPnl * 100) / 100,
      deviationStdDevs: Math.round(pnlDeviation * 100) / 100,
      severity: pnlDeviation > 2 ? "alert" : pnlDeviation > 1 ? "investigate" : "ok",
      message: pnlDeviation > 2
        ? `Avg trade P&L drifted ${pnlDeviation.toFixed(1)}\u03C3 ($${backtestAvgPnl.toFixed(0)} \u2192 $${liveAvgPnl.toFixed(0)})`
        : `Avg trade P&L within expected range`,
    });
  }

  // Compare max drawdown
  let maxDrawdown = 0;
  let peak = 0;
  let cumPnl = 0;
  for (const pnl of livePnls) {
    cumPnl += pnl;
    if (cumPnl > peak) peak = cumPnl;
    const drawdown = peak - cumPnl;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  const backtestMaxDD = Math.abs(Number(backtest.maxDrawdown ?? 0));
  if (backtestMaxDD > 0) {
    const ddRatio = maxDrawdown / backtestMaxDD;
    reports.push({
      strategyId,
      metric: "maxDrawdown",
      backtestValue: backtestMaxDD,
      liveValue: Math.round(maxDrawdown * 100) / 100,
      deviationStdDevs: Math.round(ddRatio * 100) / 100,
      severity: ddRatio > 1.5 ? "alert" : ddRatio > 1.0 ? "investigate" : "ok",
      message: ddRatio > 1.5
        ? `Live drawdown exceeds backtest by ${((ddRatio - 1) * 100).toFixed(0)}%`
        : `Drawdown within expected range`,
    });
  }

  // Broadcast alerts for any high-severity drift
  const alerts = reports.filter(r => r.severity === "alert");
  if (alerts.length > 0) {
    broadcastSSE("drift:alert", { strategyId, sessionId, alerts });
    logger.warn({ strategyId, alerts }, "Drift detected in paper trading");

    // Auto-demote from PAPER to DECLINING if any metric exceeds 2σ
    const maxDrift = Math.max(...alerts.map(a => a.deviationStdDevs));
    if (maxDrift > 2.0) {
      try {
        const { LifecycleService } = await import("./lifecycle-service.js");
        const lifecycle = new LifecycleService();
        await lifecycle.promoteStrategy(strategyId, "PAPER", "DECLINING");
        broadcastSSE("strategy:drift-demotion", { strategyId, driftSeverity: maxDrift });
        logger.warn({ strategyId, driftSeverity: maxDrift }, "Strategy auto-demoted due to drift > 2σ");
      } catch (demoteErr) {
        logger.error({ strategyId, err: demoteErr }, "Auto-demotion from drift failed");
      }
    }
  }

  return reports;
}

/**
 * Enhanced drift detection using PELT structural break detection.
 * Calls Python changepoint module for edge-death analysis.
 */
export async function detectStructuralBreaks(
  dailyPnls: number[],
  rollingSharpe: number[],
): Promise<{ edgeDeathDetected: boolean; deathDay: number | null; pnlBreaks: number[]; sharpeBreaks: number[] }> {
  try {
    const { runPythonModule } = await import("../lib/python-runner.js");
    const result = await runPythonModule<{
      edge_death_detected: boolean;
      death_day: number | null;
      pnl_breaks: { breakpoints: number[] };
      sharpe_breaks: { breakpoints: number[] };
    }>({
      module: "src.engine.changepoint",
      config: { daily_pnls: dailyPnls, rolling_sharpe: rollingSharpe, mode: "edge_death" },
      timeoutMs: 15_000,
      componentName: "changepoint-detection",
    });

    return {
      edgeDeathDetected: result.edge_death_detected ?? false,
      deathDay: result.death_day ?? null,
      pnlBreaks: result.pnl_breaks?.breakpoints ?? [],
      sharpeBreaks: result.sharpe_breaks?.breakpoints ?? [],
    };
  } catch {
    // Fallback: no structural breaks detected (changepoint module may not be available)
    return { edgeDeathDetected: false, deathDay: null, pnlBreaks: [], sharpeBreaks: [] };
  }
}

// ─── Compliance Cascade Revalidation ────────────────────────────────

/**
 * Cascade revalidation for a firm: invalidates all active compliance reviews,
 * pauses DEPLOYED strategies tied to that firm, and emits a critical alert.
 *
 * Called when drift detection finds that a firm's rules have changed.
 * This ensures no strategy runs under stale compliance assumptions.
 */
export async function cascadeRevalidation(firm: string): Promise<{
  invalidatedReviews: number;
  pausedStrategies: string[];
}> {
  logger.warn({ firm }, "Compliance cascade: invalidating all reviews and pausing strategies");

  // 1. Invalidate all non-invalidated reviews for this firm
  const invalidated = await db
    .update(complianceReviews)
    .set({
      invalidatedAt: new Date(),
      invalidationReason: `Automatic cascade: drift detected for ${firm} rules`,
    })
    .where(
      and(
        eq(complianceReviews.firm, firm),
        isNull(complianceReviews.invalidatedAt),
      ),
    )
    .returning({ id: complianceReviews.id, strategyId: complianceReviews.strategyId });

  const affectedStrategyIds = [
    ...new Set(invalidated.map((r) => r.strategyId).filter((id): id is string => id !== null)),
  ];

  // 2. Pause DEPLOYED strategies that have compliance reviews at this firm
  const pausedStrategies: string[] = [];

  if (affectedStrategyIds.length > 0) {
    // Find which of these strategies are currently DEPLOYED
    const deployedStrats = await db
      .select({ id: strategies.id })
      .from(strategies)
      .where(
        and(
          inArray(strategies.id, affectedStrategyIds),
          eq(strategies.lifecycleState, "DEPLOYED"),
        ),
      );

    for (const strat of deployedStrats) {
      try {
        const { LifecycleService } = await import("./lifecycle-service.js");
        const lifecycle = new LifecycleService();
        await lifecycle.promoteStrategy(strat.id, "DEPLOYED", "DECLINING");
        pausedStrategies.push(strat.id);
        logger.warn({ strategyId: strat.id, firm }, "Strategy demoted to DECLINING due to compliance cascade");
      } catch (err) {
        logger.error({ strategyId: strat.id, err }, "Failed to demote strategy during compliance cascade");
      }
    }

    // Also pause active paper sessions for affected strategies
    for (const stratId of affectedStrategyIds) {
      try {
        await db
          .update(paperSessions)
          .set({ status: "paused", pausedAt: new Date() })
          .where(
            and(
              eq(paperSessions.strategyId, stratId),
              eq(paperSessions.status, "active"),
            ),
          );
      } catch {
        // Non-blocking
      }
    }
  }

  // 3. Emit critical alert via SSE
  broadcastSSE("compliance:cascade_revalidation", {
    firm,
    invalidatedReviews: invalidated.length,
    pausedStrategies,
    affectedStrategyIds,
    severity: "critical",
    message: `Compliance cascade: ${firm} rules changed — ${invalidated.length} reviews invalidated, ${pausedStrategies.length} strategies paused`,
    timestamp: new Date().toISOString(),
  });

  // 4. Emit via agent coordinator if available
  try {
    const { agentCoordinator } = await import("./agent-coordinator-service.js");
    await agentCoordinator.emit("compliance:invalidated", {
      firm,
      affectedStrategies: affectedStrategyIds,
      reason: `Drift detected — ${invalidated.length} reviews invalidated`,
    });
  } catch {
    // Agent coordinator may not be initialized yet
  }

  logger.warn(
    { firm, invalidatedReviews: invalidated.length, pausedStrategies: pausedStrategies.length },
    "Compliance cascade complete",
  );

  return { invalidatedReviews: invalidated.length, pausedStrategies };
}

// Rolling 30-day Sharpe calculation for alpha decay monitoring
export function calculateRollingSharpe(dailyPnls: number[]): number {
  if (dailyPnls.length < 5) return 0;
  const recent = dailyPnls.slice(-30);
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const sd = stdDev(recent);
  if (sd === 0) return 0;
  return (mean / sd) * Math.sqrt(252);
}
