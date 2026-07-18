/**
 * scheduler-detect-stale-broker-authoritative-guard.test.ts — M3-core: PAPER
 * Authority Flip (2026-07-17), item 6.
 *
 * detectStalePaperSessions() had NO lifecycle-state guard at all (unlike B5's
 * resumeActivePaperSessions) — the packet flagged this as untested for the
 * broker-authoritative boundary M3 introduces. This file drives the REAL
 * function (via the new `_testOnly.detectStalePaperSessions` seam, not a
 * mirror) to prove the explicit, tested disposition added at both of its
 * loops:
 *
 *   1. `failedToStreamSessions` loop: a `failed_to_stream` row belonging to a
 *      now-broker-authoritative strategy (DEPLOY_READY/PILOT/DEPLOYED) must
 *      NOT be auto-restarted — startStream must never fire for it.
 *   2. `activeSessions` loop: an `active` row belonging to a broker-
 *      authoritative strategy must be auto-stopped DEFENSIVELY (regardless of
 *      staleness or streaming health) — this is the genuine M3 danger case
 *      (a leaked stream that would otherwise run forever, undetected, since it
 *      bypasses both the crashed-stream-recovery branch AND the
 *      stale-inactivity branch).
 *   3. PAPER-state active sessions get NO special casing — they fall through
 *      to the exact same treatment as CANDIDATE/TESTING/SHADOW.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockStartStream = vi.fn();
const mockStopStream = vi.fn();
const mockIsStreaming = vi.fn().mockReturnValue(false);
const mockGetStreamHealth = vi.fn().mockReturnValue({ connected: false, symbols: [] });
const mockGetActiveStreams = vi.fn().mockReturnValue(new Map());
const mockCleanupSession = vi.fn();
const mockInsertAuditRowSafe = vi.fn().mockResolvedValue(true);
const mockNotifyCritical = vi.fn();
const mockBroadcastSSE = vi.fn();
const mockComputeAndPersistSessionFeedback = vi.fn().mockResolvedValue(undefined);
const mockRunPythonModule = vi.fn().mockResolvedValue({});

vi.mock("./lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ type: "eq" })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  gte: vi.fn(() => ({ type: "gte" })),
  lte: vi.fn(), desc: vi.fn(() => ({ type: "desc" })),
  asc: vi.fn(),
  inArray: vi.fn(), isNull: vi.fn(), isNotNull: vi.fn(), min: vi.fn(),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
  notInArray: vi.fn(),
}));

vi.mock("../db/schema.js", () => ({
  strategies: { id: "strategies.id", lifecycleState: "strategies.lifecycleState", symbol: "strategies.symbol", config: "strategies.config" },
  paperSessions: { id: "paperSessions.id", status: "paperSessions.status", strategyId: "paperSessions.strategyId", governorState: "paperSessions.governorState", startedAt: "paperSessions.startedAt", startingCapital: "paperSessions.startingCapital", config: "paperSessions.config", mode: "paperSessions.mode", firmId: "paperSessions.firmId", dailyPnlBreakdown: "paperSessions.dailyPnlBreakdown" },
  paperPositions: { id: "paperPositions.id", sessionId: "paperPositions.sessionId", trailHwm: "paperPositions.trailHwm", barsHeld: "paperPositions.barsHeld", closedAt: "paperPositions.closedAt" },
  paperTrades: { pnl: "paperTrades.pnl", sessionId: "paperTrades.sessionId", exitTime: "paperTrades.exitTime", createdAt: "paperTrades.createdAt" },
  paperSignalLogs: { sessionId: "paperSignalLogs.sessionId", createdAt: "paperSignalLogs.createdAt" },
  backtests: {}, systemJournal: {},
  skipDecisions: {}, auditLog: { id: "auditLog.id", action: "auditLog.action", entityId: "auditLog.entityId", createdAt: "auditLog.createdAt" },
  dayArchetypes: {}, tournamentResults: {},
  macroSnapshots: {}, macroFeatures: {}, macroRegimeStates: {},
  lifecycleTransitions: {}, harshRegimePhase: {}, strategyExports: {},
  strategyExportArtifacts: {}, strategyHealthScores: {},
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])) })) })) })),
  },
}));

vi.mock("node-cron", () => ({ default: { schedule: vi.fn(() => ({ stop: vi.fn() })) } }));
vi.mock("../routes/sse.js", () => ({ broadcastSSE: mockBroadcastSSE }));
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
  insertAuditRowSafe: mockInsertAuditRowSafe,
}));
vi.mock("../lib/metrics-registry.js", () => ({
  cronJobsConcurrent: { set: vi.fn() },
  pagerdutyAlertsTotal: { inc: vi.fn() },
  tfArchetypeSignalsTotal: { inc: vi.fn() },
  metricsRegistry: { metrics: vi.fn().mockResolvedValue("") },
}));
vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
  getMode: vi.fn().mockResolvedValue("ACTIVE"),
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
vi.mock("../lib/python-runner.js", () => ({ runPythonModule: mockRunPythonModule }));
vi.mock("../services/paper-trading-stream.js", () => ({
  startStream: mockStartStream,
  stopStream: mockStopStream,
  isStreaming: mockIsStreaming,
  getActiveStreams: mockGetActiveStreams,
  getStreamHealth: mockGetStreamHealth,
  getBarBuffer: vi.fn().mockReturnValue([]),
}));
vi.mock("../services/paper-signal-service.js", () => ({
  restorePositionState: vi.fn(),
  cleanupSession: mockCleanupSession,
  restoreGovernorState: vi.fn().mockReturnValue(null),
  invalidateDailyLossCache: vi.fn(),
}));
vi.mock("../services/notification-service.js", () => ({
  notifyWarning: vi.fn(), notifyCritical: mockNotifyCritical,
}));
vi.mock("../lib/notification-helpers.js", () => ({ appendFamilyGradePostscript: vi.fn((s: string) => s) }));
vi.mock("../services/paper-session-feedback-service.js", () => ({
  computeAndPersistSessionFeedback: mockComputeAndPersistSessionFeedback,
}));
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
vi.mock("../services/settlement-reconciliation-service.js", () => ({
  runStatisticsPull: vi.fn(), runSettlementReconciliation: vi.fn(),
}));
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

// ─── Generic, shape-dispatching DB mock ──────────────────────────────────────
//
// detectStalePaperSessions() + stopPaperSession() make many sequential DB
// round-trips of different shapes. Rather than counting call ordinals
// (fragile — see scheduler-resume-paper-plus-skip.test.ts's mixed-batch test
// for why), dispatch on recognizable shape/table markers so the mock is
// robust regardless of exactly how many calls a given code path makes.

interface StrategyRow { id: string; lifecycleState: string; symbol: string; config: Record<string, unknown> }

function buildDetectStaleDbMock(opts: {
  failedToStreamSessions?: Array<{ id: string; strategyId: string | null; startedAt: Date; startingCapital: string; config: unknown; mode: string; firmId: string | null }>;
  activeSessions?: Array<{ id: string; strategyId: string | null; startedAt: Date }>;
  strategyRowsById?: Record<string, StrategyRow>;
}) {
  const failedToStreamSessions = opts.failedToStreamSessions ?? [];
  const activeSessions = opts.activeSessions ?? [];
  const strategyRowsById = opts.strategyRowsById ?? {};

  // FIFO queues consumed in call order: the shape-less bare selects are
  // `failedToStreamSessions` (1st) then `activeSessions` (2nd) — the two
  // top-level queries `detectStalePaperSessions` issues before its loops.
  const bareSelectQueue: unknown[] = [failedToStreamSessions, activeSessions];
  const strategyLookupQueue: string[] = [
    ...failedToStreamSessions.map((s) => s.strategyId).filter((x): x is string => !!x),
    ...activeSessions.map((s) => s.strategyId).filter((x): x is string => !!x),
  ];

  function strategyLookupCursor(): StrategyRow[] {
    const id = strategyLookupQueue.shift();
    const row = id ? strategyRowsById[id] : undefined;
    return row ? [row] : [];
  }
  function bareSelectCursor() {
    return bareSelectQueue.shift() ?? [];
  }

  return {
    select: vi.fn((shape?: Record<string, unknown>) => {
      const isStrategyShape = !!shape && "lifecycleState" in shape;
      const isPositionsShape = !!shape && "trailHwm" in shape;
      const isPaperTradesShape = !!shape && "pnl" in shape;
      const isAuditLogIdShape = !!shape && Object.keys(shape).length === 1 && "id" in shape;
      const isSessionStatusShape = !!shape && Object.keys(shape).length === 1 && "status" in shape;
      // W7-6: detectStalePaperSessions' stale-check block selects ONLY
      // { createdAt } from both paperSignalLogs and paperTrades (two separate
      // calls, same shape — table identity isn't distinguishable from the
      // shape alone). Both resolve empty here so activityBaseline always
      // falls back to session.startedAt — tests control staleness via
      // startedAt directly, not via fabricated signal/trade rows.
      const isCreatedAtOnlyShape = !!shape && Object.keys(shape).length === 1 && "createdAt" in shape;
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => {
            if (isStrategyShape) {
              return { limit: vi.fn(() => Promise.resolve(strategyLookupCursor())) };
            }
            if (isPositionsShape) return Promise.resolve([]);
            if (isPaperTradesShape) return { orderBy: vi.fn(() => Promise.resolve([])) };
            if (isAuditLogIdShape) return Promise.resolve([]); // no prior restart/exhaustion audit rows
            if (isSessionStatusShape) return Promise.resolve([{ status: "active" }]);
            if (isCreatedAtOnlyShape) return { orderBy: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([])) })) };
            // Bare select() with no shape: either paperSessions('failed_to_stream')
            // or paperSessions('active') — dispatch via the FIFO queue above.
            return Promise.resolve(bareSelectCursor());
          }),
        })),
      };
    }),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() =>
            Promise.resolve([{ id: "updated", stoppedAt: new Date(), totalTrades: 0, currentEquity: "0", dailyPnlBreakdown: null }]),
          ),
        })),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("detectStalePaperSessions — M3 broker-authoritative guard (item 6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsStreaming.mockReturnValue(false);
    mockGetStreamHealth.mockReturnValue({ connected: false, symbols: [] });
    mockGetActiveStreams.mockReturnValue(new Map());
  });

  it("failedToStreamSessions loop: does NOT restart a DEPLOY_READY strategy's failed_to_stream session", async () => {
    const strategyId = "bbbbbbbb-1111-0000-0000-000000000001";
    const sessionId = "aaaaaaaa-1111-0000-0000-000000000001";
    const failedSession = {
      id: sessionId, strategyId, startedAt: new Date(), startingCapital: "50000",
      config: {}, mode: "paper", firmId: null,
    };
    const { db } = await import("../db/index.js");
    Object.assign(db, buildDetectStaleDbMock({
      failedToStreamSessions: [failedSession],
      activeSessions: [],
      strategyRowsById: { [strategyId]: { id: strategyId, lifecycleState: "DEPLOY_READY", symbol: "MES", config: {} } },
    }));

    const { _testOnly } = await import("../scheduler.js");
    await _testOnly.detectStalePaperSessions();

    expect(mockStartStream).not.toHaveBeenCalled();
    expect(mockInsertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "paper.session_restart_skipped_broker_authoritative",
        entityId: sessionId,
        // grader F-3 (2026-07-17): correlationId must propagate end-to-end
        // (CLAUDE.md §2) — the function defines it at top scope and must
        // thread it into every audit row it writes, including these two new ones.
        correlationId: expect.any(String),
      }),
    );
  });

  it("failedToStreamSessions loop: DOES restart a PAPER strategy's failed_to_stream session (regression — unaffected by the new guard)", async () => {
    const strategyId = "bbbbbbbb-1111-0000-0000-000000000002";
    const sessionId = "aaaaaaaa-1111-0000-0000-000000000002";
    const failedSession = {
      id: sessionId, strategyId, startedAt: new Date(), startingCapital: "50000",
      config: {}, mode: "paper", firmId: null,
    };
    const { db } = await import("../db/index.js");
    Object.assign(db, buildDetectStaleDbMock({
      failedToStreamSessions: [failedSession],
      activeSessions: [],
      strategyRowsById: { [strategyId]: { id: strategyId, lifecycleState: "PAPER", symbol: "MES", config: {} } },
    }));

    const { _testOnly } = await import("../scheduler.js");
    await _testOnly.detectStalePaperSessions();

    expect(mockStartStream).toHaveBeenCalledWith(sessionId, ["MES"]);
    expect(mockInsertAuditRowSafe).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "paper.session_restart_skipped_broker_authoritative" }),
    );
  });

  it("activeSessions loop: auto-stops (defensively) an 'active' session belonging to a PILOT strategy, even though it is NOT stale and NOT streaming", async () => {
    const strategyId = "bbbbbbbb-1111-0000-0000-000000000003";
    const sessionId = "aaaaaaaa-1111-0000-0000-000000000003";
    // Fresh session — started "now" — would otherwise NOT trip any staleness
    // check for a long time. The M3 guard must fire regardless.
    const activeSession = { id: sessionId, strategyId, startedAt: new Date() };
    const { db } = await import("../db/index.js");
    Object.assign(db, buildDetectStaleDbMock({
      failedToStreamSessions: [],
      activeSessions: [activeSession],
      strategyRowsById: { [strategyId]: { id: strategyId, lifecycleState: "PILOT", symbol: "MES", config: {} } },
    }));

    const { _testOnly } = await import("../scheduler.js");
    await _testOnly.detectStalePaperSessions();

    expect(mockInsertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "paper.session_auto_stop_broker_authoritative_leak",
        entityId: sessionId,
        // grader F-3 (2026-07-17): correlationId must propagate end-to-end.
        correlationId: expect.any(String),
      }),
    );
  });

  it("activeSessions loop: does NOT specially guard a PAPER-state active session — no broker-authoritative-leak audit fires for it", async () => {
    const strategyId = "bbbbbbbb-1111-0000-0000-000000000004";
    const sessionId = "aaaaaaaa-1111-0000-0000-000000000004";
    const activeSession = { id: sessionId, strategyId, startedAt: new Date() };
    const { db } = await import("../db/index.js");
    Object.assign(db, buildDetectStaleDbMock({
      failedToStreamSessions: [],
      activeSessions: [activeSession],
      strategyRowsById: { [strategyId]: { id: strategyId, lifecycleState: "PAPER", symbol: "MES", config: {} } },
    }));

    const { _testOnly } = await import("../scheduler.js");
    await _testOnly.detectStalePaperSessions();

    expect(mockInsertAuditRowSafe).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "paper.session_auto_stop_broker_authoritative_leak" }),
    );
  });

  it("activeSessions loop: DEPLOYED strategy also gets the defensive auto-stop (parametric coverage alongside PILOT)", async () => {
    const strategyId = "bbbbbbbb-1111-0000-0000-000000000005";
    const sessionId = "aaaaaaaa-1111-0000-0000-000000000005";
    const activeSession = { id: sessionId, strategyId, startedAt: new Date() };
    const { db } = await import("../db/index.js");
    Object.assign(db, buildDetectStaleDbMock({
      failedToStreamSessions: [],
      activeSessions: [activeSession],
      strategyRowsById: { [strategyId]: { id: strategyId, lifecycleState: "DEPLOYED", symbol: "MNQ", config: {} } },
    }));

    const { _testOnly } = await import("../scheduler.js");
    await _testOnly.detectStalePaperSessions();

    expect(mockInsertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "paper.session_auto_stop_broker_authoritative_leak",
        entityId: sessionId,
      }),
    );
  });
});

describe("detectStalePaperSessions — W7-6: stream-liveness guards the stale_2h auto-stop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActiveStreams.mockReturnValue(new Map());
  });

  it("does NOT auto-stop a PAPER session with a 3h-old activityBaseline when the internal stream is actively connected — a selective strategy producing zero signals for hours is healthy, not stale", async () => {
    const strategyId = "bbbbbbbb-1111-0000-0000-000000000006";
    const sessionId = "aaaaaaaa-1111-0000-0000-000000000006";
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const activeSession = { id: sessionId, strategyId, startedAt: threeHoursAgo };
    mockIsStreaming.mockReturnValue(true);
    mockGetStreamHealth.mockReturnValue({ connected: true, symbols: ["MES"] });
    const { db } = await import("../db/index.js");
    Object.assign(db, buildDetectStaleDbMock({
      failedToStreamSessions: [],
      activeSessions: [activeSession],
      strategyRowsById: { [strategyId]: { id: strategyId, lifecycleState: "PAPER", symbol: "MES", config: {} } },
    }));

    const { _testOnly } = await import("../scheduler.js");
    await _testOnly.detectStalePaperSessions();

    // stopPaperSession's own audit row + the "paper:auto_stopped" SSE broadcast
    // both only fire on the stale_2h path (see the sibling RED-proof below) —
    // asserting the SSE never fires is the cleanest signal that auto-stop
    // never triggered.
    expect(mockBroadcastSSE).not.toHaveBeenCalledWith(
      "paper:auto_stopped",
      expect.objectContaining({ sessionId }),
    );
  });

  it("RED-proof regression: DOES auto-stop a PAPER session with a 3h-old activityBaseline when the stream is NOT connected — the pre-fix behavior is preserved for a genuinely dead feed", async () => {
    const strategyId = "bbbbbbbb-1111-0000-0000-000000000007";
    const sessionId = "aaaaaaaa-1111-0000-0000-000000000007";
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const activeSession = { id: sessionId, strategyId, startedAt: threeHoursAgo };
    mockIsStreaming.mockReturnValue(false);
    mockGetStreamHealth.mockReturnValue({ connected: false, symbols: [] });
    const { db } = await import("../db/index.js");
    Object.assign(db, buildDetectStaleDbMock({
      failedToStreamSessions: [],
      activeSessions: [activeSession],
      strategyRowsById: { [strategyId]: { id: strategyId, lifecycleState: "PAPER", symbol: "MES", config: {} } },
    }));

    const { _testOnly } = await import("../scheduler.js");
    await _testOnly.detectStalePaperSessions();

    expect(mockBroadcastSSE).toHaveBeenCalledWith(
      "paper:auto_stopped",
      expect.objectContaining({ sessionId, reason: "stale_2h" }),
    );
  });
});
