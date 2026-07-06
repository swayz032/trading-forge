/**
 * Circuit Breaker — multi-subscriber onStateChange regression tests
 * (deep-scan #21 HIGH fix, 2026-07-05)
 *
 * CERTIFIED FINDING: `CircuitBreakerRegistry.setOnStateChange()` used to be
 * single-callback ("last call wins"). broker-router.ts registers a
 * TradersPost-specific handler (Discord "orders safely blocked" alert +
 * `broadcastSSE("broker:degraded", ...)` + CLOSE-recovery log) at module
 * load. index.ts registers a GENERIC `AlertFactory.circuitOpen(name)`
 * handler in its own top-level body, which — per ES module execution order —
 * runs AFTER its imports resolve, silently OVERWRITING the broker-router
 * handler. Net effect: only the generic "Circuit breaker OPEN: <name>" alert
 * ever fired; the TradersPost-specific alert + SSE + CLOSE-recovery signal
 * were dead on every boot.
 *
 * These tests prove the fix: `setOnStateChange` now APPENDS to an internal
 * list, and `_notifyStateChange` invokes every registered callback on both
 * OPEN and CLOSE transitions — with one throwing callback never preventing
 * the others from running.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CircuitBreaker, CircuitBreakerRegistry } from "../lib/circuit-breaker.js";

describe("CircuitBreakerRegistry — multi-subscriber onStateChange", () => {
  beforeEach(() => {
    CircuitBreakerRegistry._resetForTests();
  });

  afterEach(() => {
    CircuitBreakerRegistry._resetForTests();
  });

  it("invokes BOTH registered callbacks on an OPEN transition (regression: previously only the LAST registered callback fired)", async () => {
    const spyA = vi.fn(); // e.g. stands in for broker-router.ts's TradersPost-specific handler
    const spyB = vi.fn(); // e.g. stands in for index.ts's generic AlertFactory handler

    CircuitBreakerRegistry.setOnStateChange(spyA);
    CircuitBreakerRegistry.setOnStateChange(spyB);

    const cb = CircuitBreakerRegistry.get("multi-sub-open-test", {
      failureThreshold: 1,
      cooldownMs: 50,
    });

    const failFn = async () => {
      throw new Error("boom");
    };

    await expect(cb.call(failFn)).rejects.toThrow("boom");
    expect(cb.currentState).toBe("OPEN");

    // Both callbacks must have observed the CLOSED -> OPEN transition.
    expect(spyA).toHaveBeenCalledTimes(1);
    expect(spyA).toHaveBeenCalledWith("multi-sub-open-test", "CLOSED", "OPEN");
    expect(spyB).toHaveBeenCalledTimes(1);
    expect(spyB).toHaveBeenCalledWith("multi-sub-open-test", "CLOSED", "OPEN");
  });

  it("invokes BOTH registered callbacks on a CLOSE transition (probe success after cooldown)", async () => {
    const spyA = vi.fn();
    const spyB = vi.fn();

    CircuitBreakerRegistry.setOnStateChange(spyA);
    CircuitBreakerRegistry.setOnStateChange(spyB);

    const cb = CircuitBreakerRegistry.get("multi-sub-close-test", {
      failureThreshold: 1,
      cooldownMs: 30,
    });

    const failFn = async () => {
      throw new Error("boom");
    };

    // Trip the breaker OPEN.
    await expect(cb.call(failFn)).rejects.toThrow("boom");
    expect(cb.currentState).toBe("OPEN");
    spyA.mockClear();
    spyB.mockClear();

    // Wait past cooldown so the next call() probes HALF_OPEN, then succeeds -> CLOSED.
    await new Promise((r) => setTimeout(r, 60));
    const probeResult = await cb.call(async () => "probe-ok");
    expect(probeResult).toBe("probe-ok");
    expect(cb.currentState).toBe("CLOSED");

    // Both callbacks must have observed the HALF_OPEN -> CLOSED transition.
    // (checkTransitionToHalfOpen also fires an OPEN -> HALF_OPEN notification
    // first, so we assert the CLOSED call specifically happened for each spy.)
    expect(spyA).toHaveBeenCalledWith("multi-sub-close-test", "HALF_OPEN", "CLOSED");
    expect(spyB).toHaveBeenCalledWith("multi-sub-close-test", "HALF_OPEN", "CLOSED");
  });

  it("a throwing callback does not prevent other registered callbacks from firing", async () => {
    const throwingCallback = vi.fn(() => {
      throw new Error("subscriber blew up");
    });
    const healthySpy = vi.fn();

    // Register the throwing callback FIRST so we prove iteration continues past it.
    CircuitBreakerRegistry.setOnStateChange(throwingCallback);
    CircuitBreakerRegistry.setOnStateChange(healthySpy);

    const cb = CircuitBreakerRegistry.get("multi-sub-throw-test", {
      failureThreshold: 1,
      cooldownMs: 50,
    });

    const failFn = async () => {
      throw new Error("boom");
    };

    // The breaker call itself must not throw due to a bad subscriber.
    await expect(cb.call(failFn)).rejects.toThrow("boom");
    expect(cb.currentState).toBe("OPEN");

    expect(throwingCallback).toHaveBeenCalledTimes(1);
    expect(healthySpy).toHaveBeenCalledTimes(1);
    expect(healthySpy).toHaveBeenCalledWith("multi-sub-throw-test", "CLOSED", "OPEN");
  });

  it("only notifies callbacks for the endpoint that actually transitioned (name-scoped assertion still holds under multi-subscriber fan-out)", async () => {
    const spy = vi.fn();
    CircuitBreakerRegistry.setOnStateChange(spy);

    const cbA = CircuitBreakerRegistry.get("endpoint-a", { failureThreshold: 1, cooldownMs: 50 });
    CircuitBreakerRegistry.get("endpoint-b", { failureThreshold: 1, cooldownMs: 50 });

    const failFn = async () => {
      throw new Error("boom");
    };
    await expect(cbA.call(failFn)).rejects.toThrow("boom");

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("endpoint-a", "CLOSED", "OPEN");
  });

  it("_resetForTests clears all registered callbacks (no leakage across tests)", async () => {
    const spy = vi.fn();
    CircuitBreakerRegistry.setOnStateChange(spy);

    CircuitBreakerRegistry._resetForTests();

    const cb = CircuitBreakerRegistry.get("post-reset-endpoint", { failureThreshold: 1, cooldownMs: 50 });
    const failFn = async () => {
      throw new Error("boom");
    };
    await expect(cb.call(failFn)).rejects.toThrow("boom");

    expect(spy).not.toHaveBeenCalled();
  });
});
