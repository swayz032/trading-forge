/**
 * backtest-truthiness-emit.test.ts
 *
 * Verifies that backtest-service correctly:
 *   1. Writes an audit_log row when invariants.overall_passed === false
 *   2. Writes an audit_log row when parity_shadow.passed === false
 *   3. Fires a Discord CRITICAL alert when invariant critical_failures exist
 *   4. Fires a Discord CRITICAL alert when parity pnl_diff_pct > 1.0
 *   5. Does NOT fire Discord when all truthiness checks pass
 *   6. Broadcasts backtest:truthiness_failure SSE on failure
 *   7. Does NOT broadcast truthiness_failure SSE when all pass
 *
 * These tests exercise the fire-and-forget truthiness block in runBacktest
 * by providing a completed backtest result fixture with controlled truthiness fields.
 *
 * Pattern: mock Python runner to return a fixture result with embedded parity_shadow
 * and invariants fields, then assert on audit_log inserts, Discord calls, SSE.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Pipeline control ────────────────────────────────────────────────────────
vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
  getMode: vi.fn().mockResolvedValue("ACTIVE"),
}));

// ─── Metrics registry ────────────────────────────────────────────────────────
vi.mock("../lib/metrics-registry.js", () => ({
  backtestRuns: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  backtestScoredTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  cronJobsConcurrent: { inc: vi.fn(), dec: vi.fn() },
}));

// ─── Tracing ─────────────────────────────────────────────────────────────────
vi.mock("../lib/tracing.js", () => ({
  tracer: {
    startSpan: vi.fn().mockReturnValue({
      setAttribute: vi.fn(),
      end: vi.fn(),
      setStatus: vi.fn(),
    }),
  },
}));

// ─── Circuit breaker ─────────────────────────────────────────────────────────
vi.mock("../lib/circuit-breaker.js", () => ({
  CircuitBreakerRegistry: {
    get: vi.fn().mockReturnValue({
      call: vi.fn((fn: () => unknown) => fn()),
    }),
  },
}));

// ─── DuckDB service ──────────────────────────────────────────────────────────
vi.mock("../../data/loaders/duckdb-service.js", () => ({
  queryInfo: vi.fn().mockResolvedValue({
    earliest: "2015-08-02",
    latest: "2024-12-31",
    totalBars: 100000,
  }),
}));

// ─── Firm config ─────────────────────────────────────────────────────────────
vi.mock("../../shared/firm-config.js", () => ({
  getFirmLimit: vi.fn().mockReturnValue(null),
}));

// ─── Result hasher ───────────────────────────────────────────────────────────
vi.mock("../lib/result-hasher.js", () => ({
  computeResultHash: vi.fn().mockReturnValue("aabbccdd"),
  computeDataHash: vi.fn().mockReturnValue("datahash"),
  computeStrategyHash: vi.fn().mockReturnValue("strhash"),
}));

// ─── Quantum cost tracker ────────────────────────────────────────────────────
vi.mock("../lib/quantum-cost-tracker.js", () => ({
  recordCost: vi.fn().mockResolvedValue({ id: "cost-id" }),
  completeCost: vi.fn().mockResolvedValue(undefined),
}));

// ─── SQA registry ────────────────────────────────────────────────────────────
vi.mock("../lib/sqa-promise-registry.js", () => ({
  sqaRegistry: { register: vi.fn(), markSettled: vi.fn() },
}));

// ─── DLQ service ─────────────────────────────────────────────────────────────
vi.mock("../lib/dlq-service.js", () => ({
  captureToDLQ: vi.fn().mockResolvedValue(undefined),
}));

// ─── Signal correlation service ───────────────────────────────────────────────
vi.mock("../services/signal-correlation-service.js", () => ({
  persistSignalVector: vi.fn().mockResolvedValue(true),
}));

// ─── Synthetic black swan ─────────────────────────────────────────────────────
vi.mock("../services/synthetic-black-swan-service.js", () => ({
  runBlackSwanTest: vi.fn().mockResolvedValue(undefined),
}));

// ─── Monte Carlo + Quantum MC ─────────────────────────────────────────────────
vi.mock("../services/monte-carlo-service.js", () => ({
  runMonteCarlo: vi.fn().mockResolvedValue({ probability_of_ruin: 0.05 }),
}));
vi.mock("../services/quantum-mc-service.js", () => ({
  runQuantumMC: vi.fn().mockResolvedValue(undefined),
}));

// ─── Paper trading stream ─────────────────────────────────────────────────────
vi.mock("../services/paper-trading-stream.js", () => ({
  startStream: vi.fn().mockResolvedValue(undefined),
}));

// ─── WF schema ───────────────────────────────────────────────────────────────
vi.mock("../../shared/walk-forward-schema.js", () => ({
  WFWindowMetricsSchema: { safeParse: vi.fn().mockReturnValue({ success: true }) },
}));

// ─── SSE broadcaster ─────────────────────────────────────────────────────────
const broadcastSSEMock = vi.fn();
vi.mock("../routes/sse.js", () => ({
  broadcastSSE: broadcastSSEMock,
}));

// ─── Notification service (Discord) ──────────────────────────────────────────
const notifyCriticalMock = vi.fn();
vi.mock("../services/notification-service.js", () => ({
  notifyCritical: notifyCriticalMock,
  notifyWarning: vi.fn(),
  notifyInfo: vi.fn(),
}));

// ─── Audit log helper ─────────────────────────────────────────────────────────
const insertAuditRowMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: insertAuditRowMock,
}));

// ─── Python runner ────────────────────────────────────────────────────────────
const runPythonModuleMock = vi.fn();
vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: runPythonModuleMock,
  parseTruthinessSentinel: vi.fn().mockReturnValue(null),
  PARITY_SHADOW_SENTINEL: "PARITY_SHADOW_DRIFT_JSON",
  INVARIANT_FAILURE_SENTINEL: "INVARIANT_FAILURE_JSON",
}));

// ─── DB mock ─────────────────────────────────────────────────────────────────
const BACKTEST_ID = "bt-truthiness-test-0001";
const STRATEGY_ID = "00000000-0000-4000-8000-000000000099";

const txInsertMock = vi.fn().mockReturnValue({
  values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
});
const txUpdateMock = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
});

vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: BACKTEST_ID }]),
        catch: vi.fn().mockResolvedValue(undefined),
      }),
    })),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
        limit: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      const tx = {
        insert: txInsertMock,
        update: txUpdateMock,
      };
      await cb(tx);
    }),
  },
}));

vi.mock("../db/schema.js", () => ({
  backtests: {},
  backtestTrades: {},
  stressTestRuns: {},
  strategies: {},
  auditLog: {},
  walkForwardWindows: {},
  strategyNames: {},
  sqaOptimizationRuns: {},
  quboTimingRuns: {},
  tensorPredictions: {},
  rlTrainingRuns: {},
  paperSessions: {},
  monteCarloRuns: {},
  backtestProvenance: {},
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Import under test (after all mocks) ────────────────────────────────────
// Imported dynamically per-test so mocks are installed before the module loads.

// ─── Fixture builders ─────────────────────────────────────────────────────────

function makeBaseResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    total_return: 5000,
    sharpe_ratio: 1.5,
    max_drawdown: -800,
    win_rate: 0.55,
    profit_factor: 1.7,
    total_trades: 120,
    avg_trade_pnl: 41.67,
    avg_daily_pnl: 25,
    winning_days: 60,
    total_trading_days: 100,
    max_consecutive_losing_days: 3,
    expectancy_per_trade: 41.67,
    avg_winner_to_loser_ratio: 1.5,
    equity_curve: [],
    trades: [],
    daily_pnls: [100, 200, -50, 300],
    execution_time_ms: 1234,
    tier: "TIER_2",
    forge_score: 72,
    ...overrides,
  };
}

const BASE_CONFIG = {
  strategy: {
    name: "ema-crossover-mes",
    symbol: "MES",
    timeframe: "5m",
    indicators: [],
    entry_long: "close > open",
    entry_short: "close < open",
    exit: "close < open",
    stop_loss: { type: "atr", multiplier: 1.5 },
    position_size: { type: "risk_derived_pyramid" },
  },
  start_date: "2022-01-01",
  end_date: "2023-12-31",
};

// Helper: wait for all pending microtasks + macro tasks
async function drainAsync(): Promise<void> {
  // Two rounds: first drains Promise microtasks, second drains setTimeout(0) fire-and-forget IIFEs
  await new Promise<void>((r) => setTimeout(r, 20));
  await new Promise<void>((r) => setTimeout(r, 20));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("backtest truthiness emit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("writes audit_log row when invariants.overall_passed is false", async () => {
    const { runBacktest } = await import("../services/backtest-service.js");

    const resultWithInvariantFailure = makeBaseResult({
      invariants: {
        passed: false,
        failed: ["ending_balance_mismatch"],
        overall_passed: false,
        critical_failures: ["ending_balance_mismatch"],
        warnings: [],
      },
    });

    runPythonModuleMock.mockResolvedValue(resultWithInvariantFailure);

    await runBacktest(STRATEGY_ID, BASE_CONFIG as Parameters<typeof runBacktest>[1], undefined, BACKTEST_ID, "test-corr-id");
    await drainAsync();

    const auditCalls = insertAuditRowMock.mock.calls;
    const truthinessAudit = auditCalls.find(
      (call: unknown[]) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        (call[0] as Record<string, unknown>).action === "backtest.invariants_failed",
    );

    expect(truthinessAudit).toBeDefined();
    const row = truthinessAudit![0] as Record<string, unknown>;
    expect(row.entityId).toBe(BACKTEST_ID);
    expect(row.entityType).toBe("backtest");
    expect(row.status).toBe("failure");

    const result = row.result as Record<string, unknown>;
    expect(result.invariant_report).toBeDefined();
    const invReport = result.invariant_report as Record<string, unknown>;
    expect(invReport.overall_passed).toBe(false);
    expect(Array.isArray(invReport.critical_failures)).toBe(true);
  });

  it("writes audit_log row when parity_shadow.passed is false", async () => {
    const { runBacktest } = await import("../services/backtest-service.js");

    const resultWithParityFailure = makeBaseResult({
      parity_shadow: {
        enabled: true,
        ran: true,
        passed: false,
        vbt_total_pnl: 5000,
        bt_total_pnl: 3000,
        pnl_diff_pct: 0.4,
        tolerance: 0.05,
      },
    });

    runPythonModuleMock.mockResolvedValue(resultWithParityFailure);

    await runBacktest(STRATEGY_ID, BASE_CONFIG as Parameters<typeof runBacktest>[1], undefined, BACKTEST_ID, "test-corr-id-2");
    await drainAsync();

    const auditCalls = insertAuditRowMock.mock.calls;
    const truthinessAudit = auditCalls.find(
      (call: unknown[]) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        (call[0] as Record<string, unknown>).action === "backtest.parity_shadow_drift",
    );

    expect(truthinessAudit).toBeDefined();
    const row = truthinessAudit![0] as Record<string, unknown>;
    expect(row.entityId).toBe(BACKTEST_ID);
    expect(row.status).toBe("failure");

    const result = row.result as Record<string, unknown>;
    expect(result.parity_shadow_report).toBeDefined();
    const parityReport = result.parity_shadow_report as Record<string, unknown>;
    expect(parityReport.passed).toBe(false);
  });

  it("fires Discord CRITICAL when invariant critical_failures exist", async () => {
    const { runBacktest } = await import("../services/backtest-service.js");

    const resultWithCriticalInvariant = makeBaseResult({
      invariants: {
        passed: false,
        failed: ["ending_balance_mismatch"],
        overall_passed: false,
        critical_failures: ["ending_balance_mismatch"],
        warnings: [],
      },
    });

    runPythonModuleMock.mockResolvedValue(resultWithCriticalInvariant);

    await runBacktest(STRATEGY_ID, BASE_CONFIG as Parameters<typeof runBacktest>[1], undefined, BACKTEST_ID, "test-corr-discord-1");
    await drainAsync();

    expect(notifyCriticalMock).toHaveBeenCalledOnce();
    const [title, body] = notifyCriticalMock.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(title).toContain("BACKTEST TRUTHINESS FAILURE");
    expect(body).toContain(BACKTEST_ID);
    expect(body).toContain("invariant");
  });

  it("fires Discord CRITICAL when parity pnl_diff_pct > 1.0 (catastrophic disagreement)", async () => {
    const { runBacktest } = await import("../services/backtest-service.js");

    const resultWithCatastrophicParity = makeBaseResult({
      parity_shadow: {
        enabled: true,
        ran: true,
        passed: false,
        vbt_total_pnl: 56928,
        bt_total_pnl: 48100,
        pnl_diff_pct: 1.84,  // 184% diff — catastrophic
        tolerance: 0.05,
      },
    });

    runPythonModuleMock.mockResolvedValue(resultWithCatastrophicParity);

    await runBacktest(STRATEGY_ID, BASE_CONFIG as Parameters<typeof runBacktest>[1], undefined, BACKTEST_ID, "test-corr-discord-2");
    await drainAsync();

    expect(notifyCriticalMock).toHaveBeenCalledOnce();
    const [title, body] = notifyCriticalMock.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(title).toContain("BACKTEST TRUTHINESS FAILURE");
    expect(body).toContain("parity");
  });

  it("does NOT fire Discord when all truthiness checks pass", async () => {
    const { runBacktest } = await import("../services/backtest-service.js");

    const resultAllPassed = makeBaseResult({
      parity_shadow: {
        enabled: true,
        ran: true,
        passed: true,
        vbt_total_pnl: 5000,
        bt_total_pnl: 5050,
        pnl_diff_pct: 0.01,
        tolerance: 0.05,
      },
      invariants: {
        passed: true,
        failed: [],
        overall_passed: true,
        critical_failures: [],
        warnings: [],
      },
    });

    runPythonModuleMock.mockResolvedValue(resultAllPassed);

    await runBacktest(STRATEGY_ID, BASE_CONFIG as Parameters<typeof runBacktest>[1], undefined, BACKTEST_ID, "test-corr-no-discord");
    await drainAsync();

    expect(notifyCriticalMock).not.toHaveBeenCalled();

    // No truthiness failure audit row should be written
    const auditCalls = insertAuditRowMock.mock.calls;
    const truthinessFailAudit = auditCalls.find(
      (call: unknown[]) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        (
          (call[0] as Record<string, unknown>).action === "backtest.invariants_failed" ||
          (call[0] as Record<string, unknown>).action === "backtest.parity_shadow_drift"
        ),
    );
    expect(truthinessFailAudit).toBeUndefined();
  });

  it("broadcasts backtest:truthiness_failure SSE on invariant failure", async () => {
    const { runBacktest } = await import("../services/backtest-service.js");

    const resultWithInvariant = makeBaseResult({
      invariants: {
        passed: false,
        failed: ["total_return_drift"],
        overall_passed: false,
        critical_failures: [],
        warnings: ["total_return_drift"],
      },
    });

    runPythonModuleMock.mockResolvedValue(resultWithInvariant);

    await runBacktest(STRATEGY_ID, BASE_CONFIG as Parameters<typeof runBacktest>[1], undefined, BACKTEST_ID, "test-corr-sse");
    await drainAsync();

    const sseWarningCall = broadcastSSEMock.mock.calls.find(
      (call: unknown[]) => call[0] === "backtest:truthiness_failure",
    );
    expect(sseWarningCall).toBeDefined();
    const sseData = sseWarningCall![1] as Record<string, unknown>;
    expect(sseData.backtestId).toBe(BACKTEST_ID);
    expect(sseData.strategyId).toBe(STRATEGY_ID);
    expect(sseData.type).toBe("invariant");
    expect(sseData.invariant_report).toBeDefined();
  });

  it("does NOT broadcast backtest:truthiness_failure SSE when all checks pass", async () => {
    const { runBacktest } = await import("../services/backtest-service.js");

    const resultAllPassed = makeBaseResult({
      parity_shadow: {
        enabled: true,
        ran: true,
        passed: true,
        pnl_diff_pct: 0.005,
        tolerance: 0.05,
      },
      invariants: {
        passed: true,
        failed: [],
        overall_passed: true,
        critical_failures: [],
        warnings: [],
      },
    });

    runPythonModuleMock.mockResolvedValue(resultAllPassed);

    await runBacktest(STRATEGY_ID, BASE_CONFIG as Parameters<typeof runBacktest>[1], undefined, BACKTEST_ID, "test-corr-sse-no");
    await drainAsync();

    const sseFailCall = broadcastSSEMock.mock.calls.find(
      (call: unknown[]) => call[0] === "backtest:truthiness_failure",
    );
    expect(sseFailCall).toBeUndefined();
  });

  it("alerts on parity skip when reason is not strategy_archetype_not_supported", async () => {
    const { runBacktest } = await import("../services/backtest-service.js");

    const resultWithUnexpectedSkip = makeBaseResult({
      parity_shadow: {
        enabled: true,
        ran: false,
        passed: false,
        reason: "engine_crash",
      },
    });

    runPythonModuleMock.mockResolvedValue(resultWithUnexpectedSkip);

    await runBacktest(STRATEGY_ID, BASE_CONFIG as Parameters<typeof runBacktest>[1], undefined, BACKTEST_ID, "test-corr-skip");
    await drainAsync();

    const auditCalls = insertAuditRowMock.mock.calls;
    const truthinessAudit = auditCalls.find(
      (call: unknown[]) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        (call[0] as Record<string, unknown>).action === "backtest.parity_shadow_drift",
    );
    expect(truthinessAudit).toBeDefined();
  });

  it("does NOT alert when parity skip reason is strategy_archetype_not_supported", async () => {
    const { runBacktest } = await import("../services/backtest-service.js");

    const resultWithExpectedSkip = makeBaseResult({
      parity_shadow: {
        enabled: true,
        ran: false,
        passed: false,
        reason: "strategy_archetype_not_supported",
      },
    });

    runPythonModuleMock.mockResolvedValue(resultWithExpectedSkip);

    await runBacktest(STRATEGY_ID, BASE_CONFIG as Parameters<typeof runBacktest>[1], undefined, BACKTEST_ID, "test-corr-expected-skip");
    await drainAsync();

    // parity ran=false with expected reason → no alert, no audit
    expect(notifyCriticalMock).not.toHaveBeenCalled();

    const auditCalls = insertAuditRowMock.mock.calls;
    const truthinessFailAudit = auditCalls.find(
      (call: unknown[]) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        (
          (call[0] as Record<string, unknown>).action === "backtest.invariants_failed" ||
          (call[0] as Record<string, unknown>).action === "backtest.parity_shadow_drift"
        ),
    );
    expect(truthinessFailAudit).toBeUndefined();
  });
});

// parseTruthinessSentinel unit tests live in parse-truthiness-sentinel.test.ts
// to avoid the module-level vi.mock("../lib/python-runner.js") intercepting the
// real function. See src/server/__tests__/parse-truthiness-sentinel.test.ts.
