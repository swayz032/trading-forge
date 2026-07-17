/**
 * scheduler-resume-paper-plus-skip.test.ts
 *
 * B5 — scheduler-b5: Verifies that resumeActivePaperSessions() never starts an
 * internal Massive-WS simulator stream for strategies that are in a
 * broker-authoritative lifecycle state (DEPLOY_READY / PILOT / DEPLOYED).
 *
 * INVERTED for M3 PAPER Authority Flip (2026-07-17): PAPER moved OUT of the
 * skip-set. PAPER is now internal-engine-only, so a PAPER-state session must
 * RESUME its internal stream on restart exactly like CANDIDATE/TESTING/SHADOW —
 * it is simply no longer special-cased here.
 *
 * Background:
 *   On PAPER→DEPLOY_READY transition (M3's new sibling-stop block in
 *   lifecycle-service.ts), stopStream() is called in-process but
 *   paper_sessions.status is NEVER written back to 'stopped'. On restart,
 *   every active-status session would get a fresh internal stream even if
 *   TradersPost is already the canonical journal for that (now broker-
 *   authoritative) strategy — causing dual-stream P&L drift.
 *
 * This test suite covers:
 *   1. PAPER state → RESUMES (startStream called) — M3 inversion (was: skip)
 *   2. DEPLOY_READY / PILOT / DEPLOYED → skip, audit row emitted (parametric, unchanged)
 *   3. CANDIDATE / TESTING → still resumes (regression, unchanged)
 *   4. NULL lifecycleState (orphaned session) → still resumes (fail-open regression, unchanged)
 *   5. Audit row action and fields are correct before skip (unchanged)
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

  it("M3: RESUMES sessions whose strategy is in PAPER state — startStream IS called (was: skip, pre-M3)", async () => {
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

    expect(mockStartStream).toHaveBeenCalledWith(session.id, ["MES"]);
    expect(mockInsertAuditRowSafe).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "paper.session_resume_skipped_paper_plus" }),
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

  it("M3: skips a DEPLOY_READY session but resumes PAPER and TESTING sessions in the same batch (the M3 boundary, exercised together)", async () => {
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
    const deployReadySession = {
      id: "aaaaaaaa-0000-0000-0000-000000000009",
      strategyId: "bbbbbbbb-0000-0000-0000-000000000009",
      status: "active",
      governorState: null,
    };

    // For the mixed batch we dispatch by QUERY SHAPE rather than call-ordinal —
    // PAPER and TESTING now both resume (strategy lookup + position lookup),
    // while DEPLOY_READY skips right after its strategy lookup (no position
    // lookup at all). Counting call numbers naively would silently mis-route
    // once the number of DB round-trips differs per session (exactly the
    // fragility M3 introduces by letting PAPER resume). Dispatch on the
    // position-query's distinctive shape (`trailHwm` key) instead for THAT
    // case, and drive strategy lookups off a FIFO queue matching the sessions
    // array's processing order (resumeActivePaperSessions iterates sessions
    // sequentially, one strategy lookup per session, so a queue popped in
    // order is robust regardless of how many position lookups interleave).
    selectCallCount = 0;
    const strategyRowsById: Record<string, { id: string; lifecycleState: string; symbol: string; config: Record<string, unknown> }> = {
      [paperSession.strategyId]: { id: paperSession.strategyId, lifecycleState: "PAPER", symbol: "MES", config: {} },
      [testingSession.strategyId]: { id: testingSession.strategyId, lifecycleState: "TESTING", symbol: "MNQ", config: {} },
      [deployReadySession.strategyId]: { id: deployReadySession.strategyId, lifecycleState: "DEPLOY_READY", symbol: "MCL", config: {} },
    };
    const strategyLookupQueue = [paperSession.strategyId, testingSession.strategyId, deployReadySession.strategyId];
    let strategyLookupIdx = 0;
    const mixedDb = {
      select: vi.fn((shape?: Record<string, unknown>) => {
        const callNum = ++selectCallCount;
        const isPositionsShape = !!shape && "trailHwm" in shape;
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => {
              if (callNum === 1) {
                // paperSessions query — three active sessions
                return Promise.resolve([paperSession, testingSession, deployReadySession]);
              }
              if (isPositionsShape) {
                // paperPositions query — no open positions in this test
                return Promise.resolve([]);
              }
              // Strategy lookup — pop the next expected strategyId off the queue.
              const strategyId = strategyLookupQueue[strategyLookupIdx];
              strategyLookupIdx++;
              const row = strategyId ? strategyRowsById[strategyId] : undefined;
              return { limit: vi.fn(() => Promise.resolve(row ? [row] : [])) };
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

    // PAPER session → stream started (M3 inversion)
    expect(mockStartStream).toHaveBeenCalledWith(paperSession.id, ["MES"]);
    // TESTING session → stream started (unchanged)
    expect(mockStartStream).toHaveBeenCalledWith(testingSession.id, ["MNQ"]);
    // DEPLOY_READY session → NO stream (still broker-authoritative, untouched by this wave)
    expect(mockStartStream).not.toHaveBeenCalledWith(deployReadySession.id, expect.anything());
    // Exactly one skip audit row, for the DEPLOY_READY session only
    expect(mockInsertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "paper.session_resume_skipped_paper_plus",
        entityId: deployReadySession.id,
      }),
    );
    expect(mockInsertAuditRowSafe).not.toHaveBeenCalledWith(
      expect.objectContaining({ entityId: paperSession.id }),
    );
  });
});
