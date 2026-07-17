/**
 * Tests for agent-audit-service.ts::probeScheduler() failure-detection fix.
 *
 * HIGH finding (telemetry-honesty-safety-adjacent, 2026-07-17): probeScheduler()
 * only consulted getSchedulerHealth() — a map populated on cron SUCCESS only
 * (scheduler.ts::schedulerHealth[name] = new Date() runs after a job's try
 * succeeds; a failure only ever writes schedulerLastError[name]). A job that
 * fails on EVERY run therefore never gets an entry in that map at all and was
 * invisible to the probe — it read "healthy" with zero evidence either way.
 *
 * This suite proves probeScheduler() now also reads scheduler.ts's independent
 * failure tracker (getAllJobHealth() / jobHealthTracker, populated via
 * recordJobFailure on every failed run regardless of success history) so a
 * consistently-failing job is surfaced as unhealthy instead of vanishing.
 *
 * Uses the real scheduler.ts module (not mocked) plus its pre-existing
 * `_testOnly.recordJobFailure` / `_testOnly.resetJobHealth` test seam — no
 * edits to scheduler.ts were made or needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock heavy server dependencies so agent-audit-service.ts + scheduler.ts
// can be imported without a live DB/network. Mirrors the proven pattern in
// agent-audit-deepar-training-freshness.test.ts / scheduler-retry.test.ts.
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })),
    })),
    execute: vi.fn(() => Promise.resolve([])),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve([])) })),
  },
  client: { end: vi.fn() },
}));
vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("../index.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../services/notification-service.js", () => ({ notifyWarning: vi.fn(), notifyCritical: vi.fn() }));
vi.mock("../services/lifecycle-service.js", () => ({
  LifecycleService: vi.fn().mockImplementation(() => ({
    checkAutoPromotions: vi.fn(() => Promise.resolve([])),
    checkAutoDemotions: vi.fn(() => Promise.resolve([])),
  })),
}));
vi.mock("../services/alert-service.js", () => ({ AlertFactory: { circuitOpen: vi.fn() } }));
vi.mock("../lib/python-runner.js", () => ({ runPythonModule: vi.fn() }));
vi.mock("../services/paper-trading-stream.js", () => ({
  startStream: vi.fn(),
  stopStream: vi.fn(),
  isStreaming: vi.fn(() => false),
  getActiveStreams: vi.fn(() => []),
  getStreamHealth: vi.fn(() => ({})),
  getBarBuffer: vi.fn(() => []),
}));
vi.mock("../services/paper-signal-service.js", () => ({
  restorePositionState: vi.fn(),
  cleanupSession: vi.fn(),
  restoreGovernorState: vi.fn(),
}));
vi.mock("../services/deepar-service.js", () => ({
  trainDeepAR: vi.fn(() => Promise.resolve({})),
  predictRegime: vi.fn(() => Promise.resolve({})),
  validatePastForecasts: vi.fn(() => Promise.resolve({})),
  isDeepARDeferred: vi.fn(() => false),
}));
vi.mock("../lib/circuit-breaker.js", () => ({
  CircuitBreakerRegistry: { setOnStateChange: vi.fn(), statusAll: vi.fn(() => ({})) },
}));

describe("probeScheduler failure detection", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("reports a job that fails on EVERY run (never once succeeded) as unhealthy, not healthy", async () => {
    const scheduler = await import("../scheduler.js");
    const { probeScheduler } = await import("../services/agent-audit-service.js");

    scheduler._testOnly.resetJobHealth();
    scheduler._testOnly.resetJobs();

    const jobName = "always-fails-job";
    // Simulate a job that has failed on every single run — it NEVER writes
    // to schedulerHealth (success-only), only to jobHealthTracker.
    scheduler._testOnly.recordJobFailure(jobName, new Error("boom"));
    scheduler._testOnly.recordJobFailure(jobName, new Error("boom"));
    scheduler._testOnly.recordJobFailure(jobName, new Error("boom"));

    const result = await probeScheduler();

    // Pre-fix behavior: this job has zero entries in getSchedulerHealth(),
    // so registeredJobs would read 0 and status would read "healthy" —
    // the job is completely invisible. Post-fix: it must be surfaced.
    expect(result.status).not.toBe("healthy");
    expect(result.details).toMatchObject({
      neverSucceededFailingJobs: [jobName],
    });
    expect(
      result.recommendations.some((r) => r.includes(jobName) && r.toLowerCase().includes("every run")),
    ).toBe(true);

    scheduler._testOnly.resetJobHealth();
  });

  it("reports healthy when there are no stale, failing, or disabled jobs", async () => {
    const scheduler = await import("../scheduler.js");
    const { probeScheduler } = await import("../services/agent-audit-service.js");

    scheduler._testOnly.resetJobHealth();
    scheduler._testOnly.resetJobs();

    const result = await probeScheduler();

    expect(result.status).toBe("healthy");
    expect(result.details).toMatchObject({
      staleJobs: [],
      failingJobs: [],
      neverSucceededFailingJobs: [],
      disabledJobs: [],
    });
  });

  it("does not flag a job with only 1-2 transient failures below the threshold", async () => {
    const scheduler = await import("../scheduler.js");
    const { probeScheduler } = await import("../services/agent-audit-service.js");

    scheduler._testOnly.resetJobHealth();
    scheduler._testOnly.resetJobs();

    scheduler._testOnly.recordJobFailure("blip-job", new Error("transient"));

    const result = await probeScheduler();

    expect(result.status).toBe("healthy");
    expect(result.details).toMatchObject({ neverSucceededFailingJobs: [], failingJobs: [] });

    scheduler._testOnly.resetJobHealth();
  });
});
