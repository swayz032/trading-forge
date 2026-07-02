/**
 * dlq-age-escalation.test.ts — O2 observability fixes
 *
 * Verifies:
 * 1. retryAllUnresolved source contains ORDER BY (oldest-first drain)
 * 2. escalateDLQByAge is exported from dlq-service
 * 3. Handler-less retryDLQItem increments retryCount so escalateDLQ can fire
 * 4. escalateDLQByAge escalates an over-age handler-less item
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

// ── Mutable mock state (captured by reference in mock factories) ──────────────
// vi.mock factories are hoisted — but they create closures over these bindings,
// so assigning to `mockRows.current` in beforeEach works at call time.
const mockRows = { current: [] as Record<string, unknown>[] };
const updateCallArgs: unknown[][] = [];
const notifyMock = vi.fn();

// ── vi.mock must be hoisted (no dynamic imports inside) ───────────────────────

vi.mock("../db/index.js", () => {
  // Produce an object whose .where() is both directly awaitable and chainable
  // with .orderBy().limit() so both retryDLQItem and retryAllUnresolved work.
  const makeWhere = () => {
    const rows = mockRows.current;
    const obj: Record<string, unknown> = {
      then(
        resolve: (v: unknown[]) => unknown,
        reject?: (e: unknown) => unknown,
      ) {
        return Promise.resolve(rows).then(resolve, reject);
      },
      catch(reject: (e: unknown) => unknown) {
        return Promise.resolve(rows).catch(reject);
      },
      finally(cb: () => void) {
        return Promise.resolve(rows).finally(cb);
      },
      orderBy: () => ({
        limit: () => Promise.resolve(rows),
      }),
    };
    return obj;
  };

  return {
    db: {
      select: () => ({
        from: () => ({
          where: makeWhere,
        }),
      }),
      update: (...args: unknown[]) => ({
        set: (vals: unknown) => ({
          where: (...whereArgs: unknown[]) => {
            updateCallArgs.push([...args, vals, ...whereArgs]);
            return Promise.resolve(undefined);
          },
        }),
      }),
    },
  };
});

vi.mock("../db/schema.js", () => ({
  deadLetterQueue: {
    id: "id",
    operationType: "operationType",
    entityType: "entityType",
    entityId: "entityId",
    errorMessage: "errorMessage",
    retryCount: "retryCount",
    maxRetries: "maxRetries",
    escalated: "escalated",
    resolved: "resolved",
    createdAt: "createdAt",
    firstFailedAt: "firstFailedAt",
    lastFailedAt: "lastFailedAt",
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/notification-service.js", () => ({
  notifyCritical: notifyMock,
}));

// notification-helpers is a pure function — let it run real
vi.unmock("../lib/notification-helpers.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const twoDaysAgo = new Date(Date.now() - 49 * 60 * 60 * 1000); // 49h ago — over 48h SLO
  return {
    id: "dlq-test-age-001",
    operationType: "scheduler:backtest_sweep",
    entityType: "backtest",
    entityId: "bt-xyz",
    errorMessage: "scheduler timed out",
    retryCount: 0,
    maxRetries: 3,
    resolved: false,
    escalated: false,
    createdAt: twoDaysAgo,
    firstFailedAt: twoDaysAgo,
    lastFailedAt: twoDaysAgo,
    metadata: null,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("O2 DLQ fixes — source-level guards", () => {
  const srcPath = resolve(
    fileURLToPath(import.meta.url),
    "../../lib/dlq-service.ts",
  );
  let src: string;

  beforeEach(() => {
    src = readFileSync(srcPath, "utf-8");
  });

  it("retryAllUnresolved contains .orderBy( for oldest-first drain", () => {
    expect(src).toContain(".orderBy(");
    expect(src).toContain("createdAt");
  });

  it("exports escalateDLQByAge", () => {
    expect(src).toContain("export async function escalateDLQByAge");
  });

  it("escalateDLQByAge uses DLQ_MAX_AGE_HOURS env var with 48h default", () => {
    expect(src).toContain("DLQ_MAX_AGE_HOURS");
    expect(src).toContain("48");
  });

  it("handler-less retryDLQItem increments retryCount (not return-false-silently)", () => {
    // Guard that the fix is present in source
    expect(src).toContain("retryCount incremented for escalation eligibility");
    expect(src).toContain("retryCount: item.retryCount + 1");
  });
});

describe("O2 DLQ fixes — behavioral: handler-less retryDLQItem increments retryCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateCallArgs.length = 0;
    // Item exists in DB with no registered handler for its operation type
    mockRows.current = [
      makeItem({ operationType: "agent:unknown_op" }),
    ];
  });

  it("calls db.update to increment retryCount when no handler is registered", async () => {
    // Fresh module so retryHandlers Map is empty for this operation type
    vi.resetModules();

    // Re-mock after resetModules (needed because resetModules clears the mock registry)
    vi.mock("../db/index.js", () => {
      const makeWhere = () => {
        const rows = mockRows.current;
        return {
          then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
            return Promise.resolve(rows).then(resolve, reject);
          },
          catch(reject: (e: unknown) => unknown) {
            return Promise.resolve(rows).catch(reject);
          },
          finally(cb: () => void) {
            return Promise.resolve(rows).finally(cb);
          },
          orderBy: () => ({ limit: () => Promise.resolve(rows) }),
        };
      };
      return {
        db: {
          select: () => ({ from: () => ({ where: makeWhere }) }),
          update: (...args: unknown[]) => ({
            set: (vals: unknown) => ({
              where: (...whereArgs: unknown[]) => {
                updateCallArgs.push([...args, vals, ...whereArgs]);
                return Promise.resolve(undefined);
              },
            }),
          }),
        },
      };
    });
    vi.mock("../db/schema.js", () => ({
      deadLetterQueue: {
        id: "id", operationType: "operationType", entityType: "entityType",
        entityId: "entityId", errorMessage: "errorMessage", retryCount: "retryCount",
        maxRetries: "maxRetries", escalated: "escalated", resolved: "resolved",
        createdAt: "createdAt", firstFailedAt: "firstFailedAt", lastFailedAt: "lastFailedAt",
      },
    }));
    vi.mock("../lib/logger.js", () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }));
    vi.mock("../services/notification-service.js", () => ({ notifyCritical: notifyMock }));

    const { retryDLQItem } = await import("../lib/dlq-service.js");

    const result = await retryDLQItem("dlq-test-age-001");

    expect(result).toBe(false); // still fails — no handler
    // db.update must have been called with retryCount + 1
    expect(updateCallArgs.length).toBeGreaterThanOrEqual(1);
    const [, vals] = updateCallArgs[0] as [unknown, { retryCount?: number }];
    expect((vals as { retryCount?: number }).retryCount).toBe(1);
  });
});

describe("O2 DLQ fixes — behavioral: escalateDLQByAge escalates over-age item", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    updateCallArgs.length = 0;
    notifyMock.mockReset();

    // Set env so the SLO is effectively 0h → everything old enough is over-age
    savedEnv.DLQ_MAX_AGE_HOURS = process.env.DLQ_MAX_AGE_HOURS;
    process.env.DLQ_MAX_AGE_HOURS = "0";

    // Item is 1 second old — with maxAgeHours=0 the cutoff is ~now(), so it qualifies
    mockRows.current = [makeItem({ createdAt: new Date(Date.now() - 1000) })];
  });

  afterEach(() => {
    if (savedEnv.DLQ_MAX_AGE_HOURS === undefined) {
      delete process.env.DLQ_MAX_AGE_HOURS;
    } else {
      process.env.DLQ_MAX_AGE_HOURS = savedEnv.DLQ_MAX_AGE_HOURS;
    }
  });

  it("marks the item escalated=true in DB", async () => {
    const { escalateDLQByAge } = await import("../lib/dlq-service.js");

    const escalated = await escalateDLQByAge();

    expect(escalated).toBe(1);
    // Must have called db.update with escalated: true
    const updateWithEscalated = updateCallArgs.find(([, vals]) =>
      typeof vals === "object" && vals !== null && (vals as Record<string, unknown>).escalated === true,
    );
    expect(updateWithEscalated).toBeDefined();
  });

  it("fires notifyCritical for the over-age item", async () => {
    const { escalateDLQByAge } = await import("../lib/dlq-service.js");

    await escalateDLQByAge();

    expect(notifyMock).toHaveBeenCalledOnce();
    const [title] = notifyMock.mock.calls[0] as [string, ...unknown[]];
    expect(title).toContain("Age-SLO Breach");
    expect(title).toContain("scheduler:backtest_sweep");
  });

  it("returns 0 when no items exceed the age SLO", async () => {
    // Clear rows so there's nothing to escalate
    mockRows.current = [];

    const { escalateDLQByAge } = await import("../lib/dlq-service.js");

    const escalated = await escalateDLQByAge();

    expect(escalated).toBe(0);
    expect(notifyMock).not.toHaveBeenCalled();
    expect(updateCallArgs.length).toBe(0);
  });
});
