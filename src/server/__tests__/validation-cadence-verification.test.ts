/**
 * C7 — Validation Cadence END-TO-END Verification (W16 Team C)
 *
 * Mirrors the plan's verification scenario verbatim:
 *
 *   "Stop running backtests for 8 days; assert dashboard panel turns RED with
 *    '8 days since last live backtest' alert. Run strategy through full
 *    pipeline; assert counter resets and Reality Check report generates."
 *
 * This is the contract test for the forcing function. It validates that:
 *
 *   1. With 8 days idle, the dashboard payload returns isRed=true and the
 *      cadence label reads "8 days" (not 7, not "stale", not null).
 *   2. After a fresh backtest insert (the "run strategy through full pipeline"
 *      reset), the dashboard payload immediately reports isRed=false.
 *   3. The Reality Check report can be generated and persists an audit_log row.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (match the service test pattern) ──────────────────────────────────

const dbState = {
  // Routed mode keyed by table identity — see service test for details
  routedSelect: null as Map<any, any[]> | null,
  routedSelectDistinct: null as Map<any, any[]> | null,
  insertedRows: [] as any[],
};

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => {
      const chain: any = {
        from: vi.fn((table: any) => {
          const result = dbState.routedSelect?.get(table) ?? [];
          const tail: any = {
            from: vi.fn(() => tail),
            where: vi.fn(() => tail),
            orderBy: vi.fn(() => tail),
            limit: vi.fn(() => tail),
            then: (resolve: (v: any) => void) => Promise.resolve(result).then(resolve),
          };
          return tail;
        }),
      };
      return chain;
    }),
    selectDistinct: vi.fn(() => {
      const chain: any = {
        from: vi.fn((table: any) => {
          const result = dbState.routedSelectDistinct?.get(table) ?? [];
          const tail: any = {
            from: vi.fn(() => tail),
            where: vi.fn(() => tail),
            orderBy: vi.fn(() => tail),
            limit: vi.fn(() => tail),
            then: (resolve: (v: any) => void) => Promise.resolve(result).then(resolve),
          };
          return tail;
        }),
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: vi.fn((row: any) => {
        dbState.insertedRows.push(row);
        return Promise.resolve();
      }),
    })),
  },
}));

vi.mock("../services/alert-service.js", () => ({
  createAlert: vi.fn().mockResolvedValue({ id: "alert-uuid-1" }),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

beforeEach(() => {
  dbState.routedSelect = null;
  dbState.routedSelectDistinct = null;
  dbState.insertedRows = [];
  vi.clearAllMocks();
});

async function setupBacktestAge(daysIdle: number | "never") {
  const schema = await import("../db/schema.js");
  const selMap = new Map<any, any[]>();
  const selDistinctMap = new Map<any, any[]>();

  if (daysIdle === "never") {
    selMap.set(schema.backtests, []);
  } else {
    const ts = new Date(Date.now() - daysIdle * 24 * 60 * 60 * 1000);
    selMap.set(schema.backtests, [{ id: `bt-${daysIdle}d`, createdAt: ts }]);
  }
  selMap.set(schema.paperSessions, []);
  selMap.set(schema.paperTrades, []);
  selMap.set(schema.strategies, []);

  selDistinctMap.set(schema.lifecycleTransitions, []);

  dbState.routedSelect = selMap;
  dbState.routedSelectDistinct = selDistinctMap;
}

// ─── Verification Scenario 1: 8 days idle → RED ─────────────────────────────

describe("C7 verification — 8 days idle triggers RED panel", () => {
  it('dashboard returns isRed=true with "8 days since last live backtest" payload', async () => {
    await setupBacktestAge(8);
    const { getValidationCadenceDashboard } = await import(
      "../services/validation-cadence-service.js"
    );
    const dashboard = await getValidationCadenceDashboard();

    // Plan-mandated assertions
    expect(dashboard.daysSinceLastLiveBacktest.isRed).toBe(true);
    expect(dashboard.daysSinceLastLiveBacktest.days).toBe(8);
    expect(dashboard.daysSinceLastLiveBacktest.thresholdDays).toBe(7);

    // Payload composition: throughput is also RED in this scenario (0 strategies)
    expect(dashboard.strategiesThisMonth.isBelowThreshold).toBe(true);
  });

  it("Reality Check report fires CRITICAL alert at 8 days idle", async () => {
    await setupBacktestAge(8);
    const { runMonthlyRealityCheckReport } = await import(
      "../services/validation-cadence-service.js"
    );
    const { createAlert } = await import("../services/alert-service.js");
    const report = await runMonthlyRealityCheckReport();

    expect(report.severity).toBe("critical");
    expect(report.daysSinceLastLiveBacktest.isRed).toBe(true);
    expect(createAlert).toHaveBeenCalledTimes(1);

    const alertCall = vi.mocked(createAlert).mock.calls[0][0];
    expect(alertCall.severity).toBe("critical");
    expect(alertCall.title).toContain("8 days since last backtest");
  });
});

// ─── Verification Scenario 2: Pipeline reset → counter resets ───────────────

describe("C7 verification — fresh backtest resets the counter", () => {
  it("dashboard returns isRed=false after a fresh backtest within threshold", async () => {
    // Simulate "Run strategy through full pipeline" → fresh backtest at 1 day idle
    await setupBacktestAge(1);
    const { getValidationCadenceDashboard } = await import(
      "../services/validation-cadence-service.js"
    );
    const dashboard = await getValidationCadenceDashboard();

    expect(dashboard.daysSinceLastLiveBacktest.isRed).toBe(false);
    expect(dashboard.daysSinceLastLiveBacktest.days).toBe(1);
    expect(dashboard.daysSinceLastLiveBacktest.lastBacktestId).toBe("bt-1d");
  });

  it("Reality Check report still generates and persists audit_log on reset", async () => {
    await setupBacktestAge(1);

    // Simulate pipeline traversal: 1 strategy reached PAPER this month
    const schema = await import("../db/schema.js");
    dbState.routedSelectDistinct!.set(schema.lifecycleTransitions, [{ strategyId: "s-promoted-1" }]);

    const { runMonthlyRealityCheckReport } = await import(
      "../services/validation-cadence-service.js"
    );
    const { createAlert } = await import("../services/alert-service.js");
    const report = await runMonthlyRealityCheckReport();

    // Severity should be info — both forcing-function metrics are within threshold
    expect(report.severity).toBe("info");
    expect(createAlert).not.toHaveBeenCalled();

    // Audit log MUST always persist regardless of severity (replayability)
    expect(dbState.insertedRows.length).toBe(1);
    expect(dbState.insertedRows[0].action).toBe("validation_cadence.reality_check");

    // Counter is reset: throughput score > 0
    expect(report.realityCheck.breakdown.throughputScore).toBeGreaterThan(0);
  });

  it("dashboard transitions from RED→OK when backtest count resets within same test run", async () => {
    // Step 1: 8 days idle → RED
    await setupBacktestAge(8);
    const { getValidationCadenceDashboard } = await import(
      "../services/validation-cadence-service.js"
    );
    const before = await getValidationCadenceDashboard();
    expect(before.daysSinceLastLiveBacktest.isRed).toBe(true);

    // Step 2: simulate pipeline rerun → fresh backtest now 1 day old
    await setupBacktestAge(1);
    const after = await getValidationCadenceDashboard();
    expect(after.daysSinceLastLiveBacktest.isRed).toBe(false);
    expect(after.daysSinceLastLiveBacktest.days).toBe(1);
  });
});
