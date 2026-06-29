/**
 * carter-reads.test.ts — Behavioral tests for CARTER_READ_HANDLERS.
 *
 * Covers the four handlers with non-trivial logic:
 *   - reportStrategyStatus  (gate-blocking JSONB path + env-override / D-2 fix)
 *   - reportBacktestResult  (correct column extraction)
 *   - reportMontecarloSurvival (riskMetrics JSONB path + survival_rate)
 *   - queryAuditLog         (column filter correctness + limit cap at 50)
 */

// ── Mocks (hoisted — must appear before imports) ──────────────────────────────

vi.mock("../../db/index.js", () => ({ db: {} }));

vi.mock("../../db/schema.js", () => ({
  strategies:             { id: "id", name: "name", symbol: "symbol", lifecycleState: "lifecycleState" },
  backtests:              { id: "id", strategyId: "strategyId", status: "status",
                            gateResult: "gateResult", walkForwardResults: "walkForwardResults",
                            bif: "bif", wrcResult: "wrcResult", spaResult: "spaResult",
                            sharpeRatio: "sharpeRatio", totalReturn: "totalReturn",
                            maxDrawdown: "maxDrawdown", profitFactor: "profitFactor",
                            totalTrades: "totalTrades", forgeScore: "forgeScore",
                            tier: "tier", timeframe: "timeframe", symbol: "symbol",
                            createdAt: "createdAt" },
  monteCarloRuns:         { riskMetrics: "riskMetrics", probabilityOfRuin: "probabilityOfRuin",
                            backtestId: "backtestId", numSimulations: "numSimulations",
                            sharpeP5: "sharpeP5", sharpeP50: "sharpeP50",
                            maxDrawdownP95: "maxDrawdownP95", createdAt: "createdAt" },
  lifecycleTransitions:   { strategyId: "strategyId", fromState: "fromState",
                            toState: "toState", decisionAuthority: "decisionAuthority",
                            reason: "reason", createdAt: "createdAt" },
  paperSessions:          { id: "id", strategyId: "strategyId", status: "status",
                            mode: "mode", firmId: "firmId", startedAt: "startedAt",
                            startingCapital: "startingCapital", currentEquity: "currentEquity",
                            realizedPeakEquity: "realizedPeakEquity",
                            highWaterBalance: "highWaterBalance",
                            totalTrades: "totalTrades", provenTradesCount: "provenTradesCount",
                            dailyPnlBreakdown: "dailyPnlBreakdown" },
  auditLog:               { id: "id", action: "action", status: "status",
                            entityType: "entityType", entityId: "entityId",
                            errorMessage: "errorMessage", correlationId: "correlationId",
                            decisionAuthority: "decisionAuthority", createdAt: "createdAt" },
  strategyPendingBuckets: { id: "id", status: "status", market: "market",
                            fingerprintHash: "fingerprintHash",
                            entryArchetype: "entryArchetype", exitType: "exitType",
                            sourceCount: "sourceCount", distinctProviders: "distinctProviders",
                            firstSeenAt: "firstSeenAt", lastSeenAt: "lastSeenAt",
                            graduatedAt: "graduatedAt", graduatedStrategyId: "graduatedStrategyId",
                            conceptName: "conceptName" },
  strategyPendingMentions:{ id: "id", bucketId: "bucketId", sourceProvider: "sourceProvider" },
}));

vi.mock("drizzle-orm", () => ({
  desc:    vi.fn((x: unknown) => x),
  eq:      vi.fn((_col: unknown, _val: unknown) => "__eq__"),
  and:     vi.fn((...args: unknown[]) => args),
  inArray: vi.fn((_col: unknown, _vals: unknown) => "__inArray__"),
  sql:     vi.fn(),
}));

// ── Service / route mocks ─────────────────────────────────────────────────────

vi.mock("../../routes/backtests.js",          () => ({ getBacktestConcurrencyStats: vi.fn() }));
vi.mock("../../lib/python-runner.js",          () => ({ getPythonSubprocessStats: vi.fn() }));
vi.mock("../../services/paper-trading-stream.js", () => ({
  getActiveStreams: vi.fn(() => new Map()),
}));
vi.mock("../../routes/production-status.js",   () => ({
  buildProductionStatus: vi.fn().mockResolvedValue({}),
  buildDrawdownDistance: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../routes/slumhouse/admin.js",     () => ({
  computeSwitchStates: vi.fn().mockResolvedValue({}),
  getSwitchStates: vi.fn(),
  postSwitch: vi.fn(),
}));
vi.mock("../../routes/composite-health.js",   () => ({
  buildCompositeHealthSummary: vi.fn().mockResolvedValue({}),
  compositeHealthRoutes: { get: vi.fn() },
}));
vi.mock("../../routes/ab-comparison.js",      () => ({
  buildABComparisonData: vi.fn().mockResolvedValue({}),
  abComparisonRoutes: { get: vi.fn() },
}));
vi.mock("../../lib/slumhouse/kitchen-data.js", () => ({
  assembleKitchenData: vi.fn().mockResolvedValue({}),
  assembleTodaysMenu: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../lib/slumhouse/crib-data.js",   () => ({ assembleCribData: vi.fn().mockResolvedValue({}) }));
vi.mock("../../services/pipeline-control-service.js", () => ({
  getMode: vi.fn().mockResolvedValue("ACTIVE"),
  setMode: vi.fn(),
}));
vi.mock("../../lib/audit-log-helper.js",       () => ({
  insertAuditRowSafe: vi.fn(async () => true),
}));
vi.mock("../../lib/logger.js",                 () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Gate getter mocks (D-2 — default values mirror code defaults) ─────────────

vi.mock("../../lib/b14-ci-gate.js", () => ({
  getB14CiHighThreshold: vi.fn(() => 0.20),
}));
vi.mock("../../lib/wfe-gate.js", () => ({
  getWfeHardFloor:  vi.fn(() => 0.70),
  getWfeWarnFloor:  vi.fn(() => 0.50),
}));
vi.mock("../../lib/pbo-gate.js", () => ({
  getPboLifecycleThreshold:     vi.fn(() => 0.15),
  PBO_LIFECYCLE_THRESHOLD_DEFAULT: 0.15,
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { db } from "../../db/index.js";
import { getB14CiHighThreshold } from "../../lib/b14-ci-gate.js";
import { getWfeHardFloor } from "../../lib/wfe-gate.js";
import { getPboLifecycleThreshold } from "../../lib/pbo-gate.js";
import { CARTER_READ_HANDLERS } from "../../lib/carter/carter-reads.js";

// ── DB fluent-chain helpers ───────────────────────────────────────────────────

/**
 * Create a Drizzle-like fluent query chain that resolves with `rows` at the
 * last step (limit / then).
 */
function makeChain(rows: unknown[]): Record<string, (...args: unknown[]) => unknown> {
  const chain: Record<string, (...args: unknown[]) => unknown> = {
    select:  (..._a) => chain,
    from:    (..._a) => chain,
    where:   (..._a) => chain,
    orderBy: (..._a) => chain,
    limit:   (..._a) => Promise.resolve(rows),
  };
  return chain;
}

/**
 * Wire `db.select` to return different row sets per call, in order.
 * If more calls are made than entries in `sequence`, the last entry repeats.
 */
function mockDbSequence(...sequence: unknown[][]): void {
  let callIdx = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).select = vi.fn().mockImplementation((..._args: unknown[]) => {
    const rows = sequence[callIdx] ?? sequence[sequence.length - 1] ?? [];
    callIdx++;
    return makeChain(rows);
  });
}

// ── Fixture data ──────────────────────────────────────────────────────────────

const strategyRow = {
  id: "strat-uuid-1",
  name: "test_strategy",
  symbol: "MES",
  lifecycleState: "PAPER",
};

function makeBacktestRow(wfr: Record<string, unknown>) {
  return {
    id: "bt-uuid-1",
    gateResult: null,
    walkForwardResults: wfr,
    bif: "3.2",
    wrcResult: null,
    spaResult: null,
    status: "completed",
    createdAt: new Date("2026-06-01T00:00:00Z"),
  };
}

function makeMcRow(riskMetrics: Record<string, unknown>) {
  return {
    riskMetrics,
    probabilityOfRuin: "0.15",
  };
}

// ── report_strategy_status ────────────────────────────────────────────────────

describe("reportStrategyStatus handler", () => {
  beforeEach(() => {
    vi.mocked(getB14CiHighThreshold).mockReturnValue(0.20);
    vi.mocked(getWfeHardFloor).mockReturnValue(0.70);
    vi.mocked(getPboLifecycleThreshold).mockReturnValue(0.15);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when neither strategyId nor name is provided", async () => {
    await expect(CARTER_READ_HANDLERS["report_strategy_status"]({})).rejects.toThrow(
      "params.strategyId or params.name is required",
    );
  });

  it("throws strategy_not_found when strategy row is absent", async () => {
    // sequence: strategies → [], (no more calls)
    mockDbSequence([]);
    await expect(
      CARTER_READ_HANDLERS["report_strategy_status"]({ strategyId: "nonexistent" }),
    ).rejects.toThrow("strategy_not_found");
  });

  it("blocks on B14_RUIN_CI when ruin_ci_high > b14Threshold", async () => {
    // B14 threshold = 0.20 (default); ci_high = 0.25 → blocked
    const wfr = { wfe_overall: 0.80, pbo_overall: 0.10 };
    const rm  = { probability_of_ruin_ci: { ci_high: 0.25 }, survival_rate: 0.90 };
    mockDbSequence(
      [strategyRow],                          // strategies lookup
      [makeBacktestRow(wfr)],                 // backtest lookup
      [makeMcRow(rm)],                        // MC run lookup
      [],                                     // lifecycle transitions
    );

    const result = await CARTER_READ_HANDLERS["report_strategy_status"]({ strategyId: "strat-uuid-1" }) as Record<string, unknown>;

    expect(result.blocking_gate).toBe("B14_RUIN_CI");
    expect(result.why).toContain("0.250");
    expect(result.why).toContain("0.200");
    expect(result.why).toContain("PAPER→DEPLOY_READY");
  });

  it("blocks on WFE_HARD_FLOOR when wfe_overall < wfeFloor (and B14 passes)", async () => {
    // B14 threshold = 0.20; ci_high = 0.10 → B14 passes
    // WFE floor = 0.70; wfe_overall = 0.65 → WFE blocked
    const wfr = { wfe_overall: 0.65, pbo_overall: 0.10 };
    const rm  = { probability_of_ruin_ci: { ci_high: 0.10 }, survival_rate: 0.95 };
    mockDbSequence([strategyRow], [makeBacktestRow(wfr)], [makeMcRow(rm)], []);

    const result = await CARTER_READ_HANDLERS["report_strategy_status"]({ strategyId: "strat-uuid-1" }) as Record<string, unknown>;

    expect(result.blocking_gate).toBe("WFE_HARD_FLOOR");
    expect(result.why).toContain("0.650");
    expect(result.why).toContain("0.700");
    expect(result.why).toContain("PAPER→DEPLOY_READY");
  });

  it("blocks on PBO_OVERFIT when pbo_overall > pboThreshold (and B14+WFE pass)", async () => {
    // B14 ci_high = 0.10 → passes; WFE 0.80 → passes; PBO 0.20 > 0.15 → blocked
    const wfr = { wfe_overall: 0.80, pbo_overall: 0.20 };
    const rm  = { probability_of_ruin_ci: { ci_high: 0.10 }, survival_rate: 0.95 };
    mockDbSequence([strategyRow], [makeBacktestRow(wfr)], [makeMcRow(rm)], []);

    const result = await CARTER_READ_HANDLERS["report_strategy_status"]({ strategyId: "strat-uuid-1" }) as Record<string, unknown>;

    expect(result.blocking_gate).toBe("PBO_OVERFIT");
    expect(result.why).toContain("0.200");
    expect(result.why).toContain("0.150");
    expect(result.why).toContain("TESTING→SHADOW/PAPER");
  });

  it("returns blocking_gate = null when all gates pass", async () => {
    const wfr = { wfe_overall: 0.80, pbo_overall: 0.10 };
    const rm  = { probability_of_ruin_ci: { ci_high: 0.10 }, survival_rate: 0.95 };
    mockDbSequence([strategyRow], [makeBacktestRow(wfr)], [makeMcRow(rm)], []);

    const result = await CARTER_READ_HANDLERS["report_strategy_status"]({ strategyId: "strat-uuid-1" }) as Record<string, unknown>;

    expect(result.blocking_gate).toBeNull();
    expect(result.why).toBeNull();
  });

  it("D-2: respects env-overridden B14 threshold — ci_high 0.25 does NOT block when threshold = 0.30", async () => {
    // Override threshold to 0.30 → 0.25 < 0.30 → B14 passes
    vi.mocked(getB14CiHighThreshold).mockReturnValue(0.30);
    // WFE and PBO both clean
    const wfr = { wfe_overall: 0.80, pbo_overall: 0.10 };
    const rm  = { probability_of_ruin_ci: { ci_high: 0.25 }, survival_rate: 0.95 };
    mockDbSequence([strategyRow], [makeBacktestRow(wfr)], [makeMcRow(rm)], []);

    const result = await CARTER_READ_HANDLERS["report_strategy_status"]({ strategyId: "strat-uuid-1" }) as Record<string, unknown>;

    expect(result.blocking_gate).toBeNull();
    expect(result.why).toBeNull();
  });

  it("D-2: respects env-overridden WFE floor — wfe 0.65 does NOT block when floor = 0.60", async () => {
    vi.mocked(getWfeHardFloor).mockReturnValue(0.60);
    const wfr = { wfe_overall: 0.65, pbo_overall: 0.10 };
    const rm  = { probability_of_ruin_ci: { ci_high: 0.10 }, survival_rate: 0.95 };
    mockDbSequence([strategyRow], [makeBacktestRow(wfr)], [makeMcRow(rm)], []);

    const result = await CARTER_READ_HANDLERS["report_strategy_status"]({ strategyId: "strat-uuid-1" }) as Record<string, unknown>;

    expect(result.blocking_gate).toBeNull();
  });

  it("D-2: respects env-overridden PBO threshold — pbo 0.20 does NOT block when threshold = 0.25", async () => {
    vi.mocked(getPboLifecycleThreshold).mockReturnValue(0.25);
    const wfr = { wfe_overall: 0.80, pbo_overall: 0.20 };
    const rm  = { probability_of_ruin_ci: { ci_high: 0.10 }, survival_rate: 0.95 };
    mockDbSequence([strategyRow], [makeBacktestRow(wfr)], [makeMcRow(rm)], []);

    const result = await CARTER_READ_HANDLERS["report_strategy_status"]({ strategyId: "strat-uuid-1" }) as Record<string, unknown>;

    expect(result.blocking_gate).toBeNull();
  });

  it("returns null blocking_gate when no backtest row exists", async () => {
    // No backtest → no gate evidence → blocking_gate null
    mockDbSequence([strategyRow], [], [], []);

    const result = await CARTER_READ_HANDLERS["report_strategy_status"]({ name: "test_strategy" }) as Record<string, unknown>;

    expect(result.blocking_gate).toBeNull();
    expect(result.gate_evidence).toBeNull();
  });

  it("includes id, name, symbol, lifecycle_state in result", async () => {
    const wfr = { wfe_overall: 0.80, pbo_overall: 0.10 };
    const rm  = { probability_of_ruin_ci: { ci_high: 0.10 } };
    mockDbSequence([strategyRow], [makeBacktestRow(wfr)], [makeMcRow(rm)], []);

    const result = await CARTER_READ_HANDLERS["report_strategy_status"]({ strategyId: "strat-uuid-1" }) as Record<string, unknown>;

    expect(result.id).toBe("strat-uuid-1");
    expect(result.name).toBe("test_strategy");
    expect(result.symbol).toBe("MES");
    expect(result.lifecycle_state).toBe("PAPER");
  });
});

// ── reportBacktestResult ──────────────────────────────────────────────────────

describe("reportBacktestResult handler", () => {
  it("throws when backtestId is missing", async () => {
    await expect(CARTER_READ_HANDLERS["report_backtest_result"]({})).rejects.toThrow(
      "params.backtestId is required",
    );
  });

  it("throws backtest_not_found when row absent", async () => {
    mockDbSequence([]);
    await expect(
      CARTER_READ_HANDLERS["report_backtest_result"]({ backtestId: "nope" }),
    ).rejects.toThrow("backtest_not_found");
  });

  it("extracts correct columns from backtest row", async () => {
    const row = {
      id: "bt-uuid-99",
      strategyId: "strat-uuid-1",
      status: "completed",
      symbol: "MNQ",
      timeframe: "15m",
      sharpeRatio: "2.35",
      totalReturn: "0.18",
      maxDrawdown: "0.05",
      profitFactor: "1.75",
      totalTrades: 42,
      forgeScore: "87.5",
      tier: "A",
      bif: "3.1",
      walkForwardResults: { wfe_overall: 0.78, pbo_overall: 0.11 },
      gateResult: { passed: true },
      createdAt: new Date("2026-06-15T12:00:00Z"),
    };
    mockDbSequence([row]);

    const result = await CARTER_READ_HANDLERS["report_backtest_result"]({ backtestId: "bt-uuid-99" }) as Record<string, unknown>;

    expect(result.id).toBe("bt-uuid-99");
    expect(result.strategyId).toBe("strat-uuid-1");
    expect(result.status).toBe("completed");
    expect(result.symbol).toBe("MNQ");
    expect(result.timeframe).toBe("15m");
    expect(result.sharpeRatio).toBe(2.35);
    expect(result.totalReturn).toBe(0.18);
    expect(result.maxDrawdown).toBe(0.05);
    expect(result.profitFactor).toBe(1.75);
    expect(result.totalTrades).toBe(42);
    expect(result.forgeScore).toBe(87.5);
    expect(result.tier).toBe("A");
    expect(result.bif).toBe(3.1);
    expect(result.wfe_overall).toBe(0.78);
    expect(result.pbo_overall).toBe(0.11);
    expect(result.gateResult).toEqual({ passed: true });
    expect(result.createdAt).toBe("2026-06-15T12:00:00.000Z");
  });
});

// ── reportMontecarloSurvival ──────────────────────────────────────────────────

describe("reportMontecarloSurvival handler", () => {
  it("throws when backtestId is missing", async () => {
    await expect(CARTER_READ_HANDLERS["report_montecarlo_survival"]({})).rejects.toThrow(
      "params.backtestId is required",
    );
  });

  it("throws mc_not_found when row absent", async () => {
    mockDbSequence([]);
    await expect(
      CARTER_READ_HANDLERS["report_montecarlo_survival"]({ backtestId: "nope" }),
    ).rejects.toThrow("mc_not_found");
  });

  it("surfaces probability_of_ruin_ci JSONB path and survival_rate", async () => {
    const ciPayload = { ci_low: 0.05, ci_high: 0.18, ci_method: "bca", n_resamples: 5000 };
    const row = {
      probabilityOfRuin: "0.12",
      riskMetrics: {
        probability_of_ruin_ci: ciPayload,
        survival_rate: 0.88,
      },
      numSimulations: 10000,
      sharpeP5: "0.45",
      sharpeP50: "1.20",
      maxDrawdownP95: "0.22",
      createdAt: new Date("2026-06-20T00:00:00Z"),
    };
    mockDbSequence([row]);

    const result = await CARTER_READ_HANDLERS["report_montecarlo_survival"]({ backtestId: "bt-uuid-1" }) as Record<string, unknown>;

    expect(result.probability_of_ruin).toBe(0.12);
    expect(result.probability_of_ruin_ci).toEqual(ciPayload);
    expect(result.survival_rate).toBe(0.88);
    expect(result.num_simulations).toBe(10000);
    expect(result.sharpe_p5).toBe(0.45);
    expect(result.sharpe_p50).toBe(1.20);
    expect(result.max_drawdown_p95).toBe(0.22);
    expect(result.backtest_id).toBe("bt-uuid-1");
  });

  it("surfaces null probability_of_ruin_ci when JSONB key missing", async () => {
    const row = {
      probabilityOfRuin: "0.10",
      riskMetrics: { survival_rate: 0.92 }, // no probability_of_ruin_ci key
      numSimulations: 5000,
      sharpeP5: null,
      sharpeP50: null,
      maxDrawdownP95: null,
      createdAt: new Date(),
    };
    mockDbSequence([row]);

    const result = await CARTER_READ_HANDLERS["report_montecarlo_survival"]({ backtestId: "bt-uuid-2" }) as Record<string, unknown>;

    expect(result.probability_of_ruin_ci).toBeNull();
    expect(result.survival_rate).toBe(0.92);
  });
});

// ── queryAuditLog ─────────────────────────────────────────────────────────────

describe("queryAuditLog handler", () => {
  it("caps limit at 50 even when caller requests 100", async () => {
    const capturedLimitCalls: number[] = [];
    let callIdx = 0;
    const rows: unknown[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).select = vi.fn().mockImplementation(() => {
      callIdx++;
      const chain: Record<string, (...args: unknown[]) => unknown> = {
        from:    (..._a) => chain,
        where:   (..._a) => chain,
        orderBy: (..._a) => chain,
        limit:   (n: unknown) => {
          capturedLimitCalls.push(n as number);
          return Promise.resolve(rows);
        },
      };
      return chain;
    });

    await CARTER_READ_HANDLERS["query_audit_log"]({ limit: 100 });

    expect(capturedLimitCalls[0]).toBe(50);
  });

  it("defaults limit to 20 when none provided", async () => {
    const capturedLimitCalls: number[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).select = vi.fn().mockImplementation(() => {
      const chain: Record<string, (...args: unknown[]) => unknown> = {
        from:    (..._a) => chain,
        where:   (..._a) => chain,
        orderBy: (..._a) => chain,
        limit:   (n: unknown) => {
          capturedLimitCalls.push(n as number);
          return Promise.resolve([]);
        },
      };
      return chain;
    });

    await CARTER_READ_HANDLERS["query_audit_log"]({});

    expect(capturedLimitCalls[0]).toBe(20);
  });

  it("maps returned rows to the expected shape", async () => {
    const auditRow = {
      id: "audit-1",
      action: "test.action",
      status: "success",
      entityType: "strategy",
      entityId:   "strat-1",
      decisionAuthority: "system",
      correlationId: "corr-abc",
      errorMessage: null,
      createdAt: new Date("2026-06-01T09:00:00Z"),
    };
    mockDbSequence([auditRow]);

    const result = await CARTER_READ_HANDLERS["query_audit_log"]({ action: "test.action" }) as unknown[];

    expect(Array.isArray(result)).toBe(true);
    const row = result[0] as Record<string, unknown>;
    expect(row.id).toBe("audit-1");
    expect(row.action).toBe("test.action");
    expect(row.status).toBe("success");
    expect(row.entityType).toBe("strategy");
    expect(row.entityId).toBe("strat-1");
    expect(row.decisionAuthority).toBe("system");
    expect(row.correlationId).toBe("corr-abc");
    expect(row.errorMessage).toBeNull();
    expect(row.createdAt).toBe("2026-06-01T09:00:00.000Z");
  });
});
