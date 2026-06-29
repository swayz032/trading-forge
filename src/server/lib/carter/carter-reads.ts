/**
 * carter-reads.ts — Handler implementations for all Carter voice-agent read tools.
 *
 * Each handler is a pure async function that accepts a `params` object and
 * returns a plain JSON-serialisable result. Handlers MUST NOT mutate any
 * system state. They surface information only.
 *
 * REUSE rule: call existing service functions — do NOT re-implement business
 * logic. If a service function is private, export it from the owning module.
 *
 * All 15 handlers exported as CARTER_READ_HANDLERS: Record<string, (params: unknown) => Promise<unknown>>.
 * The key MUST match the CarterTool.handler field in tool-registry.ts.
 */

import { db } from "../../db/index.js";
import {
  strategies,
  backtests,
  monteCarloRuns,
  lifecycleTransitions,
  paperSessions,
  auditLog,
  strategyPendingBuckets,
  strategyPendingMentions,
} from "../../db/schema.js";
import { desc, eq, and, inArray, sql } from "drizzle-orm";

// ── Service imports (REUSE — do not re-implement) ─────────────────────────────
import { getBacktestConcurrencyStats } from "../../routes/backtests.js";
import { getPythonSubprocessStats } from "../../lib/python-runner.js";
import { getActiveStreams } from "../../services/paper-trading-stream.js";
import { buildProductionStatus } from "../../routes/production-status.js";
import { buildDrawdownDistance } from "../../routes/production-status.js";
import { computeSwitchStates } from "../../routes/slumhouse/admin.js";
import { buildCompositeHealthSummary } from "../../routes/composite-health.js";
import { buildABComparisonData } from "../../routes/ab-comparison.js";
import { assembleKitchenData, assembleTodaysMenu } from "../../lib/slumhouse/kitchen-data.js";
import { assembleCribData } from "../../lib/slumhouse/crib-data.js";
import { getMode } from "../../services/pipeline-control-service.js";

// ── Gate threshold getters (canonical env-synced values, not hardcoded literals) ─
import { getB14CiHighThreshold } from "../../lib/b14-ci-gate.js";
import { getWfeHardFloor } from "../../lib/wfe-gate.js";
import { getPboLifecycleThreshold } from "../../lib/pbo-gate.js";

// ─── report_system_health ─────────────────────────────────────────────────────

async function reportSystemHealth(_params: unknown): Promise<unknown> {
  const startMs = Date.now();

  // DB health: SELECT 1 with 2-second timeout
  let dbStatus = "ok";
  let dbLatencyMs = 0;
  try {
    const dbStart = Date.now();
    await Promise.race([
      db.execute(sql`SELECT 1`),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("db_health_timeout")), 2000)
      ),
    ]);
    dbLatencyMs = Date.now() - dbStart;
  } catch (err) {
    dbStatus = err instanceof Error && err.message === "db_health_timeout" ? "timeout" : "error";
  }

  // Ollama health
  let ollamaStatus = "unreachable";
  try {
    const ollamaUrl = process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
    const r = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    ollamaStatus = r.ok ? "ok" : "error";
  } catch {
    ollamaStatus = "unreachable";
  }

  const backtestConcurrency = getBacktestConcurrencyStats();
  const pythonPool = getPythonSubprocessStats();
  const activeStreams = getActiveStreams();

  return {
    status: dbStatus === "ok" && ollamaStatus === "ok" ? "ok" : "degraded",
    service: "trading-forge",
    timestamp: new Date().toISOString(),
    database: { status: dbStatus, latencyMs: dbLatencyMs },
    ollama: { status: ollamaStatus },
    pythonPool: {
      active: pythonPool.active,
      queued: pythonPool.queued,
      cap: pythonPool.cap,
      saturated: pythonPool.active >= pythonPool.cap,
    },
    backtestConcurrency,
    activePaperStreams: activeStreams.size,
    responseMs: Date.now() - startMs,
  };
}

// ─── report_production_status ─────────────────────────────────────────────────

async function reportProductionStatus(_params: unknown): Promise<unknown> {
  return buildProductionStatus();
}

// ─── report_switch_states ─────────────────────────────────────────────────────

async function reportSwitchStates(_params: unknown): Promise<unknown> {
  return computeSwitchStates();
}

// ─── report_composite_health ──────────────────────────────────────────────────

async function reportCompositeHealth(_params: unknown): Promise<unknown> {
  return buildCompositeHealthSummary();
}

// ─── report_ab_comparison ─────────────────────────────────────────────────────

async function reportAbComparison(_params: unknown): Promise<unknown> {
  return buildABComparisonData();
}

// ─── report_pipeline_lifecycle ────────────────────────────────────────────────

async function reportPipelineLifecycle(_params: unknown): Promise<unknown> {
  const [kitchenData, todaysMenu, mode] = await Promise.all([
    assembleKitchenData(),
    assembleTodaysMenu(),
    getMode().catch(() => null),
  ]);
  return { kitchenData, todaysMenu, pipelineMode: mode };
}

// ─── report_crib_today ────────────────────────────────────────────────────────

async function reportCribToday(_params: unknown): Promise<unknown> {
  // Carter has no user context — pass null to get operator-wide crib data.
  return assembleCribData({ brokerAccountId: null });
}

// ─── report_strategy_status ───────────────────────────────────────────────────

interface ReportStrategyStatusParams {
  strategyId?: string;
  name?: string;
}

async function reportStrategyStatus(params: unknown): Promise<unknown> {
  const p = params as ReportStrategyStatusParams;
  if (!p || (!p.strategyId && !p.name)) {
    throw new Error("params.strategyId or params.name is required");
  }

  // Find strategy
  const strategyRows = p.strategyId
    ? await db.select().from(strategies).where(eq(strategies.id, p.strategyId)).limit(1)
    : await db.select().from(strategies).where(eq(strategies.name, p.name!)).limit(1);

  if (!strategyRows[0]) {
    throw new Error("strategy_not_found");
  }
  const strategy = strategyRows[0];

  // Latest completed backtest
  const backtestRows = await db
    .select({
      id: backtests.id,
      gateResult: backtests.gateResult,
      walkForwardResults: backtests.walkForwardResults,
      bif: backtests.bif,
      wrcResult: backtests.wrcResult,
      spaResult: backtests.spaResult,
      status: backtests.status,
      createdAt: backtests.createdAt,
    })
    .from(backtests)
    .where(and(eq(backtests.strategyId, strategy.id), eq(backtests.status, "completed")))
    .orderBy(desc(backtests.createdAt))
    .limit(1);

  const backtest = backtestRows[0] ?? null;

  // Latest MC run for that backtest
  let mcRow: { riskMetrics: unknown; probabilityOfRuin: string | null } | null = null;
  if (backtest) {
    const mcRows = await db
      .select({ riskMetrics: monteCarloRuns.riskMetrics, probabilityOfRuin: monteCarloRuns.probabilityOfRuin })
      .from(monteCarloRuns)
      .where(eq(monteCarloRuns.backtestId, backtest.id))
      .orderBy(desc(monteCarloRuns.createdAt))
      .limit(1);
    mcRow = mcRows[0] ?? null;
  }

  // Recent lifecycle transitions (last 5)
  const transitions = await db
    .select({
      fromState: lifecycleTransitions.fromState,
      toState: lifecycleTransitions.toState,
      decisionAuthority: lifecycleTransitions.decisionAuthority,
      reason: lifecycleTransitions.reason,
      createdAt: lifecycleTransitions.createdAt,
    })
    .from(lifecycleTransitions)
    .where(eq(lifecycleTransitions.strategyId, strategy.id))
    .orderBy(desc(lifecycleTransitions.createdAt))
    .limit(5);

  // Derive blocking gate from evidence
  const rm = (mcRow?.riskMetrics ?? {}) as Record<string, unknown>;
  const wfr = (backtest?.walkForwardResults ?? {}) as Record<string, unknown>;

  const ruinCiHigh =
    (rm["probability_of_ruin_ci"] as Record<string, unknown> | undefined)?.["ci_high"] ?? null;
  const wfeOverall = wfr["wfe_overall"] ?? null;
  const pboOverall = wfr["pbo_overall"] ?? null;

  let blockingGate: string | null = null;
  let blockingWhy: string | null = null;

  const b14Threshold = getB14CiHighThreshold();
  const wfeFloor = getWfeHardFloor();
  const pboThreshold = getPboLifecycleThreshold();

  if (typeof ruinCiHigh === "number" && ruinCiHigh > b14Threshold) {
    blockingGate = "B14_RUIN_CI";
    blockingWhy = `B14 ruin CI high ${ruinCiHigh.toFixed(3)} > ${b14Threshold.toFixed(3)} (blocks PAPER→DEPLOY_READY)`;
  } else if (typeof wfeOverall === "number" && wfeOverall < wfeFloor) {
    blockingGate = "WFE_HARD_FLOOR";
    blockingWhy = `WFE ${wfeOverall.toFixed(3)} < ${wfeFloor.toFixed(3)} (blocks PAPER→DEPLOY_READY)`;
  } else if (typeof pboOverall === "number" && pboOverall > pboThreshold) {
    blockingGate = "PBO_OVERFIT";
    blockingWhy = `PBO ${pboOverall.toFixed(3)} > ${pboThreshold.toFixed(3)} (blocks TESTING→SHADOW/PAPER)`;
  }

  return {
    id: strategy.id,
    name: strategy.name,
    symbol: strategy.symbol,
    lifecycle_state: strategy.lifecycleState,
    blocking_gate: blockingGate,
    why: blockingWhy,
    gate_evidence: backtest
      ? {
          bif: backtest.bif !== null ? Number(backtest.bif) : null,
          wfe_overall: typeof wfeOverall === "number" ? wfeOverall : null,
          pbo_overall: typeof pboOverall === "number" ? pboOverall : null,
          ruin_ci_high: typeof ruinCiHigh === "number" ? ruinCiHigh : null,
          wrc_passed: ((backtest.wrcResult as Record<string, unknown> | null)?.["passed"]) ?? null,
          spa_passed: ((backtest.spaResult as Record<string, unknown> | null)?.["passed"]) ?? null,
        }
      : null,
    recent_transitions: transitions.map((t) => ({
      from: t.fromState,
      to: t.toState,
      authority: t.decisionAuthority,
      reason: t.reason ?? null,
      at: t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
    })),
  };
}

// ─── report_backtest_result ───────────────────────────────────────────────────

interface ReportBacktestResultParams {
  backtestId: string;
}

async function reportBacktestResult(params: unknown): Promise<unknown> {
  const p = params as ReportBacktestResultParams;
  if (!p?.backtestId) throw new Error("params.backtestId is required");

  const rows = await db.select().from(backtests).where(eq(backtests.id, p.backtestId)).limit(1);
  if (!rows[0]) throw new Error("backtest_not_found");
  const b = rows[0];

  const wfr = (b.walkForwardResults ?? {}) as Record<string, unknown>;
  return {
    id: b.id,
    strategyId: b.strategyId,
    status: b.status,
    symbol: b.symbol,
    timeframe: b.timeframe,
    sharpeRatio: b.sharpeRatio !== null ? Number(b.sharpeRatio) : null,
    totalReturn: b.totalReturn !== null ? Number(b.totalReturn) : null,
    maxDrawdown: b.maxDrawdown !== null ? Number(b.maxDrawdown) : null,
    profitFactor: b.profitFactor !== null ? Number(b.profitFactor) : null,
    totalTrades: b.totalTrades ?? null,
    forgeScore: b.forgeScore !== null ? Number(b.forgeScore) : null,
    tier: b.tier ?? null,
    bif: b.bif !== null ? Number(b.bif) : null,
    wfe_overall: wfr["wfe_overall"] ?? null,
    pbo_overall: wfr["pbo_overall"] ?? null,
    gateResult: b.gateResult ?? null,
    createdAt: b.createdAt instanceof Date ? b.createdAt.toISOString() : String(b.createdAt),
  };
}

// ─── report_montecarlo_survival ───────────────────────────────────────────────

interface ReportMontecarloSurvivalParams {
  backtestId: string;
}

async function reportMontecarloSurvival(params: unknown): Promise<unknown> {
  const p = params as ReportMontecarloSurvivalParams;
  if (!p?.backtestId) throw new Error("params.backtestId is required");

  const rows = await db
    .select({
      probabilityOfRuin: monteCarloRuns.probabilityOfRuin,
      riskMetrics: monteCarloRuns.riskMetrics,
      numSimulations: monteCarloRuns.numSimulations,
      sharpeP5: monteCarloRuns.sharpeP5,
      sharpeP50: monteCarloRuns.sharpeP50,
      maxDrawdownP95: monteCarloRuns.maxDrawdownP95,
      createdAt: monteCarloRuns.createdAt,
    })
    .from(monteCarloRuns)
    .where(eq(monteCarloRuns.backtestId, p.backtestId))
    .orderBy(desc(monteCarloRuns.createdAt))
    .limit(1);

  if (!rows[0]) throw new Error("mc_not_found");
  const mc = rows[0];
  const rm = (mc.riskMetrics ?? {}) as Record<string, unknown>;

  return {
    backtest_id: p.backtestId,
    probability_of_ruin: mc.probabilityOfRuin !== null ? Number(mc.probabilityOfRuin) : null,
    probability_of_ruin_ci: rm["probability_of_ruin_ci"] ?? null,
    survival_rate: rm["survival_rate"] ?? null,
    num_simulations: mc.numSimulations,
    sharpe_p5: mc.sharpeP5 !== null ? Number(mc.sharpeP5) : null,
    sharpe_p50: mc.sharpeP50 !== null ? Number(mc.sharpeP50) : null,
    max_drawdown_p95: mc.maxDrawdownP95 !== null ? Number(mc.maxDrawdownP95) : null,
  };
}

// ─── report_paper_session ─────────────────────────────────────────────────────

async function reportPaperSession(_params: unknown): Promise<unknown> {
  const rows = await db
    .select({
      id: paperSessions.id,
      strategyId: paperSessions.strategyId,
      status: paperSessions.status,
      mode: paperSessions.mode,
      firmId: paperSessions.firmId,
      startedAt: paperSessions.startedAt,
      startingCapital: paperSessions.startingCapital,
      currentEquity: paperSessions.currentEquity,
      realizedPeakEquity: paperSessions.realizedPeakEquity,
      highWaterBalance: paperSessions.highWaterBalance,
      totalTrades: paperSessions.totalTrades,
      provenTradesCount: paperSessions.provenTradesCount,
      dailyPnlBreakdown: paperSessions.dailyPnlBreakdown,
    })
    .from(paperSessions)
    .where(eq(paperSessions.status, "active"))
    .orderBy(desc(paperSessions.startedAt))
    .limit(5);

  if (rows.length === 0) {
    return { active_sessions: [], count: 0, message: "no_active_paper_sessions" };
  }

  return {
    count: rows.length,
    active_sessions: rows.map((s) => {
      const equity = Number(s.currentEquity);
      const peak = Number(s.realizedPeakEquity);
      const starting = Number(s.startingCapital);
      const pnl = equity - starting;
      const drawdownFromPeak = peak > 0 ? (peak - equity) / peak : 0;
      return {
        id: s.id,
        strategyId: s.strategyId ?? null,
        status: s.status,
        mode: s.mode,
        firmId: s.firmId ?? null,
        startedAt: s.startedAt instanceof Date ? s.startedAt.toISOString() : String(s.startedAt),
        startingCapital: starting,
        currentEquity: equity,
        realizedPeakEquity: peak,
        highWaterBalance: Number(s.highWaterBalance),
        totalTrades: s.totalTrades,
        provenTradesCount: s.provenTradesCount,
        pnl: Math.round(pnl * 100) / 100,
        pnlPct: starting > 0 ? Math.round((pnl / starting) * 10000) / 100 : null,
        drawdownFromPeakPct: Math.round(drawdownFromPeak * 10000) / 100,
        todayPnl: (() => {
          const todayKey = new Date().toISOString().slice(0, 10);
          const breakdown = (s.dailyPnlBreakdown ?? {}) as Record<string, number>;
          return breakdown[todayKey] ?? null;
        })(),
      };
    }),
  };
}

// ─── report_pending_buckets ───────────────────────────────────────────────────

interface ReportPendingBucketsParams {
  status?: string;
  limit?: number;
}

async function reportPendingBuckets(params: unknown): Promise<unknown> {
  const p = (params ?? {}) as ReportPendingBucketsParams;
  const status = p.status ?? "pending";
  const limit = Math.min(p.limit ?? 50, 200);

  const rows = await db
    .select({
      id: strategyPendingBuckets.id,
      fingerprintHash: strategyPendingBuckets.fingerprintHash,
      market: strategyPendingBuckets.market,
      entryArchetype: strategyPendingBuckets.entryArchetype,
      exitType: strategyPendingBuckets.exitType,
      sourceCount: strategyPendingBuckets.sourceCount,
      distinctProviders: strategyPendingBuckets.distinctProviders,
      status: strategyPendingBuckets.status,
      firstSeenAt: strategyPendingBuckets.firstSeenAt,
      lastSeenAt: strategyPendingBuckets.lastSeenAt,
      graduatedAt: strategyPendingBuckets.graduatedAt,
      graduatedStrategyId: strategyPendingBuckets.graduatedStrategyId,
      conceptName: strategyPendingBuckets.conceptName,
    })
    .from(strategyPendingBuckets)
    .where(eq(strategyPendingBuckets.status, status))
    .orderBy(desc(strategyPendingBuckets.lastSeenAt))
    .limit(limit);

  // Fetch providers for returned bucket IDs
  const bucketIds = rows.map((r) => r.id);
  const providersByBucket = new Map<string, string[]>();
  if (bucketIds.length > 0) {
    const providerRows = await db
      .select({
        bucketId: strategyPendingMentions.bucketId,
        sourceProvider: strategyPendingMentions.sourceProvider,
      })
      .from(strategyPendingMentions)
      .where(inArray(strategyPendingMentions.bucketId, bucketIds));
    for (const pr of providerRows) {
      const arr = providersByBucket.get(pr.bucketId) ?? [];
      arr.push(pr.sourceProvider);
      providersByBucket.set(pr.bucketId, arr);
    }
  }

  const data = rows.map((r) => ({
    id: r.id,
    market: r.market,
    entryArchetype: r.entryArchetype,
    exitType: r.exitType,
    conceptName: r.conceptName ?? null,
    sourceCount: r.sourceCount,
    distinctProviders: r.distinctProviders,
    status: r.status,
    firstSeenAt: r.firstSeenAt instanceof Date ? r.firstSeenAt.toISOString() : String(r.firstSeenAt),
    lastSeenAt: r.lastSeenAt instanceof Date ? r.lastSeenAt.toISOString() : String(r.lastSeenAt),
    graduatedAt: r.graduatedAt instanceof Date ? r.graduatedAt.toISOString() : (r.graduatedAt ?? null),
    graduatedStrategyId: r.graduatedStrategyId ?? null,
    providers: [...new Set(providersByBucket.get(r.id) ?? [])],
  }));

  return { data, total: data.length, status };
}

// ─── report_recent_alerts ─────────────────────────────────────────────────────

interface ReportRecentAlertsParams {
  limit?: number;
}

async function reportRecentAlerts(params: unknown): Promise<unknown> {
  const p = (params ?? {}) as ReportRecentAlertsParams;
  const limit = Math.min(p.limit ?? 20, 100);

  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      status: auditLog.status,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      errorMessage: auditLog.errorMessage,
      correlationId: auditLog.correlationId,
      decisionAuthority: auditLog.decisionAuthority,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(inArray(auditLog.status, ["warning", "critical"]))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    status: r.status,
    entityType: r.entityType ?? null,
    entityId: r.entityId ?? null,
    errorMessage: r.errorMessage ?? null,
    correlationId: r.correlationId ?? null,
    decisionAuthority: r.decisionAuthority ?? null,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }));
}

// ─── query_audit_log ──────────────────────────────────────────────────────────

interface QueryAuditLogParams {
  action?: string;
  correlationId?: string;
  limit?: number;
}

async function queryAuditLog(params: unknown): Promise<unknown> {
  const p = (params ?? {}) as QueryAuditLogParams;
  const limit = Math.min(p.limit ?? 20, 50);

  const conditions = [];
  if (p.action) conditions.push(eq(auditLog.action, p.action));
  if (p.correlationId) conditions.push(eq(auditLog.correlationId, p.correlationId));

  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      status: auditLog.status,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      decisionAuthority: auditLog.decisionAuthority,
      correlationId: auditLog.correlationId,
      errorMessage: auditLog.errorMessage,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    status: r.status,
    entityType: r.entityType ?? null,
    entityId: r.entityId ?? null,
    decisionAuthority: r.decisionAuthority ?? null,
    correlationId: r.correlationId ?? null,
    errorMessage: r.errorMessage ?? null,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }));
}

// ─── report_drawdown_status ───────────────────────────────────────────────────

async function reportDrawdownStatus(_params: unknown): Promise<unknown> {
  return buildDrawdownDistance();
}

// ─── get_current_issues ───────────────────────────────────────────────────────
// Returns the live open-issue list from the proactive issue watcher.
// This is the FIRST tool Carter should call on connect so the operator briefing
// is grounded in real observed system state, not a cached or guessed summary.

import { listOpenIssues } from "./carter-issues-store.js";

// ── Introspection handlers (explain_gate, list_subsystems, summarize_subsystem,
//    read_strategy_internals, trace_correlation, read_recent_decisions,
//    read_system_map) — spread into CARTER_READ_HANDLERS below so the route
//    dispatches them via the same single merged map.
import { CARTER_INTROSPECT_HANDLERS } from "./carter-introspect.js";

// ── Recommendation-engine handlers (diagnose_pipeline, analyze_gate_blocks,
//    review_strategy, find_hardening_opportunities) — grounded raw material for
//    Carter's GPT-5.4 brain to recommend improvements/fixes. Spread into
//    CARTER_READ_HANDLERS below alongside the introspection map.
import { CARTER_RECOMMEND_HANDLERS } from "./carter-recommend.js";

async function getCurrentIssues(_params: unknown): Promise<unknown> {
  const issues = listOpenIssues();

  if (issues.length === 0) {
    return {
      issues: [],
      count: 0,
      maxSeverity: null,
      summary: "All clear — no open issues.",
    };
  }

  const maxSeverity =
    issues.some((i) => i.severity === "critical")
      ? "critical"
      : issues.some((i) => i.severity === "warning")
        ? "warning"
        : "info";

  const summaryParts = issues.map(
    (i) => `[${i.severity.toUpperCase()}] ${i.title}`,
  );

  return {
    issues: issues.map((i) => ({
      issue_key:    i.issue_key,
      severity:     i.severity,
      title:        i.title,
      detail:       i.detail ?? null,
      source_event: i.source_event ?? null,
      first_seen:   i.first_seen instanceof Date ? i.first_seen.toISOString() : String(i.first_seen),
      last_seen:    i.last_seen instanceof Date  ? i.last_seen.toISOString()  : String(i.last_seen),
    })),
    count:       issues.length,
    maxSeverity,
    summary:     `${issues.length} open issue${issues.length === 1 ? "" : "s"}: ${summaryParts.join("; ")}`,
  };
}

// ─── CARTER_READ_HANDLERS ─────────────────────────────────────────────────────

/**
 * Map of handler keys → async handler functions.
 * Keys MUST match CarterTool.handler values in tool-registry.ts.
 * The contract test asserts bidirectional parity.
 */
export const CARTER_READ_HANDLERS: Record<string, (params: unknown) => Promise<unknown>> = {
  report_system_health:       reportSystemHealth,
  report_production_status:   reportProductionStatus,
  report_switch_states:       reportSwitchStates,
  report_composite_health:    reportCompositeHealth,
  report_ab_comparison:       reportAbComparison,
  report_pipeline_lifecycle:  reportPipelineLifecycle,
  report_crib_today:          reportCribToday,
  report_strategy_status:     reportStrategyStatus,
  report_backtest_result:     reportBacktestResult,
  report_montecarlo_survival: reportMontecarloSurvival,
  report_paper_session:       reportPaperSession,
  report_pending_buckets:     reportPendingBuckets,
  report_recent_alerts:       reportRecentAlerts,
  query_audit_log:            queryAuditLog,
  report_drawdown_status:     reportDrawdownStatus,
  get_current_issues:         getCurrentIssues,
  // ── Introspection tools (carter-introspect.ts) ──────────────────────────────
  ...CARTER_INTROSPECT_HANDLERS,
  // ── Recommendation-engine tools (carter-recommend.ts) ───────────────────────
  ...CARTER_RECOMMEND_HANDLERS,
};

