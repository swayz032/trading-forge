/**
 * deepscan18-compliance-drift-sse.test.ts — Regression test for the E-E1 fix:
 * `checkComplianceRuleDrift()` is the ONLY documented emitter of
 * `compliance:drift_detected` (see the type's JSDoc in
 * Trading_forge_frontend/.../types/sse-events.ts), but until this fix it
 * never actually called broadcastSSE — Discord got the alert, the live
 * dashboard tile never did.
 *
 * The pre-existing wave9-sse-events.test.ts only mirrors the severity/payload
 * logic in isolation (a copy-pasted pure function) — it never calls the real
 * checkComplianceRuleDrift() or asserts broadcastSSE was invoked. This test
 * closes that gap by exercising the real function end-to-end against a
 * mocked DB + fs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelectFn = vi.fn();
const mockInsertFn = vi.fn();
const mockBroadcastSSE = vi.fn();
const mockNotifyCritical = vi.fn();
const mockExistsSync = vi.fn((..._args: unknown[]) => true);
const mockReadFileSync = vi.fn((..._args: unknown[]) => "prop firm rules v2 — updated content");

vi.mock("fs", () => ({
  existsSync:   (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

vi.mock("../db/index.js", () => ({
  db: {
    get select() { return mockSelectFn; },
    get insert() { return mockInsertFn; },
  },
}));

vi.mock("../db/schema.js", () => ({
  complianceRulesets:  { id: "id", firm: "firm", createdAt: "createdAt", contentHash: "contentHash" },
  complianceDriftLog:  {},
  strategies:          { id: "id", lifecycleState: "lifecycleState" },
  paperSessions:       { strategyId: "strategyId", firmId: "firmId" },
}));

vi.mock("drizzle-orm", () => ({
  eq:      vi.fn(() => "__eq__"),
  desc:    vi.fn(() => "__desc__"),
  and:     vi.fn(() => "__and__"),
  inArray: vi.fn(() => "__inArray__"),
  sql:     new Proxy(() => "__sql__", { get: () => () => "__sql__" }),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("../services/notification-service.js", () => ({
  notifyCritical: (...args: unknown[]) => mockNotifyCritical(...args),
}));

vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: (op: string) => op,
}));

vi.mock("../routes/sse.js", () => ({
  get broadcastSSE() { return mockBroadcastSSE; },
}));

import { checkComplianceRuleDrift } from "../services/compliance-refresh-service.js";

/**
 * Wire the 3 mandatory selects (overall-latest, mffu-latest, topstep-latest)
 * plus an optional 4th (affected-strategy count, only reached when at least
 * one firm actually drifts).
 */
function setupSelects(opts: {
  overallHash: string | null;
  mffuHash: string | null;
  topstepHash: string | null;
  affectedCount?: number;
}) {
  // Call 1: overall latest ruleset — .from().orderBy().limit(1)
  mockSelectFn.mockReturnValueOnce({
    from: vi.fn(() => ({
      orderBy: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve(
          opts.overallHash == null ? [] : [{ id: "r0", contentHash: opts.overallHash }],
        )),
      })),
    })),
  });
  // Call 2: mffu latest — .from().where().orderBy().limit(1)
  mockSelectFn.mockReturnValueOnce({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(
            opts.mffuHash == null ? [] : [{ id: "r1", contentHash: opts.mffuHash }],
          )),
        })),
      })),
    })),
  });
  // Call 3: topstep latest — .from().where().orderBy().limit(1)
  mockSelectFn.mockReturnValueOnce({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(
            opts.topstepHash == null ? [] : [{ id: "r2", contentHash: opts.topstepHash }],
          )),
        })),
      })),
    })),
  });
  // Call 4 (conditional): affected-strategy count — .from().innerJoin().where()
  if (opts.affectedCount !== undefined) {
    mockSelectFn.mockReturnValueOnce({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([{ count: opts.affectedCount }])),
        })),
      })),
    });
  }
}

function setupInserts() {
  mockInsertFn.mockImplementation(() => ({
    values: vi.fn(() => ({
      returning: vi.fn(() => Promise.resolve([{ id: "new-ruleset-id" }])),
    })),
  }));
}

describe("checkComplianceRuleDrift — compliance:drift_detected SSE emission (deepscan18 E-E1)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("prop firm rules v2 — updated content");
    setupInserts();
  });

  it("broadcasts compliance:drift_detected with severity=critical when live strategies are affected", async () => {
    setupSelects({ overallHash: "old-hash-000", mffuHash: "old-hash-000", topstepHash: "old-hash-000", affectedCount: 2 });

    const result = await checkComplianceRuleDrift();

    expect(result.drifted).toBe(true);
    expect(mockBroadcastSSE).toHaveBeenCalledOnce();
    const [eventName, payload] = mockBroadcastSSE.mock.calls[0];
    expect(eventName).toBe("compliance:drift_detected");
    expect(payload).toEqual(
      expect.objectContaining({
        affectedFirms: expect.arrayContaining(["mffu", "topstep"]),
        oldHash: "old-hash-000",
        affectedStrategyCount: 2,
        severity: "critical",
        correlationId: null,
      }),
    );
    expect(typeof payload.newHash).toBe("string");
    expect(typeof payload.timestamp).toBe("string");
  });

  it("broadcasts severity=warning when no live strategies are affected", async () => {
    setupSelects({ overallHash: "old-hash-111", mffuHash: "old-hash-111", topstepHash: "old-hash-111", affectedCount: 0 });

    await checkComplianceRuleDrift();

    expect(mockBroadcastSSE).toHaveBeenCalledOnce();
    const [, payload] = mockBroadcastSSE.mock.calls[0];
    expect(payload.severity).toBe("warning");
    expect(payload.affectedStrategyCount).toBe(0);
  });

  it("does NOT broadcast when the document hash is unchanged (no drift)", async () => {
    // crypto.createHash of the mocked content is deterministic — compute it
    // the same way the service does so oldHash === newHash.
    const crypto = await import("crypto");
    const newHash = crypto.createHash("sha256").update("prop firm rules v2 — updated content").digest("hex");
    setupSelects({ overallHash: newHash, mffuHash: newHash, topstepHash: newHash });

    const result = await checkComplianceRuleDrift();

    expect(result.drifted).toBe(false);
    expect(mockBroadcastSSE).not.toHaveBeenCalled();
  });

  it("fail-safe: broadcasts severity=critical (not silently 0-count) when the affected-count query itself throws", async () => {
    // 3 mandatory selects succeed and show drift; the 4th (count) query rejects.
    setupSelects({ overallHash: "old-hash-222", mffuHash: "old-hash-222", topstepHash: "old-hash-222" });
    mockSelectFn.mockReturnValueOnce({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => Promise.reject(new Error("db connection lost"))),
        })),
      })),
    });

    const result = await checkComplianceRuleDrift();

    expect(result.drifted).toBe(true);
    expect(mockBroadcastSSE).toHaveBeenCalledOnce();
    const [, payload] = mockBroadcastSSE.mock.calls[0];
    // Fail-safe contract: an unmeasurable count must never be reported as
    // the reassuring "0 affected / warning" — it defaults to critical.
    expect(payload.severity).toBe("critical");
    expect(payload.affectedStrategyCount).toBe(0);
  });

  it("does NOT broadcast when the rules file is missing (no-op path)", async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await checkComplianceRuleDrift();

    expect(result.drifted).toBe(false);
    expect(mockBroadcastSSE).not.toHaveBeenCalled();
    expect(mockSelectFn).not.toHaveBeenCalled();
  });
});
