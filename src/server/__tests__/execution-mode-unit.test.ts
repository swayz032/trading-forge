/**
 * Unit tests for src/server/lib/execution-mode.ts
 *
 * Tests sections:
 *   A. isLiveExecutionConfigured()  — env-gate checks (pure, no DB)
 *   B. getExecutionMode()           — fail-closed DB read
 *   C. setExecutionMode()           — select-then-update-or-insert
 *
 * This file DOES NOT mock execution-mode.ts itself — it tests the real module.
 * drizzle-orm, db, schema, and logger are all mocked.
 *
 * Key isolation constraint: vitest hoists vi.mock() calls.  Do NOT add a mock
 * for "../lib/execution-mode.js" in this file — that would replace the real
 * implementation under test.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// ── Mocks (hoisted before imports) ───────────────────────────────────────────

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("../db/index.js", () => ({ db: dbMock }));

vi.mock("../db/schema.js", () => ({
  systemParameters: {
    paramName:    "paramName",
    currentValue: "currentValue",
    id:           "id",
    updatedAt:    "updatedAt",
    domain:       "domain",
    description:  "description",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => Symbol("eq")),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Chainable Drizzle select mock that resolves .limit() with the given rows. */
function makeSelectChain(rows: unknown[]) {
  const chain = {
    from:  () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
  };
  return chain;
}

function makeUpdateChain(onSet?: (vals: unknown) => void) {
  return {
    set: (vals: unknown) => {
      onSet?.(vals);
      return { where: () => Promise.resolve([]) };
    },
  };
}

// ── A. isLiveExecutionConfigured() ────────────────────────────────────────────

const SECRET_32 = "a".repeat(32);
const SECRET_31 = "a".repeat(31);

describe("isLiveExecutionConfigured()", () => {
  afterEach(() => {
    delete process.env.SERVER_MEDIATED_EXECUTION_ENABLED;
    delete process.env.BROKER_FILL_HMAC_SECRET;
  });

  it("returns false when both env vars are absent", async () => {
    const { isLiveExecutionConfigured } = await import("../lib/execution-mode.js");
    expect(isLiveExecutionConfigured()).toBe(false);
  });

  it("returns false when value is '1' not the exact string 'true'", async () => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "1";
    process.env.BROKER_FILL_HMAC_SECRET = SECRET_32;
    const { isLiveExecutionConfigured } = await import("../lib/execution-mode.js");
    expect(isLiveExecutionConfigured()).toBe(false);
  });

  it("returns false when SERVER_MEDIATED_EXECUTION_ENABLED is set but secret is absent", async () => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "true";
    delete process.env.BROKER_FILL_HMAC_SECRET;
    const { isLiveExecutionConfigured } = await import("../lib/execution-mode.js");
    expect(isLiveExecutionConfigured()).toBe(false);
  });

  it("returns false when secret is 31 chars (too short)", async () => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "true";
    process.env.BROKER_FILL_HMAC_SECRET = SECRET_31;
    const { isLiveExecutionConfigured } = await import("../lib/execution-mode.js");
    expect(isLiveExecutionConfigured()).toBe(false);
  });

  it("returns true when enabled='true' AND secret is exactly 32 chars", async () => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "true";
    process.env.BROKER_FILL_HMAC_SECRET = SECRET_32;
    const { isLiveExecutionConfigured } = await import("../lib/execution-mode.js");
    expect(isLiveExecutionConfigured()).toBe(true);
  });

  it("returns true when secret is longer than 32 chars", async () => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "true";
    process.env.BROKER_FILL_HMAC_SECRET = "x".repeat(64);
    const { isLiveExecutionConfigured } = await import("../lib/execution-mode.js");
    expect(isLiveExecutionConfigured()).toBe(true);
  });
});

// ── B. getExecutionMode() ─────────────────────────────────────────────────────

describe("getExecutionMode()", () => {
  afterEach(() => {
    vi.resetAllMocks();
    delete process.env.SERVER_MEDIATED_EXECUTION_ENABLED;
    delete process.env.BROKER_FILL_HMAC_SECRET;
  });

  it("returns 'paper' and skips DB when env not configured", async () => {
    const { getExecutionMode } = await import("../lib/execution-mode.js");
    const result = await getExecutionMode();
    expect(result).toBe("paper");
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it("returns 'paper' and skips DB when secret too short", async () => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "true";
    process.env.BROKER_FILL_HMAC_SECRET = "short";
    const { getExecutionMode } = await import("../lib/execution-mode.js");
    const result = await getExecutionMode();
    expect(result).toBe("paper");
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it("returns 'paper' when configured but DB row is absent", async () => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "true";
    process.env.BROKER_FILL_HMAC_SECRET = SECRET_32;
    dbMock.select.mockReturnValueOnce(makeSelectChain([]));
    const { getExecutionMode } = await import("../lib/execution-mode.js");
    expect(await getExecutionMode()).toBe("paper");
  });

  it("returns 'paper' when row has currentValue='0'", async () => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "true";
    process.env.BROKER_FILL_HMAC_SECRET = SECRET_32;
    dbMock.select.mockReturnValueOnce(makeSelectChain([{ val: "0" }]));
    const { getExecutionMode } = await import("../lib/execution-mode.js");
    expect(await getExecutionMode()).toBe("paper");
  });

  it("returns 'live' when configured AND row has currentValue='1'", async () => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "true";
    process.env.BROKER_FILL_HMAC_SECRET = SECRET_32;
    dbMock.select.mockReturnValueOnce(makeSelectChain([{ val: "1" }]));
    const { getExecutionMode } = await import("../lib/execution-mode.js");
    expect(await getExecutionMode()).toBe("live");
  });

  it("returns 'paper' on DB error (fail-closed, never throws)", async () => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "true";
    process.env.BROKER_FILL_HMAC_SECRET = SECRET_32;
    dbMock.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.reject(new Error("db down")) }) }),
    });
    const { getExecutionMode } = await import("../lib/execution-mode.js");
    expect(await getExecutionMode()).toBe("paper");
  });
});

// ── C. setExecutionMode() ─────────────────────────────────────────────────────

describe("setExecutionMode()", () => {
  afterEach(() => { vi.resetAllMocks(); });

  it("calls db.update when row exists (update path)", async () => {
    dbMock.select.mockReturnValueOnce(makeSelectChain([{ id: "uuid-1" }]));
    dbMock.update.mockReturnValueOnce(makeUpdateChain());

    const { setExecutionMode } = await import("../lib/execution-mode.js");
    await setExecutionMode(true);

    expect(dbMock.update).toHaveBeenCalledTimes(1);
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it("sets currentValue='1' for live=true via update", async () => {
    let captured: unknown;
    dbMock.select.mockReturnValueOnce(makeSelectChain([{ id: "uuid-1" }]));
    dbMock.update.mockReturnValueOnce(makeUpdateChain((vals) => { captured = vals; }));

    const { setExecutionMode } = await import("../lib/execution-mode.js");
    await setExecutionMode(true);

    expect((captured as any).currentValue).toBe("1");
  });

  it("sets currentValue='0' for live=false via update", async () => {
    let captured: unknown;
    dbMock.select.mockReturnValueOnce(makeSelectChain([{ id: "uuid-1" }]));
    dbMock.update.mockReturnValueOnce(makeUpdateChain((vals) => { captured = vals; }));

    const { setExecutionMode } = await import("../lib/execution-mode.js");
    await setExecutionMode(false);

    expect((captured as any).currentValue).toBe("0");
  });

  it("calls db.insert when no existing row found (insert path)", async () => {
    dbMock.select.mockReturnValueOnce(makeSelectChain([]));
    dbMock.insert.mockReturnValueOnce({ values: vi.fn().mockResolvedValue([]) });

    const { setExecutionMode } = await import("../lib/execution-mode.js");
    await setExecutionMode(true);

    expect(dbMock.insert).toHaveBeenCalledTimes(1);
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("insert uses domain='paper' and numeric currentValue='1'", async () => {
    let capturedValues: unknown;
    dbMock.select.mockReturnValueOnce(makeSelectChain([]));
    dbMock.insert.mockReturnValueOnce({
      values: vi.fn().mockImplementation((vals: unknown) => {
        capturedValues = vals;
        return Promise.resolve([]);
      }),
    });

    const { setExecutionMode } = await import("../lib/execution-mode.js");
    await setExecutionMode(true);

    expect((capturedValues as any).domain).toBe("paper");
    expect((capturedValues as any).currentValue).toBe("1");
  });

  it("never stores string 'true' (NUMERIC column parity guard)", async () => {
    let capturedValues: unknown;
    dbMock.select.mockReturnValueOnce(makeSelectChain([]));
    dbMock.insert.mockReturnValueOnce({
      values: vi.fn().mockImplementation((vals: unknown) => {
        capturedValues = vals;
        return Promise.resolve([]);
      }),
    });

    const { setExecutionMode } = await import("../lib/execution-mode.js");
    await setExecutionMode(true);

    expect((capturedValues as any).currentValue).not.toBe("true");
    expect((capturedValues as any).currentValue).not.toBe(true);
    expect((capturedValues as any).currentValue).toBe("1");
  });
});
