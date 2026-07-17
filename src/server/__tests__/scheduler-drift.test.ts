/**
 * scheduler-drift.test.ts — deep-scan Autonomy re-verify failure-injection: prove the
 * registered-but-never-scheduled detector actually FIRES on drift (the class that let
 * economic-calendar-sync silently never run) and does NOT false-alarm when all jobs are scheduled.
 */
import { describe, it, expect, vi } from "vitest";
import { findUnscheduledJobs } from "../lib/scheduler-drift.js";

// Same full mock set scheduler-retry.test.ts uses to call initScheduler() directly
// without a real DB connection or dragging in the full Express app's import graph
// (an unmocked import pulls in index.ts -> routes/strategies.ts -> a real
// LifecycleService construction that hits an unrelated pre-existing circular-import
// issue). The registration-completeness bug this file guards against is a
// synchronous bookkeeping issue in initScheduler() itself — it doesn't depend on
// real DB/service access either way, so mocking these out is safe and matches the
// established pattern for exercising initScheduler() in this test suite.
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })),
    execute: vi.fn(() => Promise.resolve([])),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])) })) })),
  },
  client: { end: vi.fn() },
}));
vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("../index.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
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
}));
vi.mock("../services/paper-signal-service.js", () => ({
  restorePositionState: vi.fn(),
  cleanupSession: vi.fn(),
}));
vi.mock("../services/deepar-service.js", () => ({
  trainDeepAR: vi.fn(() => Promise.resolve({})),
  predictRegime: vi.fn(() => Promise.resolve({})),
  validatePastForecasts: vi.fn(() => Promise.resolve({})),
}));
vi.mock("../lib/circuit-breaker.js", () => ({
  CircuitBreakerRegistry: { setOnStateChange: vi.fn(), statusAll: vi.fn(() => ({})) },
}));

describe("findUnscheduledJobs — scheduler drift detector", () => {
  it("FIRES: a registered job with no cron.schedule is flagged (fabricated drift)", () => {
    expect(findUnscheduledJobs(["a", "b", "c"], new Set(["a", "c"]))).toEqual(["b"]);
  });

  it("FIRES on the exact economic-calendar-sync class (registered, not scheduled)", () => {
    const registered = ["heartbeat-write", "economic-calendar-sync", "pre-market-prep"];
    const scheduled = new Set(["heartbeat-write", "pre-market-prep"]); // economic-calendar-sync missing
    expect(findUnscheduledJobs(registered, scheduled)).toEqual(["economic-calendar-sync"]);
  });

  it("does NOT false-alarm when every registered job is scheduled", () => {
    expect(findUnscheduledJobs(["a", "b"], new Set(["a", "b"]))).toEqual([]);
  });

  it("empty registry → no drift", () => {
    expect(findUnscheduledJobs([], new Set())).toEqual([]);
  });
});

describe("initScheduler — real registration completeness (regression: bias-state-freshness-check)", () => {
  it("does not throw scheduler-drift on real initScheduler() — NODE_ENV left as-is, throw NOT swallowed", async () => {
    // Every OTHER initScheduler()-calling test in this suite either wraps the call in
    // `try { initScheduler(); } catch { /* already initialized */ }` (scheduler-retry.test.ts) —
    // which discards ANY thrown error, including a real "Scheduler drift: ..." — or forces
    // NODE_ENV=production first, which makes _validateAllJobsScheduled() log-only and never
    // throw at all. Either pattern would have hidden the bias-state-freshness-check bug: it
    // was registerJob'd + scheduleUtc'd but the _scheduledJobs.add() call after its cron body
    // was missing, so it shipped silently unregistered for weeks. This test deliberately does
    // neither — it leaves NODE_ENV as vitest's own default (not "production") so the throw path
    // is live, and lets a genuine drift throw fail the test instead of swallowing it.
    expect(process.env.NODE_ENV).not.toBe("production");
    const { initScheduler } = await import("../scheduler.js");
    expect(() => initScheduler()).not.toThrow();
  });
});
