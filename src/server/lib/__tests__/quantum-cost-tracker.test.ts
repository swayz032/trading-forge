/**
 * Unit tests for quantum-cost-tracker.ts (Tier 1.4 — Quantum Cost Telemetry).
 *
 * Isolation contract: these tests mock the DB and pipeline-control-service so
 * no real DB calls occur. The helper is a pure orchestration layer — correctness
 * is verified by inspecting what it writes and what it returns.
 *
 * Pipeline-pause guard: recordCost returns STALE_PENDING_SENTINEL_ID when the
 * pipeline is paused. Tests verify both branches.
 *
 * Pending-row contract:
 *   recordCost → status="pending", wallClockMs=0
 *   completeCost → status="completed"/"failed", wallClockMs set
 *   pruneStalePendingCosts → marks >1hr-old pending rows as failed
 *
 * Vitest hoisting: vi.mock() factories are hoisted before imports, so variables
 * captured from the test module scope cannot be referenced directly inside them.
 * Instead we use vi.hoisted() to declare spies that are available at hoist time.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted spies — must be declared with vi.hoisted() ──────────────────────
const { mockInsertReturning, mockIsActive, mockUpdate } = vi.hoisted(() => {
  const mockInsertReturning = vi.fn();
  const mockIsActive = vi.fn().mockResolvedValue(true);
  const mockUpdate = vi.fn();
  return { mockInsertReturning, mockIsActive, mockUpdate };
});

// ─── DB mock ────────────────────────────────────────────────────────────────
vi.mock("../../db/index.js", () => {
  const dbMock = {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: mockInsertReturning,
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: mockUpdate,
      })),
    })),
  };
  return { db: dbMock };
});

// ─── Schema mock ─────────────────────────────────────────────────────────────
vi.mock("../../db/schema.js", () => ({
  quantumRunCosts: { id: "quantumRunCosts_table", status: "status_col", createdAt: "createdAt_col" },
}));

// ─── Pipeline control mock ───────────────────────────────────────────────────
vi.mock("../../services/pipeline-control-service.js", () => ({
  isActive: mockIsActive,
}));

// ─── drizzle-orm mock ────────────────────────────────────────────────────────
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ op: "eq", val })),
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
  lt: vi.fn((_col: unknown, val: unknown) => ({ op: "lt", val })),
  sql: vi.fn((parts: unknown) => parts),
}));

// ─── Logger mock — suppress output during tests ───────────────────────────────
vi.mock("../../lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocks are registered
import {
  recordCost,
  completeCost,
  pruneStalePendingCosts,
  withCostTracking,
  STALE_PENDING_SENTINEL_ID,
} from "../quantum-cost-tracker.js";
import { db } from "../../db/index.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resetMocks() {
  vi.clearAllMocks();
  mockIsActive.mockResolvedValue(true);
  // Re-wire update chain after clearAllMocks since clearAllMocks resets mock.fn internals
  (db.update as ReturnType<typeof vi.fn>).mockReturnValue({
    set: vi.fn(() => ({ where: mockUpdate })),
  });
  (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
    values: vi.fn(() => ({ returning: mockInsertReturning })),
  });
}

// ─── recordCost — happy path ──────────────────────────────────────────────────

describe("recordCost — happy path", () => {
  beforeEach(resetMocks);

  it("inserts a row with status=pending and wallClockMs=0", async () => {
    mockInsertReturning.mockResolvedValue([{ id: "row-abc" }]);

    await recordCost({
      moduleName: "quantum_mc",
      backtestId: "bt-1",
      strategyId: "st-1",
    });

    expect(db.insert).toHaveBeenCalledOnce();
    const insertValues = (db.insert as ReturnType<typeof vi.fn>).mock.results[0].value.values.mock.calls[0][0];
    expect(insertValues.status).toBe("pending");
    expect(insertValues.wallClockMs).toBe(0);
    expect(insertValues.moduleName).toBe("quantum_mc");
    expect(insertValues.backtestId).toBe("bt-1");
    expect(insertValues.strategyId).toBe("st-1");
  });

  it("returns the inserted row id", async () => {
    mockInsertReturning.mockResolvedValue([{ id: "row-xyz" }]);
    const result = await recordCost({ moduleName: "sqa" });
    expect(result.id).toBe("row-xyz");
  });

  it("defaults qpuSeconds and costDollars to string '0', cacheHit to false", async () => {
    mockInsertReturning.mockResolvedValue([{ id: "row-1" }]);
    await recordCost({ moduleName: "rl_agent" });
    const vals = (db.insert as ReturnType<typeof vi.fn>).mock.results[0].value.values.mock.calls[0][0];
    expect(vals.qpuSeconds).toBe("0");
    expect(vals.costDollars).toBe("0");
    expect(vals.cacheHit).toBe(false);
  });

  it("passes through optional qpuSeconds, costDollars, cacheHit", async () => {
    mockInsertReturning.mockResolvedValue([{ id: "row-2" }]);
    await recordCost({
      moduleName: "cloud_qmc",
      qpuSeconds: 12.5,
      costDollars: 3.75,
      cacheHit: true,
    });
    const vals = (db.insert as ReturnType<typeof vi.fn>).mock.results[0].value.values.mock.calls[0][0];
    expect(vals.qpuSeconds).toBe("12.5");
    expect(vals.costDollars).toBe("3.75");
    expect(vals.cacheHit).toBe(true);
  });
});

// ─── recordCost — pipeline pause guard ───────────────────────────────────────

describe("recordCost — pipeline pause guard", () => {
  beforeEach(resetMocks);

  it("returns STALE_PENDING_SENTINEL_ID and skips DB insert when pipeline is paused", async () => {
    mockIsActive.mockResolvedValue(false);
    const result = await recordCost({ moduleName: "quantum_mc" });
    expect(result.id).toBe(STALE_PENDING_SENTINEL_ID);
    expect(db.insert).not.toHaveBeenCalled();
  });
});

// ─── recordCost — DB failure resilience ──────────────────────────────────────

describe("recordCost — DB failure resilience", () => {
  beforeEach(resetMocks);

  it("returns STALE_PENDING_SENTINEL_ID and does NOT throw when DB insert fails", async () => {
    mockInsertReturning.mockRejectedValue(new Error("connection refused"));
    const result = await recordCost({ moduleName: "quantum_mc" });
    expect(result.id).toBe(STALE_PENDING_SENTINEL_ID);
    // Must not throw — awaited without expect.rejects means it resolved
  });
});

// ─── completeCost — completed transition ─────────────────────────────────────

describe("completeCost — completed transition", () => {
  beforeEach(resetMocks);

  it("updates row to status=completed with wallClockMs", async () => {
    mockUpdate.mockResolvedValue([{ id: "row-abc" }]);
    await completeCost("row-abc", { wallClockMs: 1234, status: "completed" });

    expect(db.update).toHaveBeenCalledOnce();
    const setArgs = (db.update as ReturnType<typeof vi.fn>).mock.results[0].value.set.mock.calls[0][0];
    expect(setArgs.status).toBe("completed");
    expect(setArgs.wallClockMs).toBe(1234);
    expect(setArgs.errorMessage).toBeUndefined();
  });

  it("does not include errorMessage key when not provided", async () => {
    mockUpdate.mockResolvedValue([]);
    await completeCost("row-abc", { wallClockMs: 500, status: "completed" });
    const setArgs = (db.update as ReturnType<typeof vi.fn>).mock.results[0].value.set.mock.calls[0][0];
    expect(Object.keys(setArgs)).not.toContain("errorMessage");
  });
});

// ─── completeCost — failed transition ────────────────────────────────────────

describe("completeCost — failed transition", () => {
  beforeEach(resetMocks);

  it("updates row to status=failed with errorMessage", async () => {
    mockUpdate.mockResolvedValue([]);
    await completeCost("row-abc", {
      wallClockMs: 999,
      status: "failed",
      errorMessage: "python timeout",
    });
    const setArgs = (db.update as ReturnType<typeof vi.fn>).mock.results[0].value.set.mock.calls[0][0];
    expect(setArgs.status).toBe("failed");
    expect(setArgs.wallClockMs).toBe(999);
    expect(setArgs.errorMessage).toBe("python timeout");
  });

  it("includes qpuSeconds and costDollars when provided", async () => {
    mockUpdate.mockResolvedValue([]);
    await completeCost("row-abc", {
      wallClockMs: 5000,
      status: "completed",
      qpuSeconds: 8.1,
      costDollars: 2.5,
      cacheHit: true,
    });
    const setArgs = (db.update as ReturnType<typeof vi.fn>).mock.results[0].value.set.mock.calls[0][0];
    expect(setArgs.qpuSeconds).toBe("8.1");
    expect(setArgs.costDollars).toBe("2.5");
    expect(setArgs.cacheHit).toBe(true);
  });
});

// ─── completeCost — sentinel passthrough ─────────────────────────────────────

describe("completeCost — sentinel passthrough", () => {
  beforeEach(resetMocks);

  it("is a no-op when id is STALE_PENDING_SENTINEL_ID", async () => {
    await completeCost(STALE_PENDING_SENTINEL_ID, { wallClockMs: 100, status: "completed" });
    expect(db.update).not.toHaveBeenCalled();
  });
});

// ─── completeCost — DB failure resilience ────────────────────────────────────

describe("completeCost — DB failure resilience", () => {
  beforeEach(resetMocks);

  it("does NOT throw when DB update fails", async () => {
    mockUpdate.mockRejectedValue(new Error("update failed"));
    await expect(
      completeCost("row-abc", { wallClockMs: 100, status: "completed" }),
    ).resolves.toBeUndefined();
  });
});

// ─── pruneStalePendingCosts ───────────────────────────────────────────────────

describe("pruneStalePendingCosts", () => {
  beforeEach(resetMocks);

  it("updates pending rows older than 1 hour to status=failed with sentinel message", async () => {
    mockUpdate.mockResolvedValue([{ id: "stale-1" }, { id: "stale-2" }]);
    const count = await pruneStalePendingCosts();
    expect(db.update).toHaveBeenCalledOnce();
    const setArgs = (db.update as ReturnType<typeof vi.fn>).mock.results[0].value.set.mock.calls[0][0];
    expect(setArgs.status).toBe("failed");
    expect(setArgs.errorMessage).toBe("stale_pending_pruned");
    expect(count).toBe(2);
  });

  it("returns 0 when no stale rows found", async () => {
    mockUpdate.mockResolvedValue([]);
    const count = await pruneStalePendingCosts();
    expect(count).toBe(0);
  });

  it("does NOT throw when DB update fails during pruning", async () => {
    mockUpdate.mockRejectedValue(new Error("pruning failed"));
    const count = await pruneStalePendingCosts();
    expect(count).toBe(0);
  });
});

// ─── withCostTracking ─────────────────────────────────────────────────────────

describe("withCostTracking — convenience wrapper", () => {
  beforeEach(resetMocks);

  it("calls recordCost then completeCost(completed) on success", async () => {
    mockInsertReturning.mockResolvedValue([{ id: "wrap-1" }]);
    mockUpdate.mockResolvedValue([]);

    const result = await withCostTracking({ moduleName: "sqa" }, async () => "result-value");
    expect(result).toBe("result-value");
    expect(db.insert).toHaveBeenCalledOnce();
    expect(db.update).toHaveBeenCalledOnce();
    const setArgs = (db.update as ReturnType<typeof vi.fn>).mock.results[0].value.set.mock.calls[0][0];
    expect(setArgs.status).toBe("completed");
  });

  it("calls completeCost(failed) and rethrows on error", async () => {
    mockInsertReturning.mockResolvedValue([{ id: "wrap-2" }]);
    mockUpdate.mockResolvedValue([]);

    await expect(
      withCostTracking({ moduleName: "rl_agent" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(db.update).toHaveBeenCalledOnce();
    const setArgs = (db.update as ReturnType<typeof vi.fn>).mock.results[0].value.set.mock.calls[0][0];
    expect(setArgs.status).toBe("failed");
    expect(setArgs.errorMessage).toBe("boom");
  });
});

// ─── API surface isolation guard ─────────────────────────────────────────────

describe("quantum-cost-tracker — API surface", () => {
  it("exports recordCost, completeCost, pruneStalePendingCosts, withCostTracking, STALE_PENDING_SENTINEL_ID", async () => {
    const mod = await import("../quantum-cost-tracker.js");
    expect(typeof mod.recordCost).toBe("function");
    expect(typeof mod.completeCost).toBe("function");
    expect(typeof mod.pruneStalePendingCosts).toBe("function");
    expect(typeof mod.withCostTracking).toBe("function");
    expect(typeof mod.STALE_PENDING_SENTINEL_ID).toBe("string");
  });
});
