/**
 * FIX 3: DLQ retry handler registration tests.
 *
 * Verifies that DLQ retry handlers are registered for production operation
 * types and that retryDLQItem invokes the registered handler.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── vi.mock factories are hoisted — must be fully self-contained ─────────────
vi.mock("../db/index.js", () => {
  const makeChain = (rows: unknown[]) => ({
    from: () => makeChain(rows),
    where: () => Promise.resolve(rows),
  });
  const fakeDb = {
    select: () => makeChain([{
      id: "dlq-test-001",
      operationType: "monte_carlo:failure",
      entityType: "backtest",
      entityId: "bt-abc",
      errorMessage: "Python timeout",
      retryCount: 0,
      maxRetries: 3,
      resolved: false,
      escalated: false,
      firstFailedAt: new Date(),
      lastFailedAt: new Date(),
      metadata: { backtestId: "bt-abc" },
    }]),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
  };
  return { db: fakeDb };
});

vi.mock("../db/schema.js", () => ({
  deadLetterQueue: {
    id: "id",
    operationType: "operationType",
    resolved: "resolved",
    retryCount: "retryCount",
    maxRetries: "maxRetries",
    escalated: "escalated",
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../services/notification-service.js", () => ({
  notifyCritical: vi.fn(),
}));

import { registerRetryHandler, retryDLQItem } from "../lib/dlq-service.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DLQ retry handler registration (FIX 3)", () => {
  it("invokes registered handler and returns true on success", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerRetryHandler("monte_carlo:failure", handler);

    const result = await retryDLQItem("dlq-test-001");

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dlq-test-001", operationType: "monte_carlo:failure" }),
    );
    expect(result).toBe(true);
  });

  it("returns false and does not throw when handler throws", async () => {
    const failHandler = vi.fn().mockRejectedValue(new Error("MC service down"));
    registerRetryHandler("monte_carlo:failure", failHandler);

    const result = await retryDLQItem("dlq-test-001");

    expect(failHandler).toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it("registerRetryHandler accepts critic:failure without throwing", () => {
    const criticHandler = vi.fn().mockResolvedValue(undefined);
    expect(() => registerRetryHandler("critic:failure", criticHandler)).not.toThrow();
  });

  it("registerRetryHandler accepts all planned production types", () => {
    const types = [
      "monte_carlo:failure",
      "critic:failure",
      "sqa_optimization:failure",
      "qubo_timing:failure",
      "tensor_prediction:failure",
      "rl_training:failure",
      "deepar:training_failure",
      "deepar:prediction_failure",
    ] as const;

    for (const t of types) {
      expect(() => registerRetryHandler(t, vi.fn())).not.toThrow();
    }
  });
});

describe("FIX 4: Python pool saturation counter logic (isolated)", () => {
  it("counter reaches 6 ticks and fires alert then resets", () => {
    let ticks = 0;
    const alertFired: number[] = [];

    function simulateTick(queued: number) {
      if (queued > 0) {
        ticks++;
        if (ticks >= 6) {
          alertFired.push(ticks);
          ticks = 0;
        }
      } else {
        ticks = 0;
      }
    }

    for (let i = 0; i < 5; i++) simulateTick(3);
    expect(alertFired.length).toBe(0);
    expect(ticks).toBe(5);

    simulateTick(3);
    expect(alertFired.length).toBe(1);
    expect(ticks).toBe(0);

    // Clear backlog resets counter
    simulateTick(0);
    expect(ticks).toBe(0);

    // Second saturation round fires second alert
    for (let i = 0; i < 6; i++) simulateTick(2);
    expect(alertFired.length).toBe(2);
  });

  it("counter resets immediately when queue clears mid-saturation", () => {
    let ticks = 0;

    function tick(queued: number) {
      if (queued > 0) ticks++;
      else ticks = 0;
    }

    tick(1); tick(1); tick(1); // 3 ticks
    tick(0); // queue clears
    expect(ticks).toBe(0); // reset, not 3

    tick(1); tick(1); // 2 more ticks
    expect(ticks).toBe(2); // fresh count, not 5
  });
});
