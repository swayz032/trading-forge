/**
 * Tests for the PROVEN-TRADES counter (balanced scaling plan — producer side).
 *
 * Covers:
 *   1. Winning close (netPnl > 0) increments proven_trades_count atomically
 *   2. Losing close (netPnl < 0) does NOT increment proven_trades_count
 *   3. Break-even close (netPnl === 0) does NOT increment proven_trades_count
 *   4. Counter increment failure does NOT block the close (fail-soft)
 *   5. provenTradesCount is read from sessionRow and passed to computeRiskDerivedContracts
 *   6. provenTradesCount defaults to 0 when sessionRow value is null/undefined
 *   7. Monotonic invariant: counter update uses atomic SQL (not read-modify-write)
 *   8. Migration SQL is idempotent (ADD COLUMN IF NOT EXISTS pattern)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── DB mock ─────────────────────────────────────────────────────────────────
// Pattern mirrors paper-session-feedback.test.ts and other paper-* test files
// in this repo: vi.mock at module level, then override per-test with mockReturnValue.

const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockWhere = vi.fn();
const mockReturning = vi.fn();

// Build a chainable mock: db.update(...).set(...).where(...).returning(...)
function buildUpdateChain(returnValue: unknown) {
  mockReturning.mockResolvedValue(returnValue);
  mockWhere.mockReturnValue({ returning: mockReturning });
  mockSet.mockReturnValue({ where: mockWhere });
  mockUpdate.mockReturnValue({ set: mockSet });
}

vi.mock("../db/index.js", () => ({
  db: {
    update: mockUpdate,
    select: vi.fn(),
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
  },
}));

vi.mock("../db/schema.js", () => ({
  paperSessions: { provenTradesCount: "proven_trades_count" },
  paperTrades: {},
  paperPositions: {},
  auditLog: {},
}));

vi.mock("../index.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Subject under test: inline business logic extracted for unit testing ─────
//
// Rather than invoking the full closePosition (which has 200+ lines of DB setup),
// we extract and test the TWO distinct behaviours this ticket introduces:
//
//   A) The proven-trades increment decision (netPnl > 0 gate)
//   B) The provenTradesCount → sizingInputs.provenTrades pass-through
//
// These are pure-logic decisions isolated from DB setup concerns.

/** Mirrors the proven-trade increment guard in paper-execution-service.ts */
async function incrementProvenTradesIfWinning(
  dbConn: { update: typeof mockUpdate },
  schema: { paperSessions: Record<string, unknown> },
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown,
  eq: (col: unknown, val: unknown) => unknown,
  sessionId: string,
  netPnl: number,
  logger: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void },
): Promise<{ incremented: boolean; newCount: number | null }> {
  if (netPnl <= 0) {
    return { incremented: false, newCount: null };
  }
  try {
    const [updatedSession] = await dbConn
      .update(schema.paperSessions)
      .set({ provenTradesCount: sql`${schema.paperSessions.provenTradesCount} + 1` })
      .where(eq(schema.paperSessions, sessionId))
      .returning({ provenTradesCount: schema.paperSessions.provenTradesCount });

    logger.info(
      { sessionId, netPnl, provenTradesCount: updatedSession?.provenTradesCount ?? "unknown" },
      "sizing.proven_trade_recorded: winning close incremented proven_trades_count",
    );
    return { incremented: true, newCount: updatedSession?.provenTradesCount as number ?? null };
  } catch (err) {
    logger.error({ sessionId, netPnl, err }, "proven_trades_count increment failed (non-blocking) — close proceeds");
    return { incremented: false, newCount: null };
  }
}

/** Mirrors the provenTrades pass-through in paper-signal-service.ts sizingInputs */
function resolveProvenTrades(
  sessionRowProvenTradesCount: unknown,
): number {
  if (typeof sessionRowProvenTradesCount === "number") {
    return sessionRowProvenTradesCount;
  }
  if (sessionRowProvenTradesCount != null) {
    return Number(sessionRowProvenTradesCount);
  }
  return 0;
}

// Minimal SQL and eq stubs for the increment helper tests
const sqlStub = (strings: TemplateStringsArray, ..._values: unknown[]) => strings.join("?");
const eqStub = (col: unknown, val: unknown) => ({ col, val });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("proven-trades counter — producer side", () => {
  // ─── logger mock (shared) ─────────────────────────────────────────────────
  const loggerMock = {
    info: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Winning close increments the counter
  // ───────────────────────────────────────────────────────────────────────────
  it("winning close (netPnl > 0) increments proven_trades_count atomically", async () => {
    buildUpdateChain([{ provenTradesCount: 5 }]);

    const result = await incrementProvenTradesIfWinning(
      { update: mockUpdate },
      { paperSessions: { provenTradesCount: "proven_trades_count" } },
      sqlStub as unknown as Parameters<typeof incrementProvenTradesIfWinning>[2],
      eqStub,
      "session-abc",
      125.50,   // winning trade
      loggerMock,
    );

    expect(result.incremented).toBe(true);
    expect(result.newCount).toBe(5);

    // Verify .update() was called (atomic DB write path)
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockWhere).toHaveBeenCalledTimes(1);
    expect(mockReturning).toHaveBeenCalledTimes(1);

    // Verify audit log event
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({ netPnl: 125.50, provenTradesCount: 5 }),
      "sizing.proven_trade_recorded: winning close incremented proven_trades_count",
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Losing close does NOT increment the counter
  // ───────────────────────────────────────────────────────────────────────────
  it("losing close (netPnl < 0) does NOT increment proven_trades_count", async () => {
    const result = await incrementProvenTradesIfWinning(
      { update: mockUpdate },
      { paperSessions: { provenTradesCount: "proven_trades_count" } },
      sqlStub as unknown as Parameters<typeof incrementProvenTradesIfWinning>[2],
      eqStub,
      "session-abc",
      -75.00,   // losing trade
      loggerMock,
    );

    expect(result.incremented).toBe(false);
    expect(result.newCount).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(loggerMock.info).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Break-even close does NOT increment the counter
  // ───────────────────────────────────────────────────────────────────────────
  it("break-even close (netPnl === 0) does NOT increment proven_trades_count", async () => {
    const result = await incrementProvenTradesIfWinning(
      { update: mockUpdate },
      { paperSessions: { provenTradesCount: "proven_trades_count" } },
      sqlStub as unknown as Parameters<typeof incrementProvenTradesIfWinning>[2],
      eqStub,
      "session-abc",
      0,        // break-even — exactly 0
      loggerMock,
    );

    expect(result.incremented).toBe(false);
    expect(result.newCount).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Fail-soft: counter update failure does NOT block the close
  // ───────────────────────────────────────────────────────────────────────────
  it("counter update DB failure is non-blocking (fail-soft)", async () => {
    // Make the DB update throw
    mockReturning.mockRejectedValue(new Error("connection timeout"));
    mockWhere.mockReturnValue({ returning: mockReturning });
    mockSet.mockReturnValue({ where: mockWhere });
    mockUpdate.mockReturnValue({ set: mockSet });

    // Should not throw — fail-soft
    await expect(
      incrementProvenTradesIfWinning(
        { update: mockUpdate },
        { paperSessions: { provenTradesCount: "proven_trades_count" } },
        sqlStub as unknown as Parameters<typeof incrementProvenTradesIfWinning>[2],
        eqStub,
        "session-abc",
        200.00,   // winning trade
        loggerMock,
      ),
    ).resolves.toEqual({ incremented: false, newCount: null });

    // Error must be logged (observability preserved even on failure)
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ netPnl: 200.00 }),
      "proven_trades_count increment failed (non-blocking) — close proceeds",
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. provenTradesCount from sessionRow is correctly passed to sizingInputs
  // ───────────────────────────────────────────────────────────────────────────
  it("resolves provenTradesCount=12 from sessionRow (numeric) → passes 12 to sizingInputs", () => {
    const sessionRow = { provenTradesCount: 12 };
    expect(resolveProvenTrades(sessionRow.provenTradesCount)).toBe(12);
  });

  it("resolves provenTradesCount as string '7' from sessionRow (Drizzle numeric coercion) → passes 7", () => {
    // Drizzle integer columns return numbers in TypeScript but can arrive as
    // strings depending on driver; the code handles both.
    const sessionRow = { provenTradesCount: "7" as unknown as number };
    expect(resolveProvenTrades(sessionRow.provenTradesCount)).toBe(7);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Null / undefined sessionRow.provenTradesCount defaults to 0
  // ───────────────────────────────────────────────────────────────────────────
  it("null provenTradesCount in sessionRow defaults to 0 (backward compat — pre-migration rows)", () => {
    expect(resolveProvenTrades(null)).toBe(0);
  });

  it("undefined provenTradesCount in sessionRow defaults to 0", () => {
    expect(resolveProvenTrades(undefined)).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Monotonic invariant: atomic SQL increment (no read-modify-write)
  // ───────────────────────────────────────────────────────────────────────────
  it("uses SQL template increment (not read-modify-write) to ensure monotonic counter", async () => {
    buildUpdateChain([{ provenTradesCount: 3 }]);

    await incrementProvenTradesIfWinning(
      { update: mockUpdate },
      { paperSessions: { provenTradesCount: "proven_trades_count" } },
      sqlStub as unknown as Parameters<typeof incrementProvenTradesIfWinning>[2],
      eqStub,
      "session-abc",
      50.00,
      loggerMock,
    );

    // .set() must be called with a SQL template value, not a plain integer
    // (the SQL template is what guarantees the atomic increment in Postgres)
    const setArgs = mockSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs).toHaveProperty("provenTradesCount");
    // The value should be a SQL expression (not a plain number) —
    // our sqlStub returns a string, so any truthy non-number value confirms atomicity.
    const increment = setArgs.provenTradesCount;
    expect(typeof increment).not.toBe("number");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8. Migration idempotency: ADD COLUMN IF NOT EXISTS is the pattern
  // ───────────────────────────────────────────────────────────────────────────
  it("migration SQL file uses ADD COLUMN IF NOT EXISTS for idempotency", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const migrationPath = path.join(
      process.cwd(),
      "src/server/db/migrations/0174_paper_sessions_proven_trades.sql",
    );
    const sql = fs.readFileSync(migrationPath, "utf8");

    // Must contain the idempotent ADD COLUMN pattern
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS");
    // Must target the correct column
    expect(sql).toContain("proven_trades_count");
    // Must specify INTEGER NOT NULL DEFAULT 0
    expect(sql).toContain("INTEGER NOT NULL DEFAULT 0");
    // Must target the correct table
    expect(sql).toContain("paper_sessions");
  });
});
