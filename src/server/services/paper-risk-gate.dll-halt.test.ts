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
    // deep-scan long-tail re-verify (2026-07-06): freeze wall-clock to mid-RTH so the DOWNSTREAM
    // overnight-position gate (paper-risk-gate gate (e) — blocks outside 13:30–20:00 UTC when
    // firmConfig.overnightOk=false, true for Topstep) can't mask the DLL-gate assertions. The
    // "$800 ALLOWED" case false-RED'd whenever CI ran outside RTH (it reaches gate (e); the other
    // cases return early at the DLL gate). Fake ONLY Date (not setTimeout) to avoid async interference.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-06T15:00:00Z")); // Monday 11:00 ET — mid-RTH
    todayKey = await makeTodayKey();
    __resetDailyLossCacheForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    __resetDailyLossCacheForTests();
    vi.useRealTimers();
  });

  // deep-scan long-tail F-1 (operator-approved 2026-07-06): Topstep DLL base UNIFIED to the trailing-DD
  // ($2,000 for 50k via resolvePersonalDllDollars) → halt = 0.67 × $2,000 = $1,340, matching kill-switch
  // Layer 2 + cross-symbol-pnl. Was $670 (0.67 × $1,000 daily-loss-limit) — a 2× contradiction. These
  // Topstep thresholds now assert $1,340; startingCapital=50_000 → TOPSTEP_TRAILING_DD_BY_SIZE[50000]=2000.
  it("Topstep: todayLoss=$1400 BLOCKED (>= $2000 * 0.67 = $1,340 trailing-DD base)", async () => {
    const session = makeSessionRow({ firmId: "topstep", lossToday: 1400, todayKey });
    wireDbMock(session, [session]);

    const result = await checkRiskGate("test-session-id", "MES", 6);

    expect(result.allowed).toBe(false);
    expect(result.check).toBe("daily_loss_limit");
    expect(result.reason).toMatch(/1340|67%|halt/i);
  });

  it("Topstep: todayLoss=$800 ALLOWED (< $1,340 — was BLOCKED under the stale $670 basis)", async () => {
    // Regression guard for F-1: $800 is now allowed (below the unified $1,340 halt), where the old
    // $670 basis would have blocked it. Proves the unification took effect + is non-tautological.
    const session = makeSessionRow({ firmId: "topstep", lossToday: 800, todayKey });
    wireDbMock(session, [session]);

    const result = await checkRiskGate("test-session-id", "MES", 6);

    expect(result.allowed).toBe(true);
  });

  it("Topstep: todayLoss=$1340 exactly BLOCKED (>= threshold, boundary)", async () => {
    const session = makeSessionRow({ firmId: "topstep", lossToday: 1340, todayKey });
    wireDbMock(session, [session]);

    const result = await checkRiskGate("test-session-id", "MES", 6);

    expect(result.allowed).toBe(false);
    expect(result.check).toBe("daily_loss_limit");
  });

  it("MFFU (dailyLossLimit=1000): $2000 loss IS blocked by the DLL gate", async () => {
    // deep-scan Paper re-cert (stale-fixture fix): MFFU dailyLossLimit is now 1000 (was null) per the
    // 2026-07-02 firm data-fix + the ts-python-firm-rules parity repair — so the DLL gate applies to
    // MFFU too. $2000 loss exceeds the 67% halt band (0.67 × 1000 = $670) → the gate BLOCKS.
    const session = makeSessionRow({ firmId: "mffu", lossToday: 2000, todayKey });
    wireDbMock(session, [session]);

    const result = await checkRiskGate("test-session-id", "MES", 6);

    expect(result.allowed).toBe(false);
    expect(result.check).toBe("daily_loss_limit");
  });

  it("Topstep: todayLoss=$1500 BLOCKED by 67% gate (halt is 67% of the $2,000 base, not 100%)", async () => {
    // The 67%-not-100% invariant, on the unified trailing-DD base: $1,500 is below the full $2,000
    // trailing-DD but above the $1,340 halt → blocked. (Old test used $999 against the stale $670 basis.)
    const session = makeSessionRow({ firmId: "topstep", lossToday: 1500, todayKey });
    wireDbMock(session, [session]);

    const result = await checkRiskGate("test-session-id", "MES", 6);

    expect(result.allowed).toBe(false);
    expect(result.check).toBe("daily_loss_limit");
  });
});
