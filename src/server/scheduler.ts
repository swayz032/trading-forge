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
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db } from "./db/index.js";
import { strategies, paperSessions, paperTrades, backtests, systemJournal, skipDecisions } from "./db/schema.js";
import { broadcastSSE } from "./routes/sse.js";
import { logger } from "./index.js";
import { LifecycleService } from "./services/lifecycle-service.js";
import { AlertFactory } from "./services/alert-service.js";

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

  // ─── Daily at 6:30 AM ET: Pre-market prep (DST-aware) ────
  // Run at both 10:30 and 11:30 UTC to cover EDT and EST.
  // The handler checks if it's actually 6:30 AM ET before executing.
  cron.schedule("30 10,11 * * 1-5", async () => {
    const etHour = new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false });
    if (parseInt(etHour) !== 6) return; // Only run at 6 AM ET
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

  // ─── Every 6 hours: Lifecycle auto-promotions/demotions ────
  const lifecycle = new LifecycleService();
  cron.schedule("0 */6 * * *", async () => {
    logger.info("Scheduler: Running lifecycle auto-checks");
    try {
      const promoted = await lifecycle.checkAutoPromotions();
      const demoted = await lifecycle.checkAutoDemotions();
      if (promoted.length > 0 || demoted.length > 0) {
        broadcastSSE("lifecycle:auto-check", {
          promoted,
          demoted,
          timestamp: new Date().toISOString(),
        });
      }
      logger.info({ promoted: promoted.length, demoted: demoted.length }, "Lifecycle auto-check complete");
    } catch (err) {
      logger.error({ err }, "Scheduler: Lifecycle auto-check failed");
    }
  });

  logger.info("Scheduler initialized: rolling Sharpe (4h), pre-market prep (6:30 AM ET weekdays), paper-vs-backtest (1h), lifecycle (6h)");
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

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const results: { strategyId: string; name: string; sharpe: number; drifted: boolean }[] = [];

  for (const strat of activeStrategies) {
    try {
      // Fetch paper trades from the last 30 days across all active sessions for this strategy
      const activeSessions = await db
        .select({ id: paperSessions.id })
        .from(paperSessions)
        .where(
          and(
            eq(paperSessions.strategyId, strat.id),
            eq(paperSessions.status, "active"),
          ),
        );

      if (activeSessions.length === 0) continue;

      // Collect all trades from active sessions within last 30 days
      const allTrades: { pnl: string; exitTime: Date | string }[] = [];
      for (const session of activeSessions) {
        const trades = await db
          .select({ pnl: paperTrades.pnl, exitTime: paperTrades.exitTime })
          .from(paperTrades)
          .where(
            and(
              eq(paperTrades.sessionId, session.id),
              gte(paperTrades.exitTime, thirtyDaysAgo),
            ),
          );
        allTrades.push(...trades);
      }

      if (allTrades.length < 5) {
        logger.info({ strategyId: strat.id, name: strat.name, trades: allTrades.length }, "Not enough trades for rolling Sharpe (need >= 5)");
        continue;
      }

      // Group trades into daily P&L buckets
      const dailyPnlMap = new Map<string, number>();
      for (const t of allTrades) {
        const day = (t.exitTime instanceof Date ? t.exitTime : new Date(t.exitTime)).toISOString().slice(0, 10);
        dailyPnlMap.set(day, (dailyPnlMap.get(day) ?? 0) + Number(t.pnl));
      }
      const dailyReturns = [...dailyPnlMap.values()];

      if (dailyReturns.length < 3) {
        logger.info({ strategyId: strat.id, name: strat.name, days: dailyReturns.length }, "Not enough trading days for rolling Sharpe (need >= 3)");
        continue;
      }

      // Calculate rolling Sharpe: mean(daily_returns) / std(daily_returns) * sqrt(252)
      const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
      const variance = dailyReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (dailyReturns.length - 1);
      const stdDev = Math.sqrt(variance);
      const liveSharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;

      // Persist rolling Sharpe to the strategies table
      await db
        .update(strategies)
        .set({ rollingSharpe30d: liveSharpe.toFixed(4), updatedAt: new Date() })
        .where(eq(strategies.id, strat.id));

      // Compare against backtest Sharpe if available
      const [latestBacktest] = await db
        .select({ sharpeRatio: backtests.sharpeRatio })
        .from(backtests)
        .where(
          and(
            eq(backtests.strategyId, strat.id),
            eq(backtests.status, "completed"),
          ),
        )
        .orderBy(desc(backtests.createdAt))
        .limit(1);

      let drifted = false;
      if (latestBacktest?.sharpeRatio != null) {
        const btSharpe = Number(latestBacktest.sharpeRatio);
        const deviation = Math.abs(liveSharpe - btSharpe);
        // Use backtest Sharpe magnitude as a rough 1-sigma estimate (conservative heuristic)
        const oneSigma = Math.max(Math.abs(btSharpe) * 0.3, 0.2);

        if (deviation > 2 * oneSigma) {
          drifted = true;
          logger.error(
            { strategyId: strat.id, name: strat.name, liveSharpe, btSharpe, deviation, threshold: 2 * oneSigma },
            "DRIFT ALERT: Live Sharpe deviates > 2σ from backtest",
          );
          // Persist alert to DB + broadcast SSE
          AlertFactory.driftAlert(strat.id, "Sharpe", deviation / oneSigma).catch(() => {});
        } else if (deviation > oneSigma) {
          logger.warn(
            { strategyId: strat.id, name: strat.name, liveSharpe, btSharpe, deviation, threshold: oneSigma },
            "Rolling Sharpe drifting from backtest (> 1σ)",
          );
        } else {
          logger.info(
            { strategyId: strat.id, name: strat.name, liveSharpe, btSharpe },
            "Rolling Sharpe within expected range",
          );
        }
      } else {
        logger.info(
          { strategyId: strat.id, name: strat.name, liveSharpe },
          "Rolling Sharpe computed (no backtest baseline for comparison)",
        );
      }

      results.push({ strategyId: strat.id, name: strat.name, sharpe: liveSharpe, drifted });
    } catch (err) {
      logger.error({ strategyId: strat.id, err }, "Failed to update rolling Sharpe");
    }
  }

  broadcastSSE("scheduler:sharpe-updated", {
    strategies: activeStrategies.length,
    results,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Pre-market prep: check if any macro events today warrant caution.
 */
async function preMarketPrep() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Query today's skip decisions directly from DB
    const decisions = await db
      .select()
      .from(skipDecisions)
      .where(
        and(
          gte(skipDecisions.decisionDate, today),
          lte(skipDecisions.decisionDate, tomorrow),
        )
      );

    if (decisions.length > 0) {
      const sitOuts = decisions.filter((d) => d.decision === "SKIP" || d.decision === "REDUCE" || d.decision === "SIT_OUT");
      if (sitOuts.length > 0) {
        broadcastSSE("scheduler:pre-market-alert", {
          message: `${sitOuts.length} strategies sitting out today`,
          details: sitOuts,
        });
        logger.info({ sitOuts: sitOuts.length }, "Pre-market: strategies sitting out");
      }
    }
  } catch (err) {
    logger.warn({ err }, "Pre-market prep failed");
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
      const pnlStdDev = pnls.length > 1
        ? Math.sqrt(pnls.reduce((sum, p) => sum + (p - avgPnl) ** 2, 0) / (pnls.length - 1))
        : 0;
      const paperSharpe = pnlStdDev > 0 ? (avgPnl / pnlStdDev) * Math.sqrt(252) : 0;

      // Group trades by day for avg daily PnL
      const dailyPnlMap = new Map<string, number>();
      for (const t of trades) {
        const rawTime = t.exitTime ?? t.entryTime;
        const day = (rawTime instanceof Date ? rawTime : new Date(rawTime)).toISOString().slice(0, 10);
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

      // 4. If deviation > 2 std dev, broadcast SSE alert + persist
      if (alertTriggered) {
        broadcastSSE("strategy:paper-vs-backtest-alert", {
          strategyId: session.strategyId,
          sessionId: session.id,
          maxDeviation: Math.round(maxDeviation * 10) / 10,
          deviations,
          message: `Paper session diverged ${maxDeviation.toFixed(1)}σ from backtest — review strategy`,
        });
        // Persist alert to DB
        const worstMetric = deviations.reduce((w, d) => d.sigmas > w.sigmas ? d : w, deviations[0]);
        AlertFactory.driftAlert(session.strategyId, worstMetric.metric, maxDeviation).catch(() => {});
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
    // Call detectDrift directly instead of HTTP self-request (avoids fragile localhost fetch)
    const { detectDrift } = await import("./services/drift-detection-service.js");
    const reports = await detectDrift(strategyId, sessionId);

    if (reports.length === 0) return; // Not enough data or no backtest

    // Find the worst deviation across all metrics
    const maxDeviation = Math.max(...reports.map(r => r.deviationStdDevs));
    const driftAlerts = reports.filter(r => r.severity === "alert");

    if (driftAlerts.length > 0) {
      broadcastSSE("strategy:drift-alert", {
        strategyId,
        sessionId,
        driftScore: maxDeviation,
        alerts: driftAlerts,
        message: `Strategy drifting: ${maxDeviation.toFixed(1)}σ from backtest expectations`,
      });
      // Persist alert to DB
      AlertFactory.driftAlert(strategyId, "live_drift", maxDeviation).catch(() => {});
      logger.warn({ strategyId, maxDeviation, alerts: driftAlerts }, "Strategy drift detected after paper trade");
    }
  } catch (err) {
    logger.error({ sessionId, strategyId, err }, "Drift check failed after paper trade close");
  }
}
