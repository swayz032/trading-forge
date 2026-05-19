/**
 * Wave 8 fix (P5) regression test —
 *   reconcileMissedRuns() MUST honor pipelineGate() on every restart.
 *
 * BUG (pre-fix): on every backend restart while pipeline = PAUSED,
 *   reconcileMissedRuns() called `meta.run()` directly. pipelineGate was only
 *   wrapped around the cron-tick handlers (registration sites), not around
 *   reconciliation. Result: every restart triggered one immediate fire of every
 *   pipelineGated cron with interval ≤24h — including lifecycle-auto-check
 *   (full lifecycle mutations), decay-monitor, a-plus-auditor-scan, paper-vs-
 *   backtest, B14 priors refit.
 *
 * THIS TEST: boots minimal SCHEDULER_JOBS via the test seam, pretends pipeline
 * is PAUSED (mock isActive → false), invokes reconcileMissedRuns(), then asserts:
 *   - lifecycle-auto-check.run is NOT invoked
 *   - decay-monitor.run is NOT invoked
 *   - metrics-heartbeat.run IS invoked (ALWAYS_RUN_JOBS short-circuit)
 *   - stale-session-check.run IS invoked (ALWAYS_RUN_JOBS short-circuit)
 *   - pipeline-resume-drain.run IS invoked (ALWAYS_RUN_JOBS short-circuit)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock heavy server dependencies so scheduler can be imported without DB/cron ──
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
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
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

// pipeline-control-service is the gate's source of truth — we drive it from
// the test via the mock's exported fn. Use vi.hoisted so the spy is available
// inside the factory (factory runs hoisted to top of file).
const pipelineMocks = vi.hoisted(() => ({
  isActive: vi.fn(async () => true),
  getMode: vi.fn(async () => "ACTIVE"),
}));
vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: pipelineMocks.isActive,
  getMode: pipelineMocks.getMode,
}));

import { reconcileMissedRuns, _testOnly } from "../scheduler.js";
const isActiveMock = pipelineMocks.isActive;

const HOUR_MS = 60 * 60 * 1000;

describe("reconcileMissedRuns — Wave 8 P5 pipelineGate honored on restart", () => {
  beforeEach(() => {
    _testOnly.resetJobs();
    isActiveMock.mockReset();
  });

  it("skips pipelineGated jobs when pipeline is PAUSED but runs ALWAYS_RUN_JOBS", async () => {
    // Pipeline mode = PAUSED.
    isActiveMock.mockResolvedValue(false);

    // Gated jobs (pipelineGate will reject) — these MUST NOT run on catchup.
    const lifecycleRun = vi.fn(async () => {});
    const decayRun = vi.fn(async () => {});
    const aPlusRun = vi.fn(async () => {});
    _testOnly.registerJob("lifecycle-auto-check", 6 * HOUR_MS, lifecycleRun);
    _testOnly.registerJob("decay-monitor", 24 * HOUR_MS, decayRun);
    _testOnly.registerJob("a-plus-auditor-scan", 6 * HOUR_MS, aPlusRun);

    // ALWAYS_RUN_JOBS (pipelineGate short-circuits true) — these MUST run.
    const heartbeatRun = vi.fn(async () => {});
    const staleRun = vi.fn(async () => {});
    const resumeDrainRun = vi.fn(async () => {});
    _testOnly.registerJob("metrics-heartbeat", 60_000, heartbeatRun);
    _testOnly.registerJob("stale-session-check", 5 * 60_000, staleRun);
    _testOnly.registerJob("pipeline-resume-drain", 30_000, resumeDrainRun);

    await reconcileMissedRuns();

    expect(lifecycleRun).not.toHaveBeenCalled();
    expect(decayRun).not.toHaveBeenCalled();
    expect(aPlusRun).not.toHaveBeenCalled();

    expect(heartbeatRun).toHaveBeenCalledTimes(1);
    expect(staleRun).toHaveBeenCalledTimes(1);
    expect(resumeDrainRun).toHaveBeenCalledTimes(1);
  });

  it("runs gated jobs when pipeline is ACTIVE (regression: do not regress catchup)", async () => {
    isActiveMock.mockResolvedValue(true);

    const lifecycleRun = vi.fn(async () => {});
    const decayRun = vi.fn(async () => {});
    _testOnly.registerJob("lifecycle-auto-check", 6 * HOUR_MS, lifecycleRun);
    _testOnly.registerJob("decay-monitor", 24 * HOUR_MS, decayRun);

    await reconcileMissedRuns();

    expect(lifecycleRun).toHaveBeenCalledTimes(1);
    expect(decayRun).toHaveBeenCalledTimes(1);
  });

  it("honors pipelineGate on overdue branch (lastRunAt set, interval elapsed, PAUSED)", async () => {
    isActiveMock.mockResolvedValue(false);

    const lifecycleRun = vi.fn(async () => {});
    _testOnly.registerJob("lifecycle-auto-check", 6 * HOUR_MS, lifecycleRun);

    // Force lastRunAt into the past so we hit the overdue branch, not the
    // never-ran branch.
    const jobs = _testOnly.getJobs();
    jobs["lifecycle-auto-check"]!.lastRunAt = new Date(Date.now() - 24 * HOUR_MS);

    await reconcileMissedRuns();

    expect(lifecycleRun).not.toHaveBeenCalled();
  });
});
