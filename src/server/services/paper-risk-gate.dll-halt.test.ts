/**
 * paper-risk-gate.dll-halt.test.ts
 *
 * TDD tests for F-1 (DLL halt at DLL_HALT_PCT * limit, not 100%) and
 * the MFFU null-DLL pass-through.
 *
 * These tests exercise checkRiskGate() via a mock DB — no real database.
 * The mock pattern injects fake session data matching the DB select shape
 * used inside checkRiskGate().
 *
 * F-1 invariants:
 *   - Topstep: HALT new entries when todayLoss >= firmConfig.dailyLossLimit * DLL_HALT_PCT
 *   - Topstep: ALLOW new entries when todayLoss < dailyLossLimit * DLL_HALT_PCT
 *   - MFFU: dailyLossLimit is null → DLL gate is skipped entirely
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock DB before importing the module under test ──────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("../index.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../lib/tracing.js", () => ({
  tracer: {
    startSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn() })),
  },
}));

// ── Import after mocks are registered ──────────────────────────────────────

import { db } from "../db/index.js";
import { checkRiskGate, __resetDailyLossCacheForTests } from "./paper-risk-gate.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal session row that checkRiskGate() needs.
 * Sets dailyPnlBreakdown so todayLoss comes out to `lossToday`.
 *
 * We hard-code the CME trading day key to the value toFuturesTradingDayString()
 * would compute — but we can't import that directly in the test without mocking
 * more internals. Instead we grab it by importing the pure utility directly.
 */
async function makeTodayKey(): Promise<string> {
  const { toFuturesTradingDayString } = await import("./paper-risk-gate.js");
  return toFuturesTradingDayString();
}

function makeSessionRow(opts: {
  firmId: string;
  lossToday: number;
  startingCapital?: number;
  currentEquity?: number;
  peakEquity?: number;
  realizedPeakEquity?: number;
  todayKey: string;
}) {
  const {
    firmId,
    lossToday,
    startingCapital = 50_000,
    currentEquity = 50_000,
    peakEquity = 50_000,
    realizedPeakEquity = 50_000,
    todayKey,
  } = opts;

  // A negative P&L of -lossToday on todayKey
  const dailyPnlBreakdown = lossToday > 0 ? { [todayKey]: -lossToday } : {};

  return {
    id: "test-session-id",
    firmId,
    config: { max_positions: 1 },
    startingCapital,
    currentEquity,
    peakEquity,
    realizedPeakEquity,
    dailyPnlBreakdown,
    status: "active",
  };
}

/**
 * Wire the DB mock to return the provided session + no open positions.
 */
function wireDbMock(sessionRow: object, activeSessions: object[] = []) {
  const dbMock = db as unknown as { select: ReturnType<typeof vi.fn> };

  dbMock.select.mockImplementation(() => {
    return {
      from: vi.fn().mockReturnValue({
        // positions query (has .where with and/isNull)
        where: vi.fn().mockImplementation((..._args: unknown[]) => {
          // Returns empty positions or active sessions depending on which
          // call this is. We differentiate by checking the DB call sequence.
          return Promise.resolve([]);
        }),
        // sessions query (has .where then .then)
        then: vi.fn().mockResolvedValue(sessionRow),
      }),
    };
  });

  // Two select calls happen in Promise.all:
  //   1. paperPositions (open positions) → []
  //   2. paperSessions (session lookup)  → sessionRow
  // Then later active sessions for global DLL → activeSessions
  let callIndex = 0;
  dbMock.select.mockImplementation(() => {
    const call = callIndex++;
    if (call === 0) {
      // open positions
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      };
    }
    if (call === 1) {
      // session lookup
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: (fn: (rows: object[]) => unknown) => Promise.resolve(fn([sessionRow])),
          }),
        }),
      };
    }
    // global daily loss query (active sessions)
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(activeSessions),
      }),
    };
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("F-1: paper-risk-gate DLL halt at DLL_HALT_PCT (67%), not 100%", () => {
  let todayKey: string;

  beforeEach(async () => {
    todayKey = await makeTodayKey();
    __resetDailyLossCacheForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    __resetDailyLossCacheForTests();
  });

  it("Topstep: todayLoss=$800 BLOCKED (>= $1000 * 0.67 = $670)", async () => {
    // $800 loss > $670 halt threshold — must be blocked
    // firmId="topstep" → getFirmAccount("topstep") → dailyLossLimit=1000
    const session = makeSessionRow({ firmId: "topstep", lossToday: 800, todayKey });
    wireDbMock(session, [session]);

    const result = await checkRiskGate("test-session-id", "MES", 6);

    expect(result.allowed).toBe(false);
    expect(result.check).toBe("daily_loss_limit");
    expect(result.reason).toMatch(/670|67%|halt/i);
  });

  it("Topstep: todayLoss=$600 ALLOWED (< $670 halt threshold)", async () => {
    // $600 < $670 — must be allowed (passes DLL gate)
    const session = makeSessionRow({ firmId: "topstep", lossToday: 600, todayKey });
    wireDbMock(session, [session]);

    const result = await checkRiskGate("test-session-id", "MES", 6);

    expect(result.allowed).toBe(true);
  });

  it("Topstep: todayLoss=$670 exactly BLOCKED (>= threshold, boundary)", async () => {
    const session = makeSessionRow({ firmId: "topstep", lossToday: 670, todayKey });
    wireDbMock(session, [session]);

    const result = await checkRiskGate("test-session-id", "MES", 6);

    expect(result.allowed).toBe(false);
    expect(result.check).toBe("daily_loss_limit");
  });

  it("MFFU (null dailyLossLimit): $2000 loss NOT blocked by DLL gate", async () => {
    // MFFU has dailyLossLimit=null — DLL gate must be entirely skipped
    const session = makeSessionRow({ firmId: "mffu", lossToday: 2000, todayKey });
    wireDbMock(session, [session]);

    const result = await checkRiskGate("test-session-id", "MES", 6);

    // Should not be blocked by daily_loss_limit check
    expect(result.check).not.toBe("daily_loss_limit");
  });

  it("Topstep: todayLoss=$999 (old 100% threshold) BLOCKED by 67% gate", async () => {
    // Old code would allow $999 < $1000; new code must block at $670
    const session = makeSessionRow({ firmId: "topstep", lossToday: 999, todayKey });
    wireDbMock(session, [session]);

    const result = await checkRiskGate("test-session-id", "MES", 6);

    expect(result.allowed).toBe(false);
    expect(result.check).toBe("daily_loss_limit");
  });
});
