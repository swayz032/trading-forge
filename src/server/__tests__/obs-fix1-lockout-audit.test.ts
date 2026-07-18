/**
 * obs-fix1-lockout-audit.test.ts
 *
 * Proves FIX 1: writeLockoutFromKillEvent() now emits a strategy.lockout_written
 * audit row with correlationId on every successful lockout write, and emits a
 * strategy.lockout_write_failed audit row (fail-soft) when the lockout insert fails.
 *
 * Institutional bar:
 *   - correlationId is threaded from WriteLockoutParams into the audit row
 *   - audit failure must NOT throw into the caller (fail-soft via insertAuditRowSafe)
 *   - lockout insert failure emits strategy.lockout_write_failed audit (fail-soft)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted state shared across the mock factory and tests ──────────────────

const mocks = vi.hoisted(() => ({
  // Controls whether the lockout (strategyLockouts) insert rejects
  lockoutInsertShouldFail: false,
  // Controls whether the audit insert rejects
  auditInsertShouldFail: false,
  // Captured call payloads: { lockout: values[], audit: values[] }
  lockoutInsertCalls: [] as unknown[],
  auditInsertCalls: [] as unknown[],
}));

vi.mock("../db/index.js", () => ({
  db: {
    insert: (_table: unknown) => ({
      values: (vals: unknown) => {
        const isAudit =
          vals != null && typeof (vals as Record<string, unknown>).action === "string";
        if (isAudit) {
          mocks.auditInsertCalls.push(vals);
          if (mocks.auditInsertShouldFail) {
            return Promise.reject(new Error("audit DB gone"));
          }
          return Promise.resolve(undefined);
        }
        // strategyLockouts insert
        mocks.lockoutInsertCalls.push(vals);
        if (mocks.lockoutInsertShouldFail) {
          return Promise.reject(new Error("lockout table gone"));
        }
        return Promise.resolve(undefined);
      },
    }),
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([])) })) })) })) })),
  },
}));

vi.mock("../db/schema.js", () => ({
  strategyLockouts: {},
  auditLog: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  gt: vi.fn(),
  desc: vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Import AFTER mocks ───────────────────────────────────────────────────────

import {
  writeLockoutFromKillEvent,
  LOCKOUT_DURATION_HOURS,
} from "../services/strategy-lockout-service.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("FIX 1 — writeLockoutFromKillEvent: audit row + correlationId", () => {
  beforeEach(() => {
    mocks.lockoutInsertShouldFail = false;
    mocks.auditInsertShouldFail = false;
    mocks.lockoutInsertCalls = [];
    mocks.auditInsertCalls = [];
  });

  it("emits strategy.lockout_written audit row with correlationId on success", async () => {
    // entityId must be UUID-shaped: audit-log-helper.ts's coerceEntityId() (a
    // pre-existing P0 hardening commit) nulls any non-UUID entityId before the
    // audit_log insert (moves it to input.entity_ref instead) — "strat-fix1" isn't
    // UUID-shaped so the old raw-string assertion never matches anymore.
    await writeLockoutFromKillEvent({
      strategyId: "550e8400-e29b-41d4-a716-446655440002",
      killAuditId: "audit-kill-001",
      reason: "daily_loss_kill",
      correlationId: "corr-fix1-001",
    });

    // Lockout row was written
    expect(mocks.lockoutInsertCalls).toHaveLength(1);

    // Audit row was written
    const lockoutAudit = mocks.auditInsertCalls.find(
      (r) => (r as Record<string, unknown>).action === "strategy.lockout_written",
    ) as Record<string, unknown> | undefined;
    expect(lockoutAudit).toBeDefined();

    expect(lockoutAudit!.entityId).toBe("550e8400-e29b-41d4-a716-446655440002");
    expect(lockoutAudit!.entityType).toBe("strategy");
    expect(lockoutAudit!.decisionAuthority).toBe("system");
    expect(lockoutAudit!.status).toBe("warning");
    expect(lockoutAudit!.correlationId).toBe("corr-fix1-001");

    // result payload carries lockout metadata
    const result = lockoutAudit!.result as Record<string, unknown>;
    expect(result.lockoutDurationHours).toBe(LOCKOUT_DURATION_HOURS);
    expect(result.triggeredByKillId).toBe("audit-kill-001");
    expect(typeof result.lockedUntil).toBe("string"); // ISO string
  });

  it("threads null correlationId (manual lockout) into audit row", async () => {
    await writeLockoutFromKillEvent({
      strategyId: "strat-manual",
      killAuditId: null,
      reason: "manual",
      correlationId: null,
    });

    const auditRow = mocks.auditInsertCalls.find(
      (r) => (r as Record<string, unknown>).action === "strategy.lockout_written",
    ) as Record<string, unknown> | undefined;

    expect(auditRow).toBeDefined();
    expect(auditRow!.correlationId).toBeNull();
  });

  it("emits strategy.lockout_written with correlationId null when param is omitted", async () => {
    await writeLockoutFromKillEvent({
      strategyId: "strat-no-corr",
      killAuditId: "audit-456",
      reason: "daily_loss_kill",
      // correlationId not provided
    });

    const auditRow = mocks.auditInsertCalls.find(
      (r) => (r as Record<string, unknown>).action === "strategy.lockout_written",
    ) as Record<string, unknown> | undefined;

    expect(auditRow).toBeDefined();
    // undefined ?? null → null
    expect(auditRow!.correlationId).toBeNull();
  });

  it("does NOT throw when audit insertAuditRowSafe fails (fail-soft)", async () => {
    mocks.auditInsertShouldFail = true;

    // Primary lockout write should still succeed; the audit failure must be swallowed.
    await expect(
      writeLockoutFromKillEvent({
        strategyId: "strat-audit-fail",
        killAuditId: "audit-789",
        reason: "daily_loss_kill",
        correlationId: "corr-audit-fail",
      }),
    ).resolves.not.toThrow();

    // Lockout row was still written
    expect(mocks.lockoutInsertCalls).toHaveLength(1);
  });

  it("emits strategy.lockout_write_failed audit when lockout insert fails (fail-soft, non-throwing)", async () => {
    mocks.lockoutInsertShouldFail = true;

    // Must not throw into caller
    await expect(
      writeLockoutFromKillEvent({
        strategyId: "strat-write-fail",
        killAuditId: "audit-999",
        reason: "daily_loss_kill",
        correlationId: "corr-write-fail",
      }),
    ).resolves.not.toThrow();

    // Failure audit row must have been written
    const failureAudit = mocks.auditInsertCalls.find(
      (r) => (r as Record<string, unknown>).action === "strategy.lockout_write_failed",
    ) as Record<string, unknown> | undefined;

    expect(failureAudit).toBeDefined();
    expect(failureAudit!.status).toBe("error");
    expect(failureAudit!.correlationId).toBe("corr-write-fail");
    const result = failureAudit!.result as Record<string, unknown>;
    expect(typeof result.error).toBe("string");
    expect(result.note).toBeTruthy();
  });
});
