/**
 * GET /api/health/dashboard
 *
 * Rich operational health snapshot for the Trading Forge dashboard.
 * All subsystem checks run concurrently via Promise.allSettled with a 2s timeout
 * so a single hanging dependency never blocks the whole response.
 *
 * Complements the lightweight /api/health liveness probe. This endpoint is
 * intended for the internal ops dashboard — it is auth-gated (mounted after
 * the auth middleware in index.ts).
 *
 * Response shape:
 * {
 *   timestamp, uptimeSeconds,
 *   subsystems: { postgres, ollama, python, n8n },
 *   scheduler:  { jobs: JobStatus[] },
 *   circuitBreakers: { [name]: CircuitBreakerStatus },
 *   topology: {
 *     status, generatedSectionPresent, driftItems, counts,
 *     registryCoverage, workflowSummary, subsystems, engineSubsystems, manualGates,
 *     preprodIntegrity, productionConvergence, readiness, runtimeControls
 *   },
 *   paperSessions: { active, stale, total },
 *   metrics: SessionMetrics[],
 *   memory: { heapUsedMb, heapTotalMb, rssMb, externalMb },
 *   responseMs
 * }
 */

import { Router, Request, Response } from "express";
import { spawn } from "child_process";
import { sql, eq, lt, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { paperSessions, deadLetterQueue } from "../db/schema.js";
import { CircuitBreakerRegistry } from "../lib/circuit-breaker.js";
import { checkSystemMapDrift, type RegistrySubsystemSummary } from "../lib/system-topology.js";
import { getDeepARRuntimeStatus } from "../services/deepar-service.js";
import { getQuantumRuntimeStatus } from "../services/quantum-mc-service.js";
import { getPythonSubprocessStats } from "../lib/python-runner.js";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────

/** Wraps a promise with a hard 2-second timeout. */
function withTimeout<T>(p: Promise<T>, timeoutMs = 2000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`check timed out after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
}

/** Resolves a Promise.allSettled result into { ok, latencyMs, error?, ...extra }. */
function settledToStatus(
  result: PromiseSettledResult<{ latencyMs: number; [key: string]: unknown }>,
): { status: string; latencyMs: number; [key: string]: unknown } {
  if (result.status === "fulfilled") {
    return { status: "ok", ...result.value };
  }
  const err = result.reason instanceof Error ? result.reason.message : String(result.reason);
  return { status: "error", latencyMs: 0, error: err };
}

// ─── Individual subsystem checks ──────────────────────────────

async function checkPostgres(): Promise<{ latencyMs: number }> {
  const t0 = Date.now();
  await db.execute(sql`SELECT 1`);
  return { latencyMs: Date.now() - t0 };
}

async function checkOllama(): Promise<{ latencyMs: number; modelCount?: number }> {
  const t0 = Date.now();
  const ollamaUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const resp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const body = (await resp.json()) as { models?: unknown[] };
  return { latencyMs: Date.now() - t0, modelCount: body.models?.length ?? 0 };
}

async function checkPython(): Promise<{ latencyMs: number; version: string }> {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const proc = spawn(pythonCmd, ["--version"], { env: { ...process.env } });
    let out = "";
    let settled = false;

    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      proc.kill("SIGTERM");
      if (err) reject(err);
    };

    proc.stdout.on("data", (d: Buffer) => (out += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (out += d.toString())); // Python 2 uses stderr
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      const version = out.trim();
      if (code === 0 && version) {
        resolve({ latencyMs: Date.now() - t0, version });
      } else {
        reject(new Error(version || `exit code ${code}`));
      }
    });
    proc.on("error", done);
  });
}

async function checkN8n(): Promise<{
  latencyMs: number;
  status: string;
  workflowVisibility?: string;
  activeWorkflowCount?: number;
  inactiveWorkflowCount?: number;
  archivedWorkflowCount?: number;
}> {
  const n8nUrl = process.env.N8N_BASE_URL;
  if (!n8nUrl) throw new Error("N8N_BASE_URL not set");
  const t0 = Date.now();
  const resp = await fetch(`${n8nUrl}/healthz`, { signal: AbortSignal.timeout(2000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const apiKey = process.env.N8N_API_KEY;
  if (!apiKey) {
    return { latencyMs: Date.now() - t0, status: "ok" };
  }

  const workflowResp = await fetch(`${n8nUrl}/api/v1/workflows?limit=250`, {
    signal: AbortSignal.timeout(2000),
    headers: {
      "X-N8N-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
  });
  if (!workflowResp.ok) throw new Error(`workflow API HTTP ${workflowResp.status}`);

  const workflowBody = await workflowResp.json() as {
    data?: Array<{ active?: boolean; isArchived?: boolean }>;
  };
  const workflows = workflowBody.data ?? [];
  const activeWorkflowCount = workflows.filter((workflow) => workflow.active && !workflow.isArchived).length;
  const archivedWorkflowCount = workflows.filter((workflow) => workflow.isArchived).length;

  return {
    latencyMs: Date.now() - t0,
    status: "ok",
    workflowVisibility: "api-backed",
    activeWorkflowCount,
    inactiveWorkflowCount: workflows.length - activeWorkflowCount - archivedWorkflowCount,
    archivedWorkflowCount,
  };
}

// ─── Paper session counts ──────────────────────────────────────

interface PaperSessionCounts {
  active: number;
  stale: number;
  total: number;
}

async function getPaperSessionCounts(): Promise<PaperSessionCounts> {
  // "Stale" = active but no trade/signal for more than 2 hours — same definition
  // used by the stale-session detector in the scheduler.
  const staleThreshold = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const [activeCnt, staleCnt, totalCnt] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(paperSessions)
      .where(eq(paperSessions.status, "active"))
      .then((r) => r[0]?.count ?? 0),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(paperSessions)
      .where(
        and(
          eq(paperSessions.status, "active"),
          lt(paperSessions.startedAt, staleThreshold),
        ),
      )
      .then((r) => r[0]?.count ?? 0),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(paperSessions)
      .then((r) => r[0]?.count ?? 0),
  ]);

  return { active: activeCnt, stale: staleCnt, total: totalCnt };
}

// ─── Scheduler job status ─────────────────────────────────────

interface SchedulerJobStatus {
  name: string;
  lastRunAt: string | null;
  intervalMs: number;
  overdueMs: number | null;
}

interface OperationalSubsystemStatus {
  id: string;
  status: "healthy" | "degraded" | "stale" | "blocked";
  manualGate: string;
  operatingClass: string;
  learningMode: string;
  productionTargetState: string;
  ownerSurface: string;
  overdueJobs: string[];
  reasons: string[];
}

interface OperationalReadinessSummary {
  overallStatus: "healthy" | "degraded" | "blocked";
  counts: Record<OperationalSubsystemStatus["status"], number>;
  blockers: string[];
  subsystems: OperationalSubsystemStatus[];
}

async function getSchedulerStatus(): Promise<SchedulerJobStatus[]> {
  const { getSchedulerJobs } = await import("../scheduler.js");
  const jobs = getSchedulerJobs();
  const now = Date.now();
  return Object.entries(jobs).map(([name, meta]) => {
    const lastRunAt = meta.lastRunAt ? meta.lastRunAt.toISOString() : null;
    const overdueMs =
      meta.lastRunAt
        ? Math.max(0, now - (meta.lastRunAt.getTime() + meta.intervalMs))
        : null;
    return { name, lastRunAt, intervalMs: meta.intervalMs, overdueMs };
  });
}

function buildOperationalReadiness(params: {
  subsystems: RegistrySubsystemSummary[];
  schedulerJobs: SchedulerJobStatus[];
  subsystemChecks: {
    postgres: { status: string };
    python: { status: string };
    n8n: { status: string };
  };
  topologyStatus: string;
  paperSessionStaleCount: number | null;
  runtimeControlsBlocked: boolean;
}): OperationalReadinessSummary {
  const schedulerByName = new Map(params.schedulerJobs.map((job) => [job.name, job] as const));

  const subsystems = params.subsystems
    .map<OperationalSubsystemStatus>((subsystem) => {
      const reasons: string[] = [];
      const overdueJobs = subsystem.schedulerJobs
        .filter((jobName) => (schedulerByName.get(jobName)?.overdueMs ?? 0) > 0
          || schedulerByName.get(jobName)?.lastRunAt == null)
        .sort((a, b) => a.localeCompare(b));

      if (!subsystem.launchReady || subsystem.coverageGaps.length > 0 || subsystem.authorityStatus !== "correct") {
        reasons.push("topology readiness blocked");
      }
      if (overdueJobs.length > 0) {
        reasons.push(`overdue scheduler jobs: ${overdueJobs.join(", ")}`);
      }
      if (subsystem.ownerSurface.includes("node") && params.subsystemChecks.postgres.status !== "ok") {
        reasons.push(`postgres dependency ${params.subsystemChecks.postgres.status}`);
      }
      if (subsystem.ownerSurface.includes("python") && params.subsystemChecks.python.status !== "ok") {
        reasons.push(`python dependency ${params.subsystemChecks.python.status}`);
      }
      if (subsystem.ownerSurface.includes("n8n") && params.subsystemChecks.n8n.status !== "ok") {
        reasons.push(`n8n dependency ${params.subsystemChecks.n8n.status}`);
      }
      if (subsystem.id === "workflow_orchestration" && params.topologyStatus !== "ok") {
        reasons.push("workflow topology drift detected");
      }
      if (params.runtimeControlsBlocked && subsystem.productionTargetState !== "production_experimental") {
        reasons.push("production runtime controls blocked");
      }
      if (
        params.paperSessionStaleCount != null
        && params.paperSessionStaleCount > 0
        && (subsystem.id === "context_execution" || subsystem.id === "strategy_lifecycle")
      ) {
        reasons.push(`stale paper sessions: ${params.paperSessionStaleCount}`);
      }

      let status: OperationalSubsystemStatus["status"] = "healthy";
      if (reasons.some((reason) => reason.includes("blocked"))) {
        status = "blocked";
      } else if (overdueJobs.length > 0) {
        status = "stale";
      } else if (reasons.length > 0) {
        status = "degraded";
      }

      return {
        id: subsystem.id,
        status,
        manualGate: subsystem.manualGate,
        operatingClass: subsystem.operatingClass,
        learningMode: subsystem.learningMode,
        productionTargetState: subsystem.productionTargetState,
        ownerSurface: subsystem.ownerSurface,
        overdueJobs,
        reasons,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const counts = subsystems.reduce<Record<OperationalSubsystemStatus["status"], number>>(
    (acc, subsystem) => {
      acc[subsystem.status] += 1;
      return acc;
    },
    { healthy: 0, degraded: 0, stale: 0, blocked: 0 },
  );

  const blockers = subsystems
    .filter((subsystem) => subsystem.status !== "healthy")
    .flatMap((subsystem) => subsystem.reasons.map((reason) => `${subsystem.id}:${reason}`))
    .sort((a, b) => a.localeCompare(b));

  return {
    overallStatus: counts.blocked > 0 ? "blocked" : counts.degraded > 0 || counts.stale > 0 ? "degraded" : "healthy",
    counts,
    blockers,
    subsystems,
  };
}

// ─── DLQ health ───────────────────────────────────────────────

interface DLQHealth {
  unresolvedCount: number;
  escalatedCount: number;
  oldestUnresolvedAgeMs: number | null;
  byCategory: Record<string, number>;
}

async function getDLQHealth(): Promise<DLQHealth> {
  const [summary] = await db.select({
    unresolved: sql<number>`count(*) filter (where resolved = false)::int`,
    escalated: sql<number>`count(*) filter (where escalated = true and resolved = false)::int`,
    oldestUnresolved: sql<string>`min(first_failed_at) filter (where resolved = false)`,
  }).from(deadLetterQueue);

  const byOpType = await db.select({
    operationType: deadLetterQueue.operationType,
    count: sql<number>`count(*)::int`,
  })
    .from(deadLetterQueue)
    .where(eq(deadLetterQueue.resolved, false))
    .groupBy(deadLetterQueue.operationType);

  const byCategory: Record<string, number> = {};
  for (const row of byOpType) {
    byCategory[row.operationType] = row.count;
  }

  const oldestUnresolvedAgeMs = summary?.oldestUnresolved
    ? Date.now() - new Date(summary.oldestUnresolved).getTime()
    : null;

  return {
    unresolvedCount: summary?.unresolved ?? 0,
    escalatedCount: summary?.escalated ?? 0,
    oldestUnresolvedAgeMs,
    byCategory,
  };
}

// ─── Route handler ─────────────────────────────────────────────

router.get("/dashboard", async (req: Request, res: Response) => {
  const startMs = Date.now();

  // Fire all slow checks concurrently, each capped at 2s
  const [
    postgresResult,
    ollamaResult,
    pythonResult,
    n8nResult,
    paperResult,
    schedulerResult,
    topologyResult,
    deeparResult,
    quantumResult,
    dlqResult,
  ] = await Promise.allSettled([
    withTimeout(checkPostgres()),
    withTimeout(checkOllama()),
    withTimeout(checkPython()),
    withTimeout(checkN8n()),
    withTimeout(getPaperSessionCounts()),
    withTimeout(getSchedulerStatus()),
    withTimeout(checkSystemMapDrift()),
    withTimeout(getDeepARRuntimeStatus()),
    withTimeout(getQuantumRuntimeStatus()),
    withTimeout(getDLQHealth()),
  ]);

  // Metrics — synchronous, no I/O
  let metrics: unknown[] = [];
  try {
    const { metricsAggregator } = await import("../services/metrics-aggregator.js");
    metrics = metricsAggregator.getAllMetrics();
  } catch (metricsErr) {
    req.log.warn({ err: metricsErr }, "health/dashboard: metricsAggregator unavailable");
  }

  // Circuit breakers — synchronous
  let circuitBreakers: unknown = {};
  try {
    circuitBreakers = CircuitBreakerRegistry.statusAll();
  } catch (cbErr) {
    req.log.warn({ err: cbErr }, "health/dashboard: CircuitBreakerRegistry.statusAll failed");
  }

  const mem = process.memoryUsage();

  const paperCounts =
    paperResult.status === "fulfilled"
      ? paperResult.value
      : { active: null, stale: null, total: null, error: (paperResult.reason as Error)?.message };

  const schedulerJobs =
    schedulerResult.status === "fulfilled" ? schedulerResult.value : [];

  const topology =
    topologyResult.status === "fulfilled"
      ? {
          status: topologyResult.value.status,
          generatedSectionPresent: topologyResult.value.generatedSectionPresent,
          manualTradingViewDeployOnly: topologyResult.value.manualTradingViewDeployOnly,
          driftItems: topologyResult.value.driftItems,
          counts: topologyResult.value.snapshot?.counts ?? null,
          registryCoverage: topologyResult.value.registryCoverage ?? null,
          workflowSummary: topologyResult.value.workflowSummary ?? null,
          runtimeControls: topologyResult.value.snapshot?.runtimeControls ?? null,
          subsystems: topologyResult.value.snapshot?.subsystemSummaries ?? [],
          engineSubsystems: topologyResult.value.snapshot?.engineSubsystemSummaries ?? [],
          manualGates: topologyResult.value.snapshot?.manualGates ?? [],
          preprodIntegrity: topologyResult.value.registryCoverage?.preprodIntegrity ?? null,
          productionConvergence: topologyResult.value.registryCoverage?.productionConvergence ?? null,
          readiness: topologyResult.value.registryCoverage?.readiness ?? null,
          checkedAt: topologyResult.value.checkedAt,
          error: topologyResult.value.error,
          operationalReadiness: buildOperationalReadiness({
            subsystems: topologyResult.value.snapshot?.subsystemSummaries ?? [],
            schedulerJobs,
            subsystemChecks: {
              postgres: settledToStatus(postgresResult),
              python: settledToStatus(pythonResult),
              n8n: settledToStatus(n8nResult),
            },
            topologyStatus: topologyResult.value.status,
            paperSessionStaleCount: paperResult.status === "fulfilled" ? paperResult.value.stale : null,
            runtimeControlsBlocked: topologyResult.value.snapshot?.runtimeControls.status === "blocked",
          }),
        }
      : {
          status: "error",
          generatedSectionPresent: false,
          manualTradingViewDeployOnly: false,
          driftItems: [],
          counts: null,
          registryCoverage: null,
          workflowSummary: null,
          runtimeControls: null,
          subsystems: [],
          engineSubsystems: [],
          manualGates: [],
          preprodIntegrity: null,
          productionConvergence: null,
          readiness: null,
          checkedAt: new Date().toISOString(),
          error: topologyResult.reason instanceof Error ? topologyResult.reason.message : String(topologyResult.reason),
          operationalReadiness: {
            overallStatus: "blocked",
            counts: { healthy: 0, degraded: 0, stale: 0, blocked: 0 },
            blockers: ["topology:error"],
            subsystems: [],
          },
        };

  res.json({
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    subsystems: {
      postgres: settledToStatus(postgresResult),
      ollama: settledToStatus(ollamaResult),
      python: { ...settledToStatus(pythonResult), pool: getPythonSubprocessStats() },
      n8n: settledToStatus(n8nResult),
    },
    scheduler: {
      jobs: schedulerJobs,
    },
    circuitBreakers,
    topology,
    advancedModels: {
      deepar:
        deeparResult.status === "fulfilled"
          ? { status: "ok", ...deeparResult.value }
          : { status: "error", error: deeparResult.reason instanceof Error ? deeparResult.reason.message : String(deeparResult.reason) },
      quantum:
        quantumResult.status === "fulfilled"
          ? { status: "ok", ...quantumResult.value }
          : { status: "error", error: quantumResult.reason instanceof Error ? quantumResult.reason.message : String(quantumResult.reason) },
    },
    paperSessions: paperCounts,
    dlqHealth: dlqResult.status === "fulfilled"
      ? dlqResult.value
      : {
          unresolvedCount: null,
          escalatedCount: null,
          oldestUnresolvedAgeMs: null,
          byCategory: null,
          error: dlqResult.reason instanceof Error ? dlqResult.reason.message : String(dlqResult.reason),
        },
    metrics,
    memory: {
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      rssMb: Math.round(mem.rss / 1024 / 1024),
      externalMb: Math.round(mem.external / 1024 / 1024),
    },
    responseMs: Date.now() - startMs,
  });
});

export { router as healthDashboardRoutes };
