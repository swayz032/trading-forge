/**
 * Synthetic Black Swan Service Tests — A14 (W19, Pass 3)
 *
 * Mirrors the frankenstein-service test pattern (pending-row contract,
 * pipeline pause guard, completed/failed lifecycle).
 *
 * Pass 3 contract under test:
 *   1. Pending row inserted BEFORE Python spawn.
 *   2. On Python success → row updated to status="completed" with all fields populated.
 *   3. On Python rejection → row updated to status="failed" with errorMessage.
 *   4. Pipeline paused → returns { skipped: true, reason: "pipeline_paused" }
 *      and writes NO DB row.
 *   5. getLatestBlackSwanRun returns most recent completed run (or null).
 *   6. Idempotency safety: two calls for same backtestId → two distinct rows
 *      (no upsert).
 *
 * No advisory write in this pass — Pass 4 owns lifecycle-service.ts integration.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock state ───────────────────────────────────────────────────────
// vi.mock factories run at hoisted-time, BEFORE any module-scope const can
// initialize. We use vi.hoisted() to publish shared state alongside the
// factories so the test bodies and the mocks reference the same vars.

const mockState = vi.hoisted(() => {
  const insertCalls: Array<Record<string, unknown>> = [];
  const updateCalls: Array<{ where: unknown; set: Record<string, unknown> }> =
    [];
  const rowStore = new Map<string, Record<string, unknown>>();
  const selectResultRows: { current: Array<Record<string, unknown>> } = {
    current: [],
  };
  return { insertCalls, updateCalls, rowStore, selectResultRows };
});

const dbMocks = vi.hoisted(() => {
  const insertReturning = vi.fn();
  const insertValues = vi.fn();
  const insertMock = vi.fn();
  const updateWhere = vi.fn();
  const updateSet = vi.fn();
  const updateMock = vi.fn();
  const selectLimit = vi.fn();
  const selectOrderBy = vi.fn();
  const selectWhere = vi.fn();
  const selectFrom = vi.fn();
  const selectMock = vi.fn();
  return {
    insertReturning,
    insertValues,
    insertMock,
    updateWhere,
    updateSet,
    updateMock,
    selectLimit,
    selectOrderBy,
    selectWhere,
    selectFrom,
    selectMock,
  };
});

// Wire mock implementations now that hoisted refs are in scope.
dbMocks.insertReturning.mockImplementation(async () => {
  const id = `row-${mockState.insertCalls.length}`;
  const last =
    mockState.insertCalls[mockState.insertCalls.length - 1] ?? {};
  const row = { id, ...last };
  mockState.rowStore.set(id, row);
  return [row];
});
dbMocks.insertValues.mockImplementation((vals: Record<string, unknown>) => {
  mockState.insertCalls.push(vals);
  return { returning: dbMocks.insertReturning };
});
dbMocks.insertMock.mockImplementation(() => ({
  values: dbMocks.insertValues,
}));
dbMocks.updateWhere.mockImplementation(async () => undefined);
dbMocks.updateSet.mockImplementation((vals: Record<string, unknown>) => {
  mockState.updateCalls.push({ set: vals, where: null });
  return { where: dbMocks.updateWhere };
});
dbMocks.updateMock.mockImplementation(() => ({ set: dbMocks.updateSet }));
dbMocks.selectLimit.mockImplementation(
  async () => mockState.selectResultRows.current,
);
dbMocks.selectOrderBy.mockImplementation(() => ({
  limit: dbMocks.selectLimit,
}));
dbMocks.selectWhere.mockImplementation(() => ({
  orderBy: dbMocks.selectOrderBy,
  limit: dbMocks.selectLimit,
}));
dbMocks.selectFrom.mockImplementation(() => ({ where: dbMocks.selectWhere }));
dbMocks.selectMock.mockImplementation(() => ({ from: dbMocks.selectFrom }));

vi.mock("../db/index.js", () => ({
  db: {
    insert: dbMocks.insertMock,
    update: dbMocks.updateMock,
    select: dbMocks.selectMock,
  },
}));

// Pipeline control mock
const pipelineMock = vi.hoisted(() => ({ isActive: vi.fn() }));
pipelineMock.isActive.mockResolvedValue(true);
vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: pipelineMock.isActive,
}));

// Python runner mock
const pythonMock = vi.hoisted(() => ({ runPythonModule: vi.fn() }));
vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: pythonMock.runPythonModule,
}));

const isActiveMock = pipelineMock.isActive;
const runPythonModuleMock = pythonMock.runPythonModule;
const insertCalls = mockState.insertCalls;
const updateCalls = mockState.updateCalls;

// Logger mock
vi.mock("../index.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("../lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── Import under test ───────────────────────────────────────────────────────

import {
  runBlackSwanTest,
  getLatestBlackSwanRun,
} from "../services/synthetic-black-swan-service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_PYTHON_RESULT = {
  num_regimes_tested: 1000,
  num_regimes_survived: 743,
  survival_rate: 0.743,
  worst_regime: { id: "regime-uuid-1", drawdown: 3812.0, label: "rate_shock" },
  worst_k: [
    { id: "regime-uuid-1", drawdown: 3812.0, label: "rate_shock" },
    { id: "regime-uuid-2", drawdown: 3105.5, label: "crash" },
  ],
  generator_model_version: "v1.0-2026-05-04",
};

function resetMocks(): void {
  insertCalls.length = 0;
  updateCalls.length = 0;
  mockState.rowStore.clear();
  mockState.selectResultRows.current = [];
  isActiveMock.mockReset().mockResolvedValue(true);
  runPythonModuleMock.mockReset();
  dbMocks.insertMock.mockClear();
  dbMocks.insertValues.mockClear();
  dbMocks.insertReturning.mockClear();
  dbMocks.updateMock.mockClear();
  dbMocks.updateSet.mockClear();
  dbMocks.updateWhere.mockClear();
  dbMocks.selectMock.mockClear();
  dbMocks.selectFrom.mockClear();
  dbMocks.selectWhere.mockClear();
  dbMocks.selectOrderBy.mockClear();
  dbMocks.selectLimit.mockClear();
}

// ─── Pending → completed (success path) ──────────────────────────────────────

describe("runBlackSwanTest — pending → completed", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("inserts a pending row BEFORE invoking Python", async () => {
    let pythonInvoked = false;
    runPythonModuleMock.mockImplementation(async () => {
      // Verify the pending insert happened FIRST.
      expect(insertCalls.length).toBe(1);
      expect(insertCalls[0]).toMatchObject({ status: "pending" });
      pythonInvoked = true;
      return VALID_PYTHON_RESULT;
    });

    const result = await runBlackSwanTest("backtest-1", "strategy-1");
    expect(pythonInvoked).toBe(true);
    expect(result.status).toBe("completed");
  });

  it("updates the pending row to completed with all fields populated", async () => {
    runPythonModuleMock.mockResolvedValue(VALID_PYTHON_RESULT);

    const result = await runBlackSwanTest("backtest-1", "strategy-1");

    // Confirm one insert (pending) and one update (completed).
    expect(insertCalls.length).toBe(1);
    expect(updateCalls.length).toBe(1);

    const updateSetVals = updateCalls[0].set;
    expect(updateSetVals).toMatchObject({
      status: "completed",
      numRegimesTested: 1000,
      numRegimesSurvived: 743,
      worstRegimeLabel: "rate_shock",
      generatorModelVersion: "v1.0-2026-05-04",
      errorMessage: null,
    });
    // survivalRate persisted as numeric (string-encoded)
    expect(String(updateSetVals.survivalRate)).toBe("0.743");
    // resultSummary holds the worst_k diagnostic detail
    expect(Array.isArray(updateSetVals.resultSummary)).toBe(true);

    // Public return shape
    expect(result).toMatchObject({
      backtestId: "backtest-1",
      strategyId: "strategy-1",
      status: "completed",
      numRegimesTested: 1000,
      numRegimesSurvived: 743,
      survivalRate: 0.743,
      worstRegimeLabel: "rate_shock",
      generatorModelVersion: "v1.0-2026-05-04",
    });
    expect(result.runId).toBeTruthy();
  });

  it("invokes runPythonModule with the correct module name and config", async () => {
    runPythonModuleMock.mockResolvedValue(VALID_PYTHON_RESULT);
    await runBlackSwanTest("backtest-A", "strategy-B", { regimeCount: 500 });

    expect(runPythonModuleMock).toHaveBeenCalledTimes(1);
    const opts = runPythonModuleMock.mock.calls[0][0] as {
      module: string;
      config: Record<string, unknown>;
    };
    expect(opts.module).toBe("src.engine.black_swan_evaluator");
    expect(opts.config).toMatchObject({
      strategy_id: "strategy-B",
      backtest_id: "backtest-A",
      regime_count: 500,
    });
  });
});

// ─── Pending → failed (error path) ───────────────────────────────────────────

describe("runBlackSwanTest — pending → failed", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("updates the pending row to failed when Python rejects", async () => {
    runPythonModuleMock.mockRejectedValue(
      new Error("black_swan_evaluator: subprocess crash"),
    );

    const result = await runBlackSwanTest("backtest-2", "strategy-2");

    expect(insertCalls.length).toBe(1);
    expect(updateCalls.length).toBe(1);

    const setVals = updateCalls[0].set;
    expect(setVals).toMatchObject({ status: "failed" });
    expect(String(setVals.errorMessage)).toContain("subprocess crash");

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("subprocess crash");
    expect(result.numRegimesTested).toBeNull();
    expect(result.survivalRate).toBeNull();
  });

  it("does NOT throw — failure surfaces in the return value", async () => {
    runPythonModuleMock.mockRejectedValue(new Error("explode"));
    await expect(
      runBlackSwanTest("backtest-2", "strategy-2"),
    ).resolves.toMatchObject({ status: "failed" });
  });
});

// ─── Pipeline paused ─────────────────────────────────────────────────────────

describe("runBlackSwanTest — pipeline paused", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("returns skipped without writing a DB row when pipeline is paused", async () => {
    isActiveMock.mockResolvedValue(false);

    const result = await runBlackSwanTest("backtest-3", "strategy-3");

    expect(result).toMatchObject({
      skipped: true,
      reason: "pipeline_paused",
    });
    // No DB writes
    expect(insertCalls.length).toBe(0);
    expect(updateCalls.length).toBe(0);
    // No Python spawn
    expect(runPythonModuleMock).not.toHaveBeenCalled();
  });
});

// ─── getLatestBlackSwanRun ───────────────────────────────────────────────────

describe("getLatestBlackSwanRun", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("returns null when no completed run exists", async () => {
    mockState.selectResultRows.current = [];
    const result = await getLatestBlackSwanRun("backtest-none");
    expect(result).toBeNull();
  });

  it("returns the most recent completed run mapped to the public shape", async () => {
    mockState.selectResultRows.current = [
      {
        id: "row-9",
        strategyId: "s-9",
        backtestId: "backtest-9",
        status: "completed",
        numRegimesTested: 1000,
        numRegimesSurvived: 800,
        survivalRate: "0.8000",
        worstRegimeId: "regime-w",
        worstRegimeDrawdown: "1900",
        worstRegimeLabel: "crash",
        resultSummary: [{ id: "regime-w", drawdown: 1900, label: "crash" }],
        errorMessage: null,
        executionTimeMs: 12345,
        generatorModelVersion: "v1.0-test",
        createdAt: new Date("2026-05-01T00:00:00Z"),
        resolvedAt: new Date("2026-05-01T00:01:00Z"),
      },
    ];

    const result = await getLatestBlackSwanRun("backtest-9");
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      runId: "row-9",
      backtestId: "backtest-9",
      strategyId: "s-9",
      status: "completed",
      numRegimesTested: 1000,
      numRegimesSurvived: 800,
      survivalRate: 0.8,
      worstRegimeLabel: "crash",
      generatorModelVersion: "v1.0-test",
    });
  });
});

// ─── Idempotency: no upsert ──────────────────────────────────────────────────

describe("runBlackSwanTest — idempotency safety", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("calling runBlackSwanTest twice for same backtestId creates TWO distinct rows", async () => {
    runPythonModuleMock.mockResolvedValue(VALID_PYTHON_RESULT);

    const r1 = await runBlackSwanTest("backtest-dup", "strategy-dup");
    const r2 = await runBlackSwanTest("backtest-dup", "strategy-dup");

    // Two pending inserts, two updates
    expect(insertCalls.length).toBe(2);
    expect(updateCalls.length).toBe(2);

    // Distinct row IDs (no upsert)
    expect(r1.runId).not.toBe(r2.runId);

    // Each insert should be a fresh pending row
    expect(insertCalls[0]).toMatchObject({
      backtestId: "backtest-dup",
      status: "pending",
    });
    expect(insertCalls[1]).toMatchObject({
      backtestId: "backtest-dup",
      status: "pending",
    });
  });
});
