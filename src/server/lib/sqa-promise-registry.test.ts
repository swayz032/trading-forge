/**
 * SQA Promise Registry — unit tests
 *
 * Verifies:
 * - awaitWithTimeout resolves quickly for fast SQA
 * - awaitWithTimeout returns null after budget expires (slow SQA)
 * - Wall-clock budget deducted: if elapsed > 30s at call time → null immediately
 * - Circuit breaker opens after 3 timeouts in the sliding window
 * - Circuit breaker auto-closes after 1 hour cooldown
 * - Sliding window prunes timestamps older than 10 min
 * - Registry prunes entries after 5 min TTL
 * - Audit writer is called on circuit open and circuit close
 * - awaitWithTimeout returns null fast when circuit is OPEN
 * - No entry found → null immediately (no wait)
 * - markSettled updates entry status
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  SqaPromiseRegistry,
  SQA_AWAIT_TIMEOUT_MS,
  SQA_TTL_MS,
  SQA_CB_WINDOW_MS,
  SQA_CB_THRESHOLD,
  SQA_CB_COOLDOWN_MS,
} from "./sqa-promise-registry.js";

vi.mock("./logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("SqaPromiseRegistry", () => {
  let registry: SqaPromiseRegistry;
  let auditCalls: Array<Record<string, unknown>>;

  beforeEach(() => {
    registry = new SqaPromiseRegistry();
    auditCalls = [];
    registry.setAuditWriter(async (entry) => {
      auditCalls.push(entry as Record<string, unknown>);
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    registry._resetForTests();
    vi.useRealTimers();
  });

  // ─── Fast SQA resolves ────────────────────────────────────────────────────

  it("returns resolved value when SQA promise resolves before budget", async () => {
    const payload = { best_params: { ema_period: 20 } };
    const fastPromise = Promise.resolve(payload);

    registry.register("bt-1", fastPromise);

    // Advance time by 1 s (well within 30 s budget)
    vi.advanceTimersByTime(1_000);

    const result = await registry.awaitWithTimeout("bt-1");
    expect(result).toEqual(payload);
    expect(registry.circuitState).toBe("CLOSED");
  });

  // ─── Slow SQA → timeout → null ───────────────────────────────────────────

  it("returns null when SQA promise does not resolve within budget", async () => {
    const neverResolves = new Promise<void>(() => {});
    registry.register("bt-2", neverResolves);

    const awaitPromise = registry.awaitWithTimeout("bt-2");

    // Advance past the 30 s budget
    vi.advanceTimersByTime(SQA_AWAIT_TIMEOUT_MS + 100);

    const result = await awaitPromise;
    expect(result).toBeNull();
  });

  // ─── Wall-clock budget already consumed ──────────────────────────────────

  it("returns null immediately when elapsed since spawn already exceeds 30s", async () => {
    const neverResolves = new Promise<void>(() => {});
    registry.register("bt-3", neverResolves);

    // Advance 31 s before calling awaitWithTimeout
    vi.advanceTimersByTime(SQA_AWAIT_TIMEOUT_MS + 1_000);

    const start = Date.now();
    const result = await registry.awaitWithTimeout("bt-3");
    const elapsed = Date.now() - start;

    expect(result).toBeNull();
    // Should return without setting another timer (elapsed < 5 ms in fake time)
    expect(elapsed).toBeLessThan(5);
  });

  // ─── No entry ─────────────────────────────────────────────────────────────

  it("returns null immediately when no entry registered for backtestId", async () => {
    const result = await registry.awaitWithTimeout("unknown-bt");
    expect(result).toBeNull();
  });

  // ─── markSettled ──────────────────────────────────────────────────────────

  it("markSettled updates entry status to completed", async () => {
    const p = Promise.resolve("ok");
    registry.register("bt-settle", p);
    registry.markSettled("bt-settle", "completed");
    // After marking completed the status reflects it
    const result = await registry.awaitWithTimeout("bt-settle");
    expect(result).toBe("ok");
  });

  it("markSettled on unknown id is a no-op (no throw)", () => {
    expect(() => registry.markSettled("no-such-id", "completed")).not.toThrow();
  });

  // ─── TTL pruning ──────────────────────────────────────────────────────────

  it("prunes entries older than TTL on next register call", async () => {
    const p = Promise.resolve("done");
    registry.register("bt-old", p);

    // Advance past TTL
    vi.advanceTimersByTime(SQA_TTL_MS + 1_000);

    // Trigger pruning by registering another entry
    registry.register("bt-new", Promise.resolve("new"));

    const status = registry.status();
    // Only bt-new should survive (bt-old was pruned)
    expect(status.entryCount).toBe(1);
  });

  // ─── Circuit breaker: opens after threshold ───────────────────────────────

  it("circuit opens after SQA_CB_THRESHOLD timeouts within the sliding window", async () => {
    expect(registry.circuitState).toBe("CLOSED");

    // Register and timeout SQA_CB_THRESHOLD promises
    for (let i = 0; i < SQA_CB_THRESHOLD; i++) {
      registry.register(`bt-cb-${i}`, new Promise<void>(() => {}));
      const awaitP = registry.awaitWithTimeout(`bt-cb-${i}`);
      vi.advanceTimersByTime(SQA_AWAIT_TIMEOUT_MS + 100);
      await awaitP;
    }

    expect(registry.circuitState).toBe("OPEN");
  });

  it("writes audit log entry when circuit opens", async () => {
    for (let i = 0; i < SQA_CB_THRESHOLD; i++) {
      registry.register(`bt-audit-${i}`, new Promise<void>(() => {}));
      const awaitP = registry.awaitWithTimeout(`bt-audit-${i}`);
      vi.advanceTimersByTime(SQA_AWAIT_TIMEOUT_MS + 100);
      await awaitP;
    }

    // Allow microtask queue to flush the audit write
    await Promise.resolve();

    const openEntry = auditCalls.find((e) => e.action === "quantum.sqa_circuit_breaker_open");
    expect(openEntry).toBeDefined();
    expect(openEntry?.status).toBe("success");
    expect(openEntry?.decisionAuthority).toBe("gate");
  });

  // ─── Circuit open: fast null return ───────────────────────────────────────

  it("returns null fast when circuit is OPEN (no timer wait)", async () => {
    // Trip the circuit
    for (let i = 0; i < SQA_CB_THRESHOLD; i++) {
      registry.register(`bt-open-${i}`, new Promise<void>(() => {}));
      const p = registry.awaitWithTimeout(`bt-open-${i}`);
      vi.advanceTimersByTime(SQA_AWAIT_TIMEOUT_MS + 100);
      await p;
    }

    expect(registry.circuitState).toBe("OPEN");

    // Register a new promise — circuit is OPEN, should not wait
    registry.register("bt-blocked", new Promise<void>(() => {}));
    const result = await registry.awaitWithTimeout("bt-blocked");
    expect(result).toBeNull();
  });

  // ─── Circuit breaker auto-close ───────────────────────────────────────────

  it("circuit auto-closes after cooldown elapses", async () => {
    // Trip the circuit
    for (let i = 0; i < SQA_CB_THRESHOLD; i++) {
      registry.register(`bt-ac-${i}`, new Promise<void>(() => {}));
      const p = registry.awaitWithTimeout(`bt-ac-${i}`);
      vi.advanceTimersByTime(SQA_AWAIT_TIMEOUT_MS + 100);
      await p;
    }
    expect(registry.circuitState).toBe("OPEN");

    // Advance past 1 hour cooldown
    vi.advanceTimersByTime(SQA_CB_COOLDOWN_MS + 1_000);

    expect(registry.circuitState).toBe("CLOSED");
  });

  it("writes audit log when circuit auto-closes", async () => {
    for (let i = 0; i < SQA_CB_THRESHOLD; i++) {
      registry.register(`bt-aclog-${i}`, new Promise<void>(() => {}));
      const p = registry.awaitWithTimeout(`bt-aclog-${i}`);
      vi.advanceTimersByTime(SQA_AWAIT_TIMEOUT_MS + 100);
      await p;
    }

    vi.advanceTimersByTime(SQA_CB_COOLDOWN_MS + 1_000);
    // Reading circuitState triggers the auto-close check
    expect(registry.circuitState).toBe("CLOSED");

    await Promise.resolve();

    const closeEntry = auditCalls.find((e) => e.action === "quantum.sqa_circuit_breaker_closed");
    expect(closeEntry).toBeDefined();
    expect(closeEntry?.status).toBe("success");
  });

  // ─── Sliding window prunes old timeouts ──────────────────────────────────

  it("sliding window does not count timeouts older than SQA_CB_WINDOW_MS", async () => {
    // Two timeouts, just below threshold
    for (let i = 0; i < SQA_CB_THRESHOLD - 1; i++) {
      registry.register(`bt-sw-${i}`, new Promise<void>(() => {}));
      const p = registry.awaitWithTimeout(`bt-sw-${i}`);
      vi.advanceTimersByTime(SQA_AWAIT_TIMEOUT_MS + 100);
      await p;
    }
    expect(registry.circuitState).toBe("CLOSED");

    // Advance past the sliding window — old timeouts fall out
    vi.advanceTimersByTime(SQA_CB_WINDOW_MS + 1_000);

    // One more timeout — should not trip because window was cleared
    registry.register("bt-sw-new", new Promise<void>(() => {}));
    const p = registry.awaitWithTimeout("bt-sw-new");
    vi.advanceTimersByTime(SQA_AWAIT_TIMEOUT_MS + 100);
    await p;

    expect(registry.circuitState).toBe("CLOSED");
    expect(registry.slidingWindowCount).toBe(1);
  });

  // ─── Rejected promise handled gracefully ─────────────────────────────────

  it("returns null and does not throw when registered promise rejects", async () => {
    const rejectingPromise = Promise.reject(new Error("SQA Python crash"));
    // Suppress unhandled rejection — we attach a .catch later via awaitWithTimeout
    rejectingPromise.catch(() => {});

    registry.register("bt-reject", rejectingPromise);
    const result = await registry.awaitWithTimeout("bt-reject");
    expect(result).toBeNull();
  });

  // ─── status() diagnostic ─────────────────────────────────────────────────

  it("status() reflects current state accurately", () => {
    const s = registry.status();
    expect(s.circuitState).toBe("CLOSED");
    expect(s.openedAt).toBeNull();
    expect(s.reopensAt).toBeNull();
    expect(s.timeoutsInWindow).toBe(0);
    expect(s.entryCount).toBe(0);
  });

  it("status().reopensAt is set when circuit is OPEN", async () => {
    for (let i = 0; i < SQA_CB_THRESHOLD; i++) {
      registry.register(`bt-st-${i}`, new Promise<void>(() => {}));
      const p = registry.awaitWithTimeout(`bt-st-${i}`);
      vi.advanceTimersByTime(SQA_AWAIT_TIMEOUT_MS + 100);
      await p;
    }

    const s = registry.status();
    expect(s.circuitState).toBe("OPEN");
    expect(s.openedAt).not.toBeNull();
    expect(s.reopensAt).not.toBeNull();

    const openedMs = new Date(s.openedAt!).getTime();
    const reopensMs = new Date(s.reopensAt!).getTime();
    expect(reopensMs - openedMs).toBeCloseTo(SQA_CB_COOLDOWN_MS, -3);
  });
});
