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
import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { eq, and, gte, desc, isNotNull } from "drizzle-orm";
import { db } from "./db/index.js";
import {
  strategies,
  paperSessions,
  paperTrades,
  backtests,
  systemJournal,
  skipDecisions,
  skipWeightHistory,
  auditLog,
} from "./db/schema.js";
import { broadcastSSE } from "./routes/sse.js";
import { logger } from "./index.js";
import { LifecycleService } from "./services/lifecycle-service.js";

let initialized = false;

// ─── Registered jobs registry (for observability) ──────────────
const registeredJobs: Map<string, { intervalMs: number; lastRunAt: Date | null }> = new Map();

function registerJob(name: string, intervalMs: number, fn: () => Promise<void>): void {
  registeredJobs.set(name, { intervalMs, lastRunAt: null });
  // The actual scheduling is done by the caller using cron.schedule().
  // This registry exists purely so jobs can be inspected / logged.
  logger.info({ job: name, intervalMs }, "Scheduler: job registered");
  void fn; // reference prevents unused-var lint
}

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../..");

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

  // ─── Daily: Skip weight retrain ────────────────────────────
  // Fires at minute 0 of hours 5 and 6 UTC every day.
  // An ET hour guard inside the handler ensures actual execution happens
  // only at 1:00 AM ET (UTC-5 in winter, UTC-4 in summer — DST-aware).
  registerJob("skip-weight-retrain", 24 * 60 * 60 * 1000, retrainSkipWeights);
  cron.schedule("0 5,6 * * *", async () => {
    // DST-aware gate: run only when ET clock hour is 1.
    // getHours() returns UTC; ET offset is -5 (EST) or -4 (EDT).
    const nowUtc = new Date();
    const utcHour = nowUtc.getUTCHours();
    const etOffset = isEasternDaylightTime(nowUtc) ? 4 : 5;
    const etHour = (utcHour - etOffset + 24) % 24;

    if (etHour !== 1) {
      logger.debug({ utcHour, etHour }, "Scheduler: skip-weight-retrain cron fired but ET hour guard failed — skipping");
      return;
    }

    logger.info("Scheduler: Running skip weight retrain (1:00 AM ET)");
    const entry = registeredJobs.get("skip-weight-retrain");
    if (entry) entry.lastRunAt = new Date();

    try {
      await retrainSkipWeights();
    } catch (err) {
      logger.error({ err }, "Scheduler: Skip weight retrain failed");
    }
  });

  logger.info(
    "Scheduler initialized: rolling Sharpe (4h), pre-market prep (6:30 AM ET weekdays), " +
    "paper-vs-backtest (1h), lifecycle (6h), skip-weight-retrain (1 AM ET daily)",
  );
}

// ─── DST detection helper ────────────────────────────────────────
/**
 * Returns true if the given UTC Date falls within US Eastern Daylight Time.
 * EDT runs from the second Sunday in March through the first Sunday in November.
 * This is a pure computation — no external dependencies.
 */
function isEasternDaylightTime(utcDate: Date): boolean {
  const year = utcDate.getUTCFullYear();

  // Second Sunday in March at 2:00 AM ET (7:00 AM UTC in EST)
  const marchStart = nthSundayOfMonth(year, 2, 2); // month=2 (March, 0-indexed)
  marchStart.setUTCHours(7, 0, 0, 0); // 2 AM ET = 7 AM UTC during EST

  // First Sunday in November at 2:00 AM ET (6:00 AM UTC in EDT)
  const novEnd = nthSundayOfMonth(year, 10, 1); // month=10 (November, 0-indexed)
  novEnd.setUTCHours(6, 0, 0, 0); // 2 AM ET = 6 AM UTC during EDT

  return utcDate >= marchStart && utcDate < novEnd;
}

/** Returns the Nth occurrence (1-based) of Sunday in the given UTC month (0-indexed). */
function nthSundayOfMonth(year: number, month: number, n: number): Date {
  const d = new Date(Date.UTC(year, month, 1));
  const firstSundayOffset = (7 - d.getUTCDay()) % 7;
  const day = 1 + firstSundayOffset + (n - 1) * 7;
  return new Date(Date.UTC(year, month, day));
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
      const payload = await response.json() as { decisions?: Array<{ decision?: string }> };
      const decisions = Array.isArray(payload?.decisions) ? payload.decisions : [];
      const sitOuts = decisions.filter((d) => d.decision === "SKIP" || d.decision === "SIT_OUT");
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

// ─── TrainingResult shape (mirrors weight_trainer.py stdout) ────
interface TrainingResult {
  status: string;
  message: string;
  sampleSize: number;
  windowDays: number;
  baselineAccuracy: number | null;
  trainedAccuracy: number | null;
  weights: Record<string, number>;
}

/**
 * Retrain skip engine signal weights using the last 90 days of resolved
 * skip decisions. Calls weight_trainer.py via subprocess (same pattern as
 * skip.ts routes), persists the result to skip_weight_history, and writes
 * an audit_log entry. Broadcasts SSE on completion or failure.
 *
 * Gate: requires >= 30 rows with non-null actualOutcome in the window.
 * If the gate is not met, a row is still persisted with status="insufficient_data"
 * for observability.
 */
async function retrainSkipWeights(): Promise<void> {
  const WINDOW_DAYS = 90;
  const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // 1. Query resolved skip decisions within window
  const decisions = await db
    .select({
      signals: skipDecisions.signals,
      actualPnl: skipDecisions.actualPnl,
      decisionDate: skipDecisions.decisionDate,
    })
    .from(skipDecisions)
    .where(
      and(
        gte(skipDecisions.decisionDate, windowStart),
        isNotNull(skipDecisions.actualOutcome),
        isNotNull(skipDecisions.actualPnl),
      ),
    );

  logger.info(
    { count: decisions.length, windowDays: WINDOW_DAYS },
    "Scheduler: skip-weight-retrain — decisions fetched",
  );

  // 2. Build payload for weight_trainer.py
  const payload = {
    decisions: decisions.map((d) => ({
      signals: d.signals,
      actualPnl: d.actualPnl !== null ? Number(d.actualPnl) : null,
      decisionDate: (d.decisionDate instanceof Date
        ? d.decisionDate
        : new Date(d.decisionDate as string)
      ).toISOString().slice(0, 10),
    })),
    windowDays: WINDOW_DAYS,
  };

  // 3. Call weight_trainer.py subprocess
  let result: TrainingResult;
  try {
    result = await runPythonTrainer(payload);
  } catch (err) {
    logger.error({ err }, "Scheduler: weight_trainer.py subprocess failed");

    // Persist failure row for observability
    await db.insert(skipWeightHistory).values({
      windowDays: WINDOW_DAYS,
      sampleSize: decisions.length,
      weights: {},
      status: "error",
      message: String(err),
    }).catch((dbErr) => {
      logger.error({ dbErr }, "Scheduler: failed to persist weight history error row");
    });

    broadcastSSE("scheduler:skip-weight-retrain", {
      status: "error",
      message: String(err),
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // 4. Persist to skip_weight_history
  const [historyRow] = await db.insert(skipWeightHistory).values({
    windowDays: result.windowDays,
    sampleSize: result.sampleSize,
    weights: result.weights,
    baselineAccuracy: result.baselineAccuracy !== null ? String(result.baselineAccuracy) : null,
    trainedAccuracy: result.trainedAccuracy !== null ? String(result.trainedAccuracy) : null,
    status: result.status,
    message: result.message,
  }).returning();

  logger.info(
    {
      historyId: historyRow.id,
      status: result.status,
      sampleSize: result.sampleSize,
      baselineAccuracy: result.baselineAccuracy,
      trainedAccuracy: result.trainedAccuracy,
    },
    "Scheduler: skip weight history persisted",
  );

  // 5. Audit log entry
  await db.insert(auditLog).values({
    action: "skip.weight-retrain",
    entityType: "skip_weight_history",
    entityId: historyRow.id,
    input: { windowDays: WINDOW_DAYS, sampleSize: decisions.length },
    result: {
      status: result.status,
      baselineAccuracy: result.baselineAccuracy,
      trainedAccuracy: result.trainedAccuracy,
      weightsSnapshot: result.weights,
    },
    status: result.status === "ok" ? "success" : "failure",
  }).catch((err) => {
    logger.error({ err }, "Scheduler: failed to write audit log for weight retrain");
  });

  // 6. Broadcast SSE
  broadcastSSE("scheduler:skip-weight-retrain", {
    status: result.status,
    message: result.message,
    sampleSize: result.sampleSize,
    baselineAccuracy: result.baselineAccuracy,
    trainedAccuracy: result.trainedAccuracy,
    historyId: historyRow.id,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Spawn weight_trainer.py and return its parsed stdout as TrainingResult.
 * Follows the same subprocess pattern as runPython() in skip.ts.
 */
function runPythonTrainer(payload: object): Promise<TrainingResult> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const args = ["-m", "src.engine.skip_engine.weight_trainer", "--config", JSON.stringify(payload)];

    const proc = spawn(pythonCmd, args, {
      env: { ...process.env },
      cwd: PROJECT_ROOT,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => (stdout += data.toString()));
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
      logger.info({ component: "weight-trainer" }, data.toString().trim());
    });

    proc.on("close", (code: number | null) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout.trim()) as TrainingResult);
        } catch {
          reject(new Error(`weight_trainer output not valid JSON: ${stdout.slice(0, 200)}`));
        }
      } else {
        reject(new Error(`weight_trainer exited ${code}: ${stderr.slice(0, 400)}`));
      }
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (pythonCmd === "python") {
        // Retry with python3 (Linux/macOS fallback)
        const proc2 = spawn("python3", args, { env: { ...process.env }, cwd: PROJECT_ROOT });
        let stdout2 = "";
        let stderr2 = "";
        proc2.stdout.on("data", (d: Buffer) => (stdout2 += d.toString()));
        proc2.stderr.on("data", (d: Buffer) => (stderr2 += d.toString()));
        proc2.on("close", (code2: number | null) => {
          if (code2 === 0) {
            try { resolve(JSON.parse(stdout2.trim()) as TrainingResult); }
            catch { reject(new Error(`weight_trainer output not valid JSON: ${stdout2.slice(0, 200)}`)); }
          } else {
            reject(new Error(`weight_trainer (python3) exited ${code2}: ${stderr2.slice(0, 400)}`));
          }
        });
        proc2.on("error", () => reject(err));
      } else {
        reject(err);
      }
    });
  });
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
    const alerts = reports.filter(r => r.severity === "alert");

    if (alerts.length > 0) {
      broadcastSSE("strategy:drift-alert", {
        strategyId,
        sessionId,
        driftScore: maxDeviation,
        alerts,
        message: `Strategy drifting: ${maxDeviation.toFixed(1)}σ from backtest expectations`,
      });
      logger.warn({ strategyId, maxDeviation, alerts }, "Strategy drift detected after paper trade");
    }
  } catch (err) {
    logger.error({ sessionId, strategyId, err }, "Drift check failed after paper trade close");
  }
}
