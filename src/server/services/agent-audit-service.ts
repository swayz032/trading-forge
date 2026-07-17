/**
 * Agent Audit Service — Phase 5: Agent Self-Audit
 *
 * Health checks for all 9 agent domains:
 *   lifecycle | paper | compliance | critic | deepar | decay | scout | risk | scheduler
 *
 * Each domain gets a liveness probe + basic sanity check.
 * Results are persisted to agent_health_reports for trend analysis.
 */

import { eq, desc, gte, and } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  strategies,
  paperSessions,
  complianceRulesets,
  complianceDriftLog,
  criticOptimizationRuns,
  deeparForecasts,
  deeparTrainingRuns,
  agentHealthReports,
} from "../db/schema.js";
import { broadcastSSE } from "../routes/sse.js";
// Track A F-5: Use leaf logger module, not ../index.js (Express bootstrap).
// Importing from ../index.js drags the full route/service graph into test
// isolation runs that mock db/schema.js partially, causing spurious failures.
import { logger } from "../lib/logger.js";
import { getSchedulerHealth, getAllJobHealth } from "../scheduler.js";

// ─── Domain Definitions ─────────────────────────────────────────────

const AGENT_DOMAINS = [
  "lifecycle",
  "paper",
  "compliance",
  "critic",
  "deepar",
  "decay",
  "scout",
  "risk",
  "scheduler",
] as const;

type AgentDomain = (typeof AGENT_DOMAINS)[number];

export interface DomainHealth {
  domain: AgentDomain;
  status: "healthy" | "degraded" | "down" | "unknown";
  latencyMs: number;
  errorCount: number;
  details: Record<string, unknown>;
  recommendations: string[];
}

// ─── Individual Domain Probes ───────────────────────────────────────

async function probeLifecycle(): Promise<DomainHealth> {
  const start = Date.now();
  try {
    const strats = await db
      .select({ state: strategies.lifecycleState })
      .from(strategies);

    const stateCounts: Record<string, number> = {};
    for (const s of strats) {
      stateCounts[s.state] = (stateCounts[s.state] ?? 0) + 1;
    }

    const recommendations: string[] = [];
    if (!stateCounts["PAPER"] && !stateCounts["DEPLOYED"]) {
      recommendations.push("No strategies in PAPER or DEPLOYED — pipeline may be stalled");
    }

    return {
      domain: "lifecycle",
      status: strats.length > 0 ? "healthy" : "degraded",
      latencyMs: Date.now() - start,
      errorCount: 0,
      details: { totalStrategies: strats.length, stateCounts },
      recommendations,
    };
  } catch {
    return { domain: "lifecycle", status: "down", latencyMs: Date.now() - start, errorCount: 1, details: {}, recommendations: ["Lifecycle probe failed — DB may be unreachable"] };
  }
}

async function probePaper(): Promise<DomainHealth> {
  const start = Date.now();
  try {
    const sessions = await db
      .select()
      .from(paperSessions)
      .where(eq(paperSessions.status, "active"));

    const recommendations: string[] = [];
    if (sessions.length === 0) {
      recommendations.push("No active paper sessions — consider starting paper trading for PAPER-stage strategies");
    }

    return {
      domain: "paper",
      status: "healthy",
      latencyMs: Date.now() - start,
      errorCount: 0,
      details: { activeSessions: sessions.length },
      recommendations,
    };
  } catch {
    return { domain: "paper", status: "down", latencyMs: Date.now() - start, errorCount: 1, details: {}, recommendations: ["Paper trading probe failed"] };
  }
}

async function probeCompliance(): Promise<DomainHealth> {
  const start = Date.now();
  try {
    const rulesets = await db.select().from(complianceRulesets);
    const now = new Date();
    const staleCount = rulesets.filter((r) => {
      const ageH = (now.getTime() - new Date(r.retrievedAt).getTime()) / 3600000;
      return ageH > 24 || r.driftDetected;
    }).length;

    const unresolvedDrifts = await db
      .select()
      .from(complianceDriftLog)
      .where(eq(complianceDriftLog.resolved, false));

    const recommendations: string[] = [];
    if (staleCount > 0) recommendations.push(`${staleCount} firm ruleset(s) are stale — refresh required`);
    if (unresolvedDrifts.length > 0) recommendations.push(`${unresolvedDrifts.length} unresolved drift event(s)`);

    return {
      domain: "compliance",
      status: staleCount > 0 || unresolvedDrifts.length > 0 ? "degraded" : "healthy",
      latencyMs: Date.now() - start,
      errorCount: 0,
      details: { totalRulesets: rulesets.length, staleCount, unresolvedDrifts: unresolvedDrifts.length },
      recommendations,
    };
  } catch {
    return { domain: "compliance", status: "down", latencyMs: Date.now() - start, errorCount: 1, details: {}, recommendations: ["Compliance probe failed"] };
  }
}

async function probeCritic(): Promise<DomainHealth> {
  const start = Date.now();
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentRuns = await db
      .select()
      .from(criticOptimizationRuns)
      .where(gte(criticOptimizationRuns.createdAt, cutoff))
      .orderBy(desc(criticOptimizationRuns.createdAt))
      .limit(20);

    const failedCount = recentRuns.filter((r) => r.status === "failed").length;
    const completedCount = recentRuns.filter((r) => r.status === "completed").length;

    const recommendations: string[] = [];
    if (recentRuns.length === 0) recommendations.push("No critic runs in the last 7 days");
    if (failedCount > completedCount && recentRuns.length > 3) {
      recommendations.push(`Critic failure rate is high: ${failedCount}/${recentRuns.length} failed`);
    }

    return {
      domain: "critic",
      status: failedCount > completedCount && recentRuns.length > 3 ? "degraded" : "healthy",
      latencyMs: Date.now() - start,
      errorCount: failedCount,
      details: { recentRuns: recentRuns.length, completed: completedCount, failed: failedCount },
      recommendations,
    };
  } catch {
    return { domain: "critic", status: "down", latencyMs: Date.now() - start, errorCount: 1, details: {}, recommendations: ["Critic probe failed"] };
  }
}

// deep-scan (DeepAR HIGH-2 sibling finding, 2026-07-17): mirrors
// deepar-service.ts::TRAINING_FRESHNESS_MS. Duplicated as a literal (not
// imported) rather than pulling in deepar-service.ts here — that module
// pulls in the Express bootstrap module for its own logger (see the F-5
// comment above this file's own logger import), and this file deliberately
// avoids that edge so agent-audit-service.ts stays safe to import in isolation.
const DEEPAR_TRAINING_FRESHNESS_MS = 8 * 24 * 60 * 60 * 1000;

// Exported (in addition to the PROBE_MAP registration below) so tests can
// exercise the DeepAR liveness beacon in isolation without mocking the other
// 8 domain probes' db.select() call sequence in runAgentHealthSweep().
export async function probeDeepAR(): Promise<DomainHealth> {
  const start = Date.now();
  try {
    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const recent = await db
      .select()
      .from(deeparForecasts)
      .where(gte(deeparForecasts.generatedAt, cutoff))
      .orderBy(desc(deeparForecasts.generatedAt))
      .limit(5);

    // deep-scan (DeepAR HIGH-2 sibling finding, 2026-07-17): the forecast-recency
    // check above reads "healthy" as long as SOME forecast row landed in the last
    // 3 days — even if the underlying model has not retrained in months. This is
    // the same false-green window health-dashboard.ts::deriveDeepARDashboardStatus()
    // closed for the live /api/health/dashboard endpoint; this persisted
    // agent_health_reports beacon (the durable, historical liveness trail — the
    // live dashboard has no history) gets the same honest training-freshness check
    // so a future silent-stop can't read "healthy" here either.
    const [latestTraining] = await db
      .select({ trainedAt: deeparTrainingRuns.trainedAt })
      .from(deeparTrainingRuns)
      .orderBy(desc(deeparTrainingRuns.trainedAt))
      .limit(1);
    const trainingFresh = latestTraining?.trainedAt
      ? Date.now() - latestTraining.trainedAt.getTime() <= DEEPAR_TRAINING_FRESHNESS_MS
      : false;

    const recommendations: string[] = [];
    if (recent.length === 0) {
      recommendations.push("No DeepAR forecasts in last 3 days — check training pipeline");
    }
    if (!trainingFresh) {
      recommendations.push("DeepAR model has not retrained within the freshness window — forecasts (if any) may be fed by a stale model");
    }

    const healthy = recent.length > 0 && trainingFresh;

    return {
      domain: "deepar",
      status: healthy ? "healthy" : "degraded",
      latencyMs: Date.now() - start,
      errorCount: 0,
      details: {
        recentForecasts: recent.length,
        trainingFresh,
        latestTrainingAt: latestTraining?.trainedAt?.toISOString() ?? null,
      },
      recommendations,
    };
  } catch {
    return { domain: "deepar", status: "down", latencyMs: Date.now() - start, errorCount: 1, details: {}, recommendations: ["DeepAR probe failed"] };
  }
}

async function probeDecay(): Promise<DomainHealth> {
  const start = Date.now();
  try {
    // Check if any DEPLOYED strategies have decaying Sharpe
    const deployed = await db
      .select({ id: strategies.id, name: strategies.name, sharpe: strategies.rollingSharpe30d })
      .from(strategies)
      .where(eq(strategies.lifecycleState, "DEPLOYED"));

    const decaying = deployed.filter((s) => s.sharpe !== null && Number(s.sharpe) < 1.0);
    const recommendations: string[] = [];
    if (decaying.length > 0) {
      recommendations.push(`${decaying.length} DEPLOYED strategy(ies) have rolling Sharpe < 1.0 — monitor for demotion`);
    }

    return {
      domain: "decay",
      status: decaying.length > 0 ? "degraded" : "healthy",
      latencyMs: Date.now() - start,
      errorCount: 0,
      details: { deployedCount: deployed.length, decayingCount: decaying.length },
      recommendations,
    };
  } catch {
    return { domain: "decay", status: "down", latencyMs: Date.now() - start, errorCount: 1, details: {}, recommendations: ["Decay probe failed"] };
  }
}

async function probeScout(): Promise<DomainHealth> {
  const start = Date.now();
  try {
    // Scout health: check if CANDIDATE strategies are being generated
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentCandidates = await db
      .select({ id: strategies.id })
      .from(strategies)
      .where(and(eq(strategies.lifecycleState, "CANDIDATE"), gte(strategies.createdAt, cutoff)));

    const recommendations: string[] = [];
    if (recentCandidates.length === 0) {
      recommendations.push("No new CANDIDATE strategies in 7 days — scout pipeline may be stalled");
    }

    return {
      domain: "scout",
      status: recentCandidates.length > 0 ? "healthy" : "degraded",
      latencyMs: Date.now() - start,
      errorCount: 0,
      details: { recentCandidates: recentCandidates.length },
      recommendations,
    };
  } catch {
    return { domain: "scout", status: "down", latencyMs: Date.now() - start, errorCount: 1, details: {}, recommendations: ["Scout probe failed"] };
  }
}

async function probeRisk(): Promise<DomainHealth> {
  const start = Date.now();
  try {
    // Risk health: check active paper sessions have sane equity
    const sessions = await db
      .select()
      .from(paperSessions)
      .where(eq(paperSessions.status, "active"));

    const breachedSessions = sessions.filter((s) => {
      const equity = Number(s.currentEquity);
      const starting = Number(s.startingCapital);
      const drawdown = starting - equity;
      return drawdown > 2000; // Prop firm max DD
    });

    const recommendations: string[] = [];
    if (breachedSessions.length > 0) {
      recommendations.push(`${breachedSessions.length} session(s) near or past max drawdown limit`);
    }

    return {
      domain: "risk",
      status: breachedSessions.length > 0 ? "degraded" : "healthy",
      latencyMs: Date.now() - start,
      errorCount: 0,
      details: { activeSessions: sessions.length, breachedSessions: breachedSessions.length },
      recommendations,
    };
  } catch {
    return { domain: "risk", status: "down", latencyMs: Date.now() - start, errorCount: 1, details: {}, recommendations: ["Risk probe failed"] };
  }
}

// HIGH finding (2026-07-17 telemetry-honesty scan): getSchedulerHealth() only
// records a timestamp on cron SUCCESS (scheduler.ts::schedulerHealth[name] =
// new Date() runs after the try succeeds). A job that fails on EVERY run
// never gets an entry there — it is invisible to a staleness check keyed off
// that map alone and the probe reports "healthy". scheduler.ts already
// tracks failures independently via jobHealthTracker (consecutiveFailures /
// lastFailure / disabled), exposed read-only via getAllJobHealth() — this
// probe now also consults that map so a consistently-failing job (with or
// without ANY prior success) is surfaced as degraded/down instead of absent.
const SCHEDULER_PROBE_FAILURE_THRESHOLD = 3;

export async function probeScheduler(): Promise<DomainHealth> {
  const start = Date.now();
  try {
    const health = getSchedulerHealth();
    const jobHealth = getAllJobHealth();
    const now = Date.now();

    const staleJobs: string[] = [];
    for (const [name, lastRun] of Object.entries(health)) {
      const ageH = (now - new Date(lastRun).getTime()) / 3600000;
      if (ageH > 25) staleJobs.push(name); // More than a day without running
    }

    // Jobs with sustained consecutive failures (or auto-disabled after
    // repeated failure). This catches the case a stale-timestamp check can
    // never catch: a job that has NEVER once succeeded has no entry in
    // `health` at all, so it would otherwise never appear anywhere in this
    // probe's output.
    const failingJobs: string[] = [];
    const neverSucceededFailingJobs: string[] = [];
    const disabledJobs: string[] = [];
    for (const [name, jh] of jobHealth.entries()) {
      if (jh.disabled) disabledJobs.push(name);
      if (jh.consecutiveFailures >= SCHEDULER_PROBE_FAILURE_THRESHOLD) {
        failingJobs.push(name);
        if (!(name in health)) neverSucceededFailingJobs.push(name);
      }
    }

    const recommendations: string[] = [];
    if (staleJobs.length > 0) {
      recommendations.push(`Stale scheduler jobs: ${staleJobs.join(", ")}`);
    }
    if (neverSucceededFailingJobs.length > 0) {
      recommendations.push(
        `Jobs failing on EVERY run (no recorded success ever): ${neverSucceededFailingJobs.join(", ")}`,
      );
    }
    if (failingJobs.length > 0) {
      recommendations.push(`Jobs with ${SCHEDULER_PROBE_FAILURE_THRESHOLD}+ consecutive failures: ${failingJobs.join(", ")}`);
    }
    if (disabledJobs.length > 0) {
      recommendations.push(`Jobs auto-disabled after repeated failure: ${disabledJobs.join(", ")}`);
    }
    if (Object.keys(health).length === 0 && jobHealth.size === 0) {
      recommendations.push("No scheduler jobs have ever run — scheduler may not be initialized");
    }

    const status: DomainHealth["status"] =
      disabledJobs.length > 0 || neverSucceededFailingJobs.length > 0
        ? "down"
        : staleJobs.length > 0 || failingJobs.length > 0
          ? "degraded"
          : "healthy";

    return {
      domain: "scheduler",
      status,
      latencyMs: Date.now() - start,
      errorCount: staleJobs.length + failingJobs.length,
      details: {
        registeredJobs: Object.keys(health).length,
        staleJobs,
        failingJobs,
        neverSucceededFailingJobs,
        disabledJobs,
      },
      recommendations,
    };
  } catch {
    return { domain: "scheduler", status: "down", latencyMs: Date.now() - start, errorCount: 1, details: {}, recommendations: ["Scheduler probe failed"] };
  }
}

// ─── Probe Registry ─────────────────────────────────────────────────

const PROBE_MAP: Record<AgentDomain, () => Promise<DomainHealth>> = {
  lifecycle: probeLifecycle,
  paper: probePaper,
  compliance: probeCompliance,
  critic: probeCritic,
  deepar: probeDeepAR,
  decay: probeDecay,
  scout: probeScout,
  risk: probeRisk,
  scheduler: probeScheduler,
};

// ─── Full Health Sweep ──────────────────────────────────────────────

export interface HealthSweepResult {
  overallStatus: "healthy" | "degraded" | "critical";
  domains: DomainHealth[];
  allRecommendations: string[];
  timestamp: string;
}

/**
 * Run health checks across all 9 agent domains.
 * Persists results and broadcasts SSE summary.
 */
export async function runAgentHealthSweep(): Promise<HealthSweepResult> {
  const results: DomainHealth[] = [];

  for (const domain of AGENT_DOMAINS) {
    try {
      const result = await PROBE_MAP[domain]();
      results.push(result);
    } catch (err) {
      results.push({
        domain,
        status: "unknown",
        latencyMs: 0,
        errorCount: 1,
        details: { error: String(err) },
        recommendations: [`${domain} probe threw an unhandled exception`],
      });
    }
  }

  // Persist each domain result
  for (const r of results) {
    try {
      await db.insert(agentHealthReports).values({
        domain: r.domain,
        status: r.status,
        lastCheckedAt: new Date(),
        latencyMs: r.latencyMs,
        errorCount: r.errorCount,
        details: r.details,
        recommendations: r.recommendations,
      });
    } catch (err) {
      logger.error({ domain: r.domain, err }, "Failed to persist health report");
    }
  }

  // Compute overall status
  const downCount = results.filter((r) => r.status === "down").length;
  const degradedCount = results.filter((r) => r.status === "degraded").length;

  let overallStatus: "healthy" | "degraded" | "critical" = "healthy";
  if (downCount >= 2) overallStatus = "critical";
  else if (downCount >= 1 || degradedCount >= 3) overallStatus = "degraded";

  const allRecommendations = results.flatMap((r) => r.recommendations);

  const sweep: HealthSweepResult = {
    overallStatus,
    domains: results,
    allRecommendations,
    timestamp: new Date().toISOString(),
  };

  // Broadcast
  broadcastSSE("agent:health_sweep", {
    overallStatus,
    healthy: results.filter((r) => r.status === "healthy").length,
    degraded: degradedCount,
    down: downCount,
    recommendations: allRecommendations.length,
    timestamp: sweep.timestamp,
  });

  if (overallStatus !== "healthy") {
    logger.warn(
      { overallStatus, downCount, degradedCount, recommendations: allRecommendations },
      "Agent health sweep detected issues",
    );
  } else {
    logger.info("Agent health sweep: all 9 domains healthy");
  }

  return sweep;
}
