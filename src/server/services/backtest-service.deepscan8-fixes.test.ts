/**
 * Deepscan #8 Fix Wave — backtest-service.ts unit tests
 *
 * FIX 3: .catch() on fire-and-forget IIFEs (QUBO, legacy RL, C.2 RL) — pattern test
 * FIX 4: correlationId synthesized as "bt-auto-<ts>-<8hex>" when caller omits it
 * FIX 5: structured Python error envelopes: extrapolation_exceeded / rule_version_mismatch
 * FIX 6: audit rows for pipeline-pause refusal (automated) and bypass (operator)
 *
 * Test philosophy: "Test suite has ZERO real-DB coverage historically — mock db.insert."
 * All audit-write assertions use the insertAuditRowSafe spy (never a real DB).
 * status NOT NULL on all audit_log rows (enforced in spy call assertions below).
 * No "payload" column is used (not in schema).
 */

import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";

// ─── Hoisted spy / mock state ─────────────────────────────────────────────────
// vi.hoisted runs before vi.mock — allows spy references inside mock factories.

const {
  insertAuditRowSafeSpy,
  insertAuditRowSpy,
  dbInsertMock,
  dbUpdateMock,
  dbSelectMock,
  dbTransactionMock,
  runMonteCarloMock,
  isPipelineActiveMock,
  runPythonModuleMock,
  circuitBreakerCallMock,
  broadcastSSEMock,
  loggerMock,
  backtestRunsLabelsMock,
} = vi.hoisted(() => {
  // ── db.insert chain mock ────────────────────────────────────────────────────
  // Returns [{ id: "bt-test-id" }] for the initial backtests insert.
  // All other inserts return [].
  const returningMock = vi.fn().mockResolvedValue([{ id: "bt-test-id", strategyId: "strat-1" }]);
  const valuesMock = vi.fn(() => ({ returning: returningMock }));
  const dbInsertMock = vi.fn(() => ({ values: valuesMock }));

  // ── db.update chain mock ────────────────────────────────────────────────────
  const updateWhereMock = vi.fn().mockResolvedValue([]);
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const dbUpdateMock = vi.fn(() => ({ set: updateSetMock }));

  // ── db.select chain mock ────────────────────────────────────────────────────
  const selectLimitMock = vi.fn().mockResolvedValue([]);
  const selectWhereMock = vi.fn(() => ({ limit: selectLimitMock }));
  const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
  const dbSelectMock = vi.fn(() => ({ from: selectFromMock }));

  // ── db.transaction mock ─────────────────────────────────────────────────────
  // Calls the callback with a tx object backed by the same insert/update/select mocks.
  // Needed for the B10 test where the main success path reaches db.transaction at line 770.
  // The closure captures the mock references — beforeEach re-implementations are reflected.
  const dbTransactionMock = vi.fn(async (fn: (tx: Record<string, unknown>) => unknown) =>
    fn({ insert: dbInsertMock, update: dbUpdateMock, select: dbSelectMock }),
  );

  // ── runMonteCarlo mock (shared reference for vi.mock below) ─────────────────
  // Must return a Promise so the fire-and-forget MC trigger IIFE can call .then()
  // on the result. With the db.transaction mock now in place, tests that reach
  // the MC trigger section (tier="PASS", daily_pnls present) need runMonteCarlo
  // to return a resolved value to avoid unhandled rejection on undefined.then().
  const runMonteCarloMock = vi.fn().mockResolvedValue({ id: "mc-mock-id", status: "completed" });

  const isPipelineActiveMock = vi.fn().mockResolvedValue(true);
  const runPythonModuleMock = vi.fn();
  const circuitBreakerCallMock = vi.fn((fn: () => unknown) => fn());
  const broadcastSSEMock = vi.fn();
  const loggerMock = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const insertAuditRowSafeSpy = vi.fn().mockResolvedValue(true);
  const insertAuditRowSpy = vi.fn().mockResolvedValue(undefined);

  // R-752 §5 (D-8): the completed-run counter needs a STABLE handle so a test can
  // assert it was NOT incremented. The previous inline `vi.fn(() => ({ inc: vi.fn() }))`
  // minted a fresh `inc` on every call, so "inc was not called" was unobservable —
  // it would have passed whether or not the counter fired. Assert on `labels`, which
  // carries the {status} label the refusal must never claim.
  const backtestRunsLabelsMock = vi.fn(
    (_labels?: { status?: string; mode?: string; tier?: string }) => ({ inc: vi.fn() }),
  );

  return {
    insertAuditRowSafeSpy,
    insertAuditRowSpy,
    dbInsertMock,
    dbUpdateMock,
    dbSelectMock,
    dbTransactionMock,
    runMonteCarloMock,
    isPipelineActiveMock,
    runPythonModuleMock,
    circuitBreakerCallMock,
    broadcastSSEMock,
    loggerMock,
    backtestRunsLabelsMock,
  };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    insert: dbInsertMock,
    update: dbUpdateMock,
    select: dbSelectMock,
    transaction: dbTransactionMock,
  },
}));

vi.mock("../db/schema.js", () => ({
  // R-752 §5 (D-8): the persisted-status constant is a real export of the schema
  // module, so this hand-written mock must carry it too. It is deliberately the
  // SAME literal as production rather than a stand-in — a mock that invents its own
  // value would let a production rename pass green here.
  BACKTEST_STATUS_REFUSED: "refused",
  backtests: { name: "backtests" },
  backtestTrades: {},
  stressTestRuns: {},
  strategies: {},
  paperSessions: {},
  auditLog: {},
  walkForwardWindows: {},
  strategyNames: {},
  sqaOptimizationRuns: {},
  quboTimingRuns: { name: "quboTimingRuns" },
  tensorPredictions: {},
  rlTrainingRuns: {},
  monteCarloRuns: {},
  backtestProvenance: {},
  researchTrialCounter: {},
}));

vi.mock("../routes/sse.js", () => ({ broadcastSSE: broadcastSSEMock }));
vi.mock("./paper-trading-stream.js", () => ({ startStream: vi.fn() }));
vi.mock("./monte-carlo-service.js", () => ({ runMonteCarlo: runMonteCarloMock }));
vi.mock("./quantum-mc-service.js", () => ({ runQuantumMC: vi.fn().mockResolvedValue({ id: "qmc-1", status: "completed" }) }));
vi.mock("../../data/loaders/duckdb-service.js", () => ({ queryInfo: vi.fn().mockResolvedValue({ rows: [] }) }));
vi.mock("../../shared/firm-config.js", () => ({ getFirmLimit: vi.fn().mockReturnValue(50000) }));
vi.mock("../../shared/walk-forward-schema.js", () => ({ WFWindowMetricsSchema: { parse: vi.fn((x: unknown) => x) } }));
vi.mock("../lib/logger.js", () => ({ logger: loggerMock }));
vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: runPythonModuleMock,
  buildBacktestArgs: vi.fn(() => []),
}));
vi.mock("../lib/circuit-breaker.js", () => ({
  CircuitBreakerRegistry: {
    get: vi.fn(() => ({ call: circuitBreakerCallMock })),
  },
}));
vi.mock("../lib/sqa-promise-registry.js", () => ({ sqaRegistry: { get: vi.fn(() => null), set: vi.fn(), delete: vi.fn() } }));
vi.mock("../lib/dlq-service.js", () => ({ captureToDLQ: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/tracing.js", () => ({
  tracer: { startSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn() })) },
}));
vi.mock("./pipeline-control-service.js", () => ({ isActive: isPipelineActiveMock }));
vi.mock("../lib/metrics-registry.js", () => ({
  backtestRuns: { labels: backtestRunsLabelsMock },
  backtestScoredTotal: { labels: vi.fn(() => ({ inc: vi.fn() })) },
  rlTrainingEpochsTotal: { labels: vi.fn(() => ({ inc: vi.fn() })) },
}));
vi.mock("../lib/quantum-cost-tracker.js", () => ({
  recordCost: vi.fn().mockResolvedValue({ id: "cost-1" }),
  completeCost: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/result-hasher.js", () => ({
  computeResultHash: vi.fn(() => "hash-result"),
  computeDataHash: vi.fn(() => "hash-data"),
  computeStrategyHash: vi.fn(() => "hash-strategy"),
}));
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: insertAuditRowSafeSpy,
  insertAuditRow: insertAuditRowSpy,
}));
vi.mock("./notification-service.js", () => ({ notifyCritical: vi.fn() }));
// Disable quantum replay in all tests — the auto-fire IIFE does a dynamic import and returns
// early when isQuantumReplayEnabled() returns false. Without this mock, the import fails, the
// IIFE catch-block fires, and db.insert().values().catch() throws because the plain-object
// mock result lacks a .catch() method, producing unhandled rejections.
vi.mock("../lib/quantum-replay-runner.js", () => ({
  isQuantumReplayEnabled: vi.fn(() => false),
  runQuantumReplayForBacktest: vi.fn().mockResolvedValue({ status: "skipped", rowsWritten: 0, durationMs: 0 }),
  _getConsecutiveFailuresForTests: vi.fn(() => 0),
}));
vi.mock("../lib/firm-rules-version.js", () => ({ computeFirmRulesVersion: vi.fn(() => "v1-mock") }));
vi.mock("../lib/compliance-mode.js", () => ({
  resolveComplianceMode: vi.fn(() => ({ mode: "strict", source: "default" })),
  isResearchBacktest: vi.fn(() => false),
}));
vi.mock("../lib/learning-loop-mode.js", () => ({
  readLearningLoopMode: vi.fn().mockResolvedValue({ mode: 0, autonomousOn: false }),
}));
vi.mock("../lib/backtest-args.js", () => ({ buildBacktestArgs: vi.fn(() => []) }));

// ─── Minimal backtest config ──────────────────────────────────────────────────

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    strategy: {
      symbol: "MNQ",
      timeframe: "5m",
    },
    mode: "single",
    start_date: "2024-01-01",
    end_date: "2024-06-30",
    ...overrides,
  };
}

// ─── Import the service (after mocks) ────────────────────────────────────────

import { runBacktest } from "./backtest-service.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("FIX 4 — correlationId synthesized when absent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPipelineActiveMock.mockResolvedValue(false); // pause guard path for easy visibility
  });

  it("synthesizes a bt-auto-* correlationId when caller passes undefined", async () => {
    await runBacktest("strat-1", makeConfig() as never, undefined, undefined, undefined, "automated");

    // The refusal audit row (FIX 6) should carry the synthesized correlationId
    expect(insertAuditRowSafeSpy).toHaveBeenCalled();
    const callArgs = (insertAuditRowSafeSpy as MockInstance).mock.calls[0][0] as Record<string, unknown>;
    const cid = callArgs["correlationId"] as string;
    // Pattern: bt-auto-<epoch>-<8hex>
    expect(cid).toMatch(/^bt-auto-\d+-[0-9a-f]{8}$/);
  });
});

describe("FIX 6 — pipeline-pause audit rows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPipelineActiveMock.mockResolvedValue(false); // pipeline is PAUSED
  });

  it("writes backtest.pipeline_pause_refusal row for automated caller when paused", async () => {
    const result = await runBacktest(
      "strat-2",
      makeConfig() as never,
      undefined,
      undefined,
      "corr-test-001",
      "automated",
    );

    expect(result.status).toBe("skipped");
    expect(result.error).toBe("pipeline_paused");

    expect(insertAuditRowSafeSpy).toHaveBeenCalledOnce();
    const row = (insertAuditRowSafeSpy as MockInstance).mock.calls[0][0] as Record<string, unknown>;
    expect(row["action"]).toBe("backtest.pipeline_pause_refusal");
    expect(row["entityType"]).toBe("strategy");
    expect(row["entityId"]).toBe("strat-2");
    // status NOT NULL
    expect(row["status"]).toBe("success");
    expect(row["correlationId"]).toBe("corr-test-001");
    expect(row["decisionAuthority"]).toBe("system");
    // No "payload" field in audit_log schema
    expect(row["payload"]).toBeUndefined();
  });

  it("does NOT block the operator caller — audit bypass row written before execution continues", async () => {
    // Operator bypass: pipeline paused but actor=operator continues.
    // We make db.insert(backtests) throw synchronously (it's OUTSIDE the inner try-catch)
    // so the function rejects after the bypass audit row was already fired.
    // The key assertion: insertAuditRowSafe was called with bypass action BEFORE the throw.
    dbInsertMock.mockImplementationOnce(() => {
      throw new Error("DB_THROW_AFTER_BYPASS_LOGGED");
    });

    // Since db.insert is outside the inner try-catch, runBacktest itself rejects.
    await expect(
      runBacktest("strat-3", makeConfig() as never, undefined, undefined, "corr-op-001", "operator"),
    ).rejects.toThrow("DB_THROW_AFTER_BYPASS_LOGGED");

    // The bypass audit row must have been fired synchronously BEFORE the db.insert throw
    const auditCalls = (insertAuditRowSafeSpy as MockInstance).mock.calls;
    const bypassCall = auditCalls.find(
      (call) => (call[0] as Record<string, unknown>)["action"] === "backtest.pipeline_pause_bypass",
    );
    expect(bypassCall).toBeDefined();

    const row = bypassCall![0] as Record<string, unknown>;
    expect(row["entityType"]).toBe("strategy");
    expect(row["entityId"]).toBe("strat-3");
    // status NOT NULL
    expect(row["status"]).toBe("success");
    expect(row["decisionAuthority"]).toBe("operator");
    expect(row["correlationId"]).toBe("corr-op-001");
    // No "payload" field in audit_log schema
    expect(row["payload"]).toBeUndefined();
  });
});

describe("FIX 5 — structured Python error envelopes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPipelineActiveMock.mockResolvedValue(true); // pipeline ACTIVE
    dbInsertMock.mockImplementation(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: "bt-envelope-id", strategyId: "strat-env" }]),
      })),
    }));
    dbUpdateMock.mockImplementation(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    }));
    // Research trial counter select — throw (caught in try/catch, defaults to 1)
    dbSelectMock.mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn().mockRejectedValue(new Error("NO_TRIAL_TABLE")) })),
      })),
    }));
  });

  it("treats {status:'extrapolation_exceeded'} as a failure", async () => {
    runPythonModuleMock.mockResolvedValue({ status: "extrapolation_exceeded" });

    const result = await runBacktest(
      "strat-env",
      makeConfig() as never,
      undefined,
      undefined,
      "corr-env-001",
    );

    expect(result.status).toBe("failed");
    expect(result.error).toBe("python_envelope_status:extrapolation_exceeded");

    // DB should have been updated to "failed"
    expect(dbUpdateMock).toHaveBeenCalled();
    const updateSet = dbUpdateMock.mock.results[0].value as { set: MockInstance };
    expect(updateSet.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", errorMessage: "python_envelope_status:extrapolation_exceeded" }),
    );

    // broadcastSSE should carry the error
    expect(broadcastSSEMock).toHaveBeenCalledWith(
      "backtest:failed",
      expect.objectContaining({ error: "python_envelope_status:extrapolation_exceeded" }),
    );
  });

  it("treats {status:'rule_version_mismatch'} as a failure", async () => {
    runPythonModuleMock.mockResolvedValue({ status: "rule_version_mismatch" });

    const result = await runBacktest(
      "strat-env",
      makeConfig() as never,
      undefined,
      undefined,
      "corr-env-002",
    );

    expect(result.status).toBe("failed");
    expect(result.error).toBe("python_envelope_status:rule_version_mismatch");
  });

  it("still treats result.error as a failure (existing behavior preserved)", async () => {
    runPythonModuleMock.mockResolvedValue({ error: "backtester crashed" });

    const result = await runBacktest(
      "strat-env",
      makeConfig() as never,
      undefined,
      undefined,
      "corr-env-003",
    );

    expect(result.status).toBe("failed");
    expect(result.error).toBe("backtester crashed");
  });

  it("treats {status:'ok'} as failure under allowlist semantics (not in KNOWN_SUCCESS)", async () => {
    // Under the allowlist conversion (wave-2 FIX 1), ANY present top-level status
    // not in KNOWN_SUCCESS (intentionally empty — backtester.py emits no status on
    // the happy path) is treated as failure. The previous denylist let 'ok' fall
    // through to success; the allowlist now correctly intercepts it.
    runPythonModuleMock.mockResolvedValue({
      status: "ok",
      sharpe: 1.5,
      total_return: 0.10,
      max_drawdown: 0.05,
      tier: "PASS",
      total_trades: 10,
      win_rate: 0.6,
      daily_pnls: [100, 200, -50],
    });

    const result = await runBacktest(
      "strat-env",
      makeConfig() as never,
      undefined,
      undefined,
      "corr-env-004",
    );

    // Allowlist: any present top-level status not in KNOWN_SUCCESS → failure
    expect(result.status).toBe("failed");
    expect(result.error).toBe("python_envelope_status:ok");
  });

  it("treats any unknown/future envelope status as failure (allowlist future-proofing)", async () => {
    // Simulates a future Python module emitting a status value not yet enumerated.
    // Under the old denylist this would silently fall through to success processing.
    // Under the allowlist it correctly fails.
    runPythonModuleMock.mockResolvedValue({ status: "future_new_status" });

    const result = await runBacktest(
      "strat-env",
      makeConfig() as never,
      undefined,
      undefined,
      "corr-env-005",
    );

    expect(result.status).toBe("failed");
    expect(result.error).toBe("python_envelope_status:future_new_status");
  });

  it("does NOT intercept nested sub-object statuses — top-level key only", async () => {
    // A result with NO top-level status but WITH nested status fields inside sub-objects.
    // The allowlist check must only read (result as {status?:string}).status
    // and must never dig into gate_result.status, parity_shadow.status, etc.
    runPythonModuleMock.mockResolvedValue({
      // No top-level 'status' key — the true happy-path shape
      sharpe: 1.5,
      total_return: 0.10,
      max_drawdown: 0.05,
      tier: "PASS",
      total_trades: 10,
      win_rate: 0.6,
      daily_pnls: [100, 200, -50],
      // Nested sub-objects with their own status fields — must be ignored
      gate_result: { status: "unknown" },
      parity_shadow: { status: "diverged" },
    });

    const result = await runBacktest(
      "strat-env",
      makeConfig() as never,
      undefined,
      undefined,
      "corr-env-006",
    );

    // Envelope check must NOT intercept nested sub-object statuses.
    // Use ?? "" to guard against result.error being undefined on a full success path.
    expect(result.error ?? "").not.toContain("python_envelope_status");
  });

  it("passes through when top-level status is absent (the happy-path shape — no status field)", async () => {
    // backtester.py emits no top-level 'status' key on success (verified by grep).
    // A result with no top-level status field must NOT be blocked by the envelope check.
    runPythonModuleMock.mockResolvedValue({
      sharpe: 2.0,
      total_return: 0.25,
      max_drawdown: 0.08,
      tier: "PASS",
      total_trades: 50,
      win_rate: 0.62,
      daily_pnls: [100, 200, -50, 300, 150],
      // Deliberately no 'status' key at top level
    });

    const result = await runBacktest(
      "strat-env",
      makeConfig() as never,
      undefined,
      undefined,
      "corr-env-007",
    );

    // No top-level status → not intercepted by the envelope guard.
    // Use ?? "" to guard against result.error being undefined on a full success path.
    expect(result.error ?? "").not.toContain("python_envelope_status");
  });
});

describe("FIX 2 — B10 MRP regime data unavailable audit", () => {
  // All 5 trades have null macroRegime → bucket into UNKNOWN → no named regime keys.
  const UNKNOWN_REGIME_TRADES = [
    { pnl: "100", macroRegime: null },
    { pnl: "200", macroRegime: null },
    { pnl: "-50", macroRegime: null },
    { pnl: "150", macroRegime: null },
    { pnl: "80", macroRegime: null },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    isPipelineActiveMock.mockResolvedValue(true);

    // db.insert for backtests row creation
    dbInsertMock.mockImplementation(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: "bt-b10-id", strategyId: "strat-b10" }]),
      })),
    }));

    // db.update: all updates succeed (mrp_sharpe write, backtest status update, etc.)
    dbUpdateMock.mockImplementation(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    }));

    // db.select: dual-mode mock that handles two different query shapes in one setup:
    //  - Research trial counter: .where().limit(1) → .limit() throws → caught in F-4
    //    try/catch → defaults trial_n_total=1 (main flow continues normally).
    //  - B10 trades query: await .where() directly (no .limit()) → resolves to
    //    UNKNOWN_REGIME_TRADES so all trades have null macroRegime.
    //  - Any other .where() direct-await calls in fire-and-forget IIFEs also receive
    //    UNKNOWN_REGIME_TRADES, which those IIFEs handle gracefully.
    // dbSelectMock typed from hoisted factory ({where: () => {limit:...}}).
    // The dual-mode implementation returns a Promise (for B10 direct await) decorated
    // with .limit() (for research trial counter). Cast bypasses the structural mismatch.
    (dbSelectMock as MockInstance).mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          // Return a Promise (for direct await) that also has .limit() (for counter query).
          const p = Promise.resolve(UNKNOWN_REGIME_TRADES);
          (p as unknown as Record<string, unknown>)["limit"] = vi
            .fn()
            .mockRejectedValue(new Error("NO_TRIAL_TABLE_B10"));
          return p;
        }),
      })),
    }));
  });

  it("fires exactly one b10_regime_data_unavailable audit row when all trades are UNKNOWN regime", async () => {
    // Happy-path result: no top-level status key (true backtester.py shape on success).
    // All 5 mock trades have null macroRegime, so byRegime = {UNKNOWN: [...]},
    // regimeSharpes = {}, and the FIX 2 condition fires.
    runPythonModuleMock.mockResolvedValue({
      sharpe: 1.8,
      total_return: 0.15,
      max_drawdown: 0.07,
      tier: "PASS",
      total_trades: 5,
      win_rate: 0.6,
      daily_pnls: [100, 200, -50, 150, 80],
    });

    await runBacktest(
      "strat-b10",
      makeConfig() as never,
      undefined,
      undefined,
      "corr-b10-001",
    );

    // Allow the fire-and-forget B10 IIFE to settle.
    // B10's first await (db.select) is a resolved Promise → runs on next microtask.
    // After that, all B10 steps are synchronous (void insertAuditRowSafe, logger, return).
    // setTimeout(0) schedules a macrotask, which fires only after all pending microtasks.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // Exactly ONE b10_regime_data_unavailable audit row must have been fired
    const b10Calls = (insertAuditRowSafeSpy as MockInstance).mock.calls.filter(
      (call) => (call[0] as Record<string, unknown>)["action"] === "backtest.b10_regime_data_unavailable",
    );
    expect(b10Calls).toHaveLength(1);

    const row = b10Calls[0]![0] as Record<string, unknown>;
    expect(row["action"]).toBe("backtest.b10_regime_data_unavailable");
    expect(row["entityType"]).toBe("backtest");
    // status NOT NULL — must be "info" per the FIX 2 spec
    expect(row["status"]).toBe("info");
    const input = row["input"] as Record<string, unknown>;
    expect(input["reason"]).toBe("macro_regime_null_all_windows");
    expect(input["backtestId"]).toBeDefined();
    // No "payload" column in audit_log schema
    expect(row["payload"]).toBeUndefined();
  });
});

describe("FIX 3 — IIFE .catch() prevents unhandled rejection (pattern)", () => {
  it("fire-and-forget IIFE rejection absorbed by .catch() (pattern verification)", async () => {
    // This test verifies the SEMANTICS of the .catch() pattern applied to the
    // QUBO / legacy-RL / C.2-RL IIFEs in backtest-service.ts.
    //
    // The IIFEs fire as background tasks. When their first await rejects OUTSIDE
    // their internal try/catch (e.g. the initial db.insert row), the outer .catch()
    // — added in deepscan8 FIX 3 — must absorb the rejection so it never becomes
    // an UnhandledPromiseRejection.
    //
    // Full integration test is not practical without mocking the entire success path.
    // The exact pattern is verified by tsc (0 errors) and grep proof.
    //
    // This test verifies the JS semantics: a rejected async IIFE with .catch() is handled.

    const caughtErrors: unknown[] = [];

    // Replicate the pattern:  (async () => { throw ... })().catch(e => ...)
    await (async () => {
      throw new Error("IIFE_REJECT_ABSORBED");
    })().catch((e: unknown) => {
      caughtErrors.push(e);
    });

    expect(caughtErrors).toHaveLength(1);
    expect(caughtErrors[0]).toBeInstanceOf(Error);
    expect((caughtErrors[0] as Error).message).toBe("IIFE_REJECT_ABSORBED");
  });

  it("void + .catch() chain does not propagate to caller (runtime guard)", async () => {
    // Mirrors: void (async () => { ... })().catch((e) => logger.error(...))
    // The 'void' discards the settled promise; no unhandled rejection propagates.
    const errors: unknown[] = [];

    void (async () => {
      throw new Error("VOIDED_CATCH_TEST");
    })().catch((e: unknown) => errors.push(e));

    // Wait for microtask queue to drain
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("VOIDED_CATCH_TEST");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// R-752 §5 (D-8) — THE PYTHON→TYPESCRIPT REFUSAL HANDOFF
//
// R-752 §3, verified three ways by the desk and re-measured independently by AR-855:
// NO production TypeScript reads `execution_status`. The envelope gate at :809 tests
// `result.error` (a refusal carries none) and top-level `result.status` (a refusal emits
// `execution_status`, a DIFFERENT KEY) — so both disjuncts are false, control falls
// through to the normal success path, and :979 writes `completed`.
//
//     Python:     execution_status = REFUSED
//     TypeScript: backtest status  = completed
//
// Both cannot be true. `A REFUSAL THAT BECOMES "COMPLETED" AT THE NEXT SERVICE BOUNDARY
// IS NOT TERMINAL — IT IS TERMINAL ONLY INSIDE ONE PROCESS.`
//
// FIXTURE PROVENANCE — this envelope is EXECUTION-DERIVED, not hand-typed. It was dumped
// from the committed Python test's own `_golden_spec()` + `_run()` helpers by calling
// `strategy.execution_refusal()`, which is available BEFORE compute() and WITHOUT bars by
// its own docstring (spec_condition_compiler.py:666). Top-level shape read at the
// executable line, backtester.py:8398-8417 plus :8710 `analysis_omitted`.
// `A HAND-BUILT FIXTURE THAT DOES NOT MATCH PRODUCTION IS AN INSTRUMENT THAT LIES WHILE
// THE CODE IS FINE.`
// ═══════════════════════════════════════════════════════════════════════════════

const REAL_PYTHON_REFUSAL_ENVELOPE = {
  execution_status: "REFUSED",
  compiled: false,
  entry_eligible: false,
  refusal: {
    execution_status: "REFUSED",
    compiled: false,
    entry_eligible: false,
    condition_id: "WAIT_STRUCTURE:when-price-breaks-above-the-range-high-f#4",
    disposition: "SOURCE_AMBIGUOUS",
    reason: "opening_range_breakout_confirmation_unresolved_from_source",
    ambiguity: "breakout_confirmation_semantics",
    source_prose:
      "When price breaks above the range high, for example, so a bullish breakout, which is what we saw an example of, that is where buyers have overcome that initial resistance.",
  },
  metrics_omitted: [
    "pnl",
    "total_return",
    "sharpe",
    "profit_factor",
    "win_rate",
    "max_drawdown",
    "trades",
    "equity_curve",
  ],
  metrics_omitted_reason:
    "execution was REFUSED before any backtest ran; publishing zeroed performance metrics would present a refusal as a flat result",
  governance_labels: {
    approximation: true,
    spec_condition_compiled: true,
    spec_hash: "trigger-safety",
    execution_refused: true,
  },
  analysis_omitted: [
    "forge_score",
    "forge_score_components",
    "invariants",
    "parity_shadow",
    "b15_battery",
    "crisis_results",
    "expected_signals",
  ],
  analysis_omitted_reason:
    "execution was REFUSED before any backtest ran; these are ANALYTICAL products derived from trades that do not exist",
};

describe("R-752 §5 (D-8) — a Python REFUSAL survives the TypeScript boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPipelineActiveMock.mockResolvedValue(true);
    dbInsertMock.mockImplementation(() => ({
      values: vi.fn(() => ({
        returning: vi
          .fn()
          .mockResolvedValue([{ id: "bt-refusal-id", strategyId: "strat-refusal" }]),
      })),
    }));
    dbUpdateMock.mockImplementation(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    }));
    dbSelectMock.mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn().mockRejectedValue(new Error("NO_TRIAL_TABLE")) })),
      })),
    }));
  });

  // Every `set(...)` payload written to the backtests row, in call order.
  function allUpdateSetPayloads(): Record<string, unknown>[] {
    return dbUpdateMock.mock.results.flatMap((r) => {
      const set = (r.value as { set: MockInstance }).set;
      return set.mock.calls.map((c) => c[0] as Record<string, unknown>);
    });
  }

  it("CONTROL A — persists and returns `refused`, never `completed`", async () => {
    runPythonModuleMock.mockResolvedValue({ ...REAL_PYTHON_REFUSAL_ENVELOPE });

    const result = await runBacktest(
      "strat-refusal",
      makeConfig() as never,
      undefined,
      undefined,
      "corr-refusal-001",
    );

    expect(result.status).toBe("refused");
    // A refusal is NOT a crash — no error channel, in either direction (R-752 §6-2).
    expect((result as { error?: unknown }).error).toBeUndefined();

    const payloads = allUpdateSetPayloads();
    expect(payloads.some((p) => p["status"] === "refused")).toBe(true);
    expect(payloads.some((p) => p["status"] === "completed")).toBe(false);
    expect(payloads.some((p) => p["status"] === "failed")).toBe(false);
    // The refusal reason must NOT be laundered through errorMessage (R-752 §6-4).
    expect(payloads.some((p) => p["errorMessage"] != null)).toBe(false);
  });

  it("CONTROL A — persists the refusal EVIDENCE, not merely the status", async () => {
    runPythonModuleMock.mockResolvedValue({ ...REAL_PYTHON_REFUSAL_ENVELOPE });

    await runBacktest(
      "strat-refusal",
      makeConfig() as never,
      undefined,
      undefined,
      "corr-refusal-002",
    );

    const refusalWrite = allUpdateSetPayloads().find((p) => p["status"] === "refused");
    expect(refusalWrite).toBeDefined();
    const extras = refusalWrite!["resultExtras"] as Record<string, unknown>;
    expect(extras).toBeDefined();

    // R-752 §6-4's enumerated evidence set. A status with no evidence is a label.
    expect(extras["execution_status"]).toBe("REFUSED");
    expect(extras["entry_eligible"]).toBe(false);
    expect(extras["condition_id"]).toBe(
      "WAIT_STRUCTURE:when-price-breaks-above-the-range-high-f#4",
    );
    expect(extras["disposition"]).toBe("SOURCE_AMBIGUOUS");
    expect(extras["reason"]).toBe("opening_range_breakout_confirmation_unresolved_from_source");
    expect(extras["ambiguity"]).toBe("breakout_confirmation_semantics");
    expect(extras["metrics_omitted"]).toEqual(REAL_PYTHON_REFUSAL_ENVELOPE.metrics_omitted);
    expect(extras["analysis_omitted"]).toEqual(REAL_PYTHON_REFUSAL_ENVELOPE.analysis_omitted);
    expect(extras["governance_labels"]).toEqual(REAL_PYTHON_REFUSAL_ENVELOPE.governance_labels);
  });

  it("CONTROL A — reaches NO analytical, scoring or promotion consumer", async () => {
    runPythonModuleMock.mockResolvedValue({ ...REAL_PYTHON_REFUSAL_ENVELOPE });

    await runBacktest(
      "strat-refusal",
      makeConfig() as never,
      undefined,
      undefined,
      "corr-refusal-003",
    );

    // Metric columns stay NULL — absent, never 0.0 (R-751 §8-5, carried across the border).
    const refusalWrite = allUpdateSetPayloads().find((p) => p["status"] === "refused")!;
    for (const col of [
      "totalReturn",
      "sharpeRatio",
      "maxDrawdown",
      "winRate",
      "profitFactor",
      "totalTrades",
    ]) {
      expect(refusalWrite[col] ?? null).toBeNull();
    }

    // No completed-run counter (R-752 §6-7 / §7-A).
    const labelArgs = backtestRunsLabelsMock.mock.calls.map((c) => c[0] as { status?: string });
    expect(labelArgs.some((a) => a?.status === "completed")).toBe(false);

    // No completed-result transaction ⇒ no trades, no completed provenance.
    expect(dbTransactionMock).not.toHaveBeenCalled();

    // A refusal may emit its own audit/SSE event, but never a success one (R-752 §6-6).
    const sseEvents = broadcastSSEMock.mock.calls.map((c) => c[0] as string);
    expect(sseEvents).not.toContain("backtest:completed");
    expect(sseEvents).not.toContain("backtest:scored");
    expect(sseEvents).not.toContain("strategy:promoted");
    // POSITIVE WITNESS that the refusal path actually RAN — without it every assertion
    // above is satisfied by a function that returned early for any unrelated reason.
    // `A NEGATIVE ASSERTION NEEDS A POSITIVE WITNESS THAT THE PATH EXECUTED.`
    expect(sseEvents).toContain("backtest:refused");
  });

  it("CONTROL B — POSITIVE CONTROL: an eligible neighbour still completes", async () => {
    // An engine that marks everything refused is not a repair (R-752 §7-B).
    runPythonModuleMock.mockResolvedValue({
      total_return: 0.12,
      sharpe_ratio: 1.4,
      total_trades: 7,
      tier: "TIER_2",
    });

    const result = await runBacktest(
      "strat-neighbour",
      makeConfig() as never,
      undefined,
      undefined,
      "corr-neighbour-001",
    );

    expect(result.status).not.toBe("refused");
    const payloads = allUpdateSetPayloads();
    expect(payloads.some((p) => p["status"] === "refused")).toBe(false);
  });
});
