/**
 * Quantum Cost Route Tests — POST /api/quantum/cost
 *
 * Tier 3.1 W3a deferred: cost telemetry hook for entropy_filter module.
 * The route is called by Python (via requests.post) after each
 * collect_quantum_noise() run. It records a completed cost row in one shot.
 *
 * Tests verify route handler logic directly (no HTTP layer needed).
 * Pattern matches existing test suite style (no supertest dependency).
 *
 * Test categories:
 *   1. Happy path — completed row written, recorded=true
 *   2. Failed run — errorMessage persisted, status=failed
 *   3. Pipeline paused → sentinel, still recorded=true (200-equivalent)
 *   4. DB error → recorded=false (telemetry must not break caller)
 *   5. Schema validation — missing required fields → 400
 *   6. Unknown moduleName rejected → 400 (prevents typo pollution)
 *   7. cacheHit default false when omitted
 *   8. Challenger isolation — route does NOT call any quantum compute
 *   9. All valid module names pass
 *  10. Optional fields pass through
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock state ─────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  isActiveMock: vi.fn().mockResolvedValue(true),
  recordCostMock: vi.fn().mockResolvedValue({ id: "test-cost-id" }),
  completeCostMock: vi.fn().mockResolvedValue(undefined),
  runQuantumMCMock: vi.fn(),
  runQuantumBreachEstimationMock: vi.fn(),
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: mocks.isActiveMock,
  getMode: vi.fn().mockResolvedValue("ACTIVE"),
}));

vi.mock("../lib/quantum-cost-tracker.js", () => ({
  recordCost: mocks.recordCostMock,
  completeCost: mocks.completeCostMock,
  STALE_PENDING_SENTINEL_ID: "__no_cost_row__",
}));

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Compute spawn watchdog — these must NEVER be called from cost route.
vi.mock("../services/quantum-mc-service.js", () => ({
  runQuantumMC: mocks.runQuantumMCMock,
  runQuantumBreachEstimation: mocks.runQuantumBreachEstimationMock,
}));

const { isActiveMock, recordCostMock, completeCostMock, runQuantumMCMock, runQuantumBreachEstimationMock } = mocks;

// ─── Mock req/res helpers ────────────────────────────────────────────────────

function mockRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(b: unknown) { this.body = b; return this; },
  };
  return res;
}

function mockReq(body: unknown) {
  return { body } as unknown as import("express").Request;
}

// ─── Import route under test ─────────────────────────────────────────────────
// We call the router's registered handler directly by extracting the route.
// The route file exports `quantumCostRoutes` (an Express Router).
// We test the handler logic by simulating req/res objects.

async function callCostRoute(body: unknown) {
  const { quantumCostRoutes } = await import("../routes/quantum-cost.js");
  const req = mockReq(body);
  const res = mockRes();

  // Find the POST "/" handler registered on the router
  // Router stack: layer.route.stack[0].handle is the async function
  const layer = (quantumCostRoutes as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: (...args: unknown[]) => unknown }> } }> }).stack.find(
    (l) => l.route?.path === "/",
  );
  const handler = layer?.route?.stack[0]?.handle;
  if (!handler) throw new Error("POST / handler not found on quantumCostRoutes");

  await handler(req, res, () => {/* next */});
  return res;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/quantum/cost — route handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isActiveMock.mockResolvedValue(true);
    recordCostMock.mockResolvedValue({ id: "test-cost-id" });
    completeCostMock.mockResolvedValue(undefined);
    vi.resetModules();
  });

  // ── 1. Happy path ──────────────────────────────────────────────────────────
  it("returns recorded=true and calls recordCost + completeCost on success", async () => {
    const res = await callCostRoute({
      moduleName: "entropy_filter",
      wallClockMs: 42,
      status: "completed",
    });

    expect(res.statusCode).toBe(200);
    expect((res.body as Record<string, unknown>).recorded).toBe(true);
    expect(recordCostMock).toHaveBeenCalledOnce();
    expect(recordCostMock).toHaveBeenCalledWith(
      expect.objectContaining({ moduleName: "entropy_filter" }),
    );
    expect(completeCostMock).toHaveBeenCalledOnce();
    expect(completeCostMock).toHaveBeenCalledWith(
      "test-cost-id",
      expect.objectContaining({ wallClockMs: 42, status: "completed" }),
    );
  });

  // ── 2. Failed run ──────────────────────────────────────────────────────────
  it("persists errorMessage and status=failed", async () => {
    const res = await callCostRoute({
      moduleName: "entropy_filter",
      wallClockMs: 10,
      status: "failed",
      errorMessage: "circuit_timeout",
    });

    expect(res.statusCode).toBe(200);
    expect(completeCostMock).toHaveBeenCalledWith(
      "test-cost-id",
      expect.objectContaining({ status: "failed", errorMessage: "circuit_timeout" }),
    );
  });

  // ── 3. Pipeline paused → sentinel, still 200 ──────────────────────────────
  it("returns recorded=true even when pipeline is paused", async () => {
    isActiveMock.mockResolvedValue(false);
    recordCostMock.mockResolvedValue({ id: "__no_cost_row__" });

    const res = await callCostRoute({
      moduleName: "entropy_filter",
      wallClockMs: 15,
      status: "completed",
    });

    expect(res.statusCode).toBe(200);
    expect((res.body as Record<string, unknown>).recorded).toBe(true);
  });

  // ── 4. DB error → recorded=false, still 200 ────────────────────────────────
  it("returns recorded=false when recordCost throws (telemetry must not break caller)", async () => {
    recordCostMock.mockRejectedValue(new Error("db_connection_lost"));

    const res = await callCostRoute({
      moduleName: "entropy_filter",
      wallClockMs: 5,
      status: "completed",
    });

    expect(res.statusCode).toBe(200);
    expect((res.body as Record<string, unknown>).recorded).toBe(false);
  });

  // ── 5. Missing required fields → 400 ──────────────────────────────────────
  it("returns 400 when moduleName is missing", async () => {
    const res = await callCostRoute({ wallClockMs: 10, status: "completed" });
    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>)).toHaveProperty("error");
  });

  it("returns 400 when wallClockMs is missing", async () => {
    const res = await callCostRoute({ moduleName: "entropy_filter", status: "completed" });
    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>)).toHaveProperty("error");
  });

  it("returns 400 when status is missing", async () => {
    const res = await callCostRoute({ moduleName: "entropy_filter", wallClockMs: 10 });
    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>)).toHaveProperty("error");
  });

  // ── 6. Unknown moduleName rejected ────────────────────────────────────────
  it("returns 400 for unknown moduleName", async () => {
    const res = await callCostRoute({
      moduleName: "unknown_module_xyz",
      wallClockMs: 10,
      status: "completed",
    });
    expect(res.statusCode).toBe(400);
    expect((res.body as Record<string, unknown>)).toHaveProperty("error");
    expect(recordCostMock).not.toHaveBeenCalled();
  });

  // ── 7. cacheHit defaults to false when omitted ────────────────────────────
  it("passes cacheHit=false when not provided in body", async () => {
    await callCostRoute({ moduleName: "entropy_filter", wallClockMs: 20, status: "completed" });
    expect(recordCostMock).toHaveBeenCalledWith(
      expect.objectContaining({ cacheHit: false }),
    );
  });

  // ── 8. Challenger isolation — no quantum compute spawned ──────────────────
  it("never calls runQuantumMC or runQuantumBreachEstimation", async () => {
    await callCostRoute({ moduleName: "entropy_filter", wallClockMs: 10, status: "completed" });
    expect(runQuantumMCMock).not.toHaveBeenCalled();
    expect(runQuantumBreachEstimationMock).not.toHaveBeenCalled();
  });

  // ── 9. All valid module names pass ────────────────────────────────────────
  const validModules = [
    "quantum_mc", "sqa", "rl_agent", "entropy_filter",
    "adversarial_stress", "cloud_qmc", "ising_decoder", "a_plus_auditor",
  ];

  for (const mod of validModules) {
    it(`accepts moduleName="${mod}"`, async () => {
      const res = await callCostRoute({ moduleName: mod, wallClockMs: 5, status: "completed" });
      expect(res.statusCode).toBe(200);
    });
  }

  // ── 10. Optional fields pass through ──────────────────────────────────────
  it("passes optional qpuSeconds, costDollars, cacheHit through to recordCost", async () => {
    const res = await callCostRoute({
      moduleName: "entropy_filter",
      wallClockMs: 30,
      status: "completed",
      qpuSeconds: 1.5,
      costDollars: 0.002,
      cacheHit: true,
    });

    expect(res.statusCode).toBe(200);
    expect(recordCostMock).toHaveBeenCalledWith(
      expect.objectContaining({
        qpuSeconds: 1.5,
        costDollars: 0.002,
        cacheHit: true,
      }),
    );
  });
});
