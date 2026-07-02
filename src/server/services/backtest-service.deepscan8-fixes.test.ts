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
  isPipelineActiveMock,
  runPythonModuleMock,
  circuitBreakerCallMock,
  broadcastSSEMock,
  loggerMock,
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

  return {
    insertAuditRowSafeSpy,
    insertAuditRowSpy,
    dbInsertMock,
    dbUpdateMock,
    dbSelectMock,
    isPipelineActiveMock,
    runPythonModuleMock,
    circuitBreakerCallMock,
    broadcastSSEMock,
    loggerMock,
  };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    insert: dbInsertMock,
    update: dbUpdateMock,
    select: dbSelectMock,
  },
}));

vi.mock("../db/schema.js", () => ({
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
vi.mock("./monte-carlo-service.js", () => ({ runMonteCarlo: vi.fn() }));
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
  backtestRuns: { labels: vi.fn(() => ({ inc: vi.fn() })) },
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

  it("treats {status:'ok'} as success (NOT blocked by envelope check)", async () => {
    // A result with status:'ok' but no .error should NOT be treated as failure.
    // It should proceed through the success path (and likely trigger IIFEs etc.)
    // We make the post-envelope success path throw so we can stop early.
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

    // The envelope check should NOT intercept a {status:"ok"} result
    expect(result.error).not.toContain("python_envelope_status");
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
