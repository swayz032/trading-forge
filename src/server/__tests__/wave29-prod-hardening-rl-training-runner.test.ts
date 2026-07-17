/**
 * wave29-prod-hardening-rl-training-runner.test.ts
 *
 * Wave 29 Production Hardening — RL Training Runner broader test surface.
 *
 * Covers: off-RTH guard windows, circuit breaker open/reset/cooldown,
 * timeout SIGKILL path, audit emission shape on enqueue and failure,
 * seed field in audit payload.
 *
 * Does NOT re-test seed derivation (covered in
 * wave29-prod-hardening-rl-training-runner-seed.test.ts).
 *
 * Authority boundary: no lifecycle service, paper-signal-service, or
 * order-routing service is imported. Challenger isolation preserved.
 *
 * Mocking strategy:
 *   - spawn is mocked via vi.mock("child_process") at the module level
 *   - vi.useFakeTimers() for timeout/cooldown assertions
 *   - _resetRlCircuitBreakerForTests() between each test (beforeEach)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Mock child_process before any import of the module under test ────────────
vi.mock("child_process", () => {
  const EventEmitter = require("events");
  const mockProc = new EventEmitter();
  mockProc.stdout = new EventEmitter();
  mockProc.stderr = new EventEmitter();
  mockProc.kill = vi.fn();
  return {
    spawn: vi.fn(() => mockProc),
    __mockProc: mockProc,
  };
});

vi.mock("fs", () => ({
  existsSync: vi.fn(() => false),
}));

// goalscan-r2 (2026-07-17, independent-grader finding, root-caused): 8-10 tests
// in this file TIMED OUT whenever DATABASE_URL pointed at the remote Railway DB.
// NOT latency — a 30s timeout bump was tried and refuted (they hang, they are
// not slow): the fake-timer groups (`vi.useFakeTimers`) freeze the postgres
// driver's internal timers, so the runner's awaited DB calls (pending-row
// insert, breaker-state init/persist) never resolve. Confirmed PRE-EXISTING at
// base 24664dc3 (same failures). Class fix: this UNIT test file mocks the DB
// like it already mocks child_process and fs — a self-returning chainable
// thenable stands in for drizzle's fluent API, every call resolves immediately
// with []. _initRlBreakerStateFromDb() reads [] → safe defaults; audit/run-row
// writes are fire-and-forget .catch() chains that resolve instantly.
vi.mock("../db/index.js", () => {
  const makeChain = (): any => {
    const p: any = Promise.resolve([]);
    for (const m of [
      "values", "set", "where", "from", "limit", "orderBy", "returning",
      "onConflictDoUpdate", "onConflictDoNothing", "leftJoin", "innerJoin", "groupBy",
    ]) {
      p[m] = () => makeChain();
    }
    return p;
  };
  return {
    db: {
      insert: () => makeChain(),
      update: () => makeChain(),
      select: () => makeChain(),
      delete: () => makeChain(),
      execute: async () => ({ rows: [] }),
    },
  };
});

// ── Import after mock registration ─────────────────────────────────────────────
import {
  isOffRthTrainingWindow,
  runRlTrainingForStrategy,
  _resetRlCircuitBreakerForTests,
  _getRlConsecutiveFailuresForTests,
  deriveRlTrainingSeed,
} from "../lib/quantum-rl-training-runner.js";

// Get a reference to the mock proc so we can fire events
import * as childProcessMock from "child_process";
const getMockProc = () => (childProcessMock as any).__mockProc;

// ── Helpers ────────────────────────────────────────────────────────────────────

/** ET hours that are OFF-RTH (training allowed): 6, 7, 8, 16, 17 */
const OFF_RTH_HOURS = [6, 7, 8, 16, 17];

/** ET hours that are IN-RTH (training blocked): 9-15, 0-5, 18-23 */
const IN_RTH_HOURS = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 15, 18, 19, 20, 21, 22, 23];

/**
 * Freeze Intl.DateTimeFormat to return a specific ET hour string.
 * quantum-rl-training-runner uses new Date().toLocaleString("en-US", ...) internally.
 * We override Date.prototype.toLocaleString to return the right string.
 */
function freezeEtHour(hour: number): () => void {
  const original = Date.prototype.toLocaleString;
  const hourStr = hour === 0 ? "24" : String(hour); // some impls return "24" for midnight
  Date.prototype.toLocaleString = function (
    _locale?: string,
    _opts?: Intl.DateTimeFormatOptions,
  ): string {
    return hourStr;
  };
  return () => {
    Date.prototype.toLocaleString = original;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Group 1 — TestOffRthGuardWindow
// ═══════════════════════════════════════════════════════════════════════════════

describe("isOffRthTrainingWindow — ET-hour guard", () => {
  it.each(OFF_RTH_HOURS)(
    "returns true for ET hour %i (off-RTH — training allowed)",
    (hour) => {
      const restore = freezeEtHour(hour);
      try {
        expect(isOffRthTrainingWindow()).toBe(true);
      } finally {
        restore();
      }
    },
  );

  it.each(IN_RTH_HOURS)(
    "returns false for ET hour %i (in-RTH — training blocked)",
    (hour) => {
      const restore = freezeEtHour(hour);
      try {
        expect(isOffRthTrainingWindow()).toBe(false);
      } finally {
        restore();
      }
    },
  );

  it("returns false for ET hour 9 (core RTH open)", () => {
    const restore = freezeEtHour(9);
    try {
      expect(isOffRthTrainingWindow()).toBe(false);
    } finally {
      restore();
    }
  });

  it("returns true for ET hour 16 (post-market)", () => {
    const restore = freezeEtHour(16);
    try {
      expect(isOffRthTrainingWindow()).toBe(true);
    } finally {
      restore();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 2 — TestCircuitBreakerOpensAfterThreshold
// ═══════════════════════════════════════════════════════════════════════════════

describe("Circuit breaker — opens after consecutive failures", () => {
  beforeEach(() => {
    _resetRlCircuitBreakerForTests();
    vi.clearAllMocks();
  });

  it("returns circuit_open after 5 consecutive failures (default threshold)", async () => {
    // Force ET hour into off-RTH window so the guard doesn't block
    const restore = freezeEtHour(7);

    try {
      // Trigger 5 failures: spawn a proc that immediately emits close with code=1
      const mockSpawn = childProcessMock.spawn as ReturnType<typeof vi.fn>;

      // Helper: returns a proc that fires close(code) after microtask
      const makeFailProc = (code: number) => {
        const EventEmitter = require("events");
        const proc = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = vi.fn();
        // Emit after control returns to event loop
        setImmediate(() => proc.emit("close", code));
        return proc;
      };

      const THRESHOLD = 5;
      let circuitOpenResult: any = null;

      for (let i = 0; i < THRESHOLD; i++) {
        mockSpawn.mockImplementationOnce(() => makeFailProc(1));
        try {
          await runRlTrainingForStrategy(String(i + 1), 2, `corr-${i}`);
        } catch {
          // failures are expected to reject — count them
        }
      }

      // 6th attempt should return circuit_open
      const result = await runRlTrainingForStrategy("999", 2, "corr-open");
      circuitOpenResult = result;

      expect(circuitOpenResult.status).toBe("circuit_open");
    } finally {
      restore();
    }
  });

  it("consecutive failure count starts at 0 after reset", () => {
    _resetRlCircuitBreakerForTests();
    expect(_getRlConsecutiveFailuresForTests()).toBe(0);
  });

  it("failure count increments when runRlTrainingForStrategy rejects", async () => {
    const restore = freezeEtHour(7);
    try {
      const EventEmitter = require("events");
      const makeFailProc = () => {
        const proc = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = vi.fn();
        setImmediate(() => proc.emit("close", 1));
        return proc;
      };

      (childProcessMock.spawn as ReturnType<typeof vi.fn>).mockImplementationOnce(makeFailProc);

      try {
        await runRlTrainingForStrategy("42", 2);
      } catch {
        // expected
      }

      const count = _getRlConsecutiveFailuresForTests();
      expect(count).toBeGreaterThanOrEqual(1);
    } finally {
      restore();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 3 — TestCircuitBreakerCooldown
// ═══════════════════════════════════════════════════════════════════════════════

describe("Circuit breaker — cooldown resets breaker", () => {
  beforeEach(() => {
    _resetRlCircuitBreakerForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetRlCircuitBreakerForTests();
  });

  it("breaker is not open after manual reset (test hook works)", () => {
    _resetRlCircuitBreakerForTests();
    expect(_getRlConsecutiveFailuresForTests()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 4 — TestCircuitBreakerResetOnSuccess
// ═══════════════════════════════════════════════════════════════════════════════

describe("Circuit breaker — resets on success", () => {
  beforeEach(() => {
    _resetRlCircuitBreakerForTests();
    vi.clearAllMocks();
  });

  it("failure count returns to 0 after a successful run", async () => {
    const restore = freezeEtHour(7);
    try {
      const EventEmitter = require("events");

      // 2 failures then 1 success
      const makeFailProc = () => {
        const proc = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = vi.fn();
        setImmediate(() => proc.emit("close", 1));
        return proc;
      };

      const makeSuccessProc = () => {
        const proc = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = vi.fn();
        setImmediate(() => {
          proc.stdout.emit("data", Buffer.from('{"results":{"TRENDING":{}}}'));
          proc.emit("close", 0);
        });
        return proc;
      };

      const mockSpawn = childProcessMock.spawn as ReturnType<typeof vi.fn>;
      mockSpawn.mockImplementationOnce(makeFailProc);

      try {
        await runRlTrainingForStrategy("1", 2);
      } catch {
        // expected failure
      }

      expect(_getRlConsecutiveFailuresForTests()).toBeGreaterThanOrEqual(1);

      mockSpawn.mockImplementationOnce(makeSuccessProc);
      const result = await runRlTrainingForStrategy("1", 2);

      expect(result.status).toBe("completed");
      expect(_getRlConsecutiveFailuresForTests()).toBe(0);
    } finally {
      restore();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 4b — DEGRADED regime_grouping_failed (exit 3) — r2fix round-2 refinement
//
// Operator "aint quatum rl autopilot?" review: the false-green closure must NOT
// page the operator for a KNOWN, DEFERRED design gap (regime wiring). Exit 3 is
// a THIRD outcome — neither success (which would reset the breaker / re-open the
// false-green) nor failure (which would advance the breaker + Discord CRITICAL).
// ═══════════════════════════════════════════════════════════════════════════════

describe("Degraded exit 3 — regime_grouping_failed does NOT page or reset breaker", () => {
  beforeEach(() => {
    _resetRlCircuitBreakerForTests();
    vi.clearAllMocks();
  });

  const makeDegradedProc = () => {
    const EventEmitter = require("events");
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    setImmediate(() => {
      proc.stdout.emit(
        "data",
        Buffer.from(
          '{"regime_grouping_failed":true,"results":{},"grouping_failure_detail":{"status":"regime_grouping_failed","reason":"no institutional_regime key","n_bars":500}}',
        ),
      );
      proc.emit("close", 3);
    });
    return proc;
  };

  const makeFailProc = () => {
    const EventEmitter = require("events");
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    setImmediate(() => proc.emit("close", 1));
    return proc;
  };

  it("resolves with status 'degraded_regime_unwired' instead of rejecting", async () => {
    const restore = freezeEtHour(7);
    try {
      (childProcessMock.spawn as ReturnType<typeof vi.fn>).mockImplementationOnce(makeDegradedProc);
      const result = await runRlTrainingForStrategy("42", 2);
      expect(result.status).toBe("degraded_regime_unwired");
      expect(result.regimesTrained).toBe(0);
    } finally {
      restore();
    }
  });

  it("does NOT advance the circuit-breaker failure counter (no page)", async () => {
    const restore = freezeEtHour(7);
    try {
      // A degraded run from a clean breaker state must leave the counter at 0 —
      // it must not be treated as a failure (which would advance toward the
      // Discord-CRITICAL breaker-open threshold).
      (childProcessMock.spawn as ReturnType<typeof vi.fn>).mockImplementationOnce(makeDegradedProc);
      await runRlTrainingForStrategy("42", 2);
      expect(_getRlConsecutiveFailuresForTests()).toBe(0);
    } finally {
      restore();
    }
  });

  it("does NOT reset an existing failure count (no false-green success path)", async () => {
    const restore = freezeEtHour(7);
    try {
      const mockSpawn = childProcessMock.spawn as ReturnType<typeof vi.fn>;

      // 1 real failure first → counter ≥ 1
      mockSpawn.mockImplementationOnce(makeFailProc);
      try {
        await runRlTrainingForStrategy("42", 2);
      } catch {
        /* expected */
      }
      const afterFailure = _getRlConsecutiveFailuresForTests();
      expect(afterFailure).toBeGreaterThanOrEqual(1);

      // A degraded run must NOT call _recordRlSuccess (which would zero the
      // counter and reset the breaker — the exact false-green the r2fix closes).
      mockSpawn.mockImplementationOnce(makeDegradedProc);
      const result = await runRlTrainingForStrategy("42", 2);
      expect(result.status).toBe("degraded_regime_unwired");
      expect(_getRlConsecutiveFailuresForTests()).toBe(afterFailure);
    } finally {
      restore();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 5 — TestTimeoutSIGKILL
// ═══════════════════════════════════════════════════════════════════════════════

describe("Timeout — SIGKILL path", () => {
  beforeEach(() => {
    _resetRlCircuitBreakerForTests();
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetRlCircuitBreakerForTests();
  });

  it("calls proc.kill when subprocess never exits (timeout fires)", async () => {
    const restore = freezeEtHour(7);
    try {
      const EventEmitter = require("events");
      const neverExitsProc = new EventEmitter();
      neverExitsProc.stdout = new EventEmitter();
      neverExitsProc.stderr = new EventEmitter();
      neverExitsProc.kill = vi.fn();

      (childProcessMock.spawn as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () => neverExitsProc,
      );

      // Set a very short timeout via env
      const origTimeout = process.env.QUANTUM_RL_TRAINING_TIMEOUT_MS;
      process.env.QUANTUM_RL_TRAINING_TIMEOUT_MS = "100";

      const promise = runRlTrainingForStrategy("99", 2);
      // Attach the rejection handler BEFORE advancing timers — the timeout
      // reject fires mid-advance, and a late catch leaves a window where the
      // rejection is unhandled (vitest flags it as an Unhandled Error).
      const settled = promise.catch(() => { /* timeout rejects — expected */ });

      // goalscan-r2 fix (pre-existing base failure): the runner awaits several
      // microtasks (breaker-state init, pending-row insert) BEFORE registering
      // its timeout setTimeout. A synchronous advanceTimersByTime here ran
      // before that timer existed — nothing to advance, promise never settled,
      // test timed out. The Async variant flushes microtasks between ticks so
      // the runner reaches its setTimeout registration, then the timer fires.
      await vi.advanceTimersByTimeAsync(200);
      // Give the SIGKILL follow-up 2s its own setTimeout
      await vi.advanceTimersByTimeAsync(3000);

      await settled;

      expect(neverExitsProc.kill).toHaveBeenCalled();

      if (origTimeout !== undefined) {
        process.env.QUANTUM_RL_TRAINING_TIMEOUT_MS = origTimeout;
      } else {
        delete process.env.QUANTUM_RL_TRAINING_TIMEOUT_MS;
      }
    } finally {
      restore();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 6 — TestAuditEmitOnEnqueue
// ═══════════════════════════════════════════════════════════════════════════════

describe("Audit emission — successful enqueue", () => {
  beforeEach(() => {
    _resetRlCircuitBreakerForTests();
    vi.clearAllMocks();
  });

  it("successful run resolves with status=completed", async () => {
    const restore = freezeEtHour(7);
    try {
      const EventEmitter = require("events");
      const successProc = new EventEmitter();
      successProc.stdout = new EventEmitter();
      successProc.stderr = new EventEmitter();
      successProc.kill = vi.fn();

      setImmediate(() => {
        successProc.stdout.emit(
          "data",
          Buffer.from(JSON.stringify({ results: { TRENDING: {}, RANGE_BOUND: {} } })),
        );
        successProc.emit("close", 0);
      });

      (childProcessMock.spawn as ReturnType<typeof vi.fn>).mockImplementationOnce(() => successProc);

      const result = await runRlTrainingForStrategy("42", 2);
      expect(result.status).toBe("completed");
      expect(result.regimesTrained).toBe(2);
    } finally {
      restore();
    }
  });

  it("successful run includes durationMs", async () => {
    const restore = freezeEtHour(7);
    try {
      const EventEmitter = require("events");
      const successProc = new EventEmitter();
      successProc.stdout = new EventEmitter();
      successProc.stderr = new EventEmitter();
      successProc.kill = vi.fn();

      setImmediate(() => {
        successProc.stdout.emit("data", Buffer.from("{}"));
        successProc.emit("close", 0);
      });

      (childProcessMock.spawn as ReturnType<typeof vi.fn>).mockImplementationOnce(() => successProc);

      const result = await runRlTrainingForStrategy("42", 2);
      expect(typeof result.durationMs).toBe("number");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      restore();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 7 — TestAuditEmitOnFailure
// ═══════════════════════════════════════════════════════════════════════════════

describe("Audit emission — subprocess failure", () => {
  beforeEach(() => {
    _resetRlCircuitBreakerForTests();
    vi.clearAllMocks();
  });

  it("non-zero exit code rejects the promise", async () => {
    const restore = freezeEtHour(7);
    try {
      const EventEmitter = require("events");
      const failProc = new EventEmitter();
      failProc.stdout = new EventEmitter();
      failProc.stderr = new EventEmitter();
      failProc.kill = vi.fn();

      setImmediate(() => {
        failProc.stderr.emit("data", Buffer.from("Training failed: out of memory"));
        failProc.emit("close", 1);
      });

      (childProcessMock.spawn as ReturnType<typeof vi.fn>).mockImplementationOnce(() => failProc);

      await expect(runRlTrainingForStrategy("55", 2)).rejects.toThrow();
    } finally {
      restore();
    }
  });

  it("exit code != 0 increments consecutive failure count", async () => {
    const restore = freezeEtHour(7);
    try {
      const countBefore = _getRlConsecutiveFailuresForTests();

      const EventEmitter = require("events");
      const failProc = new EventEmitter();
      failProc.stdout = new EventEmitter();
      failProc.stderr = new EventEmitter();
      failProc.kill = vi.fn();

      setImmediate(() => failProc.emit("close", 2));

      (childProcessMock.spawn as ReturnType<typeof vi.fn>).mockImplementationOnce(() => failProc);

      try {
        await runRlTrainingForStrategy("56", 2);
      } catch {
        // expected
      }

      expect(_getRlConsecutiveFailuresForTests()).toBeGreaterThan(countBefore);
    } finally {
      restore();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 8 — TestSeedFieldInAuditPayload
// ═══════════════════════════════════════════════════════════════════════════════

describe("Seed field — regression anchor for seed plumbing", () => {
  it("deriveRlTrainingSeed produces non-zero seed for strategy_id=42", () => {
    const seed = deriveRlTrainingSeed(42);
    expect(seed).toBeGreaterThan(0);
  });

  it("seed is deterministic: same strategyId always yields same seed", () => {
    const s1 = deriveRlTrainingSeed(123);
    const s2 = deriveRlTrainingSeed(123);
    expect(s1).toBe(s2);
  });

  it("spawn args include --seed flag with the derived seed value", async () => {
    _resetRlCircuitBreakerForTests();
    const restore = freezeEtHour(7);
    try {
      const EventEmitter = require("events");
      const successProc = new EventEmitter();
      successProc.stdout = new EventEmitter();
      successProc.stderr = new EventEmitter();
      successProc.kill = vi.fn();

      setImmediate(() => {
        successProc.stdout.emit("data", Buffer.from("{}"));
        successProc.emit("close", 0);
      });

      const mockSpawn = childProcessMock.spawn as ReturnType<typeof vi.fn>;
      // Clear call history so mock.calls[0] is reliably this test's call
      mockSpawn.mockClear();
      mockSpawn.mockImplementationOnce(() => successProc);

      const strategyId = "42";
      await runRlTrainingForStrategy(strategyId, 2);

      // Verify spawn was called with --seed in args
      expect(mockSpawn).toHaveBeenCalled();
      const spawnArgs: string[] = mockSpawn.mock.calls[0][1] as string[];
      const seedIdx = spawnArgs.indexOf("--seed");
      expect(seedIdx).toBeGreaterThan(-1);

      const seedValue = spawnArgs[seedIdx + 1];
      const expectedSeed = String(deriveRlTrainingSeed(strategyId));
      expect(seedValue).toBe(expectedSeed);
    } finally {
      restore();
    }
  });

  it("spawn args include --strategy-id matching the input strategyId", async () => {
    _resetRlCircuitBreakerForTests();
    const restore = freezeEtHour(7);
    try {
      const EventEmitter = require("events");
      const successProc = new EventEmitter();
      successProc.stdout = new EventEmitter();
      successProc.stderr = new EventEmitter();
      successProc.kill = vi.fn();

      setImmediate(() => {
        successProc.stdout.emit("data", Buffer.from("{}"));
        successProc.emit("close", 0);
      });

      const mockSpawn = childProcessMock.spawn as ReturnType<typeof vi.fn>;
      // Clear call history so mock.calls[0] is reliably this test's call
      mockSpawn.mockClear();
      mockSpawn.mockImplementationOnce(() => successProc);

      await runRlTrainingForStrategy("77", 2);

      const spawnArgs: string[] = mockSpawn.mock.calls[0][1] as string[];
      const sidIdx = spawnArgs.indexOf("--strategy-id");
      expect(sidIdx).toBeGreaterThan(-1);
      expect(spawnArgs[sidIdx + 1]).toBe("77");
    } finally {
      restore();
    }
  });

  it("skipped_rth result returned during RTH hours (no spawn)", async () => {
    // During RTH, no process should be spawned
    const restore = freezeEtHour(10); // core RTH hour
    try {
      const mockSpawn = childProcessMock.spawn as ReturnType<typeof vi.fn>;
      mockSpawn.mockClear();

      const result = await runRlTrainingForStrategy("33", 2);
      expect(result.status).toBe("skipped_rth");
      expect(mockSpawn).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});
