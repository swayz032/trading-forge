/**
 * Tests for agent-audit-service.ts::probeDeepAR() training-freshness check.
 *
 * deep-scan (DeepAR HIGH-2 sibling finding, 2026-07-17): probeDeepAR() feeds the
 * PERSISTED `agent_health_reports` liveness beacon (durable history — unlike the
 * stateless /api/health/dashboard endpoint). It used to report "healthy" purely
 * from forecast recency (a row landed in the last 3 days), the same false-green
 * shape the dashboard fix (deriveDeepARDashboardStatus) closed: a model that has
 * not retrained in months can still look "healthy" here if some forecast row is
 * recent. This suite proves the persisted beacon now also requires training
 * freshness, so a future silent-stop of the training pipeline can't read
 * "healthy" in `agent_health_reports` either.
 */

import { describe, it, expect, vi } from "vitest";

// ── Mock heavy server dependencies so agent-audit-service.ts can be imported
// without a live DB/network. agent-audit-service.ts imports scheduler.js
// (for getSchedulerHealth), which transitively imports deepar-service.ts,
// which imports `logger` from "../index.js" (the Express bootstrap) — pulling
// in the entire route graph unless these are stubbed. Mirrors the proven
// pattern in scheduler-retry.test.ts.
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

function makeChain(resolved: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(() => Promise.resolve(resolved));
  return chain;
}

let forecastRows: Array<{ generatedAt: Date }> = [];
let trainingRows: Array<{ trainedAt: Date | null }> = [];

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => {
      // probeDeepAR queries deeparForecasts first, then deeparTrainingRuns.
      // Track call order via a shared counter closed over per-test via reset().
      const callIndex = (globalThis as { __probeDeepARCallCount?: number }).__probeDeepARCallCount ?? 0;
      (globalThis as { __probeDeepARCallCount?: number }).__probeDeepARCallCount = callIndex + 1;
      return callIndex === 0 ? makeChain(forecastRows) : makeChain(trainingRows);
    }),
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve([])) })),
  },
  client: { end: vi.fn() },
}));

function resetCallCounter() {
  (globalThis as { __probeDeepARCallCount?: number }).__probeDeepARCallCount = 0;
}

describe("probeDeepAR training-freshness", () => {
  it("reports degraded when training is stale even though forecasts are recent", async () => {
    resetCallCounter();
    const now = Date.now();
    forecastRows = [{ generatedAt: new Date(now - 1 * 60 * 60 * 1000) }]; // 1h ago — fresh
    trainingRows = [{ trainedAt: new Date(now - 75 * 24 * 60 * 60 * 1000) }]; // ~2.5 months ago — stale

    const { probeDeepAR } = await import("../services/agent-audit-service.js");
    const result = await probeDeepAR();

    expect(result.domain).toBe("deepar");
    expect(result.status).not.toBe("healthy");
    expect(result.status).toBe("degraded");
    expect(result.details).toMatchObject({ trainingFresh: false });
  });

  it("reports healthy only when BOTH forecasts are recent AND training is fresh", async () => {
    resetCallCounter();
    const now = Date.now();
    forecastRows = [{ generatedAt: new Date(now - 1 * 60 * 60 * 1000) }];
    trainingRows = [{ trainedAt: new Date(now - 2 * 24 * 60 * 60 * 1000) }]; // 2 days ago — fresh

    const { probeDeepAR } = await import("../services/agent-audit-service.js");
    const result = await probeDeepAR();

    expect(result.status).toBe("healthy");
    expect(result.details).toMatchObject({ trainingFresh: true });
  });

  it("reports degraded when no training row exists at all", async () => {
    resetCallCounter();
    const now = Date.now();
    forecastRows = [{ generatedAt: new Date(now - 1 * 60 * 60 * 1000) }];
    trainingRows = [];

    const { probeDeepAR } = await import("../services/agent-audit-service.js");
    const result = await probeDeepAR();

    expect(result.status).toBe("degraded");
    expect(result.details).toMatchObject({ trainingFresh: false, latestTrainingAt: null });
  });
});
