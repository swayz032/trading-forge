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
import { randomUUID } from "crypto";
import { eq, and, gte, lte, desc, inArray, isNull, isNotNull } from "drizzle-orm";
import { db } from "./db/index.js";
import { strategies, paperSessions, paperPositions, paperTrades, paperSignalLogs, backtests, systemJournal, skipDecisions, auditLog, dayArchetypes, tournamentResults, macroSnapshots } from "./db/schema.js";
import { broadcastSSE } from "./routes/sse.js";
import { logger } from "./lib/logger.js";
import { LifecycleService } from "./services/lifecycle-service.js";
import { AlertFactory } from "./services/alert-service.js";
import { runPythonModule } from "./lib/python-runner.js";
import { startStream, stopStream, isStreaming, getActiveStreams, getStreamHealth } from "./services/paper-trading-stream.js";
import { restorePositionState, cleanupSession, restoreGovernorState } from "./services/paper-signal-service.js";
import { trainDeepAR, predictRegime, validatePastForecasts, isDeepARDeferred } from "./services/deepar-service.js";
import { setRegimeWeights } from "./services/regime-state-service.js";
import { runAgentHealthSweep } from "./services/agent-audit-service.js";
import { runPortfolioCorrelationCheck } from "./services/portfolio-optimizer-service.js";
import { runMetaParameterReview } from "./services/meta-optimizer-service.js";
import { notifyWarning, notifyCritical } from "./services/notification-service.js";
import { runAntiSetupEffectivenessAnalysis } from "./services/anti-setup-effectiveness-service.js";
import { invalidateAntiSetupCache } from "./services/anti-setup-gate-service.js";
import { isActive as isPipelineActive, getMode as getPipelineMode } from "./services/pipeline-control-service.js";
import { computeAndPersistSessionFeedback } from "./services/paper-session-feedback-service.js";
import { registerRetryHandler } from "./lib/dlq-service.js";

let initialized = false;

// ─── Scheduler health tracking ────────────────────────────────
// Each cron job updates its own slot on every successful fire.
// Export allows the health endpoint to surface real liveness data.
const schedulerHealth: Record<string, Date> = {};

// ─── Per-job last error tracking ─────────────────────────────
// Populated in withRetry's catch path. Cleared on next successful run.
// Surfaces via getSchedulerHealth so /api/admin/scheduler/health
// (and /api/health) can show the last known failure reason per job.
const schedulerLastError: Record<string, string | null> = {};

export interface SchedulerHealthEntry {
  lastRunAt: Date;
  lastError: string | null;
}

export function getSchedulerHealth(): Readonly<Record<string, Date>> {
  return schedulerHealth;
}

/** Extended health — includes lastError per job for admin dashboard. */
export function getSchedulerHealthExtended(): Readonly<Record<string, SchedulerHealthEntry>> {
  const result: Record<string, SchedulerHealthEntry> = {};
  for (const [name, date] of Object.entries(schedulerHealth)) {
    result[name] = { lastRunAt: date, lastError: schedulerLastError[name] ?? null };
  }
  return result;
}

// ─── Paper session auto-recovery tracking ────────────────────
/** Track auto-recovery attempts per session to prevent infinite loops */
const recoveryAttempts = new Map<string, number>();
const MAX_RECOVERY_ATTEMPTS = 3;

// ─── Self-healing: job failure tracking ──────────────────────
/** Track consecutive failures per job for self-healing */
export interface JobHealth {
  consecutiveFailures: number;
  lastFailure: Date | null;
  disabled: boolean;
  disabledAt: Date | null;
  disableReason: string | null;
}

const jobHealthTracker = new Map<string, JobHealth>();

const FAILURE_WARN_THRESHOLD = 3;
const FAILURE_DISABLE_THRESHOLD = 5;

/** Jobs that must never be auto-disabled (critical infrastructure) */
const NEVER_DISABLE_JOBS = new Set(["metrics-heartbeat", "stale-session-check", "disabled-job-probe"]);

function getJobHealth(name: string): JobHealth {
  let health = jobHealthTracker.get(name);
  if (!health) {
    health = { consecutiveFailures: 0, lastFailure: null, disabled: false, disabledAt: null, disableReason: null };
    jobHealthTracker.set(name, health);
  }
  return health;
}

function recordJobSuccess(name: string): void {
  const health = getJobHealth(name);
  if (health.consecutiveFailures > 0) {
    logger.info({ job: name, previousFailures: health.consecutiveFailures }, "Scheduler: job recovered after failures");
  }
  health.consecutiveFailures = 0;
  health.lastFailure = null;
}

function recordJobFailure(name: string, error: unknown): void {
  const health = getJobHealth(name);
  health.consecutiveFailures++;
  health.lastFailure = new Date();

  if (health.consecutiveFailures === FAILURE_WARN_THRESHOLD) {
    notifyWarning(
      `Scheduler: ${name} failing repeatedly`,
      `Job "${name}" has failed ${health.consecutiveFailures} times in a row. Last error: ${error instanceof Error ? error.message : String(error)}`,
      { job: name, consecutiveFailures: health.consecutiveFailures },
    );
  }

  if (health.consecutiveFailures >= FAILURE_DISABLE_THRESHOLD && !health.disabled && !NEVER_DISABLE_JOBS.has(name)) {
    health.disabled = true;
    health.disabledAt = new Date();
    health.disableReason = `Auto-disabled after ${health.consecutiveFailures} consecutive failures`;

    notifyCritical(
      `Scheduler: ${name} AUTO-DISABLED`,
      `Job "${name}" disabled after ${health.consecutiveFailures} consecutive failures.\nLast error: ${error instanceof Error ? error.message : String(error)}\nUse POST /api/admin/scheduler/jobs/${name}/enable to re-enable.`,
      { job: name, consecutiveFailures: health.consecutiveFailures },
    );

    logger.error(
      { job: name, consecutiveFailures: health.consecutiveFailures },
      "Scheduler: job AUTO-DISABLED due to repeated failures",
    );
  }
}

/** Export for admin routes */
export function getAllJobHealth(): Map<string, JobHealth> {
  return jobHealthTracker;
}

export function enableJob(name: string): boolean {
  const health = jobHealthTracker.get(name);
  if (!health || !health.disabled) return false;
  health.disabled = false;
  health.disabledAt = null;
  health.disableReason = null;
  health.consecutiveFailures = 0;
  logger.info({ job: name }, "Scheduler: job manually re-enabled");
  return true;
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
  // Check if job is disabled
  const health = getJobHealth(name);
  if (health.disabled) {
    logger.debug({ job: name }, "Scheduler: job is disabled — skipping");
    return;
  }

  let attempt = 0;
  let lastErr: unknown;
  while (attempt <= maxRetries) {
    try {
      await fn();
      recordJobSuccess(name);
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

  // Surface last error in health map so admin endpoint can query it
  schedulerLastError[name] = lastErr instanceof Error ? lastErr.message : String(lastErr);

  recordJobFailure(name, lastErr);

  // Capture to DLQ for retry/escalation
  try {
    const { captureToDLQ } = await import("./lib/dlq-service.js");
    await captureToDLQ({
      operationType: `scheduler:${name}`,
      entityType: "scheduler_job",
      entityId: name,
      errorMessage: lastErr instanceof Error ? lastErr.message : String(lastErr),
      metadata: { attempts: attempt, maxRetries },
    });
  } catch (dlqErr) {
    logger.error({ err: dlqErr, job: name }, "Failed to capture to DLQ — error suppressed");
  }
}

// ─── Pipeline gate — always-run jobs bypass the check ────────
// pipeline-resume-drain MUST run when paused so it can detect the transition
// back to ACTIVE; it has its own internal mode-change detector.
const ALWAYS_RUN_JOBS = new Set(["metrics-heartbeat", "stale-session-check", "pipeline-resume-drain"]);

// ─── Pipeline mode tracker (drives resume-drain) ─────────────
// Records the last-observed pipeline mode so we can detect transitions back
// to ACTIVE (PAUSED → ACTIVE or VACATION → ACTIVE) and drain queued scouted
// ideas. Initial value `null` means we haven't observed yet — first poll will
// store the mode without triggering a drain (no transition observed).
let lastObservedPipelineMode: import("./services/pipeline-control-service.js").PipelineMode | null = null;

async function pipelineGate(jobName: string): Promise<boolean> {
  if (ALWAYS_RUN_JOBS.has(jobName)) return true;
  const active = await isPipelineActive();
  if (!active) {
    logger.debug({ job: jobName }, "Scheduler: pipeline not ACTIVE — skipping job");
  }
  return active;
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
  schedulerLastError[name] = null; // clear any previous error on successful run
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

/**
 * Register DLQ retry handlers for all production operation types.
 *
 * Each handler is given the full DLQ row (including metadata with the original
 * config/payload) and re-invokes the original operation. On success the handler
 * returns normally; on failure it throws and dlq-service increments retryCount.
 *
 * Handlers are registered once at scheduler init so all retry attempts (both
 * manual via /api/dlq/:id/retry and the automated retryAllUnresolved sweep)
 * use the same handler map.
 */
function registerDLQHandlers(): void {
  // ── monte_carlo:failure ── re-invoke MC for the backtest referenced in metadata
  registerRetryHandler("monte_carlo:failure", async (item) => {
    const meta = (item.metadata ?? {}) as Record<string, unknown>;
    const backtestId = meta.backtestId as string | undefined;
    if (!backtestId) throw new Error("monte_carlo:failure DLQ item missing metadata.backtestId");
    const { runMonteCarlo } = await import("./services/monte-carlo-service.js");
    const result = await runMonteCarlo(backtestId, { numSimulations: 10000 });
    if (result.status === "failed") throw new Error(result.error ?? "MC retry failed");
  });

  // ── critic:failure ── re-invoke critic optimizer for the backtest referenced in metadata
  registerRetryHandler("critic:failure", async (item) => {
    const meta = (item.metadata ?? {}) as Record<string, unknown>;
    const backtestId = meta.backtestId as string | undefined;
    const strategyId = (meta.strategyId ?? item.entityId) as string | undefined;
    if (!backtestId || !strategyId) throw new Error("critic:failure DLQ item missing metadata.backtestId or strategyId");
    const { triggerCriticOptimizer } = await import("./services/critic-optimizer-service.js");
    const result = await triggerCriticOptimizer(backtestId, strategyId, {});
    if (result.status.startsWith("failed")) throw new Error(`Critic retry failed: ${result.status}`);
  });

  // ── sqa_optimization:failure / qubo_timing:failure / tensor_prediction:failure /
  //    rl_training:failure ── these are all fire-and-forget analytics runs that
  //    failed AFTER the primary backtest committed. Re-run from the backtestId in
  //    metadata. A simple no-op retry logs the attempt; the analytics are not
  //    business-critical but we do want them retried once.
  for (const opType of [
    "sqa_optimization:failure",
    "qubo_timing:failure",
    "tensor_prediction:failure",
    "rl_training:failure",
  ] as const) {
    registerRetryHandler(opType, async (item) => {
      const meta = (item.metadata ?? {}) as Record<string, unknown>;
      logger.info(
        { dlqId: item.id, operationType: opType, backtestId: meta.backtestId },
        "DLQ retry: analytics sub-run — re-trigger deferred (no auto-rerun implemented, marking resolved)",
      );
      // Analytics sub-runs (SQA/QUBO/Tensor/RL) require the original backtest
      // config to re-invoke. Rather than duplicating that logic here, we log the
      // retry attempt and resolve the DLQ item so it doesn't escalate indefinitely.
      // Operators can trigger a full re-backtest from the UI if the analytics data
      // is needed for a promotion decision.
    });
  }

  // ── deepar:training_failure / deepar:prediction_failure ── re-invoke DeepAR service
  registerRetryHandler("deepar:training_failure", async (_item) => {
    const { trainDeepAR: retryTrain } = await import("./services/deepar-service.js");
    await retryTrain();
  });

  registerRetryHandler("deepar:prediction_failure", async (_item) => {
    const { predictRegime: retryPredict } = await import("./services/deepar-service.js");
    await retryPredict();
  });

  logger.info(
    { handlers: ["monte_carlo:failure", "critic:failure", "sqa_optimization:failure", "qubo_timing:failure", "tensor_prediction:failure", "rl_training:failure", "deepar:training_failure", "deepar:prediction_failure"] },
    "DLQ retry handlers registered",
  );
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
  registerJob("deepar-train", 24 * 60 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    logger.info({ correlationId, jobName: "deepar-train" }, "cron tick start");
    await trainDeepAR(undefined, correlationId);
  });
  registerJob("deepar-predict", 24 * 60 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    logger.info({ correlationId, jobName: "deepar-predict" }, "cron tick start");
    // C1: feed regime probabilities into the Skip Engine.  predictRegime()
    // already persists forecasts to deepar_forecasts; we wrap it so the
    // in-memory regime state (read by /api/skip/classify) is updated in
    // the same scheduler tick — no race window between predict and skip.
    const forecasts = await predictRegime(undefined, correlationId);
    // Caveat 1: predictRegime returns a deferred sentinel on circuit-open
    // instead of throwing. Skip regime-state updates this tick — next scheduler
    // run will retry once the breaker closes.
    if (isDeepARDeferred(forecasts)) {
      logger.warn(
        { reason: forecasts.reason, reopensAt: forecasts.reopensAt },
        "deepar-predict deferred — skipping regime state update for this tick",
      );
      return;
    }
    for (const [symbol, f] of Object.entries(forecasts)) {
      try {
        await setRegimeWeights(
          symbol,
          {
            high_vol: Number(f.p_high_vol ?? 0),
            trending: Number(f.p_trending ?? 0),
            mean_revert: Number(f.p_mean_revert ?? 0),
            correlation_stress:
              f.p_correlation_stress === undefined ? undefined : Number(f.p_correlation_stress),
          },
          {
            forecastDate: f.forecast_date,
            forecastConfidence: Number(f.forecast_confidence ?? 0),
          },
        );
      } catch (err) {
        logger.warn({ err, symbol }, "deepar-predict → regime state update failed (non-blocking)");
      }
    }
  });
  registerJob("deepar-validate", 24 * 60 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    logger.info({ correlationId, jobName: "deepar-validate" }, "cron tick start");
    await validatePastForecasts({ correlationId });
  });
  // C2: Day archetype daily classifier — predict today's archetype at 6 AM ET
  registerJob("archetype-daily-classify", 24 * 60 * 60 * 1000, async () => {
    await runArchetypeDailyClassify();
  });
  // Loop 1 (Pre-Session): Macro regime daily sync — pull FRED/BLS/EIA snapshot
  // and classify macro_regime BEFORE the day archetype classifier runs at 6 AM ET.
  // Populates macroSnapshots — read by bias engine, skip classifier, eligibility matrix.
  registerJob("macro-data-sync", 24 * 60 * 60 * 1000, async () => {
    await runMacroDailySync();
  });
  const lifecycle = new LifecycleService();
  registerJob("lifecycle-auto-check", 6 * 60 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    logger.info({ correlationId, jobName: "lifecycle-auto-check" }, "cron tick start");
    const promoted = await lifecycle.checkAutoPromotions({ correlationId });
    const demoted = await lifecycle.checkAutoDemotions({ correlationId });
    if (promoted.length > 0 || demoted.length > 0) {
      broadcastSSE("lifecycle:auto-check", {
        promoted,
        demoted,
        timestamp: new Date().toISOString(),
      });
    }
    logger.info({ promoted: promoted.length, demoted: demoted.length, correlationId }, "Lifecycle auto-check complete");

    // Discord: WARNING if strategies were demoted — system health degraded
    if (demoted.length > 0) {
      notifyWarning(
        `System health degraded: ${demoted.length} strategy demotion(s)`,
        `${demoted.length} strategy/strategies were automatically demoted during the lifecycle check. Review the dashboard for details on which strategies are now in DECLINING state.`,
        { demotedCount: demoted.length, promotedCount: promoted.length, demotedIds: demoted },
      );
    }
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

  // ─── Weekly: Anti-setup miner (Monday 12 AM ET) ──────────
  // Mines anti-setups from PAPER/DEPLOYED strategies and persists to audit_log
  // so the real-time anti-setup gate can load them.
  registerJob("anti-setup-mine", 7 * 24 * 60 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    logger.info({ correlationId, jobName: "anti-setup-mine" }, "cron tick start: Running anti-setup miner");
    const activeStrategies = await db.select({ id: strategies.id, name: strategies.name })
      .from(strategies)
      .where(inArray(strategies.lifecycleState, ["PAPER", "DEPLOYED"]));
    if (activeStrategies.length === 0) {
      logger.info({ correlationId }, "Anti-setup miner: no PAPER/DEPLOYED strategies — skipping");
      return;
    }
    for (const strat of activeStrategies) {
      try {
        const result = await runPythonModule<Record<string, unknown>>({
          module: "src.engine.anti_setups.miner",
          config: { strategy_id: strat.id },
          timeoutMs: 120_000,
          componentName: "anti-setup-miner",
          correlationId,
        });
        // Persist mined anti-setups to audit_log so the gate service can read them
        await db.insert(auditLog).values({
          action: "anti_setup.mined",
          entityType: "strategy",
          entityId: strat.id,
          result: result as Record<string, unknown>,
          status: "success",
          decisionAuthority: "scheduler",
          correlationId,
        });
        // Invalidate cached anti-setups so the gate picks up newly mined rules
        invalidateAntiSetupCache(strat.id);
        logger.info({ strategyId: strat.id, name: strat.name }, "Anti-setup miner completed for strategy");
      } catch (err) {
        logger.warn({ err, strategyId: strat.id }, "Anti-setup miner failed for strategy (non-blocking)");
      }
    }
    broadcastSSE("anti-setup:mined", { count: activeStrategies.length });
  });

  // ─── Weekly: Anti-setup effectiveness analysis (after miner) ──
  // Evaluates whether anti-setups are blocking losers or accidentally blocking winners.
  // Results stored in audit_log and broadcast via SSE.
  registerJob("anti-setup-effectiveness", 7 * 24 * 60 * 60 * 1000, async () => {
    logger.info("Scheduler: Running anti-setup effectiveness analysis");
    const report = await runAntiSetupEffectivenessAnalysis(7);
    logger.info(
      {
        totalBlocked: report.totalTradesBlocked,
        totalHypotheticalPnl: report.totalHypotheticalPnl,
        suspectCount: report.suspectRules.length,
      },
      "Anti-setup effectiveness analysis complete",
    );
  });

  // ─── M4 fix: drain scouted ideas every 10 minutes ────────────
  // Without this, n8n strict-scout entries would pile up in system_journal
  // forever — drainScoutedIdeas previously only fired on PAUSE→ACTIVE
  // transitions. drainScoutedIdeas internally checks isPipelineActive(),
  // so this is safe to call always: when paused, scouts continue to flow
  // to the journal but no backtests run; when active, the queue drains.
  registerJob("drain-scouted-ideas-periodic", 10 * 60 * 1000, async () => {
    const { AgentService } = await import("./services/agent-service.js");
    const agent = new AgentService();
    const result = await agent.drainScoutedIdeas(50);
    if (result.drained > 0 || result.failed > 0) {
      logger.info(
        { drained: result.drained, failed: result.failed, scanned: result.scanned },
        "drain-scouted-ideas-periodic: tick complete",
      );
    }
  });

  // ─── Phase 1.4: Metrics heartbeat every 60s ───────────────
  // Broadcasts rolling session metrics snapshot over SSE so the live
  // dashboard stays current between trade closes on quiet sessions.
  registerJob("metrics-heartbeat", 60 * 1000, async () => {
    const { metricsAggregator } = await import("./services/metrics-aggregator.js");
    metricsAggregator.emitSnapshot();
  });

  // ─── FIX 3: Register DLQ retry handlers ───────────────────
  // Wire concrete handlers for the operationTypes that appear in production.
  // Each handler returns on success; throws on failure (dlq-service catches
  // and increments retryCount). Handlers are registered lazily to avoid
  // circular-dep issues with services that import from scheduler.ts.
  registerDLQHandlers();

  // ─── FIX 4: Python subprocess pool saturation check (every 30s) ───
  // Fires an alert when the queue has been backlogged for >= 60 seconds
  // (6 consecutive 30s ticks). Resets counter after alerting so future
  // sustained backpressure generates a new alert rather than being swallowed.
  {
    let poolSaturationTicks = 0;
    registerJob("python-pool-saturation-check", 30 * 1000, async () => {
      const { getPythonSubprocessStats } = await import("./lib/python-runner.js");
      const stats = getPythonSubprocessStats();
      if (stats.queued > 0) {
        poolSaturationTicks++;
        if (poolSaturationTicks >= 6) {
          AlertFactory.systemError(
            "python-pool-saturation",
            `Python subprocess pool backlogged for >=60s: queued=${stats.queued}, active=${stats.active}, cap=${stats.cap}`,
          ).catch(() => {});
          logger.warn(
            { queued: stats.queued, active: stats.active, cap: stats.cap, ticks: poolSaturationTicks },
            "python-pool-saturation: alert fired — 60s sustained backpressure",
          );
          poolSaturationTicks = 0;
        }
      } else {
        poolSaturationTicks = 0;
      }
    });
  }

  // ─── Every 4 hours: Rolling Sharpe update ─────────────────
  cron.schedule("0 */4 * * *", async () => {
    if (!(await pipelineGate("rolling-sharpe"))) return;
    logger.info("Scheduler: Running 4-hour rolling Sharpe update");
    const t0 = Date.now();
    await withRetry("rolling-sharpe", updateRollingSharpe);
    markJobRun("rolling-sharpe");
    emitJobComplete("rolling-sharpe", Date.now() - t0);
  });

  // ─── Daily at 6:05 AM ET: Pre-market prep (DST-aware) ────
  // Staggered to 6:05 AM ET (was 6:00 AM ET) to avoid competing with
  // DeepAR predict (6:00 AM ET) for the Python subprocess pool.
  // Run at both 10:05 and 11:05 UTC to cover EDT (UTC-4) and EST (UTC-5).
  // Check actual ET hour+minute before executing — only one will fire.
  cron.schedule("5 10,11 * * 1-5", async () => {
    const now = new Date();
    const etTimeStr = now.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    // etTimeStr is like "6:05" or "7:05" — extract hour and minute
    const [etHourStr, etMinStr] = etTimeStr.split(":");
    const etHour = parseInt(etHourStr, 10);
    const etMin = parseInt(etMinStr, 10);
    if (etHour !== 6 || etMin !== 5) {
      logger.debug({ etHour, etMin, utcHour: now.getUTCHours() }, "Scheduler: Pre-market cron fired but not 6:05 AM ET — skipping");
      return;
    }
    if (!(await pipelineGate("pre-market-prep"))) return;
    logger.info("Scheduler: Pre-market prep (6:05 AM ET confirmed)");
    const t0premarket = Date.now();
    await withRetry("pre-market-prep", preMarketPrep);
    markJobRun("pre-market-prep");
    emitJobComplete("pre-market-prep", Date.now() - t0premarket);
  });

  // ─── Every hour: Compare stopped paper sessions to backtest ─
  cron.schedule("0 * * * *", async () => {
    if (!(await pipelineGate("paper-vs-backtest"))) return;
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
    if (!(await pipelineGate("decay-monitor"))) return;
    logger.info("Scheduler: Daily decay monitor sweep (2:00 AM ET confirmed)");
    const t0decay = Date.now();
    await withRetry("decay-monitor", runDailyDecayMonitor);
    markJobRun("decay-monitor");
    emitJobComplete("decay-monitor", Date.now() - t0decay);
  });

  // ─── Every 6 hours: Lifecycle auto-promotions/demotions ────
  cron.schedule("0 */6 * * *", async () => {
    if (!(await pipelineGate("lifecycle-auto-check"))) return;
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

  // ─── Pipeline resume-drain — every 30 seconds ────────────────
  // State-based polling: detects PAUSED/VACATION → ACTIVE transition and
  // drains scouted-but-unbacktested ideas through compile → backtest. Runs
  // every 30s (in ALWAYS_RUN_JOBS so it executes even while paused, since
  // it needs to observe the transition out of paused). Internal logic:
  //   1. Read current mode.
  //   2. If we've never observed before, just record and return (no drain).
  //   3. If transitioning to ACTIVE from PAUSED/VACATION, drain in batches.
  //   4. Until backlog is empty, keep draining each tick (20 per tick when
  //      backlog > 100, 100 per tick otherwise — natural 30s pacing).
  //   5. Update the tracker.
  // The drain stays active across ticks (not just transition) so a 1000-idea
  // backlog clears in ~50 ticks @ 20/tick = 25 minutes, with 30s spacing
  // between batches preventing system overload.
  registerJob("pipeline-resume-drain", 30 * 1000, async () => {
    const correlationId = randomUUID();
    const currentMode = await getPipelineMode();
    const previousMode = lastObservedPipelineMode;
    lastObservedPipelineMode = currentMode;

    // First observation — establish baseline without triggering drain.
    if (previousMode === null) {
      logger.debug({ currentMode, correlationId }, "Pipeline resume-drain: baseline mode recorded");
      return;
    }

    // Drain only when ACTIVE. Never drain while paused (defence-in-depth — the
    // drainScoutedIdeas() method also re-checks).
    if (currentMode !== "ACTIVE") return;

    // Quick count to decide batch size (20 if backlog > 100, else 100).
    const { systemJournal } = await import("./db/schema.js");
    const { sql: sqlOp } = await import("drizzle-orm");
    const [countRow] = await db
      .select({ c: sqlOp<number>`count(*)::int` })
      .from(systemJournal)
      .where(sqlOp`status = 'scouted' AND strategy_id IS NULL`);
    const backlog = countRow?.c ?? 0;

    // No queued ideas — nothing to drain. Skip without log spam.
    if (backlog === 0) return;

    const wasResumed = previousMode === "PAUSED" || previousMode === "VACATION";
    const batchLimit = backlog > 100 ? 20 : 100;

    if (wasResumed) {
      logger.info(
        { previousMode, currentMode, backlog, batchLimit },
        "Pipeline resume-drain: detected resume — draining scouted ideas",
      );
    } else {
      logger.debug(
        { backlog, batchLimit },
        "Pipeline resume-drain: continuing to drain backlog",
      );
    }

    // Lazy import to avoid eager construction at module load time.
    const { AgentService } = await import("./services/agent-service.js");
    const agentService = new AgentService();

    const drainResult = await agentService.drainScoutedIdeas(batchLimit);

    // Audit log — pipeline.drain-resume — captures what was drained for replay.
    // Only logged on resume tick or partial-failure tick to avoid audit spam
    // when draining a steady-state backlog.
    if (wasResumed || drainResult.failed > 0) {
      await db.insert(auditLog).values({
        action: "pipeline.drain-resume",
        entityType: "system",
        entityId: null,
        input: { previousMode, currentMode, backlog, batchLimit, resumeTick: wasResumed },
        result: drainResult as unknown as Record<string, unknown>,
        status: drainResult.failed === 0 ? "success" : "partial",
        decisionAuthority: "scheduler",
        correlationId,
      });
    }

    broadcastSSE("pipeline:drain-resume", {
      previousMode,
      currentMode,
      ...drainResult,
      backlog,
      resumeTick: wasResumed,
    });

    logger.info(
      { ...drainResult, backlog, batchLimit, resumeTick: wasResumed },
      "Pipeline resume-drain: tick complete",
    );
  });

  cron.schedule("*/30 * * * * *", async () => {
    const t0drain = Date.now();
    await withRetry("pipeline-resume-drain", SCHEDULER_JOBS["pipeline-resume-drain"].run, 1);
    markJobRun("pipeline-resume-drain");
    emitJobComplete("pipeline-resume-drain", Date.now() - t0drain);
  });

  // ─── M4 fix: drain-scouted-ideas-periodic — every 10 minutes ───
  // Periodic drain so n8n strict-scout entries don't pile up forever.
  // pipeline-resume-drain only fires on PAUSE→ACTIVE transitions; this
  // covers the steady-state "pipeline is active and scouts are flowing" case.
  cron.schedule("*/10 * * * *", async () => {
    const t0drainP = Date.now();
    await withRetry("drain-scouted-ideas-periodic", SCHEDULER_JOBS["drain-scouted-ideas-periodic"].run, 1);
    markJobRun("drain-scouted-ideas-periodic");
    emitJobComplete("drain-scouted-ideas-periodic", Date.now() - t0drainP);
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
    if (!(await pipelineGate("deepar-train"))) return;
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
    if (!(await pipelineGate("deepar-predict"))) return;
    logger.info("Scheduler: DeepAR prediction (6:00 AM ET)");
    const t0dp = Date.now();
    // C1: use the registered job (which feeds regime state) so the Skip
    // Engine sees fresh probabilities the moment forecasts are persisted.
    await withRetry("deepar-predict", SCHEDULER_JOBS["deepar-predict"].run);
    markJobRun("deepar-predict");
    emitJobComplete("deepar-predict", Date.now() - t0dp);
  });

  // ─── Loop 1: Macro regime daily sync — 5 AM ET (DST-aware) ──────
  // Runs BEFORE archetype classifier (6 AM) and DeepAR predict (6 AM)
  // so today's macro_regime is the freshest signal those jobs see.
  cron.schedule("0 9,10 * * 1-5", async () => {
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
    if (etHour !== 5 || etMin !== 0) return;
    if (!(await pipelineGate("macro-data-sync"))) return;
    logger.info("Scheduler: Macro regime daily sync (5:00 AM ET)");
    const t0macro = Date.now();
    await withRetry("macro-data-sync", SCHEDULER_JOBS["macro-data-sync"].run);
    markJobRun("macro-data-sync");
    emitJobComplete("macro-data-sync", Date.now() - t0macro);
  });

  // ─── C2: Day archetype classifier — daily at 6 AM ET (DST-aware) ───
  // Runs in parallel with deepar-predict.  Predicts today's day archetype
  // (TREND_DAY_UP, RANGE_DAY, …) from premarket features and writes one
  // row per symbol into day_archetypes.  Strategy eligibility matrix
  // and skip classifier read from this table at evaluation time.
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
    if (!(await pipelineGate("archetype-daily-classify"))) return;
    logger.info("Scheduler: Day archetype classifier (6:00 AM ET)");
    const t0arch = Date.now();
    await withRetry("archetype-daily-classify", SCHEDULER_JOBS["archetype-daily-classify"].run);
    markJobRun("archetype-daily-classify");
    emitJobComplete("archetype-daily-classify", Date.now() - t0arch);
  });

  // ─── DeepAR: Validate at 6:35 AM ET (weekdays) ────────────
  // Staggered to 6:35 AM ET (was 6:30 AM ET) to give pre-market prep (6:05)
  // a 30-min window before a second Python-spawning cron hits the pool.
  // Run at both 10:35 and 11:35 UTC to cover EDT/EST.
  cron.schedule("35 10,11 * * 1-5", async () => {
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
    if (etHour !== 6 || etMin !== 35) return;
    if (!(await pipelineGate("deepar-validate"))) return;
    logger.info("Scheduler: DeepAR validation (6:35 AM ET)");
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
    if (!(await pipelineGate("regret-score-fill"))) return;
    logger.info("Scheduler: Regret score fill (11:00 PM ET)");
    const t0rs = Date.now();
    await withRetry("regret-score-fill", fillRegretScores);
    markJobRun("regret-score-fill");
    emitJobComplete("regret-score-fill", Date.now() - t0rs);
  });

  // ─── Every 2 hours: Agent health sweep ───────────────────
  cron.schedule("0 */2 * * *", async () => {
    if (!(await pipelineGate("agent-health-sweep"))) return;
    logger.info("Scheduler: Running agent health sweep");
    const t0ahs = Date.now();
    await withRetry("agent-health-sweep", async () => { await runAgentHealthSweep(); });
    markJobRun("agent-health-sweep");
    emitJobComplete("agent-health-sweep", Date.now() - t0ahs);
  });

  // ─── Daily at midnight UTC: Portfolio correlation check ──
  cron.schedule("0 0 * * *", async () => {
    if (!(await pipelineGate("portfolio-correlation"))) return;
    logger.info("Scheduler: Running portfolio correlation check");
    const t0pc = Date.now();
    await withRetry("portfolio-correlation", async () => { await runPortfolioCorrelationCheck(); });
    markJobRun("portfolio-correlation");
    emitJobComplete("portfolio-correlation", Date.now() - t0pc);
  });

  // ─── Monthly on 1st at 3:00 AM UTC: Meta parameter review ─
  cron.schedule("0 3 1 * *", async () => {
    if (!(await pipelineGate("meta-parameter-review"))) return;
    logger.info("Scheduler: Running monthly meta parameter review");
    const t0mp = Date.now();
    await withRetry("meta-parameter-review", async () => { await runMetaParameterReview(30); });
    markJobRun("meta-parameter-review");
    emitJobComplete("meta-parameter-review", Date.now() - t0mp);
  });

  // ─── Weekly Monday 12 AM ET: Anti-setup mine + effectiveness ──
  // Run at 4:00 and 5:00 UTC to cover EDT (UTC-4) and EST (UTC-5).
  // Only fires when the ET hour resolves to Monday 12:00 AM.
  cron.schedule("0 4,5 * * 1", async () => {
    const now = new Date();
    const etStr = now.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
      weekday: "short",
    });
    if (!etStr.startsWith("Mon") || !etStr.includes("0:")) return;

    if (!(await pipelineGate("anti-setup-mine"))) return;

    // 1. Mine anti-setups
    logger.info("Scheduler: Anti-setup miner (Monday 12 AM ET)");
    const t0as = Date.now();
    await withRetry("anti-setup-mine", SCHEDULER_JOBS["anti-setup-mine"].run);
    markJobRun("anti-setup-mine");
    emitJobComplete("anti-setup-mine", Date.now() - t0as);

    // 2. Run effectiveness analysis immediately after mining
    logger.info("Scheduler: Anti-setup effectiveness analysis (Monday, after miner)");
    const t0eff = Date.now();
    await withRetry("anti-setup-effectiveness", SCHEDULER_JOBS["anti-setup-effectiveness"].run);
    markJobRun("anti-setup-effectiveness");
    emitJobComplete("anti-setup-effectiveness", Date.now() - t0eff);
  });

  // ─── DLQ retry — every 15 minutes ─────────────────────────
  registerJob("dlq-retry", 15 * 60 * 1000, async () => {
    const { retryAllUnresolved } = await import("./lib/dlq-service.js");
    const result = await retryAllUnresolved();
    if (result.attempted > 0) {
      logger.info(result, "DLQ batch retry completed");
    }
  });

  cron.schedule("*/15 * * * *", async () => {
    if (!(await pipelineGate("dlq-retry"))) return;
    const t0dlq = Date.now();
    await withRetry("dlq-retry", SCHEDULER_JOBS["dlq-retry"].run);
    markJobRun("dlq-retry");
    emitJobComplete("dlq-retry", Date.now() - t0dlq);
  });

  // ─── DLQ escalation — every hour ──────────────────────────
  registerJob("dlq-escalation", 60 * 60 * 1000, async () => {
    const { escalateDLQ } = await import("./lib/dlq-service.js");
    const count = await escalateDLQ();
    if (count > 0) {
      logger.warn({ escalated: count }, "DLQ items escalated");
    }
  });

  cron.schedule("0 * * * *", async () => {
    if (!(await pipelineGate("dlq-escalation"))) return;
    const t0esc = Date.now();
    await withRetry("dlq-escalation", SCHEDULER_JOBS["dlq-escalation"].run);
    markJobRun("dlq-escalation");
    emitJobComplete("dlq-escalation", Date.now() - t0esc);
  });

  // ─── Idempotency key cleanup — daily at 3 AM ET ──────────────
  registerJob("idempotency-cleanup", 24 * 60 * 60 * 1000, async () => {
    const { idempotencyKeys } = await import("./db/schema.js");
    const { lt } = await import("drizzle-orm");
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, cutoff));
    logger.info("Idempotency keys cleaned up");
  });

  cron.schedule("0 3 * * *", async () => {
    if (!(await pipelineGate("idempotency-cleanup"))) return;
    const t0idem = Date.now();
    await withRetry("idempotency-cleanup", SCHEDULER_JOBS["idempotency-cleanup"].run);
    markJobRun("idempotency-cleanup");
    emitJobComplete("idempotency-cleanup", Date.now() - t0idem);
  });

  // ─── Tier 1.4: Quantum cost row pruner — hourly ──────────────
  // quantum_run_costs rows start with status="pending" before the Python call.
  // If the process restarts between recordCost() and completeCost(), the row
  // hangs pending forever. Prune any pending rows older than 1 hour.
  // One-shot at startup (5s delay) covers orphans from the previous run.

  // One-shot startup prune (deferred 5s to let server fully initialize)
  setTimeout(() => {
    import("./lib/quantum-cost-tracker.js").then(({ pruneStalePendingCosts }) => {
      pruneStalePendingCosts().then((count) => {
        if (count > 0) {
          logger.info({ prunedCount: count }, "scheduler startup: stale quantum cost rows pruned");
        }
      }).catch((err: unknown) => {
        logger.warn({ err }, "scheduler startup: quantum cost row prune failed");
      });
    }).catch((err: unknown) => {
      logger.warn({ err }, "scheduler startup: quantum-cost-tracker import failed");
    });
  }, 5_000);

  registerJob("quantum-cost-prune", 60 * 60 * 1000, async () => {
    const { pruneStalePendingCosts } = await import("./lib/quantum-cost-tracker.js");
    const pruned = await pruneStalePendingCosts();
    if (pruned > 0) {
      logger.info({ pruned }, "quantum-cost-prune: stale pending rows pruned");
    }
  });

  cron.schedule("5 * * * *", async () => {
    const t0qcp = Date.now();
    await withRetry("quantum-cost-prune", SCHEDULER_JOBS["quantum-cost-prune"].run, 1);
    markJobRun("quantum-cost-prune");
    emitJobComplete("quantum-cost-prune", Date.now() - t0qcp);
  });

  // ─── G3.2: Stale-pending-row sweeper — every 5 min ───────────
  // Fire-and-forget async runs (MC, SQA, QUBO, Tensor, RL, Quantum MC, DeepAR
  // train) write a pending row before the Python call and update on completion.
  // If the Node process restarts mid-run, those rows hang as status='running'
  // forever and stall consumer logic (critic-optimizer waits for completion).
  // Per-table cutoffs (P2-9):
  //   monte_carlo_runs  — 90 min (50K-path runs can spike to 30-60 min on cold start)
  //   quantum_mc_runs   — 60 min (quantum circuit + sim overhead)
  //   all others        — 30 min (current; longest legit run is DeepAR train ~10 min)
  registerJob("stale-pending-sweeper", 5 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    const {
      monteCarloRuns, sqaOptimizationRuns, quboTimingRuns,
      tensorPredictions, rlTrainingRuns, quantumMcRuns, deeparTrainingRuns,
      criticOptimizationRuns, criticCandidates,
    } = await import("./db/schema.js");
    const { lt, eq: _eq, and: _and, or: _or } = await import("drizzle-orm");

    const cutoff30 = new Date(Date.now() - 30 * 60 * 1000);
    const cutoff60 = new Date(Date.now() - 60 * 60 * 1000);
    const cutoff90 = new Date(Date.now() - 90 * 60 * 1000);

    const sweeps = [
      { name: "monte_carlo_runs", table: monteCarloRuns, cutoff: cutoff90, thresholdMin: 90 },
      { name: "sqa_optimization_runs", table: sqaOptimizationRuns, cutoff: cutoff30, thresholdMin: 30 },
      { name: "qubo_timing_runs", table: quboTimingRuns, cutoff: cutoff30, thresholdMin: 30 },
      { name: "tensor_predictions", table: tensorPredictions, cutoff: cutoff30, thresholdMin: 30 },
      { name: "rl_training_runs", table: rlTrainingRuns, cutoff: cutoff30, thresholdMin: 30 },
      { name: "quantum_mc_runs", table: quantumMcRuns, cutoff: cutoff60, thresholdMin: 60 },
      { name: "deepar_training_runs", table: deeparTrainingRuns, cutoff: cutoff30, thresholdMin: 30 },
    ];
    let totalSwept = 0;
    for (const sweep of sweeps) {
      try {
        const result = await db
          .update(sweep.table as any)
          .set({ status: "failed" })
          .where(_and(_eq((sweep.table as any).status, "running"), lt((sweep.table as any).createdAt, sweep.cutoff)));
        const swept = (result as any)?.rowCount ?? 0;
        if (swept > 0) {
          totalSwept += swept;
          logger.warn({ table: sweep.name, swept, thresholdMin: sweep.thresholdMin }, "stale-pending-sweeper: marked orphaned rows as failed");
          await db.insert(auditLog).values({
            action: "stale-pending-sweeper.swept",
            entityType: sweep.name,
            entityId: null,
            input: { cutoff: sweep.cutoff.toISOString(), threshold_min: sweep.thresholdMin },
            result: { swept },
            status: "success",
            correlationId,
          });
        }
      } catch (err) {
        logger.error({ table: sweep.name, err }, "stale-pending-sweeper: error sweeping table");
      }
    }

    // ─── Critic tables (status column uses different in-flight values) ───
    // criticOptimizationRuns: in-flight statuses are 'replaying' and 'analyzing'
    // criticCandidates: in-flight status is 'running' (replayStatus column)
    // Critic runs can take up to 30 min — use cutoff30.
    try {
      const criticRunsResult = await db
        .update(criticOptimizationRuns)
        .set({ status: "failed" })
        .where(
          _and(
            _or(
              _eq(criticOptimizationRuns.status, "replaying"),
              _eq(criticOptimizationRuns.status, "analyzing"),
              _eq(criticOptimizationRuns.status, "collecting_evidence"),
            ),
            lt(criticOptimizationRuns.createdAt, cutoff30),
          ),
        );
      const criticRunsSwept = (criticRunsResult as any)?.rowCount ?? 0;
      if (criticRunsSwept > 0) {
        totalSwept += criticRunsSwept;
        logger.warn({ table: "critic_optimization_runs", swept: criticRunsSwept }, "stale-pending-sweeper: marked orphaned rows as failed");
        await db.insert(auditLog).values({
          action: "stale-pending-sweeper.swept",
          entityType: "critic_optimization_runs",
          entityId: null,
          input: { cutoff: cutoff30.toISOString(), threshold_min: 30 },
          result: { swept: criticRunsSwept },
          status: "success",
          correlationId,
        });
      }
    } catch (err) {
      logger.error({ table: "critic_optimization_runs", err }, "stale-pending-sweeper: error sweeping table");
    }

    try {
      const criticCandResult = await db
        .update(criticCandidates)
        .set({ replayStatus: "failed" })
        .where(
          _and(
            _eq(criticCandidates.replayStatus, "running"),
            lt(criticCandidates.createdAt, cutoff30),
          ),
        );
      const criticCandSwept = (criticCandResult as any)?.rowCount ?? 0;
      if (criticCandSwept > 0) {
        totalSwept += criticCandSwept;
        logger.warn({ table: "critic_candidates", swept: criticCandSwept }, "stale-pending-sweeper: marked orphaned rows as failed");
        await db.insert(auditLog).values({
          action: "stale-pending-sweeper.swept",
          entityType: "critic_candidates",
          entityId: null,
          input: { cutoff: cutoff30.toISOString(), threshold_min: 30 },
          result: { swept: criticCandSwept },
          status: "success",
          correlationId,
        });
      }
    } catch (err) {
      logger.error({ table: "critic_candidates", err }, "stale-pending-sweeper: error sweeping table");
    }

    if (totalSwept === 0) {
      logger.debug("stale-pending-sweeper: no orphaned rows");
    }
  });

  cron.schedule("*/5 * * * *", async () => {
    if (!(await pipelineGate("stale-pending-sweeper"))) return;
    const t0sweep = Date.now();
    await withRetry("stale-pending-sweeper", SCHEDULER_JOBS["stale-pending-sweeper"].run);
    markJobRun("stale-pending-sweeper");
    emitJobComplete("stale-pending-sweeper", Date.now() - t0sweep);
  });

  // G6.4 note: contract-roll-sweep is already registered at the daily 4:30 PM
  // ET schedule below (calls runSessionEndRollSweep in paper-execution-service).
  // The audit's claim that the trigger was missing was based on a stale
  // snapshot — verified registered at the daily session-end block.

  // ─── n8n workflow sync — daily at 2:15 AM ET ─────────────────
  registerJob("n8n-workflow-sync", 24 * 60 * 60 * 1000, async () => {
    const { execSync } = await import("child_process");
    try {
      const output = execSync("npx tsx scripts/n8n-workflow-sync.ts", {
        cwd: process.cwd(),
        timeout: 60000,
        encoding: "utf-8",
        env: process.env as Record<string, string>,
      });
      logger.info({ output: output.slice(-500) }, "n8n workflow sync completed");
    } catch (err) {
      logger.error({ err }, "n8n workflow sync failed");
      throw err;
    }
  });

  // ─── System map drift check — daily at 4 AM ET ──────────────
  registerJob("system-map-drift", 24 * 60 * 60 * 1000, async () => {
    const { checkSystemMapDrift } = await import("./lib/system-topology.js");
    const drift = await checkSystemMapDrift();
    if (drift.driftItems && drift.driftItems.length > 0) {
      notifyWarning(
        "System Map Drift Detected",
        `Drift items:\n${drift.driftItems.join("\n")}`,
      );
      logger.warn({ driftItems: drift.driftItems }, "System map drift detected");
    } else {
      logger.info("System map drift check: no drift");
    }
  });

  // ─── Daily at 2:15 AM ET: n8n workflow sync (DST-aware) ──────
  // Run at 6:15 and 7:15 UTC to cover EDT (UTC-4) and EST (UTC-5).
  cron.schedule("15 6,7 * * *", async () => {
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
    if (etHour !== 2 || etMin !== 15) {
      logger.debug({ etHour, etMin }, "Scheduler: n8n sync cron fired but not 2:15 AM ET — skipping");
      return;
    }
    if (!(await pipelineGate("n8n-workflow-sync"))) return;
    logger.info("Scheduler: n8n workflow sync (2:15 AM ET)");
    const t0n8n = Date.now();
    await withRetry("n8n-workflow-sync", SCHEDULER_JOBS["n8n-workflow-sync"].run);
    markJobRun("n8n-workflow-sync");
    emitJobComplete("n8n-workflow-sync", Date.now() - t0n8n);
  });

  // Run at 8:00 and 9:00 UTC to cover EDT (UTC-4) and EST (UTC-5) for 4 AM ET.
  cron.schedule("0 8,9 * * *", async () => {
    const now = new Date();
    const etHour = Number(
      now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
    );
    if (etHour !== 4) return;
    if (!(await pipelineGate("system-map-drift"))) return;
    const t0sm = Date.now();
    await withRetry("system-map-drift", SCHEDULER_JOBS["system-map-drift"].run);
    markJobRun("system-map-drift");
    emitJobComplete("system-map-drift", Date.now() - t0sm);
  });

  // ─── Compliance rule drift check — weekly Sunday midnight ET ──
  registerJob("compliance-rule-drift", 7 * 24 * 60 * 60 * 1000, async () => {
    const { checkComplianceRuleDrift } = await import("./services/compliance-refresh-service.js");
    const result = await checkComplianceRuleDrift();
    if (result.drifted) {
      logger.warn({ details: result.details }, "Compliance rules have drifted — review required");
    }
  });

  // Run at 4:00 and 5:00 UTC on Sundays to cover EDT (UTC-4) and EST (UTC-5) for midnight ET.
  cron.schedule("0 4,5 * * 0", async () => {
    const now = new Date();
    const etStr = now.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
      weekday: "short",
    });
    if (!etStr.startsWith("Sun") || !etStr.includes("0")) return;
    if (!(await pipelineGate("compliance-rule-drift"))) return;
    logger.info("Scheduler: Compliance rule drift check (Sunday midnight ET)");
    const t0crd = Date.now();
    await withRetry("compliance-rule-drift", SCHEDULER_JOBS["compliance-rule-drift"].run);
    markJobRun("compliance-rule-drift");
    emitJobComplete("compliance-rule-drift", Date.now() - t0crd);
  });

  // ─── Disabled job probe — every 30 minutes ────────────────
  // Periodically probes disabled jobs with a test run. If a probe succeeds,
  // the job is automatically re-enabled (self-healing).
  registerJob("disabled-job-probe", 30 * 60 * 1000, async () => {
    for (const [name, health] of jobHealthTracker) {
      if (!health.disabled) continue;

      // Don't probe itself
      if (name === "disabled-job-probe") continue;

      // Don't probe if disabled less than 15 minutes ago
      if (health.disabledAt && Date.now() - health.disabledAt.getTime() < 15 * 60 * 1000) continue;

      // Find the job's run function from SCHEDULER_JOBS registry
      const job = SCHEDULER_JOBS[name];
      if (!job?.run) {
        logger.debug({ job: name }, "No run function found for disabled job — cannot probe");
        continue;
      }

      logger.info({ job: name }, "Probing disabled job with test run");
      try {
        await job.run();
        // Success! Re-enable
        health.disabled = false;
        health.disabledAt = null;
        health.disableReason = null;
        health.consecutiveFailures = 0;

        try {
          const { notifyInfo } = await import("./services/notification-service.js");
          if (typeof notifyInfo === "function") {
            notifyInfo(`Scheduler: ${name} auto-recovered`, `Job "${name}" passed probe test and has been re-enabled.`);
          }
        } catch { /* notification failure is non-blocking */ }
        logger.info({ job: name }, "Disabled job passed probe — re-enabled");
      } catch {
        logger.debug({ job: name }, "Disabled job probe still failing — staying disabled");
      }
    }
  });

  cron.schedule("*/30 * * * *", async () => {
    const t0probe = Date.now();
    await withRetry("disabled-job-probe", SCHEDULER_JOBS["disabled-job-probe"].run, 1);
    markJobRun("disabled-job-probe");
    emitJobComplete("disabled-job-probe", Date.now() - t0probe);
  });

  // ─── Subsystem metrics collection — every 30 minutes ──────
  registerJob("metrics-collector", 30 * 60 * 1000, async () => {
    const { collectAllMetrics } = await import("./services/subsystem-metrics-service.js");
    await collectAllMetrics();
  });

  cron.schedule("*/30 * * * *", async () => {
    const t0metrics = Date.now();
    await withRetry("metrics-collector", SCHEDULER_JOBS["metrics-collector"].run);
    markJobRun("metrics-collector");
    emitJobComplete("metrics-collector", Date.now() - t0metrics);
  });

  // ─── Scout funnel snapshot — daily at 1 AM ET ────────────────
  registerJob("funnel-snapshot", 24 * 60 * 60 * 1000, async () => {
    const { recordFunnelSnapshot } = await import("./services/funnel-metrics-service.js");
    await recordFunnelSnapshot();
  });

  cron.schedule("0 1 * * *", async () => {
    if (!(await pipelineGate("funnel-snapshot"))) return;
    const t0funnel = Date.now();
    await withRetry("funnel-snapshot", SCHEDULER_JOBS["funnel-snapshot"].run);
    markJobRun("funnel-snapshot");
    emitJobComplete("funnel-snapshot", Date.now() - t0funnel);
  });

  // ─── n8n health check — every 15 minutes ─────────────────────
  registerJob("n8n-health-check", 15 * 60 * 1000, async () => {
    const { n8nExecutionLog } = await import("./db/schema.js");
    const { gte: gteOp, sql: sqlOp } = await import("drizzle-orm");
    const since = new Date(Date.now() - 60 * 60 * 1000); // last hour

    const stats = await db.select({
      workflowName: n8nExecutionLog.workflowName,
      total: sqlOp<number>`count(*)::int`,
      failures: sqlOp<number>`count(*) filter (where ${n8nExecutionLog.status} IN ('failed', 'error'))::int`,
    }).from(n8nExecutionLog)
      .where(gteOp(n8nExecutionLog.createdAt, since))
      .groupBy(n8nExecutionLog.workflowName);

    const failing = stats.filter((s) => s.failures > 0);
    if (failing.length > 0) {
      broadcastSSE("n8n:health-alert", { failing });
      logger.warn({ failing }, "n8n health check: workflows with recent failures");
    } else {
      logger.debug({ workflowCount: stats.length }, "n8n health check: all workflows healthy");
    }
  });

  cron.schedule("*/15 * * * *", async () => {
    const t0n8nHealth = Date.now();
    await withRetry("n8n-health-check", SCHEDULER_JOBS["n8n-health-check"].run, 1);
    markJobRun("n8n-health-check");
    emitJobComplete("n8n-health-check", Date.now() - t0n8nHealth);
  });

  // ─── Resource utilization snapshot — every 5 minutes ──────
  registerJob("resource-snapshot", 5 * 60 * 1000, async () => {
    const { collectResourceMetrics } = await import("./services/resource-tracker.js");
    await collectResourceMetrics();
  });

  cron.schedule("*/5 * * * *", async () => {
    const t0res = Date.now();
    await withRetry("resource-snapshot", SCHEDULER_JOBS["resource-snapshot"].run);
    markJobRun("resource-snapshot");
    emitJobComplete("resource-snapshot", Date.now() - t0res);
  });

  // ─── Session analytics nightly rollup — 11:45 PM ET daily ──
  registerJob("session-analytics-rollup", 24 * 60 * 60 * 1000, async () => {
    const { recordSessionAnalyticsRollup } = await import("./services/session-analytics-service.js");
    await recordSessionAnalyticsRollup();
  });

  cron.schedule("45 3 * * *", async () => { // 3:45 AM UTC = 11:45 PM ET
    const t0sa = Date.now();
    await withRetry("session-analytics-rollup", SCHEDULER_JOBS["session-analytics-rollup"].run);
    markJobRun("session-analytics-rollup");
    emitJobComplete("session-analytics-rollup", Date.now() - t0sa);
  });

  // ─── Weekly Sunday 9 PM ET: Graveyard failure pattern extraction ─
  // Run at 1:00 and 2:00 UTC on Mondays to cover EDT (UTC-4) and EST (UTC-5) for Sun 9 PM ET.
  registerJob("graveyard-pattern-extraction", 7 * 24 * 60 * 60 * 1000, async () => {
    const { extractFailurePatterns } = await import("./services/graveyard-intelligence-service.js");
    const result = await extractFailurePatterns();
    if (result.clusterCount > 0) {
      logger.info(result, "Graveyard failure patterns updated");
    }
  });

  cron.schedule("0 1,2 * * 1", async () => {
    const now = new Date();
    const etStr = now.toLocaleString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "numeric",
      hour12: false,
    });
    // Only fire on Sunday 21:00 ET (which is Mon 01:00 or 02:00 UTC)
    if (!etStr.includes("Sun") || !etStr.includes("21")) return;

    if (!(await pipelineGate("graveyard-pattern-extraction"))) return;
    const t0gpe = Date.now();
    await withRetry("graveyard-pattern-extraction", SCHEDULER_JOBS["graveyard-pattern-extraction"].run);
    markJobRun("graveyard-pattern-extraction");
    emitJobComplete("graveyard-pattern-extraction", Date.now() - t0gpe);
  });

  // ─── Critic feedback — weekly Sunday 1 AM ET ──────────────────
  registerJob("critic-feedback", 7 * 24 * 60 * 60 * 1000, async () => {
    const { evaluateCriticAccuracy } = await import("./services/critic-feedback-service.js");
    await evaluateCriticAccuracy();
  });

  // Run at 5:00 and 6:00 UTC on Sundays to cover EDT (UTC-4) and EST (UTC-5) for 1 AM ET.
  cron.schedule("0 5,6 * * 0", async () => {
    const now = new Date();
    const etHour = Number(
      now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
    );
    if (etHour !== 1) return;
    if (!(await pipelineGate("critic-feedback"))) return;
    logger.info("Scheduler: Critic feedback evaluation (Sunday 1 AM ET)");
    const t0cf = Date.now();
    await withRetry("critic-feedback", SCHEDULER_JOBS["critic-feedback"].run);
    markJobRun("critic-feedback");
    emitJobComplete("critic-feedback", Date.now() - t0cf);
  });

  // ─── Prompt A/B test resolution — weekly Sunday 11 PM ET ──
  registerJob("prompt-ab-resolution", 7 * 24 * 60 * 60 * 1000, async () => {
    const { resolveAbTests } = await import("./services/prompt-evolution-service.js");
    await resolveAbTests();
  });

  cron.schedule("0 23 * * 0", async () => {
    if (!(await pipelineGate("prompt-ab-resolution"))) return;
    const t0pab = Date.now();
    await withRetry("prompt-ab-resolution", SCHEDULER_JOBS["prompt-ab-resolution"].run);
    markJobRun("prompt-ab-resolution");
    emitJobComplete("prompt-ab-resolution", Date.now() - t0pab);
  });

  // ─── Wave D3: Contract roll sweep — 4:30 PM ET weekdays ──────
  // Runs at both 20:30 and 21:30 UTC to cover EDT (UTC-4) and EST (UTC-5).
  // DST-aware: only fires when ET clock resolves to 16:30.
  //
  // Override: this job bypasses pipelineGate — contract expiry is a safety
  // operation and must run regardless of pipeline pause/vacation state.
  // "kill a position before the contract expires" is not a trading decision.
  registerJob("contract-roll-sweep", 24 * 60 * 60 * 1000, async () => {
    const { runSessionEndRollSweep } = await import("./services/paper-execution-service.js");
    const result = await runSessionEndRollSweep();
    logger.info(result, "Contract roll sweep complete");
  });

  cron.schedule("30 20,21 * * 1-5", async () => {
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
    // Only fire at exactly 4:30 PM ET (16:30)
    if (etHour !== 16 || etMin !== 30) {
      logger.debug({ etHour, etMin }, "Scheduler: contract-roll-sweep cron fired but not 4:30 PM ET — skipping");
      return;
    }
    // NOTE: no pipelineGate check here — roll handler is a safety operation,
    // not a trading operation. It must run even when paused/vacation.
    logger.info("Scheduler: Contract roll sweep (4:30 PM ET)");
    const t0roll = Date.now();
    await withRetry("contract-roll-sweep", SCHEDULER_JOBS["contract-roll-sweep"].run);
    markJobRun("contract-roll-sweep");
    emitJobComplete("contract-roll-sweep", Date.now() - t0roll);
  });

  // ─── Tournament staleness alarm — every 6 hours ──────────────
  // The 4-role tournament (Proposer → Critic → Prosecutor → Promoter) lives in
  // n8n. If n8n is down, no tournament_results rows are written and the in-process
  // Node loop bypasses the tournament gate (CLAUDE.md acknowledges). This job
  // detects the silent failure mode by alarming when the latest tournament_results
  // row is older than the staleness threshold.
  registerJob("tournament-staleness-check", 6 * 60 * 60 * 1000, async () => {
    await checkTournamentStaleness();
  });

  cron.schedule("0 */6 * * *", async () => {
    const t0tourn = Date.now();
    await withRetry("tournament-staleness-check", SCHEDULER_JOBS["tournament-staleness-check"].run, 1);
    markJobRun("tournament-staleness-check");
    emitJobComplete("tournament-staleness-check", Date.now() - t0tourn);
  });

  logger.info("Scheduler initialized: rolling Sharpe (4h), pre-market prep (6:00 AM ET weekdays), paper-vs-backtest (1h), lifecycle (6h), decay monitor (2:00 AM ET daily), stale-session-check (5m), metrics-heartbeat (60s), pipeline-resume-drain (30s), deepar-train (2:30 AM ET), deepar-predict (6:00 AM ET), deepar-validate (6:30 AM ET), regret-score-fill (11:00 PM ET), agent-health-sweep (2h), portfolio-correlation (daily), meta-parameter-review (monthly), anti-setup-mine (Mon 12AM ET), anti-setup-effectiveness (Mon 12AM ET), dlq-retry (15m), dlq-escalation (1h), idempotency-cleanup (3 AM ET daily), n8n-workflow-sync (2:15 AM ET daily), system-map-drift (4 AM ET daily), compliance-rule-drift (Sun midnight ET weekly), disabled-job-probe (30m), metrics-collector (30m), funnel-snapshot (1 AM ET daily), n8n-health-check (15m), resource-snapshot (5m), session-analytics-rollup (11:45 PM ET daily), graveyard-pattern-extraction (Sun 9 PM ET weekly), critic-feedback (Sun 1 AM ET weekly), prompt-ab-resolution (Sun 11 PM ET weekly), contract-roll-sweep (4:30 PM ET weekdays — bypasses pipeline gate), tournament-staleness-check (6h)");

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
 * Tournament staleness check — alarm if n8n tournament workflow stops writing.
 *
 * The 4-role tournament gate (Proposer → Critic → Prosecutor → Promoter) lives
 * in n8n workflows, NOT in the in-process Node loop. CLAUDE.md acknowledges
 * that direct invocations of POST /api/agent/run-strategy bypass the tournament
 * gate. If n8n stops writing tournament_results, the silent-failure mode is
 * "strategies still backtest, but no adversarial filter ran."
 *
 * This job runs every 6 hours and emits an SSE alarm + audit log entry when
 * the latest tournament_results row is older than 24 hours (or the table is
 * empty entirely). Empty table is treated as Infinity age — alarms.
 */
async function checkTournamentStaleness(): Promise<void> {
  const correlationId = randomUUID();
  try {
    const [latest] = await db
      .select({ createdAt: tournamentResults.createdAt })
      .from(tournamentResults)
      .orderBy(desc(tournamentResults.createdAt))
      .limit(1);

    const ageHours = latest
      ? (Date.now() - latest.createdAt.getTime()) / (1000 * 60 * 60)
      : Infinity;

    const STALE_THRESHOLD_HOURS = 24;
    if (ageHours > STALE_THRESHOLD_HOURS) {
      logger.warn(
        { correlationId, ageHours, latest: latest?.createdAt ?? null },
        "tournament_results stale — n8n tournament workflow may be down",
      );

      broadcastSSE("n8n:tournament-stale", {
        ageHours: Number.isFinite(ageHours) ? Math.round(ageHours * 10) / 10 : null,
        latestResultAt: latest?.createdAt ?? null,
        threshold: STALE_THRESHOLD_HOURS,
      });

      await db.insert(auditLog).values({
        action: "tournament.staleness-alarm",
        entityType: "system",
        status: "success",
        decisionAuthority: "scheduler",
        result: {
          ageHours: Number.isFinite(ageHours) ? ageHours : null,
          threshold: STALE_THRESHOLD_HOURS,
          latestResultAt: latest?.createdAt?.toISOString() ?? null,
        },
        correlationId,
      });
    } else {
      logger.debug(
        { correlationId, ageHours, threshold: STALE_THRESHOLD_HOURS },
        "tournament_results fresh — no alarm",
      );
    }
  } catch (err) {
    logger.error({ err, correlationId }, "tournament staleness check failed");
  }
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

      // P0-4: Restore governor state from DB so the state machine survives restart.
      // If governor_state is null (new sessions, pre-migration rows), governor starts
      // at "normal" — the safe default (same as a fresh session).
      if (session.governorState) {
        const restoredState = restoreGovernorState(session.id, session.governorState as Record<string, unknown>);
        if (restoredState) {
          logger.info(
            { sessionId: session.id, governorState: restoredState },
            "P0-4: Restored governor state from DB",
          );
        }
      } else {
        logger.debug({ sessionId: session.id }, "P0-4: No persisted governor state — starting at normal");
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
  // P1-4: Include DEPLOY_READY so promotion-gate inputs stay current.
  // Excludes CANDIDATE/TESTING/DECLINING/RETIRED/GRAVEYARD — those states
  // have no active paper sessions and should never be re-promoted from a
  // stale 30-day window.
  const activeStrategies = await db
    .select({ id: strategies.id, name: strategies.name, lifecycleState: strategies.lifecycleState })
    .from(strategies)
    .where(
      inArray(strategies.lifecycleState, ["PAPER", "DEPLOY_READY", "DEPLOYED"]),
    );

  if (activeStrategies.length === 0) {
    logger.info("No active PAPER/DEPLOYED strategies for Sharpe update");
    return;
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const results: { strategyId: string; name: string; sharpe: number; drifted: boolean }[] = [];

  for (const strat of activeStrategies) {
    try {
      // P1-4: Fetch paper trades from the last 30 calendar days across active,
      // paused, and stopped sessions for this strategy. A paused session's Sharpe
      // is correctly anchored to its actual trading days because we filter by
      // exitTime >= thirtyDaysAgo on the trades table — not by session status.
      // This ensures promotion-gate inputs are not frozen for paused sessions.
      const activeSessions = await db
        .select({ id: paperSessions.id })
        .from(paperSessions)
        .where(
          and(
            eq(paperSessions.strategyId, strat.id),
            inArray(paperSessions.status, ["active", "paused", "stopped"]),
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
      // C6: Switch from half_life-only to decay_gate, which runs all 6 sub-signals:
      // sharpe_decay, mfe_decay, slippage_growth, win_size_decay, regime_mismatch, fill_rate_decay.
      // Previous behavior: only rolling Sharpe (half_life module) was evaluated.
      // New behavior: composite_decay_score from all 6 sub-signals drives quarantine level,
      // then unified verdict (pass/warn/fail) from decay_gate is used for demotion decisions.
      // Auto-quarantine thresholds from decay_gate:
      //   LEVEL_1 watch: any 1 signal at WARNING (composite_score >= 20)
      //   LEVEL_2 reduce: any 2 WARNING or 1 CRITICAL → reduce position 50% (composite >= 40)
      //   LEVEL_3 quarantine: any 2 CRITICAL → pause strategy (composite >= 70)
      //   LEVEL_4 retire: quarantined 30+ days → RETIRED (handled by quarantine.py)
      const decayResult = await runPythonModule<{
        verdict?: string;        // "pass" | "warn" | "fail"
        reason?: string;
        composite_score?: number;
        size_multiplier?: number;
        half_life?: { decay_detected?: boolean; trend?: string; half_life_days?: number };
        quarantine?: { new_level?: string; days_at_level?: number };
        sub_signals?: Record<string, { signal: string; score: number; detail: string }>;
        error?: string;
      }>({
        module: "src.engine.decay.decay_gate",
        config: { action: "analyze", strategy_id: strat.id },
        componentName: "decay-daily-monitor",
        timeoutMs: 30_000,
      });

      if (decayResult.error) {
        logger.warn({ strategyId: strat.id, name: strat.name, decayError: decayResult.error }, "Decay monitor: Python analysis returned error");
        errors.push(strat.id);
        continue;
      }

      // composite_score from all 6 sub-signals (was decay_score from half_life only)
      const decayScore = Number(decayResult.composite_score ?? 0);

      logger.info(
        {
          strategyId: strat.id,
          name: strat.name,
          lifecycleState: strat.lifecycleState,
          decayScore,
          verdict: decayResult.verdict,
          // half_life fields are nested under decayResult.half_life (decay_gate output structure)
          decaying: decayResult.half_life?.decay_detected,
          trend: decayResult.half_life?.trend,
          halfLifeDays: decayResult.half_life?.half_life_days,
          quarantineLevel: decayResult.quarantine?.new_level,
          sizeMultiplier: decayResult.size_multiplier,
        },
        "Decay monitor: analysis complete",
      );

      if (decayScore > DECAY_DEMOTION_THRESHOLD) {
        elevated.push(strat.id);

        // C6: All 3 active states now have valid DECLINING transitions (per VALID_TRANSITIONS in
        // lifecycle-service.ts: TESTING: ["PAPER","DECLINING","GRAVEYARD"],
        // PAPER: ["DEPLOY_READY","DECLINING","GRAVEYARD"]).
        // Previous behavior: PAPER → null and TESTING → null meant decay never demoted
        // pre-deploy strategies, making the half-life detector a no-op for most of the pipeline.
        // New behavior: decay can demote PAPER and TESTING strategies to DECLINING when decay
        // score exceeds threshold. This makes the decay monitor functional across all active states.
        const currentState = strat.lifecycleState as "TESTING" | "PAPER" | "DEPLOYED";
        const demotionMap: Record<string, "DECLINING" | null> = {
          DEPLOYED: "DECLINING",
          PAPER: "DECLINING",    // PAPER → DECLINING is valid per VALID_TRANSITIONS
          TESTING: "DECLINING",  // TESTING → DECLINING is valid per VALID_TRANSITIONS
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
  correlationId?: string,
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
    correlationId: correlationId ?? null,
  });

  await computeAndPersistSessionFeedback(sessionId);
  broadcastSSE("paper:session-feedback-computed", { sessionId, reason, source: "scheduler" });

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
  const correlationId = randomUUID();
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
      // ─── Auto-recovery: detect crashed WebSocket streams ─────
      // If the session is registered in-memory but the socket is disconnected,
      // attempt to reconnect before falling through to the stale-time checks.
      const streamHealth = getStreamHealth(session.id);
      const sessionAgeMs = Date.now() - session.startedAt.getTime();

      if (
        isStreaming(session.id) &&
        !streamHealth.connected &&
        sessionAgeMs > 10 * 60 * 1000 // avoid false positives during startup
      ) {
        const attempts = recoveryAttempts.get(session.id) ?? 0;

        if (attempts >= MAX_RECOVERY_ATTEMPTS) {
          // ─── Recovery exhausted: auto-stop ───────────────────
          logger.error(
            { sessionId: session.id, strategyId: session.strategyId, attempts },
            "Paper session auto-recovery exhausted — stopping session",
          );

          try {
            const stopped = await stopPaperSession(session.id, "recovery_failed", correlationId);
            if (stopped) {
              broadcastSSE("paper:auto_stopped", {
                sessionId: session.id,
                strategyId: session.strategyId,
                reason: "recovery_failed",
                attempts,
              });
            }
          } catch (stopErr) {
            logger.error({ sessionId: session.id, err: stopErr }, "Failed to auto-stop after recovery exhaustion");
          }

          notifyCritical(
            "Paper Session Recovery Failed",
            `Session ${session.id.slice(0, 8)} failed to recover after ${MAX_RECOVERY_ATTEMPTS} attempts and was auto-stopped.`,
            { sessionId: session.id, strategyId: session.strategyId },
          );

          await db.insert(auditLog).values({
            action: "paper_session.recovery_failed",
            entityType: "paper_session",
            entityId: session.id,
            status: "failure",
            decisionAuthority: "scheduler",
            result: { strategyId: session.strategyId, attempts },
            correlationId,
          });

          recoveryAttempts.delete(session.id);
          continue; // session is stopped, skip stale checks
        }

        // ─── Attempt recovery ──────────────────────────────────
        const attempt = attempts + 1;
        recoveryAttempts.set(session.id, attempt);

        logger.warn(
          { sessionId: session.id, strategyId: session.strategyId, attempt, maxAttempts: MAX_RECOVERY_ATTEMPTS },
          "Paper session stream disconnected — attempting auto-recovery",
        );

        try {
          // Clean up dead WebSocket
          stopStream(session.id);

          // Resolve symbol list from strategy (same pattern as resumeActivePaperSessions)
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
            logger.warn({ sessionId: session.id }, "Cannot auto-recover paper session — no symbol found");
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
          }

          await db.insert(auditLog).values({
            action: "paper_session.auto_recovered",
            entityType: "paper_session",
            entityId: session.id,
            status: "success",
            decisionAuthority: "scheduler",
            result: { strategyId: session.strategyId, attempt, symbols },
            correlationId,
          });

          broadcastSSE("paper:auto_recovered", {
            sessionId: session.id,
            strategyId: session.strategyId,
            attempt,
            symbols,
          });

          logger.info(
            { sessionId: session.id, strategyId: session.strategyId, attempt, symbols },
            "Paper session auto-recovered — stream reconnected",
          );
        } catch (recoverErr) {
          logger.error(
            { sessionId: session.id, attempt, err: recoverErr },
            "Paper session auto-recovery attempt failed",
          );
        }

        continue; // skip stale checks this cycle — let recovery settle
      }

      // ─── Clear recovery counter on healthy stream ────────────
      if (isStreaming(session.id) && streamHealth.connected && recoveryAttempts.has(session.id)) {
        logger.info(
          { sessionId: session.id, previousAttempts: recoveryAttempts.get(session.id) },
          "Paper session stream healthy — clearing recovery counter",
        );
        recoveryAttempts.delete(session.id);
      }

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
          const stopped = await stopPaperSession(session.id, "stale_2h", correlationId);
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
  const correlationId = randomUUID();
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
    correlationId,
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

// ─────────────────────────────────────────────────────────────────────────────
// C2 — Day archetype daily classifier
// ─────────────────────────────────────────────────────────────────────────────

/** Symbols Trading Forge classifies daily.
 *
 *  MES, MNQ, MCL are the three canonical micro-futures symbols tracked across
 *  the prop-sim, portfolio optimizer, and skip engine.  NQ was the original
 *  narrow list; these are added here so day_archetypes is populated for all
 *  instruments.  The predictor returns RANGE_DAY + uniform probabilities when
 *  historical labels are sparse — safe fail-soft until backfill catches up.
 *
 *  TODO: extend to MGC/M2K once S3 historical_labeler has indexed 60+ days.
 */
const ARCHETYPE_DAILY_SYMBOLS = ["MES", "MNQ", "MCL"];

/**
 * Daily archetype classifier (6 AM ET).  For each symbol:
 *   1. Pull historical (features, actual_archetype) pairs from day_archetypes
 *   2. Spawn Python `archetypes.predictor` with action=predict
 *   3. Persist the predicted archetype + features to day_archetypes
 *
 * This cron fills the *predicted* side of today's row.  After market close,
 * a separate (existing) workflow runs the rule-based classifier on actual
 * OHLCV to overwrite the `archetype` column and compute prediction_correct.
 *
 * Fail-soft: if no historical labels exist the predictor returns RANGE_DAY
 * with uniform probabilities — we still persist that row so the eligibility
 * matrix stays stable until backfill catches up.
 */
async function runArchetypeDailyClassify(): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const symbol of ARCHETYPE_DAILY_SYMBOLS) {
    try {
      // Idempotency: skip if today's row already has a prediction
      const [existing] = await db
        .select({ id: dayArchetypes.id, predicted: dayArchetypes.predictedArchetype })
        .from(dayArchetypes)
        .where(
          and(
            eq(dayArchetypes.symbol, symbol),
            gte(dayArchetypes.tradingDate, today),
          ),
        )
        .limit(1);

      if (existing?.predicted) {
        logger.info({ symbol, predicted: existing.predicted }, "Archetype already predicted for today — skipping");
        continue;
      }

      // Pull last 60 days of labeled history for KNN (predictor handles empty)
      const sixtyDaysAgo = new Date(today);
      sixtyDaysAgo.setDate(today.getDate() - 60);
      const historyRows = await db
        .select({
          features: dayArchetypes.features,
          archetype: dayArchetypes.archetype,
          tradingDate: dayArchetypes.tradingDate,
        })
        .from(dayArchetypes)
        .where(
          and(
            eq(dayArchetypes.symbol, symbol),
            gte(dayArchetypes.tradingDate, sixtyDaysAgo),
            lte(dayArchetypes.tradingDate, today),
          ),
        )
        .orderBy(desc(dayArchetypes.tradingDate));

      const historicalFeatures = historyRows
        .filter((r) => r.features && r.archetype && r.archetype !== "PENDING")
        .map((r) => ({
          features: r.features as Record<string, number>,
          actual_archetype: r.archetype,
          date: r.tradingDate.toISOString().slice(0, 10),
        }));

      // Premarket features are intentionally empty until the data plumbing
      // is wired (S3/DuckDB premarket bars).  The predictor returns
      // RANGE_DAY+uniform when both inputs are sparse — documented fallback.
      const todayFeatures: Record<string, number> = {};

      const result = await runPythonModule<{
        predicted: string;
        probabilities: Record<string, number>;
        confidence: number;
        nearest_dates: string[];
      }>({
        module: "src.engine.archetypes.predictor",
        config: {
          action: "predict",
          features: todayFeatures,
          historical_features: historicalFeatures,
          k: 7,
        },
        timeoutMs: 30_000,
        componentName: "archetype-daily-classify",
      });

      // Upsert today's row — predicted side filled, actual side stays
      // PENDING until post-close classifier runs.
      if (existing?.id) {
        await db
          .update(dayArchetypes)
          .set({
            predictedArchetype: result.predicted,
            confidence: String(result.confidence),
            features: todayFeatures,
            metrics: { probabilities: result.probabilities, nearest_dates: result.nearest_dates },
          })
          .where(eq(dayArchetypes.id, existing.id));
      } else {
        await db.insert(dayArchetypes).values({
          symbol,
          tradingDate: today,
          archetype: "PENDING",
          predictedArchetype: result.predicted,
          confidence: String(result.confidence),
          features: todayFeatures,
          metrics: { probabilities: result.probabilities, nearest_dates: result.nearest_dates },
        });
      }

      broadcastSSE("archetype:predicted", {
        symbol,
        date: today.toISOString().slice(0, 10),
        predicted: result.predicted,
        confidence: result.confidence,
      });

      logger.info(
        { symbol, predicted: result.predicted, confidence: result.confidence, historyCount: historicalFeatures.length },
        "Archetype daily classify: prediction persisted",
      );
    } catch (err) {
      logger.error({ err, symbol }, "Archetype daily classify failed for symbol (non-blocking)");
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Loop 1 — Macro regime daily sync
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Daily macro regime sync (5 AM ET).  Pulls FRED/BLS/EIA snapshot,
 * classifies macro_regime via macro_tagger, writes a row to macroSnapshots.
 *
 * Downstream consumers:
 *   - bias_engine.compute_bias() reads regime from macroSnapshots.macroRegime
 *   - skip_classifier scores regime_alignment from latest snapshot
 *   - strategy eligibility matrix tags regime per strategy preferred_regime
 *   - regime_graph (composite tech+macro) consumes the macro side
 *
 * Failures are non-blocking — bias engine falls back to "TRANSITION" if
 * no fresh snapshot exists.
 */
async function runMacroDailySync(): Promise<void> {
  try {
    const result = await runPythonModule({
      scriptCode: `
import json, sys, os
sys.path.insert(0, '.')

results = {"status": "partial", "sources": {}}

# FRED
try:
    from src.data.macro.fred_client import get_latest_values
    fred_data = get_latest_values()
    results["sources"]["fred"] = {"status": "ok", "series_count": len([v for v in fred_data.values() if v is not None])}
    results["fred_data"] = fred_data
except Exception as e:
    results["sources"]["fred"] = {"status": "error", "error": str(e)}
    results["fred_data"] = {}

# Macro regime classification
try:
    from src.data.macro.macro_tagger import classify_macro_regime
    snapshot = results.get("fred_data", {})
    regime = classify_macro_regime(snapshot)
    results["regime"] = regime
except Exception as e:
    results["regime"] = {"regime": "TRANSITION", "confidence": 0, "error": str(e)}

results["status"] = "ok"
print(json.dumps(results))
`,
      componentName: "macro-data-sync",
      timeoutMs: 120_000,
    });

    const fredData = (result as Record<string, unknown>).fred_data as Record<string, number | null> ?? {};
    const regime = (result as Record<string, unknown>).regime as Record<string, unknown> ?? {};
    const regimeName = (regime.regime as string) ?? "TRANSITION";
    const confidence = (regime.confidence as number) ?? 0;
    const todayStr = new Date().toISOString().slice(0, 10);
    const today = new Date(todayStr + "T00:00:00Z");

    await db.insert(macroSnapshots).values({
      snapshotDate: today,
      fedFundsRate: fredData.fed_funds_rate?.toString() ?? null,
      treasury10y: fredData.treasury_10y?.toString() ?? null,
      treasury2y: fredData.treasury_2y?.toString() ?? null,
      treasury3m: fredData.treasury_3m?.toString() ?? null,
      vix: fredData.vix?.toString() ?? null,
      yieldSpread10y2y: fredData.yield_spread_10y2y?.toString() ?? null,
      unemployment: fredData.unemployment?.toString() ?? null,
      cpiYoy: fredData.cpi_yoy?.toString() ?? null,
      pceYoy: fredData.pce_yoy?.toString() ?? null,
      wtiCrude: fredData.wti_crude?.toString() ?? null,
      naturalGas: fredData.natural_gas?.toString() ?? null,
      macroRegime: regimeName,
      regimeConfidence: confidence.toString(),
      rawData: result as Record<string, unknown>,
    }).onConflictDoNothing();

    broadcastSSE("macro:regime-updated", {
      date: todayStr,
      regime: regimeName,
      confidence,
    });

    logger.info({ regime: regimeName, confidence }, "Macro regime daily sync complete");
  } catch (err) {
    logger.error({ err }, "Macro regime daily sync failed (non-blocking)");
  }
}
