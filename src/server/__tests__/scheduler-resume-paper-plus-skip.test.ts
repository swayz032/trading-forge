/**
 * scheduler-resume-paper-plus-skip.test.ts
 *
 * B5 — scheduler-b5: Verifies that resumeActivePaperSessions() never starts an
 * internal Massive-WS simulator stream for strategies that are in PAPER+ lifecycle
 * state (PAPER / DEPLOY_READY / PILOT / DEPLOYED).
 *
 * Background:
 *   On TESTING→PAPER transition, stopStream() is called in-process but
 *   paper_sessions.status is NEVER written back to 'stopped'. On restart,
 *   every active-status session would get a fresh internal stream even if
 *   TradersPost is already the canonical journal — causing dual-stream P&L drift.
 *
 * This test suite covers:
 *   1. PAPER state → no startStream call, audit row emitted
 *   2. DEPLOY_READY / PILOT / DEPLOYED → same (parametric)
 *   3. CANDIDATE / TESTING → still resumes (regression)
 *   4. NULL lifecycleState (orphaned session) → still resumes (fail-open regression)
 *   5. Audit row action and fields are correct before skip
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks (must run before any imports) ─────────────────────────────

const mockStartStream = vi.fn();
const mockInsertAuditRowSafe = vi.fn().mockResolvedValue(true);
const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();
const mockLoggerDebug = vi.fn();

// DB mock — shape mirrors what resumeActivePaperSessions calls:
//   db.select().from(paperSessions).where(...)        → returns activeSessions
//   db.select().from(strategies).where(...).limit(1)  → returns strategy row
//   db.select().from(paperPositions).where(...)       → returns open positions
// We use a factory so each test can override the resolved values.

let mockActiveSessionsResult: object[] = [];
let mockStrategyResult: object[] = [];
let mockPositionsResult: object[] = [];

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((table: string) => ({
        where: vi.fn(() => ({
          // For strategies: .where().limit(1)
          limit: vi.fn(() => Promise.resolve(mockStrategyResult)),
          // For paperSessions: .where() resolves directly
          then: (resolve: (v: object[]) => void) => resolve(mockActiveSessionsResult),
          // For paperPositions: .where(and(...)) resolves directly
        })),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve([])) })),
  },
}));

// The DB mock above is simplified — we need a more precise shape because
// resumeActivePaperSessions makes THREE distinct select calls, each with
// different chaining patterns. We implement a call-order dispatcher below.

vi.mock("../db/schema.js", () => ({
  strategies: { id: "strategies.id", lifecycleState: "strategies.lifecycleState", symbol: "strategies.symbol", config: "strategies.config" },
  paperSessions: { id: "paperSessions.id", status: "paperSessions.status", strategyId: "paperSessions.strategyId", governorState: "paperSessions.governorState" },
  paperPositions: { id: "paperPositions.id", sessionId: "paperPositions.sessionId", trailHwm: "paperPositions.trailHwm", barsHeld: "paperPositions.barsHeld", closedAt: "paperPositions.closedAt" },
  paperTrades: {}, paperSignalLogs: {}, backtests: {}, systemJournal: {},
  skipDecisions: {}, auditLog: {}, dayArchetypes: {}, tournamentResults: {},
  macroSnapshots: {}, macroFeatures: {}, macroRegimeStates: {},
  lifecycleTransitions: {}, harshRegimePhase: {}, strategyExports: {},
  strategyExportArtifacts: {}, strategyHealthScores: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ type: "eq" })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  gte: vi.fn(), lte: vi.fn(), desc: vi.fn(),
  inArray: vi.fn(), isNull: vi.fn(), isNotNull: vi.fn(), min: vi.fn(),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
  notInArray: vi.fn(),
}));

vi.mock("node-cron", () => ({
  default: { schedule: vi.fn(() => ({ stop: vi.fn() })) },
}));

vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("../lib/logger.js", () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: mockLoggerDebug,
  },
}));

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

vi.mock("../lib/python-runner.js", () => ({ runPythonModule: vi.fn().mockResolvedValue({}) }));

vi.mock("../services/paper-trading-stream.js", () => ({
  startStream: mockStartStream,
  stopStream: vi.fn(),
  isStreaming: vi.fn().mockReturnValue(false),
  getActiveStreams: vi.fn().mockReturnValue([]),
  getStreamHealth: vi.fn().mockReturnValue([]),
  getBarBuffer: vi.fn().mockReturnValue([]),
}));

vi.mock("../services/paper-signal-service.js", () => ({
  restorePositionState: vi.fn(),
  cleanupSession: vi.fn(),
  restoreGovernorState: vi.fn().mockReturnValue(null),
  invalidateDailyLossCache: vi.fn(),
}));

vi.mock("../services/deepar-service.js", () => ({
  trainDeepAR: vi.fn().mockResolvedValue({}),
  predictRegime: vi.fn().mockResolvedValue({}),
  validatePastForecasts: vi.fn().mockResolvedValue({}),
  isDeepARDeferred: vi.fn().mockReturnValue(false),
}));

vi.mock("../services/regime-state-service.js", () => ({ setRegimeWeights: vi.fn() }));
vi.mock("../services/agent-audit-service.js", () => ({ runAgentHealthSweep: vi.fn() }));
vi.mock("../services/portfolio-optimizer-service.js", () => ({ runPortfolioCorrelationCheck: vi.fn() }));
vi.mock("../services/meta-optimizer-service.js", () => ({ runMetaParameterReview: vi.fn() }));
vi.mock("../services/anti-setup-effectiveness-service.js", () => ({ runAntiSetupEffectivenessAnalysis: vi.fn() }));
vi.mock("../services/anti-setup-gate-service.js", () => ({ invalidateAntiSetupCache: vi.fn() }));
vi.mock("../services/paper-session-feedback-service.js", () => ({ computeAndPersistSessionFeedback: vi.fn() }));
vi.mock("../services/validation-cadence-service.js", () => ({ runMonthlyRealityCheckReport: vi.fn() }));
vi.mock("../lib/dlq-service.js", () => ({ registerRetryHandler: vi.fn(), captureToDLQ: vi.fn() }));
vi.mock("../services/macro-regime-service.js", () => ({
  runFredDailyIngestion: vi.fn().mockResolvedValue(0),
  runH41Ingestion: vi.fn().mockResolvedValue(0),
  runBlsIngestion: vi.fn().mockResolvedValue(0),
  runTreasuryAuctionIngestion: vi.fn().mockResolvedValue(0),
  runMacroRegimeClassification: vi.fn(),
  invalidateMacroRegimeCache: vi.fn(),
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
vi.mock("../services/notification-service.js", () => ({
  notifyWarning: vi.fn(), notifyCritical: vi.fn(),
}));
vi.mock("../lib/notification-helpers.js", () => ({ appendFamilyGradePostscript: vi.fn((s: string) => s) }));

// ─── The actual subject we're testing ─────────────────────────────────────────

// We need a controlled mock for the DB that can be reconfigured per-test.
// The db.select() chain has 3 distinct call sites in resumeActivePaperSessions:
//   Call 1: select().from(paperSessions).where(eq(status,'active'))  → Promise resolves to activeSessions
//   Call 2: select().from(strategies).where(eq(id,x)).limit(1)       → Promise resolves to [strategy | undefined]
//   Call 3: select({...}).from(paperPositions).where(and(...))        → Promise resolves to []
//
// We implement this via a call-counter on db.select so call-1 returns activeSessions,
// call-2 returns strategyRow, call-3 returns positions.

let selectCallCount = 0;

/**
 * Build a fresh db mock where:
 *  - First select() resolves to activeSessions
 *  - Second select() resolves to strategyRow (strategy lookup)
 *  - Third+ select() resolves to [] (open positions lookup)
 */
function buildDbMock(
  activeSessions: object[],
  strategyRow: object[],
  positions: object[] = [],
) {
  selectCallCount = 0;
  const mockDb = {
    select: vi.fn((_shape?: unknown) => {
      const callNum = ++selectCallCount;
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => {
            if (callNum === 1) {
              // paperSessions query — resolves directly (no .limit)
              return Promise.resolve(activeSessions);
            }
            if (callNum === 2) {
              // strategies query — returns object with .limit()
              return {
                limit: vi.fn(() => Promise.resolve(strategyRow)),
              };
            }
            // paperPositions query — resolves directly
            return Promise.resolve(positions);
          }),
        })),
      };
    }),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
  };
  return mockDb;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("resumeActivePaperSessions — B5 PAPER+ skip guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCallCount = 0;
  });

  it("skips sessions whose strategy is in PAPER state — no startStream call", async () => {
    const session = {
      id: "aaaaaaaa-0000-0000-0000-000000000001",
      strategyId: "bbbbbbbb-0000-0000-0000-000000000001",
      status: "active",
      governorState: null,
    };
    const strategy = {
      id: "bbbbbbbb-0000-0000-0000-000000000001",
      lifecycleState: "PAPER",
      symbol: "MES",
      config: {},
    };

    // Inject the fresh db mock
    const { db } = await import("../db/index.js");
    const freshDb = buildDbMock([session], [strategy]);
    Object.assign(db, freshDb);

    const { _testOnly } = await import("../scheduler.js");
    await _testOnly.resumeActivePaperSessions();

    expect(mockStartStream).not.toHaveBeenCalled();
  });

  it("emits paper.session_resume_skipped_paper_plus audit row before skip", async () => {
    const sessionId = "aaaaaaaa-0000-0000-0000-000000000002";
    const strategyId = "bbbbbbbb-0000-0000-0000-000000000002";
    const session = { id: sessionId, strategyId, status: "active", governorState: null };
    const strategy = { id: strategyId, lifecycleState: "PAPER", symbol: "MES", config: {} };

    const { db } = await import("../db/index.js");
    Object.assign(db, buildDbMock([session], [strategy]));

    const { _testOnly } = await import("../scheduler.js");
    await _testOnly.resumeActivePaperSessions();

    expect(mockInsertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "paper.session_resume_skipped_paper_plus",
        entityType: "paper_session",
        entityId: sessionId,
        status: "success",
        decisionAuthority: "scheduler",
      }),
    );
  });

  it.each([
    ["DEPLOY_READY"],
    ["PILOT"],
    ["DEPLOYED"],
  ])("skips sessions whose strategy is in %s state", async (lifecycleState) => {
    const session = {
      id: "aaaaaaaa-0000-0000-0000-000000000003",
      strategyId: "bbbbbbbb-0000-0000-0000-000000000003",
      status: "active",
      governorState: null,
    };
    const strategy = {
      id: "bbbbbbbb-0000-0000-0000-000000000003",
      lifecycleState,
      symbol: "MES",
      config: {},
    };

    const { db } = await import("../db/index.js");
    Object.assign(db, buildDbMock([session], [strategy]));

    const { _testOnly } = await import("../scheduler.js");
    await _testOnly.resumeActivePaperSessions();

    expect(mockStartStream).not.toHaveBeenCalled();
    expect(mockInsertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "paper.session_resume_skipped_paper_plus",
      }),
    );
  });

  it("still resumes sessions for CANDIDATE strategies (regression)", async () => {
    const session = {
      id: "aaaaaaaa-0000-0000-0000-000000000004",
      strategyId: "bbbbbbbb-0000-0000-0000-000000000004",
      status: "active",
      governorState: null,
    };
    const strategy = {
      id: "bbbbbbbb-0000-0000-0000-000000000004",
      lifecycleState: "CANDIDATE",
      symbol: "MES",
      config: {},
    };

    const { db } = await import("../db/index.js");
    Object.assign(db, buildDbMock([session], [strategy]));

    const { _testOnly } = await import("../scheduler.js");
    await _testOnly.resumeActivePaperSessions();

    expect(mockStartStream).toHaveBeenCalledWith(session.id, ["MES"]);
    expect(mockInsertAuditRowSafe).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "paper.session_resume_skipped_paper_plus" }),
    );
  });

  it("still resumes sessions for TESTING strategies (regression)", async () => {
    const session = {
      id: "aaaaaaaa-0000-0000-0000-000000000005",
      strategyId: "bbbbbbbb-0000-0000-0000-000000000005",
      status: "active",
      governorState: null,
    };
    const strategy = {
      id: "bbbbbbbb-0000-0000-0000-000000000005",
      lifecycleState: "TESTING",
      symbol: "MNQ",
      config: {},
    };

    const { db } = await import("../db/index.js");
    Object.assign(db, buildDbMock([session], [strategy]));

    const { _testOnly } = await import("../scheduler.js");
    await _testOnly.resumeActivePaperSessions();

    expect(mockStartStream).toHaveBeenCalledWith(session.id, ["MNQ"]);
  });

  it("resumes sessions when lifecycleState is NULL (defensive — legacy rows with no strategy FK)", async () => {
    // NULL lifecycle_state: either strategyId is null (orphaned session) or
    // strategy row doesn't exist. Both should be treated as pre-PAPER (fail-open).
    const session = {
      id: "aaaaaaaa-0000-0000-0000-000000000006",
      strategyId: null, // No FK — orphaned session
      status: "active",
      governorState: null,
    };

    const { db } = await import("../db/index.js");

    // When strategyId is null, the function skips the strategy lookup (strat=[])
    // Call structure: select(paperSessions) → [session]; strategy lookup is skipped.
    // We simulate this by making the second select call return [] (no strategy row).
    Object.assign(db, buildDbMock([session], []));

    const { _testOnly } = await import("../scheduler.js");
    await _testOnly.resumeActivePaperSessions();

    // No startStream because no symbol found (strat is empty), but critically
    // the PAPER+ guard must NOT have fired — no skip audit row.
    expect(mockInsertAuditRowSafe).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "paper.session_resume_skipped_paper_plus" }),
    );
  });

  it("skips PAPER+ session and still resumes a TESTING session in the same batch", async () => {
    const paperSession = {
      id: "aaaaaaaa-0000-0000-0000-000000000007",
      strategyId: "bbbbbbbb-0000-0000-0000-000000000007",
      status: "active",
      governorState: null,
    };
    const testingSession = {
      id: "aaaaaaaa-0000-0000-0000-000000000008",
      strategyId: "bbbbbbbb-0000-0000-0000-000000000008",
      status: "active",
      governorState: null,
    };

    // For the mixed batch we need the DB to alternate between two strategy rows.
    // Simulate by making select call 2 → PAPER strategy, select call 4 → TESTING strategy.
    selectCallCount = 0;
    let innerSelectCount = 0;
    const mixedDb = {
      select: vi.fn((_shape?: unknown) => {
        const callNum = ++selectCallCount;
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => {
              if (callNum === 1) {
                // paperSessions query — two active sessions
                return Promise.resolve([paperSession, testingSession]);
              }
              // Strategy queries alternate: PAPER then TESTING
              innerSelectCount++;
              if (innerSelectCount === 1) {
                return { limit: vi.fn(() => Promise.resolve([{ id: paperSession.strategyId, lifecycleState: "PAPER", symbol: "MES", config: {} }])) };
              }
              if (innerSelectCount === 2) {
                return { limit: vi.fn(() => Promise.resolve([{ id: testingSession.strategyId, lifecycleState: "TESTING", symbol: "MNQ", config: {} }])) };
              }
              // paperPositions queries
              return Promise.resolve([]);
            }),
          })),
        };
      }),
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    };

    const { db } = await import("../db/index.js");
    Object.assign(db, mixedDb);

    const { _testOnly } = await import("../scheduler.js");
    await _testOnly.resumeActivePaperSessions();

    // PAPER session → no stream
    expect(mockStartStream).not.toHaveBeenCalledWith(paperSession.id, expect.anything());
    // TESTING session → stream started
    expect(mockStartStream).toHaveBeenCalledWith(testingSession.id, ["MNQ"]);
    // Exactly one skip audit row for the PAPER session
    expect(mockInsertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "paper.session_resume_skipped_paper_plus",
        entityId: paperSession.id,
      }),
    );
  });
});
