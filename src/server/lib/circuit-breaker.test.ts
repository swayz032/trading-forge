/**
 * Circuit Breaker — unit tests
 *
 * Verifies:
 * - CLOSED → OPEN after failureThreshold consecutive failures
 * - OPEN state rejects requests immediately (CircuitOpenError)
 * - OPEN → HALF_OPEN after cooldown elapses
 * - HALF_OPEN → CLOSED on probe success
 * - HALF_OPEN → OPEN on probe failure (cooldown resets)
 * - Success in CLOSED resets consecutive failure count
 * - CircuitBreakerRegistry returns same instance per endpoint key
 * - statusAll() returns correct snapshots
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { CircuitBreaker, CircuitBreakerRegistry, CircuitOpenError } from "./circuit-breaker.js";

// Mock logger to suppress output in tests
vi.mock("../index.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("CircuitBreaker", () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker("test-endpoint", { failureThreshold: 3, cooldownMs: 500 });
  });

  it("starts in CLOSED state", () => {
    expect(cb.currentState).toBe("CLOSED");
  });

  it("passes through successful calls in CLOSED state", async () => {
    const result = await cb.call(async () => "ok");
    expect(result).toBe("ok");
    expect(cb.currentState).toBe("CLOSED");
  });

  it("counts failures but stays CLOSED below threshold", async () => {
    const failFn = async () => { throw new Error("fail"); };

    await expect(cb.call(failFn)).rejects.toThrow("fail");
    await expect(cb.call(failFn)).rejects.toThrow("fail");
    expect(cb.currentState).toBe("CLOSED");
  });

  it("opens circuit after failureThreshold consecutive failures", async () => {
    const failFn = async () => { throw new Error("fail"); };

    await expect(cb.call(failFn)).rejects.toThrow("fail");
    await expect(cb.call(failFn)).rejects.toThrow("fail");
    await expect(cb.call(failFn)).rejects.toThrow("fail");

    expect(cb.currentState).toBe("OPEN");
  });

  it("rejects immediately with CircuitOpenError when OPEN", async () => {
    const failFn = async () => { throw new Error("fail"); };

    // Trip the circuit
    for (let i = 0; i < 3; i++) {
      await expect(cb.call(failFn)).rejects.toThrow("fail");
    }

    expect(cb.currentState).toBe("OPEN");

    // Next call should be rejected without invoking fn
    let fnCalled = false;
    await expect(
      cb.call(async () => { fnCalled = true; return "should not run"; })
    ).rejects.toBeInstanceOf(CircuitOpenError);

    expect(fnCalled).toBe(false);
  });

  it("transitions to HALF_OPEN after cooldown elapses", async () => {
    const failFn = async () => { throw new Error("fail"); };

    // Trip the circuit
    for (let i = 0; i < 3; i++) {
      await expect(cb.call(failFn)).rejects.toThrow("fail");
    }
    expect(cb.currentState).toBe("OPEN");

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 600));

    // Next call attempt should transition to HALF_OPEN and execute the probe
    const probeResult = await cb.call(async () => "probe-ok");
    expect(probeResult).toBe("probe-ok");
    expect(cb.currentState).toBe("CLOSED");
  });

  it("re-opens on probe failure in HALF_OPEN", async () => {
    const failFn = async () => { throw new Error("fail"); };

    // Trip the circuit
    for (let i = 0; i < 3; i++) {
      await expect(cb.call(failFn)).rejects.toThrow("fail");
    }
    expect(cb.currentState).toBe("OPEN");

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 600));

    // Probe fails — should re-open
    await expect(cb.call(failFn)).rejects.toThrow("fail");
    expect(cb.currentState).toBe("OPEN");
  });

  it("resets consecutive failure count on success", async () => {
    const failFn = async () => { throw new Error("fail"); };

    // Two failures — below threshold
    await expect(cb.call(failFn)).rejects.toThrow("fail");
    await expect(cb.call(failFn)).rejects.toThrow("fail");
    expect(cb.currentState).toBe("CLOSED");

    // One success — resets the counter
    await cb.call(async () => "ok");
    expect(cb.currentState).toBe("CLOSED");

    // Two more failures — still below threshold (counter was reset)
    await expect(cb.call(failFn)).rejects.toThrow("fail");
    await expect(cb.call(failFn)).rejects.toThrow("fail");
    expect(cb.currentState).toBe("CLOSED");
  });

  it("status() reflects state correctly", async () => {
    const s1 = cb.status();
    expect(s1.state).toBe("CLOSED");
    expect(s1.openedAt).toBeNull();
    expect(s1.reopensAt).toBeNull();
    expect(s1.consecutiveFailures).toBe(0);

    const failFn = async () => { throw new Error("fail"); };
    for (let i = 0; i < 3; i++) {
      await expect(cb.call(failFn)).rejects.toThrow("fail");
    }

    const s2 = cb.status();
    expect(s2.state).toBe("OPEN");
    expect(s2.openedAt).not.toBeNull();
    expect(s2.reopensAt).not.toBeNull();
    // reopensAt should be ~500ms after openedAt
    const openedMs = new Date(s2.openedAt!).getTime();
    const reopensMs = new Date(s2.reopensAt!).getTime();
    expect(reopensMs - openedMs).toBeCloseTo(500, -2);
  });
});

describe("CircuitOpenError", () => {
  it("has correct name, endpoint, openedAt, and reopensAt", () => {
    const openedAt = new Date("2026-01-01T00:00:00Z");
    const err = new CircuitOpenError("my-service", openedAt, 30_000);

    expect(err.name).toBe("CircuitOpenError");
    expect(err.endpoint).toBe("my-service");
    expect(err.openedAt).toBe(openedAt);
    expect(err.reopensAt.getTime()).toBe(openedAt.getTime() + 30_000);
    expect(err.message).toContain("my-service");
  });
});

describe("CircuitBreakerRegistry", () => {
  beforeEach(() => {
    CircuitBreakerRegistry._resetForTests();
  });

  afterEach(() => {
    CircuitBreakerRegistry._resetForTests();
  });

  it("returns the same instance for the same endpoint key", () => {
    const a = CircuitBreakerRegistry.get("ollama");
    const b = CircuitBreakerRegistry.get("ollama");
    expect(a).toBe(b);
  });

  it("returns different instances for different endpoint keys", () => {
    const a = CircuitBreakerRegistry.get("ollama");
    const b = CircuitBreakerRegistry.get("openai");
    expect(a).not.toBe(b);
  });

  it("statusAll returns one entry per registered endpoint", () => {
    CircuitBreakerRegistry.get("ollama");
    CircuitBreakerRegistry.get("openai");
    const statuses = CircuitBreakerRegistry.statusAll();
    const endpoints = statuses.map((s) => s.endpoint);
    expect(endpoints).toContain("ollama");
    expect(endpoints).toContain("openai");
    expect(statuses).toHaveLength(2);
  });

  it("uses provided options on first registration", () => {
    const cb = CircuitBreakerRegistry.get("custom-ep", { failureThreshold: 1, cooldownMs: 100 });
    expect(cb.endpoint).toBe("custom-ep");
  });
});
