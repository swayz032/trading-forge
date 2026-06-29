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
// Fix 1 (2026-06-29): non-blocking subprocess for n8n-workflow-sync.
// execSync freezes V8's event loop for up to 60s — no HTTP/WS/SSE/cron/DLL
// signals are processed during that window. execFileAsync is non-blocking.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
import { cronJobsConcurrent } from "./lib/metrics-registry.js";
import { eq, and, gte, lte, desc, inArray, isNull, isNotNull, min, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import { strategies, paperSessions, paperPositions, paperTrades, paperSignalLogs, backtests, agentJobs, systemJournal, skipDecisions, auditLog, dayArchetypes, tournamentResults, macroSnapshots, macroFeatures, macroRegimeStates, lifecycleTransitions, harshRegimePhase, strategyExports, strategyExportArtifacts } from "./db/schema.js";
import { broadcastSSE } from "./routes/sse.js";
import { logger } from "./lib/logger.js";
import { LifecycleService } from "./services/lifecycle-service.js";
import { AlertFactory } from "./services/alert-service.js";
import { runPythonModule } from "./lib/python-runner.js";
import { startStream, stopStream, isStreaming, getActiveStreams, getStreamHealth, getBarBuffer } from "./services/paper-trading-stream.js";
import { restorePositionState, cleanupSession, restoreGovernorState } from "./services/paper-signal-service.js";
import { trainDeepAR, predictRegime, validatePastForecasts, isDeepARDeferred } from "./services/deepar-service.js";
import { setRegimeWeights } from "./services/regime-state-service.js";
import { runAgentHealthSweep } from "./services/agent-audit-service.js";
import { runPortfolioCorrelationCheck } from "./services/portfolio-optimizer-service.js";
import { runMetaParameterReview } from "./services/meta-optimizer-service.js";
import { notifyWarning, notifyCritical } from "./services/notification-service.js";
import { appendFamilyGradePostscript } from "./lib/notification-helpers.js";
import { insertAuditRow, insertAuditRowSafe } from "./lib/audit-log-helper.js";
import { runAntiSetupEffectivenessAnalysis } from "./services/anti-setup-effectiveness-service.js";
import { invalidateAntiSetupCache } from "./services/anti-setup-gate-service.js";
import { isActive as isPipelineActive, getMode as getPipelineMode } from "./services/pipeline-control-service.js";
import { computeAndPersistSessionFeedback } from "./services/paper-session-feedback-service.js";
import { runMonthlyRealityCheckReport } from "./services/validation-cadence-service.js";
import { registerRetryHandler } from "./lib/dlq-service.js";
// C11: Macro regime overlay ingestion + classification
import {
  runFredDailyIngestion,
  runH41Ingestion,
  runBlsIngestion,
  runTreasuryAuctionIngestion,
  runMacroRegimeClassification,
  invalidateMacroRegimeCache,
} from "./services/macro-regime-service.js";
// W19: Databento expanded schema — Definition, Statistics, Imbalance
import { runDefinitionPull } from "./services/contract-specs-service.js";
import { runStatisticsPull, runSettlementReconciliation } from "./services/settlement-reconciliation-service.js";
import { runAuctionImbalancePull } from "./services/opening-auction-service.js";
// W23D / Wave 23 Gap-Fix-B: bias engine + harsh-regime phase activation
import { computeBiasForAllSymbols } from "./services/bias-state-service.js";
import { getPhase, flipPhaseToHard } from "./services/harsh-regime-phase-service.js";
// Pass 6 / Track C F-6: n8n execution telemetry scraper (observability — never gated)
import { runN8nExecutionScrape } from "./services/n8n-execution-scraper-service.js";
// W26 Pass 6: Topstep consistency concentration tracker daily digest
import { runConsistencyDailyDigest } from "./services/consistency-tracker-service.js";
// W27 Pass 1.5 A2: Weekly quantum replay analysis + Discord verdict emitter
import { runQuantumReplayWeeklyAnalysis } from "./services/quantum-replay-weekly-service.js";
// W28 Pass A.4: Composite health daily digest — 5:00 PM ET daily
import { runCompositeHealthDailyDigest } from "./services/composite-health-digest-service.js";
// W26 Pass G Pass D: Strategy stale detector — 04:00 ET daily
import { runStrategyStaleDetector } from "./services/strategy-stale-detector.js";
// W29 Pass C.2: Quantum RL training window cron
import { isOffRthTrainingWindow } from "./lib/quantum-rl-training-runner.js";
// W29 Pass B.3: Regime drift detector — daily 18:00 ET sweep
import { runRegimeDriftDetector } from "./services/regime-drift-detector-service.js";
// W29 Pass D.3: A/B comparison weekly digest — Friday 17:00 ET
import { runAbComparisonWeeklyDigest } from "./services/ab-comparison-weekly-digest-service.js";
// W0.1: Nightly off-tower database backup (hardware-failure safety net)
import { runDbBackup } from "./services/db-backup-service.js";
// Pass 1 Track D: Discord fanout audit — keeps _webhookHealth in sync every 30 min
import { runDiscordFanoutAudit } from "./services/discord-fanout-audit-service.js";
// A14 regime-bank population — fills synthetic_regime_bank so black-swan evaluator
// returns real survival rates instead of null (CHALLENGER-ONLY / ADVISORY).
import { runSyntheticRegimeBankPopulate } from "./services/synthetic-regime-bank-service.js";

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

/**
 * Jobs that must never be auto-disabled (critical infrastructure).
 *
 * Wave hardening 2026-06-22, autonomous-readiness A-6:
 * Credential-safety and dead-man jobs are now included so a transient vendor
 * outage (e.g. Bitwarden 12h maintenance → 5 failures over 30h) cannot
 * silently disable them and leave the vault session expired during vacation.
 * The CRITICAL alert still fires at 5 failures — disabling is suppressed only.
 */
const NEVER_DISABLE_JOBS = new Set([
  // Original dead-man / monitoring infrastructure
  "metrics-heartbeat",
  "stale-session-check",
  "disabled-job-probe",
  // Heartbeat safety jobs — must fire even if other subsystems are broken
  "heartbeat-write",
  "heartbeat-stale-check",
  // Credential-safety jobs — transient vendor outage must not permanently disable these
  "bw-session-refresh",
  "prop-firm-cookie-refresh",
]);

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
      appendFamilyGradePostscript(
        `Job "${name}" has failed ${health.consecutiveFailures} times in a row. Last error: ${error instanceof Error ? error.message : String(error)}`,
        `A background maintenance job (${name}) has failed ${health.consecutiveFailures} times in a row. The system is still running but this job may need attention.`,
        "No action needed right now. Tony will be alerted if the problem continues. The bot continues trading normally.",
      ),
      { job: name, consecutiveFailures: health.consecutiveFailures },
    );
  }

  if (health.consecutiveFailures >= FAILURE_DISABLE_THRESHOLD && !health.disabled && !NEVER_DISABLE_JOBS.has(name)) {
    health.disabled = true;
    health.disabledAt = new Date();
    health.disableReason = `Auto-disabled after ${health.consecutiveFailures} consecutive failures`;

    notifyCritical(
      `Scheduler: ${name} AUTO-DISABLED`,
      appendFamilyGradePostscript(
        `Job "${name}" disabled after ${health.consecutiveFailures} consecutive failures.\nLast error: ${error instanceof Error ? error.message : String(error)}\nTo re-enable: see docs/admin-runbook.md#scheduler-re-enable`,
        `A background maintenance job (${name}) has been automatically disabled after failing too many times. The bot continues trading, but this maintenance function is paused.`,
        "No immediate action needed. Tell Tony: 'A scheduler job was auto-disabled.' He will re-enable it when ready.",
      ),
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

  cronJobsConcurrent.inc();
  let attempt = 0;
  let lastErr: unknown;
  try {
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
  } finally {
    cronJobsConcurrent.dec();
  }
}

// ─── Pipeline gate — always-run jobs bypass the check ────────
// pipeline-resume-drain MUST run when paused so it can detect the transition
// back to ACTIVE; it has its own internal mode-change detector.
const ALWAYS_RUN_JOBS = new Set([
  "metrics-heartbeat",
  "stale-session-check",
  "pipeline-resume-drain",
  // Pass 6 / Track C F-6: observability scraper — never gate
  "n8n-execution-scrape",
]);

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

// ─── Track C F-4: in-process lock to prevent concurrent tick stacking ─────
// node-cron does NOT serialize ticks — if a previous tick is still running when
// the next interval fires, both run concurrently. For long-running jobs (sweep,
// scout discovery, suite runs) this stacks subprocesses and DB transactions.
const _inFlightJobs = new Set<string>();

// FINDING #2 FIX: wall-clock watchdog — force-release lock + CRITICAL Discord if job hangs.
// A hung fn() would hold the lock indefinitely; callers see "still in-flight" forever.
// MAX_JOB_DURATION_MS env-overridable; default 30 min (longest legit job is DeepAR ~10 min).
const MAX_JOB_DURATION_MS = parseInt(process.env.MAX_JOB_DURATION_MS ?? String(30 * 60 * 1000), 10);
const _jobWatchdogs = new Map<string, ReturnType<typeof setTimeout>>();

function _tryAcquireJobLock(name: string): boolean {
  if (_inFlightJobs.has(name)) {
    logger.warn({ jobName: name }, "cron tick skipped — previous tick still in-flight");
    return false;
  }
  _inFlightJobs.add(name);
  // Start wall-clock watchdog — fires if the job holds its lock past MAX_JOB_DURATION_MS
  const watchdog = setTimeout(() => {
    logger.error(
      { jobName: name, maxMs: MAX_JOB_DURATION_MS },
      "scheduler: job hung past wall-clock limit — force-releasing lock",
    );
    _inFlightJobs.delete(name);
    _jobWatchdogs.delete(name);
    notifyCritical(
      `[scheduler.job_hung] ${name} exceeded max duration`,
      // Deep-scan #5 (2026-06-29): family-grade postscript on the job-hung watchdog alert
      // (was the lone unwrapped notifyCritical in scheduler.ts the postscript lint flagged).
      appendFamilyGradePostscript(
        `Job "${name}" held its lock for >${MAX_JOB_DURATION_MS}ms without completing. ` +
        `Lock was force-released. Check for deadlocks, hung subprocesses, or DB connection exhaustion.`,
        "A scheduled background job got stuck and the bot force-released it so other jobs keep running.",
        "Trading is unaffected. If you see this repeatedly for the same job, tell Tony.",
      ),
      { jobName: name, maxMs: MAX_JOB_DURATION_MS },
    );
    insertAuditRowSafe({
      action: "scheduler.job_hung",
      entityType: "scheduler_job",
      entityId: name,
      decisionAuthority: "system",
      result: { maxMs: MAX_JOB_DURATION_MS, forcedRelease: true },
      status: "error",
    }).catch((auditErr: unknown) => {
      logger.error({ auditErr }, "scheduler: job_hung audit write failed");
    });
  }, MAX_JOB_DURATION_MS);
  // Allow process to exit without waiting for watchdog timers
  if ((watchdog as unknown as { unref?: () => void }).unref) {
    (watchdog as unknown as { unref: () => void }).unref();
  }
  _jobWatchdogs.set(name, watchdog);
  return true;
}
function _releaseJobLock(name: string): void {
  // FINDING #2 FIX: clear watchdog before releasing lock so it does not fire after completion
  const watchdog = _jobWatchdogs.get(name);
  if (watchdog) {
    clearTimeout(watchdog);
    _jobWatchdogs.delete(name);
  }
  _inFlightJobs.delete(name);
}

// ─── Track C F-8: scheduled-jobs registry for boot-time drift detection ───
// Each cron.schedule body adds its job name to this set. At end of initScheduler
// we compare SCHEDULER_JOBS keys vs _scheduledJobs to detect registered-but-
// unscheduled drift (Track C F-1/F-2 class of bug — dead-jobs that look healthy
// in the registry but never fire).
const _scheduledJobs = new Set<string>();

// ─── Track C F-6: jobs that MUST fire even when pipeline is paused ────────
// Heartbeat must alert operator even when pipeline gates research throughput.
// pre-trading-day-health-check (C8 gate) is intentionally not gated — same
// rationale.  metrics-heartbeat is observability infrastructure.
const _PIPELINE_GATE_EXEMPT = new Set<string>([
  "heartbeat-write",                 // F-3: must fire even when paused
  "heartbeat-stale-check",           // F-3: must alert even when paused
  "pre-trading-day-health-check",    // C8 gate — never gated
  "metrics-heartbeat",               // Observability infrastructure
  "stale-session-check",             // Safety: detects stuck paper sessions
  "pipeline-resume-drain",           // Self-evident — must observe resume
  "cme-status-poll",                 // Safety: outage detection
  "contract-roll-sweep",             // Safety: expiry handling
  "validation-cadence-monthly",      // Forcing function — can't be hidden
  "bias-engine-session-start",       // Safety/observability input
  "bias-engine-refresh-10am-et",     // Safety/observability input
  "harsh-regime-phase-activation-check", // Safety — gate hardening
  "n8n-execution-scrape",                // F-6: observability — must scrape even when paused
  // Wave 25 Pass 2 Y-1: drift detection must fire even when pipeline is paused.
  // An operator may have paused mid-week DUE TO drift; the auto-HALT signal is
  // the source of truth and cannot be silenced by the same pause it's guarding.
  "weekly-drift-2sigma-check",           // Y-1: safety signal — must fire even when paused
  // Wave 25 Pass 2 A-2: n8n drift detector must fire even when pipeline is paused.
  // Drift in n8n wiring (missing errorWorkflow, retry, idempotency) is an
  // infrastructure safety signal — the pipeline pause does not protect against it.
  "n8n-drift-detector-weekly",           // A-2: n8n drift detection — safety signal
  "n8n-drift-detector-monthly",          // A-2: n8n drift detection — defense-in-depth
  "economic-calendar-sync",              // authoritative macro release-date refresh (FRED/Fed/EIA)
  // W25.5d: pre-market briefing must fire even when pipeline is paused.
  // Operator wants the bias on phone before market open regardless of pipeline state.
  // Closes "trading without written bias" failure mode (Steenbarger/Topstep 2025 podcast).
  "pre-market-briefing-discord",         // W25.5d: operator briefing — safety signal
  // W26 Pass 6: consistency-tracker-daily-digest must fire even when paused.
  // Topstep payout denial can happen WHILE the pipeline is paused; the digest is a
  // safety signal for the operator, not a trading research signal.
  "consistency-tracker-daily-digest",    // W26: Topstep 40/50% consistency gate digest
  // W26 Group C: cohort audit report fires daily at 17:00 ET regardless of pipeline
  // state — operator needs the exit_plan distribution and invariant proof even when
  // the bot is in PAUSE. This is an observability signal, not a trading research signal.
  "wave26-cohort-daily-audit-report",   // W26C: cohort adaptive-exit audit snapshot
  // W27 Pass 1.5 A2: weekly quantum replay verdict must fire even when pipeline is
  // paused. The quantum harness is an observability / advisory signal for the operator
  // — an operator who paused trading still wants to know whether the disagreement
  // predictor is producing signal. Silencing it during a pipeline pause would break
  // the evidence-accumulation contract.
  "quantum-replay-weekly-analysis",     // W27P1.5: quantum replay weekly verdict
  // W28 Pass A.4: composite health daily digest must fire even when pipeline is
  // paused. The digest is a pure observability signal for the operator — strategy
  // health monitoring must continue regardless of pipeline gate state.
  "composite-health-daily-digest",      // W28A.4: composite strategy health digest
  // W29 Pass B.3: regime drift detection must fire even when pipeline is paused.
  // Regime drift continues regardless of operator intent to pause research. A
  // DEPLOYED strategy losing its trained regime during a pipeline pause is still
  // dangerous — the operator must be alerted and the strategy demoted regardless
  // of the pipeline gate state.
  "regime-drift-detector",              // W29B.3: daily regime drift sweep
  // W29 Pass D.3: A/B comparison weekly digest must fire even when pipeline is
  // paused. The operator needs weekly A/B performance visibility regardless of
  // whether the research pipeline is paused — pausing research does not stop
  // the paper accounts from accumulating evidence.
  "ab-comparison-weekly-digest",        // W29D.3: weekly A/B paper routing digest
  // W0.1: Nightly DB backup must fire even when pipeline is paused.
  // A hardware failure destroys the database regardless of pipeline state.
  // The backup signal is a safety/reliability signal, not a trading research signal.
  "db-backup",                          // W0.1: nightly off-tower DB backup
  // Phase 4C: daily reconciliation and weekly drift detection are safety signals —
  // they must run regardless of pipeline pause state to catch stale positions
  // and live/backtest drift that may have triggered the pause in the first place.
  "daily-reconciliation",               // Phase 4C: 4:15 PM ET weekdays reconciliation
  "weekly-drift-detection",             // Phase 4C: Sunday 6:00 PM ET drift detection
  // Pass 1 Track D: Discord fanout audit is observability — must probe webhooks even
  // when the trading pipeline is paused. The health state it writes is read by
  // production-status.ts; silencing it during a pause would cause false "not_configured"
  // reports to the operator.
  "discord-fanout-audit-30min",         // Pass 1 Track D: Discord webhook health probe
  // A14 regime-bank population is research / data-generation work — it runs even when
  // the pipeline is paused because a paused pipeline still needs the bank populated
  // so that the A14 black-swan evaluator can produce non-null survival rates the
  // moment the pipeline resumes. Regime generation has no financial impact.
  "synthetic-regime-bank-populate",     // A14: advisory challenger-only regime generation
  // Pass 7 Track C.1: DEPLOYED strategy Pine artifact daily reconciliation.
  // Must fire even when pipeline is paused — a DEPLOYED strategy lacking a Pine
  // artifact is a silent ops gap that affects live TradingView alerting regardless
  // of whether the research pipeline is actively promoting new strategies.
  "deployed-pine-artifact-check",       // P7C1: DEPLOYED strategy Pine artifact reconciliation
  // F-4: Position-drift reconciliation is a capital-safety signal — it must fire
  // even when the pipeline is paused. A drift detected while the pipeline is paused
  // may be the very reason the operator paused; silencing drift detection during the
  // pause would hide the event that needs operator attention most urgently.
  // Flag-gated: returns no-op when SERVER_MEDIATED_EXECUTION_ENABLED=false (the default).
  "position-drift-reconcile",           // F-4: server position vs broker drift detection
]);

function _validateAllJobsScheduled(): void {
  const registered = new Set(Object.keys(SCHEDULER_JOBS));
  const missing: string[] = [];
  for (const job of registered) {
    if (!_scheduledJobs.has(job)) missing.push(job);
  }
  if (missing.length > 0) {
    logger.error(
      { missing },
      "SCHEDULER_DRIFT: jobs registered via registerJob but no matching cron.schedule call",
    );
    if (process.env.NODE_ENV !== "production") {
      throw new Error(
        `Scheduler drift: ${missing.join(", ")} registered but no cron.schedule()`,
      );
    }
  }
}

// ─── Test seam ────────────────────────────────────────────────────────────────
// Exported ONLY for regression tests (scheduler-reconcile-pipelinegate.test.ts).
// Production code MUST NOT call _testOnly. The seam is intentionally minimal —
// just enough to register synthetic jobs and inspect the live registry.
export const _testOnly = {
  /** Register a synthetic job into SCHEDULER_JOBS (test isolation). */
  registerJob(name: string, intervalMs: number, run: () => Promise<void>): void {
    registerJob(name, intervalMs, run);
  },
  /** Get direct mutable reference to SCHEDULER_JOBS (tests set lastRunAt). */
  getJobs(): Record<string, JobMeta> {
    return SCHEDULER_JOBS;
  },
  /** Clear all registered jobs — call in beforeEach to avoid cross-test pollution. */
  resetJobs(): void {
    for (const key of Object.keys(SCHEDULER_JOBS)) {
      delete SCHEDULER_JOBS[key];
    }
  },
  /**
   * Wave hardening 2026-06-22, autonomous-readiness A-6:
   * Expose recordJobFailure for unit tests that verify NEVER_DISABLE_JOBS behaviour.
   */
  recordJobFailure(name: string, error: unknown): void {
    recordJobFailure(name, error);
  },
  /** Reset the jobHealthTracker for test isolation. */
  resetJobHealth(): void {
    jobHealthTracker.clear();
  },
  /**
   * B5 — scheduler-b5: Expose resumeActivePaperSessions for unit tests.
   * Tests can call this directly to verify PAPER+ skip behaviour without
   * requiring a server boot or cron tick.
   */
  resumeActivePaperSessions,
};

export async function reconcileMissedRuns() {
  const now = Date.now();
  for (const [name, meta] of Object.entries(SCHEDULER_JOBS)) {
    // Track C F-6: gate catchup runs through pipelineGate UNLESS exempt.
    // Without this, reconcileMissedRuns on boot would fire research-side jobs
    // (deepar-train, decay-monitor, etc.) even when the operator paused the
    // pipeline before the restart — silently re-starting the very work the
    // pause was meant to stop. Exempt jobs (heartbeat, C8, observability)
    // bypass the gate.
    const exempt = _PIPELINE_GATE_EXEMPT.has(name);
    if (!exempt) {
      const active = await pipelineGate(name);
      if (!active) {
        logger.info({ job: name }, "reconcileMissedRuns: skipped due to pipelineGate");
        continue;
      }
    }
    if (!meta.lastRunAt) {
      // Never ran in this process lifetime — if interval < 24h, run immediately
      // to catch up after a restart
      if (meta.intervalMs <= 24 * 60 * 60 * 1000) {
        logger.info({ job: name }, "Scheduler: job never ran this session — running catchup");
        try {
          await meta.run();
          markJobRun(name);
        } catch (err) {
          // F4 FIX: surface catchup failures in scheduler health so
          // /api/admin/scheduler/health reflects them (lastError + consecutiveFailures).
          // Previously the bare catch only logged, leaving health showing null/0.
          logger.error({ err, job: name }, "Scheduler: catchup run failed");
          schedulerLastError[name] = err instanceof Error ? err.message : String(err);
          recordJobFailure(name, err);
        }
      }
    } else if (meta.lastRunAt.getTime() + meta.intervalMs < now) {
      const overdueMs = now - (meta.lastRunAt.getTime() + meta.intervalMs);
      logger.info({ job: name, overdueMs }, "Scheduler: job overdue — running catchup");
      try {
        await meta.run();
        markJobRun(name);
      } catch (err) {
        // F4 FIX: same as above — propagate catchup failures to health state.
        logger.error({ err, job: name }, "Scheduler: catchup run failed");
        schedulerLastError[name] = err instanceof Error ? err.message : String(err);
        recordJobFailure(name, err);
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
  //    failed AFTER the primary backtest committed.
  //
  // F2 FIX: each handler now THROWS after logging so the DLQ item stays in
  // needs_retry state and escalates to CRITICAL after maxRetries. The previous
  // silent return caused the DLQ to mark the item "resolved" with zero retry,
  // producing invisible analytics data loss.
  //
  // We cannot auto-rerun these sub-runs without the original backtest config, so
  // the throw escalates to operator attention after the retry budget is consumed.
  // Operators can trigger a full re-backtest from the UI if the analytics data
  // is needed for a promotion decision.
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
        "DLQ retry: analytics sub-run — no auto-rerun implemented; throwing to keep item in needs_retry (F2 fix)",
      );
      // Throw so the DLQ service keeps this item in needs_retry and escalates
      // to CRITICAL after maxRetries instead of silently marking it resolved.
      throw new Error(
        `${opType}: no auto-rerun available for analytics sub-run (backtestId=${meta.backtestId ?? "unknown"}). ` +
        `Trigger a full re-backtest from the UI to regenerate analytics data.`,
      );
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
  // Economic calendar sync (2026-06-22): pull authoritative macro release dates from
  // FRED + Fed + EIA into economic_release_dates monthly + at boot. Pipeline-gate-exempt
  // (a data refresh, must run even when the pipeline is paused). Self-correcting — replaces
  // the hardcoded/projected blackout dates.
  registerJob("economic-calendar-sync", 30 * 24 * 60 * 60 * 1000, async () => {
    const { runEconomicCalendarSync } = await import("./services/economic-calendar-sync-service.js");
    await runEconomicCalendarSync();
  });
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
    // B8: PILOT canary sweep — runs alongside regular auto-promotion check
    const pilotResult = await lifecycle.checkPilotAutoPromotions({ correlationId });

    // Deep-scan 2026-06-28 (C-1): operator-absent (vacation) Tier-1 auto-promote.
    // runOperatorAbsentAutoPromote was EXPORTED but never called from any cron, so
    // the documented §3 vacation feature (DEPLOY_READY -> PILOT while away) never
    // fired. It self-guards (no-ops unless operator-absent mode is active AND the
    // pipeline is unpaused), so it is safe to call every tick.
    let absentPromoted: string[] = [];
    try {
      const { runOperatorAbsentAutoPromote } = await import("./services/operator-absent-mode-service.js");
      const absentResult = await runOperatorAbsentAutoPromote(correlationId);
      absentPromoted = absentResult.promoted;
      if (absentResult.errors.length > 0) {
        notifyWarning(
          `Operator-absent Tier-1 auto-promote: ${absentResult.errors.length} error(s)`,
          appendFamilyGradePostscript(
            `${absentResult.errors.length} vacation DEPLOY_READY->PILOT auto-promotion(s) failed: ${absentResult.errors.map((e) => `${e.strategyId} (${e.reason})`).join("; ")}.`,
            `${absentResult.errors.length} automatic promotion(s) during vacation mode did not complete. The bot is still running safely.`,
            "No action needed right now — Tony will review when back.",
          ),
          { errors: absentResult.errors, correlationId },
        );
      }
    } catch (absentErr) {
      const absentErrMsg = absentErr instanceof Error ? absentErr.message : String(absentErr);
      logger.error({ err: absentErr, correlationId }, "lifecycle-auto-check: operator-absent auto-promote sweep failed (non-blocking)");
      // A-1 FIX: emit a CRITICAL Discord alert so the operator sees the sweep failure
      // even while on vacation. Without this, a DB hiccup during the sweep would
      // silently skip all DEPLOY_READY → PILOT auto-promotions with no visibility.
      AlertFactory.notifyAbsentAutoPromoteFailed(absentErrMsg, correlationId).catch(
        (alertErr) => logger.error({ err: alertErr }, "lifecycle-auto-check: absent auto-promote Discord alert failed (non-blocking)"),
      );
    }

    if (promoted.length > 0 || demoted.length > 0 || pilotResult.promoted > 0 || pilotResult.killed > 0 || absentPromoted.length > 0) {
      broadcastSSE("lifecycle:auto-check", {
        promoted,
        demoted,
        pilotPromoted: pilotResult.promoted,
        pilotKilled: pilotResult.killed,
        operatorAbsentPromoted: absentPromoted,
        timestamp: new Date().toISOString(),
      });
    }
    logger.info({ promoted: promoted.length, demoted: demoted.length, pilotSwept: pilotResult.swept, pilotPromoted: pilotResult.promoted, pilotKilled: pilotResult.killed, operatorAbsentPromoted: absentPromoted.length, correlationId }, "Lifecycle auto-check complete");

    // Discord: WARNING if strategies were demoted — system health degraded
    if (demoted.length > 0) {
      notifyWarning(
        `System health degraded: ${demoted.length} strategy demotion(s)`,
        appendFamilyGradePostscript(
          `${demoted.length} strategy/strategies were automatically demoted during the lifecycle check. Review the dashboard for details on which strategies are now in DECLINING state.`,
          `${demoted.length} trading strategy${demoted.length > 1 ? "s were" : " was"} automatically moved to a lower stage because ${demoted.length > 1 ? "they are" : "it is"} not performing well enough. No live trading is affected — this is a research/test phase update.`,
          "No action needed. This is normal. Tony is aware and will review the strategies on the dashboard.",
        ),
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

  // ─── C7 (W16): Validation Cadence — monthly Reality Check ─
  // Compares backtested vs realized paper performance for all PAPER+
  // strategies, persists an audit_log row, and fires an alert when
  // cadence/throughput thresholds are breached. Cron fires on the 1st
  // at 3:30 AM UTC (offset from meta-parameter-review at 3:00 AM UTC).
  registerJob("validation-cadence-monthly", 30 * 24 * 60 * 60 * 1000, async () => {
    await runMonthlyRealityCheckReport();
  });

  // ─── C8 (W17): Pre-Trading-Day Health Check (Windows reboot guard) ─
  // Fires at 8:00 AM ET (DST-aware double-fire) on weekdays. Runs the
  // PowerShell script scripts/pre-trading-day-health-check.ps1 which
  // verifies (1) no pending Windows reboot, (2) no failed updates in
  // last 24h, (3) Node + Python services running, (4) >= 10GB free on
  // C:, (5) RAM utilization < 80%. On any non-zero exit, the cron pauses
  // the pipeline (fail-CLOSED) and fires a critical alert.
  //
  // Bypass: BYPASS_PRE_MARKET_HEALTH_CHECK=true (testing only).
  registerJob("pre-trading-day-health-check", 24 * 60 * 60 * 1000, async () => {
    const { runPreTradingDayHealthCheck } = await import("./services/windows-health-check-service.js");
    const result = await runPreTradingDayHealthCheck();
    logger.info(
      {
        status: result.status,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        pipelinePaused: result.pipelinePaused,
      },
      "Pre-trading-day health check complete",
    );
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
        suspectCount: report.suspectRules.length,
      },
      "Anti-setup effectiveness analysis complete",
    );
  });

  // ─── W23F.U (2026-05-19) — Daily autonomous scout discovery cron ───
  // Restored after the cron was dropped during W23F null-byte corruption
  // recovery. Fires ONCE A DAY ONLY. Memory feedback (operator):
  // "strategy generation should run ONCE A DAY not all day" — running every
  // 4 hours burned ~600 LLM calls/day. Once-daily keeps token budget healthy
  // (~150 calls/day, within the 2.5M token shared budget).
  //
  // Runs at 12:00 + 13:00 UTC tick (covers EDT 8 AM ET + EST 8 AM ET).
  // markJobRun() inside the runner ensures only one fire per UTC day.
  registerJob("autonomous-scout-discovery", 60 * 60 * 1000, async () => {
    const nowUtc = new Date();
    const hourUtc = nowUtc.getUTCHours();
    // 8 AM ET = 12:00 UTC (EDT, Mar-Nov) or 13:00 UTC (EST, Nov-Mar)
    if (hourUtc !== 12 && hourUtc !== 13) {
      return; // skip — wait for the right hour
    }
    // Idempotency: skip if we already ran today (UTC date)
    const todayKey = nowUtc.toISOString().slice(0, 10);
    const { db } = await import("./db/index.js");
    const { auditLog } = await import("./db/schema.js");
    const { sql, and, gte } = await import("drizzle-orm");
    const startOfDay = new Date(`${todayKey}T00:00:00Z`);
    const todayCount = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(auditLog)
      .where(and(sql`action = 'scout_cycle.started'`, gte(auditLog.createdAt, startOfDay)));
    if ((todayCount[0]?.n ?? 0) > 0) {
      logger.info({ todayCount: todayCount[0]?.n, todayKey }, "autonomous-scout-discovery: already ran today, skipping");
      return;
    }
    logger.info({ todayKey, hourUtc }, "autonomous-scout-discovery: firing once-daily cycle");
    const { runAutonomousScoutCycle } = await import("./services/autonomous-scout-runner.js");
    runAutonomousScoutCycle()
      .then((result) => logger.info({ result }, "autonomous-scout-discovery: cycle complete"))
      .catch((err) => logger.error({ err: err instanceof Error ? err.message : String(err) }, "autonomous-scout-discovery: cycle failed"));
  });

  // ─── Track C F-1: cron driver for autonomous-scout-discovery ────────────
  // The registerJob above was historically present without a matching
  // cron.schedule — the runner only fired via reconcileMissedRuns on each
  // boot. Hourly UTC tick; the inner hour-gate restricts execution to
  // 8 AM ET (UTC 12 or 13 depending on DST) and DB-level idempotency
  // ensures at-most-one-fire-per-UTC-day.
  cron.schedule("0 * * * *", async () => {
    if (!_tryAcquireJobLock("autonomous-scout-discovery")) return;
    try {
      if (!(await pipelineGate("autonomous-scout-discovery"))) return;
      const t0 = Date.now();
      await withRetry("autonomous-scout-discovery", SCHEDULER_JOBS["autonomous-scout-discovery"].run, 1);
      markJobRun("autonomous-scout-discovery");
      emitJobComplete("autonomous-scout-discovery", Date.now() - t0);
    } finally {
      _releaseJobLock("autonomous-scout-discovery");
    }
  });
  _scheduledJobs.add("autonomous-scout-discovery");

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

  // ─── Track C F-3: Dead-man's heartbeat — write every 15 min, check every 30 min ──
  // The heartbeat service was deployed without a cron driver — registerJob never
  // existed and no cron.schedule fired writeHeartbeat() / runHeartbeatStaleCheck().
  // Operator-absent mode depends on this loop firing every 15 min during RTH so
  // a backend hang generates a Discord/SMS alert within 30 min.
  // NOT pipeline-gated: heartbeat must fire even when pipeline is PAUSED — the
  // alert is the operator's only signal that the backend itself is alive.
  registerJob("heartbeat-write", 15 * 60 * 1000, async () => {
    const { writeHeartbeat } = await import("./services/dead-mans-heartbeat-service.js");
    await writeHeartbeat();
  });
  cron.schedule("*/15 * * * *", async () => {
    if (!_tryAcquireJobLock("heartbeat-write")) return;
    try {
      const t0 = Date.now();
      await withRetry("heartbeat-write", SCHEDULER_JOBS["heartbeat-write"].run, 1);
      markJobRun("heartbeat-write");
      emitJobComplete("heartbeat-write", Date.now() - t0);
    } finally {
      _releaseJobLock("heartbeat-write");
    }
  });
  _scheduledJobs.add("heartbeat-write");

  registerJob("heartbeat-stale-check", 30 * 60 * 1000, async () => {
    const { runHeartbeatStaleCheck, runScheduledRefreshStalenessCheck, runOperatorAbsenceAutoDetect } = await import("./services/dead-mans-heartbeat-service.js");
    await runHeartbeatStaleCheck();
    // Wave 24 Pass 1 Item 1: also check BW + cookie refresh heartbeats
    await runScheduledRefreshStalenessCheck();
    // Wave 24 Pass 1.5 Item 6: auto-flip operator_absent_since from 24h/48h silence
    await runOperatorAbsenceAutoDetect();
  });
  cron.schedule("*/30 * * * *", async () => {
    if (!_tryAcquireJobLock("heartbeat-stale-check")) return;
    try {
      const t0 = Date.now();
      await withRetry("heartbeat-stale-check", SCHEDULER_JOBS["heartbeat-stale-check"].run, 1);
      markJobRun("heartbeat-stale-check");
      emitJobComplete("heartbeat-stale-check", Date.now() - t0);
    } finally {
      _releaseJobLock("heartbeat-stale-check");
    }
  });
  _scheduledJobs.add("heartbeat-stale-check");

  // FINDING #6 FIX: secondary off-RTH heartbeat check every 4h.
  // The primary heartbeat-stale-check is RTH-only (isEtRth gate), leaving a ~64h blind spot
  // after a Friday-evening crash. This check fires at 4h intervals and sends a WARNING
  // (not CRITICAL auto-restart) when the last heartbeat is >8h old outside RTH.
  registerJob("heartbeat-ooh-check", 4 * 60 * 60 * 1000, async () => {
    const { runOffRthHeartbeatCheck } = await import("./services/dead-mans-heartbeat-service.js");
    await runOffRthHeartbeatCheck();
  });
  cron.schedule("0 */4 * * *", async () => {
    if (!_tryAcquireJobLock("heartbeat-ooh-check")) return;
    try {
      const t0 = Date.now();
      await withRetry("heartbeat-ooh-check", SCHEDULER_JOBS["heartbeat-ooh-check"].run, 1);
      markJobRun("heartbeat-ooh-check");
      emitJobComplete("heartbeat-ooh-check", Date.now() - t0);
    } finally {
      _releaseJobLock("heartbeat-ooh-check");
    }
  });
  _scheduledJobs.add("heartbeat-ooh-check");

  // ─── Pass 6 / Track C F-6: n8n execution-log scraper every 5 min ───
  // Pulls execution telemetry from n8n on Railway via REST API and writes
  // it into n8n_execution_log so the health/stats endpoints have data.
  // Observability infrastructure — NEVER pipeline-gated; must run even
  // when the trading pipeline is PAUSED so we still detect workflow
  // failures during downtime windows.
  registerJob("n8n-execution-scrape", 5 * 60 * 1000, async () => {
    await runN8nExecutionScrape();
  });
  cron.schedule("*/5 * * * *", async () => {
    if (!_tryAcquireJobLock("n8n-execution-scrape")) return;
    try {
      const t0 = Date.now();
      await withRetry("n8n-execution-scrape", SCHEDULER_JOBS["n8n-execution-scrape"].run, 1);
      markJobRun("n8n-execution-scrape");
      emitJobComplete("n8n-execution-scrape", Date.now() - t0);
    } finally {
      _releaseJobLock("n8n-execution-scrape");
    }
  });
  _scheduledJobs.add("n8n-execution-scrape");

  // ─── F-4: Position-drift reconciliation every 5 min ──────────
  // Closes audit finding F-4: checkPositionDrift() had no caller — dormant.
  // This cron is the periodic driver that wires drift detection into production.
  //
  // FLAG-GATED: runPositionDriftReconciliation() returns {checked:0,skipped:"flag_disabled"}
  // when SERVER_MEDIATED_EXECUTION_ENABLED=false (the default today — no live strategies).
  // The cron fires regardless so wiring is verified before go-live; the inner function
  // is the no-op guard, not the cron.
  //
  // PIPELINE-GATE-EXEMPT: position drift is a capital-safety signal that must fire
  // even when the trading pipeline is paused (see _PIPELINE_GATE_EXEMPT comment above).
  //
  // GO-LIVE PLUG: getBrokerPositionSnapshot() currently returns null (inert until a
  // real broker-position source — TopstepX REST / MFFU Playwright — is connected).
  // See its JSDoc for the integration contract.
  registerJob("position-drift-reconcile", 5 * 60 * 1000, async () => {
    const { runPositionDriftReconciliation } = await import("./services/fill-reconciliation-service.js");
    const correlationId = randomUUID();
    await runPositionDriftReconciliation(correlationId);
  });
  cron.schedule("*/5 * * * *", async () => {
    if (!_tryAcquireJobLock("position-drift-reconcile")) return;
    try {
      const t0 = Date.now();
      await withRetry("position-drift-reconcile", SCHEDULER_JOBS["position-drift-reconcile"].run, 1);
      markJobRun("position-drift-reconcile");
      emitJobComplete("position-drift-reconcile", Date.now() - t0);
    } finally {
      _releaseJobLock("position-drift-reconcile");
    }
  });
  _scheduledJobs.add("position-drift-reconcile");

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
          ).catch((alertErr) =>
            logger.error(
              { err: alertErr, context: "python-pool-saturation" },
              "AlertFactory.systemError failed — alert not persisted",
            ),
          );
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

  // Track C F-8: python-pool-saturation-check was registered but had no
  // cron.schedule — the saturation alarm only fired via reconcileMissedRuns
  // on each boot. Wire a proper 30s cron driver.
  cron.schedule("*/30 * * * * *", async () => {
    if (!_tryAcquireJobLock("python-pool-saturation-check")) return;
    try {
      const t0 = Date.now();
      await withRetry("python-pool-saturation-check", SCHEDULER_JOBS["python-pool-saturation-check"].run, 1);
      markJobRun("python-pool-saturation-check");
      emitJobComplete("python-pool-saturation-check", Date.now() - t0);
    } finally {
      _releaseJobLock("python-pool-saturation-check");
    }
  });
  _scheduledJobs.add("python-pool-saturation-check");

  // ─── Every 4 hours: Rolling Sharpe update ─────────────────
  cron.schedule("0 */4 * * *", async () => {
    if (!_tryAcquireJobLock("rolling-sharpe")) return;
    try {
    if (!(await pipelineGate("rolling-sharpe"))) return;
    logger.info("Scheduler: Running 4-hour rolling Sharpe update");
    const t0 = Date.now();
    await withRetry("rolling-sharpe", updateRollingSharpe);
    markJobRun("rolling-sharpe");
    emitJobComplete("rolling-sharpe", Date.now() - t0);
  } finally { _releaseJobLock("rolling-sharpe"); }
  });
  _scheduledJobs.add("rolling-sharpe");

  // ─── Daily at 6:05 AM ET: Pre-market prep (DST-aware) ────
  // Staggered to 6:05 AM ET (was 6:00 AM ET) to avoid competing with
  // DeepAR predict (6:00 AM ET) for the Python subprocess pool.
  // Run at both 10:05 and 11:05 UTC to cover EDT (UTC-4) and EST (UTC-5).
  // Check actual ET hour+minute before executing — only one will fire.
  cron.schedule("5 10,11 * * 1-5", async () => {
    if (!_tryAcquireJobLock("pre-market-prep")) return;
    try {
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
  } finally { _releaseJobLock("pre-market-prep"); }
  });
  _scheduledJobs.add("pre-market-prep");

  // ─── C8 (W17): Pre-Trading-Day Health Check at 8:00 AM ET, weekdays ─
  // Run at 12:00 and 13:00 UTC to cover EDT (UTC-4) and EST (UTC-5).
  // Filter on actual ET hour so only the correct one fires per day.
  //
  // INTENTIONALLY NOT pipelineGated. If the pipeline is already PAUSED
  // (operator-initiated or from a prior failed run), we still need the
  // check to run so subsequent successful runs can be observed in the
  // job-health dashboard. The service itself short-circuits when there
  // is nothing to do (no pause-state mutation on healthy outcomes).
  cron.schedule("0 12,13 * * 1-5", async () => {
    if (!_tryAcquireJobLock("pre-trading-day-health-check")) return;
    try {
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
    if (etHour !== 8 || etMin !== 0) {
      logger.debug(
        { etHour, etMin, utcHour: now.getUTCHours() },
        "Scheduler: pre-trading-day-health-check cron fired but not 8:00 AM ET — skipping",
      );
      return;
    }
    // Track C F-7: boot-loop guard. reconcileMissedRuns() at scheduler init
    // will fire this job once on boot (interval ≤ 24h). If the operator just
    // fixed a pause condition and restarted the server, the catchup tick +
    // this 8 AM cron firing back-to-back can re-pause the pipeline before
    // the fix has settled. Skip if we ran within the last 30 min.
    const lastRun = SCHEDULER_JOBS["pre-trading-day-health-check"]?.lastRunAt;
    if (lastRun && Date.now() - lastRun.getTime() < 30 * 60 * 1000) {
      logger.info(
        { lastRunAt: lastRun.toISOString(), ageMinutes: Math.floor((Date.now() - lastRun.getTime()) / 60000) },
        "Scheduler: pre-trading-day-health-check ran <30 min ago — skipping to avoid boot-loop re-pause",
      );
      return;
    }
    logger.info("Scheduler: Pre-trading-day health check (8:00 AM ET confirmed)");
    const t0hc = Date.now();
    await withRetry("pre-trading-day-health-check", SCHEDULER_JOBS["pre-trading-day-health-check"].run, 1);
    markJobRun("pre-trading-day-health-check");
    emitJobComplete("pre-trading-day-health-check", Date.now() - t0hc);
  } finally { _releaseJobLock("pre-trading-day-health-check"); }
  });
  _scheduledJobs.add("pre-trading-day-health-check");

  // ─── W25 Gap 8: Every hour — Broker error budget check (RTH + post-market) ──
  // Aggregates route_rejected / compliance_rejected from audit_log over rolling
  // 24h window. Alarms (audit + SSE + Discord WARN) when any (broker,class) pair
  // exceeds 5% of attempts. Pipeline-gated so it only runs when active.
  registerJob("broker-error-budget-check", 60 * 60 * 1000, async () => {
    const { runBrokerErrorBudgetCheck } = await import("./services/broker-error-budget-service.js");
    await runBrokerErrorBudgetCheck();
  });
  cron.schedule("0 * * * *", async () => {
    if (!_tryAcquireJobLock("broker-error-budget-check")) return;
    try {
      if (!(await pipelineGate("broker-error-budget-check"))) return;
      const t0beb = Date.now();
      await withRetry("broker-error-budget-check", SCHEDULER_JOBS["broker-error-budget-check"].run, 1);
      markJobRun("broker-error-budget-check");
      emitJobComplete("broker-error-budget-check", Date.now() - t0beb);
    } finally {
      _releaseJobLock("broker-error-budget-check");
    }
  });
  _scheduledJobs.add("broker-error-budget-check");

  // ─── Every hour: Compare stopped paper sessions to backtest ─
  cron.schedule("0 * * * *", async () => {
    if (!_tryAcquireJobLock("paper-vs-backtest")) return;
    try {
    if (!(await pipelineGate("paper-vs-backtest"))) return;
    logger.info("Scheduler: Running paper-vs-backtest comparison for recently stopped sessions");
    const t0pvb = Date.now();
    await withRetry("paper-vs-backtest", comparePaperToBacktest);
    markJobRun("paper-vs-backtest");
    emitJobComplete("paper-vs-backtest", Date.now() - t0pvb);
  } finally { _releaseJobLock("paper-vs-backtest"); }
  });
  _scheduledJobs.add("paper-vs-backtest");

  // ─── Daily at 2:00 AM ET: Decay monitor sweep (DST-aware) ────
  // Run at both 6:00 and 7:00 UTC to cover EDT (UTC-4) and EST (UTC-5).
  // Check actual ET hour before executing — only one of the two will fire.
  cron.schedule("0 6,7 * * *", async () => {
    if (!_tryAcquireJobLock("decay-monitor")) return;
    try {
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
  } finally { _releaseJobLock("decay-monitor"); }
  });
  _scheduledJobs.add("decay-monitor");

  // ─── Every 6 hours: Lifecycle auto-promotions/demotions ────
  cron.schedule("0 */6 * * *", async () => {
    if (!_tryAcquireJobLock("lifecycle-auto-check")) return;
    try {
    if (!(await pipelineGate("lifecycle-auto-check"))) return;
    logger.info("Scheduler: Running lifecycle auto-checks");
    const t0lc = Date.now();
    await withRetry("lifecycle-auto-check", SCHEDULER_JOBS["lifecycle-auto-check"].run);
    markJobRun("lifecycle-auto-check");
    emitJobComplete("lifecycle-auto-check", Date.now() - t0lc);
  } finally { _releaseJobLock("lifecycle-auto-check"); }
  });
  _scheduledJobs.add("lifecycle-auto-check");

  // ─── Every 5 minutes: Stale paper session detection ─────────
  cron.schedule("*/5 * * * *", async () => {
    if (!_tryAcquireJobLock("stale-session-check")) return;
    try {
    const t0stale = Date.now();
    await withRetry("stale-session-check", SCHEDULER_JOBS["stale-session-check"].run);
    markJobRun("stale-session-check");
    emitJobComplete("stale-session-check", Date.now() - t0stale);
  } finally { _releaseJobLock("stale-session-check"); }
  });
  _scheduledJobs.add("stale-session-check");

  // ─── Every 60 seconds: Metrics heartbeat ─────────────────────
  cron.schedule("* * * * *", async () => {
    if (!_tryAcquireJobLock("metrics-heartbeat")) return;
    try {
    const t0mh = Date.now();
    await withRetry("metrics-heartbeat", SCHEDULER_JOBS["metrics-heartbeat"].run, 1);
    markJobRun("metrics-heartbeat");
    emitJobComplete("metrics-heartbeat", Date.now() - t0mh);
  } finally { _releaseJobLock("metrics-heartbeat"); }
  });
  _scheduledJobs.add("metrics-heartbeat");

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
    if (!_tryAcquireJobLock("pipeline-resume-drain")) return;
    try {
    const t0drain = Date.now();
    await withRetry("pipeline-resume-drain", SCHEDULER_JOBS["pipeline-resume-drain"].run, 1);
    markJobRun("pipeline-resume-drain");
    emitJobComplete("pipeline-resume-drain", Date.now() - t0drain);
  } finally { _releaseJobLock("pipeline-resume-drain"); }
  });
  _scheduledJobs.add("pipeline-resume-drain");

  // ─── M4 fix: drain-scouted-ideas-periodic — every 10 minutes ───
  // Periodic drain so n8n strict-scout entries don't pile up forever.
  // pipeline-resume-drain only fires on PAUSE→ACTIVE transitions; this
  // covers the steady-state "pipeline is active and scouts are flowing" case.
  cron.schedule("*/10 * * * *", async () => {
    if (!_tryAcquireJobLock("drain-scouted-ideas-periodic")) return;
    try {
    const t0drainP = Date.now();
    await withRetry("drain-scouted-ideas-periodic", SCHEDULER_JOBS["drain-scouted-ideas-periodic"].run, 1);
    markJobRun("drain-scouted-ideas-periodic");
    emitJobComplete("drain-scouted-ideas-periodic", Date.now() - t0drainP);
  } finally { _releaseJobLock("drain-scouted-ideas-periodic"); }
  });
  _scheduledJobs.add("drain-scouted-ideas-periodic");

  // ─── DeepAR: Train daily at 2:30 AM ET (weekdays) ──────────
  // Run at both 6:30 and 7:30 UTC to cover EDT (UTC-4) and EST (UTC-5).
  cron.schedule("30 6,7 * * 1-5", async () => {
    if (!_tryAcquireJobLock("deepar-train")) return;
    try {
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
  } finally { _releaseJobLock("deepar-train"); }
  });
  _scheduledJobs.add("deepar-train");

  // ─── DeepAR: Predict daily at 6:00 AM ET (weekdays) ───────
  // Run at both 10:00 and 11:00 UTC to cover EDT/EST.
  cron.schedule("0 10,11 * * 1-5", async () => {
    if (!_tryAcquireJobLock("deepar-predict")) return;
    try {
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
  } finally { _releaseJobLock("deepar-predict"); }
  });
  _scheduledJobs.add("deepar-predict");

  // ─── Loop 1: Macro regime daily sync — 5 AM ET (DST-aware) ──────
  // Runs BEFORE archetype classifier (6 AM) and DeepAR predict (6 AM)
  // so today's macro_regime is the freshest signal those jobs see.
  cron.schedule("0 9,10 * * 1-5", async () => {
    if (!_tryAcquireJobLock("macro-data-sync")) return;
    try {
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
  } finally { _releaseJobLock("macro-data-sync"); }
  });
  _scheduledJobs.add("macro-data-sync");

  // ─── C11: FRED daily macro ingestion — 4 PM ET (weekdays) ────────
  // Pulls T10Y2Y, DFF, USEPUINDXD, VIXCLS, DTWEXBGS, RRPONTSYD from FRED.
  // Runs after US market close so daily values are settled.
  // After ingestion, runs HMM classifier to update macro_regime_states.
  // Pipeline-gated: C11 ingestion respects pause state (not a safety signal).
  registerJob("c11-fred-daily", 24 * 60 * 60 * 1000, async () => {
    const persisted = await runFredDailyIngestion();
    if (persisted > 0) {
      // Run HMM classifier immediately after successful ingestion
      invalidateMacroRegimeCache();
      await runMacroRegimeClassification();
    }
    logger.info({ persisted }, "C11 FRED daily ingestion + classification complete");
  });

  cron.schedule("0 20,21 * * 1-5", async () => {
    if (!_tryAcquireJobLock("c11-fred-daily")) return;
    try {
    const now = new Date();
    const etHour = parseInt(
      now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
      10,
    );
    if (etHour !== 16) return;
    if (!(await pipelineGate("c11-fred-daily"))) return;
    const t0 = Date.now();
    await withRetry("c11-fred-daily", SCHEDULER_JOBS["c11-fred-daily"].run);
    markJobRun("c11-fred-daily");
    emitJobComplete("c11-fred-daily", Date.now() - t0);
  } finally { _releaseJobLock("c11-fred-daily"); }
  });
  _scheduledJobs.add("c11-fred-daily");

  // ─── C11: H.4.1 RRP/TGA ingestion — Friday 9 AM ET ─────────────
  // H.4.1 is published Thursday 4:30 PM ET; we pull Friday morning
  // after it's available on FRED. Critical for RRP/TGA stress detection.
  registerJob("c11-h41-weekly", 7 * 24 * 60 * 60 * 1000, async () => {
    const persisted = await runH41Ingestion();
    logger.info({ persisted }, "C11 H.4.1 RRP/TGA ingestion complete");
  });

  cron.schedule("0 13,14 * * 5", async () => {
    if (!_tryAcquireJobLock("c11-h41-weekly")) return;
    try {
    // Friday only (day 5), 9 AM ET
    const now = new Date();
    const etHour = parseInt(
      now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
      10,
    );
    if (etHour !== 9) return;
    if (!(await pipelineGate("c11-h41-weekly"))) return;
    const t0 = Date.now();
    await withRetry("c11-h41-weekly", SCHEDULER_JOBS["c11-h41-weekly"].run);
    markJobRun("c11-h41-weekly");
    emitJobComplete("c11-h41-weekly", Date.now() - t0);
  } finally { _releaseJobLock("c11-h41-weekly"); }
  });
  _scheduledJobs.add("c11-h41-weekly");

  // ─── C11: BLS release ingestion — 8:35 AM ET on release days ─────
  // NFP/CPI/PPI/JOLTS are published at 8:30 AM ET; we pull at 8:35 AM
  // to capture the release. The cron fires daily Mon-Fri at 8:35 AM ET
  // but only runs ingestion if the economic calendar flags a release day.
  registerJob("c11-bls-release", 24 * 60 * 60 * 1000, async () => {
    const persisted = await runBlsIngestion();
    logger.info({ persisted }, "C11 BLS release ingestion complete");
  });

  cron.schedule("35 12,13 * * 1-5", async () => {
    if (!_tryAcquireJobLock("c11-bls-release")) return;
    try {
    // 8:35 AM ET (UTC 12:35/13:35 for EDT/EST)
    const now = new Date();
    const etHourStr = now.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const [etH, etM] = etHourStr.split(":");
    if (parseInt(etH, 10) !== 8 || parseInt(etM, 10) !== 35) return;
    if (!(await pipelineGate("c11-bls-release"))) return;
    const t0 = Date.now();
    await withRetry("c11-bls-release", SCHEDULER_JOBS["c11-bls-release"].run);
    markJobRun("c11-bls-release");
    emitJobComplete("c11-bls-release", Date.now() - t0);
  } finally { _releaseJobLock("c11-bls-release"); }
  });
  _scheduledJobs.add("c11-bls-release");

  // ─── C11: Treasury auction ingestion — daily 3 PM ET ─────────────
  // TreasuryDirect publishes auction results same-day. We poll daily at
  // 3 PM ET to capture any results published during the trading day.
  registerJob("c11-treasury-auctions", 24 * 60 * 60 * 1000, async () => {
    const persisted = await runTreasuryAuctionIngestion();
    logger.info({ persisted }, "C11 Treasury auction ingestion complete");
  });

  cron.schedule("0 19,20 * * 1-5", async () => {
    if (!_tryAcquireJobLock("c11-treasury-auctions")) return;
    try {
    // 3 PM ET (UTC 19:00/20:00 for EDT/EST)
    const now = new Date();
    const etHour = parseInt(
      now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
      10,
    );
    if (etHour !== 15) return;
    if (!(await pipelineGate("c11-treasury-auctions"))) return;
    const t0 = Date.now();
    await withRetry("c11-treasury-auctions", SCHEDULER_JOBS["c11-treasury-auctions"].run);
    markJobRun("c11-treasury-auctions");
    emitJobComplete("c11-treasury-auctions", Date.now() - t0);
  } finally { _releaseJobLock("c11-treasury-auctions"); }
  });
  _scheduledJobs.add("c11-treasury-auctions");

  // ─── W19 Schema 1: Definition pull — weekly Sunday 8 PM ET ─────────────────
  // Fetches CME contract specs from Databento Definition schema (FREE).
  // Alerts if multiplier/tick_size changed vs hardcoded firm-config.ts reference.
  // Runs BEFORE the weekly databento-weekly-refresh (Sunday 8 PM ET offset).
  // Pipeline-gated: Definition pull is research data, not a safety signal.
  registerJob("w19-definition-pull", 7 * 24 * 60 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    logger.info({ correlationId, jobName: "w19-definition-pull" }, "cron tick start");
    const result = await runDefinitionPull(correlationId);
    logger.info(
      { status: result.status, specChanged: result.specChanged, changedSymbols: result.changedSymbols, correlationId },
      "W19 Definition pull complete",
    );
  });

  // Sunday 8 PM ET = Monday 00:00 UTC (EDT) or 01:00 UTC (EST)
  // Fire at both 00:00 and 01:00 UTC on Sundays/Mondays and filter by ET hour
  cron.schedule("0 0,1 * * 0,1", async () => {
    if (!_tryAcquireJobLock("w19-definition-pull")) return;
    try {
    const now = new Date();
    const etHour = parseInt(
      now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
      10,
    );
    // 8 PM ET on Sunday
    const etDow = now.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short" });
    if (etHour !== 20 || etDow !== "Sun") return;
    if (!(await pipelineGate("w19-definition-pull"))) return;
    const t0 = Date.now();
    await withRetry("w19-definition-pull", SCHEDULER_JOBS["w19-definition-pull"].run);
    markJobRun("w19-definition-pull");
    emitJobComplete("w19-definition-pull", Date.now() - t0);
  } finally { _releaseJobLock("w19-definition-pull"); }
  });
  _scheduledJobs.add("w19-definition-pull");

  // ─── W19 Schema 2: Statistics pull — daily 6 PM ET (weekdays) ──────────────
  // Fetches CME daily settlement price + open interest (FREE).
  // Runs AFTER CME settlement (4:15 PM ET for futures) to capture settled prices.
  // Followed immediately by settlement reconciliation job.
  // Pipeline-gated.
  registerJob("w19-statistics-pull", 24 * 60 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    logger.info({ correlationId, jobName: "w19-statistics-pull" }, "cron tick start");
    const pullResult = await runStatisticsPull(5, correlationId);
    logger.info({ rowsPersisted: pullResult.rowsPersisted, correlationId }, "W19 Statistics pull complete");
    // Run settlement reconciliation immediately after pull has fresh data
    if (pullResult.status === "ok" && pullResult.rowsPersisted > 0) {
      const reconResult = await runSettlementReconciliation(correlationId);
      logger.info(
        { strategiesChecked: reconResult.strategiesChecked, alertsFired: reconResult.alertsFired, correlationId },
        "W19 Settlement reconciliation complete",
      );
    }
  });

  // 6 PM ET = 22:00 UTC (EDT) or 23:00 UTC (EST)
  cron.schedule("0 22,23 * * 1-5", async () => {
    if (!_tryAcquireJobLock("w19-statistics-pull")) return;
    try {
    const now = new Date();
    const etHour = parseInt(
      now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
      10,
    );
    if (etHour !== 18) return;
    if (!(await pipelineGate("w19-statistics-pull"))) return;
    const t0 = Date.now();
    await withRetry("w19-statistics-pull", SCHEDULER_JOBS["w19-statistics-pull"].run);
    markJobRun("w19-statistics-pull");
    emitJobComplete("w19-statistics-pull", Date.now() - t0);
  } finally { _releaseJobLock("w19-statistics-pull"); }
  });
  _scheduledJobs.add("w19-statistics-pull");

  // ─── W19 Schema 3: Imbalance pull — weekdays 8:25 AM ET ─────────────────────
  // Fetches CME opening auction imbalance for ES + NQ (~$5/month).
  // Published ~1s before 8:30 AM ET open; captured at 8:25 AM ET pull time.
  // Surfaces openingAuctionBias to opening_range_breakout strategies.
  // Pipeline-gated.
  registerJob("w19-imbalance-pull", 24 * 60 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    logger.info({ correlationId, jobName: "w19-imbalance-pull" }, "cron tick start");
    const result = await runAuctionImbalancePull(1, correlationId);
    logger.info(
      { rowsPersisted: result.rowsPersisted, status: result.status, correlationId },
      "W19 Imbalance pull complete",
    );
    if (result.rowsPersisted > 0) {
      broadcastSSE("auction:imbalance-updated", {
        rowsPersisted: result.rowsPersisted,
        results: result.results,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // 8:25 AM ET = 12:25 UTC (EDT) or 13:25 UTC (EST)
  cron.schedule("25 12,13 * * 1-5", async () => {
    if (!_tryAcquireJobLock("w19-imbalance-pull")) return;
    try {
    const now = new Date();
    const etTimeStr = now.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const [etH, etM] = etTimeStr.split(":");
    if (parseInt(etH, 10) !== 8 || parseInt(etM, 10) !== 25) return;
    if (!(await pipelineGate("w19-imbalance-pull"))) return;
    const t0 = Date.now();
    await withRetry("w19-imbalance-pull", SCHEDULER_JOBS["w19-imbalance-pull"].run);
    markJobRun("w19-imbalance-pull");
    emitJobComplete("w19-imbalance-pull", Date.now() - t0);
  } finally { _releaseJobLock("w19-imbalance-pull"); }
  });
  _scheduledJobs.add("w19-imbalance-pull");

  // ─── C2: Day archetype classifier — daily at 6 AM ET (DST-aware) ───
  // Runs in parallel with deepar-predict.  Predicts today's day archetype
  // (TREND_DAY_UP, RANGE_DAY, …) from premarket features and writes one
  // row per symbol into day_archetypes.  Strategy eligibility matrix
  // and skip classifier read from this table at evaluation time.
  cron.schedule("0 10,11 * * 1-5", async () => {
    if (!_tryAcquireJobLock("archetype-daily-classify")) return;
    try {
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
  } finally { _releaseJobLock("archetype-daily-classify"); }
  });
  _scheduledJobs.add("archetype-daily-classify");

  // ─── DeepAR: Validate at 6:35 AM ET (weekdays) ────────────
  // Staggered to 6:35 AM ET (was 6:30 AM ET) to give pre-market prep (6:05)
  // a 30-min window before a second Python-spawning cron hits the pool.
  // Run at both 10:35 and 11:35 UTC to cover EDT/EST.
  cron.schedule("35 10,11 * * 1-5", async () => {
    if (!_tryAcquireJobLock("deepar-validate")) return;
    try {
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
  } finally { _releaseJobLock("deepar-validate"); }
  });
  _scheduledJobs.add("deepar-validate");

  // ─── Tier 3.3: A+ Market Auditor — daily at 8:00 AM ET (DST-aware) ─────────
  // Scores MES, MNQ, MCL via quantum MC + entropy filter + cross-market VQC.
  // Picks today's highest-edge market; emits OBSERVATION_MODE if none qualifies.
  // Gated by QUANTUM_AMARKET_AUDITOR_ENABLED (now true — advisory-only, cannot block signals).
  // isActive() guard: early-exit when pipeline is not ACTIVE.
  // Compliance: lead_market field is signal-only; Tier 5.3.1 (W5b) enforces
  // correlated-position guard.
  // Run at both 12:00 and 13:00 UTC to cover EDT (UTC-4) and EST (UTC-5).
  registerJob("a-plus-auditor-scan", 24 * 60 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    logger.info({ correlationId, jobName: "a-plus-auditor-scan" }, "cron tick start");
    if (!(await isPipelineActive())) {
      logger.debug({ correlationId }, "a-plus-auditor-scan: pipeline not ACTIVE — skipping");
      return;
    }
    const { runAuditScan } = await import("./services/a-plus-auditor-service.js");
    // F-4 fix: ATR is enriched inside runAuditScan via enrichWithRealAtr() which
    // queries pre_market_sessions for real overnight_range_points per symbol.
    // The values below are per-symbol fallback defaults used ONLY when no
    // pre_market_sessions row exists. They differ per-symbol so the atr_ratio
    // is not identical across markets even in the pure-fallback path.
    // F-5 fix: p_target_hit is enriched inside runAuditScan via enrichWithPTargetHit()
    // which derives a data-driven classical estimate per market from pre_market_sessions
    // (atr_percentile + cross_asset_aligned + overnight_range_points).
    // TODO(go-live enrichment): wire Databento pre-market ATR for 8-year rolling avg.
    const result = await runAuditScan(
      {
        marketInputs: {
          MES: { atr_5m: 2.8, atr_8yr_avg: 2.8, vix: 18.0, gap_atr: 0.2, spread: 0.05 },
          MNQ: { atr_5m: 4.5, atr_8yr_avg: 4.5, vix: 18.0, gap_atr: 0.3, spread: 0.04 },
          MCL: { atr_5m: 0.35, atr_8yr_avg: 0.35, vix: 18.0, gap_atr: 0.1, spread: 0.10 },
        },
      },
      correlationId,
    );
    if (!result.skipped) {
      logger.info(
        {
          correlationId,
          winnerMarket: result.winnerMarket,
          observationMode: result.observationMode,
          leadMarket: result.leadMarket,
          entanglementStrength: result.entanglementStrength,
          hardware: result.hardware,
          scanDurationMs: result.scanDurationMs,
        },
        "a-plus-auditor-scan: completed",
      );
    }
  });

  cron.schedule("0 12,13 * * 1-5", async () => {
    if (!_tryAcquireJobLock("a-plus-auditor-scan")) return;
    try {
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
    if (etHour !== 8 || etMin !== 0) {
      logger.debug({ etHour, etMin }, "Scheduler: A+ auditor cron fired but not 8:00 AM ET — skipping");
      return;
    }
    if (!(await pipelineGate("a-plus-auditor-scan"))) return;
    logger.info("Scheduler: A+ Market Auditor scan (8:00 AM ET)");
    const t0audit = Date.now();
    await withRetry("a-plus-auditor-scan", SCHEDULER_JOBS["a-plus-auditor-scan"].run);
    markJobRun("a-plus-auditor-scan");
    emitJobComplete("a-plus-auditor-scan", Date.now() - t0audit);
  } finally { _releaseJobLock("a-plus-auditor-scan"); }
  });
  _scheduledJobs.add("a-plus-auditor-scan");

  // ─── Tier 4.5: cloud-qmc-poll — every 5 min ─────────────────────────────────
  // Polls IBM pending jobs and updates cloud_qmc_runs with decoded syndrome results.
  // isActive() guard: early-exit when pipeline is paused.
  // Default OFF: QUANTUM_CLOUD_ENABLED must be true for any IBM work to happen.
  // SHADOW ONLY: results are challenger-only evidence, never gates promotion.
  registerJob("cloud-qmc-poll", 5 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    logger.debug({ correlationId, jobName: "cloud-qmc-poll" }, "cron tick start");
    if (!(await isPipelineActive())) {
      logger.debug({ correlationId }, "cloud-qmc-poll: pipeline not ACTIVE — skipping");
      return;
    }
    const cloudEnabled = (process.env.QUANTUM_CLOUD_ENABLED ?? "").toLowerCase() === "true";
    if (!cloudEnabled) {
      logger.debug({ correlationId }, "cloud-qmc-poll: QUANTUM_CLOUD_ENABLED not set — skipping");
      return;
    }
    const { pollPendingJobs } = await import("./services/cloud-qmc-service.js");
    const result = await pollPendingJobs();
    if (result.processed > 0) {
      logger.info(
        { correlationId, ...result, jobName: "cloud-qmc-poll" },
        "cloud-qmc-poll: cycle complete (challenger-only evidence, Phase 0 shadow)",
      );
    }
  });

  // Track C F-8: cloud-qmc-poll was registered but had no cron.schedule —
  // the IBM Quantum job poller only fired via reconcileMissedRuns. Wire a
  // proper 5-min cron driver. Inner guards (isPipelineActive, QUANTUM_CLOUD_ENABLED)
  // keep it cheap when disabled.
  cron.schedule("*/5 * * * *", async () => {
    if (!_tryAcquireJobLock("cloud-qmc-poll")) return;
    try {
      const t0 = Date.now();
      await withRetry("cloud-qmc-poll", SCHEDULER_JOBS["cloud-qmc-poll"].run, 1);
      markJobRun("cloud-qmc-poll");
      emitJobComplete("cloud-qmc-poll", Date.now() - t0);
    } finally {
      _releaseJobLock("cloud-qmc-poll");
    }
  });
  _scheduledJobs.add("cloud-qmc-poll");

  // ─── Daily at 11:00 PM ET: Regret score fill ────────────────
  // Run at both 3:00 and 4:00 UTC to cover EDT (UTC-4) and EST (UTC-5).
  // Fills regretScore / opportunityCost on skipDecisions rows that now have
  // actualPnl but were created before Phase 2.4 landed, or whose session
  // post-processing ran before regret scoring was available.
  registerJob("regret-score-fill", 24 * 60 * 60 * 1000, fillRegretScores);
  cron.schedule("0 3,4 * * *", async () => {
    if (!_tryAcquireJobLock("regret-score-fill")) return;
    try {
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
  } finally { _releaseJobLock("regret-score-fill"); }
  });
  _scheduledJobs.add("regret-score-fill");

  // ─── Every 2 hours: Agent health sweep ───────────────────
  cron.schedule("0 */2 * * *", async () => {
    if (!_tryAcquireJobLock("agent-health-sweep")) return;
    try {
    if (!(await pipelineGate("agent-health-sweep"))) return;
    logger.info("Scheduler: Running agent health sweep");
    const t0ahs = Date.now();
    await withRetry("agent-health-sweep", async () => { await runAgentHealthSweep(); });
    markJobRun("agent-health-sweep");
    emitJobComplete("agent-health-sweep", Date.now() - t0ahs);
  } finally { _releaseJobLock("agent-health-sweep"); }
  });
  _scheduledJobs.add("agent-health-sweep");

  // ─── Daily at midnight UTC: Portfolio correlation check ──
  cron.schedule("0 0 * * *", async () => {
    if (!_tryAcquireJobLock("portfolio-correlation")) return;
    try {
    if (!(await pipelineGate("portfolio-correlation"))) return;
    logger.info("Scheduler: Running portfolio correlation check");
    const t0pc = Date.now();
    await withRetry("portfolio-correlation", async () => { await runPortfolioCorrelationCheck(); });
    markJobRun("portfolio-correlation");
    emitJobComplete("portfolio-correlation", Date.now() - t0pc);
  } finally { _releaseJobLock("portfolio-correlation"); }
  });
  _scheduledJobs.add("portfolio-correlation");

  // ─── Monthly on 1st at 3:00 AM UTC: Meta parameter review ─
  cron.schedule("0 3 1 * *", async () => {
    if (!_tryAcquireJobLock("meta-parameter-review")) return;
    try {
    if (!(await pipelineGate("meta-parameter-review"))) return;
    logger.info("Scheduler: Running monthly meta parameter review");
    const t0mp = Date.now();
    await withRetry("meta-parameter-review", async () => { await runMetaParameterReview(30); });
    markJobRun("meta-parameter-review");
    emitJobComplete("meta-parameter-review", Date.now() - t0mp);
  } finally { _releaseJobLock("meta-parameter-review"); }
  });
  _scheduledJobs.add("meta-parameter-review");

  // ─── C7 (W16): Monthly on 1st at 3:30 AM UTC — Reality Check report ─
  // Compares backtested vs realized paper performance for all PAPER+
  // strategies. Persists audit_log + fires alert when thresholds breach.
  // INTENTIONALLY runs even when pipeline is paused — the entire point of the
  // forcing function is that operators can't hide from validation cadence by
  // pausing the pipeline. The report informs whether to resume work, so the
  // gate would be self-defeating.
  cron.schedule("30 3 1 * *", async () => {
    if (!_tryAcquireJobLock("validation-cadence-monthly")) return;
    try {
    logger.info("Scheduler: Running monthly Reality Check report (validation cadence)");
    const t0rc = Date.now();
    await withRetry("validation-cadence-monthly", async () => { await runMonthlyRealityCheckReport(); });
    markJobRun("validation-cadence-monthly");
    emitJobComplete("validation-cadence-monthly", Date.now() - t0rc);
  } finally { _releaseJobLock("validation-cadence-monthly"); }
  });
  _scheduledJobs.add("validation-cadence-monthly");

  // ─── Weekly Monday 12 AM ET: Anti-setup mine + effectiveness ──
  // Run at 4:00 and 5:00 UTC to cover EDT (UTC-4) and EST (UTC-5).
  // Only fires when the ET hour resolves to Monday 12:00 AM.
  cron.schedule("0 4,5 * * 1", async () => {
    if (!_tryAcquireJobLock("anti-setup-mine")) return;
    try {
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
  } finally { _releaseJobLock("anti-setup-mine"); }
  });
  _scheduledJobs.add("anti-setup-mine");
  // Track C F-8: anti-setup-effectiveness is driven by the anti-setup-mine cron
  // above (same Monday 12 AM ET tick — mine runs first, effectiveness runs
  // immediately after). It has no independent cron.schedule but IS reached by
  // a tick, so mark it scheduled to avoid spurious drift detection.
  _scheduledJobs.add("anti-setup-effectiveness");

  // ─── DLQ retry — every 15 minutes ─────────────────────────
  registerJob("dlq-retry", 15 * 60 * 1000, async () => {
    const { retryAllUnresolved } = await import("./lib/dlq-service.js");
    const result = await retryAllUnresolved();
    if (result.attempted > 0) {
      logger.info(result, "DLQ batch retry completed");
    }
  });

  cron.schedule("*/15 * * * *", async () => {
    if (!_tryAcquireJobLock("dlq-retry")) return;
    try {
    if (!(await pipelineGate("dlq-retry"))) return;
    const t0dlq = Date.now();
    await withRetry("dlq-retry", SCHEDULER_JOBS["dlq-retry"].run);
    markJobRun("dlq-retry");
    emitJobComplete("dlq-retry", Date.now() - t0dlq);
  } finally { _releaseJobLock("dlq-retry"); }
  });
  _scheduledJobs.add("dlq-retry");

  // ─── DLQ escalation — every hour ──────────────────────────
  registerJob("dlq-escalation", 60 * 60 * 1000, async () => {
    const { escalateDLQ } = await import("./lib/dlq-service.js");
    const count = await escalateDLQ();
    if (count > 0) {
      logger.warn({ escalated: count }, "DLQ items escalated");
    }
  });

  cron.schedule("0 * * * *", async () => {
    if (!_tryAcquireJobLock("dlq-escalation")) return;
    try {
    if (!(await pipelineGate("dlq-escalation"))) return;
    const t0esc = Date.now();
    await withRetry("dlq-escalation", SCHEDULER_JOBS["dlq-escalation"].run);
    markJobRun("dlq-escalation");
    emitJobComplete("dlq-escalation", Date.now() - t0esc);
  } finally { _releaseJobLock("dlq-escalation"); }
  });
  _scheduledJobs.add("dlq-escalation");

  // ─── Idempotency key cleanup — daily at 3 AM ET ──────────────
  registerJob("idempotency-cleanup", 24 * 60 * 60 * 1000, async () => {
    const { idempotencyKeys } = await import("./db/schema.js");
    const { lt } = await import("drizzle-orm");
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, cutoff));
    logger.info("Idempotency keys cleaned up");
  });

  cron.schedule("0 3 * * *", async () => {
    if (!_tryAcquireJobLock("idempotency-cleanup")) return;
    try {
    if (!(await pipelineGate("idempotency-cleanup"))) return;
    const t0idem = Date.now();
    await withRetry("idempotency-cleanup", SCHEDULER_JOBS["idempotency-cleanup"].run);
    markJobRun("idempotency-cleanup");
    emitJobComplete("idempotency-cleanup", Date.now() - t0idem);
  } finally { _releaseJobLock("idempotency-cleanup"); }
  });
  _scheduledJobs.add("idempotency-cleanup");

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
    if (!_tryAcquireJobLock("quantum-cost-prune")) return;
    try {
    const t0qcp = Date.now();
    await withRetry("quantum-cost-prune", SCHEDULER_JOBS["quantum-cost-prune"].run, 1);
    markJobRun("quantum-cost-prune");
    emitJobComplete("quantum-cost-prune", Date.now() - t0qcp);
  } finally { _releaseJobLock("quantum-cost-prune"); }
  });
  _scheduledJobs.add("quantum-cost-prune");

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

    // FINDING #5 FIX: backtests stuck 'running' >90min block conveyor re-enqueue.
    // A Python SIGKILL/OOM leaves status='running' forever — conveyor's NOT-EXISTS-running
    // guard never re-enqueues the strategy → strategy silently stranded indefinitely.
    // Marking failed allows the conveyor to re-enqueue after the 24h cooling-off period.
    try {
      const backtestsResult = await db
        .update(backtests)
        .set({ status: "failed", errorMessage: "stale-pending-sweeper: marked failed after 90min running (Python OOM/SIGKILL guard)" })
        .where(_and(_eq(backtests.status, "running"), lt(backtests.createdAt, cutoff90)));
      const backtestsSwept = (backtestsResult as any)?.rowCount ?? 0;
      if (backtestsSwept > 0) {
        totalSwept += backtestsSwept;
        logger.warn({ table: "backtests", swept: backtestsSwept, thresholdMin: 90 }, "stale-pending-sweeper: marked stale running backtests as failed");
        await db.insert(auditLog).values({
          action: "stale-pending-sweeper.swept",
          entityType: "backtests",
          entityId: null,
          input: { cutoff: cutoff90.toISOString(), threshold_min: 90 },
          result: { swept: backtestsSwept, note: "conveyor will re-enqueue after 24h cooling-off" },
          status: "success",
          correlationId,
        });
      }
    } catch (err) {
      logger.error({ table: "backtests", err }, "stale-pending-sweeper: error sweeping backtests");
    }

    // Fix 3d (2026-06-29): agent_jobs — use COALESCE(started_at, created_at) so the
    // 90-min threshold is measured from actual execution start, not job creation.
    // Sweeps both 'pending' (never picked up) and 'running' (picked up but timed out).
    // Migration 0183 added started_at; routes/agent.ts sets it on pickup.
    try {
      const agentJobsResult = await db
        .update(agentJobs)
        .set({ status: "failure", errorMessage: "stale-pending-sweeper: marked failure after 90min without completion (COALESCE(started_at, created_at) threshold)" })
        .where(_and(
          _or(_eq(agentJobs.status, "pending"), _eq(agentJobs.status, "running")),
          sql`COALESCE(${agentJobs.startedAt}, ${agentJobs.createdAt}) < ${cutoff90}`,
        ));
      const agentJobsSwept = (agentJobsResult as any)?.rowCount ?? 0;
      if (agentJobsSwept > 0) {
        totalSwept += agentJobsSwept;
        logger.warn({ table: "agent_jobs", swept: agentJobsSwept, thresholdMin: 90, keyed_on: "coalesce_started_at_created_at" }, "stale-pending-sweeper: marked stale agent_jobs as failure");
        await db.insert(auditLog).values({
          action: "stale-pending-sweeper.swept",
          entityType: "agent_jobs",
          entityId: null,
          input: { cutoff: cutoff90.toISOString(), threshold_min: 90, keyed_on: "coalesce_started_at_created_at" },
          result: { swept: agentJobsSwept },
          status: "success",
          correlationId,
        });
      }
    } catch (err) {
      logger.error({ table: "agent_jobs", err }, "stale-pending-sweeper: error sweeping agent_jobs");
    }

    if (totalSwept === 0) {
      logger.debug("stale-pending-sweeper: no orphaned rows");
    }
  });

  cron.schedule("*/5 * * * *", async () => {
    if (!_tryAcquireJobLock("stale-pending-sweeper")) return;
    try {
    if (!(await pipelineGate("stale-pending-sweeper"))) return;
    const t0sweep = Date.now();
    await withRetry("stale-pending-sweeper", SCHEDULER_JOBS["stale-pending-sweeper"].run);
    markJobRun("stale-pending-sweeper");
    emitJobComplete("stale-pending-sweeper", Date.now() - t0sweep);
  } finally { _releaseJobLock("stale-pending-sweeper"); }
  });
  _scheduledJobs.add("stale-pending-sweeper");

  // G6.4 note: contract-roll-sweep is already registered at the daily 4:30 PM
  // ET schedule below (calls runSessionEndRollSweep in paper-execution-service).
  // The audit's claim that the trigger was missing was based on a stale
  // snapshot — verified registered at the daily session-end block.

  // ─── n8n workflow sync — daily at 2:15 AM ET ─────────────────
  // Fix 1 (2026-06-29): was execSync, which blocked V8's event loop for up to
  // 60s (no HTTP/WS/SSE/cron/DLL signals processed). Now uses execFileAsync
  // (non-blocking) — static import at file top, mirrors cloud-qmc-service.ts.
  registerJob("n8n-workflow-sync", 24 * 60 * 60 * 1000, async () => {
    try {
      const { stdout } = await execFileAsync("npx", ["tsx", "scripts/n8n-workflow-sync.ts"], {
        cwd: process.cwd(),
        timeout: 60000,
        env: process.env as Record<string, string>,
      });
      logger.info({ output: stdout.slice(-500) }, "n8n workflow sync completed");
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
        appendFamilyGradePostscript(
          `Drift items:\n${drift.driftItems.join("\n")}`,
          "The system's internal catalog of components is out of date. This is a developer maintenance issue and does not affect trading.",
          "No action needed. Tell Tony if this keeps appearing. The bot continues trading normally.",
        ),
      );
      logger.warn({ driftItems: drift.driftItems }, "System map drift detected");
    } else {
      logger.info("System map drift check: no drift");
    }
  });

  // ─── Daily at 2:15 AM ET: n8n workflow sync (DST-aware) ──────
  // Run at 6:15 and 7:15 UTC to cover EDT (UTC-4) and EST (UTC-5).
  cron.schedule("15 6,7 * * *", async () => {
    if (!_tryAcquireJobLock("n8n-workflow-sync")) return;
    try {
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
  } finally { _releaseJobLock("n8n-workflow-sync"); }
  });
  _scheduledJobs.add("n8n-workflow-sync");

  // Run at 8:00 and 9:00 UTC to cover EDT (UTC-4) and EST (UTC-5) for 4 AM ET.
  cron.schedule("0 8,9 * * *", async () => {
    if (!_tryAcquireJobLock("system-map-drift")) return;
    try {
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
  } finally { _releaseJobLock("system-map-drift"); }
  });
  _scheduledJobs.add("system-map-drift");

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
    if (!_tryAcquireJobLock("compliance-rule-drift")) return;
    try {
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
  } finally { _releaseJobLock("compliance-rule-drift"); }
  });
  _scheduledJobs.add("compliance-rule-drift");

  // ─── W24-P2 Item 21: HMM regime weekly refit — Sunday 17:00 ET ───────────────
  // Fires before the weekly drift halt at 18:00 ET so the freshly-fitted model
  // is available for Monday session-start bias computation.
  // HMM_OVERLAY_ENABLED=false skips entirely.
  registerJob("hmm-regime-weekly-refit", 7 * 24 * 60 * 60 * 1000, async () => {
    if ((process.env.HMM_OVERLAY_ENABLED ?? "true").toLowerCase() === "false"
        || process.env.HMM_OVERLAY_ENABLED === "0") {
      logger.info("hmm-regime-weekly-refit: HMM_OVERLAY_ENABLED=false — skipping");
      return;
    }

    const { runPythonModule } = await import("./lib/python-runner.js");
    const symbols = ["MES", "MNQ", "MCL"];

    for (const sym of symbols) {
      try {
        const refitResult = await runPythonModule<{
          symbol: string;
          fit_date: string;
          bar_count: number;
          fit_duration_ms: number;
          params_json: Record<string, unknown>;
          error?: string;
        }>({
          scriptCode: `
import sys, json, os, time, datetime
sys.path.insert(0, "src")

# Symbol inlined by TS (avoids env var dependency)
symbol = ${JSON.stringify(sym)}
n_states = int(os.environ.get("HMM_N_STATES", "3"))
fit_date = datetime.date.today().isoformat()
t0 = time.time()

try:
    import polars as pl
    from src.engine.context.hmm_regime import fit_hmm_regimes

    data_root = os.environ.get("DATA_ROOT", "data")
    # Load continuous daily OHLCV for the symbol
    path = f"{data_root}/ratio_adj/{symbol}/daily.parquet"
    df = pl.read_parquet(path)
    if "close" not in df.columns:
        raise ValueError(f"No 'close' column in {path}")
    bar_count = len(df)
    model = fit_hmm_regimes(df, n_states=n_states)
    elapsed_ms = int((time.time() - t0) * 1000)
    print(json.dumps({
        "symbol": symbol,
        "fit_date": fit_date,
        "bar_count": bar_count,
        "fit_duration_ms": elapsed_ms,
        "params_json": model.to_dict(),
    }))
except Exception as e:
    print(json.dumps({"error": str(e)[:300], "symbol": symbol, "fit_date": fit_date,
                      "bar_count": 0, "fit_duration_ms": 0, "params_json": {}}))
`,
          timeoutMs: 120_000,
          componentName: "hmm-regime-weekly-refit",
        });

        if (refitResult.error) {
          logger.warn({ symbol: sym, error: refitResult.error }, "hmm-regime-weekly-refit: Python refit errored — skipping DB upsert");
          continue;
        }

        // Upsert into regime_hmm_models (UNIQUE on symbol + fit_date)
        await db.execute(
          sql`
            INSERT INTO regime_hmm_models (symbol, fit_date, n_states, params_json, bar_count, fit_duration_ms, created_at)
            VALUES (
              ${sym},
              ${refitResult.fit_date}::date,
              ${3},
              ${JSON.stringify(refitResult.params_json)}::jsonb,
              ${refitResult.bar_count},
              ${refitResult.fit_duration_ms},
              NOW()
            )
            ON CONFLICT (symbol, fit_date) DO UPDATE
              SET params_json = EXCLUDED.params_json,
                  bar_count   = EXCLUDED.bar_count,
                  fit_duration_ms = EXCLUDED.fit_duration_ms
          `,
        );

        await insertAuditRow({
          action: "hmm_regime.model_refitted",
          entityType: "regime_hmm_model",
          entityId: `${sym}-${refitResult.fit_date}`,
          decisionAuthority: "system",
          status: "success",
          result: {
            symbol: sym,
            fit_date: refitResult.fit_date,
            bar_count: refitResult.bar_count,
            fit_duration_ms: refitResult.fit_duration_ms,
          },
        });

        logger.info(
          { symbol: sym, fitDate: refitResult.fit_date, barCount: refitResult.bar_count, durationMs: refitResult.fit_duration_ms },
          "hmm-regime-weekly-refit: model saved",
        );
      } catch (symErr) {
        logger.warn({ symbol: sym, err: symErr }, "hmm-regime-weekly-refit: symbol failed — skipping (fail-open)");
      }
    }
  });

  // Sunday 17:00 ET = 21:00 or 22:00 UTC (EDT/EST); fire at both UTC hours on Sunday.
  cron.schedule("0 21,22 * * 0", async () => {
    if (!_tryAcquireJobLock("hmm-regime-weekly-refit")) return;
    try {
    const now = new Date();
    const etStr = now.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
      weekday: "short",
    });
    const etHour = parseInt(etStr.match(/(\d+)$/)?.[1] ?? "0", 10);
    if (!etStr.startsWith("Sun") || etHour !== 17) return;
    if (!(await pipelineGate("hmm-regime-weekly-refit"))) return;
    logger.info("Scheduler: HMM regime weekly refit (Sunday 17:00 ET)");
    const t0hmm = Date.now();
    await withRetry("hmm-regime-weekly-refit", SCHEDULER_JOBS["hmm-regime-weekly-refit"].run);
    markJobRun("hmm-regime-weekly-refit");
    emitJobComplete("hmm-regime-weekly-refit", Date.now() - t0hmm);
  } finally { _releaseJobLock("hmm-regime-weekly-refit"); }
  });
  _scheduledJobs.add("hmm-regime-weekly-refit");

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
    if (!_tryAcquireJobLock("disabled-job-probe")) return;
    try {
    const t0probe = Date.now();
    await withRetry("disabled-job-probe", SCHEDULER_JOBS["disabled-job-probe"].run, 1);
    markJobRun("disabled-job-probe");
    emitJobComplete("disabled-job-probe", Date.now() - t0probe);
  } finally { _releaseJobLock("disabled-job-probe"); }
  });
  _scheduledJobs.add("disabled-job-probe");

  // ─── Subsystem metrics collection — every 30 minutes ──────
  registerJob("metrics-collector", 30 * 60 * 1000, async () => {
    const { collectAllMetrics } = await import("./services/subsystem-metrics-service.js");
    await collectAllMetrics();
  });

  cron.schedule("*/30 * * * *", async () => {
    if (!_tryAcquireJobLock("metrics-collector")) return;
    try {
    const t0metrics = Date.now();
    await withRetry("metrics-collector", SCHEDULER_JOBS["metrics-collector"].run);
    markJobRun("metrics-collector");
    emitJobComplete("metrics-collector", Date.now() - t0metrics);
  } finally { _releaseJobLock("metrics-collector"); }
  });
  _scheduledJobs.add("metrics-collector");

  // ─── Scout funnel snapshot — daily at 1 AM ET ────────────────
  registerJob("funnel-snapshot", 24 * 60 * 60 * 1000, async () => {
    const { recordFunnelSnapshot } = await import("./services/funnel-metrics-service.js");
    await recordFunnelSnapshot();
  });

  cron.schedule("0 1 * * *", async () => {
    if (!_tryAcquireJobLock("funnel-snapshot")) return;
    try {
    if (!(await pipelineGate("funnel-snapshot"))) return;
    const t0funnel = Date.now();
    await withRetry("funnel-snapshot", SCHEDULER_JOBS["funnel-snapshot"].run);
    markJobRun("funnel-snapshot");
    emitJobComplete("funnel-snapshot", Date.now() - t0funnel);
  } finally { _releaseJobLock("funnel-snapshot"); }
  });
  _scheduledJobs.add("funnel-snapshot");

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
    if (!_tryAcquireJobLock("n8n-health-check")) return;
    try {
    const t0n8nHealth = Date.now();
    await withRetry("n8n-health-check", SCHEDULER_JOBS["n8n-health-check"].run, 1);
    markJobRun("n8n-health-check");
    emitJobComplete("n8n-health-check", Date.now() - t0n8nHealth);
  } finally { _releaseJobLock("n8n-health-check"); }
  });
  _scheduledJobs.add("n8n-health-check");

  // ─── Resource utilization snapshot — every 5 minutes ──────
  registerJob("resource-snapshot", 5 * 60 * 1000, async () => {
    const { collectResourceMetrics } = await import("./services/resource-tracker.js");
    await collectResourceMetrics();
  });

  cron.schedule("*/5 * * * *", async () => {
    if (!_tryAcquireJobLock("resource-snapshot")) return;
    try {
    const t0res = Date.now();
    await withRetry("resource-snapshot", SCHEDULER_JOBS["resource-snapshot"].run);
    markJobRun("resource-snapshot");
    emitJobComplete("resource-snapshot", Date.now() - t0res);
  } finally { _releaseJobLock("resource-snapshot"); }
  });
  _scheduledJobs.add("resource-snapshot");

  // ─── Session analytics nightly rollup — 11:45 PM ET daily ──
  registerJob("session-analytics-rollup", 24 * 60 * 60 * 1000, async () => {
    const { recordSessionAnalyticsRollup } = await import("./services/session-analytics-service.js");
    await recordSessionAnalyticsRollup();
  });

  cron.schedule("45 3 * * *", async () => {
    if (!_tryAcquireJobLock("session-analytics-rollup")) return;
    try { // 3:45 AM UTC = 11:45 PM ET
    const t0sa = Date.now();
    await withRetry("session-analytics-rollup", SCHEDULER_JOBS["session-analytics-rollup"].run);
    markJobRun("session-analytics-rollup");
    emitJobComplete("session-analytics-rollup", Date.now() - t0sa);
  } finally { _releaseJobLock("session-analytics-rollup"); }
  });
  _scheduledJobs.add("session-analytics-rollup");

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
    if (!_tryAcquireJobLock("graveyard-pattern-extraction")) return;
    try {
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
  } finally { _releaseJobLock("graveyard-pattern-extraction"); }
  });
  _scheduledJobs.add("graveyard-pattern-extraction");

  // ─── Nightly critique — daily 11:30 PM ET ─────────────────────
  // Closes the AI self-learning loop: reads system_journal entries from the past
  // 24 h, asks the LLM to extract failure patterns, writes per-entry analyst
  // notes and a lesson summary into system_parameters (consumed by the next
  // generation cycle).  n8n workflow `9A-nightly-self-critique` runs the
  // *generation-side* learning loop; this in-process job keeps the journal-side
  // critique alive so n8n outage does not silently drop the daily review.
  // Documented in scheduler header (line 6) but never registered until
  // 2026-04-30 integration audit.
  // Pipeline gate: HONOURS pause (research, not safety).
  registerJob("nightly-critique", 24 * 60 * 60 * 1000, async () => {
    const { runNightlyCritique } = await import("./services/nightly-critique-service.js");
    await runNightlyCritique();
  });

  // 03:30 + 04:30 UTC covers 11:30 PM ET in both EDT (UTC-4) and EST (UTC-5).
  cron.schedule("30 3,4 * * *", async () => {
    if (!_tryAcquireJobLock("nightly-critique")) return;
    try {
    const now = new Date();
    const etHour = Number(
      now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
    );
    if (etHour !== 23) return;
    if (!(await pipelineGate("nightly-critique"))) return;
    logger.info("Scheduler: Nightly critique (11:30 PM ET daily)");
    const t0nc = Date.now();
    await withRetry("nightly-critique", SCHEDULER_JOBS["nightly-critique"].run);
    markJobRun("nightly-critique");
    emitJobComplete("nightly-critique", Date.now() - t0nc);
  } finally { _releaseJobLock("nightly-critique"); }
  });
  _scheduledJobs.add("nightly-critique");

  // ─── Critic feedback — weekly Sunday 1 AM ET ──────────────────
  registerJob("critic-feedback", 7 * 24 * 60 * 60 * 1000, async () => {
    const { evaluateCriticAccuracy } = await import("./services/critic-feedback-service.js");
    await evaluateCriticAccuracy();
  });

  // Run at 5:00 and 6:00 UTC on Sundays to cover EDT (UTC-4) and EST (UTC-5) for 1 AM ET.
  cron.schedule("0 5,6 * * 0", async () => {
    if (!_tryAcquireJobLock("critic-feedback")) return;
    try {
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
  } finally { _releaseJobLock("critic-feedback"); }
  });
  _scheduledJobs.add("critic-feedback");

  // ─── B4 W13: Regen auto-trigger daily sweep — 2 AM ET daily ─────────────
  // Sweeps all DECLINING strategies that have not had a regen attempt in the
  // last 7 days and auto-spawns evolveStrategy() for each.
  // Covers ALL DECLINING entry paths: checkAutoDemotions (DEPLOYED→DECLINING),
  // manual lifecycle PATCH, PAPER→DECLINING drift, TESTING→DECLINING failure.
  // checkAutoDemotions already fires evolveStrategy() immediately on demotion;
  // this sweep is the safety net for strategies that arrived via other paths
  // or where the initial fire-and-forget was lost (e.g. crash, circuit open).
  // Guards: pipeline pause, 7-day cooldown, max-generation, per-strategy error isolation.
  registerJob("regen-declining-sweep", 24 * 60 * 60 * 1000, async () => {
    const { checkDeclingAndTriggerRegen } = await import("./services/critic-feedback-service.js");
    await checkDeclingAndTriggerRegen({ correlationId: randomUUID() });
  });

  // Run at 6:05 and 7:05 UTC daily to cover EDT (UTC-4) and EST (UTC-5) for 2:05 AM ET.
  // Track C F-5: staggered by +5 min from decay-monitor (0 6,7) which fires at
  // the top of the hour for 2:00 AM ET. Same fire-window, different minute.
  cron.schedule("5 6,7 * * *", async () => {
    if (!_tryAcquireJobLock("regen-declining-sweep")) return;
    try {
    const now = new Date();
    const etHour = Number(
      now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
    );
    if (etHour !== 2) return;
    if (!(await pipelineGate("regen-declining-sweep"))) return;
    logger.info("Scheduler: Regen declining sweep (2 AM ET daily)");
    const t0regen = Date.now();
    await withRetry("regen-declining-sweep", SCHEDULER_JOBS["regen-declining-sweep"].run);
    markJobRun("regen-declining-sweep");
    emitJobComplete("regen-declining-sweep", Date.now() - t0regen);
  } finally { _releaseJobLock("regen-declining-sweep"); }
  });
  _scheduledJobs.add("regen-declining-sweep");

  // ─── Prompt A/B test resolution — weekly Sunday 11 PM ET ──
  registerJob("prompt-ab-resolution", 7 * 24 * 60 * 60 * 1000, async () => {
    const { resolveAbTests } = await import("./services/prompt-evolution-service.js");
    await resolveAbTests();
  });

  cron.schedule("0 23 * * 0", async () => {
    if (!_tryAcquireJobLock("prompt-ab-resolution")) return;
    try {
    if (!(await pipelineGate("prompt-ab-resolution"))) return;
    const t0pab = Date.now();
    await withRetry("prompt-ab-resolution", SCHEDULER_JOBS["prompt-ab-resolution"].run);
    markJobRun("prompt-ab-resolution");
    emitJobComplete("prompt-ab-resolution", Date.now() - t0pab);
  } finally { _releaseJobLock("prompt-ab-resolution"); }
  });
  _scheduledJobs.add("prompt-ab-resolution");

  // ─── B1 (W9): Databento weekly refresh — Sunday 9 PM ET ─────────────────
  // Incremental update of data_cache/<SYMBOL>/<timeframe>.parquet files.
  // Fetches only the date range from (last cached bar + 1 day) → today.
  // Atomic writes; never leaves half-written parquet files.
  //
  // isActive() guard: data refresh is a research-pipeline operation.
  // It can safely skip if the pipeline is paused or in vacation mode.
  //
  // Run at 1:00 and 2:00 UTC on Mondays to cover EDT (UTC-4) and EST (UTC-5)
  // for Sunday 9 PM ET (21:00). Mirrors the graveyard-pattern-extraction pattern.
  registerJob("databento-weekly-refresh", 7 * 24 * 60 * 60 * 1000, async () => {
    const { spawn } = await import("child_process");
    const { resolve: pathResolve } = await import("path");
    const { fileURLToPath: fturl } = await import("url");
    const scriptPath = pathResolve(
      pathResolve(fturl(import.meta.url), "../../.."),
      "scripts/refresh-databento.mjs"
    );
    await new Promise<void>((res, rej) => {
      const proc = spawn(process.execPath, [scriptPath, "--execute"], {
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      // Deep-scan #5 M2 (2026-06-29): explicit kill timeout so a hung child doesn't hold the
      // job lock until the 30-min MAX_JOB_DURATION_MS watchdog fires. Mirrors _runN8nDriftAudit.
      const _killTimeoutMs = Number(process.env.DATABENTO_REFRESH_TIMEOUT_MS ?? 20 * 60 * 1000);
      const _killTimer = setTimeout(() => {
        try { proc.kill("SIGTERM"); } catch { /* already exited */ }
        rej(new Error(`databento-weekly-refresh exceeded ${_killTimeoutMs}ms — SIGTERM sent`));
      }, _killTimeoutMs);
      _killTimer.unref?.();
      proc.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
      proc.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
      proc.on("close", (code: number | null) => {
        clearTimeout(_killTimer);
        if (stderr.trim()) logger.debug({ job: "databento-weekly-refresh" }, stderr.slice(0, 2000));
        if (code === 0) {
          logger.info({ job: "databento-weekly-refresh", output: stdout.slice(0, 1000) }, "Databento refresh complete");
          res();
        } else {
          rej(new Error(`refresh-databento.mjs exited ${code}: ${stderr.slice(0, 500)}`));
        }
      });
      proc.on("error", (e) => { clearTimeout(_killTimer); rej(e); });
    });
  });

  // Run at 1:00 and 2:00 UTC on Mondays to cover EDT/EST for Sunday 9 PM ET.
  cron.schedule("0 1,2 * * 1", async () => {
    if (!_tryAcquireJobLock("databento-weekly-refresh")) return;
    try {
    const now = new Date();
    const etStr = now.toLocaleString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "numeric",
      hour12: false,
    });
    // Only fire on Sunday 21:00 ET (which is Mon 01:00 or 02:00 UTC)
    if (!etStr.includes("Sun") || !etStr.includes("21")) return;
    if (!(await pipelineGate("databento-weekly-refresh"))) return;
    logger.info("Scheduler: Databento weekly refresh (Sunday 9 PM ET)");
    const t0dbr = Date.now();
    await withRetry("databento-weekly-refresh", SCHEDULER_JOBS["databento-weekly-refresh"].run);
    markJobRun("databento-weekly-refresh");
    emitJobComplete("databento-weekly-refresh", Date.now() - t0dbr);
  } finally { _releaseJobLock("databento-weekly-refresh"); }
  });
  _scheduledJobs.add("databento-weekly-refresh");

  // ─── A8 (W11): Data Integrity Suite — 4:00 AM ET nightly ────────────────────
  // Runs two complementary check categories:
  //   1. Reconciliation — independent sources should agree (audit_log vs
  //      lifecycle_transitions, paper_trades vs paper_positions, FK integrity,
  //      PAPER strategy session existence)
  //   2. Drift Detection — same inputs should produce same outputs (PSI on
  //      Sharpe / PF / MaxDD distributions via backtest_provenance)
  //
  // isActive() guard: early-exit when pipeline is not ACTIVE (reconciliation
  // against production data only makes sense when the system is running normally).
  //
  // Run at 8:00 and 9:00 UTC to cover EDT (UTC-4) and EST (UTC-5) for 4:00 AM ET.
  // Wrapped in try/catch with logger.error fallback — a suite failure must never
  // crash the scheduler. Findings are written atomically per category.
  registerJob("data-integrity-suite", 24 * 60 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    logger.info({ correlationId, jobName: "data-integrity-suite" }, "cron tick start");
    if (!(await isPipelineActive())) {
      logger.debug({ correlationId }, "data-integrity-suite: pipeline not ACTIVE — skipping");
      return;
    }
    try {
      const { runFullDataIntegritySuite } = await import("./services/data-integrity-service.js");
      const result = await runFullDataIntegritySuite();
      logger.info(
        {
          correlationId,
          totalFindings: result.totalFindings,
          criticalCount: result.criticalCount,
          warningCount: result.warningCount,
          reconciliationCount: result.reconciliationFindings.length,
          driftCount: result.driftFindings.length,
          durationMs: result.durationMs,
        },
        "data-integrity-suite: completed",
      );
    } catch (err: unknown) {
      logger.error({ err, correlationId }, "data-integrity-suite: suite threw unexpected error");
    }
  });

  // Track C F-5: staggered to :07 past hour to avoid collision with
  // system-map-drift (0 8,9) which also fires at the top of the hour at 4 AM ET.
  cron.schedule("7 8,9 * * *", async () => {
    if (!_tryAcquireJobLock("data-integrity-suite")) return;
    try {
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
    // Only fire at exactly 4:07 AM ET (staggered from system-map-drift at 4:00)
    if (etHour !== 4 || etMin !== 7) {
      logger.debug({ etHour, etMin }, "Scheduler: data-integrity-suite cron fired but not 4:07 AM ET — skipping");
      return;
    }
    if (!(await pipelineGate("data-integrity-suite"))) return;
    logger.info("Scheduler: Data Integrity Suite (4:00 AM ET)");
    const t0di = Date.now();
    await withRetry("data-integrity-suite", SCHEDULER_JOBS["data-integrity-suite"].run);
    markJobRun("data-integrity-suite");
    emitJobComplete("data-integrity-suite", Date.now() - t0di);
  } finally { _releaseJobLock("data-integrity-suite"); }
  });
  _scheduledJobs.add("data-integrity-suite");

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
    if (!_tryAcquireJobLock("contract-roll-sweep")) return;
    try {
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
  } finally { _releaseJobLock("contract-roll-sweep"); }
  });
  _scheduledJobs.add("contract-roll-sweep");

  // ─── Tournament staleness alarm — every 6 hours ──────────────
  // The 4-role tournament (Proposer → Critic → Prosecutor → Promoter) lives in
  // n8n. If n8n is down, no tournament_results rows are written and the in-process
  // Node loop bypasses the tournament gate (CLAUDE.md acknowledges). This job
  // detects the silent failure mode by alarming when the latest tournament_results
  // row is older than the staleness threshold.
  registerJob("tournament-staleness-check", 6 * 60 * 60 * 1000, async () => {
    await checkTournamentStaleness();
  });

  // Track C F-5: staggered to ":03" past every 6h to avoid colliding with
  // lifecycle-auto-check (0 */6) which also fired at the same minute boundary.
  cron.schedule("3 */6 * * *", async () => {
    if (!_tryAcquireJobLock("tournament-staleness-check")) return;
    try {
    const t0tourn = Date.now();
    await withRetry("tournament-staleness-check", SCHEDULER_JOBS["tournament-staleness-check"].run, 1);
    markJobRun("tournament-staleness-check");
    emitJobComplete("tournament-staleness-check", Date.now() - t0tourn);
  } finally { _releaseJobLock("tournament-staleness-check"); }
  });
  _scheduledJobs.add("tournament-staleness-check");

  // ─── C1 (W15): CME exchange status poll — every 60 seconds ─────────────────
  // Probes CME status endpoint every 60s. On outage: blocks new entries,
  // logs open positions (not closed), fires critical alert.
  // On resume: lifts block; does NOT auto-reissue queued orders (manual review).
  // Pipeline pause guard: NOT applied — outage is a safety signal, not a trading signal.
  // Startup reconciliation: called once on init (deferred 3s) to re-hydrate state.
  registerJob("cme-status-poll", 60 * 1000, async () => {
    const { pollCmeStatus } = await import("./services/exchange-status-service.js");
    await pollCmeStatus();
  });

  cron.schedule("* * * * *", async () => {
    if (!_tryAcquireJobLock("cme-status-poll")) return;
    try {
    const t0cme = Date.now();
    await withRetry("cme-status-poll", SCHEDULER_JOBS["cme-status-poll"].run, 1);
    markJobRun("cme-status-poll");
    emitJobComplete("cme-status-poll", Date.now() - t0cme);
  } finally { _releaseJobLock("cme-status-poll"); }
  });
  _scheduledJobs.add("cme-status-poll");

  // Startup: reconcile any outages that were active before restart
  setTimeout(() => {
    import("./services/exchange-status-service.js").then(({ reconcileOutageState }) => {
      reconcileOutageState().catch((err: unknown) => logger.warn({ err }, "scheduler startup: exchange outage reconciliation failed"));
    }).catch((err: unknown) => logger.warn({ err }, "scheduler startup: exchange-status-service import failed"));
  }, 3_000);

  // ─── C2 (W15): Prop firm health check — every 15 minutes ────────────────────
  // Pings each configured prop firm API. On auth failure or "suspended" response:
  // fires high-severity alert, blocks new orders for that firm via paper engine.
  // Startup reconciliation: re-hydrates suspension state from last DB check.
  registerJob("prop-firm-health-check", 15 * 60 * 1000, async () => {
    const { pollPropFirmHealth } = await import("./services/prop-firm-health-service.js");
    await pollPropFirmHealth();
  });

  cron.schedule("*/15 * * * *", async () => {
    if (!_tryAcquireJobLock("prop-firm-health-check")) return;
    try {
    const t0pfh = Date.now();
    await withRetry("prop-firm-health-check", SCHEDULER_JOBS["prop-firm-health-check"].run, 1);
    markJobRun("prop-firm-health-check");
    emitJobComplete("prop-firm-health-check", Date.now() - t0pfh);
  } finally { _releaseJobLock("prop-firm-health-check"); }
  });
  _scheduledJobs.add("prop-firm-health-check");

  // Startup: reconcile suspension state from DB
  setTimeout(() => {
    import("./services/prop-firm-health-service.js").then(({ reconcileSuspensionState }) => {
      reconcileSuspensionState().catch((err: unknown) => logger.warn({ err }, "scheduler startup: prop firm suspension reconciliation failed"));
    }).catch((err: unknown) => logger.warn({ err }, "scheduler startup: prop-firm-health-service import failed"));
  }, 4_000);

  // ─── C2 (W15): Dashboard snapshot — every hour ───────────────────────────────
  // Captures Playwright screenshots of prop firm dashboards for payout dispute evidence.
  // Skips gracefully when Playwright is not installed or no session cookies configured.
  registerJob("prop-firm-dashboard-snapshot", 60 * 60 * 1000, async () => {
    const { runDashboardSnapshots } = await import("./services/dashboard-snapshot-service.js");
    await runDashboardSnapshots();
  });

  cron.schedule("5 * * * *", async () => {
    if (!_tryAcquireJobLock("prop-firm-dashboard-snapshot")) return;
    try { // 5 min past each hour to stagger from other hourly jobs
    const t0snap = Date.now();
    await withRetry("prop-firm-dashboard-snapshot", SCHEDULER_JOBS["prop-firm-dashboard-snapshot"].run, 1);
    markJobRun("prop-firm-dashboard-snapshot");
    emitJobComplete("prop-firm-dashboard-snapshot", Date.now() - t0snap);
  } finally { _releaseJobLock("prop-firm-dashboard-snapshot"); }
  });
  _scheduledJobs.add("prop-firm-dashboard-snapshot");

  // ─── Wave 23 Gap-Fix-B: Bias engine session-start — 9:30 AM ET weekdays ────
  //
  // DST-aware double-fire: fires at 13:30 UTC (EDT, UTC-4) AND 14:30 UTC (EST, UTC-5).
  // ET hour+minute check ensures only one fires per day.
  //
  // NOT pipeline-gated: bias computation is a safety/observability input —
  // the lifecycle gate and paper signal service read bias state at decision time.
  // Pausing the pipeline must not suppress bias signals.
  //
  // Calls computeBiasForAllSymbols() for all 3 symbols (MES/MNQ/MCL) in parallel.
  // Failures are fail-open per-symbol: a symbol error returns a stub; others proceed.
  registerJob("bias-engine-session-start", 24 * 60 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    const today = new Date().toISOString().slice(0, 10);
    logger.info({ correlationId, jobName: "bias-engine-session-start", sessionDate: today }, "cron tick start");
    const results = await computeBiasForAllSymbols(today, correlationId, false);
    const symbolCount = Object.keys(results).length;
    logger.info({ correlationId, sessionDate: today, symbolCount }, "bias-engine-session-start: bias computed for all symbols");
    broadcastSSE("bias_engine:session_start", {
      sessionDate: today,
      correlationId,
      symbolCount,
      symbols: Object.keys(results),
      timestamp: new Date().toISOString(),
    });
  });

  // 9:30 AM ET = 13:30 UTC (EDT) or 14:30 UTC (EST) — fire both, filter on ET
  cron.schedule("30 13,14 * * 1-5", async () => {
    if (!_tryAcquireJobLock("bias-engine-session-start")) return;
    try {
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
    if (etHour !== 9 || etMin !== 30) {
      logger.debug({ etHour, etMin, utcHour: now.getUTCHours() }, "Scheduler: bias-engine-session-start cron fired but not 9:30 AM ET — skipping");
      return;
    }
    // NOT pipeline-gated (safety/observability)
    logger.info("Scheduler: Bias engine session-start (9:30 AM ET confirmed)");
    const t0bias = Date.now();
    await withRetry("bias-engine-session-start", SCHEDULER_JOBS["bias-engine-session-start"].run);
    markJobRun("bias-engine-session-start");
    emitJobComplete("bias-engine-session-start", Date.now() - t0bias);
  } finally { _releaseJobLock("bias-engine-session-start"); }
  });
  _scheduledJobs.add("bias-engine-session-start");

  // ─── W23H.2: Pre-market routine — 8:30 AM ET (12:00 UTC EDT / 13:00 UTC EST) ─
  //
  // Fires every hour; hour-gate restricts execution to UTC 12 or 13 only.
  // W23F.U UTC-date idempotency: check audit_log for 'pre_market_routine.completed'
  // rows with today's session_date prefix before running — skip if already ran.
  // Per-symbol sequential execution to limit concurrent DB load.
  // Fail-open: per-symbol errors logged + errored audit; other symbols proceed.
  // NOT pipeline-gated: pre-market context is a safety/observability input.
  registerJob("pre-market-routine", 60 * 60 * 1000, async () => {
    const nowUtc = new Date();
    const hourUtc = nowUtc.getUTCHours();
    // 8:30 AM ET = 12:00 UTC (EDT, Mar-Nov) or 13:00 UTC (EST, Nov-Mar)
    if (hourUtc !== 12 && hourUtc !== 13) {
      return; // wrong hour — skip tick
    }

    const sessionDate = nowUtc.toISOString().slice(0, 10);
    const correlationId = randomUUID();

    // W23F.U-style UTC-date idempotency: skip if any symbol completed today
    const startOfDay = new Date(`${sessionDate}T00:00:00Z`);
    const { sql: _sql } = await import("drizzle-orm");
    const alreadyRanCount = await db
      .select({ n: _sql<number>`COUNT(*)::int` })
      .from(auditLog)
      .where(
        and(
          _sql`action = 'pre_market_routine.completed'`,
          gte(auditLog.createdAt, startOfDay),
          _sql`result->>'session_date' = ${sessionDate}`,
        ),
      );

    if ((alreadyRanCount[0]?.n ?? 0) > 0) {
      await db.insert(auditLog).values({
        action: "pre_market_routine.skipped_already_ran_today",
        entityId: null,
        entityType: "pre_market_session",
        result: { session_date: sessionDate, hour_utc: hourUtc },
        status: "success",
        decisionAuthority: "scheduler",
        correlationId,
      });
      logger.info({ sessionDate, hourUtc, correlationId }, "pre-market-routine: already ran today — skipping");
      return;
    }

    logger.info({ sessionDate, hourUtc, correlationId }, "pre-market-routine: firing once-daily run");

    const { BIAS_SYMBOLS } = await import("./services/bias-state-service.js");
    const { runPreMarketRoutine } = await import("./services/pre-market-routine.js");

    await db.insert(auditLog).values({
      action: "pre_market_routine.started",
      entityId: null,
      entityType: "pre_market_session",
      result: { session_date: sessionDate, symbols: [...BIAS_SYMBOLS] },
      status: "pending",
      decisionAuthority: "scheduler",
      correlationId,
    });

    // Sequential per-symbol execution to limit concurrent DB load
    for (const symbol of BIAS_SYMBOLS) {
      try {
        const result = await runPreMarketRoutine(symbol, sessionDate, correlationId);
        logger.info(
          { symbol, sessionDate, rowId: result.rowId, fieldsPopulatedCount: result.fieldsPopulated.length },
          "pre-market-routine: symbol completed",
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error({ err: errMsg, symbol, sessionDate, correlationId }, "pre-market-routine: symbol errored");
        await db.insert(auditLog).values({
          action: "pre_market_routine.errored",
          entityId: null,
          entityType: "pre_market_session",
          result: { session_date: sessionDate, symbol, error: errMsg },
          status: "failure",
          errorMessage: errMsg,
          decisionAuthority: "scheduler",
          correlationId,
        }).catch(() => { /* audit insert failure must not propagate */ });
        // Fail-open: continue to next symbol
      }
    }
  });

  // ─── Track C F-2: cron driver for pre-market-routine ───────────────────
  // registerJob above was historically present without a matching
  // cron.schedule — pre-market context only computed via reconcileMissedRuns
  // on each boot. Hourly UTC tick; inner hour-gate (12 or 13 UTC) restricts
  // execution to 8:30 AM ET (DST-aware); audit-log idempotency limits to one
  // run per UTC day.
  cron.schedule("0 * * * *", async () => {
    if (!_tryAcquireJobLock("pre-market-routine")) return;
    try {
      // NOT pipeline-gated: pre-market context is a safety/observability input
      const t0 = Date.now();
      await withRetry("pre-market-routine", SCHEDULER_JOBS["pre-market-routine"].run, 1);
      markJobRun("pre-market-routine");
      emitJobComplete("pre-market-routine", Date.now() - t0);
    } finally {
      _releaseJobLock("pre-market-routine");
    }
  });
  _scheduledJobs.add("pre-market-routine");

  // ─── Wave 23 Gap-Fix-B: Bias engine 10:00 AM ET refresh — weekdays ─────────
  //
  // DST-aware double-fire: 14:00 UTC (EDT) AND 15:00 UTC (EST).
  // ET hour+minute check ensures only one fires per day.
  //
  // Calls computeBiasForAllSymbols() with forceRefresh=true. The refresh
  // re-runs compute_bias() with enriched intraday SessionContext (opening
  // range, overnight bias, NY killzone active) from the first 30-min bar.
  //
  // FAIL-OPEN: on refresh failure, the 9:30 row is preserved as authoritative.
  // Refresh errors are logged as warnings, never fatal.
  //
  // NOT pipeline-gated: bias refresh is a safety/observability input.
  registerJob("bias-engine-refresh-10am-et", 24 * 60 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    const today = new Date().toISOString().slice(0, 10);
    logger.info({ correlationId, jobName: "bias-engine-refresh-10am-et", sessionDate: today }, "cron tick start");
    try {
      const results = await computeBiasForAllSymbols(today, correlationId, true);
      const symbolCount = Object.keys(results).length;
      logger.info(
        { correlationId, sessionDate: today, symbolCount, forceRefresh: true },
        "bias-engine-refresh-10am-et: intraday refresh complete — 9:30 rows remain authoritative on partial failure",
      );
      broadcastSSE("bias_engine:refreshed", {
        sessionDate: today,
        correlationId,
        symbolCount,
        symbols: Object.keys(results),
        forceRefresh: true,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      // Fail-open: refresh failure must never drop the 9:30 session-start row.
      // The 9:30 bias state remains authoritative for this session.
      logger.warn(
        { err, correlationId, sessionDate: today },
        "bias-engine-refresh-10am-et: refresh threw — 9:30 row preserved as authoritative (fail-open)",
      );
    }
  });

  // 10:00 AM ET = 14:00 UTC (EDT) or 15:00 UTC (EST) — fire both, filter on ET
  cron.schedule("0 14,15 * * 1-5", async () => {
    if (!_tryAcquireJobLock("bias-engine-refresh-10am-et")) return;
    try {
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
    if (etHour !== 10 || etMin !== 0) {
      logger.debug({ etHour, etMin, utcHour: now.getUTCHours() }, "Scheduler: bias-engine-refresh-10am-et cron fired but not 10:00 AM ET — skipping");
      return;
    }
    // NOT pipeline-gated (safety/observability)
    logger.info("Scheduler: Bias engine 10:00 AM ET intraday refresh confirmed");
    const t0biasRefresh = Date.now();
    await withRetry("bias-engine-refresh-10am-et", SCHEDULER_JOBS["bias-engine-refresh-10am-et"].run, 1);
    markJobRun("bias-engine-refresh-10am-et");
    emitJobComplete("bias-engine-refresh-10am-et", Date.now() - t0biasRefresh);
  } finally { _releaseJobLock("bias-engine-refresh-10am-et"); }
  });
  _scheduledJobs.add("bias-engine-refresh-10am-et");

  // ─── Wave 23D: Harsh-regime phase activation check — daily 03:00 UTC ────────
  //
  // Queries lifecycle_transitions for the earliest to_state='PAPER' row.
  // If that row is >= 90 days old: flips the harsh_regime_phase singleton
  // from "advisory" to "hard", fires a critical Discord alert, and emits
  // lifecycle:gate_evaluated SSE.
  //
  // The 90-day clock starts at first PAPER promotion — not at system boot.
  // As of 2026-05-19, no strategies are at PAPER state; clock not started.
  //
  // Phase flip is idempotent: if already "hard", this is a pure no-op.
  // NOT pipeline-gated: the activation check must run regardless of pause state
  // (the gate protects production strategies, not research pipeline throughput).
  registerJob("harsh-regime-phase-activation-check", 24 * 60 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    logger.info({ correlationId, jobName: "harsh-regime-phase-activation-check" }, "cron tick start");

    // 1. Read current phase — fail-open (getPhase() returns "advisory" on DB error)
    const currentPhase = await getPhase();
    if (currentPhase === "hard") {
      logger.debug({ correlationId }, "harsh-regime-phase-activation-check: phase already hard — no-op");
      return;
    }

    // 2. Query lifecycle_transitions for the earliest to_state='PAPER' created_at
    //    (NOT strategies.activated_at — that column does not exist)
    let earliestPaperActivation: Date | null = null;
    let firstStrategyId: string | null = null;
    try {
      const [row] = await db
        .select({
          earliest: min(lifecycleTransitions.createdAt),
          strategyId: lifecycleTransitions.strategyId,
        })
        .from(lifecycleTransitions)
        .where(eq(lifecycleTransitions.toState, "PAPER"))
        .limit(1);

      if (row?.earliest) {
        earliestPaperActivation = new Date(row.earliest as unknown as string | number | Date);
        firstStrategyId = row.strategyId ?? null;
      }
    } catch (err) {
      logger.warn({ err, correlationId }, "harsh-regime-phase-activation-check: DB query failed — skipping this tick");
      return;
    }

    // 3. Clock not started — no PAPER activations yet
    if (!earliestPaperActivation || !firstStrategyId) {
      logger.info(
        { correlationId },
        "harsh-regime-phase-activation-check: no PAPER activations found — clock not started (advisory phase continues)",
      );
      return;
    }

    // 4. Compute age
    const ageDays = Math.floor((Date.now() - earliestPaperActivation.getTime()) / (24 * 60 * 60 * 1000));
    const THRESHOLD_DAYS = 90;
    const daysRemaining = THRESHOLD_DAYS - ageDays;

    if (ageDays < THRESHOLD_DAYS) {
      logger.info(
        {
          correlationId,
          ageDays,
          daysRemaining,
          earliestPaperActivation: earliestPaperActivation.toISOString(),
          firstStrategyId,
        },
        `harsh-regime-phase-activation-check: ${daysRemaining} days remaining until hard activation (advisory phase continues)`,
      );
      return;
    }

    // 5. Threshold met — flip to hard
    logger.info(
      {
        correlationId,
        ageDays,
        earliestPaperActivation: earliestPaperActivation.toISOString(),
        firstStrategyId,
      },
      "harsh-regime-phase-activation-check: 90-day threshold met — flipping to HARD phase",
    );

    const flipResult = await flipPhaseToHard(firstStrategyId, correlationId);

    if (flipResult.flipped) {
      // Critical Discord alert — this is an irreversible gate hardening event
      notifyCritical(
        "Harsh-Regime Gate: ACTIVATED (HARD phase)",
        appendFamilyGradePostscript(
          `The harsh-regime survival gate has been automatically hardened to HARD phase after ${ageDays} days of PAPER activation.\n\nFrom now on, strategies that fail regime survival checks at TESTING→PAPER gate will be BLOCKED (not just warned).\n\nFirst PAPER activation: ${earliestPaperActivation.toISOString()}\nStrategy: ${firstStrategyId}\n\nTo roll back (operator only): POST /api/admin/harsh-regime-phase { "phase": "advisory", "reason": "<explanation>" }`,
          `The system has tightened its strategy approval requirements after ${ageDays} days of operation. Strategies now have to pass stricter market-regime tests before they can trade. This is expected and good — it means the system is maturing.`,
          "No action needed. This is an automatic milestone. Tony is aware.",
        ),
        { ageDays, firstStrategyId, activatedAt: new Date().toISOString(), correlationId },
      );

      // SSE: lifecycle:gate_evaluated (not a strategy-specific event — use system entity)
      broadcastSSE("lifecycle:gate_evaluated", {
        gate: "harsh_regime_phase",
        previousPhase: "advisory",
        newPhase: "hard",
        ageDays,
        firstStrategyId,
        activatedAt: new Date().toISOString(),
        correlationId,
        severity: "critical",
      });

      logger.info(
        { correlationId, ageDays, firstStrategyId },
        "harsh-regime-phase-activation-check: HARD phase activated — Discord alerted, SSE emitted",
      );
    } else {
      // Already hard (idempotent path — should not reach here, covered by early exit above)
      logger.debug({ correlationId, flipResult }, "harsh-regime-phase-activation-check: flip returned flipped=false (already hard)");
    }
  });

  // Daily 03:00 UTC — NOT DST-sensitive (UTC-anchored deliberately, not ET)
  // NOT pipeline-gated (safety/observability — must run when paused)
  cron.schedule("0 3 * * *", async () => {
    if (!_tryAcquireJobLock("harsh-regime-phase-activation-check")) return;
    try {
    logger.info("Scheduler: Harsh-regime phase activation check (03:00 UTC daily)");
    const t0hrp = Date.now();
    await withRetry("harsh-regime-phase-activation-check", SCHEDULER_JOBS["harsh-regime-phase-activation-check"].run, 1);
    markJobRun("harsh-regime-phase-activation-check");
    emitJobComplete("harsh-regime-phase-activation-check", Date.now() - t0hrp);
  } finally { _releaseJobLock("harsh-regime-phase-activation-check"); }
  });
  _scheduledJobs.add("harsh-regime-phase-activation-check");

  logger.info("Scheduler initialized: rolling Sharpe (4h), pre-market prep (6:00 AM ET weekdays), paper-vs-backtest (1h), lifecycle (6h), decay monitor (2:00 AM ET daily), stale-session-check (5m), metrics-heartbeat (60s), pipeline-resume-drain (30s), deepar-train (2:30 AM ET), deepar-predict (6:00 AM ET), deepar-validate (6:30 AM ET), regret-score-fill (11:00 PM ET), agent-health-sweep (2h), portfolio-correlation (daily), meta-parameter-review (monthly), anti-setup-mine (Mon 12AM ET), anti-setup-effectiveness (Mon 12AM ET), dlq-retry (15m), dlq-escalation (1h), idempotency-cleanup (3 AM ET daily), n8n-workflow-sync (2:15 AM ET daily), system-map-drift (4 AM ET daily), compliance-rule-drift (Sun midnight ET weekly), disabled-job-probe (30m), metrics-collector (30m), funnel-snapshot (1 AM ET daily), n8n-health-check (15m), resource-snapshot (5m), session-analytics-rollup (11:45 PM ET daily), graveyard-pattern-extraction (Sun 9 PM ET weekly), critic-feedback (Sun 1 AM ET weekly), regen-declining-sweep (2 AM ET daily — B4 W13), prompt-ab-resolution (Sun 11 PM ET weekly), databento-weekly-refresh (Sun 9 PM ET weekly — B1 W9), data-integrity-suite (4:00 AM ET daily — A8 W11), contract-roll-sweep (4:30 PM ET weekdays — bypasses pipeline gate), tournament-staleness-check (6h), cme-status-poll (60s — C1 W15), prop-firm-health-check (15m — C2 W15), prop-firm-dashboard-snapshot (1h — C2 W15), validation-cadence-monthly (1st of month 3:30 AM UTC — C7 W16, bypasses pipeline gate), bias-engine-session-start (9:30 AM ET weekdays — W23 Gap-Fix-B, NOT pipeline-gated), bias-engine-refresh-10am-et (10:00 AM ET weekdays — W23 Gap-Fix-B, fail-open, NOT pipeline-gated), harsh-regime-phase-activation-check (03:00 UTC daily — W23D, 90-day clock from first PAPER, NOT pipeline-gated), bw-session-refresh (every 6h — W24P1, NOT pipeline-gated), prop-firm-cookie-refresh (every 1h — W24P1, NOT pipeline-gated), weekly-drift-2sigma-check (Sunday 18:00 ET — W24P1, pipeline-gate-EXEMPT W25P2), n8n-drift-detector-weekly (Sunday 19:00 ET — W25P2-A2, pipeline-gate-EXEMPT), n8n-drift-detector-monthly (1st of month 09:00 ET — W25P2-A2, pipeline-gate-EXEMPT), pre-market-briefing-discord (14:00 UTC daily — W25.5d, pipeline-gate-EXEMPT), naked-poc-sync-daily (4:30 PM ET weekdays — W25.6-P3A3, pipeline-gate-EXEMPT), liquidity-map-refresh (every 30min RTH Mon-Fri — W25.6-P3A1, pipeline-gate-EXEMPT), quantum-replay-weekly-analysis (Sunday 19:00 ET — W27P1.5-A2, pipeline-gate-EXEMPT, kill-switch=auto_patch_loop_enabled), strategy-stale-detector (04:00 ET daily — W26PassG-PassD, pipeline-gated, GRAVEYARD-never), candidate-backtest-conveyor (45s — 2026-06-28, pipeline-gated, enqueue-only, MAX_CONCURRENT_BACKTESTS slots)");

  // ─── Wave 24 Pass 1 Item 1: BW session refresh — every 6 hours ────────────────
  // CATASTROPHIC GAP: runBwSessionRefreshCheck existed but had ZERO callers in
  // the scheduler. Vacation Mode promises auto-refresh during operator absence
  // (CLAUDE.md §3) — this wires that promise. NOT pipeline-gated: credential
  // safety signals must fire even when pipeline is paused.
  registerJob("bw-session-refresh", 6 * 60 * 60 * 1000, async () => {
    const cronCorrelationId = randomUUID();
    const { runBwSessionRefreshCheck } = await import("./services/bitwarden-session-refresh-service.js");
    const t0bw = Date.now();
    let outcome: string;
    let error: string | undefined;
    try {
      const result = await runBwSessionRefreshCheck();
      outcome = result.status;
      if (result.status === "failed") {
        error = result.error;
      }
    } catch (err) {
      outcome = "failed";
      error = err instanceof Error ? err.message : String(err);
      logger.error({ err, jobName: "bw-session-refresh", cronCorrelationId }, "bw-session-refresh: unexpected throw from runBwSessionRefreshCheck");
      notifyCritical(
        "BW session refresh cron: unexpected error",
        appendFamilyGradePostscript(
          `runBwSessionRefreshCheck threw unexpectedly. Error: ${error}. BW vault access may degrade.`,
          "The bot failed to refresh its credential vault. If this keeps happening, the bot may lose access to its secure passwords.",
          "Tell Tony: 'The credential refresh job failed.' He will investigate when available.",
        ),
        { error },
      );
    }
    const durationMs = Date.now() - t0bw;
    // Heartbeat audit row — always written so dead-mans can detect staleness
    await insertAuditRow({
      action: outcome === "failed" ? "bw_refresh.failed" : "bw_refresh.heartbeat",
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: { job: "bw-session-refresh" } as Record<string, unknown>,
      result: { status: outcome, duration_ms: durationMs, error: error ?? null } as Record<string, unknown>,
      status: outcome === "failed" ? "failed" : "success",
      correlationId: cronCorrelationId,
    }).catch((auditErr) => logger.error({ auditErr }, "bw-session-refresh: heartbeat audit row write failed"));
  });

  // Wave 24 Item 1: BW refresh exempted from pipeline gate — credential safety
  _PIPELINE_GATE_EXEMPT.add("bw-session-refresh");

  cron.schedule("0 */6 * * *", async () => {
    if (!_tryAcquireJobLock("bw-session-refresh")) return;
    try {
      const t0 = Date.now();
      await withRetry("bw-session-refresh", SCHEDULER_JOBS["bw-session-refresh"].run, 1);
      markJobRun("bw-session-refresh");
      emitJobComplete("bw-session-refresh", Date.now() - t0);
    } finally {
      _releaseJobLock("bw-session-refresh");
    }
  });
  _scheduledJobs.add("bw-session-refresh");

  // ─── Wave 24 Pass 1 Item 1: Prop-firm cookie refresh — every hour ──────────
  // CATASTROPHIC GAP: runPropFirmCookieRefresh existed but had ZERO callers in
  // the scheduler. Vacation Mode promises auto-refresh (CLAUDE.md §3). NOT
  // pipeline-gated: C2 evidence integrity is a safety signal.
  registerJob("prop-firm-cookie-refresh", 60 * 60 * 1000, async () => {
    const cronCorrelationId = randomUUID();
    const { runPropFirmCookieRefresh } = await import("./services/prop-firm-cookie-refresh-service.js");
    const t0cookie = Date.now();
    let report: Awaited<ReturnType<typeof runPropFirmCookieRefresh>> | undefined;
    let error: string | undefined;
    try {
      report = await runPropFirmCookieRefresh();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      logger.error({ err, jobName: "prop-firm-cookie-refresh", cronCorrelationId }, "prop-firm-cookie-refresh: unexpected throw");
      notifyCritical(
        "Prop-firm cookie refresh cron: unexpected error",
        appendFamilyGradePostscript(
          `runPropFirmCookieRefresh threw unexpectedly. Error: ${error}. Firm C2 evidence may be stale.`,
          "The bot failed to refresh its prop firm login session. If this keeps happening, compliance monitoring for the trading account may become stale.",
          "Tell Tony: 'The prop firm session refresh failed.' He will look into it when available.",
        ),
        { error },
      );
    }
    const durationMs = Date.now() - t0cookie;
    const firmsRefreshed = report?.refreshedCount ?? 0;
    const firmsFailed = report?.failedCount ?? 0;
    const outcome = error ? "failed" : firmsFailed > 0 ? "partial" : "success";
    // Heartbeat audit row — always written
    await insertAuditRow({
      action: outcome === "failed" ? "cookie_refresh.failed" : "cookie_refresh.heartbeat",
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: { job: "prop-firm-cookie-refresh" } as Record<string, unknown>,
      result: {
        status: outcome,
        duration_ms: durationMs,
        firms_refreshed: firmsRefreshed,
        firms_failed: firmsFailed,
        error: error ?? null,
      } as Record<string, unknown>,
      status: outcome === "failed" ? "failed" : "success",
      correlationId: cronCorrelationId,
    }).catch((auditErr) => logger.error({ auditErr }, "prop-firm-cookie-refresh: heartbeat audit row write failed"));
  });

  // Wave 24 Item 1: cookie refresh exempted from pipeline gate — safety signal
  _PIPELINE_GATE_EXEMPT.add("prop-firm-cookie-refresh");

  cron.schedule("0 * * * *", async () => {
    if (!_tryAcquireJobLock("prop-firm-cookie-refresh")) return;
    try {
      const t0 = Date.now();
      await withRetry("prop-firm-cookie-refresh", SCHEDULER_JOBS["prop-firm-cookie-refresh"].run, 1);
      markJobRun("prop-firm-cookie-refresh");
      emitJobComplete("prop-firm-cookie-refresh", Date.now() - t0);
    } finally {
      _releaseJobLock("prop-firm-cookie-refresh");
    }
  });
  _scheduledJobs.add("prop-firm-cookie-refresh");

  // ─── Wave 24 Pass 1 Item 15: Weekly drift 2σ auto-HALT — Sunday 18:00 ET ──
  // CLAUDE.md §3 promises auto-HALT on >2σ deviation. Not previously implemented.
  // Pipeline-gated: drift analysis is a research-side guard (production halt
  // is activated by the service itself directly via kill-switch if needed).
  registerJob("weekly-drift-2sigma-check", 7 * 24 * 60 * 60 * 1000, async () => {
    const { runWeeklyDriftHaltCheck } = await import("./services/weekly-drift-halt-service.js");
    const correlationId = randomUUID();
    logger.info({ correlationId, jobName: "weekly-drift-2sigma-check" }, "cron tick start");
    const report = await runWeeklyDriftHaltCheck();
    logger.info(
      { correlationId, checked: report.checked, halted: report.halted, ok: report.ok, errors: report.errors },
      "weekly-drift-2sigma-check: sweep complete",
    );
  });

  // Sunday 18:00 ET = Monday 22:00 UTC (EDT, UTC-4) or 23:00 UTC (EST, UTC-5)
  cron.schedule("0 22,23 * * 1", async () => {
    if (!_tryAcquireJobLock("weekly-drift-2sigma-check")) return;
    try {
      const now = new Date();
      const etStr = now.toLocaleString("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        hour: "numeric",
        hour12: false,
      });
      // Must be Sunday 18:00 ET — cron fires Mon 22/23 UTC which maps to Sun 18:00 ET
      if (!etStr.includes("Sun") || !etStr.includes("18")) {
        logger.debug({ etStr }, "Scheduler: weekly-drift-2sigma-check cron fired but not Sunday 18:00 ET — skipping");
        return;
      }
      // Wave 25 Pass 2 Y-1: defensive log BEFORE pipelineGate — proves the job
      // actually reached this point regardless of pipeline state. The gate is
      // now a no-op (weekly-drift-2sigma-check is in _PIPELINE_GATE_EXEMPT), but
      // this log ensures audit trails always show the job ran even if a future
      // refactor changes the exemption list without updating the handler.
      logger.info({ job: "weekly-drift-2sigma-check" }, "running pipeline-gate-exempt drift check");
      if (!(await pipelineGate("weekly-drift-2sigma-check"))) return;
      logger.info("Scheduler: Weekly drift 2σ check (Sunday 18:00 ET confirmed)");
      const t0wd = Date.now();
      await withRetry("weekly-drift-2sigma-check", SCHEDULER_JOBS["weekly-drift-2sigma-check"].run, 1);
      markJobRun("weekly-drift-2sigma-check");
      emitJobComplete("weekly-drift-2sigma-check", Date.now() - t0wd);
    } finally {
      _releaseJobLock("weekly-drift-2sigma-check");
    }
  });
  _scheduledJobs.add("weekly-drift-2sigma-check");

  // ─── Wave 25 Gap 3: Deployed-strategy signal starvation — every 4h during RTH ─
  // Execution-side mirror of scout-watchdog-service. Checks PILOT/DEPLOYED
  // strategies for zero signal entries or zero signal evaluations over rolling
  // 5 RTH days. RTH gate: only fires when current ET hour is in [9..16).
  registerJob("deployed-strategy-starvation-check", 4 * 60 * 60 * 1000, async () => {
    const { runDeployedStrategyStarvationCheck } = await import(
      "./services/deployed-strategy-starvation-watchdog.js"
    );
    const result = await runDeployedStrategyStarvationCheck();
    logger.info(
      { strategiesChecked: result.strategiesChecked, anyAlertFired: result.anyAlertFired },
      "deployed-strategy-starvation-check: tick complete",
    );
  });

  // Every 4 hours, RTH-gated (09:00–16:00 ET, weekdays)
  cron.schedule("0 */4 * * 1-5", async () => {
    if (!_tryAcquireJobLock("deployed-strategy-starvation-check")) return;
    try {
      const now = new Date();
      const etHour = parseInt(
        now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
        10,
      );
      // Only fire during RTH window (9 AM to 4 PM ET)
      if (etHour < 9 || etHour >= 16) {
        logger.debug({ etHour }, "Scheduler: deployed-strategy-starvation-check — outside RTH, skipping");
        return;
      }
      // Not pipeline-gated: this is a safety surface like scout-watchdog
      const t0 = Date.now();
      await withRetry(
        "deployed-strategy-starvation-check",
        SCHEDULER_JOBS["deployed-strategy-starvation-check"].run,
        1,
      );
      markJobRun("deployed-strategy-starvation-check");
      emitJobComplete("deployed-strategy-starvation-check", Date.now() - t0);
    } finally {
      _releaseJobLock("deployed-strategy-starvation-check");
    }
  });
  _scheduledJobs.add("deployed-strategy-starvation-check");

  // ─── Wave 25 Gap 4: Webhook latency monitor — every 15 min ───────────────────
  // Reads last 1h of webhook.broker_ack audit rows, computes p95 latency.
  // Alarms when p95 > 2000ms (Pine→TradingView→TradersPost→broker path).
  registerJob("webhook-latency-check", 15 * 60 * 1000, async () => {
    const { runWebhookLatencyCheck } = await import(
      "./services/webhook-latency-monitor-service.js"
    );
    const result = await runWebhookLatencyCheck();
    if (result.alarmed) {
      logger.warn(
        { p95Ms: result.percentiles.p95, p50Ms: result.percentiles.p50 },
        "webhook-latency-check: latency threshold exceeded",
      );
    } else {
      logger.debug(
        { p95Ms: result.percentiles.p95, count: result.percentiles.count },
        "webhook-latency-check: within threshold",
      );
    }
  });

  cron.schedule("*/15 * * * *", async () => {
    if (!_tryAcquireJobLock("webhook-latency-check")) return;
    try {
      // Not pipeline-gated: latency monitor is an observability surface
      const t0 = Date.now();
      await withRetry("webhook-latency-check", SCHEDULER_JOBS["webhook-latency-check"].run, 1);
      markJobRun("webhook-latency-check");
      emitJobComplete("webhook-latency-check", Date.now() - t0);
    } finally {
      _releaseJobLock("webhook-latency-check");
    }
  });
  _scheduledJobs.add("webhook-latency-check");

  // ─── Wave 25 Gap 9: Regime coverage check — daily 6 AM ET ────────────────────
  // Verifies each regime in DEPLOYED_REGIME_LIST has ≥1 PILOT/DEPLOYED strategy.
  // NULL preferredRegimes = wildcard (covers all regimes).
  // Alarms when any regime has zero coverage before market open.
  registerJob("regime-coverage-check", 24 * 60 * 60 * 1000, async () => {
    const { runRegimeCoverageCheck } = await import(
      "./services/regime-coverage-monitor-service.js"
    );
    const result = await runRegimeCoverageCheck();
    logger.info(
      { gapRegimes: result.gapRegimes, anyGap: result.anyGap, alertFired: result.alertFired },
      "regime-coverage-check: tick complete",
    );
  });

  // Daily at 6 AM ET = 10:00 UTC (EDT) or 11:00 UTC (EST), weekdays only
  cron.schedule("0 10,11 * * 1-5", async () => {
    if (!_tryAcquireJobLock("regime-coverage-check")) return;
    try {
      const now = new Date();
      const etHourStr = now.toLocaleString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "numeric",
        hour12: false,
      });
      const [etHStr, etMStr] = etHourStr.split(":");
      const etH = parseInt(etHStr, 10);
      const etM = parseInt(etMStr, 10);
      if (etH !== 6 || etM !== 0) {
        logger.debug({ etH, etM }, "Scheduler: regime-coverage-check — not 6:00 AM ET, skipping");
        return;
      }
      // Not pipeline-gated: coverage alarm is a safety surface
      const t0 = Date.now();
      await withRetry("regime-coverage-check", SCHEDULER_JOBS["regime-coverage-check"].run, 1);
      markJobRun("regime-coverage-check");
      emitJobComplete("regime-coverage-check", Date.now() - t0);
    } finally {
      _releaseJobLock("regime-coverage-check");
    }
  });
  _scheduledJobs.add("regime-coverage-check");

  // ─── Wave 25 Pass 2 A-2: n8n drift detector — weekly (Sun 19:00 ET) ─────────
  // Spawns `npm run audit:n8n` as a child process. Captures stdout + stderr +
  // exit code. Writes audit row on every outcome so the operator can see that
  // the check actually ran. Fires Discord CRITICAL when drift is detected or
  // when the spawned process errors / times out.
  //
  // Pipeline-gate-exempt: n8n drift detection is an infrastructure safety signal.
  // An operator may have paused the pipeline because of n8n drift; we cannot
  // suppress the detector that would catch the root cause.
  //
  // Schedule rationale: Sunday 19:00 ET fires ONE HOUR after the weekly-drift-2sigma
  // check (18:00 ET). Two separate observability sweeps per Sunday gives defense-
  // in-depth without overlap. The monthly run (1st of month 09:00 ET) is a
  // secondary confirmatory gate.
  registerJob("n8n-drift-detector-weekly", 7 * 24 * 60 * 60 * 1000, async () => {
    await _runN8nDriftAudit("n8n-drift-detector-weekly");
  });

  // Sun 19:00 ET = Mon 23:00 UTC (EDT, UTC-4) or Mon 00:00 UTC next day (EST, UTC-5).
  // Fire at Mon 23:00 and Tue 00:00 UTC to cover both offsets; ET day+hour guard
  // inside the handler filters to Sunday 19:00 only.
  cron.schedule("0 23 * * 1", async () => {
    if (!_tryAcquireJobLock("n8n-drift-detector-weekly")) return;
    try {
      const now = new Date();
      const etStr = now.toLocaleString("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        hour: "numeric",
        hour12: false,
      });
      if (!etStr.includes("Sun") || !etStr.includes("19")) {
        logger.debug({ etStr }, "Scheduler: n8n-drift-detector-weekly — not Sunday 19:00 ET, skipping");
        return;
      }
      logger.info({ job: "n8n-drift-detector-weekly" }, "running pipeline-gate-exempt n8n drift check (weekly)");
      // _PIPELINE_GATE_EXEMPT — no gate call needed; log confirms it ran
      const t0 = Date.now();
      await withRetry("n8n-drift-detector-weekly", SCHEDULER_JOBS["n8n-drift-detector-weekly"].run, 1);
      markJobRun("n8n-drift-detector-weekly");
      emitJobComplete("n8n-drift-detector-weekly", Date.now() - t0);
    } finally {
      _releaseJobLock("n8n-drift-detector-weekly");
    }
  });
  _scheduledJobs.add("n8n-drift-detector-weekly");

  // ─── Wave 25 Pass 2 A-2: n8n drift detector — monthly (1st of month 09:00 ET) ─
  // Defense-in-depth: monthly confirmatory run. The weekly job is the primary
  // detection surface; the monthly job catches accumulation that slips between
  // weekly windows (e.g. a workflow activated mid-week without errorWorkflow).
  //
  // 09:00 ET on the 1st = 13:00 UTC (EDT) or 14:00 UTC (EST).
  registerJob("n8n-drift-detector-monthly", 30 * 24 * 60 * 60 * 1000, async () => {
    await _runN8nDriftAudit("n8n-drift-detector-monthly");
  });

  // Fire at 13:00 and 14:00 UTC on the 1st of every month to cover EDT/EST.
  // ET day-of-month + hour guard inside handler filters to 09:00 ET on the 1st.
  cron.schedule("0 13,14 1 * *", async () => {
    if (!_tryAcquireJobLock("n8n-drift-detector-monthly")) return;
    try {
      const now = new Date();
      const etStr = now.toLocaleString("en-US", {
        timeZone: "America/New_York",
        day: "numeric",
        hour: "numeric",
        hour12: false,
      });
      // etStr is e.g. "1 9" for 1st of month at 09:00 ET
      const [etDay, etHour] = etStr.split(" ");
      if (etDay !== "1" || etHour !== "9") {
        logger.debug({ etStr }, "Scheduler: n8n-drift-detector-monthly — not 1st of month 09:00 ET, skipping");
        return;
      }
      logger.info({ job: "n8n-drift-detector-monthly" }, "running pipeline-gate-exempt n8n drift check (monthly)");
      const t0 = Date.now();
      await withRetry("n8n-drift-detector-monthly", SCHEDULER_JOBS["n8n-drift-detector-monthly"].run, 1);
      markJobRun("n8n-drift-detector-monthly");
      emitJobComplete("n8n-drift-detector-monthly", Date.now() - t0);
    } finally {
      _releaseJobLock("n8n-drift-detector-monthly");
    }
  });
  _scheduledJobs.add("n8n-drift-detector-monthly");

  // ─── W25.5d: Daily pre-market briefing — 14:00 UTC (09:00 ET DST / 10:00 ET EST) ─
  //
  // Fires hourly; inner hour-gate restricts execution to UTC 14 only.
  // Rationale for 14:00 UTC:
  //   - Pre-market routine fires at 12:00–13:00 UTC (08:30 ET) and populates
  //     pre_market_sessions with written_bias + key levels.
  //   - Briefing fires at 14:00 UTC (09:00 ET DST / 10:00 ET EST) — 30min after
  //     the pre-market routine completes, 30min before market open (EDT) or
  //     coinciding with open (EST). Operator sees bias on phone before first bar.
  //
  // Pipeline-gate EXEMPT: operator wants briefing even during PAUSE —
  //   "trading without written bias" failure mode (Steenbarger/Topstep 2025 #1).
  // Idempotent: W23F.U audit_log pattern — skips if already sent today.
  // Fail-soft: Discord unreachable → logged + audited, never throws.
  registerJob("pre-market-briefing-discord", 60 * 60 * 1000, async () => {
    const nowUtc = new Date();
    const hourUtc = nowUtc.getUTCHours();
    // 09:00 ET = 13:00 UTC (EDT, Mar-Nov) → but our routine needs ~30min buffer,
    // so we fire at 14:00 UTC instead. That's 10:00 ET EDT or 09:00 ET EST.
    // We want a consistent "after pre-market routine, before first significant move"
    // anchor — 14:00 UTC satisfies both DST windows with a 30+ min buffer.
    if (hourUtc !== 14) {
      return; // wrong hour — skip tick
    }

    const sessionDate = nowUtc.toISOString().slice(0, 10);
    const correlationId = randomUUID();
    logger.info({ sessionDate, correlationId, hourUtc }, "pre-market-briefing-discord: tick firing");

    const { sendPreMarketBriefing } = await import("./services/pre-market-briefing-service.js");
    const result = await sendPreMarketBriefing({ date: sessionDate });

    logger.info(
      { sessionDate, correlationId, sent: result.sent, reason: result.reason, symbolsFound: result.symbolsFound },
      "pre-market-briefing-discord: tick complete",
    );
  });

  // NOT pipeline-gated (safety/observability — must run when paused)
  _PIPELINE_GATE_EXEMPT.add("pre-market-briefing-discord");

  cron.schedule("0 * * * *", async () => {
    if (!_tryAcquireJobLock("pre-market-briefing-discord")) return;
    try {
      const t0 = Date.now();
      await withRetry("pre-market-briefing-discord", SCHEDULER_JOBS["pre-market-briefing-discord"].run, 1);
      markJobRun("pre-market-briefing-discord");
      emitJobComplete("pre-market-briefing-discord", Date.now() - t0);
    } finally {
      _releaseJobLock("pre-market-briefing-discord");
    }
  });
  _scheduledJobs.add("pre-market-briefing-discord");

  // ─── W25.6 — Liquidity Map Refresh ──────────────────────────
  // Fires every 30 min during RTH (09:30–16:00 ET, Mon–Fri).
  // Calls refreshSessionLevels() for all 3 symbols to populate/update the
  // persistent liquidity_levels table.
  //
  // Pipeline-gate EXEMPT: levels must populate even when pipeline is PAUSED
  // so the operator can see them in the dashboard and the adaptive exit engine
  // (Pass 7) can consume them regardless of whether new entries are being taken.
  //
  // Idempotent: refreshSessionLevels() uses UPSERT — calling twice = no duplicates.
  // Failure handling: non-fatal — logs + DLQ via withRetry. A missed refresh
  // means levels are slightly stale but the factor fails gracefully.

  registerJob("liquidity-map-refresh", 30 * 60 * 1000, async () => {
    const nowUtc = new Date();

    // RTH guard: Mon–Fri, 13:30–20:00 UTC (09:30–16:00 ET, handles EDT/EST via offset check).
    // We use UTC hours for simplicity; exact DST correction is handled by the ±30min window.
    // EDT: 09:30 ET = 13:30 UTC; 16:00 ET = 20:00 UTC
    // EST: 09:30 ET = 14:30 UTC; 16:00 ET = 21:00 UTC
    // We fire in the union: 13:30–21:00 UTC covers both windows with overlap acceptable.
    const dayOfWeek = nowUtc.getUTCDay(); // 0=Sun, 6=Sat
    if (dayOfWeek === 0 || dayOfWeek === 6) return; // skip weekends

    const hourUtc = nowUtc.getUTCHours();
    const minUtc = nowUtc.getUTCMinutes();
    const totalMinutesUtc = hourUtc * 60 + minUtc;
    // 13:30 = 810 UTC minutes; 21:00 = 1260 UTC minutes
    if (totalMinutesUtc < 810 || totalMinutesUtc >= 1260) return; // outside RTH window

    const sessionDate = nowUtc.toISOString().slice(0, 10);
    const correlationId = randomUUID();

    logger.info(
      { sessionDate, correlationId, totalMinutesUtc },
      "liquidity-map-refresh: tick firing",
    );

    const { refreshSessionLevels } = await import("./services/liquidity-map-service.js");

    let totalAdded = 0;
    for (const symbol of ["MES", "MNQ", "MCL"]) {
      try {
        const result = await refreshSessionLevels(symbol, sessionDate, correlationId);
        totalAdded += result.added;

        await insertAuditRow({
          action: "liquidity_map.session_refreshed",
          entityType: "liquidity_map",
          entityId: `${symbol}:${sessionDate}`,
          correlationId,
          status: "success",
          result: {
            symbol,
            sessionDate,
            added: result.added,
            expired: result.expired,
          },
        }).catch((err) =>
          logger.warn({ err, symbol }, "liquidity-map-refresh: audit insert failed (non-blocking)"),
        );

        logger.info(
          { symbol, sessionDate, added: result.added, expired: result.expired, correlationId },
          "liquidity-map-refresh: symbol complete",
        );
      } catch (err) {
        logger.warn({ err, symbol, sessionDate }, "liquidity-map-refresh: symbol refresh failed (non-blocking)");
      }
    }

    logger.info(
      { sessionDate, correlationId, totalAdded },
      "liquidity-map-refresh: all symbols complete",
    );
  });

  // Pipeline-gate EXEMPT: levels must populate even during PAUSE
  _PIPELINE_GATE_EXEMPT.add("liquidity-map-refresh");

  // Cron driver: every 30 min — "*/30 * * * *"
  cron.schedule("*/30 * * * *", async () => {
    if (!_tryAcquireJobLock("liquidity-map-refresh")) return;
    try {
      const t0 = Date.now();
      await withRetry("liquidity-map-refresh", SCHEDULER_JOBS["liquidity-map-refresh"].run, 1);
      markJobRun("liquidity-map-refresh");
      emitJobComplete("liquidity-map-refresh", Date.now() - t0);
    } finally {
      _releaseJobLock("liquidity-map-refresh");
    }
  });
  _scheduledJobs.add("liquidity-map-refresh");

  // ─── Wave 25 Pass 3 W25.6: naked-poc-sync-daily — 4:30 PM ET weekdays ───────
  //
  // After RTH close, stable session bars are available. Spawns the Python bridge
  // script (scripts/sync_naked_pocs_to_liquidity_map.py) for all 3 VP symbols to
  // persist naked POC levels into the liquidity_levels table via the TS endpoint:
  //   POST /api/admin/liquidity-map/naked-pocs-batch
  //
  // Pipeline-gate EXEMPT: pre-market context levels must populate even when
  // pipeline is paused. Missing a sync silently degrades liquidity_target_clear
  // scoring but must not hold up lifecycle work during operator pause.
  //
  // Idempotent: the TS endpoint UPSERTs on (symbol, session_date, level_type,
  // price) — re-running produces no duplicate rows.
  //
  // Runs at both 20:30 and 21:30 UTC to cover EDT (UTC-4) and EST (UTC-5).
  // ET-hour guard fires only at 16:30 ET, matching contract-roll-sweep cadence.
  //
  // If the TS endpoint has not yet been deployed by P3.A1+A2, the Python script
  // tolerates 404 and exits 0 — no DLQ backpressure until endpoint ships.

  registerJob("naked-poc-sync-daily", 24 * 60 * 60 * 1000, async () => {
    const { spawn } = await import("child_process");

    const symbolsEnv = process.env.VP_SYMBOLS ?? "MES,MNQ,MCL";
    const symbols = symbolsEnv.split(",").map((s: string) => s.trim());

    // Build ISO date in ET for the session we just closed
    const etDateStr = new Date().toLocaleString("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const [mm, dd, yyyy] = etDateStr.split("/");
    const isoDate = `${yyyy}-${mm}-${dd}`;

    const backendUrl =
      process.env.TF_BACKEND_URL ??
      process.env.TF_BACKEND_PUBLIC_URL ??
      "http://localhost:4000";

    for (const sym of symbols) {
      await new Promise<void>((resolve, reject) => {
        const args = [
          "-m", "scripts.sync_naked_pocs_to_liquidity_map",
          "--symbol", sym,
          "--date", isoDate,
          "--apply",
          "--backend-url", backendUrl,
        ];
        const proc = spawn("python", args, {
          cwd: process.cwd(),
          env: { ...process.env as Record<string, string> },
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stdoutBuf = "";
        let stderrBuf = "";
        // Deep-scan #5 M2 (2026-06-29): per-symbol kill timeout so a hung Python child
        // can't hold the job lock until the 30-min watchdog. Per-symbol failure is already
        // non-blocking (caught below), so a SIGTERM here just skips that symbol.
        const _pocKillMs = Number(process.env.NAKED_POC_SYNC_TIMEOUT_MS ?? 5 * 60 * 1000);
        const _pocKillTimer = setTimeout(() => {
          try { proc.kill("SIGTERM"); } catch { /* already exited */ }
          reject(new Error(`naked-poc-sync-daily: ${sym} exceeded ${_pocKillMs}ms — SIGTERM sent`));
        }, _pocKillMs);
        _pocKillTimer.unref?.();
        proc.stdout?.on("data", (d: Buffer) => { stdoutBuf += d.toString(); });
        proc.stderr?.on("data", (d: Buffer) => { stderrBuf += d.toString(); });

        proc.on("close", (code: number | null) => {
          clearTimeout(_pocKillTimer);
          if (code === 0) {
            logger.info(
              { symbol: sym, sessionDate: isoDate, stdout: stdoutBuf.slice(0, 2000) },
              "naked-poc-sync-daily: sync completed",
            );
            resolve();
          } else {
            reject(
              new Error(
                `naked-poc-sync-daily: Python script exited ${code} for ${sym}. ` +
                `stderr=${stderrBuf.slice(0, 500)}`,
              ),
            );
          }
        });

        proc.on("error", (err: Error) => {
          clearTimeout(_pocKillTimer);
          logger.error(
            { symbol: sym, sessionDate: isoDate, err: String(err) },
            "naked-poc-sync-daily: failed to spawn Python process",
          );
          reject(err);
        });
      }).catch((err) => {
        // Per-symbol failure is non-blocking — log and continue with next symbol
        logger.error(
          { symbol: sym, err: String(err) },
          "naked-poc-sync-daily: symbol sync failed — continuing",
        );
      });
    }
  });

  // Pipeline-gate EXEMPT: pre-market context must populate even during PAUSE
  _PIPELINE_GATE_EXEMPT.add("naked-poc-sync-daily");

  // Cron driver: fires at 20:30 and 21:30 UTC weekdays (covers EDT + EST 16:30 ET)
  cron.schedule("30 20,21 * * 1-5", async () => {
    if (!_tryAcquireJobLock("naked-poc-sync-daily")) return;
    try {
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
      if (etHour !== 16 || etMin !== 30) {
        logger.debug(
          { etHour, etMin },
          "Scheduler: naked-poc-sync-daily cron fired but not 16:30 ET — skipping",
        );
        return;
      }
      logger.info("Scheduler: naked-poc-sync-daily (4:30 PM ET)");
      const t0nps = Date.now();
      await withRetry(
        "naked-poc-sync-daily",
        SCHEDULER_JOBS["naked-poc-sync-daily"].run,
        2, // 2 retries — backoff handles transient S3/backend hiccups
      );
      markJobRun("naked-poc-sync-daily");
      emitJobComplete("naked-poc-sync-daily", Date.now() - t0nps);
    } finally {
      _releaseJobLock("naked-poc-sync-daily");
    }
  });
  _scheduledJobs.add("naked-poc-sync-daily");

  // ─── W26 Pass 6: Consistency tracker daily digest — 5:00 PM ET daily ────────────
  // Topstep 50% consistency rule: if a single day's P&L > 50% of cycle cumulative,
  // payout is silently denied. Fires at 17:00 ET (21:00 UTC EDT / 22:00 UTC EST)
  // after RTH session ends so the day's realized P&L is fully settled.
  // Pipeline-gate EXEMPT: consistency gate is a safety signal — payout denial can
  // happen while the pipeline is paused; operator must know regardless of mode.
  registerJob("consistency-tracker-daily-digest", 24 * 60 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    logger.info({ correlationId, jobName: "consistency-tracker-daily-digest" }, "cron tick start");
    await runConsistencyDailyDigest();
  });

  // 17:00 ET = 21:00 UTC (EDT, UTC-4) or 22:00 UTC (EST, UTC-5)
  // Pass 7 Track B cron jitter: offset to :07 to avoid pile-up with
  // composite-health-daily-digest (:13) and regime-drift-detector (:23).
  cron.schedule("7 21,22 * * *", async () => {
    if (!_tryAcquireJobLock("consistency-tracker-daily-digest")) return;
    try {
      const now = new Date();
      const etHour = parseInt(
        now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
        10,
      );
      if (etHour !== 17) {
        logger.debug({ etHour }, "Scheduler: consistency-tracker-daily-digest cron fired but not 17:00 ET — skipping");
        return;
      }
      // NOT pipeline-gated — safety signal (in _PIPELINE_GATE_EXEMPT)
      logger.info("Scheduler: consistency-tracker-daily-digest (5:00 PM ET confirmed)");
      const t0cdt = Date.now();
      await withRetry("consistency-tracker-daily-digest", SCHEDULER_JOBS["consistency-tracker-daily-digest"].run, 1);
      markJobRun("consistency-tracker-daily-digest");
      emitJobComplete("consistency-tracker-daily-digest", Date.now() - t0cdt);
    } finally {
      _releaseJobLock("consistency-tracker-daily-digest");
    }
  });
  _scheduledJobs.add("consistency-tracker-daily-digest");

  // ─── W26 Pass 4: Pattern aggregator — every 4 hours ──────────────────────────
  // Reads recent trade_critique rows, identifies recurring patterns, and emits a
  // strategy_proposer prompt appendix. Closes the broken feedback loop between
  // nightly/trade critiques and strategy generation.
  //
  // Pipeline-gate EXEMPT: the aggregator updates the strategy proposer's prompt
  // appendix cache in model-router.ts. This must fire even when the research
  // pipeline is paused so that the appendix stays current for when the pipeline
  // resumes. The kill switch (auto_patch_loop_enabled=false) is the operator's
  // tool to halt the loop — not the pipeline gate.
  _PIPELINE_GATE_EXEMPT.add("pattern-aggregator");

  registerJob("pattern-aggregator", 4 * 60 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    logger.info({ correlationId, jobName: "pattern-aggregator" }, "cron tick start");
    const { runPatternAggregator } = await import("./services/pattern-aggregator-service.js");
    const result = await runPatternAggregator();
    logger.info(
      { status: result.status, critiquesReviewed: result.critiques_reviewed, provider: result.provider, durationMs: result.durationMs, correlationId, jobName: "pattern-aggregator" },
      "pattern-aggregator cron complete",
    );
  });

  cron.schedule("0 */4 * * *", async () => {
    if (!_tryAcquireJobLock("pattern-aggregator")) return;
    try {
      const t0 = Date.now();
      await withRetry("pattern-aggregator", SCHEDULER_JOBS["pattern-aggregator"].run, 1);
      markJobRun("pattern-aggregator");
      emitJobComplete("pattern-aggregator", Date.now() - t0);
    } finally {
      _releaseJobLock("pattern-aggregator");
    }
  });
  _scheduledJobs.add("pattern-aggregator");

  // ─── Wave 26 Group C Task 2: cohort daily audit report — daily at 17:00 ET ───
  //
  // Queries audit_log for the last 24h of adaptive-exit events and posts a
  // Markdown cohort health report to Discord (INFO level — not a critical alert).
  // Produces: exit_plan source distribution, regime distribution, runner trail
  // usage, fallback event cluster detection, and hard-invariant proof counts.
  //
  // Pipeline-gate EXEMPT: operator needs the report even when trading is paused.
  // Idempotent (W23F.U UTC-date pattern): skips if already sent today.
  // Fail-soft: empty audit_log → zero counts in report, no crash.

  registerJob("wave26-cohort-daily-audit-report", 24 * 60 * 60 * 1000, async () => {
    const nowUtc = new Date();
    const hourUtc = nowUtc.getUTCHours();
    const correlationId = randomUUID();
    // Fire at 21:00 UTC = 17:00 ET (after RTH close + post-trade settle).
    // Check window: 20:45–21:15 UTC to account for cron scheduling jitter.
    if (hourUtc < 20 || hourUtc > 21) return;

    const sessionDate = nowUtc.toISOString().slice(0, 10);

    logger.info(
      { sessionDate, correlationId },
      "wave26-cohort-daily-audit-report: tick firing",
    );

    // W23F.U idempotency: skip if already sent today
    const alreadySentRows = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "wave26.cohort_audit_report_sent"),
          gte(
            auditLog.createdAt,
            new Date(new Date(sessionDate + "T00:00:00.000Z").getTime()),
          ),
        ),
      )
      .limit(1);

    if (alreadySentRows.length > 0) {
      logger.debug(
        { sessionDate, correlationId },
        "wave26-cohort-daily-audit-report: already sent today — skipping (idempotency)",
      );
      return;
    }

    try {
      // Build report via the cohort audit query service
      const { buildCohortAuditReport } = await import("./services/cohort-audit-report-service.js");
      const { markdown: reportMarkdown, summary } = await buildCohortAuditReport({
        days: 1,
        strategy: "silver_bullet",
        correlationId,
      });

      // Post to Discord as INFO (informational — not a failure signal)
      const { notifyInfo } = await import("./services/notification-service.js");
      const truncatedBody = reportMarkdown.slice(0, 3500); // Discord embed limit
      notifyInfo(
        `Wave 26 Cohort Audit — ${sessionDate}`,
        truncatedBody,
        { session_date: sessionDate, strategy: "silver_bullet", correlationId },
      );

      // Write audit row confirming report was sent (idempotency anchor)
      await insertAuditRow({
        action: "wave26.cohort_audit_report_sent",
        entityType: "cohort_audit_report",
        entityId: null,
        status: "success",
        input: { session_date: sessionDate, days: 1, strategy: "silver_bullet" },
        result: {
          session_date: sessionDate,
          summary,
          correlationId,
        },
        correlationId,
      });

      logger.info(
        { sessionDate, correlationId, summary },
        "wave26-cohort-daily-audit-report: report sent",
      );
    } catch (err) {
      logger.warn(
        { err, sessionDate, correlationId },
        "wave26-cohort-daily-audit-report: failed (non-blocking)",
      );
      // Write failure audit row for observability
      await insertAuditRow({
        action: "wave26.cohort_audit_report_failed",
        entityType: "cohort_audit_report",
        entityId: null,
        status: "failure",
        input: { session_date: sessionDate, days: 1, strategy: "silver_bullet" },
        result: { session_date: sessionDate, error: String(err), correlationId },
        correlationId,
      }).catch(() => { /* swallow nested audit write failure */ });
    }
  });

  _PIPELINE_GATE_EXEMPT.add("wave26-cohort-daily-audit-report");

  // Cron driver: every hour — "0 * * * *"
  // Job itself checks for the 20:xx-21:xx UTC window (17:00 ET)
  cron.schedule("0 * * * *", async () => {
    if (!_tryAcquireJobLock("wave26-cohort-daily-audit-report")) return;
    try {
      const t0 = Date.now();
      await withRetry("wave26-cohort-daily-audit-report", SCHEDULER_JOBS["wave26-cohort-daily-audit-report"].run, 1);
      markJobRun("wave26-cohort-daily-audit-report");
      emitJobComplete("wave26-cohort-daily-audit-report", Date.now() - t0);
    } finally {
      _releaseJobLock("wave26-cohort-daily-audit-report");
    }
  });
  _scheduledJobs.add("wave26-cohort-daily-audit-report");

  // ─── Wave 25 Pass 6 W25.11: narrative-state-tracker — every 5 min RTH ──────
  //
  // Computes institutional narrative phase (ACCUMULATION / MANIPULATION /
  // DISTRIBUTION / REVERSAL_FORMING / NEUTRAL) for all 3 symbols and persists
  // to bias_state.narrative_state (migration 0143).
  //
  // Pipeline-gate EXEMPT: narrative state is an observability + promotion-gate
  // input that must populate even when the trading pipeline is paused.
  // Idempotent: no audit row emitted unless the phase actually changes.
  //
  // RTH guard: Mon–Fri, 13:30–20:00 UTC (09:30–16:00 ET).
  // Same window as liquidity-map-refresh (conservative; narrative data outside
  // RTH is low-value and the 5-min cron would generate noise).

  registerJob("narrative-state-tracker", 5 * 60 * 1000, async () => {
    const nowUtc = new Date();
    const dayOfWeek = nowUtc.getUTCDay(); // 0=Sun, 6=Sat
    if (dayOfWeek === 0 || dayOfWeek === 6) return; // skip weekends

    const hourUtc = nowUtc.getUTCHours();
    const minUtc = nowUtc.getUTCMinutes();
    const totalMinutesUtc = hourUtc * 60 + minUtc;
    // 13:30 UTC = 810 min; 20:00 UTC = 1200 min
    if (totalMinutesUtc < 810 || totalMinutesUtc >= 1200) return;

    const sessionDate = nowUtc.toISOString().slice(0, 10);
    const correlationId = randomUUID();

    logger.info(
      { sessionDate, correlationId },
      "narrative-state-tracker: tick firing",
    );

    const {
      computeNarrativeState,
      persistNarrativeState,
      loadLatestNarrativeState,
    } = await import("./services/narrative-state-service.js");

    for (const symbol of ["MES", "MNQ", "MCL"]) {
      try {
        // Load the latest bias_state row for this session+symbol to get htfNarrative + structureState
        const { getOrComputeBiasStateForDay } = await import("./services/bias-state-service.js");
        const biasData = await getOrComputeBiasStateForDay(nowUtc.toISOString(), symbol);

        const htfNarrative = biasData.htfNarrative;
        const structureState = biasData.structureState;

        // Load previous narrative state for phase continuity
        const previousState = await loadLatestNarrativeState(sessionDate, symbol);

        // ── Wave 26 Group C Task 1: fetch latest real intraday bar ──────────────
        // getBarBuffer() returns the live 200-bar rolling window from the Massive
        // WebSocket feed. When a bar is available, pass real {close, high, low}
        // so ACCUMULATION → MANIPULATION sweep detection fires from the cron path.
        // Fallback: if the buffer is empty (pre-market, weekend, or feed not yet
        // started), use close=0/high=0/low=0 — sweep detection stays dormant but
        // phase-continuity logic still runs (backward compat preserved).
        const symbolBarBuffer = getBarBuffer(symbol);
        const latestStreamBar = symbolBarBuffer.length > 0
          ? symbolBarBuffer[symbolBarBuffer.length - 1]
          : null;

        const currentBar = latestStreamBar !== null
          ? {
              close: latestStreamBar.close,
              high:  latestStreamBar.high,
              low:   latestStreamBar.low,
              ts_event: new Date(latestStreamBar.timestamp),
            }
          : { close: 0, high: 0, low: 0, ts_event: nowUtc };

        const barSource = latestStreamBar !== null ? "live_stream" : "fallback_zeros";
        logger.debug(
          {
            symbol,
            sessionDate,
            correlationId,
            bar_source: barSource,
            close: currentBar.close,
            high: currentBar.high,
            low: currentBar.low,
            ts_event: currentBar.ts_event.toISOString(),
          },
          "narrative-state-tracker: bar resolved for sweep detection",
        );

        // Compute narrative state — real bar enables ACCUMULATION→MANIPULATION detection.
        // Liquidity levels are empty here (expensive lookup deferred to signal flow);
        // expansion_target will be null in cron path, non-null when called from paper-signal-service.
        const state = computeNarrativeState(
          htfNarrative,
          structureState,
          currentBar,
          [], // liquidityLevelsNearby — empty in cron path (expansion_target computed at signal time)
          previousState,
        );

        await persistNarrativeState(sessionDate, symbol, state, correlationId);

        logger.debug(
          { symbol, sessionDate, phase: state.phase, correlationId },
          "narrative-state-tracker: symbol complete",
        );
      } catch (err) {
        logger.warn(
          { err, symbol, sessionDate, correlationId },
          "narrative-state-tracker: symbol failed (non-blocking)",
        );
      }
    }

    logger.info(
      { sessionDate, correlationId },
      "narrative-state-tracker: all symbols complete",
    );
  });

  // Pipeline-gate EXEMPT: narrative context must populate even during PAUSE
  _PIPELINE_GATE_EXEMPT.add("narrative-state-tracker");

  // Cron driver: every 5 min — "*/5 * * * *"
  cron.schedule("*/5 * * * *", async () => {
    if (!_tryAcquireJobLock("narrative-state-tracker")) return;
    try {
      const t0 = Date.now();
      await withRetry("narrative-state-tracker", SCHEDULER_JOBS["narrative-state-tracker"].run, 1);
      markJobRun("narrative-state-tracker");
      emitJobComplete("narrative-state-tracker", Date.now() - t0);
    } finally {
      _releaseJobLock("narrative-state-tracker");
    }
  });
  _scheduledJobs.add("narrative-state-tracker");

  // ─── Wave 27 Pass 1.5 A2: Weekly quantum replay analysis — Sunday 19:00 ET ──
  //
  // Spawns scripts/replay-grade-quantum.ts --apply, parses Spearman + binomial
  // stats + verdict, and posts a family-grade Discord notification.
  //
  // Schedule: 0 23 * * 0 (Sunday 23:00 UTC = 19:00 ET during EDT, 18:00 ET during EST).
  // DST-aware double-fire: fires at 23:00 UTC AND 00:00 UTC next day (Monday) to
  // cover EDT (UTC-4) and EST (UTC-5). ET hour guard inside handler allows execution
  // only when ET hour == 19 (Sunday evening, regardless of DST offset).
  //
  // Kill switch: system_parameters.auto_patch_loop_enabled="false" halts the job.
  // Timeout: QUANTUM_REPLAY_WEEKLY_TIMEOUT_MS env var (default 600000ms = 10 min).
  // NOT pipeline-gated: quantum harness is an observability / advisory signal —
  // an operator who paused trading still needs to know whether the predictor has signal.
  registerJob("quantum-replay-weekly-analysis", 7 * 24 * 60 * 60 * 1000, async () => {
    const result = await runQuantumReplayWeeklyAnalysis();
    logger.info(
      {
        job: "quantum-replay-weekly-analysis",
        status: result.status,
        verdict: result.verdict,
        sampleSize: result.sampleSize,
        spearmanRho: result.spearmanRho,
        durationMs: result.durationMs,
        correlationId: result.correlationId,
      },
      "quantum-replay-weekly-analysis: tick complete",
    );
  });

  // Sun 19:00 ET = Sun 23:00 UTC (EDT, UTC-4) or Mon 00:00 UTC (EST, UTC-5).
  // Fire at both; ET day+hour guard inside the handler filters to Sunday 19:00 ET only.
  cron.schedule("0 23,0 * * 0,1", async () => {
    if (!_tryAcquireJobLock("quantum-replay-weekly-analysis")) return;
    try {
      const now = new Date();
      const etStr = now.toLocaleString("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        hour: "numeric",
        hour12: false,
      });
      // Must be Sunday at 19:00 ET — cron fires Sun 23:00 UTC (EDT) or Mon 00:00 UTC (EST)
      if (!etStr.includes("Sun") || !etStr.includes("19")) {
        logger.debug(
          { etStr, utcHour: now.getUTCHours(), utcDay: now.getUTCDay() },
          "Scheduler: quantum-replay-weekly-analysis cron fired but not Sunday 19:00 ET — skipping",
        );
        return;
      }
      // _PIPELINE_GATE_EXEMPT — no gate call needed
      logger.info({ job: "quantum-replay-weekly-analysis" }, "running pipeline-gate-exempt quantum replay weekly analysis (Sunday 19:00 ET confirmed)");
      const t0qrw = Date.now();
      await withRetry("quantum-replay-weekly-analysis", SCHEDULER_JOBS["quantum-replay-weekly-analysis"].run, 1);
      markJobRun("quantum-replay-weekly-analysis");
      emitJobComplete("quantum-replay-weekly-analysis", Date.now() - t0qrw);
    } finally {
      _releaseJobLock("quantum-replay-weekly-analysis");
    }
  });
  _scheduledJobs.add("quantum-replay-weekly-analysis");

  // ─── W28 Pass A.4: Composite health daily digest — 5:00 PM ET daily ─────────
  //
  // Runs aggregateStrategyHealth() across all active strategies (DEPLOYED / PILOT /
  // PAPER / DEPLOY_READY), tallies HEALTHY / MARGINAL / UNHEALTHY / CRITICAL /
  // SKIPPED verdicts, and posts a single family-grade Discord summary.
  //
  // Schedule: 0 22 * * * (22:00 UTC = 17:00 ET during EST, UTC-5).
  // DST-aware double-fire not required for this job — the ET-hour guard inside
  // the handler fires at hour=17. 22:00 UTC covers EST (UTC-5=17:00 ET).
  // During EDT (UTC-4), 22:00 UTC = 18:00 ET — the ET-hour guard will skip.
  // The guard fires correctly at 21:00 UTC during EDT (17:00 ET EDT).
  // Therefore schedule is "0 21,22 * * *" to cover both offsets (mirrors
  // consistency-tracker-daily-digest pattern exactly).
  //
  // Pipeline-gate EXEMPT: composite health is a pure observability signal —
  // strategy health monitoring must fire even when the operator pauses research.
  // NOT pipeline-gated (in _PIPELINE_GATE_EXEMPT).
  registerJob("composite-health-daily-digest", 24 * 60 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    logger.info({ correlationId, jobName: "composite-health-daily-digest" }, "cron tick start");
    await runCompositeHealthDailyDigest();
  });

  // 17:00 ET = 21:00 UTC (EDT, UTC-4) or 22:00 UTC (EST, UTC-5)
  // Pass 7 Track B cron jitter: offset to :13 to avoid pile-up with
  // consistency-tracker-daily-digest (:07) and regime-drift-detector (:23).
  cron.schedule("13 21,22 * * *", async () => {
    if (!_tryAcquireJobLock("composite-health-daily-digest")) return;
    try {
      const now = new Date();
      const etHour = parseInt(
        now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
        10,
      );
      if (etHour !== 17) {
        logger.debug({ etHour }, "Scheduler: composite-health-daily-digest cron fired but not 17:00 ET — skipping");
        return;
      }
      // NOT pipeline-gated — safety/observability signal (in _PIPELINE_GATE_EXEMPT)
      logger.info("Scheduler: composite-health-daily-digest (5:00 PM ET confirmed)");
      const t0chd = Date.now();
      await withRetry("composite-health-daily-digest", SCHEDULER_JOBS["composite-health-daily-digest"].run, 1);
      markJobRun("composite-health-daily-digest");
      emitJobComplete("composite-health-daily-digest", Date.now() - t0chd);
    } finally {
      _releaseJobLock("composite-health-daily-digest");
    }
  });
  _scheduledJobs.add("composite-health-daily-digest");

  // ─── W26 Pass G Pass D: Strategy STALE detector — 04:00 ET daily ──────────
  //
  // Scans all ACTIVE strategies (CANDIDATE / PAPER / DEPLOY_READY / PILOT) for
  // inactivity and manages lifecycle_metadata.stale_since + NEEDS_REVISION
  // demotion at thresholds (30d → stale, 60d → NEEDS_REVISION).
  //
  // Pipeline-paused-AWARE: if pipeline is not ACTIVE, the job logs and exits
  // without any demotions — per operator mandate (paused mode should not
  // penalize strategies for not trading).
  //
  // Schedule: "0 9 * * *" = 09:00 UTC = 04:00 ET (DST-aware: 04:00 EST both
  // winter (UTC-5: 09:00 UTC) and summer (UTC-4: 08:00 UTC → covered by the
  // ET-hour=4 guard inside the handler). Double-fire "0 8,9 * * *" covers both
  // UTC offsets. The ET-hour guard inside filters to exactly 04:00 ET.
  //
  // GRAVEYARD invariant: never writes GRAVEYARD. Max demotion = NEEDS_REVISION.
  // DEPLOYED + PILOT are never demoted (the service enforces this itself).
  registerJob("strategy-stale-detector", 24 * 60 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    logger.info({ correlationId, jobName: "strategy-stale-detector" }, "cron tick start");
    await runStrategyStaleDetector();
  });

  // 04:00 ET = 09:00 UTC (EST, UTC-5) or 08:00 UTC (EDT, UTC-4)
  // Double-fire "0 8,9 * * *" + ET-hour guard ensures exactly one execution per day.
  cron.schedule("0 8,9 * * *", async () => {
    if (!_tryAcquireJobLock("strategy-stale-detector")) return;
    try {
      const now = new Date();
      const etHour = parseInt(
        now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
        10,
      );
      if (etHour !== 4) {
        logger.debug({ etHour }, "Scheduler: strategy-stale-detector cron fired but not 04:00 ET — skipping");
        return;
      }
      if (!(await pipelineGate("strategy-stale-detector"))) return;
      logger.info("Scheduler: strategy-stale-detector (04:00 ET confirmed)");
      const t0ssd = Date.now();
      await withRetry("strategy-stale-detector", SCHEDULER_JOBS["strategy-stale-detector"].run, 1);
      markJobRun("strategy-stale-detector");
      emitJobComplete("strategy-stale-detector", Date.now() - t0ssd);
    } finally {
      _releaseJobLock("strategy-stale-detector");
    }
  });
  _scheduledJobs.add("strategy-stale-detector");

  // ─── Wave 26 Pass G Pass F: DD velocity cron — every minute ─────────────────
  //
  // Sweeps all active paper sessions every minute, records equity samples,
  // and evaluates rolling 2-hour drawdown velocity.
  //
  // F-2 (2026-06-24): PIPELINE-GATE EXEMPT. After AUTOPAUSE_DD_VELOCITY fires the
  // cron must KEEP running so it can:
  //   (a) continue collecting equity samples (data needed for F-3 recovery check)
  //   (b) drive the vacation auto-recovery check (checkVacationAutoRecovery)
  // The existing alreadyPaused idempotency guard in _handleAutopause prevents
  // duplicate autopause fires, so exempting this job is safe.
  //
  // Schedule: "* * * * *" = every minute (1-minute cron, NOT per-tick).
  // The gate is a cron-only monitor; paper-execution-service.ts does NOT call it.

  _PIPELINE_GATE_EXEMPT.add("dd-velocity-cron");

  registerJob("dd-velocity-cron", 60_000, async () => {
    const correlationId = randomUUID();
    logger.debug({ correlationId, jobName: "dd-velocity-cron" }, "cron tick start");
    const { batchCheckActiveSessions, checkVacationAutoRecovery } = await import("./services/dd-velocity-gate.js");
    const results = await batchCheckActiveSessions();
    const autopaused = results.filter((r) => r.level === "autopause");
    const warned = results.filter((r) => r.level === "warning");
    if (autopaused.length > 0 || warned.length > 0) {
      logger.info(
        { autopaused: autopaused.length, warned: warned.length, total: results.length, correlationId },
        "dd-velocity-cron: velocity events fired",
      );
    }
    // F-3: Check whether vacation auto-recovery should clear AUTOPAUSE_DD_VELOCITY.
    // Fail-soft — any error inside is caught by checkVacationAutoRecovery itself.
    await checkVacationAutoRecovery();
  });

  cron.schedule("* * * * *", async () => {
    if (!_tryAcquireJobLock("dd-velocity-cron")) return;
    try {
      // NOT pipeline-gated — safety/monitoring signal (in _PIPELINE_GATE_EXEMPT)
      const t0dv = Date.now();
      await withRetry("dd-velocity-cron", SCHEDULER_JOBS["dd-velocity-cron"].run, 1);
      markJobRun("dd-velocity-cron");
      emitJobComplete("dd-velocity-cron", Date.now() - t0dv);
    } finally {
      _releaseJobLock("dd-velocity-cron");
    }
  });
  _scheduledJobs.add("dd-velocity-cron");

  // ─── W29 Pass C.2: Quantum RL training window cron ──────────────────────────
  //
  // Fires every hour at off-RTH ET windows {6,7,8,16,17} (Topstep April 2026
  // unattended-automation rule). The cron fires hourly; the ET-hour guard inside
  // the handler ensures training only begins in allowed windows.
  //
  // Pipeline-gate EXEMPT: RL training is challenger-only observability.
  // An operator who paused trading still accumulates training evidence.
  // _PIPELINE_GATE_EXEMPT entry prevents pipelineGate() blocking.
  //
  // Audit actions (written by backtest-service.ts fire-and-forget hook; this
  // scheduler job fires independently from the training runner):
  //   - quantum_rl.training_auto_fire_enqueued
  //   - quantum_rl.training_auto_fire_failed
  //   - quantum_rl.training_circuit_breaker_opened
  //   - quantum_rl.training_skipped_in_rth_window

  _PIPELINE_GATE_EXEMPT.add("quantum-rl-training-window");

  registerJob("quantum-rl-training-window", 60 * 60 * 1000, async () => {
    // Job body is intentionally minimal — the actual training is kicked off
    // by backtest-service.ts fire-and-forget hook. This scheduler job exists
    // to ensure the training window guard is evaluated every hour and logged.
    const etHour = parseInt(
      new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
      10,
    );
    if (!isOffRthTrainingWindow()) {
      logger.debug(
        { etHour, job: "quantum-rl-training-window" },
        "quantum-rl-training-window: RTH window — no training dispatch",
      );
      // Emit audit so the window guard is auditable
      await insertAuditRow({
        action: "quantum_rl.training_skipped_in_rth_window",
        entityType: "scheduler",
        entityId: "quantum-rl-training-window",
        status: "info",
        result: { et_hour: etHour, reason: "rth_window", governance_labels: { experimental: true, authoritative: false, decision_role: "challenger_only", training_mode: true } },
      });
    } else {
      logger.info(
        { etHour, job: "quantum-rl-training-window" },
        "quantum-rl-training-window: off-RTH window open — training eligible for fire-and-forget callers",
      );
    }
  });

  // Fires every hour on the hour (off-RTH guard inside job body)
  cron.schedule("0 * * * *", async () => {
    if (!_tryAcquireJobLock("quantum-rl-training-window")) return;
    try {
      // NOT pipeline-gated (in _PIPELINE_GATE_EXEMPT)
      logger.debug({ job: "quantum-rl-training-window" }, "quantum-rl-training-window: cron tick");
      const t0rl = Date.now();
      await withRetry("quantum-rl-training-window", SCHEDULER_JOBS["quantum-rl-training-window"].run, 1);
      markJobRun("quantum-rl-training-window");
      emitJobComplete("quantum-rl-training-window", Date.now() - t0rl);
    } finally {
      _releaseJobLock("quantum-rl-training-window");
    }
  });
  _scheduledJobs.add("quantum-rl-training-window");

  // ─── W29 Pass B.3: Regime Drift Detector — 18:00 ET daily ──────────────────
  //
  // Scans all DEPLOYED strategies with regime_trained_on IS NOT NULL.
  // If last 5 consecutive days of bias_state.regime_label ALL differ from
  // strategies.regime_trained_on, demotes strategy DEPLOYED → DECLINING → TESTING
  // and fires a Discord WARN.
  //
  // Schedule: 18:00 ET = 22:00 UTC (EST, UTC-5) or 21:00 UTC (EDT, UTC-4).
  // Double-fire "0 21,22 * * *" covers both UTC offsets; ET-hour=18 guard inside
  // runRegimeDriftDetector() filters to exactly 18:00 ET.
  //
  // Pipeline-gate EXEMPT: drift continues regardless of operator intent to pause.
  // A DEPLOYED strategy losing its trained regime during a pause is still dangerous.
  // Registered in _PIPELINE_GATE_EXEMPT above.
  _PIPELINE_GATE_EXEMPT.add("regime-drift-detector");

  registerJob("regime-drift-detector", 24 * 60 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    logger.info({ correlationId, jobName: "regime-drift-detector" }, "cron tick start");
    await runRegimeDriftDetector();
  });

  // 18:00 ET = 22:00 UTC (EST, UTC-5) or 21:00 UTC (EDT, UTC-4)
  // Pass 7 Track B cron jitter: offset to :23 to avoid pile-up with
  // consistency-tracker-daily-digest (:07) and composite-health-daily-digest (:13).
  cron.schedule("23 21,22 * * *", async () => {
    if (!_tryAcquireJobLock("regime-drift-detector")) return;
    try {
      const now = new Date();
      const etHour = parseInt(
        now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
        10,
      );
      if (etHour !== 18) {
        logger.debug({ etHour }, "Scheduler: regime-drift-detector cron fired but not 18:00 ET — skipping (DST guard)");
        return;
      }
      // NOT pipeline-gated — in _PIPELINE_GATE_EXEMPT
      logger.info("Scheduler: regime-drift-detector (18:00 ET confirmed)");
      const t0rdd = Date.now();
      await withRetry("regime-drift-detector", SCHEDULER_JOBS["regime-drift-detector"].run, 1);
      markJobRun("regime-drift-detector");
      emitJobComplete("regime-drift-detector", Date.now() - t0rdd);
    } finally {
      _releaseJobLock("regime-drift-detector");
    }
  });
  _scheduledJobs.add("regime-drift-detector");

  // ─── Wave 26 Pass L Tweak 2: MCL pre-EIA stop tightening — Wed 10:00 ET ───
  //
  // 30 minutes before the weekly EIA crude oil inventory release at 10:30 ET,
  // walk open MCL positions in profit ≥ 0.5R and tighten runner stop to whichever
  // is tighter of (BE+1tick, 1× ATR). Per QuantStrategy.io 2026-01-30 institutional
  // CL practice — Pass L research validated this against 15 fresh 2026 sources.
  //
  // Schedule: 0 14,15 * * 3  (Wed 14:00 UTC EDT / 15:00 UTC EST).
  // ET-hour guard inside the handler filters to exactly 10:00 ET.
  //
  // Pipeline-gate EXEMPT: pre-EIA tightening protects operator's open exposure
  // even when pipeline is PAUSED. An operator may have paused FOR the EIA event;
  // the tightening must still fire.
  _PIPELINE_GATE_EXEMPT.add("mcl-pre-eia-stop-tighten");

  registerJob("mcl-pre-eia-stop-tighten", 7 * 24 * 60 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    logger.info({ correlationId, jobName: "mcl-pre-eia-stop-tighten" }, "cron tick start");
    const { runMclPreEiaStopTighten } = await import("./services/mcl-pre-eia-stop-tighten-service.js");
    const summary = await runMclPreEiaStopTighten();
    logger.info({ correlationId, summary }, "mcl-pre-eia-stop-tighten: complete");
  });

  // 10:00 ET = 14:00 UTC (EDT) or 15:00 UTC (EST). Fire both; ET-hour guard
  // inside filters to exactly 10:00 ET on Wednesdays.
  cron.schedule("0 14,15 * * 3", async () => {
    if (!_tryAcquireJobLock("mcl-pre-eia-stop-tighten")) return;
    try {
      const now = new Date();
      const etHour = parseInt(
        now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
        10,
      );
      if (etHour !== 10) {
        logger.debug({ etHour }, "Scheduler: mcl-pre-eia-stop-tighten fired but not 10:00 ET — skipping (DST guard)");
        return;
      }
      logger.info("Scheduler: mcl-pre-eia-stop-tighten (Wed 10:00 ET confirmed)");
      const t0mcl = Date.now();
      await withRetry("mcl-pre-eia-stop-tighten", SCHEDULER_JOBS["mcl-pre-eia-stop-tighten"].run, 1);
      markJobRun("mcl-pre-eia-stop-tighten");
      emitJobComplete("mcl-pre-eia-stop-tighten", Date.now() - t0mcl);
    } finally {
      _releaseJobLock("mcl-pre-eia-stop-tighten");
    }
  });
  _scheduledJobs.add("mcl-pre-eia-stop-tighten");

  // ─── W29 Pass D.3: A/B Comparison Weekly Digest — Friday 17:00 ET ──────────
  //
  // Posts a weekly Discord summary of the A/B paper routing performance:
  // Sub-Account 1 (baseline) vs Sub-Account 2 (RL-challenger) cumulative P&L
  // and 20-session Sharpe, plus RL training epoch count and kill switch state,
  // plus per-regime Sharpe gap breakdown.
  //
  // Schedule: 0 21,22 * * 5 (Friday 21,22 UTC).
  //   17:00 ET = 21:00 UTC (EDT, UTC-4) or 22:00 UTC (EST, UTC-5).
  //   Double-fire covers both DST offsets; ET-hour=17 + weekday=Fri guard inside
  //   runAbComparisonWeeklyDigest() filters to exactly Friday 17:00 ET.
  //
  // Pipeline-gate EXEMPT: operator visibility into A/B performance must fire
  // regardless of pipeline state. A paused pipeline does not stop paper accounts
  // from accumulating evidence — the operator needs the Friday digest either way.
  // Registered in _PIPELINE_GATE_EXEMPT above.

  registerJob("ab-comparison-weekly-digest", 7 * 24 * 60 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    logger.info({ correlationId, jobName: "ab-comparison-weekly-digest" }, "cron tick start");
    await runAbComparisonWeeklyDigest();
  });

  // Fri 17:00 ET = Fri 21:00 UTC (EDT, UTC-4) or Fri 22:00 UTC (EST, UTC-5)
  // Double-fire: "0 21,22 * * 5"; ET-hour + weekday guards inside handler filter to Fri 17:00 ET.
  cron.schedule("0 21,22 * * 5", async () => {
    if (!_tryAcquireJobLock("ab-comparison-weekly-digest")) return;
    try {
      const now = new Date();
      const etHour = parseInt(
        now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
        10,
      );
      const etWeekday = now.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short" });
      if (etHour !== 17 || etWeekday !== "Fri") {
        logger.debug(
          { etHour, etWeekday },
          "Scheduler: ab-comparison-weekly-digest cron fired but not Friday 17:00 ET — skipping (DST guard)",
        );
        return;
      }
      // NOT pipeline-gated — in _PIPELINE_GATE_EXEMPT
      logger.info("Scheduler: ab-comparison-weekly-digest (Friday 17:00 ET confirmed)");
      const t0abd = Date.now();
      await withRetry("ab-comparison-weekly-digest", SCHEDULER_JOBS["ab-comparison-weekly-digest"].run, 1);
      markJobRun("ab-comparison-weekly-digest");
      emitJobComplete("ab-comparison-weekly-digest", Date.now() - t0abd);
    } finally {
      _releaseJobLock("ab-comparison-weekly-digest");
    }
  });
  _scheduledJobs.add("ab-comparison-weekly-digest");

  // ─── W0.1: Nightly DB backup — 02:00 ET daily ─────────────────────────────
  // CRITICAL GAP: the only existing backup is a one-shot pre-migration snapshot
  // (~54 days old). The tower has experienced NVIDIA-TDR/power freezes. A total
  // hardware loss = total state loss for the entire audit trail and governance
  // state. This cron closes that gap with a nightly pg_dump → S3 pipeline.
  //
  // Cadence: nightly at 02:00 ET (off-RTH, low activity).
  //   EDT (UTC-4): 06:00 UTC
  //   EST (UTC-5): 07:00 UTC
  // DST-safe double-fire: cron fires at 0 6,7 UTC; ET-hour guard confirms 2 AM ET.
  //
  // Pipeline-gate EXEMPT: hardware failure can happen regardless of pipeline
  // state. A paused pipeline does not protect the database.
  registerJob("db-backup", 24 * 60 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    logger.info({ correlationId, jobName: "db-backup" }, "cron tick start");
    await runDbBackup();
  });

  cron.schedule("0 6,7 * * *", async () => {
    if (!_tryAcquireJobLock("db-backup")) return;
    try {
      const now = new Date();
      const etHour = parseInt(
        now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
        10,
      );
      if (etHour !== 2) {
        logger.debug({ etHour }, "Scheduler: db-backup cron fired but not 02:00 ET — skipping");
        return;
      }
      // NOT pipeline-gated — safety signal (in _PIPELINE_GATE_EXEMPT)
      logger.info("Scheduler: db-backup (02:00 AM ET confirmed)");
      const t0db = Date.now();
      await withRetry("db-backup", SCHEDULER_JOBS["db-backup"].run, 1);
      markJobRun("db-backup");
      emitJobComplete("db-backup", Date.now() - t0db);
    } finally {
      _releaseJobLock("db-backup");
    }
  });
  _scheduledJobs.add("db-backup");

  // ─── Phase 4C: daily reconciliation (4:15 PM ET weekdays) ──────────────────
  // Safety signal — pipeline-gate-exempt so it fires even when pipeline is PAUSED.
  // In EDT (UTC-4): 4 PM ET = 20:00 UTC.  In EST (UTC-5): 4 PM ET = 21:00 UTC.
  // DST-safe double-fire at minutes :15 past hours 20 and 21 UTC; inner ET-hour
  // guard accepts only etHour === 16 (4 PM ET in 24h).
  registerJob("daily-reconciliation", 24 * 60 * 60 * 1000, async () => {
    const { runDailyReconciliation } = await import("./production/reconciliation-service.js");
    await runDailyReconciliation();
  });
  cron.schedule("15 20,21 * * 1-5", async () => {
    if (!_tryAcquireJobLock("daily-reconciliation")) return;
    try {
      const etHour = parseInt(
        new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
        10,
      );
      if (etHour !== 16) {
        logger.debug({ etHour }, "Scheduler: daily-reconciliation cron fired but not 4:15 PM ET — skipping");
        return;
      }
      logger.info({ job: "daily-reconciliation" }, "running pipeline-gate-exempt daily reconciliation (4:15 PM ET confirmed)");
      const t0 = Date.now();
      try {
        await withRetry("daily-reconciliation", SCHEDULER_JOBS["daily-reconciliation"].run, 1);
        markJobRun("daily-reconciliation");
        emitJobComplete("daily-reconciliation", Date.now() - t0);
      } catch (err) {
        logger.error({ err, job: "daily-reconciliation" }, "daily-reconciliation cron failed");
        notifyCritical(
          "reconciliation-cron-failed",
          appendFamilyGradePostscript(
            `The daily reconciliation job failed. Error: ${err instanceof Error ? err.message : String(err)}. Job: daily-reconciliation.`,
            "The end-of-day trade reconciliation job failed to run. This means today's trade records may not have been fully verified yet.",
            "No immediate action needed. Tony will investigate. The bot continues trading normally.",
          ),
          { error: err instanceof Error ? err.message : String(err), job: "daily-reconciliation" },
        );
      }
    } finally {
      _releaseJobLock("daily-reconciliation");
    }
  });
  _scheduledJobs.add("daily-reconciliation");

  // ─── Phase 4C: weekly drift detection (Sunday 6:00 PM ET) ───────────────────
  // Safety signal — pipeline-gate-exempt so it fires even when pipeline is PAUSED.
  // In EDT (UTC-4): 6 PM ET = 22:00 UTC.  In EST (UTC-5): 6 PM ET = 23:00 UTC.
  // DST-safe double-fire at minute :00 of hours 22 and 23 UTC on Sundays; inner
  // ET-hour guard accepts only etHour === 18 (6 PM ET in 24h) on Sunday.
  registerJob("weekly-drift-detection", 7 * 24 * 60 * 60 * 1000, async () => {
    const { runWeeklyDriftDetection } = await import("./production/drift-detector.js");
    await runWeeklyDriftDetection();
  });
  cron.schedule("0 22,23 * * 0", async () => {
    if (!_tryAcquireJobLock("weekly-drift-detection")) return;
    try {
      const etStr = new Date().toLocaleString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        hour12: false,
      });
      const etHour = parseInt(etStr, 10);
      if (etHour !== 18) {
        logger.debug({ etHour }, "Scheduler: weekly-drift-detection cron fired but not 6:00 PM ET — skipping");
        return;
      }
      logger.info({ job: "weekly-drift-detection" }, "running pipeline-gate-exempt weekly drift detection (6:00 PM ET Sunday confirmed)");
      const t0 = Date.now();
      try {
        await withRetry("weekly-drift-detection", SCHEDULER_JOBS["weekly-drift-detection"].run, 1);
        markJobRun("weekly-drift-detection");
        emitJobComplete("weekly-drift-detection", Date.now() - t0);
      } catch (err) {
        logger.error({ err, job: "weekly-drift-detection" }, "weekly-drift-detection cron failed");
        notifyCritical(
          "drift-cron-failed",
          appendFamilyGradePostscript(
            `The weekly drift detection job failed. Error: ${err instanceof Error ? err.message : String(err)}. Job: weekly-drift-detection.`,
            "The weekly strategy performance drift check failed to run. This is a monitoring job — the bot continues trading normally.",
            "No immediate action needed. Tell Tony if this happens multiple weeks in a row.",
          ),
          { error: err instanceof Error ? err.message : String(err), job: "weekly-drift-detection" },
        );
      }
    } finally {
      _releaseJobLock("weekly-drift-detection");
    }
  });
  _scheduledJobs.add("weekly-drift-detection");

  // ─── Pass 6 Track A: paper_journal_recon — daily 17:30 ET (22:30 UTC) ────────
  //
  // 6th reconciliation source: joins paper_trades vs TradersPost broker tape
  // (production_trades proxy) and tradingview_markers per strategy per day.
  // Asserts trade-count parity and per-trade P&L within 2-tick tolerance for all
  // DEPLOYED+ strategies. Closes Wiring #3 (audit finding: CLAUDE.md §8 "match
  // within 1-2 ticks" — previously no paper_trades references in reconciliation).
  //
  // On drift: audit paper_reconciliation.mismatch_detected (critical) + Discord
  //   CRITICAL with appendFamilyGradePostscript.
  // On missing broker row: audit paper_reconciliation.missing_broker_data (warn).
  // On clean: audit paper_reconciliation.evaluated (success).
  //
  // Runs AFTER the 4:15 PM ET daily-reconciliation cron (22:30 UTC offset avoids
  // collision with the 20:15/21:15 UTC daily-reconciliation fire).
  //
  // DST-safe double-fire: 17:30 ET
  //   EDT (UTC-4): 21:30 UTC → cron fires at "30 21,22 * * *", ET guard = 17
  //   EST (UTC-5): 22:30 UTC → cron fires at "30 21,22 * * *", ET guard = 17
  //
  // Pipeline-gate EXEMPT: paper journal reconciliation is a safety signal —
  // must fire even when the research pipeline is paused.
  _PIPELINE_GATE_EXEMPT.add("paper-journal-recon-daily");
  registerJob("paper-journal-recon-daily", 24 * 60 * 60 * 1000, async () => {
    const { runPaperJournalRecon } = await import("./production/paper-journal-recon.js");
    await runPaperJournalRecon();
  });
  cron.schedule("30 21,22 * * *", async () => {
    if (!_tryAcquireJobLock("paper-journal-recon-daily")) return;
    try {
      const now = new Date();
      const etHour = parseInt(
        now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
        10,
      );
      if (etHour !== 17) {
        logger.debug({ etHour }, "Scheduler: paper-journal-recon-daily cron fired but not 17:30 ET — skipping (DST guard)");
        return;
      }
      // NOT pipeline-gated — safety signal (in _PIPELINE_GATE_EXEMPT)
      logger.info({ job: "paper-journal-recon-daily" }, "Scheduler: paper-journal-recon-daily (17:30 ET confirmed)");
      const t0pjr = Date.now();
      await withRetry("paper-journal-recon-daily", SCHEDULER_JOBS["paper-journal-recon-daily"].run, 1);
      markJobRun("paper-journal-recon-daily");
      emitJobComplete("paper-journal-recon-daily", Date.now() - t0pjr);
    } catch (err) {
      logger.error({ err, job: "paper-journal-recon-daily" }, "paper-journal-recon-daily cron failed");
      const { notifyCritical: nc } = await import("./services/notification-service.js");
      nc(
        "paper-journal-recon-cron-failed",
        appendFamilyGradePostscript(
          `The paper journal reconciliation job failed. Error: ${err instanceof Error ? err.message : String(err)}. Job: paper-journal-recon-daily.`,
          "The daily paper trade audit job failed to complete. The bot continues trading, but today's paper trade records have not been fully cross-checked.",
          "No immediate action needed. Tony will be alerted and will check when available.",
        ),
        { error: err instanceof Error ? err.message : String(err), job: "paper-journal-recon-daily" },
      );
    } finally {
      _releaseJobLock("paper-journal-recon-daily");
    }
  });
  _scheduledJobs.add("paper-journal-recon-daily");

  // ─── W1 go-live blocker #5a: Per-strategy feed silence alarm — every 5 min ──
  // Detects when a live/paper strategy (PAPER/DEPLOY_READY/PILOT/DEPLOYED) stops
  // receiving TradingView/Pine signals during RTH. Sources last-received-signal
  // from paper_signal_logs (most recent row per strategy). Fires Discord CRITICAL
  // + feed.silence_detected audit row when silent beyond N × bar-interval threshold.
  // Pipeline-gate-exempt: a feed going silent is a safety signal independent of
  // research gate state — deployed strategies must be monitored even when PAUSED.
  // ENV: FEED_SILENCE_THRESHOLD_MULTIPLIER (default 3), FEED_SILENCE_MIN_BAR_INTERVAL_MS,
  //      FEED_SILENCE_MAX_BAR_INTERVAL_MS.
  registerJob("feed-silence-check", 5 * 60 * 1000, async () => {
    const { runFeedSilenceCheck } = await import("./services/feed-silence-service.js");
    const result = await runFeedSilenceCheck();
    if (result.alertsFired > 0) {
      logger.warn(
        { alertsFired: result.alertsFired, silentStrategies: result.silentStrategies },
        "feed-silence-check: silence alerts fired",
      );
    } else {
      logger.debug(
        { strategiesChecked: result.strategiesChecked, rtbGate: result.rtbGate },
        "feed-silence-check: tick complete — no silence detected",
      );
    }
  });

  _PIPELINE_GATE_EXEMPT.add("feed-silence-check"); // Safety signal — must fire when paused

  cron.schedule("*/5 * * * *", async () => {
    if (!_tryAcquireJobLock("feed-silence-check")) return;
    try {
      const t0 = Date.now();
      await withRetry("feed-silence-check", SCHEDULER_JOBS["feed-silence-check"].run, 1);
      markJobRun("feed-silence-check");
      emitJobComplete("feed-silence-check", Date.now() - t0);
    } finally {
      _releaseJobLock("feed-silence-check");
    }
  });
  _scheduledJobs.add("feed-silence-check");

  // ─── Pass 1 Track D: Discord fanout audit every 30 min ─────────────────────
  // Keeps _webhookHealth in production-status.ts accurate. Without this cron,
  // the boot probe is the only read — health state goes stale after the first
  // 30-minute window. Exempt from pipeline gate (observability, not trading).
  registerJob("discord-fanout-audit-30min", 30 * 60 * 1000, async () => {
    await runDiscordFanoutAudit();
  });
  cron.schedule("*/30 * * * *", async () => {
    if (!_tryAcquireJobLock("discord-fanout-audit-30min")) return;
    try {
      const t0 = Date.now();
      await withRetry("discord-fanout-audit-30min", SCHEDULER_JOBS["discord-fanout-audit-30min"].run, 1);
      markJobRun("discord-fanout-audit-30min");
      emitJobComplete("discord-fanout-audit-30min", Date.now() - t0);
    } finally {
      _releaseJobLock("discord-fanout-audit-30min");
    }
  });
  _scheduledJobs.add("discord-fanout-audit-30min");

  // ─── A14: Synthetic Regime Bank — population cron (Sunday off-RTH) ────────────
  //
  // Fills synthetic_regime_bank with stochastic regime scenarios produced by the
  // Python generator (src/engine/synthetic/populate_regime_bank). Once the bank
  // has rows, black_swan_evaluator.py returns real survival rates instead of null.
  //
  // ADVISORY / CHALLENGER-ONLY — never gates capital. Additive cron only.
  //
  // Schedule: Sunday 03:00 ET (well off-RTH, low-competition with other jobs).
  //   EDT (UTC-4): Sun 07:00 UTC
  //   EST (UTC-5): Sun 08:00 UTC
  // DST-safe double-fire: cron fires at 7,8 UTC Sundays; ET-hour guard confirms
  // hour=3 (03:00 ET). Pattern mirrors db-backup-service DST handling.
  //
  // PIPELINE_GATE_EXEMPT: regime generation is research / data work — must run
  // even when the trading pipeline is paused so the bank stays populated.
  registerJob("synthetic-regime-bank-populate", 7 * 24 * 60 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    logger.info({ correlationId, jobName: "synthetic-regime-bank-populate" }, "cron tick start");
    await runSyntheticRegimeBankPopulate(correlationId);
  });

  // Fire Sunday at 07:00 UTC (03:00 ET EDT) and 08:00 UTC (03:00 ET EST).
  // ET-hour guard inside the handler confirms Sunday 03:00 ET only.
  cron.schedule("0 7,8 * * 0", async () => {
    if (!_tryAcquireJobLock("synthetic-regime-bank-populate")) return;
    try {
      const now = new Date();
      const etStr = now.toLocaleString("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        hour: "numeric",
        hour12: false,
      });
      // Must be Sunday at 03:00 ET
      if (!etStr.includes("Sun") || !etStr.includes("3")) {
        logger.debug(
          { etStr, utcHour: now.getUTCHours(), utcDay: now.getUTCDay() },
          "Scheduler: synthetic-regime-bank-populate cron fired but not Sunday 03:00 ET — skipping",
        );
        return;
      }
      // NOT pipeline-gated — in _PIPELINE_GATE_EXEMPT (research / data generation)
      logger.info(
        { job: "synthetic-regime-bank-populate" },
        "running pipeline-gate-exempt synthetic regime bank populate (Sunday 03:00 ET confirmed)",
      );
      const t0srb = Date.now();
      await withRetry("synthetic-regime-bank-populate", SCHEDULER_JOBS["synthetic-regime-bank-populate"].run, 1);
      markJobRun("synthetic-regime-bank-populate");
      emitJobComplete("synthetic-regime-bank-populate", Date.now() - t0srb);
    } finally {
      _releaseJobLock("synthetic-regime-bank-populate");
    }
  });
  _scheduledJobs.add("synthetic-regime-bank-populate");

  // ─── Pass 7 Track C.1: DEPLOYED Pine artifact daily reconciliation ───────
  // Queries all DEPLOYED strategies and checks whether each has a Pine export
  // artifact (strategy_export_artifacts) created in the last 24 hours. Writes
  // a deployed_pine_artifact_check.evaluated audit row listing missing ones.
  // Fires at 9:00 UTC (EDT 5 AM ET) and 10:00 UTC (EST 5 AM ET) — DST-safe
  // double-fire; ET-hour guard confirms 5 AM ET before running.
  // _PIPELINE_GATE_EXEMPT: DEPLOYED strategy artifact health is an ops safety
  // signal that must fire regardless of research pipeline pause state.
  registerJob("deployed-pine-artifact-check", 24 * 60 * 60 * 1000, async () => {
    const correlationId = randomUUID();
    const jobName = "deployed-pine-artifact-check";
    logger.info({ correlationId, job: jobName }, "deployed-pine-artifact-check: querying DEPLOYED strategies");

    // Find all DEPLOYED strategies
    const deployedStrategies = await db
      .select({ id: strategies.id, name: strategies.name })
      .from(strategies)
      .where(eq(strategies.lifecycleState, "DEPLOYED"));

    const missing: Array<{ strategyId: string; strategyName: string }> = [];
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

    for (const strat of deployedStrategies) {
      // Check for a recent completed export artifact
      const [latestExport] = await db
        .select({ id: strategyExports.id })
        .from(strategyExports)
        .where(
          and(
            eq(strategyExports.strategyId, strat.id),
            eq(strategyExports.status, "completed"),
          ),
        )
        .orderBy(desc(strategyExports.createdAt))
        .limit(1);

      if (!latestExport) {
        missing.push({ strategyId: strat.id, strategyName: strat.name });
        continue;
      }

      const [recentArtifact] = await db
        .select({ id: strategyExportArtifacts.id })
        .from(strategyExportArtifacts)
        .where(
          and(
            eq(strategyExportArtifacts.exportId, latestExport.id),
            gte(strategyExportArtifacts.createdAt, cutoff),
          ),
        )
        .limit(1);

      if (!recentArtifact) {
        missing.push({ strategyId: strat.id, strategyName: strat.name });
      }
    }

    await db.insert(auditLog).values({
      action: "deployed_pine_artifact_check.evaluated",
      entityType: "system",
      status: missing.length === 0 ? "success" : "warning",
      decisionAuthority: "system",
      input: { deployed_count: deployedStrategies.length, cutoff_hours: 24 },
      result: {
        missing_count: missing.length,
        missing_strategies: missing.map((m) => ({ id: m.strategyId, name: m.strategyName })),
      },
      correlationId,
    }).catch((auditErr: unknown) => {
      logger.warn({ err: auditErr }, "deployed-pine-artifact-check: audit insert failed (non-blocking)");
    });

    if (missing.length > 0) {
      // ─── FIX 2 (DEBT-1) 2026-06-24: auto-recompile missing Pine artifacts ────
      // When a DEPLOYED strategy is missing its artifact, autonomously attempt to
      // recompile. Cap: 1 auto-export per strategy per 24h (audit_log count).
      // On success: audit `pine.artifact_auto_recompiled` + Discord INFO.
      // On failure: audit `pine.artifact_auto_recompile_failed` + Discord CRITICAL + family postscript.
      const PINE_RECOMPILE_CAP_PER_24H = 1;
      const twentyFourHoursAgo2 = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const { compilePineExport } = await import("./services/pine-export-service.js");

      for (const strat of missing) {
        try {
          // Check 24h cap: count auto-recompile attempts for this strategy today
          const recentRecompiles = await db
            .select({ id: auditLog.id })
            .from(auditLog)
            .where(
              and(
                inArray(auditLog.action, ["pine.artifact_auto_recompiled", "pine.artifact_auto_recompile_failed"]),
                eq(auditLog.entityId, strat.strategyId),
                gte(auditLog.createdAt, twentyFourHoursAgo2),
              ),
            );

          if (recentRecompiles.length >= PINE_RECOMPILE_CAP_PER_24H) {
            logger.debug(
              { strategyId: strat.strategyId, recentCount: recentRecompiles.length, cap: PINE_RECOMPILE_CAP_PER_24H },
              "FIX-2: deployed-pine-artifact-check: auto-recompile cap reached for this strategy today, skipping",
            );
            continue;
          }

          logger.info(
            { strategyId: strat.strategyId, strategyName: strat.strategyName, correlationId },
            "FIX-2: auto-recompiling Pine artifact for DEPLOYED strategy",
          );

          await compilePineExport(strat.strategyId, undefined, "pine_indicator", null, correlationId);

          await db.insert(auditLog).values({
            action: "pine.artifact_auto_recompiled",
            entityType: "strategy",
            entityId: strat.strategyId,
            status: "success",
            decisionAuthority: "scheduler",
            input: { strategyName: strat.strategyName },
            result: { note: "Auto-recompiled by deployed-pine-artifact-check cron" },
            correlationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ err: auditErr, strategyId: strat.strategyId }, "FIX-2: pine.artifact_auto_recompiled audit write failed");
          });

          notifyWarning(
            `Pine Artifact Auto-Recompiled: ${strat.strategyName}`,
            appendFamilyGradePostscript(
              `DEPLOYED strategy \`${strat.strategyName}\` was missing its Pine artifact. ` +
              `Auto-recompile succeeded. TradingView alerting has been restored. (correlationId: ${correlationId})`,
              `A live strategy's TradingView chart file was missing and was automatically rebuilt.`,
              `No action needed — TradingView signals are working again. Ask Tony if you want more details.`,
            ),
          );

          logger.info(
            { strategyId: strat.strategyId, strategyName: strat.strategyName },
            "FIX-2: Pine artifact auto-recompile succeeded",
          );
        } catch (recompileErr) {
          logger.error(
            { strategyId: strat.strategyId, strategyName: strat.strategyName, err: recompileErr },
            "FIX-2: Pine artifact auto-recompile FAILED",
          );

          await db.insert(auditLog).values({
            action: "pine.artifact_auto_recompile_failed",
            entityType: "strategy",
            entityId: strat.strategyId,
            status: "failure",
            decisionAuthority: "scheduler",
            input: { strategyName: strat.strategyName },
            result: {
              error: recompileErr instanceof Error ? recompileErr.message : String(recompileErr),
              note: "Auto-recompile failed — TradingView alerting degraded",
            },
            correlationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ err: auditErr, strategyId: strat.strategyId }, "FIX-2: pine.artifact_auto_recompile_failed audit write failed");
          });

          notifyCritical(
            `Pine Artifact Auto-Recompile FAILED: ${strat.strategyName}`,
            appendFamilyGradePostscript(
              `Auto-recompile of Pine artifact for DEPLOYED strategy \`${strat.strategyName}\` FAILED. ` +
              `TradingView alerting is degraded — no new signals will be sent until the Pine file is rebuilt. ` +
              `Error: ${recompileErr instanceof Error ? recompileErr.message : String(recompileErr)}`,
              `A live strategy's TradingView chart file failed to rebuild automatically.`,
              `Tell Tony: '${strat.strategyName} Pine artifact failed to recompile.' ` +
              `The bot is still running safely, but TradingView will not get new signals until Tony fixes this.`,
            ),
            { strategyId: strat.strategyId, strategyName: strat.strategyName },
          );
        }
      }
      // ─── End FIX 2 ────────────────────────────────────────────

      // Original warn for operator log/dashboard visibility (kept after auto-recompile attempts)
      const names = missing.map((m) => `\`${m.strategyName}\``).join(", ");
      notifyWarning(
        `Pine Artifacts Missing: ${missing.length} DEPLOYED strategy/strategies lack TradingView artifact`,
        appendFamilyGradePostscript(
          `${missing.length} DEPLOYED strategy/strategies missing Pine artifacts (>24h old): ` +
          `${names}. Auto-recompile attempted (see audit log for results).`,
          "One or more live strategies were missing their TradingView chart files — auto-rebuild was attempted.",
          "Check the Trading Forge dashboard or ask Tony if TradingView signals are working.",
        ),
      );
    }

    logger.info(
      { correlationId, deployed: deployedStrategies.length, missing: missing.length },
      "deployed-pine-artifact-check: complete",
    );
  });

  // Fires at 09:00 UTC and 10:00 UTC — DST-safe double-fire for 5 AM ET.
  // ET-hour guard inside the handler confirms 5 AM ET before running.
  cron.schedule("0 9,10 * * *", async () => {
    if (!_tryAcquireJobLock("deployed-pine-artifact-check")) return;
    try {
      const now = new Date();
      const etHour = parseInt(
        now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
        10,
      );
      if (etHour !== 5) {
        logger.debug(
          { etHour, utcHour: now.getUTCHours() },
          "Scheduler: deployed-pine-artifact-check cron fired but not 5 AM ET — skipping",
        );
        return;
      }
      logger.info({ job: "deployed-pine-artifact-check" }, "running deployed-pine-artifact-check (5 AM ET confirmed)");
      const t0dpac = Date.now();
      await withRetry("deployed-pine-artifact-check", SCHEDULER_JOBS["deployed-pine-artifact-check"].run, 1);
      markJobRun("deployed-pine-artifact-check");
      emitJobComplete("deployed-pine-artifact-check", Date.now() - t0dpac);
    } finally {
      _releaseJobLock("deployed-pine-artifact-check");
    }
  });
  _scheduledJobs.add("deployed-pine-artifact-check");

  // ─── Candidate backtest conveyor — every 45 seconds ──────────────────────
  // Pipeline-gated: only runs when mode=ACTIVE. Finds CANDIDATE strategies
  // with no completed/running backtest and no failed backtest in the last 24h,
  // then enqueues walk-forward backtests up to the remaining slot budget
  // (MAX_CONCURRENT_BACKTESTS − currently-running backtests).
  //
  // HARD CONTRACT (paper-engine-authority Pass 5):
  //   Conveyor ONLY enqueues backtests. NEVER touches paper streams,
  //   TradersPost, or the broker path. SHADOW table invariant
  //   traderspost_webhook_called=false is never at risk here.
  //
  // Phase 3b: fire-and-forget checkAutoPromotions() after enqueue loop.
  registerJob("candidate-backtest-conveyor", 45 * 1000, async () => {
    const { runCandidateBacktestConveyor } = await import("./services/candidate-backtest-conveyor-service.js");
    await runCandidateBacktestConveyor();
  });

  cron.schedule("*/45 * * * * *", async () => {
    if (!_tryAcquireJobLock("candidate-backtest-conveyor")) return;
    try {
      const t0conv = Date.now();
      await withRetry("candidate-backtest-conveyor", SCHEDULER_JOBS["candidate-backtest-conveyor"].run, 1);
      markJobRun("candidate-backtest-conveyor");
      emitJobComplete("candidate-backtest-conveyor", Date.now() - t0conv);
    } finally { _releaseJobLock("candidate-backtest-conveyor"); }
  });
  _scheduledJobs.add("candidate-backtest-conveyor");

  // ─── Track C F-8: boot-time drift detection ────────────────
  // Compare SCHEDULER_JOBS registry against _scheduledJobs (populated by every
  // cron.schedule body). Catches the F-1/F-2 class of bug — a job registered
  // via registerJob() but never wired to a cron driver. Throws in non-prod to
  // fail-fast during development; logs an error in prod (operator escalation
  // via Discord critical channel via existing notifyCritical path is not yet
  // wired — TODO).
  _validateAllJobsScheduled();

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
 * Wave 25 Pass 2 A-2: Shared implementation for n8n drift detector crons.
 *
 * Spawns `npm run audit:n8n` as a child process with a 5-minute hard timeout.
 * Captures stdout + stderr + exit code. On every outcome, writes an audit_log
 * row so the operator can verify the check fired. On non-zero exit or spawn
 * error, also fires a Discord CRITICAL with plain-English remediation guidance.
 *
 * Called by both n8n-drift-detector-weekly and n8n-drift-detector-monthly so
 * the detection logic stays DRY across schedules.
 */
async function _runN8nDriftAudit(jobName: string): Promise<void> {
  const correlationId = randomUUID();
  const TIMEOUT_MS = 5 * 60 * 1000; // 5-minute hard timeout

  logger.info({ correlationId, jobName }, "n8n-drift-audit: starting audit:n8n subprocess");

  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;
  let timedOut = false;

  try {
    await new Promise<void>((resolve, reject) => {
      import("child_process").then(({ execFile }) => {
        // Use npm.cmd on Windows, npm on POSIX
        const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
        const proc = execFile(
          npmBin,
          ["run", "audit:n8n"],
          {
            cwd: process.cwd(),
            env: { ...process.env } as NodeJS.ProcessEnv,
            timeout: TIMEOUT_MS,
            maxBuffer: 512 * 1024, // 512 KB stdout buffer
          },
          (err, out, errOut) => {
            stdout = out ?? "";
            stderr = errOut ?? "";
            if (err) {
              // execFile populates err.code for non-zero exit; err.killed for timeout
              if ((err as NodeJS.ErrnoException & { killed?: boolean }).killed) {
                timedOut = true;
              }
              exitCode = (err as NodeJS.ErrnoException & { code?: unknown }).code === "ETIMEDOUT"
                ? -1
                : ((err as NodeJS.ErrnoException & { status?: number }).status ?? -1);
              reject(err);
            } else {
              exitCode = 0;
              resolve();
            }
          },
        );
        // Belt-and-suspenders timeout in case execFile option doesn't fire
        setTimeout(() => {
          timedOut = true;
          try { proc.kill("SIGTERM"); } catch { /* ignore */ }
        }, TIMEOUT_MS + 5000);
      }).catch(reject);
    });

    // Exit code 0 — clean
    logger.info({ correlationId, jobName, stdoutTail: stdout.slice(-300) }, "n8n-drift-audit: audit:n8n exited 0 — no drift");
    await insertAuditRow({
      action: "n8n.drift_check_clean",
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: { jobName, correlationId } as Record<string, unknown>,
      result: { exitCode: 0, stdoutTail: stdout.slice(-200) } as Record<string, unknown>,
      status: "success",
      correlationId,
    }).catch((err) => logger.error({ err, jobName }, "n8n-drift-audit: audit row write failed (clean)"));

  } catch (spawnErr) {
    const stderrSummary = stderr.slice(-500);
    const stdoutSummary = stdout.slice(-500);
    const resolvedExitCode = exitCode ?? -1;

    if (timedOut) {
      logger.error({ correlationId, jobName, timeoutMs: TIMEOUT_MS }, "n8n-drift-audit: audit:n8n TIMED OUT");
      await insertAuditRow({
        action: "n8n.drift_check_errored",
        entityType: "system",
        entityId: null,
        decisionAuthority: "system",
        input: { jobName, correlationId, timedOut: true } as Record<string, unknown>,
        result: { exitCode: resolvedExitCode, stderrSummary, stdoutSummary } as Record<string, unknown>,
        status: "failed",
        correlationId,
      }).catch((err) => logger.error({ err }, "n8n-drift-audit: audit row write failed (timeout)"));
      notifyCritical(
        "n8n drift detector TIMED OUT",
        appendFamilyGradePostscript(
          `The n8n drift check (${jobName}) did not complete within 5 minutes. ` +
            `This may indicate n8n API is unreachable or the audit script hung. ` +
            `Run \`npm run audit:n8n\` from the Skytech tower to investigate. ` +
            `Stderr tail: ${stderrSummary || "(empty)"}`,
          "A background health check for the strategy automation system timed out and could not finish.",
          "Tell Tony: 'The n8n drift check timed out.' He will investigate when available. No trading is affected.",
        ),
        { jobName, correlationId, timeoutMs: TIMEOUT_MS },
      );
    } else {
      logger.error({ correlationId, jobName, exitCode: resolvedExitCode, stderrSummary }, "n8n-drift-audit: audit:n8n exited non-zero — drift detected");
      await insertAuditRow({
        action: "n8n.drift_detected",
        entityType: "system",
        entityId: null,
        decisionAuthority: "system",
        input: { jobName, correlationId, exitCode: resolvedExitCode } as Record<string, unknown>,
        result: { exitCode: resolvedExitCode, stderrSummary, stdoutSummary } as Record<string, unknown>,
        status: "failed",
        correlationId,
      }).catch((err) => logger.error({ err }, "n8n-drift-audit: audit row write failed (drift)"));
      notifyCritical(
        "n8n workflow drift detected",
        appendFamilyGradePostscript(
          `n8n drift check (${jobName}) exited with code ${resolvedExitCode} — one or more workflows ` +
            `are missing errorWorkflow, retry config, or idempotency headers. ` +
            `Review and re-attach errorWorkflow (DGEk1D478xWJClKD) as needed. ` +
            `Run \`npm run audit:n8n\` from the Skytech tower to see the full drift report. ` +
            `Stdout: ${stdoutSummary || "(empty)"}`,
          "The background automation system has workflows that are missing safety configurations. This does not affect live trading but could slow down strategy discovery.",
          "Tell Tony: 'The n8n workflow check found a problem.' He will fix it when available. Check back tomorrow.",
        ),
        { jobName, correlationId, exitCode: resolvedExitCode, stderrSummary },
      );
    }
  }
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
 *
 * PAPER-ENGINE AUTHORITY (B5 — scheduler-b5):
 * For strategies in PAPER+ state (PAPER, DEPLOY_READY, PILOT, DEPLOYED), the
 * canonical journal is TradersPost's broker tape — NOT the internal Massive-WS
 * simulator. The internal simulator is pre-PAPER only (CANDIDATE/TESTING).
 * On TESTING→PAPER, stopStream() is called in-process but never persists
 * `paper_sessions.status='stopped'` to the DB, leaving stale 'active' rows.
 * Without this guard, every server restart would resurrect a fresh internal-
 * simulator stream for PAPER+ strategies while TradersPost is simultaneously
 * firing real paper orders — causing dual-stream P&L drift.
 *
 * Fix: skip stream resume for any session whose associated strategy is in
 * PAPER / DEPLOY_READY / PILOT / DEPLOYED lifecycle state. Emit an info audit
 * row before skipping so the boot log surface shows exactly which stale rows
 * exist and how many. Do NOT write paper_sessions.status — that is B6 deferred.
 */

/** Lifecycle states for which the internal simulator must NEVER be resurrected. */
const PAPER_PLUS_STATES = new Set(["PAPER", "DEPLOY_READY", "PILOT", "DEPLOYED"]);

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

  let resumeCount = 0;
  let skipCount = 0;
  const skippedSessionIds: string[] = [];

  for (const session of activeSessions) {
    try {
      // Resolve symbol list from strategy config.
      // NOTE: strategy row also used below for lifecycle_state check (B5).
      const strat = session.strategyId
        ? await db.select().from(strategies).where(eq(strategies.id, session.strategyId)).limit(1)
        : [];

      // ── B5: PAPER-ENGINE AUTHORITY GUARD ─────────────────────────────────
      // If the strategy is in PAPER+ state, the internal simulator must not
      // run. TradersPost owns the canonical journal from PAPER onward.
      // NULL lifecycleState (orphaned / legacy session with no strategy FK)
      // is treated as pre-PAPER (safe to resume) — fail-open on missing FK.
      const lifecycleState = strat[0]?.lifecycleState ?? null;
      if (lifecycleState !== null && PAPER_PLUS_STATES.has(lifecycleState)) {
        skipCount++;
        skippedSessionIds.push(session.id);
        logger.info(
          {
            sessionId: session.id,
            strategyId: session.strategyId,
            lifecycleState,
          },
          "B5: skipping internal-stream resume for PAPER+ strategy — TradersPost owns canonical journal",
        );
        await insertAuditRowSafe({
          action: "paper.session_resume_skipped_paper_plus",
          entityType: "paper_session",
          entityId: session.id as `${string}-${string}-${string}-${string}-${string}`,
          status: "success",
          decisionAuthority: "scheduler",
          result: {
            lifecycleState,
            strategyId: session.strategyId,
            reason: "internal-simulator must not run for PAPER+ strategies; TradersPost is canonical journal",
          },
        });
        continue;
      }
      // ── END B5 GUARD ─────────────────────────────────────────────────────

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
      resumeCount++;

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

  // B5: Boot-log summary — surfaces stale PAPER+ rows so operator knows they exist.
  if (skipCount > 0) {
    logger.info(
      { resumeCount, skipCount, skippedSessionIds },
      "B5: resumeActivePaperSessions complete — skipped PAPER+ sessions (stale status='active' rows; recon cron will sweep). Only pre-PAPER sessions get internal streams.",
    );
  } else {
    logger.info({ resumeCount }, "resumeActivePaperSessions complete — all resumed sessions are pre-PAPER");
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
          AlertFactory.driftAlert(strat.id, "Sharpe", deviation / oneSigma).catch((alertErr) =>
            logger.error(
              { err: alertErr, context: "rolling-sharpe-drift" },
              "AlertFactory.driftAlert failed — alert not persisted",
            ),
          );
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
        AlertFactory.driftAlert(session.strategyId, worstMetric.metric, maxDeviation).catch((alertErr) =>
          logger.error(
            { err: alertErr, context: "paper-vs-backtest-deviation" },
            "AlertFactory.driftAlert failed — alert not persisted",
          ),
        );
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
            AlertFactory.decayAlert(strat.id, "demotion").catch((alertErr) =>
              logger.error(
                { err: alertErr, context: "decay-monitor-demotion" },
                "AlertFactory.decayAlert failed — alert not persisted",
              ),
            );
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
          AlertFactory.decayAlert(strat.id, decayScore > 90 ? "quarantine" : "watch").catch((alertErr) =>
            logger.error(
              { err: alertErr, context: "decay-monitor-alert-only" },
              "AlertFactory.decayAlert failed — alert not persisted",
            ),
          );
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

  // ─── FIX 1 (DEBT-2) 2026-06-24: auto-restart failed_to_stream sessions ────
  // Sessions in `failed_to_stream` are terminal today — stream died at startup,
  // Discord WARN fired, and nothing fixed them. For vacation / family-distribution
  // mode we need autonomous recovery. Pattern mirrors heartbeat N-strikes auto-restart:
  //   - Count `paper.session_auto_restarted` rows in last 24h via audit_log
  //   - Cap at PAPER_STREAM_RESTART_CAP_PER_24H (3)
  //   - On cap hit: Discord CRITICAL + family-grade postscript + audit `paper.session_auto_restart_exhausted`
  const PAPER_STREAM_RESTART_CAP_PER_24H = 3;
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const failedToStreamSessions = await db
    .select({
      id: paperSessions.id,
      strategyId: paperSessions.strategyId,
      startedAt: paperSessions.startedAt,
      startingCapital: paperSessions.startingCapital,
      config: paperSessions.config,
      mode: paperSessions.mode,
      firmId: paperSessions.firmId,
    })
    .from(paperSessions)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .where(eq(paperSessions.status, "failed_to_stream" as any));

  for (const session of failedToStreamSessions) {
    try {
      // Count how many times we've already attempted for this session in the last 24h
      const recentRestarts = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "paper.session_auto_restarted"),
            eq(auditLog.entityId, session.id),
            gte(auditLog.createdAt, twentyFourHoursAgo),
          ),
        );

      const restartCount = recentRestarts.length;

      if (restartCount >= PAPER_STREAM_RESTART_CAP_PER_24H) {
        // Cap hit — check if we already wrote the exhaustion audit today
        const exhaustedToday = await db
          .select({ id: auditLog.id })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.action, "paper.session_auto_restart_exhausted"),
              eq(auditLog.entityId, session.id),
              gte(auditLog.createdAt, twentyFourHoursAgo),
            ),
          );

        if (exhaustedToday.length === 0) {
          // First time hitting the cap today — fire CRITICAL + write exhaustion audit
          await db.insert(auditLog).values({
            action: "paper.session_auto_restart_exhausted",
            entityType: "paper_session",
            entityId: session.id,
            status: "failure",
            decisionAuthority: "scheduler",
            input: {
              strategyId: session.strategyId,
              restart_count: restartCount,
              cap: PAPER_STREAM_RESTART_CAP_PER_24H,
            },
            result: { note: "Auto-restart cap hit — operator intervention required" },
            correlationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ err: auditErr, sessionId: session.id }, "paper.session_auto_restart_exhausted: audit write failed");
          });

          notifyCritical(
            `Paper session stream keeps crashing: session ${session.id.slice(0, 8)}`,
            appendFamilyGradePostscript(
              `Paper session \`${session.id.slice(0, 8)}\` (strategy ${session.strategyId?.slice(0, 8) ?? "unknown"}) ` +
              `has failed to restart ${restartCount} times in the last 24h. Manual intervention required. ` +
              `Check MASSIVE_API_KEY and data feed connectivity.`,
              "The paper trading session keeps crashing and has run out of automatic restart attempts.",
              "Tell Tony: 'The paper session keeps crashing — tell Tony to check the data connection.' He will restart it when available.",
            ),
            { sessionId: session.id, strategyId: session.strategyId, restartCount, cap: PAPER_STREAM_RESTART_CAP_PER_24H },
          );

          broadcastSSE("paper:auto_restart_exhausted", {
            sessionId: session.id,
            strategyId: session.strategyId,
            restartCount,
          });
        }
        continue;
      }

      // ─── Attempt restart ────────────────────────────────────────
      // Resolve strategy symbols (mirrors POST /api/paper/start symbol resolution)
      const strat = session.strategyId
        ? await db.select({ symbol: strategies.symbol, config: strategies.config })
            .from(strategies)
            .where(eq(strategies.id, session.strategyId))
            .limit(1)
        : [];

      const symbols: string[] = [];
      if (strat[0]?.symbol) symbols.push(strat[0].symbol);
      const stratConfig = strat[0]?.config as Record<string, unknown> | undefined;
      if (stratConfig?.symbol && !symbols.includes(String(stratConfig.symbol))) {
        symbols.push(String(stratConfig.symbol));
      }

      if (symbols.length === 0) {
        logger.warn({ sessionId: session.id, strategyId: session.strategyId }, "FIX-1: cannot auto-restart failed_to_stream session — no symbol found");
        continue;
      }

      logger.info(
        { sessionId: session.id, strategyId: session.strategyId, symbols, restartAttempt: restartCount + 1 },
        "FIX-1: auto-restarting failed_to_stream paper session",
      );

      // Write the attempt audit BEFORE starting stream (mirrors heartbeat pattern)
      await db.insert(auditLog).values({
        action: "paper.session_auto_restarted",
        entityType: "paper_session",
        entityId: session.id,
        status: "pending",
        decisionAuthority: "scheduler",
        input: {
          strategyId: session.strategyId,
          symbols,
          restart_attempt: restartCount + 1,
          cap: PAPER_STREAM_RESTART_CAP_PER_24H,
        },
        result: null,
        correlationId,
      }).catch((auditErr: unknown) => {
        logger.warn({ err: auditErr, sessionId: session.id }, "paper.session_auto_restarted: pre-attempt audit write failed");
      });

      // Reset status to `active` so startStream + paper signal flow can process it
      await db
        .update(paperSessions)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .set({ status: "active" as any })
        .where(eq(paperSessions.id, session.id));

      startStream(session.id, symbols);

      logger.info(
        { sessionId: session.id, symbols, restartAttempt: restartCount + 1 },
        "FIX-1: paper session stream restarted successfully",
      );

      broadcastSSE("paper:auto_restarted", {
        sessionId: session.id,
        strategyId: session.strategyId,
        restartAttempt: restartCount + 1,
        symbols,
      });
    } catch (restartErr) {
      logger.error({ sessionId: session.id, err: restartErr }, "FIX-1: failed_to_stream auto-restart threw unexpectedly");
    }
  }
  // ─── End FIX 1 ────────────────────────────────────────────────

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
            appendFamilyGradePostscript(
              `Session ${session.id.slice(0, 8)} failed to recover after ${MAX_RECOVERY_ATTEMPTS} attempts and was auto-stopped.`,
              "A paper trading session failed to restart after repeated attempts. The strategy has been stopped and will need to be restarted manually.",
              "Tell Tony: 'A paper trading session auto-stopped and could not recover.' He will restart it when available.",
            ),
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
      AlertFactory.driftAlert(strategyId, "live_drift", maxDeviation).catch((alertErr) =>
        logger.error(
          { err: alertErr, context: "post-trade-live-drift" },
          "AlertFactory.driftAlert failed — alert not persisted",
        ),
      );
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
          AlertFactory.decayAlert(strategyId, decayScore > 80 ? "quarantine" : "watch").catch((alertErr) =>
            logger.error(
              { err: alertErr, context: "post-trade-decay-check" },
              "AlertFactory.decayAlert failed — alert not persisted",
            ),
          );
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
