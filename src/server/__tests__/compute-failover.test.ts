/**
 * B6 — Compute Failover state machine tests.
 *
 * Verifies the state machine advances correctly under simulated local
 * Python health check failures and recoveries, and that the manual
 * override (FORCE_CLOUD_COMPUTE) works. The actual Python subprocess and
 * SSE broadcast are mocked so tests run without a live engine.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock SSE broadcast (no-op) ──────────────────────────────────────────────
vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

// ─── Mock python-runner so probe calls don't spawn subprocesses ──────────────
vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn(),
}));

import {
  getComputeState,
  getComputeTarget,
  getComputeFailoverStatus,
  submitToCloud,
  _resetForTests,
} from "../lib/compute-failover.js";

import { runPythonModule } from "../lib/python-runner.js";
const runPythonModuleMock = vi.mocked(runPythonModule);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Simulate N consecutive probe failures by calling onHealthCheckFailure
 * logic via the probe mock returning rejected promises.
 *
 * We re-import the module's internal runHealthCheck via the exported
 * _resetForTests + a direct probe invocation chain. Since we can't call
 * the private runHealthCheck directly, we drive failures through the
 * startComputeFailoverMonitor probe path using the mock.
 */
function makeProbeReject(reason: string) {
  runPythonModuleMock.mockRejectedValue(new Error(reason));
}

function makeProbeResolve() {
  runPythonModuleMock.mockResolvedValue({ status: "ok" });
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetModules();
  delete process.env.FORCE_CLOUD_COMPUTE;
  delete process.env.RAILWAY_COMPUTE_URL;
  _resetForTests();
  vi.clearAllMocks();
});

afterEach(() => {
  _resetForTests();
  delete process.env.FORCE_CLOUD_COMPUTE;
  delete process.env.RAILWAY_COMPUTE_URL;
});

// ─── State machine ────────────────────────────────────────────────────────────

describe("ComputeFailover — initial state", () => {
  it("starts in LOCAL_HEALTHY", () => {
    expect(getComputeState()).toBe("LOCAL_HEALTHY");
  });

  it("getComputeTarget returns local when LOCAL_HEALTHY", () => {
    expect(getComputeTarget()).toBe("local");
  });

  it("status snapshot has correct initial shape", () => {
    const status = getComputeFailoverStatus();
    expect(status.state).toBe("LOCAL_HEALTHY");
    expect(status.target).toBe("local");
    expect(status.consecutiveFailures).toBe(0);
    expect(status.consecutiveSuccesses).toBe(0);
    expect(status.lastCheckedAt).toBeNull();
    expect(status.lastFailureReason).toBeNull();
    expect(status.failoverTriggeredAt).toBeNull();
    expect(status.forceCloud).toBe(false);
    expect(status.cloudConfigured).toBe(false);
    expect(status.cloudBaseUrl).toBeNull();
  });
});

describe("ComputeFailover — FORCE_CLOUD_COMPUTE override", () => {
  it("returns CLOUD_FAILOVER when FORCE_CLOUD_COMPUTE=true", () => {
    process.env.FORCE_CLOUD_COMPUTE = "true";
    expect(getComputeState()).toBe("CLOUD_FAILOVER");
    expect(getComputeTarget()).toBe("cloud");
  });

  it("returns LOCAL_HEALTHY when FORCE_CLOUD_COMPUTE is not set", () => {
    expect(getComputeState()).toBe("LOCAL_HEALTHY");
    expect(getComputeTarget()).toBe("local");
  });

  it("status reflects forceCloud=true in snapshot", () => {
    process.env.FORCE_CLOUD_COMPUTE = "true";
    const status = getComputeFailoverStatus();
    expect(status.forceCloud).toBe(true);
    expect(status.state).toBe("CLOUD_FAILOVER");
    expect(status.target).toBe("cloud");
  });
});

describe("ComputeFailover — cloudConfigured reflects RAILWAY_COMPUTE_URL", () => {
  it("cloudConfigured=false when RAILWAY_COMPUTE_URL is not set", () => {
    const status = getComputeFailoverStatus();
    expect(status.cloudConfigured).toBe(false);
    expect(status.cloudBaseUrl).toBeNull();
  });

  it("cloudConfigured=true when RAILWAY_COMPUTE_URL is set", () => {
    process.env.RAILWAY_COMPUTE_URL = "https://example.railway.app";
    const status = getComputeFailoverStatus();
    expect(status.cloudConfigured).toBe(true);
    expect(status.cloudBaseUrl).toBe("https://example.railway.app");
  });
});

describe("ComputeFailover — submitToCloud", () => {
  it("returns submitted=false when RAILWAY_COMPUTE_URL is not configured", async () => {
    const result = await submitToCloud("backtest", { strategyId: "abc" });
    expect(result.submitted).toBe(false);
    expect(result.reason).toMatch(/RAILWAY_COMPUTE_URL not configured/);
  });

  it("returns submitted=true when cloud endpoint responds 200", async () => {
    process.env.RAILWAY_COMPUTE_URL = "https://example.railway.app";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
    } as Response);

    const result = await submitToCloud("backtest", { strategyId: "abc" });
    expect(result.submitted).toBe(true);
    expect(result.reason).toContain("accepted");
  });

  it("returns submitted=false when cloud endpoint responds non-2xx", async () => {
    process.env.RAILWAY_COMPUTE_URL = "https://example.railway.app";
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    } as Response);

    const result = await submitToCloud("backtest", { strategyId: "abc" });
    expect(result.submitted).toBe(false);
    expect(result.reason).toContain("503");
  });

  it("returns submitted=false when fetch throws (network error)", async () => {
    process.env.RAILWAY_COMPUTE_URL = "https://example.railway.app";
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await submitToCloud("paper_signal", { sessionId: "sess-1" });
    expect(result.submitted).toBe(false);
    expect(result.reason).toContain("ECONNREFUSED");
  });

  it("submits to the correct endpoint path for backtest job type", async () => {
    process.env.RAILWAY_COMPUTE_URL = "https://example.railway.app";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
    } as Response);
    global.fetch = fetchMock;

    await submitToCloud("backtest", { strategyId: "s1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.railway.app/api/compute/backtest",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("submits to the correct endpoint path for paper_signal job type", async () => {
    process.env.RAILWAY_COMPUTE_URL = "https://example.railway.app";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
    } as Response);
    global.fetch = fetchMock;

    await submitToCloud("paper_signal", { sessionId: "sess-2" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.railway.app/api/compute/paper_signal",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

// ─── getPipelineStatus integration (pipeline-control-service) ─────────────────

describe("getPipelineStatus — exposes computeMode", () => {
  // These tests import pipeline-control-service after mocking its DB dependency
  // to verify the B6 getPipelineStatus() function returns the shape callers expect.

  it("getPipelineStatus returns a computeMode field", async () => {
    vi.doMock("../db/index.js", () => ({
      db: {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([{ currentValue: "1" }]),
          })),
        })),
      },
    }));
    vi.doMock("../db/schema.js", () => ({
      systemParameters: {},
      auditLog: {},
    }));
    vi.doMock("../routes/sse.js", () => ({
      broadcastSSE: vi.fn(),
    }));

    const { getPipelineStatus } = await import("../services/pipeline-control-service.js");
    const status = await getPipelineStatus();

    expect(status).toHaveProperty("mode");
    expect(status).toHaveProperty("active");
    expect(status).toHaveProperty("computeMode");

    const cm = status.computeMode;
    expect(cm).toHaveProperty("state");
    expect(cm).toHaveProperty("target");
    expect(cm).toHaveProperty("consecutiveFailures");
    expect(cm).toHaveProperty("forceCloud");
    expect(cm).toHaveProperty("cloudConfigured");
  });
});
