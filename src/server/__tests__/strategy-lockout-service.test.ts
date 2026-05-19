/**
 * Strategy Lockout Service — Tier 5.3 (W5b)
 *
 * Tests for:
 *   1. daily_loss_kill audit event → lockout row written with locked_until = now() + 24h
 *   2. Active lockout → returns lockout row (caller blocks entry)
 *   3. Expired / empty → getActiveLockout returns null (caller allows entry)
 *   4. Multiple lockouts for same strategy → latest (highest locked_until) returned
 *   5. DB errors → fail-open (null returned, not thrown)
 *   6. LOCKOUT_DURATION_HOURS is 24
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (inline factories avoid vi.mock hoisting variable issue) ───────────

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })),
  },
}));
vi.mock("../db/schema.js", () => ({
  strategyLockouts: { id: "id", strategyId: "strategy_id", lockedUntil: "locked_until" },
  strategies: {},
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ _eq: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
  gt: vi.fn((a: unknown, b: unknown) => ({ _gt: [a, b] })),
  desc: vi.fn((a: unknown) => ({ _desc: a })),
}));

import { db } from "../db/index.js";
import {
  writeLockoutFromKillEvent,
  getActiveLockout,
  LOCKOUT_DURATION_HOURS,
} from "../services/strategy-lockout-service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLockoutRow(overrides: Partial<{
  id: string;
  strategyId: string;
  lockedUntil: Date;
  reason: string;
  triggeredByKillId: string | null;
  createdAt: Date;
}> = {}) {
  return {
    id: "lock-1",
    strategyId: "strat-001",
    lockedUntil: new Date(Date.now() + 12 * 60 * 60 * 1000),
    reason: "daily_loss_kill",
    triggeredByKillId: "audit-abc",
    createdAt: new Date(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("writeLockoutFromKillEvent", () => {
  let mockInsertValues: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertValues = vi.fn().mockResolvedValue(undefined);
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: mockInsertValues });
  });

  it("writes a lockout row with locked_until ≈ now() + 24h", async () => {
    const before = Date.now();
    await writeLockoutFromKillEvent({
      strategyId: "strat-001",
      killAuditId: "audit-abc",
      reason: "daily_loss_kill",
    });
    const after = Date.now();

    expect(mockInsertValues).toHaveBeenCalledOnce();
    const row = mockInsertValues.mock.calls[0][0] as {
      strategyId: string;
      lockedUntil: Date;
      reason: string;
      triggeredByKillId: string | null;
    };

    expect(row.strategyId).toBe("strat-001");
    expect(row.reason).toBe("daily_loss_kill");
    expect(row.triggeredByKillId).toBe("audit-abc");

    const lockedUntilMs = row.lockedUntil.getTime();
    const expectedMin = before + LOCKOUT_DURATION_HOURS * 3600_000;
    const expectedMax = after + LOCKOUT_DURATION_HOURS * 3600_000 + 5000;
    expect(lockedUntilMs).toBeGreaterThanOrEqual(expectedMin);
    expect(lockedUntilMs).toBeLessThanOrEqual(expectedMax);
  });

  it("sets triggeredByKillId = null for manual lockouts", async () => {
    await writeLockoutFromKillEvent({
      strategyId: "strat-002",
      killAuditId: null,
      reason: "manual",
    });
    const row = mockInsertValues.mock.calls[0][0] as { triggeredByKillId: string | null };
    expect(row.triggeredByKillId).toBeNull();
  });

  it("does NOT throw if DB insert fails (logs error, swallows)", async () => {
    mockInsertValues.mockRejectedValueOnce(new Error("DB gone"));
    await expect(
      writeLockoutFromKillEvent({ strategyId: "strat-003", killAuditId: "x", reason: "daily_loss_kill" })
    ).resolves.not.toThrow();
  });
});

describe("getActiveLockout", () => {
  let mockSelectLimit: ReturnType<typeof vi.fn>;
  let mockSelectOrderBy: ReturnType<typeof vi.fn>;
  let mockSelectWhere: ReturnType<typeof vi.fn>;
  let mockSelectFrom: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectLimit = vi.fn();
    mockSelectOrderBy = vi.fn(() => ({ limit: mockSelectLimit }));
    mockSelectWhere = vi.fn(() => ({ orderBy: mockSelectOrderBy }));
    mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: mockSelectFrom });
  });

  it("returns the lockout row when an active lockout exists", async () => {
    const row = makeLockoutRow();
    mockSelectLimit.mockResolvedValueOnce([row]);

    const result = await getActiveLockout("strat-001");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("lock-1");
    expect(result!.reason).toBe("daily_loss_kill");
  });

  it("returns null when no active lockout exists (empty result)", async () => {
    mockSelectLimit.mockResolvedValueOnce([]);
    const result = await getActiveLockout("strat-001");
    expect(result).toBeNull();
  });

  it("returns null and does NOT throw when DB query errors (fail-open)", async () => {
    mockSelectLimit.mockRejectedValueOnce(new Error("connection lost"));
    const result = await getActiveLockout("strat-001");
    expect(result).toBeNull();
  });

  it("returns the first row when multiple are returned (latest ordered by locked_until DESC)", async () => {
    const latest = makeLockoutRow({ id: "lock-latest", lockedUntil: new Date(Date.now() + 20 * 3600_000) });
    const older = makeLockoutRow({ id: "lock-older", lockedUntil: new Date(Date.now() + 10 * 3600_000) });
    // DB returns already ordered DESC — first row is latest
    mockSelectLimit.mockResolvedValueOnce([latest, older]);

    const result = await getActiveLockout("strat-001");
    expect(result!.id).toBe("lock-latest");
  });
});

describe("LOCKOUT_DURATION_HOURS", () => {
  it("is exactly 24", () => {
    expect(LOCKOUT_DURATION_HOURS).toBe(24);
  });
});
