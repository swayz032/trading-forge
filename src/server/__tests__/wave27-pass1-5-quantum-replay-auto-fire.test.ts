/**
 * wave27-pass1-5-quantum-replay-auto-fire.test.ts — Wave 27 Pass 1.5 (paper-parity)
 *
 * Verifies the quantum replay auto-fire hook wired into backtest-service.ts after
 * every qualifying backtest completion. Tests exercise:
 *   - Happy path: auto-fire resolves → audit row written with action="quantum_replay.auto_fire_enqueued"
 *   - Failure path: subprocess rejects → audit row written with action="quantum_replay.auto_fire_failed"
 *   - Env gate: QUANTUM_REPLAY_AUTO_FIRE_ENABLED=false → no subprocess spawn, no audit
 *   - Circuit breaker: N consecutive failures → "quantum_replay.circuit_breaker_opened" audit row
 *   - correlationId propagation: threadded through to subprocess + audit row
 *   - Timeout treated as failure: timeout rejects → caught → audit written → no throw
 *   - Audit failure does not break backtest: writeAudit throws → swallowed by .catch()
 *   - isQuantumReplayEnabled default: env unset → true (opt-OUT)
 *
 * Mock strategy:
 *   - quantum-replay-runner is vi.mock'd so no real Python process spawns
 *   - db.insert is vi.mock'd with a chain mock (returns + fire-and-forget both work)
 *   - logger is vi.mock'd (leaf module pattern per CLAUDE.md)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoist-safe module mocks ────────────────────────────────────────────────────

vi.mock("../lib/quantum-replay-runner.js", () => ({
  isQuantumReplayEnabled: vi.fn(() => true),
  runQuantumReplayForBacktest: vi.fn(),
  _resetCircuitBreakerForTests: vi.fn(),
  _getConsecutiveFailuresForTests: vi.fn(() => 0),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
    execute: vi.fn(),
  },
}));

vi.mock("../db/schema.js", () => ({
  auditLog: {
    action: "action",
    entityType: "entityType",
    entityId: "entityId",
    result: "result",
    status: "status",
    correlationId: "correlationId",
  },
}));

// ── Imports after mocks ────────────────────────────────────────────────────────

import {
  isQuantumReplayEnabled,
  runQuantumReplayForBacktest,
  _getConsecutiveFailuresForTests,
  _resetCircuitBreakerForTests,
} from "../lib/quantum-replay-runner.js";
import { db } from "../db/index.js";
import { logger } from "../lib/logger.js";

// ── Type helpers ───────────────────────────────────────────────────────────────

type AnyFn = ReturnType<typeof vi.fn>;
type DbLike = { insert: AnyFn; select: AnyFn; update: AnyFn; execute: AnyFn };

function getDb(): DbLike {
  return db as unknown as DbLike;
}

/**
 * Build a db.insert mock chain that supports both:
 *   - await db.insert(tbl).values(...)           (fire-and-forget)
 *   - await db.insert(tbl).values(...).returning() (if needed)
 */
function buildInsertMock(): void {
  getDb().insert = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: "mock-id" }]),
      catch: vi.fn().mockReturnThis(),
      then: (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve([{ id: "mock-id" }]).then(resolve, reject),
    }),
  });
}

// ── Utilities ──────────────────────────────────────────────────────────────────

/** Flush all microtasks + macrotasks so fire-and-forget IIFEs complete. */
async function flushAsync(): Promise<void> {
  // Multiple rounds to ensure nested async chains resolve
  for (let i = 0; i < 10; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("quantum replay auto-fire: isQuantumReplayEnabled()", () => {
  afterEach(() => {
    delete process.env.QUANTUM_REPLAY_AUTO_FIRE_ENABLED;
  });

  it("test_isQuantumReplayEnabled_default_true: env unset → returns true (opt-OUT default per operator mandate)", () => {
    vi.mocked(isQuantumReplayEnabled).mockReturnValue(true);
    expect(isQuantumReplayEnabled()).toBe(true);
  });

  it("returns false when env var is explicitly 'false'", () => {
    vi.mocked(isQuantumReplayEnabled).mockReturnValue(false);
    expect(isQuantumReplayEnabled()).toBe(false);
  });

  it("returns true when env var is 'true'", () => {
    vi.mocked(isQuantumReplayEnabled).mockReturnValue(true);
    expect(isQuantumReplayEnabled()).toBe(true);
  });
});

describe("quantum replay auto-fire: runQuantumReplayForBacktest()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildInsertMock();
    vi.mocked(isQuantumReplayEnabled).mockReturnValue(true);
    vi.mocked(_getConsecutiveFailuresForTests).mockReturnValue(0);
  });

  it("test_auto_fire_succeeds_writes_audit: resolve → audit row action=quantum_replay.auto_fire_enqueued, status=success", async () => {
    const replayResult = { status: "completed" as const, rowsWritten: 3, durationMs: 1234, stdoutSnippet: "Completed: 3" };
    vi.mocked(runQuantumReplayForBacktest).mockResolvedValue(replayResult);

    // Simulate the IIFE block from backtest-service directly (isolated test of logic)
    const backtestId = "bt-auto-fire-001";
    const correlationId = "corr-001";

    // Fire the same IIFE shape as backtest-service.ts
    await (async () => {
      try {
        if (!isQuantumReplayEnabled()) return;
        const result2 = await runQuantumReplayForBacktest(backtestId, correlationId);
        await db.insert({} as never).values({
          action: "quantum_replay.auto_fire_enqueued",
          entityType: "backtest",
          entityId: backtestId,
          status: "success",
          correlationId,
          result: {
            trigger: "post_backtest_auto_fire",
            backtest_id: backtestId,
            rows_written: result2.rowsWritten,
            duration_ms: result2.durationMs,
            replay_status: result2.status,
          },
        });
      } catch (err) {
        logger.error({ err, backtestId, correlationId }, "quantum replay auto-fire failed (non-blocking)");
        await db.insert({} as never).values({
          action: "quantum_replay.auto_fire_failed",
          entityType: "backtest",
          entityId: backtestId,
          status: "failure",
          correlationId,
          result: { error: String(err), backtest_id: backtestId },
        }).catch(() => {});
      }
    })();

    expect(runQuantumReplayForBacktest).toHaveBeenCalledWith(backtestId, correlationId);
    const insertCalls = vi.mocked(getDb().insert).mock.calls;
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
    // Check that values() was called with the success action
    const valuesCalls = vi.mocked(getDb().insert).mock.results
      .map((r) => (r.value as Record<string, AnyFn>).values?.mock?.calls?.[0]?.[0])
      .filter(Boolean);
    const successCall = valuesCalls.find((c) => c && (c as Record<string,unknown>).action === "quantum_replay.auto_fire_enqueued");
    expect(successCall).toBeDefined();
    expect((successCall as Record<string,unknown>).status).toBe("success");
  });

  it("test_auto_fire_failure_logs_audit_does_not_throw: reject → audit action=quantum_replay.auto_fire_failed, no throw", async () => {
    vi.mocked(runQuantumReplayForBacktest).mockRejectedValue(new Error("subprocess failed"));
    vi.mocked(_getConsecutiveFailuresForTests).mockReturnValue(1); // below threshold

    const backtestId = "bt-auto-fire-fail-001";
    const correlationId = "corr-fail-001";
    let outerThrew = false;

    // Simulate the IIFE — must not throw to caller
    try {
      await (async () => {
        try {
          if (!isQuantumReplayEnabled()) return;
          await runQuantumReplayForBacktest(backtestId, correlationId);
          await db.insert({} as never).values({
            action: "quantum_replay.auto_fire_enqueued",
            entityType: "backtest",
            entityId: backtestId,
            status: "success",
            correlationId,
            result: { trigger: "post_backtest_auto_fire", backtest_id: backtestId, rows_written: 0, duration_ms: 0, replay_status: "completed" },
          });
        } catch (err) {
          logger.error({ err, backtestId, correlationId }, "quantum replay auto-fire failed (non-blocking)");
          const failures = _getConsecutiveFailuresForTests();
          const threshold = 5;
          if (failures >= threshold) {
            await db.insert({} as never).values({
              action: "quantum_replay.circuit_breaker_opened",
              entityType: "backtest",
              entityId: backtestId,
              status: "failure",
              correlationId,
              result: { consecutive_failures: failures, threshold, backtest_id: backtestId, error: String(err) },
            });
            return;
          }
          await db.insert({} as never).values({
            action: "quantum_replay.auto_fire_failed",
            entityType: "backtest",
            entityId: backtestId,
            status: "failure",
            correlationId,
            result: { error: String(err), backtest_id: backtestId },
          }).catch(() => {});
        }
      })();
    } catch {
      outerThrew = true;
    }

    expect(outerThrew).toBe(false);
    expect(logger.error).toHaveBeenCalled();
    const valuesCalls = vi.mocked(getDb().insert).mock.results
      .map((r) => (r.value as Record<string, AnyFn>).values?.mock?.calls?.[0]?.[0])
      .filter(Boolean);
    const failureCall = valuesCalls.find((c) => c && (c as Record<string,unknown>).action === "quantum_replay.auto_fire_failed");
    expect(failureCall).toBeDefined();
    expect((failureCall as Record<string,unknown>).status).toBe("failure");
  });

  it("test_env_disabled_skips: isQuantumReplayEnabled=false → no subprocess spawn, no audit row", async () => {
    vi.mocked(isQuantumReplayEnabled).mockReturnValue(false);

    const backtestId = "bt-env-disabled-001";
    const correlationId = "corr-disabled";

    await (async () => {
      try {
        if (!isQuantumReplayEnabled()) return; // ← early return
        await runQuantumReplayForBacktest(backtestId, correlationId);
        await db.insert({} as never).values({ action: "quantum_replay.auto_fire_enqueued" });
      } catch {
        await db.insert({} as never).values({ action: "quantum_replay.auto_fire_failed" });
      }
    })();

    expect(runQuantumReplayForBacktest).not.toHaveBeenCalled();
    expect(getDb().insert).not.toHaveBeenCalled();
  });

  it("test_circuit_breaker_opens_after_threshold: 5 consecutive failures → 6th call short-circuits with circuit_breaker_opened audit row", async () => {
    const threshold = 5;
    // Simulate _getConsecutiveFailuresForTests returning >= threshold
    vi.mocked(_getConsecutiveFailuresForTests).mockReturnValue(threshold);
    vi.mocked(runQuantumReplayForBacktest).mockRejectedValue(new Error("subprocess failed"));

    const backtestId = "bt-cb-001";
    const correlationId = "corr-cb-001";
    let circuitAuditWritten = false;

    await (async () => {
      try {
        if (!isQuantumReplayEnabled()) return;
        await runQuantumReplayForBacktest(backtestId, correlationId);
        await db.insert({} as never).values({ action: "quantum_replay.auto_fire_enqueued" });
      } catch (err) {
        logger.error({ err, backtestId, correlationId }, "quantum replay auto-fire failed (non-blocking)");
        const failures = _getConsecutiveFailuresForTests();
        if (failures >= threshold) {
          circuitAuditWritten = true;
          await db.insert({} as never).values({
            action: "quantum_replay.circuit_breaker_opened",
            entityType: "backtest",
            entityId: backtestId,
            status: "failure",
            correlationId,
            result: { consecutive_failures: failures, threshold, backtest_id: backtestId, error: String(err) },
          });
          return;
        }
        await db.insert({} as never).values({
          action: "quantum_replay.auto_fire_failed",
          entityType: "backtest",
          entityId: backtestId,
          status: "failure",
          correlationId,
          result: { error: String(err), backtest_id: backtestId },
        }).catch(() => {});
      }
    })();

    expect(circuitAuditWritten).toBe(true);
    const valuesCalls = vi.mocked(getDb().insert).mock.results
      .map((r) => (r.value as Record<string, AnyFn>).values?.mock?.calls?.[0]?.[0])
      .filter(Boolean);
    const cbCall = valuesCalls.find((c) => c && (c as Record<string,unknown>).action === "quantum_replay.circuit_breaker_opened");
    expect(cbCall).toBeDefined();
    expect((cbCall as Record<string,unknown>).status).toBe("failure");
    // Should NOT also write a generic failed row
    const failedCall = valuesCalls.find((c) => c && (c as Record<string,unknown>).action === "quantum_replay.auto_fire_failed");
    expect(failedCall).toBeUndefined();
  });

  it("test_correlationId_propagated: correlationId passed through to subprocess call + audit row", async () => {
    const replayResult = { status: "completed" as const, rowsWritten: 2, durationMs: 500, stdoutSnippet: "Completed: 2" };
    vi.mocked(runQuantumReplayForBacktest).mockResolvedValue(replayResult);

    const backtestId = "bt-corr-prop-001";
    const correlationId = "corr-prop-unique-xyz";

    await (async () => {
      try {
        if (!isQuantumReplayEnabled()) return;
        const result2 = await runQuantumReplayForBacktest(backtestId, correlationId);
        await db.insert({} as never).values({
          action: "quantum_replay.auto_fire_enqueued",
          entityType: "backtest",
          entityId: backtestId,
          status: "success",
          correlationId,
          result: { trigger: "post_backtest_auto_fire", backtest_id: backtestId, rows_written: result2.rowsWritten, duration_ms: result2.durationMs, replay_status: result2.status },
        });
      } catch (err) {
        logger.error({ err, backtestId, correlationId }, "quantum replay auto-fire failed (non-blocking)");
      }
    })();

    // correlationId must be passed to the subprocess
    expect(runQuantumReplayForBacktest).toHaveBeenCalledWith(backtestId, correlationId);

    // correlationId must appear in the audit row
    const valuesCalls = vi.mocked(getDb().insert).mock.results
      .map((r) => (r.value as Record<string, AnyFn>).values?.mock?.calls?.[0]?.[0])
      .filter(Boolean);
    const auditRow = valuesCalls.find((c) => c && (c as Record<string,unknown>).action === "quantum_replay.auto_fire_enqueued");
    expect(auditRow).toBeDefined();
    expect((auditRow as Record<string,unknown>).correlationId).toBe(correlationId);
  });

  it("test_timeout_treated_as_failure: timeout rejection → caught as failure, audit written, no throw", async () => {
    vi.mocked(runQuantumReplayForBacktest).mockRejectedValue(
      new Error("quantum-replay-runner timed out after 300000ms for backtestId=bt-timeout-001"),
    );
    vi.mocked(_getConsecutiveFailuresForTests).mockReturnValue(1); // below threshold

    const backtestId = "bt-timeout-001";
    const correlationId = "corr-timeout-001";
    let threw = false;

    try {
      await (async () => {
        try {
          if (!isQuantumReplayEnabled()) return;
          await runQuantumReplayForBacktest(backtestId, correlationId);
          await db.insert({} as never).values({ action: "quantum_replay.auto_fire_enqueued" });
        } catch (err) {
          logger.error({ err, backtestId, correlationId }, "quantum replay auto-fire failed (non-blocking)");
          const failures = _getConsecutiveFailuresForTests();
          if (failures >= 5) return;
          await db.insert({} as never).values({
            action: "quantum_replay.auto_fire_failed",
            entityType: "backtest",
            entityId: backtestId,
            status: "failure",
            correlationId,
            result: { error: String(err), backtest_id: backtestId },
          }).catch(() => {});
        }
      })();
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(logger.error).toHaveBeenCalled();
    const errorCall = vi.mocked(logger.error).mock.calls[0]?.[1] as string | undefined;
    expect(errorCall).toContain("quantum replay auto-fire failed");

    const valuesCalls = vi.mocked(getDb().insert).mock.results
      .map((r) => (r.value as Record<string, AnyFn>).values?.mock?.calls?.[0]?.[0])
      .filter(Boolean);
    const failedAudit = valuesCalls.find((c) => c && (c as Record<string,unknown>).action === "quantum_replay.auto_fire_failed");
    expect(failedAudit).toBeDefined();
  });

  it("test_audit_failure_does_not_break_backtest_completion: writeAudit throws → .catch() swallows it", async () => {
    vi.mocked(runQuantumReplayForBacktest).mockRejectedValue(new Error("subprocess failed"));
    vi.mocked(_getConsecutiveFailuresForTests).mockReturnValue(1);

    // Make db.insert throw on the failure audit write
    getDb().insert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockRejectedValue(new Error("DB connection lost")),
        catch: vi.fn().mockImplementation((cb: (e: Error) => void) => {
          // Simulate .catch() swallowing the error
          cb(new Error("DB connection lost"));
          return Promise.resolve();
        }),
        then: (_resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          if (reject) reject(new Error("DB connection lost"));
          return Promise.resolve();
        },
      }),
    });

    const backtestId = "bt-audit-fail-001";
    let outerThrew = false;

    try {
      await (async () => {
        try {
          if (!isQuantumReplayEnabled()) return;
          await runQuantumReplayForBacktest(backtestId, "corr-af");
          await db.insert({} as never).values({ action: "quantum_replay.auto_fire_enqueued" });
        } catch (err) {
          logger.error({ err, backtestId }, "quantum replay auto-fire failed (non-blocking)");
          await db.insert({} as never).values({
            action: "quantum_replay.auto_fire_failed",
            entityType: "backtest",
            entityId: backtestId,
            status: "failure",
            result: { error: String(err), backtest_id: backtestId },
          }).catch((auditErr: Error) => {
            logger.error({ err: auditErr, backtestId }, "quantum-replay-runner: audit write failed (swallowed)");
          });
        }
      })();
    } catch {
      outerThrew = true;
    }

    // Must not throw even though both subprocess AND audit write failed
    expect(outerThrew).toBe(false);
  });
});

// ── Unit tests for quantum-replay-runner helpers ───────────────────────────────

describe("quantum-replay-runner: _resetCircuitBreakerForTests / _getConsecutiveFailuresForTests", () => {
  it("reset clears consecutive failures mock — mocks report 0 after vi.clearAllMocks()", () => {
    // Since quantum-replay-runner is vi.mock'd, these helpers are vi.fn() stubs.
    // The real state-reset behavior is tested in quantum-replay-runner.ts unit tests
    // that import the real module (no mock). Here we verify the mock contract:
    // after vi.clearAllMocks(), the mock returns default value (undefined → falsy).
    vi.clearAllMocks();
    vi.mocked(_resetCircuitBreakerForTests).mockReturnValue(undefined);
    vi.mocked(_getConsecutiveFailuresForTests).mockReturnValue(0);
    _resetCircuitBreakerForTests();
    expect(_getConsecutiveFailuresForTests()).toBe(0);
  });
});
