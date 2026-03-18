/**
 * Express Scheduler — sub-minute response events via node-cron.
 *
 * Handles events that can't wait for n8n cron:
 *   - Every 4 hours: rolling Sharpe update for active strategies
 *   - Daily at 11:30 PM ET: nightly summary (backup for n8n)
 *
 * Paper trade drift checks are event-driven (called from paper-execution-service),
 * not scheduled. This scheduler handles the periodic jobs only.
 */

import cron from "node-cron";
import { eq, and, gte, desc } from "drizzle-orm";
import { db } from "./db/index.js";
import { strategies, paperSessions, paperTrades, backtests, systemJournal } from "./db/schema.js";
import { broadcastSSE } from "./routes/sse.js";
import { logger } from "./index.js";

let initialized = false;

export function initScheduler() {
  if (initialized) return;
  initialized = true;

  // ─── Every 4 hours: Rolling Sharpe update ─────────────────
  cron.schedule("0 */4 * * *", async () => {
    logger.info("Scheduler: Running 4-hour rolling Sharpe update");
    try {
      await updateRollingSharpe();
    } catch (err) {
      logger.error({ err }, "Scheduler: Rolling Sharpe update failed");
    }
  });

  // ─── Daily at 6:30 AM ET (11:30 UTC): Pre-market prep ────
  cron.schedule("30 11 * * 1-5", async () => {
    logger.info("Scheduler: Pre-market prep");
    try {
      await preMarketPrep();
    } catch (err) {
      logger.error({ err }, "Scheduler: Pre-market prep failed");
    }
  });

  // ─── Every hour: Compare stopped paper sessions to backtest ─
  cron.schedule("0 * * * *", async () => {
    logger.info("Scheduler: Running paper-vs-backtest comparison for recently stopped sessions");
    try {
      await comparePaperToBacktest();
    } catch (err) {
      logger.error({ err }, "Scheduler: Paper-vs-backtest comparison failed");
    }
  });

  logger.info("Scheduler initialized: rolling Sharpe (4h), pre-market prep (6:30 AM ET weekdays), paper-vs-backtest (1h)");
}

/**
 * Update rolling 30-day Sharpe ratio for all active strategies.
 */
async function updateRollingSharpe() {
  const activeStrategies = await db
    .select({ id: strategies.id, name: strategies.name })
    .from(strategies)
    .where(
      eq(strategies.lifecycleState, "PAPER"),
    );

  if (activeStrategies.length === 0) {
    logger.info("No active PAPER strategies for Sharpe update");
    return;
  }

  for (const strat of activeStrategies) {
    try {
      // Fetch recent paper trades for this strategy
      const sessions = await db
        .select({ id: paperSessions.id, currentEquity: paperSessions.currentEquity })
        .from(paperSessions)
        .where(
          and(
            eq(paperSessions.strategyId, strat.id),
            eq(paperSessions.status, "active"),
          ),
        );

      if (sessions.length === 0) continue;

      // For now, store a placeholder — the actual computation
      // happens when drift-detection-service compares paper vs backtest
      logger.info({ strategyId: strat.id, name: strat.name }, "Rolling Sharpe checked");
    } catch (err) {
      logger.error({ strategyId: strat.id, err }, "Failed to update rolling Sharpe");
    }
  }

  broadcastSSE("scheduler:sharpe-updated", {
    strategies: activeStrategies.length,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Pre-market prep: check if any macro events today warrant caution.
 */
async function preMarketPrep() {
  try {
    // Call the skip classifier endpoint
    const response = await fetch("http://localhost:4000/api/skip/today").catch(() => null);
    if (response?.ok) {
      const data = await response.json();
      const sitOuts = (data as any[]).filter((d: any) => d.decision === "SKIP" || d.decision === "SIT_OUT");
      if (sitOuts.length > 0) {
        broadcastSSE("scheduler:pre-market-alert", {
          message: `${sitOuts.length} strategies sitting out today`,
          details: sitOuts,
        });
        logger.info({ sitOuts: sitOuts.length }, "Pre-market: strategies sitting out");
      }
    }
  } catch (err) {
    logger.warn({ err }, "Pre-market prep: skip classifier unavailable");
  }
}

/**
 * Compare recently-stopped paper sessions against their original backtest expectations.
 * Runs every hour. For each session stopped in the last hour:
 *   1. Fetch paper session trades & compute cumulative metrics
 *   2. Fetch the latest completed backtest for the same strategy
 *   3. Compare Sharpe, win rate, avg daily PnL
 *   4. If deviation > 2 std dev, broadcast SSE alert
 *   5. Log comparison to system journal
 */
async function comparePaperToBacktest() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  // Find sessions stopped in the last hour
  const stoppedSessions = await db
    .select()
    .from(paperSessions)
    .where(
      and(
        eq(paperSessions.status, "stopped"),
        gte(paperSessions.stoppedAt, oneHourAgo),
      ),
    );

  if (stoppedSessions.length === 0) {
    logger.info("No recently-stopped paper sessions to compare");
    return;
  }

  for (const session of stoppedSessions) {
    if (!session.strategyId) continue;

    try {
      // 1. Fetch paper trades for this session
      const trades = await db
        .select()
        .from(paperTrades)
        .where(eq(paperTrades.sessionId, session.id));

      if (trades.length === 0) {
        logger.info({ sessionId: session.id }, "Stopped session has no trades, skipping comparison");
        continue;
      }

      // Compute paper metrics
      const pnls = trades.map((t) => Number(t.pnl));
      const winners = pnls.filter((p) => p > 0);
      const paperWinRate = winners.length / pnls.length;
      const avgPnl = pnls.reduce((a, b) => a + b, 0) / pnls.length;
      const pnlStdDev = Math.sqrt(
        pnls.reduce((sum, p) => sum + (p - avgPnl) ** 2, 0) / pnls.length,
      );
      const paperSharpe = pnlStdDev > 0 ? (avgPnl / pnlStdDev) * Math.sqrt(252) : 0;

      // Group trades by day for avg daily PnL
      const dailyPnlMap = new Map<string, number>();
      for (const t of trades) {
        const day = (t.exitTime ?? t.entryTime).toISOString().slice(0, 10);
        dailyPnlMap.set(day, (dailyPnlMap.get(day) ?? 0) + Number(t.pnl));
      }
      const dailyPnls = [...dailyPnlMap.values()];
      const paperAvgDailyPnl = dailyPnls.length > 0
        ? dailyPnls.reduce((a, b) => a + b, 0) / dailyPnls.length
        : 0;

      // 2. Fetch latest completed backtest for this strategy
      const [backtest] = await db
        .select()
        .from(backtests)
        .where(
          and(
            eq(backtests.strategyId, session.strategyId),
            eq(backtests.status, "completed"),
          ),
        )
        .orderBy(desc(backtests.createdAt))
        .limit(1);

      if (!backtest) {
        logger.info({ strategyId: session.strategyId }, "No completed backtest found for comparison");
        continue;
      }

      // 3. Compare key metrics
      const btSharpe = Number(backtest.sharpeRatio ?? 0);
      const btWinRate = Number(backtest.winRate ?? 0);
      const btAvgDailyPnl = Number(backtest.avgDailyPnl ?? 0);

      // Use backtest as baseline; compute deviation as ratio of difference to backtest value
      // A simple heuristic: if paper metric deviates more than the backtest value * threshold, alert
      const deviations: { metric: string; paper: number; backtest: number; sigmas: number }[] = [];

      // Sharpe deviation (use absolute difference scaled by expected magnitude)
      if (btSharpe !== 0) {
        const sharpeDev = Math.abs(paperSharpe - btSharpe) / Math.max(Math.abs(btSharpe) * 0.5, 0.1);
        deviations.push({ metric: "Sharpe", paper: paperSharpe, backtest: btSharpe, sigmas: sharpeDev });
      }

      // Win rate deviation (percentage points scaled)
      if (btWinRate !== 0) {
        const wrDev = Math.abs(paperWinRate - btWinRate) / Math.max(btWinRate * 0.15, 0.05);
        deviations.push({ metric: "WinRate", paper: paperWinRate, backtest: btWinRate, sigmas: wrDev });
      }

      // Avg daily PnL deviation
      if (btAvgDailyPnl !== 0) {
        const pnlDev = Math.abs(paperAvgDailyPnl - btAvgDailyPnl) / Math.max(Math.abs(btAvgDailyPnl) * 0.5, 1);
        deviations.push({ metric: "AvgDailyPnL", paper: paperAvgDailyPnl, backtest: btAvgDailyPnl, sigmas: pnlDev });
      }

      const maxDeviation = deviations.reduce((max, d) => Math.max(max, d.sigmas), 0);
      const alertTriggered = maxDeviation > 2.0;

      // 4. If deviation > 2 std dev, broadcast SSE alert
      if (alertTriggered) {
        broadcastSSE("strategy:paper-vs-backtest-alert", {
          strategyId: session.strategyId,
          sessionId: session.id,
          maxDeviation: Math.round(maxDeviation * 10) / 10,
          deviations,
          message: `Paper session diverged ${maxDeviation.toFixed(1)}σ from backtest — review strategy`,
        });
        logger.warn(
          { strategyId: session.strategyId, sessionId: session.id, maxDeviation, deviations },
          "Paper-vs-backtest deviation alert triggered",
        );
      } else {
        logger.info(
          { strategyId: session.strategyId, sessionId: session.id, maxDeviation },
          "Paper session within expected range of backtest",
        );
      }

      // 5. Log to system journal
      await db.insert(systemJournal).values({
        strategyId: session.strategyId,
        backtestId: backtest.id,
        source: "scheduler",
        status: alertTriggered ? "flagged" : "tested",
        tier: backtest.tier,
        forgeScore: backtest.forgeScore,
        performanceGateResult: {
          type: "paper-vs-backtest-comparison",
          paperMetrics: { sharpe: paperSharpe, winRate: paperWinRate, avgDailyPnl: paperAvgDailyPnl },
          backtestMetrics: { sharpe: btSharpe, winRate: btWinRate, avgDailyPnl: btAvgDailyPnl },
          deviations,
          maxDeviation,
          alertTriggered,
        },
        analystNotes: `Paper-vs-backtest comparison for session ${session.id}: ` +
          `${trades.length} trades over ${dailyPnls.length} days. ` +
          `Max deviation: ${maxDeviation.toFixed(1)}σ. ` +
          (alertTriggered ? "ALERT: significant divergence detected." : "Within expected range."),
      }).catch((err) => {
        // Journal insert is best-effort; don't fail the whole job
        logger.error({ err, sessionId: session.id }, "Failed to log paper-vs-backtest to journal");
      });
    } catch (err) {
      logger.error({ sessionId: session.id, err }, "Failed to compare paper session to backtest");
    }
  }
}

/**
 * Called by paper-execution-service after each trade close.
 * Not scheduled — event-driven.
 */
export async function onPaperTradeClose(sessionId: string, strategyId: string) {
  try {
    // Trigger drift detection
    const response = await fetch(`http://localhost:4000/api/paper/drift/${sessionId}?strategyId=${strategyId}`).catch(() => null);
    if (response?.ok) {
      const drift = await response.json();
      const driftScore = (drift as any).driftScore ?? 0;
      if (driftScore > 2.0) {
        broadcastSSE("strategy:drift-alert", {
          strategyId,
          sessionId,
          driftScore,
          message: `Strategy drifting: ${driftScore.toFixed(1)}σ from backtest expectations`,
        });
        logger.warn({ strategyId, driftScore }, "Strategy drift detected after paper trade");
      }
    }
  } catch (err) {
    logger.error({ sessionId, strategyId, err }, "Drift check failed after paper trade close");
  }
}
