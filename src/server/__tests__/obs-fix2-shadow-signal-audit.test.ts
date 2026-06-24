/**
 * obs-fix2-shadow-signal-audit.test.ts
 *
 * Proves FIX 2: logShadowSignal() in shadow-service.ts now:
 *   1. Accepts correlationId in ShadowSignalInput
 *   2. Wraps the insert in try/catch (does NOT throw into the caller on DB error)
 *   3. Emits signal.shadow_logged audit row with correlationId on success
 *   4. Emits lifecycle.shadow_signal_log_failed audit row (fail-soft) on DB error
 *   5. Preserves the SHADOW invariant: traderspost_webhook_called=false in all audit rows
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted state ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  shadowInsertShouldFail: false,
  auditInsertShouldFail: false,
  shadowInsertCalls: [] as unknown[],
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

        // shadowSignals insert
        mocks.shadowInsertCalls.push(vals);
        if (mocks.shadowInsertShouldFail) {
          return Promise.reject(new Error("shadowSignals table gone"));
        }
        return Promise.resolve(undefined);
      },
    }),
    select: vi.fn(),
  },
}));

vi.mock("../db/schema.js", () => ({
  shadowSignals: {},
  auditLog: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  desc: vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Import AFTER mocks ───────────────────────────────────────────────────────

import { logShadowSignal } from "../services/shadow-service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<Parameters<typeof logShadowSignal>[0]> = {}) {
  return {
    sessionId: "sess-shadow-001",
    signalTime: new Date("2026-06-24T09:30:00.000Z"),
    direction: "long" as const,
    expectedEntry: 5100.25,
    actualMarketPrice: 5100.50,
    modelSlippage: 0.25,
    correlationId: "corr-shadow-001",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("FIX 2 — logShadowSignal: try/catch + audit + correlationId", () => {
  beforeEach(() => {
    mocks.shadowInsertShouldFail = false;
    mocks.auditInsertShouldFail = false;
    mocks.shadowInsertCalls = [];
    mocks.auditInsertCalls = [];
  });

  it("inserts shadow signal row on success", async () => {
    await logShadowSignal(makeInput());
    expect(mocks.shadowInsertCalls).toHaveLength(1);
    const row = mocks.shadowInsertCalls[0] as Record<string, unknown>;
    expect(row.direction).toBe("long");
    expect(row.sessionId).toBe("sess-shadow-001");
  });

  it("emits signal.shadow_logged audit row with correlationId on success", async () => {
    await logShadowSignal(makeInput({ correlationId: "corr-abc-123" }));

    const auditRow = mocks.auditInsertCalls.find(
      (r) => (r as Record<string, unknown>).action === "signal.shadow_logged",
    ) as Record<string, unknown> | undefined;

    expect(auditRow).toBeDefined();
    expect(auditRow!.entityId).toBe("sess-shadow-001");
    expect(auditRow!.entityType).toBe("paper_session");
    expect(auditRow!.decisionAuthority).toBe("system");
    expect(auditRow!.status).toBe("info");
    expect(auditRow!.correlationId).toBe("corr-abc-123");

    // SHADOW invariant: traderspost_webhook_called must be false in the audit result
    const result = auditRow!.result as Record<string, unknown>;
    expect(result.traderspost_webhook_called).toBe(false);
  });

  it("SHADOW invariant preserved: traderspost_webhook_called=false in audit even when fill-probability is true", async () => {
    // expectedEntry = actualMarketPrice → 0% slippage → wouldFill=true
    await logShadowSignal(
      makeInput({
        expectedEntry: 5100.25,
        actualMarketPrice: 5100.25, // zero slippage → wouldFill=true
        correlationId: "corr-invariant",
      }),
    );

    const auditRow = mocks.auditInsertCalls.find(
      (r) => (r as Record<string, unknown>).action === "signal.shadow_logged",
    ) as Record<string, unknown> | undefined;

    expect(auditRow).toBeDefined();
    const result = auditRow!.result as Record<string, unknown>;
    // wouldHaveFilled may be true but traderspost_webhook_called must ALWAYS be false
    expect(result.traderspost_webhook_called).toBe(false);
  });

  it("does NOT throw when DB insert fails (fail-soft — does not throw into caller)", async () => {
    mocks.shadowInsertShouldFail = true;

    await expect(
      logShadowSignal(makeInput({ correlationId: "corr-fail-soft" })),
    ).resolves.not.toThrow();
  });

  it("emits lifecycle.shadow_signal_log_failed audit on DB insert failure (fail-soft)", async () => {
    mocks.shadowInsertShouldFail = true;

    await logShadowSignal(makeInput({ correlationId: "corr-fail-audit" }));

    const failureAudit = mocks.auditInsertCalls.find(
      (r) => (r as Record<string, unknown>).action === "lifecycle.shadow_signal_log_failed",
    ) as Record<string, unknown> | undefined;

    expect(failureAudit).toBeDefined();
    expect(failureAudit!.status).toBe("error");
    expect(failureAudit!.correlationId).toBe("corr-fail-audit");

    // SHADOW invariant also preserved in failure audit
    const result = failureAudit!.result as Record<string, unknown>;
    expect(result.traderspost_webhook_called).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  it("threads null correlationId when omitted", async () => {
    await logShadowSignal(makeInput({ correlationId: undefined }));

    const auditRow = mocks.auditInsertCalls.find(
      (r) => (r as Record<string, unknown>).action === "signal.shadow_logged",
    ) as Record<string, unknown> | undefined;

    expect(auditRow).toBeDefined();
    // undefined ?? null → null
    expect(auditRow!.correlationId).toBeNull();
  });

  it("does NOT emit signal.shadow_logged audit when the DB insert failed (only failure audit)", async () => {
    mocks.shadowInsertShouldFail = true;

    await logShadowSignal(makeInput());

    const successAudit = mocks.auditInsertCalls.find(
      (r) => (r as Record<string, unknown>).action === "signal.shadow_logged",
    );
    expect(successAudit).toBeUndefined(); // success audit must NOT fire on failure path

    const failureAudit = mocks.auditInsertCalls.find(
      (r) => (r as Record<string, unknown>).action === "lifecycle.shadow_signal_log_failed",
    );
    expect(failureAudit).toBeDefined();
  });
});
