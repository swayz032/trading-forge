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
  agentHealthReports,
} from "../db/schema.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../index.js";
import { getSchedulerHealth } from "../scheduler.js";

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

interface DomainHealth {
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

async function probeDeepAR(): Promise<DomainHealth> {
  const start = Date.now();
  try {
    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const recent = await db
      .select()
      .from(deeparForecasts)
      .where(gte(deeparForecasts.generatedAt, cutoff))
      .orderBy(desc(deeparForecasts.generatedAt))
      .limit(5);

    const recommendations: string[] = [];
    if (recent.length === 0) {
      recommendations.push("No DeepAR forecasts in last 3 days — check training pipeline");
    }

    return {
      domain: "deepar",
      status: recent.length > 0 ? "healthy" : "degraded",
      latencyMs: Date.now() - start,
      errorCount: 0,
      details: { recentForecasts: recent.length },
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

async function probeScheduler(): Promise<DomainHealth> {
  const start = Date.now();
  try {
    const health = getSchedulerHealth();
    const now = Date.now();

    const staleJobs: string[] = [];
    for (const [name, lastRun] of Object.entries(health)) {
      const ageH = (now - new Date(lastRun).getTime()) / 3600000;
      if (ageH > 25) staleJobs.push(name); // More than a day without running
    }

    const recommendations: string[] = [];
    if (staleJobs.length > 0) {
      recommendations.push(`Stale scheduler jobs: ${staleJobs.join(", ")}`);
    }
    if (Object.keys(health).length === 0) {
      recommendations.push("No scheduler jobs have ever run — scheduler may not be initialized");
    }

    return {
      domain: "scheduler",
      status: staleJobs.length > 0 ? "degraded" : "healthy",
      latencyMs: Date.now() - start,
      errorCount: staleJobs.length,
      details: { registeredJobs: Object.keys(health).length, staleJobs },
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
