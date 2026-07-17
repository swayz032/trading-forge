/**
 * Unit tests for health-dashboard.ts::deriveQuantumDashboardStatus()
 *
 * MED finding (telemetry-honesty-safety-adjacent, 2026-07-17): the dashboard's
 * `advancedModels.quantum.status` used to be hardcoded "ok" whenever
 * getQuantumRuntimeStatus() merely RESOLVED (it never throws for a failed
 * quantum run — a failed run is a normal `quantum_mc_runs` row with
 * status="failed", not an exception). So a genuinely failed last quantum run
 * still rendered "ok" on the dashboard — the promise settling said nothing
 * about whether the run it described actually succeeded.
 *
 * This suite exercises the pure derivation function directly (no HTTP, no
 * live DB, no app boot) so the false-green regression is caught without
 * depending on a real DATABASE_URL or any network/DB side effects. Unlike
 * health-dashboard-deepar-status.test.ts (which boots the real app via
 * ../index.js to dodge a circular-import edge), this test mocks every
 * transitive dependency directly — booting the real app requires a live
 * DATABASE_URL, and in an isolated worktree that variable is either absent
 * or (worse) could point at the shared Railway production Postgres instance;
 * a pure-function unit test must never risk touching that.
 */

import { describe, it, expect, vi } from "vitest";

// ── Mock every module health-dashboard.ts imports at module scope, so
// importing it never touches a real DB connection or the app bootstrap chain.
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })),
    execute: vi.fn(() => Promise.resolve([])),
  },
}));
vi.mock("../db/schema.js", () => ({
  paperSessions: { id: "id", status: "status" },
  deadLetterQueue: { id: "id" },
  backtests: { id: "id", status: "status", createdAt: "created_at" },
}));
vi.mock("../lib/circuit-breaker.js", () => ({
  CircuitBreakerRegistry: { statusAll: vi.fn(() => ({})) },
}));
vi.mock("../lib/system-topology.js", () => ({
  checkSystemMapDrift: vi.fn(() => Promise.resolve({ status: "ok" })),
}));
vi.mock("../services/deepar-service.js", () => ({
  getDeepARRuntimeStatus: vi.fn(() => Promise.resolve({ trainingFresh: true, forecastFresh: true })),
}));
vi.mock("../services/quantum-mc-service.js", () => ({
  getQuantumRuntimeStatus: vi.fn(() =>
    Promise.resolve({
      latestRunAt: null,
      latestRunStatus: null,
      latestRunMethod: null,
      latestBackend: null,
      latestBenchmarkAt: null,
      recentRunCount: 0,
      recentFallbackCount: 0,
      fallbackReady: true,
      authorityBoundary: "challenger_only",
    }),
  ),
}));
vi.mock("../lib/python-runner.js", () => ({
  getPythonSubprocessStats: vi.fn(() => ({})),
}));

describe("deriveQuantumDashboardStatus", () => {
  it("reports failed (NOT ok) when the last quantum run's payload says latestRunStatus=failed", async () => {
    const { deriveQuantumDashboardStatus } = await import("../routes/health-dashboard.js");
    // This is the exact false-green scenario the finding caught: the promise
    // that fetched this payload resolved cleanly (no exception), but the run
    // it describes genuinely failed.
    const result = deriveQuantumDashboardStatus({ latestRunStatus: "failed" });
    expect(result.status).not.toBe("ok");
    expect(result.status).toBe("failed");
  });

  it("reports ok when the last quantum run completed", async () => {
    const { deriveQuantumDashboardStatus } = await import("../routes/health-dashboard.js");
    const result = deriveQuantumDashboardStatus({ latestRunStatus: "completed" });
    expect(result.status).toBe("ok");
  });

  it("reports pending (not ok, not failed) when the last run is still running", async () => {
    const { deriveQuantumDashboardStatus } = await import("../routes/health-dashboard.js");
    const result = deriveQuantumDashboardStatus({ latestRunStatus: "running" });
    expect(result.status).toBe("pending");
  });

  it("reports pending when the last run is still pending", async () => {
    const { deriveQuantumDashboardStatus } = await import("../routes/health-dashboard.js");
    const result = deriveQuantumDashboardStatus({ latestRunStatus: "pending" });
    expect(result.status).toBe("pending");
  });

  it("reports unknown (not ok) when no quantum run has ever completed or failed", async () => {
    const { deriveQuantumDashboardStatus } = await import("../routes/health-dashboard.js");
    const result = deriveQuantumDashboardStatus({ latestRunStatus: null });
    expect(result.status).toBe("unknown");
  });
});
