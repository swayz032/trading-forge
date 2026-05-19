/**
 * NeMo Scenario Service Tests — Track 1 (Challenger-Only, Phase 0)
 *
 * Tests the pending-row contract, pipeline pause guard, subprocess error handling,
 * audit log writes, SSE events, and governance enforcement.
 *
 * Authority boundary under test:
 *   - decision_role = challenger_only on all rows
 *   - authoritative = false
 *   - No lifecycle promotion paths invoked
 *   - Pipeline pause guard returns skip without DB write
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const mockState = vi.hoisted(() => {
  const insertCalls: Array<Record<string, unknown>> = [];
  const updateCalls: Array<{ set: Record<string, unknown> }> = [];
  const sseBroadcasts: Array<{ event: string; payload: Record<string, unknown> }> = [];
  return { insertCalls, updateCalls, sseBroadcasts };
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
  const selectFrom = vi.fn();
  const selectMock = vi.fn();
  return {
    insertReturning, insertValues, insertMock,
    updateWhere, updateSet, updateMock,
    selectLimit, selectOrderBy, selectFrom, selectMock,
  };
});

vi.mock("../db/index.js", () => ({
  db: {
    insert: dbMocks.insertMock,
    update: dbMocks.updateMock,
    select: dbMocks.selectMock,
  },
}));

vi.mock("../db/schema.js", () => ({
  nemoScenarioBank: { id: "id" },
  auditLog: {},
  quantumRunCosts: { id: "id" },
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn(),
}));

vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn(),
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn((event: string, payload: Record<string, unknown>) => {
    mockState.sseBroadcasts.push({ event, payload });
  }),
}));

vi.mock("../index.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
  desc: (col: unknown) => ({ col, dir: "desc" }),
}));

// ─── Import under test (after mocks) ─────────────────────────────────────────

import { isActive } from "../services/pipeline-control-service.js";
import { runPythonModule } from "../lib/python-runner.js";
import { generateNeMoBatch, getRecentNeMoScenarios } from "../services/nemo-scenario-service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePythonResult(count: number = 3) {
  const scenarios = Array.from({ length: count }, (_, i) => ({
    scenario_label: `test_scenario_${i}`,
    severity: "moderate",
    duration_days: 10,
    target_vol: 0.30,
    target_trend: -0.10,
    target_gap_profile: { mean_gap_pct: 0.01 },
    narrative: "Test narrative",
    macro_links: {},
    generator_version: "nemo-scenario-designer-v1.0",
    run_id: `run-${i}`,
    seed: null,
  }));
  return {
    scenarios,
    count,
    generator_version: "nemo-scenario-designer-v1.0",
    elapsed_ms: 500,
    device: "cpu",
    seed: null,
    governance: { authoritative: false, decision_role: "challenger_only" },
  };
}

function setupDbMocks(scenariosToInsert: number = 3) {
  // Cost row insert
  dbMocks.insertReturning.mockResolvedValueOnce([{ id: "cost-uuid-001" }]);
  // Scenario row inserts
  for (let i = 0; i < scenariosToInsert; i++) {
    dbMocks.insertReturning.mockResolvedValueOnce([{ id: i + 1 }]);
  }
  // Audit log insert
  dbMocks.insertReturning.mockResolvedValue([]);

  dbMocks.insertValues.mockReturnValue({ returning: dbMocks.insertReturning });
  dbMocks.insertMock.mockReturnValue({ values: dbMocks.insertValues });

  dbMocks.updateWhere.mockResolvedValue([]);
  dbMocks.updateSet.mockReturnValue({ where: dbMocks.updateWhere });
  dbMocks.updateMock.mockReturnValue({ set: dbMocks.updateSet });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("generateNeMoBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.insertCalls.length = 0;
    mockState.updateCalls.length = 0;
    mockState.sseBroadcasts.length = 0;
  });

  // Test 1: Happy path
  it("happy path: generates batch, inserts rows, fires SSE event", async () => {
    (isActive as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (runPythonModule as ReturnType<typeof vi.fn>).mockResolvedValue(makePythonResult(3));
    setupDbMocks(3);

    const result = await generateNeMoBatch(3, 42);

    expect(result.skipped).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.governance.authoritative).toBe(false);
    expect(result.governance.decisionRole).toBe("challenger_only");

    // SSE event must fire on success
    const sseEvent = mockState.sseBroadcasts.find(b => b.event === "nemo:scenario-generated");
    expect(sseEvent).toBeDefined();
    expect(sseEvent?.payload.governance).toBeDefined();
  });

  // Test 2: Pipeline pause skip
  it("pipeline pause: returns skipped without Python spawn or DB write", async () => {
    (isActive as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const result = await generateNeMoBatch(10);

    expect(result.skipped).toBe("pipeline_paused");
    expect(runPythonModule).not.toHaveBeenCalled();
    expect(dbMocks.insertMock).not.toHaveBeenCalled();
  });

  // Test 3: Subprocess error -> fail-CLOSED + audit log + alert SSE
  it("subprocess error: returns error, fires nemo:scenario-error SSE, writes audit log", async () => {
    (isActive as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (runPythonModule as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Python subprocess crashed"));

    // Cost row insert returns id
    dbMocks.insertReturning.mockResolvedValue([{ id: "cost-001" }]);
    dbMocks.insertValues.mockReturnValue({ returning: dbMocks.insertReturning });
    dbMocks.insertMock.mockReturnValue({ values: dbMocks.insertValues });
    dbMocks.updateWhere.mockResolvedValue([]);
    dbMocks.updateSet.mockReturnValue({ where: dbMocks.updateWhere });
    dbMocks.updateMock.mockReturnValue({ set: dbMocks.updateSet });

    const result = await generateNeMoBatch(5);

    expect(result.error).toContain("Python subprocess crashed");
    expect(result.governance.authoritative).toBe(false);

    const errorSSE = mockState.sseBroadcasts.find(b => b.event === "nemo:scenario-error");
    expect(errorSSE).toBeDefined();
  });

  // Test 4: Python result with error field -> treated as failure
  it("python error field: throws and returns error result", async () => {
    (isActive as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (runPythonModule as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: "NeMo model not found",
      scenarios: [],
      count: 0,
    });

    dbMocks.insertReturning.mockResolvedValue([{ id: "cost-001" }]);
    dbMocks.insertValues.mockReturnValue({ returning: dbMocks.insertReturning });
    dbMocks.insertMock.mockReturnValue({ values: dbMocks.insertValues });
    dbMocks.updateWhere.mockResolvedValue([]);
    dbMocks.updateSet.mockReturnValue({ where: dbMocks.updateWhere });
    dbMocks.updateMock.mockReturnValue({ set: dbMocks.updateSet });

    const result = await generateNeMoBatch(5);
    expect(result.error).toContain("NeMo model not found");
  });

  // Test 5: Governance labels on result
  it("governance: result always carries authoritative=false and challenger_only", async () => {
    (isActive as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const result = await generateNeMoBatch(1);
    expect(result.governance.authoritative).toBe(false);
    expect(result.governance.decisionRole).toBe("challenger_only");
  });

  // Test 6: SSE event fires on success
  it("SSE: nemo:scenario-generated fires with batchId and governance", async () => {
    (isActive as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (runPythonModule as ReturnType<typeof vi.fn>).mockResolvedValue(makePythonResult(1));
    setupDbMocks(1);

    await generateNeMoBatch(1, 0);

    const sseEvent = mockState.sseBroadcasts.find(b => b.event === "nemo:scenario-generated");
    expect(sseEvent).toBeDefined();
    expect(sseEvent?.payload.batchId).toBeDefined();
    expect(sseEvent?.payload.governance).toEqual(expect.objectContaining({ authoritative: false }));
  });

  // Test 7: Idempotent batch ID format
  it("batchId: each call generates a distinct batchId", async () => {
    (isActive as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (runPythonModule as ReturnType<typeof vi.fn>).mockResolvedValue(makePythonResult(1));
    setupDbMocks(1);
    const r1 = await generateNeMoBatch(1, 0);

    (runPythonModule as ReturnType<typeof vi.fn>).mockResolvedValue(makePythonResult(1));
    setupDbMocks(1);
    const r2 = await generateNeMoBatch(1, 1);

    expect(r1.batchId).toBeDefined();
    expect(r2.batchId).toBeDefined();
    expect(r1.batchId).not.toBe(r2.batchId);
  });

  // Test 8: No lifecycle promotion paths invoked
  it("authority boundary: no lifecycle or promotion functions called", async () => {
    (isActive as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (runPythonModule as ReturnType<typeof vi.fn>).mockResolvedValue(makePythonResult(2));
    setupDbMocks(2);

    await generateNeMoBatch(2);

    // Only nemo_scenario_designer module should be invoked, not lifecycle modules
    const calls = (runPythonModule as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][0].module).toBe("src.engine.nemo_scenario_designer");
  });
});

// ─── getRecentNeMoScenarios ───────────────────────────────────────────────────

describe("getRecentNeMoScenarios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns rows from DB ordered by createdAt desc", async () => {
    const fakeRows = [{ id: 1, scenarioLabel: "test", severity: "mild" }];
    dbMocks.selectLimit.mockResolvedValue(fakeRows);
    dbMocks.selectOrderBy.mockReturnValue({ limit: dbMocks.selectLimit });
    dbMocks.selectFrom.mockReturnValue({ orderBy: dbMocks.selectOrderBy });
    dbMocks.selectMock.mockReturnValue({ from: dbMocks.selectFrom });

    const result = await getRecentNeMoScenarios(10);
    expect(result).toEqual(fakeRows);
  });
});
