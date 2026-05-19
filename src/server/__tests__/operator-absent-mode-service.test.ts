/**
 * Tests for operator-absent-mode-service.ts (Track 7)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks (factories must not reference outer variables — Vitest hoisting) ───

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../db/schema.js", () => ({
  strategies: { _tableName: "strategies", lifecycleState: "lifecycle_state", rollingSharpe30d: "rolling_sharpe_30d" },
  backtests: { _tableName: "backtests", strategyId: "strategy_id", status: "status" },
  auditLog: { _tableName: "audit_log" },
  frankensteinTestRuns: { _tableName: "frankenstein_test_runs" },
  strategySignalVectors: { _tableName: "strategy_signal_vectors" },
  systemState: { _tableName: "system_state" },
}));

vi.mock("../services/alert-service.js", () => ({
  AlertFactory: {
    notifyOperatorAbsentTier1Promotion: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
}));

vi.mock("../services/lifecycle-service.js", () => ({
  LifecycleService: class {
    promoteStrategy = vi.fn().mockResolvedValue({ success: true });
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { db } from "../db/index.js";
import { isActive as isPipelineActive } from "../services/pipeline-control-service.js";
import { AlertFactory } from "../services/alert-service.js";
import { broadcastSSE } from "../routes/sse.js";
import {
  operatorAbsentModeActive,
  checkAutopilotGates,
  runOperatorAbsentAutoPromote,
} from "../services/operator-absent-mode-service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStrategy(overrides = {}) {
  return {
    id: "strategy-id-001",
    name: "TestTier1Strategy",
    rollingSharpe30d: "2.5",
    lifecycleState: "DEPLOY_READY",
    ...overrides,
  };
}

function makeBacktest(overrides = {}) {
  return {
    id: "backtest-id-001",
    tier: "TIER_1",
    sharpeRatio: "2.5",
    status: "completed",
    ...overrides,
  };
}

function mockSelectChain(returnValue: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(returnValue),
        }),
        limit: vi.fn().mockResolvedValue(returnValue),
      }),
      limit: vi.fn().mockResolvedValue(returnValue),
    }),
  };
}

function setupGreenPath() {
  const dbMock = db as typeof db & { select: ReturnType<typeof vi.fn> };

  let callCount = 0;
  dbMock.select.mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      // system_state check (operatorAbsentModeActive)
      return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ operatorAbsentSince: null }]) }) }) };
    }
    if (callCount === 2) {
      // strategies DEPLOY_READY
      return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([makeStrategy()]) }) };
    }
    if (callCount === 3) {
      // latest backtest
      return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([makeBacktest()]) }) }) }) };
    }
    if (callCount === 4) {
      // frankenstein
      return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ passed: true, status: "completed" }]) }) }) }) };
    }
    if (callCount === 5) {
      // signal vector
      return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ id: "vec-001" }]) }) }) };
    }
    return mockSelectChain([]);
  });

  const insertMock = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
  (db as typeof db & { insert: ReturnType<typeof vi.fn> }).insert = insertMock;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("operatorAbsentModeActive", () => {
  afterEach(() => {
    delete process.env["OPERATOR_ABSENT_AUTOPROMOTE"];
    vi.clearAllMocks();
  });

  it("returns true when env var is set to 'true'", async () => {
    process.env["OPERATOR_ABSENT_AUTOPROMOTE"] = "true";
    const result = await operatorAbsentModeActive();
    expect(result).toBe(true);
  });

  it("returns false when env var is not set and DB has null", async () => {
    delete process.env["OPERATOR_ABSENT_AUTOPROMOTE"];
    (db as typeof db & { select: ReturnType<typeof vi.fn> }).select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ operatorAbsentSince: null }]) }),
      }),
    });
    const result = await operatorAbsentModeActive();
    expect(result).toBe(false);
  });

  it("returns true when system_state.operator_absent_since is set", async () => {
    delete process.env["OPERATOR_ABSENT_AUTOPROMOTE"];
    (db as typeof db & { select: ReturnType<typeof vi.fn> }).select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ operatorAbsentSince: new Date() }]) }),
      }),
    });
    const result = await operatorAbsentModeActive();
    expect(result).toBe(true);
  });
});

describe("checkAutopilotGates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupGates(backtest: unknown, frank: unknown, sigVec: unknown[]) {
    const dbMock = db as typeof db & { select: ReturnType<typeof vi.fn> };
    let callCount = 0;
    dbMock.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(backtest ? [backtest] : []) }) }) }) };
      }
      if (callCount === 2) {
        return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(frank ? [frank] : []) }) }) }) };
      }
      // signal vector
      return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(sigVec) }) }) };
    });
  }

  it("passes when Tier 1 + Sharpe >= 2.0 + Frankenstein passed + signal vector exists", async () => {
    setupGates(makeBacktest(), { passed: true, status: "completed" }, [{ id: "vec-001" }]);
    const result = await checkAutopilotGates("strategy-001");
    expect(result.passed).toBe(true);
  });

  it("fails when no backtest exists", async () => {
    setupGates(null, null, []);
    const result = await checkAutopilotGates("strategy-001");
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("no_completed_backtest");
  });

  it("fails when tier is TIER_2", async () => {
    setupGates(makeBacktest({ tier: "TIER_2" }), null, []);
    const result = await checkAutopilotGates("strategy-001");
    expect(result.passed).toBe(false);
    expect(result.reasons[0]).toMatch(/not_tier1/);
  });

  it("fails when Sharpe is below 2.0", async () => {
    setupGates(makeBacktest({ sharpeRatio: "1.8" }), null, []);
    const result = await checkAutopilotGates("strategy-001");
    expect(result.passed).toBe(false);
    expect(result.reasons[0]).toMatch(/sharpe_below_floor/);
  });

  it("fails when Frankenstein run is missing", async () => {
    setupGates(makeBacktest(), null, []);
    const result = await checkAutopilotGates("strategy-001");
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("frankenstein_run_missing");
  });

  it("fails when Frankenstein gate did not pass", async () => {
    setupGates(makeBacktest(), { passed: false, status: "completed" }, []);
    const result = await checkAutopilotGates("strategy-001");
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("frankenstein_gate_failed");
  });

  it("fails when A7 signal vector is missing", async () => {
    setupGates(makeBacktest(), { passed: true, status: "completed" }, []);
    const result = await checkAutopilotGates("strategy-001");
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("a7_signal_vector_missing");
  });

  it("fails closed on DB error", async () => {
    (db as typeof db & { select: ReturnType<typeof vi.fn> }).select.mockImplementation(() => {
      throw new Error("DB error");
    });
    const result = await checkAutopilotGates("strategy-001");
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("gate_check_error");
  });
});

describe("runOperatorAbsentAutoPromote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["OPERATOR_ABSENT_AUTOPROMOTE"] = "true";
    (isPipelineActive as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  afterEach(() => {
    delete process.env["OPERATOR_ABSENT_AUTOPROMOTE"];
  });

  it("does not promote when mode is inactive (env unset)", async () => {
    delete process.env["OPERATOR_ABSENT_AUTOPROMOTE"];
    (db as typeof db & { select: ReturnType<typeof vi.fn> }).select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ operatorAbsentSince: null }]) }),
      }),
    });
    const result = await runOperatorAbsentAutoPromote();
    expect(result.promoted).toHaveLength(0);
  });

  it("skips when pipeline is paused", async () => {
    (isPipelineActive as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const result = await runOperatorAbsentAutoPromote();
    expect(result.promoted).toHaveLength(0);
  });

  it("skips strategy when Sharpe is below 2.0", async () => {
    process.env["OPERATOR_ABSENT_AUTOPROMOTE"] = "true";
    (db as typeof db & { select: ReturnType<typeof vi.fn> }).select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([makeStrategy({ rollingSharpe30d: "1.7" })]),
      }),
    });
    const result = await runOperatorAbsentAutoPromote();
    expect(result.skipped).toHaveLength(1);
    expect(result.promoted).toHaveLength(0);
  });

  it("returns empty promoted list when no DEPLOY_READY strategies exist", async () => {
    (db as typeof db & { select: ReturnType<typeof vi.fn> }).select.mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    });
    const result = await runOperatorAbsentAutoPromote();
    expect(result.promoted).toHaveLength(0);
  });
});
