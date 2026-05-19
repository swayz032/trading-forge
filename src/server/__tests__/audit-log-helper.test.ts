/**
 * audit-log-helper.test.ts — Wave 4 (2026-05-16)
 *
 * Verifies:
 *   1. logger.warn fires when correlationId is null/undefined
 *   2. logger.warn does NOT fire when correlationId is set
 *   3. The helper calls db.insert(auditLog) once per invocation
 *   4. DB errors are rethrown (so .catch() callers still work)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock the logger before importing the module under test.
// Wave 6 architect fix: audit-log-helper.ts now imports logger from
// "./logger.js" (not "../index.js") to avoid pulling the Express bootstrap
// graph into every test that uses the helper. Test mock must follow.
vi.mock("../../server/lib/logger.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the DB so tests don't need a real Postgres connection
vi.mock("../../server/db/index.js", () => ({
  db: {
    insert: vi.fn(),
  },
}));

// Mock the schema
vi.mock("../../server/db/schema.js", () => ({
  auditLog: { $inferInsert: {} },
}));

// ─── Helpers for clean setup per test ────────────────────────────────────────

async function getModules() {
  const { logger } = await import("../../server/lib/logger.js");
  const { db } = await import("../../server/db/index.js");
  const { insertAuditRow } = await import("../../server/lib/audit-log-helper.js");
  return { logger, db, insertAuditRow };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("insertAuditRow — null correlationId warning", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("fires logger.warn when correlationId is null", async () => {
    const { logger, db, insertAuditRow } = await getModules();

    // Set up the db mock to resolve successfully
    const insertMock = vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
    (db as unknown as { insert: typeof insertMock }).insert = insertMock;

    await insertAuditRow({
      action: "test.action",
      entityId: "abc-123",
      entityType: "strategy",
      correlationId: null,
    } as Parameters<typeof insertAuditRow>[0]);

    expect((logger.warn as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(warnCall[0]).toMatchObject({
      action: "test.action",
      entityId: "abc-123",
      entityType: "strategy",
    });
    expect(warnCall[1]).toContain("correlation_id");
  });

  it("fires logger.warn when correlationId is undefined", async () => {
    const { logger, db, insertAuditRow } = await getModules();

    const insertMock = vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
    (db as unknown as { insert: typeof insertMock }).insert = insertMock;

    await insertAuditRow({
      action: "test.action",
      entityId: "xyz-456",
      entityType: "broker_account",
      // correlationId omitted (undefined)
    } as Parameters<typeof insertAuditRow>[0]);

    expect((logger.warn as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(warnCall[1]).toMatch(/correlation_id/);
  });

  it("does NOT fire logger.warn when correlationId is set", async () => {
    const { logger, db, insertAuditRow } = await getModules();

    const insertMock = vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
    (db as unknown as { insert: typeof insertMock }).insert = insertMock;

    await insertAuditRow({
      action: "test.action",
      entityId: "strat-789",
      entityType: "strategy",
      correlationId: "corr-abc-123",
    } as Parameters<typeof insertAuditRow>[0]);

    expect((logger.warn as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("calls db.insert once per invocation", async () => {
    const { db, insertAuditRow } = await getModules();

    const valuesMock = vi.fn().mockResolvedValue(undefined);
    const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
    (db as unknown as { insert: typeof insertMock }).insert = insertMock;

    await insertAuditRow({
      action: "broker_router.route_order",
      entityType: "broker_account",
      correlationId: "c-1",
    } as Parameters<typeof insertAuditRow>[0]);

    expect(insertMock).toHaveBeenCalledOnce();
    expect(valuesMock).toHaveBeenCalledOnce();
  });

  it("rethrows DB errors so callers can .catch() them", async () => {
    const { db, insertAuditRow } = await getModules();

    const dbError = new Error("connection refused");
    const insertMock = vi.fn().mockReturnValue({
      values: vi.fn().mockRejectedValue(dbError),
    });
    (db as unknown as { insert: typeof insertMock }).insert = insertMock;

    await expect(
      insertAuditRow({
        action: "test.error_path",
        entityType: "strategy",
        correlationId: "c-2",
      } as Parameters<typeof insertAuditRow>[0])
    ).rejects.toThrow("connection refused");
  });
});

// ─── Source-level guard: confirm helper module uses the warn pattern ──────────

describe("audit-log-helper — source contract guard", () => {
  it("contains the logger.warn call for null correlationId", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../server/lib/audit-log-helper.ts"),
      "utf8"
    );

    expect(src).toContain("logger.warn");
    expect(src).toContain("correlationId == null");
    expect(src).toContain("context propagation gap");
  });
});
