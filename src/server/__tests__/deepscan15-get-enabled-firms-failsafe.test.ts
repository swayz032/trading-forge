/**
 * deepscan15-get-enabled-firms-failsafe.test.ts — deep-scan #15
 *
 * getEnabledFirms() hardening: a DB read error must NOT silently re-enable a firm
 * the operator intentionally disabled. On error we return the last-known-good
 * confirmed set (or a conservative default only on cold start) + a loud audit row.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks (hoisted before imports) ──────────────────────────────────────────

const selectMock = vi.fn((..._args: unknown[]): unknown => undefined);
const insertValuesMock = vi.fn((..._args: unknown[]) => Promise.resolve());
const insertMock = vi.fn((..._args: unknown[]) => ({ values: insertValuesMock }));

vi.mock("../db/index.js", () => ({
  db: {
    select: (...args: unknown[]) => selectMock(...args),
    insert: (...args: unknown[]) => insertMock(...args),
  },
}));

vi.mock("../db/schema.js", () => ({
  accountStrategyAssignments: {},
  auditLog: {},
  strategies: {},
  brokerAccounts: {},
  instanceConfig: { id: {}, enabledFirms: {} },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  and: vi.fn((...a: unknown[]) => ({ a })),
  desc: vi.fn((c: unknown) => ({ c })),
}));

vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("./pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
  PipelinePausedError: class extends Error {},
}));
vi.mock("../services/notification-service.js", () => ({ notifyCritical: vi.fn() }));
vi.mock("../lib/notification-helpers.js", () => ({ appendFamilyGradePostscript: vi.fn((m: string) => m) }));

import { getEnabledFirms, __resetEnabledFirmsCache } from "../services/strategy-assignment-service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Make db.select().from().where().limit() resolve to the given rows. */
function selectResolves(rows: unknown[]): void {
  selectMock.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  });
}

/** Make db.select().from().where().limit() reject (DB read error). */
function selectRejects(): void {
  selectMock.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockRejectedValue(new Error("boom: instance_config read failed")),
      }),
    }),
  });
}

describe("getEnabledFirms fail-safe (deep-scan #15)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockImplementation(() => ({ values: insertValuesMock }));
    insertValuesMock.mockImplementation(() => Promise.resolve());
    __resetEnabledFirmsCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetEnabledFirmsCache();
  });

  it("returns the last-known-good confirmed set on a DB error — does NOT re-enable a disabled firm", async () => {
    // 1) Operator has disabled MFFU → instance_config.enabled_firms = ['topstep'].
    selectResolves([{ enabledFirms: ["topstep"] }]);
    const first = await getEnabledFirms();
    expect(first).toEqual(["topstep"]);

    // 2) Expire the 60s cache so the next call actually re-reads the DB.
    vi.advanceTimersByTime(61_000);

    // 3) DB read now fails.
    selectRejects();
    const second = await getEnabledFirms();

    // FAIL-SAFE: must return the last-known-good ['topstep'] — NOT the default
    // ['topstep','mffu'] which would silently RE-ENABLE the disabled MFFU firm.
    expect(second).toEqual(["topstep"]);
    expect(second).not.toContain("mffu");

    // A loud audit row was written so the degraded read is observable.
    const calls = insertValuesMock.mock.calls as unknown[][];
    const auditCall = calls.find(
      (c) => (c[0] as { action?: string })?.action === "enabled_firms.read_error_failsafe",
    );
    expect(auditCall).toBeDefined();
    const payload = auditCall![0] as { result: { usingLastKnownGood: boolean; returnedEnabledFirms: string[] } };
    expect(payload.result.usingLastKnownGood).toBe(true);
    expect(payload.result.returnedEnabledFirms).toEqual(["topstep"]);
  });

  it("cold-start DB error (no prior confirmed read) falls back to the conservative default + loud audit", async () => {
    selectRejects();
    const result = await getEnabledFirms();

    // No last-known-good yet → conservative default.
    expect(result).toEqual(["topstep", "mffu"]);

    const calls = insertValuesMock.mock.calls as unknown[][];
    const auditCall = calls.find(
      (c) => (c[0] as { action?: string })?.action === "enabled_firms.read_error_failsafe",
    );
    expect(auditCall).toBeDefined();
    const payload = auditCall![0] as { result: { usingLastKnownGood: boolean } };
    expect(payload.result.usingLastKnownGood).toBe(false);
  });

  it("a successful read does NOT emit the fail-safe audit", async () => {
    selectResolves([{ enabledFirms: ["topstep", "mffu"] }]);
    const result = await getEnabledFirms();
    expect(result).toEqual(["topstep", "mffu"]);

    const calls = insertValuesMock.mock.calls as unknown[][];
    const auditCall = calls.find(
      (c) => (c[0] as { action?: string })?.action === "enabled_firms.read_error_failsafe",
    );
    expect(auditCall).toBeUndefined();
  });
});
