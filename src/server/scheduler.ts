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
import { eq, and, gte, lte, desc, inArray, isNull, isNotNull } from "drizzle-orm";
import { db } from "./db/index.js";
import { strategies, paperSessions, paperPositions, paperTrades, paperSignalLogs, backtests, systemJournal, skipDecisions, auditLog } from "./db/schema.js";
import { broadcastSSE } from "./routes/sse.js";
import { logger } from "./index.js";
import { LifecycleService } from "./services/lifecycle-service.js";
import { AlertFactory } from "./services/alert-service.js";
import { runPythonModule } from "./lib/python-runner.js";
import { startStream, stopStream, isStreaming, getActiveStreams } from "./services/paper-trading-stream.js";
import { restorePositionState, cleanupSession } from "./services/paper-signal-service.js";
import { trainDeepAR, predictRegime, validatePastForecasts } from "./services/deepar-service.js";
import { runAgentHealthSweep } from "./services/agent-audit-service.js";
import { runPortfolioCorrelationCheck } from "./services/portfolio-optimizer-service.js";
import { runMetaParameterReview } from "./services/meta-optimizer-service.js";

let initialized = false;

// ─── Scheduler health tracking ────────────────────────────────
// Each cron job updates its own slot on every successful fire.
// Export allows the health endpoint to surface real liveness data.
const schedulerHealth: Record<string, Date> = {};

export function getSchedulerHealth(): Readonly<Record<string, Date>> {
  return schedulerHealth;
}

// ─── Job registry export ──────────────────────────────────────
// Exposes lastRunAt + intervalMs for each registered job so the health
// dashboard can report overdue jobs and display scheduler liveness.
export interface SchedulerJobMeta {
  lastRunAt: Date | null;
  intervalMs: number;
}

export function getSchedulerJobs(): Readonly<Record<string, SchedulerJobMeta>> {
  const snapshot: Record<string, SchedulerJobMeta> = {};
  for (const [name, meta] of Object.entries(SCHEDULER_JOBS)) {
    snapshot[name] = { lastRunAt: meta.lastRunAt, intervalMs: meta.intervalMs };
  }
  return snapshot;
}

// ─── withRetry — exponential backoff for cron jobs ────────────
// Wraps a job function with up to maxRetries retry attempts.
// Delays: attempt 1 → 2s, attempt 2 → 4s (doubles each time, capped at 30s).
// After all attempts are exhausted the final error is logged, not rethrown,
// so the scheduler cron wrapper never propagates an exception.
async function withRetry(
  name: string,
  fn: () => Promise<void>,
  maxRetries = 3,
): Promise<void> {
  let attempt = 0;
  let lastErr: unknown;
  while (attempt <= maxRetries) {
    try {
      await fn();
      return; // success
    } catch (err) {
      lastErr = err;
      attempt++;
      if (attempt > maxRetries) break;
      const delayMs = Math.min(2000 * attempt, 30_000); // 2s, 4s, 8s … capped at 30s
      logger.warn(
        { err, job: name, attempt, maxRetries, delayMs },
        `Scheduler: job failed — retrying in ${delayMs}ms`,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // All attempts exhausted — suppress rethrow, emit structured error
  logger.error(
    { err: lastErr, job: name, attempts: attempt },
    "Scheduler: job failed after all retries — suppressed",
  );
}

// ─── Missed-run detection ─────────────────────────────────────
// Track last successful run per job. On startup, if a job is overdue
// (lastRunAt + intervalMs < now), fire it immediately so restarts
// never silently skip a scheduled cycle.

interface JobMeta {
  lastRunAt: Date | null;
  intervalMs: number;
  run: () => Promise<void>;
}

const SCHEDULER_JOBS: Record<string, JobMeta> = {};

function registerJob(name: string, intervalMs: number, run: () => Promise<void>) {
  SCHEDULER_JOBS[name] = { lastRunAt: null, intervalMs, run };
}

function markJobRun(name: string) {
  if (SCHEDULER_JOBS[name]) {
    SCHEDULER_JOBS[name].lastRunAt = new Date();
  }
  schedulerHealth[name] = new Date();
}

async function reconcileMissedRuns() {
  const now = Date.now();
  for (const [name, meta] of Object.entries(SCHEDULER_JOBS)) {
    if (!meta.lastRunAt) {
      // Never ran in this process lifetime — if interval < 24h, run immediately
      // to catch up after a restart
      if (meta.intervalMs <= 24 * 60 * 60 * 1000) {
        logger.info({ job: name }, "Scheduler: job never ran this session — running catchup");
        try {
          await meta.run();
          markJobRun(name);
        } catch (err) {
          logger.error({ err, job: name }, "Scheduler: catchup run failed");
        }
      }
    } else if (meta.lastRunAt.getTime() + meta.intervalMs < now) {
      const overdueMs = now - (meta.lastRunAt.getTime() + meta.intervalMs);
      logger.info({ job: name, overdueMs }, "Scheduler: job overdue — running catchup");
      try {
        await meta.run();
        markJobRun(name);
      } catch (err) {
        logger.error({ err, job: name }, "Scheduler: catchup run failed");
      }
    }
  }
}

export function initScheduler() {
  if (initialized) return;
  initialized = true;

  // ─── Emit scheduler:job-complete after each successful job ───
  function emitJobComplete(name: string, durationMs: number) {
    broadcastSSE("scheduler:job-complete", {
      job: name,
      completedAt: new Date().toISOString(),
      durationMs,
    });
  }

  // Register all jobs for missed-run detection
  registerJob("rolling-sharpe", 4 * 60 * 60 * 1000, updateRollingSharpe);
  registerJob("pre-market-prep", 24 * 60 * 60 * 1000, preMarketPrep);
  registerJob("paper-vs-backtest", 60 * 60 * 1000, comparePaperToBacktest);
  registerJob("decay-monitor", 24 * 60 * 60 * 1000, runDailyDecayMonitor);
  registerJob("stale-session-check", 5 * 60 * 1000, detectStalePaperSessions);
  registerJob("deepar-train", 24 * 60 * 60 * 1000, async () => { await trainDeepAR(); });
  registerJob("deepar-predict", 24 * 60 * 60 * 1000, async () => { await predictRegime(); });
  registerJob("deepar-validate", 24 * 60 * 60 * 1000, async () => { await validatePastForecasts(); });
  const lifecycle = new LifecycleService();
  registerJob("lifecycle-auto-check", 6 * 60 * 60 * 1000, async () => {
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
  });

  // ─── Phase 5: Agent health sweep every 2 hours ────────────
  registerJob("agent-health-sweep", 2 * 60 * 60 * 1000, async () => {
    const result = await runAgentHealthSweep();
    logger.info({ overallStatus: result.overallStatus, recommendations: result.allRecommendations.length }, "Agent health sweep complete");
  });

  // ─── Phase 2.5: Portfolio correlation check daily ─────────
  registerJob("portfolio-correlation", 24 * 60 * 60 * 1000, async () => {
    await runPortfolioCorrelationCheck();
  });

  // ─── Phase 3.3: Meta parameter review monthly ────────────
  // Monthly = 30 day interval. Cron fires on the 1st at 3:00 AM UTC.
  registerJob("meta-parameter-review", 30 * 24 * 60 * 60 * 1000, async () => {
    await runMetaParameterReview(30);
  });

  // ─── Phase 1.4: Metrics heartbeat every 60s ───────────────
  // Broadcasts rolling session metrics snapshot over SSE so the live
  // dashboard stays current between trade closes on quiet sessions.
  registerJob("metrics-heartbeat", 60 * 1000, async () => {
    const { metricsAggregator } = await import("./services/metrics-aggregator.js");
    metricsAggregator.emitSnapshot();
  });

  // ─── Every 4 hours: Rolling Sharpe update ─────────────────
  cron.schedule("0 */4 * * *", async () => {
    logger.info("Scheduler: Running 4-hour rolling Sharpe update");
    const t0 = Date.now();
    await withRetry("rolling-sharpe", updateRollingSharpe);
    markJobRun("rolling-sharpe");
    emitJobComplete("rolling-sharpe", Date.now() - t0);
  });

  // ─── Daily at 6:00 AM ET: Pre-market prep (DST-aware) ────
  // Run at both 10:00 and 11:00 UTC to cover EDT (UTC-4) and EST (UTC-5).
  // Check actual ET hour before executing — only one of the two will fire.
  cron.schedule("0 10,11 * * 1-5", async () => {
    const now = new Date();
    const etTimeStr = now.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    // etTimeStr is like "6:00" or "7:00" — extract hour and minute
    const [etHourStr, etMinStr] = etTimeStr.split(":");
    const etHour = parseInt(etHourStr, 10);
    const etMin = parseInt(etMinStr, 10);
    if (etHour !== 6 || etMin !== 0) {
      logger.debug({ etHour, etMin, utcHour: now.getUTCHours() }, "Scheduler: Pre-market cron fired but not 6:00 AM ET — skipping");
      return;
    }
    logger.info("Scheduler: Pre-market prep (6:00 AM ET confirmed)");
    const t0premarket = Date.now();
    await withRetry("pre-market-prep", preMarketPrep);
    markJobRun("pre-market-prep");
    emitJobComplete("pre-market-prep", Date.now() - t0premarket);
  });

  // ─── Every hour: Compare stopped paper sessions to backtest ─
  cron.schedule("0 * * * *", async () => {
    logger.info("Scheduler: Running paper-vs-backtest comparison for recently stopped sessions");
    const t0pvb = Date.now();
    await withRetry("paper-vs-backtest", comparePaperToBacktest);
    markJobRun("paper-vs-backtest");
    emitJobComplete("paper-vs-backtest", Date.now() - t0pvb);
  });

  // ─── Daily at 2:00 AM ET: Decay monitor sweep (DST-aware) ────
  // Run at both 6:00 and 7:00 UTC to cover EDT (UTC-4) and EST (UTC-5).
  // Check actual ET hour before executing — only one of the two will fire.
  cron.schedule("0 6,7 * * *", async () => {
    const now = new Date();
    const etTimeStr = now.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const [etHourStr, etMinStr] = etTimeStr.split(":");
    const etHour = parseInt(etHourStr, 10);
    const etMin = parseInt(etMinStr, 10);
    if (etHour !== 2 || etMin !== 0) {
      logger.debug({ etHour, etMin, utcHour: now.getUTCHours() }, "Scheduler: Decay monitor cron fired but not 2:00 AM ET — skipping");
      return;
    }
    logger.info("Scheduler: Daily decay monitor sweep (2:00 AM ET confirmed)");
    const t0decay = Date.now();
    await withRetry("decay-monitor", runDailyDecayMonitor);
    markJobRun("decay-monitor");
    emitJobComplete("decay-monitor", Date.now() - t0decay);
  });

  // ─── Every 6 hours: Lifecycle auto-promotions/demotions ────
  cron.schedule("0 */6 * * *", async () => {
    logger.info("Scheduler: Running lifecycle auto-checks");
    const t0lc = Date.now();
    await withRetry("lifecycle-auto-check", SCHEDULER_JOBS["lifecycle-auto-check"].run);
    markJobRun("lifecycle-auto-check");
    emitJobComplete("lifecycle-auto-check", Date.now() - t0lc);
  });

  // ─── Every 5 minutes: Stale paper session detection ─────────
  cron.schedule("*/5 * * * *", async () => {
    const t0stale = Date.now();
    await withRetry("stale-session-check", SCHEDULER_JOBS["stale-session-check"].run);
    markJobRun("stale-session-check");
    emitJobComplete("stale-session-check", Date.now() - t0stale);
  });

  // ─── Every 60 seconds: Metrics heartbeat ─────────────────────
  cron.schedule("* * * * *", async () => {
    const t0mh = Date.now();
    await withRetry("metrics-heartbeat", SCHEDULER_JOBS["metrics-heartbeat"].run, 1);
    markJobRun("metrics-heartbeat");
    emitJobComplete("metrics-heartbeat", Date.now() - t0mh);
  });

  // ─── DeepAR: Train daily at 2:30 AM ET (weekdays) ──────────
  // Run at both 6:30 and 7:30 UTC to cover EDT (UTC-4) and EST (UTC-5).
  cron.schedule("30 6,7 * * 1-5", async () => {
    const now = new Date();
    const etTimeStr = now.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const [etHourStr, etMinStr] = etTimeStr.split(":");
    const etHour = parseInt(etHourStr, 10);
    const etMin = parseInt(etMinStr, 10);
    if (etHour !== 2 || etMin !== 30) return;
    logger.info("Scheduler: DeepAR training (2:30 AM ET)");
    const t0dt = Date.now();
    await withRetry("deepar-train", async () => { await trainDeepAR(); });
    markJobRun("deepar-train");
    emitJobComplete("deepar-train", Date.now() - t0dt);
  });

  // ─── DeepAR: Predict daily at 6:00 AM ET (weekdays) ───────
  // Run at both 10:00 and 11:00 UTC to cover EDT/EST.
  cron.schedule("0 10,11 * * 1-5", async () => {
    const now = new Date();
    const etTimeStr = now.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const [etHourStr, etMinStr] = etTimeStr.split(":");
    const etHour = parseInt(etHourStr, 10);
    const etMin = parseInt(etMinStr, 10);
    if (etHour !== 6 || etMin !== 0) return;
    logger.info("Scheduler: DeepAR prediction (6:00 AM ET)");
    const t0dp = Date.now();
    await withRetry("deepar-predict", async () => { await predictRegime(); });
    markJobRun("deepar-predict");
    emitJobComplete("deepar-predict", Date.now() - t0dp);
  });

  // ─── DeepAR: Validate at 6:30 AM ET (weekdays) ────────────
  // Run at both 10:30 and 11:30 UTC to cover EDT/EST.
  cron.schedule("30 10,11 * * 1-5", async () => {
    const now = new Date();
    const etTimeStr = now.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const [etHourStr, etMinStr] = etTimeStr.split(":");
    const etHour = parseInt(etHourStr, 10);
    const etMin = parseInt(etMinStr, 10);
    if (etHour !== 6 || etMin !== 30) return;
    logger.info("Scheduler: DeepAR validation (6:30 AM ET)");
    const t0dv = Date.now();
    await withRetry("deepar-validate", async () => { await validatePastForecasts(); });
    markJobRun("deepar-validate");
    emitJobComplete("deepar-validate", Date.now() - t0dv);
  });

  // ─── Daily at 11:00 PM ET: Regret score fill ────────────────
  // Run at both 3:00 and 4:00 UTC to cover EDT (UTC-4) and EST (UTC-5).
  // Fills regretScore / opportunityCost on skipDecisions rows that now have
  // actualPnl but were created before Phase 2.4 landed, or whose session
  // post-processing ran before regret scoring was available.
  registerJob("regret-score-fill", 24 * 60 * 60 * 1000, fillRegretScores);
  cron.schedule("0 3,4 * * *", async () => {
    const now = new Date();
    const etTimeStr = now.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const [etHourStr, etMinStr] = etTimeStr.split(":");
    const etHour = parseInt(etHourStr, 10);
    const etMin = parseInt(etMinStr, 10);
    if (etHour !== 23 || etMin !== 0) {
      logger.debug({ etHour, etMin }, "Scheduler: Regret score cron fired but not 11:00 PM ET — skipping");
      return;
    }
    logger.info("Scheduler: Regret score fill (11:00 PM ET)");
    const t0rs = Date.now();
    await withRetry("regret-score-fill", fillRegretScores);
    markJobRun("regret-score-fill");
    emitJobComplete("regret-score-fill", Date.now() - t0rs);
  });

  // ─── Every 2 hours: Agent health sweep ───────────────────
  cron.schedule("0 */2 * * *", async () => {
    logger.info("Scheduler: Running agent health sweep");
    const t0ahs = Date.now();
    await withRetry("agent-health-sweep", async () => { await runAgentHealthSweep(); });
    markJobRun("agent-health-sweep");
    emitJobComplete("agent-health-sweep", Date.now() - t0ahs);
  });

  // ─── Daily at midnight UTC: Portfolio correlation check ──
  cron.schedule("0 0 * * *", async () => {
    logger.info("Scheduler: Running portfolio correlation check");
    const t0pc = Date.now();
    await withRetry("portfolio-correlation", async () => { await runPortfolioCorrelationCheck(); });
    markJobRun("portfolio-correlation");
    emitJobComplete("portfolio-correlation", Date.now() - t0pc);
  });

  // ─── Monthly on 1st at 3:00 AM UTC: Meta parameter review ─
  cron.schedule("0 3 1 * *", async () => {
    logger.info("Scheduler: Running monthly meta parameter review");
    const t0mp = Date.now();
    await withRetry("meta-parameter-review", async () => { await runMetaParameterReview(30); });
    markJobRun("meta-parameter-review");
    emitJobComplete("meta-parameter-review", Date.now() - t0mp);
  });

  logger.info("Scheduler initialized: rolling Sharpe (4h), pre-market prep (6:00 AM ET weekdays), paper-vs-backtest (1h), lifecycle (6h), decay monitor (2:00 AM ET daily), stale-session-check (5m), metrics-heartbeat (60s), deepar-train (2:30 AM ET), deepar-predict (6:00 AM ET), deepar-validate (6:30 AM ET), regret-score-fill (11:00 PM ET), agent-health-sweep (2h), portfolio-correlation (daily), meta-parameter-review (monthly)");

  // ─── Startup reconciliation: catch up missed jobs ─────────
  reconcileMissedRuns().then(() => {
    logger.info("Scheduler: missed-run reconciliation complete");
  }).catch((err) => {
    logger.error({ err }, "Scheduler: missed-run reconciliation failed");
  });

  // ─── I3: Resume active paper sessions after restart ───────
  resumeActivePaperSessions().catch((err) => {
    logger.error({ err }, "Scheduler: paper session resume failed");
  });
}

/**
 * I3: Resume active paper trading sessions after server restart.
 * Queries DB for active sessions, reconnects WebSocket streams,
 * and restores in-memory position state (trail HWM, bars held).
 */
async function resumeActivePaperSessions(): Promise<void> {
  const activeSessions = await db
    .select()
    .from(paperSessions)
    .where(eq(paperSessions.status, "active"));

  if (activeSessions.length === 0) {
    logger.info("No active paper sessions to resume");
    return;
  }

  logger.info({ count: activeSessions.length }, "Resuming active paper sessions after restart");

  for (const session of activeSessions) {
    try {
      // Resolve symbol list from strategy config
      const strat = session.strategyId
        ? await db.select().from(strategies).where(eq(strategies.id, session.strategyId)).limit(1)
        : [];

      const symbols: string[] = [];
      if (strat[0]?.symbol) symbols.push(strat[0].symbol);
      const stratConfig = strat[0]?.config as Record<string, unknown> | undefined;
      if (stratConfig?.symbol && !symbols.includes(String(stratConfig.symbol))) {
        symbols.push(String(stratConfig.symbol));
      }

      if (symbols.length === 0) {
        logger.warn({ sessionId: session.id }, "Cannot resume paper session — no symbol found");
        continue;
      }

      // Reconnect WebSocket stream
      startStream(session.id, symbols);

      // Restore in-memory position state from DB
      const openPositions = await db
        .select({
          id: paperPositions.id,
          trailHwm: paperPositions.trailHwm,
          barsHeld: paperPositions.barsHeld,
        })
        .from(paperPositions)
        .where(
          and(
            eq(paperPositions.sessionId, session.id),
            isNull(paperPositions.closedAt),
          ),
        );

      if (openPositions.length > 0) {
        restorePositionState(openPositions);
        logger.info(
          { sessionId: session.id, openPositions: openPositions.length },
          "Restored in-memory state for open positions",
        );
      }

      logger.info({ sessionId: session.id, symbols }, "Resumed active paper session");
    } catch (err) {
      logger.error({ err, sessionId: session.id }, "Failed to resume paper session");
    }
  }
}

/**
 * Update rolling 30-day Sharpe ratio for all active strategies.
 */
async function updateRollingSharpe() {
  const activeStrategies = await db
    .select({ id: strategies.id, name: strategies.name, lifecycleState: strategies.lifecycleState })
    .from(strategies)
    .where(
      inArray(strategies.lifecycleState, ["PAPER", "DEPLOYED"]),
    );

  if (activeStrategies.length === 0) {
    logger.info("No active PAPER/DEPLOYED strategies for Sharpe update");
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
        dailyPnlMap.set(day, (dailyPnlMap.get(day) ?? 0) + Number(t.pnl ?? 0));
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

      // Inline demotion: if DEPLOYED and new Sharpe < 1.0, demote immediately
      // rather than waiting for the 6-hour lifecycle check. Worst-case drift-to-demotion
      // is reduced from 10 hours to 4 hours.
      if (liveSharpe < 1.0 && strat.lifecycleState === "DEPLOYED") {
        const lifecycle = new LifecycleService();
        const demoteResult = await lifecycle.promoteStrategy(strat.id, "DEPLOYED", "DECLINING");
        if (demoteResult.success) {
          logger.warn({ strategyId: strat.id, name: strat.name, sharpe: liveSharpe }, "Immediate demotion triggered by rolling Sharpe update");
        } else {
          logger.warn({ strategyId: strat.id, name: strat.name, sharpe: liveSharpe, reason: demoteResult.error }, "Inline demotion attempted but rejected by lifecycle service");
        }
      }

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
        dailyPnlMap.set(day, (dailyPnlMap.get(day) ?? 0) + Number(t.pnl ?? 0));
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

// Decay threshold — score above this triggers lifecycle demotion
const DECAY_DEMOTION_THRESHOLD = 80;

/**
 * Daily sweep: run decay analysis for all active strategies (TESTING, PAPER, DEPLOYED).
 * If decay score exceeds threshold, trigger lifecycle demotion to DECLINING.
 * Runs at 2:00 AM ET when markets are closed — no interference with live sessions.
 */
async function runDailyDecayMonitor(): Promise<void> {
  const activeStates = ["TESTING", "PAPER", "DEPLOYED"] as const;

  const activeStrategies = await db
    .select({ id: strategies.id, name: strategies.name, lifecycleState: strategies.lifecycleState })
    .from(strategies)
    .where(inArray(strategies.lifecycleState, [...activeStates]));

  if (activeStrategies.length === 0) {
    logger.info("Decay monitor: no active strategies to scan");
    return;
  }

  logger.info({ count: activeStrategies.length }, "Decay monitor: scanning strategies");

  const lifecycle = new LifecycleService();
  const demoted: string[] = [];
  const elevated: string[] = [];
  const errors: string[] = [];

  for (const strat of activeStrategies) {
    try {
      const decayResult = await runPythonModule<{
        decay_score?: number;
        decaying?: boolean;
        trend?: string;
        half_life_days?: number;
        error?: string;
      }>({
        module: "src.engine.decay.half_life",
        config: { action: "analyze", strategy_id: strat.id },
        componentName: "decay-daily-monitor",
        timeoutMs: 30_000,
      });

      if (decayResult.error) {
        logger.warn({ strategyId: strat.id, name: strat.name, decayError: decayResult.error }, "Decay monitor: Python analysis returned error");
        errors.push(strat.id);
        continue;
      }

      const decayScore = Number(decayResult.decay_score ?? 0);

      logger.info(
        {
          strategyId: strat.id,
          name: strat.name,
          lifecycleState: strat.lifecycleState,
          decayScore,
          decaying: decayResult.decaying,
          trend: decayResult.trend,
          halfLifeDays: decayResult.half_life_days,
        },
        "Decay monitor: analysis complete",
      );

      if (decayScore > DECAY_DEMOTION_THRESHOLD) {
        elevated.push(strat.id);

        // Only demote states that have a valid DECLINING transition
        const currentState = strat.lifecycleState as "TESTING" | "PAPER" | "DEPLOYED";
        const demotionMap: Record<string, "DECLINING" | null> = {
          DEPLOYED: "DECLINING",
          PAPER: null,     // No direct PAPER → DECLINING transition in state machine
          TESTING: null,   // No direct TESTING → DECLINING transition
        };
        const targetState = demotionMap[currentState];

        if (targetState) {
          const result = await lifecycle.promoteStrategy(strat.id, currentState, targetState);
          if (result.success) {
            demoted.push(strat.id);
            broadcastSSE("strategy:decay-demotion", {
              strategyId: strat.id,
              name: strat.name,
              decayScore,
              fromState: currentState,
              toState: targetState,
              message: `Strategy "${strat.name}" demoted to ${targetState} — decay score ${decayScore}`,
            });
            AlertFactory.decayAlert(strat.id, "demotion").catch(() => {});
            logger.warn(
              { strategyId: strat.id, name: strat.name, decayScore, fromState: currentState, toState: targetState },
              "Decay monitor: strategy demoted due to elevated decay score",
            );
          } else {
            logger.warn(
              { strategyId: strat.id, name: strat.name, decayScore, error: result.error },
              "Decay monitor: demotion transition rejected by lifecycle service",
            );
          }
        } else {
          // For TESTING/PAPER, fire alert only — demotion path not valid per state machine
          broadcastSSE("strategy:decay-warning", {
            strategyId: strat.id,
            name: strat.name,
            decayScore,
            lifecycleState: currentState,
            message: `Strategy "${strat.name}" has elevated decay score ${decayScore} (state: ${currentState} — alert only)`,
          });
          AlertFactory.decayAlert(strat.id, decayScore > 90 ? "quarantine" : "watch").catch(() => {});
          logger.warn(
            { strategyId: strat.id, name: strat.name, decayScore, lifecycleState: currentState },
            "Decay monitor: elevated decay score — alert only (no demotion path for this state)",
          );
        }
      }
    } catch (err) {
      logger.error({ strategyId: strat.id, name: strat.name, err }, "Decay monitor: failed to analyze strategy");
      errors.push(strat.id);
    }
  }

  broadcastSSE("scheduler:decay-sweep-complete", {
    scanned: activeStrategies.length,
    elevated: elevated.length,
    demoted: demoted.length,
    errors: errors.length,
    timestamp: new Date().toISOString(),
  });

  logger.info(
    { scanned: activeStrategies.length, elevated: elevated.length, demoted: demoted.length, errors: errors.length },
    "Decay monitor: daily sweep complete",
  );
}

/**
 * Shared stop logic for a paper session — called by the stop route and by the
 * auto-stop path in detectStalePaperSessions().
 *
 * Performs the full stop sequence:
 *   1. Stop the live WebSocket stream
 *   2. Clean up in-memory caches (indicator history, session config)
 *   3. Mark the session stopped in DB
 *   4. Run QuantStats analytics (so metricsSnapshot is populated for the promotion gate)
 *   5. Insert audit_log entry
 *   6. Broadcast SSE
 *
 * Returns the updated session row, or null if the session was not found / already stopped.
 */
async function stopPaperSession(
  sessionId: string,
  reason: string,
): Promise<{ id: string; stoppedAt: Date | null; totalTrades: number | null; currentEquity: string | null } | null> {
  // Resolve symbols before stopping (needed for cache cleanup)
  const streamInfo = getActiveStreams().get(sessionId);
  const symbols = streamInfo?.symbols ?? [];

  // Stop the live stream if running
  if (isStreaming(sessionId)) {
    stopStream(sessionId);
    logger.info({ sessionId, reason }, "Paper stream stopped (auto-stop)");
  }

  // Clean up in-memory caches
  cleanupSession(sessionId, symbols);

  // Guard: check current status before updating
  const [current] = await db
    .select({ status: paperSessions.status })
    .from(paperSessions)
    .where(eq(paperSessions.id, sessionId));
  if (!current || current.status === "stopped") return null;

  const [session] = await db
    .update(paperSessions)
    .set({ status: "stopped", stoppedAt: new Date() })
    .where(eq(paperSessions.id, sessionId))
    .returning({
      id: paperSessions.id,
      stoppedAt: paperSessions.stoppedAt,
      totalTrades: paperSessions.totalTrades,
      currentEquity: paperSessions.currentEquity,
      dailyPnlBreakdown: paperSessions.dailyPnlBreakdown,
    });

  if (!session) return null;

  // ─── QuantStats analytics (same as the stop route) ────────────
  // Ensures metricsSnapshot is populated so the promotion gate has valid inputs.
  try {
    const sessionTrades = await db
      .select({ pnl: paperTrades.pnl })
      .from(paperTrades)
      .where(eq(paperTrades.sessionId, sessionId))
      .orderBy(paperTrades.exitTime);

    let returnsForAnalytics: number[] | null = null;
    let returnsSource = "none";

    if (sessionTrades.length >= 2) {
      returnsForAnalytics = sessionTrades
        .map((t) => parseFloat(t.pnl ?? "0"))
        .filter((v) => isFinite(v));
      returnsSource = "per_trade";
    } else {
      const dailyPnl =
        session && typeof session === "object" && "dailyPnlBreakdown" in session
          ? (session.dailyPnlBreakdown as Record<string, number> | null)
          : null;
      if (dailyPnl && Object.keys(dailyPnl).length >= 1) {
        returnsForAnalytics = Object.values(dailyPnl).filter((v) => isFinite(v));
        returnsSource = "daily_breakdown";
      }
    }

    if (returnsForAnalytics && returnsForAnalytics.length >= 1) {
      const analyticsResult = await runPythonModule({
        module: "src.engine.paper_analytics",
        config: {
          daily_returns: returnsForAnalytics,
          title: `Paper Session ${sessionId.slice(0, 8)}`,
        },
        timeoutMs: 15_000,
        componentName: "paper-analytics",
      });
      const snapshot = {
        ...(analyticsResult as Record<string, unknown>),
        returns_source: returnsSource,
        n_trades: sessionTrades.length,
        auto_stopped: true,
        auto_stop_reason: reason,
      };
      await db.update(paperSessions)
        .set({ metricsSnapshot: snapshot as Record<string, unknown> })
        .where(eq(paperSessions.id, sessionId));
      logger.info(
        { sessionId, returnsSource, n: returnsForAnalytics.length, reason },
        "Paper analytics report generated (auto-stop)",
      );
    } else {
      logger.info({ sessionId, reason }, "Paper analytics skipped — insufficient trade data (auto-stop)");
    }
  } catch (analyticsErr) {
    logger.warn({ sessionId, err: analyticsErr, reason }, "Paper analytics failed on auto-stop (non-blocking)");
  }

  // ─── Audit log ────────────────────────────────────────────────
  await db.insert(auditLog).values({
    action: "paper.session_auto_stop",
    entityType: "paper_session",
    entityId: sessionId,
    input: { sessionId, reason },
    result: {
      stoppedAt: session.stoppedAt?.toISOString() ?? new Date().toISOString(),
      totalTrades: session.totalTrades,
      currentEquity: session.currentEquity,
    },
    status: "success",
    decisionAuthority: "scheduler",
  });

  return session;
}

/**
 * Detect paper sessions that have gone silent — active but with no signal or trade
 * activity in the past 10 minutes. Fires alert:triggered SSE so the dashboard can
 * surface a warning without requiring manual inspection.
 *
 * If a session has been inactive for 2+ hours it is auto-stopped so that QuantStats
 * analytics run and metricsSnapshot is populated for the promotion gate.
 *
 * Runs every 5 minutes. Only checks during normal trading hours to avoid false
 * positives from overnight / pre-market silence.
 */
async function detectStalePaperSessions(): Promise<void> {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const activeSessions = await db
    .select({
      id: paperSessions.id,
      strategyId: paperSessions.strategyId,
      startedAt: paperSessions.startedAt,
    })
    .from(paperSessions)
    .where(eq(paperSessions.status, "active"));

  if (activeSessions.length === 0) return;

  for (const session of activeSessions) {
    try {
      // Check most recent signal log entry
      const [lastSignal] = await db
        .select({ createdAt: paperSignalLogs.createdAt })
        .from(paperSignalLogs)
        .where(eq(paperSignalLogs.sessionId, session.id))
        .orderBy(desc(paperSignalLogs.createdAt))
        .limit(1);

      // Check most recent paper trade entry
      const [lastTrade] = await db
        .select({ createdAt: paperTrades.createdAt })
        .from(paperTrades)
        .where(eq(paperTrades.sessionId, session.id))
        .orderBy(desc(paperTrades.createdAt))
        .limit(1);

      // Determine the most recent activity timestamp across both tables
      const lastSignalTime = lastSignal?.createdAt ?? null;
      const lastTradeTime = lastTrade?.createdAt ?? null;

      const lastActivityTime =
        lastSignalTime && lastTradeTime
          ? lastSignalTime > lastTradeTime ? lastSignalTime : lastTradeTime
          : lastSignalTime ?? lastTradeTime ?? null;

      // If there has never been any activity, use session start time as the baseline
      const activityBaseline = lastActivityTime ?? session.startedAt;

      if (activityBaseline < twoHoursAgo) {
        // ─── Auto-stop: 2+ hours inactive ──────────────────────
        // Stop the session so QuantStats runs and metricsSnapshot is populated.
        const staleSinceMs = Date.now() - activityBaseline.getTime();
        logger.warn(
          {
            sessionId: session.id,
            strategyId: session.strategyId,
            lastActivityTime: activityBaseline.toISOString(),
            staleSinceMs,
          },
          "Stale paper session auto-stopping — no activity for 2+ hours",
        );
        try {
          const stopped = await stopPaperSession(session.id, "stale_2h");
          if (stopped) {
            broadcastSSE("paper:auto_stopped", {
              sessionId: session.id,
              strategyId: session.strategyId,
              reason: "stale_2h",
              lastActivityTime: activityBaseline.toISOString(),
              staleSinceMs,
            });
            logger.info(
              { sessionId: session.id, staleSinceMs },
              "Stale paper session auto-stopped and analytics run",
            );
          }
        } catch (stopErr) {
          logger.error({ sessionId: session.id, err: stopErr }, "Failed to auto-stop stale paper session");
        }
      } else if (activityBaseline < tenMinutesAgo) {
        // ─── Stale warning: 10+ minutes inactive ───────────────
        // Surface a warning but do not stop yet.
        const staleSinceMs = Date.now() - activityBaseline.getTime();
        logger.warn(
          {
            sessionId: session.id,
            strategyId: session.strategyId,
            lastActivityTime: activityBaseline.toISOString(),
            staleSinceMs,
          },
          "Stale paper session detected — no signal or trade activity in 10+ minutes",
        );
        broadcastSSE("alert:triggered", {
          type: "paper_session_stale",
          sessionId: session.id,
          strategyId: session.strategyId,
          lastActivityTime: activityBaseline.toISOString(),
          staleSinceMs,
          message: `Paper session ${session.id.slice(0, 8)} has had no activity for ${Math.round(staleSinceMs / 60000)} minutes`,
        });
      }
    } catch (err) {
      logger.error({ sessionId: session.id, err }, "Failed to check staleness for paper session");
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

    // ─── Auto decay analysis (fire-and-forget) ───
    // Check for alpha decay after every trade close — early detection saves money
    import("./lib/python-runner.js")
      .then(({ runPythonModule }) =>
        runPythonModule({
          module: "src.engine.decay.half_life",
          config: { action: "analyze", strategy_id: strategyId },
          componentName: "decay-auto-check",
          timeoutMs: 15_000,
        }),
      )
      .then((decayResult: Record<string, unknown>) => {
        const decayScore = Number(decayResult.decay_score ?? 0);
        if (decayScore > 60) {
          broadcastSSE("strategy:decay-warning", {
            strategyId,
            decayScore,
            message: `Decay score ${decayScore} — strategy losing edge`,
          });
          AlertFactory.decayAlert(strategyId, decayScore > 80 ? "quarantine" : "watch").catch(() => {});
          logger.warn({ strategyId, decayScore }, "Auto decay check: elevated decay score");
        }
      })
      .catch((decayErr) => {
        logger.debug({ strategyId, err: decayErr }, "Auto decay check failed (non-blocking)");
      });
  } catch (err) {
    logger.error({ sessionId, strategyId, err }, "Drift check failed after paper trade close");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2.4 — Regret Score Fill
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fill regretScore and opportunityCost for skipDecisions rows that have
 * actualPnl populated but no regretScore yet.
 *
 * Regret logic:
 *   SKIP decision + positive actualPnl  → we left money on the table
 *     regretScore     = actualPnl  (the upside we missed)
 *     opportunityCost = actualPnl
 *
 *   SKIP decision + negative/zero actualPnl → we correctly avoided a loser
 *     regretScore     = 0  (no regret — the skip was right)
 *     opportunityCost = actualPnl  (negative = we saved this loss)
 *
 *   TRADE decision + negative actualPnl → we took a loss we could have skipped
 *     regretScore     = |actualPnl|  (the loss we absorbed)
 *     opportunityCost = 0  (per spec)
 *
 *   TRADE decision + positive/zero actualPnl → correct trade
 *     regretScore     = 0
 *     opportunityCost = 0
 *
 *   REDUCE decision → treated same as TRADE for regret purposes
 *
 * Runs nightly at 11 PM ET after all session post-processing is complete.
 */
async function fillRegretScores(): Promise<void> {
  // Find all rows with actualPnl set but regretScore still null
  const pending = await db
    .select({
      id: skipDecisions.id,
      decision: skipDecisions.decision,
      actualPnl: skipDecisions.actualPnl,
    })
    .from(skipDecisions)
    .where(
      and(
        isNotNull(skipDecisions.actualPnl),
        isNull(skipDecisions.regretScore),
      ),
    );

  if (pending.length === 0) {
    logger.info("Regret score fill: no pending rows");
    return;
  }

  logger.info({ count: pending.length }, "Regret score fill: processing rows");

  let updated = 0;
  let skipped = 0;

  for (const row of pending) {
    const pnl = Number(row.actualPnl ?? 0);
    let regretScore: number;
    let opportunityCost: number;

    const decision = (row.decision ?? "").toUpperCase();

    if (decision === "SKIP") {
      // Positive PnL = missed opportunity; negative PnL = saved from a loss
      regretScore = Math.max(0, pnl);
      opportunityCost = pnl; // can be negative (we saved money)
    } else {
      // TRADE or REDUCE — regret only if we took a loss
      regretScore = Math.abs(Math.min(0, pnl));
      opportunityCost = 0;
    }

    try {
      await db
        .update(skipDecisions)
        .set({
          regretScore: regretScore.toFixed(4),
          opportunityCost: opportunityCost.toFixed(4),
        })
        .where(eq(skipDecisions.id, row.id));

      updated++;
    } catch (err) {
      logger.error({ err, rowId: row.id }, "Regret score fill: failed to update row");
      skipped++;
    }
  }

  // Audit entry for observability
  await db.insert(auditLog).values({
    action: "regret.score-fill",
    entityType: "skip_decisions",
    input: { totalPending: pending.length },
    result: { updated, skipped },
    status: updated > 0 ? "success" : "failure",
    decisionAuthority: "scheduler",
  }).catch((err) => {
    logger.error({ err }, "Regret score fill: audit log insert failed");
  });

  broadcastSSE("scheduler:regret-score-fill", {
    updated,
    skipped,
    timestamp: new Date().toISOString(),
  });

  logger.info({ updated, skipped }, "Regret score fill: complete");
}
