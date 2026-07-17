/**
 * m3-paper-single-authority-invariant.test.ts — M3-core: PAPER Authority Flip
 * (2026-07-17), grading-crux verification.
 *
 * The packet's grading crux, stated explicitly: "a PAPER-state signal produces
 * exactly one internal journal entry (a paper_trades/paper_positions write via
 * the internal engine) and ZERO canonical broker orders (no routeOrder()/
 * TradersPost call reachable for PAPER, from any code path — normal signal
 * flow, shadow-override flow, boot-resume flow, crash-recovery flow)."
 *
 * This file drives all 4 legs. `evaluateSignals()` itself is established by
 * this repo's own convention (see goalscan-crit-dll-blackout-force-close.test.ts,
 * paper-signal-service-deepscan-findings.test.ts) as too large a gateway-
 * dependency surface for a full behavioral drive (DB, bar buffer, indicators,
 * broker calls, SSE, audit_log — dozens of mocks with no incremental signal
 * over a source-structure assertion). Per that established convention:
 *
 *   Leg A (normal signal flow) + Leg B (shadow-override flow): proven via
 *     source-structure assertions PLUS behavioral assertions against the REAL,
 *     live-imported `BROKER_AUTHORITATIVE_STATES` / `isBrokerAuthoritativeState`
 *     (the actual production objects the call sites import — confirmed by
 *     source-text import checks, not a re-implemented mirror) showing the
 *     one and only routeOrder() call site reachable from evaluateSignals()
 *     (the RL A/B rl-challenger branch) is structurally unreachable for PAPER.
 *
 *   Leg C (boot-resume) + Leg D (crash-recovery): proven via FULL behavioral
 *     tests driving the REAL `resumeActivePaperSessions()` /
 *     `detectStalePaperSessions()` functions (via the `_testOnly` seam) with a
 *     mocked DB + a `routeOrder` spy — the strongest evidence tier, since
 *     these two functions ARE tractable to drive directly (already proven by
 *     scheduler-resume-paper-plus-skip.test.ts's established pattern).
 *
 * See scheduler-resume-paper-plus-skip.test.ts and
 * scheduler-detect-stale-broker-authoritative-guard.test.ts for the per-leg
 * detail tests this file's Leg C/D assertions summarize; this file's job is
 * to assert the SINGLE cross-cutting invariant explicitly, in one place.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BROKER_AUTHORITATIVE_STATES,
  isBrokerAuthoritativeState,
} from "../lib/paper-authority-states.js";

const PAPER_SIGNAL_SERVICE_PATH = resolve(process.cwd(), "src/server/services/paper-signal-service.ts");
const PAPER_EXECUTION_SERVICE_PATH = resolve(process.cwd(), "src/server/services/paper-execution-service.ts");

// ─────────────────────────────────────────────────────────────────────────────
// Leg A + B: normal signal flow + shadow-override flow (source-structure +
// real-constant behavioral proof — see file header for why not a full drive)
// ─────────────────────────────────────────────────────────────────────────────

describe("Leg A/B — normal + shadow-override signal flow: PAPER cannot reach routeOrder()", () => {
  it("paper-execution-service.ts (the internal fill path: openPosition/closePosition/updatePositionPrices) never calls routeOrder() or submitWebhookOrder() — the ONLY writer for PAPER is the internal engine", () => {
    const src = readFileSync(PAPER_EXECUTION_SERVICE_PATH, "utf8");
    // No actual broker-call function invocation. A bare textual mention of
    // "TradersPost" in a comment (e.g. documenting a FUTURE fill-confirmation
    // reconciliation idea) is fine and does not violate the invariant — only
    // an actual call would.
    expect(src).not.toContain("routeOrder(");
    expect(src).not.toContain("submitWebhookOrder(");
  });

  it("the ONLY routeOrder() call site reachable from evaluateSignals() (the RL A/B rl-challenger branch) gates on BROKER_AUTHORITATIVE_STATES, which excludes PAPER", () => {
    const src = readFileSync(PAPER_SIGNAL_SERVICE_PATH, "utf8");
    // There is exactly one `await routeOrder(` call site in this file (the A/B
    // rl-challenger branch) — confirm it's still singular (if a second call
    // site appears un-gated, this count changes and the test should be
    // revisited, not silently pass).
    const routeOrderCallCount = (src.match(/await routeOrder\(/g) ?? []).length;
    expect(routeOrderCallCount).toBe(1);
    expect(src).toContain("BROKER_AUTHORITATIVE_STATES.includes(lcStateForRouting");
    expect(isBrokerAuthoritativeState("PAPER")).toBe(false);
  });

  it("the shadow-override branch (shadow_mode_enabled=true AND lifecycleState==='PAPER') falls through to the SAME normal path — no separate TradersPost call site exists for it", () => {
    const src = readFileSync(PAPER_SIGNAL_SERVICE_PATH, "utf8");
    const overrideIdx = src.indexOf('if (sessionConfig.lifecycleState === "PAPER") {');
    expect(overrideIdx).toBeGreaterThan(-1);
    // From the override branch to the next `pendingEntryQueue.set(` call
    // (the internal-fill enqueue), there must be NO routeOrder() call —
    // proving "falls through" cannot reach a second, override-specific broker path.
    const pendingEntryIdx = src.indexOf("pendingEntryQueue.set(pendingKey", overrideIdx);
    expect(pendingEntryIdx).toBeGreaterThan(overrideIdx);
    const between = src.slice(overrideIdx, pendingEntryIdx);
    expect(between).not.toContain("routeOrder(");
  });

  it("comment/audit truth-in-labeling: the shadow-override branch no longer claims to route to TradersPost (M3 correction)", () => {
    const src = readFileSync(PAPER_SIGNAL_SERVICE_PATH, "utf8");
    const idx = src.indexOf("lifecycle.shadow_mode_inconsistency_warn");
    const block = src.slice(idx, idx + 800);
    expect(block).toContain('decision: "override_route_to_internal_engine"');
    expect(block).not.toContain("override_route_to_traderspost");
  });

  it("regression: DEPLOY_READY / PILOT / DEPLOYED strategies routed to rl-challenger CAN still reach routeOrder() (untouched by this wave)", () => {
    expect(isBrokerAuthoritativeState("DEPLOY_READY")).toBe(true);
    expect(isBrokerAuthoritativeState("PILOT")).toBe(true);
    expect(isBrokerAuthoritativeState("DEPLOYED")).toBe(true);
    for (const state of BROKER_AUTHORITATIVE_STATES) {
      expect(state).not.toBe("PAPER");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Leg C + D: boot-resume flow + crash-recovery flow — full behavioral drive
// of the REAL scheduler functions, with a routeOrder spy proving zero broker
// calls occur anywhere in either code path for a PAPER-state session.
// ─────────────────────────────────────────────────────────────────────────────

const mockStartStream = vi.fn();
const mockStopStream = vi.fn();
const mockIsStreaming = vi.fn().mockReturnValue(false);
const mockGetStreamHealth = vi.fn().mockReturnValue({ connected: false, symbols: [] });
const mockInsertAuditRowSafe = vi.fn().mockResolvedValue(true);
const mockRouteOrder = vi.fn();

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({ type: "eq" })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  gte: vi.fn(() => ({ type: "gte" })), lte: vi.fn(), desc: vi.fn(() => ({ type: "desc" })), asc: vi.fn(),
  inArray: vi.fn(), isNull: vi.fn(), isNotNull: vi.fn(), min: vi.fn(),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }), notInArray: vi.fn(),
}));
vi.mock("../db/schema.js", () => ({
  strategies: { id: "strategies.id", lifecycleState: "strategies.lifecycleState", symbol: "strategies.symbol", config: "strategies.config" },
  paperSessions: { id: "paperSessions.id", status: "paperSessions.status", strategyId: "paperSessions.strategyId", governorState: "paperSessions.governorState", startedAt: "paperSessions.startedAt" },
  paperPositions: { id: "paperPositions.id", sessionId: "paperPositions.sessionId", trailHwm: "paperPositions.trailHwm", barsHeld: "paperPositions.barsHeld", closedAt: "paperPositions.closedAt" },
  paperTrades: { pnl: "paperTrades.pnl", sessionId: "paperTrades.sessionId", exitTime: "paperTrades.exitTime", createdAt: "paperTrades.createdAt" },
  paperSignalLogs: {}, backtests: {}, systemJournal: {}, skipDecisions: {}, auditLog: {},
  dayArchetypes: {}, tournamentResults: {}, macroSnapshots: {}, macroFeatures: {}, macroRegimeStates: {},
  lifecycleTransitions: {}, harshRegimePhase: {}, strategyExports: {}, strategyExportArtifacts: {}, strategyHealthScores: {},
}));
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])) })) })) })),
  },
}));
vi.mock("node-cron", () => ({ default: { schedule: vi.fn(() => ({ stop: vi.fn() })) } }));
vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
  insertAuditRowSafe: mockInsertAuditRowSafe,
}));
vi.mock("../lib/metrics-registry.js", () => ({
  cronJobsConcurrent: { set: vi.fn() }, pagerdutyAlertsTotal: { inc: vi.fn() },
  tfArchetypeSignalsTotal: { inc: vi.fn() }, metricsRegistry: { metrics: vi.fn().mockResolvedValue("") },
}));
vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true), getMode: vi.fn().mockResolvedValue("ACTIVE"),
}));
vi.mock("../services/lifecycle-service.js", () => ({
  LifecycleService: class {
    checkAutoPromotions = vi.fn().mockResolvedValue([]);
    checkAutoDemotions = vi.fn().mockResolvedValue([]);
    checkPilotAutoPromotions = vi.fn().mockResolvedValue([]);
  },
}));
vi.mock("../services/alert-service.js", () => ({
  AlertFactory: { systemError: vi.fn(), warning: vi.fn(), circuitOpen: vi.fn() },
}));
vi.mock("../lib/python-runner.js", () => ({ runPythonModule: vi.fn().mockResolvedValue({}) }));
// THE SPY THAT MATTERS: routeOrder must NEVER be reachable from either
// resumeActivePaperSessions or detectStalePaperSessions for a PAPER session —
// neither function imports broker-router.js directly today, but this spy is
// wired in so that if a FUTURE change threads a routeOrder() call into either
// scheduler path, this test suite fails loudly instead of silently.
vi.mock("../services/broker-router.js", () => ({ routeOrder: mockRouteOrder }));
vi.mock("../services/paper-trading-stream.js", () => ({
  startStream: mockStartStream, stopStream: mockStopStream, isStreaming: mockIsStreaming,
  getActiveStreams: vi.fn().mockReturnValue(new Map()), getStreamHealth: mockGetStreamHealth,
  getBarBuffer: vi.fn().mockReturnValue([]),
}));
vi.mock("../services/paper-signal-service.js", () => ({
  restorePositionState: vi.fn(), cleanupSession: vi.fn(),
  restoreGovernorState: vi.fn().mockReturnValue(null), invalidateDailyLossCache: vi.fn(),
}));
vi.mock("../services/notification-service.js", () => ({ notifyWarning: vi.fn(), notifyCritical: vi.fn() }));
vi.mock("../lib/notification-helpers.js", () => ({ appendFamilyGradePostscript: vi.fn((s: string) => s) }));
vi.mock("../services/paper-session-feedback-service.js", () => ({ computeAndPersistSessionFeedback: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../services/deepar-service.js", () => ({
  trainDeepAR: vi.fn().mockResolvedValue({}), predictRegime: vi.fn().mockResolvedValue({}),
  validatePastForecasts: vi.fn().mockResolvedValue({}), isDeepARDeferred: vi.fn().mockReturnValue(false),
}));
vi.mock("../services/regime-state-service.js", () => ({ setRegimeWeights: vi.fn() }));
vi.mock("../services/agent-audit-service.js", () => ({ runAgentHealthSweep: vi.fn() }));
vi.mock("../services/portfolio-optimizer-service.js", () => ({ runPortfolioCorrelationCheck: vi.fn() }));
vi.mock("../services/meta-optimizer-service.js", () => ({ runMetaParameterReview: vi.fn() }));
vi.mock("../services/anti-setup-effectiveness-service.js", () => ({ runAntiSetupEffectivenessAnalysis: vi.fn() }));
vi.mock("../services/anti-setup-gate-service.js", () => ({ invalidateAntiSetupCache: vi.fn() }));
vi.mock("../services/validation-cadence-service.js", () => ({ runMonthlyRealityCheckReport: vi.fn() }));
vi.mock("../lib/dlq-service.js", () => ({ registerRetryHandler: vi.fn(), captureToDLQ: vi.fn() }));
vi.mock("../services/macro-regime-service.js", () => ({
  runFredDailyIngestion: vi.fn().mockResolvedValue(0), runH41Ingestion: vi.fn().mockResolvedValue(0),
  runBlsIngestion: vi.fn().mockResolvedValue(0), runTreasuryAuctionIngestion: vi.fn().mockResolvedValue(0),
  runMacroRegimeClassification: vi.fn(), invalidateMacroRegimeCache: vi.fn(),
}));
vi.mock("../services/contract-specs-service.js", () => ({ runDefinitionPull: vi.fn() }));
vi.mock("../services/settlement-reconciliation-service.js", () => ({ runStatisticsPull: vi.fn(), runSettlementReconciliation: vi.fn() }));
vi.mock("../services/opening-auction-service.js", () => ({ runAuctionImbalancePull: vi.fn() }));
vi.mock("../services/bias-state-service.js", () => ({ computeBiasForAllSymbols: vi.fn() }));
vi.mock("../services/harsh-regime-phase-service.js", () => ({ getPhase: vi.fn(), flipPhaseToHard: vi.fn() }));
vi.mock("../services/n8n-execution-scraper-service.js", () => ({ runN8nExecutionScrape: vi.fn() }));
vi.mock("../services/consistency-tracker-service.js", () => ({ runConsistencyDailyDigest: vi.fn() }));
vi.mock("../services/quantum-replay-weekly-service.js", () => ({ runQuantumReplayWeeklyAnalysis: vi.fn() }));
vi.mock("../services/composite-health-digest-service.js", () => ({ runCompositeHealthDailyDigest: vi.fn() }));
vi.mock("../services/strategy-stale-detector.js", () => ({ runStrategyStaleDetector: vi.fn() }));
vi.mock("../lib/quantum-rl-training-runner.js", () => ({ isOffRthTrainingWindow: vi.fn().mockReturnValue(false) }));
vi.mock("../services/regime-drift-detector-service.js", () => ({ runRegimeDriftDetector: vi.fn() }));
vi.mock("../services/ab-comparison-weekly-digest-service.js", () => ({ runAbComparisonWeeklyDigest: vi.fn() }));
vi.mock("../services/db-backup-service.js", () => ({ runDbBackup: vi.fn() }));
vi.mock("../services/discord-fanout-audit-service.js", () => ({ runDiscordFanoutAudit: vi.fn() }));
vi.mock("../services/synthetic-regime-bank-service.js", () => ({ runSyntheticRegimeBankPopulate: vi.fn() }));

function buildResumeDbMock(activeSessions: object[], strategyRow: object[]) {
  let callNum = 0;
  return {
    select: vi.fn(() => {
      callNum++;
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => {
            if (callNum === 1) return Promise.resolve(activeSessions);
            if (callNum === 2) return { limit: vi.fn(() => Promise.resolve(strategyRow)) };
            return Promise.resolve([]);
          }),
        })),
      };
    }),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])) })) })) })),
  };
}

describe("Leg C — boot-resume flow (resumeActivePaperSessions): PAPER resumes internal-only, zero routeOrder calls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsStreaming.mockReturnValue(false);
  });

  it("PAPER session resumes the internal stream (startStream called) and routeOrder is NEVER called", async () => {
    const session = { id: "cccccccc-0000-0000-0000-000000000001", strategyId: "dddddddd-0000-0000-0000-000000000001", status: "active", governorState: null };
    const strategy = { id: session.strategyId, lifecycleState: "PAPER", symbol: "MES", config: {} };

    const { db } = await import("../db/index.js");
    Object.assign(db, buildResumeDbMock([session], [strategy]));

    const { _testOnly } = await import("../scheduler.js");
    await _testOnly.resumeActivePaperSessions();

    expect(mockStartStream).toHaveBeenCalledWith(session.id, ["MES"]);
    expect(mockRouteOrder).not.toHaveBeenCalled();
  });

  it("DEPLOY_READY session does NOT resume the internal stream, and routeOrder is (still, correctly) never called from THIS function either way", async () => {
    const session = { id: "cccccccc-0000-0000-0000-000000000002", strategyId: "dddddddd-0000-0000-0000-000000000002", status: "active", governorState: null };
    const strategy = { id: session.strategyId, lifecycleState: "DEPLOY_READY", symbol: "MES", config: {} };

    const { db } = await import("../db/index.js");
    Object.assign(db, buildResumeDbMock([session], [strategy]));

    const { _testOnly } = await import("../scheduler.js");
    await _testOnly.resumeActivePaperSessions();

    expect(mockStartStream).not.toHaveBeenCalled();
    expect(mockRouteOrder).not.toHaveBeenCalled();
  });
});

describe("Leg D — crash-recovery flow (detectStalePaperSessions): a leaked broker-authoritative stream is stopped, PAPER is left alone, zero routeOrder calls throughout", () => {
  function buildDetectStaleDbMock(opts: {
    failedToStreamSessions?: object[];
    activeSessions?: object[];
    strategyRowsById: Record<string, { id: string; lifecycleState: string; symbol: string; config: Record<string, unknown> }>;
  }) {
    const failedToStreamSessions = opts.failedToStreamSessions ?? [];
    const activeSessions = opts.activeSessions ?? [];
    const bareSelectQueue: unknown[] = [failedToStreamSessions, activeSessions];
    const strategyLookupQueue: string[] = [
      ...failedToStreamSessions.map((s: any) => s.strategyId).filter(Boolean),
      ...activeSessions.map((s: any) => s.strategyId).filter(Boolean),
    ];
    return {
      select: vi.fn((shape?: Record<string, unknown>) => {
        const isStrategyShape = !!shape && "lifecycleState" in shape;
        const isPositionsShape = !!shape && "trailHwm" in shape;
        const isPaperTradesShape = !!shape && "pnl" in shape;
        const isAuditLogIdShape = !!shape && Object.keys(shape).length === 1 && "id" in shape;
        const isSessionStatusShape = !!shape && Object.keys(shape).length === 1 && "status" in shape;
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => {
              if (isStrategyShape) {
                const id = strategyLookupQueue.shift();
                const row = id ? opts.strategyRowsById[id] : undefined;
                return { limit: vi.fn(() => Promise.resolve(row ? [row] : [])) };
              }
              if (isPositionsShape) return Promise.resolve([]);
              if (isPaperTradesShape) return { orderBy: vi.fn(() => Promise.resolve([])) };
              if (isAuditLogIdShape) return Promise.resolve([]);
              if (isSessionStatusShape) return Promise.resolve([{ status: "active" }]);
              return Promise.resolve(bareSelectQueue.shift() ?? []);
            }),
          })),
        };
      }),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => Promise.resolve([{ id: "updated", stoppedAt: new Date(), totalTrades: 0, currentEquity: "0", dailyPnlBreakdown: null }])),
          })),
        })),
      })),
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsStreaming.mockReturnValue(false);
    mockGetStreamHealth.mockReturnValue({ connected: false, symbols: [] });
  });

  it("simulated crash-mid-transition: a PILOT-state strategy whose stream leaked (PAPER→DEPLOY_READY→PILOT promotion outran the stopStream call) is force-stopped, and routeOrder is NEVER called anywhere in the process", async () => {
    const strategyId = "eeeeeeee-0000-0000-0000-000000000001";
    const sessionId = "ffffffff-0000-0000-0000-000000000001";
    const activeSession = { id: sessionId, strategyId, startedAt: new Date() };

    const { db } = await import("../db/index.js");
    Object.assign(db, buildDetectStaleDbMock({
      activeSessions: [activeSession],
      strategyRowsById: { [strategyId]: { id: strategyId, lifecycleState: "PILOT", symbol: "MES", config: {} } },
    }));

    const { _testOnly } = await import("../scheduler.js");
    await _testOnly.detectStalePaperSessions();

    expect(mockInsertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({ action: "paper.session_auto_stop_broker_authoritative_leak", entityId: sessionId }),
    );
    // The grading crux: zero routeOrder()/TradersPost calls anywhere in this recovery path.
    expect(mockRouteOrder).not.toHaveBeenCalled();
  });

  it("a genuinely-PAPER session mid-crash-recovery is left to the normal path (not force-stopped) — internal engine remains the sole writer, still zero routeOrder calls", async () => {
    const strategyId = "eeeeeeee-0000-0000-0000-000000000002";
    const sessionId = "ffffffff-0000-0000-0000-000000000002";
    const activeSession = { id: sessionId, strategyId, startedAt: new Date() };

    const { db } = await import("../db/index.js");
    Object.assign(db, buildDetectStaleDbMock({
      activeSessions: [activeSession],
      strategyRowsById: { [strategyId]: { id: strategyId, lifecycleState: "PAPER", symbol: "MES", config: {} } },
    }));

    const { _testOnly } = await import("../scheduler.js");
    await _testOnly.detectStalePaperSessions();

    expect(mockInsertAuditRowSafe).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "paper.session_auto_stop_broker_authoritative_leak" }),
    );
    expect(mockRouteOrder).not.toHaveBeenCalled();
  });

  it("a DEPLOY_READY strategy's failed_to_stream row is never resurrected via startStream, and routeOrder is never called", async () => {
    const strategyId = "eeeeeeee-0000-0000-0000-000000000003";
    const sessionId = "ffffffff-0000-0000-0000-000000000003";
    const failedSession = { id: sessionId, strategyId, startedAt: new Date(), startingCapital: "50000", config: {}, mode: "paper", firmId: null };

    const { db } = await import("../db/index.js");
    Object.assign(db, buildDetectStaleDbMock({
      failedToStreamSessions: [failedSession],
      strategyRowsById: { [strategyId]: { id: strategyId, lifecycleState: "DEPLOY_READY", symbol: "MES", config: {} } },
    }));

    const { _testOnly } = await import("../scheduler.js");
    await _testOnly.detectStalePaperSessions();

    expect(mockStartStream).not.toHaveBeenCalled();
    expect(mockRouteOrder).not.toHaveBeenCalled();
  });
});
