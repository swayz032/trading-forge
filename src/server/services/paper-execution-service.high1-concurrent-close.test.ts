/**
 * HIGH#1 (fresh-scan-3, 2026-07-12) — concurrent-close skip-path coverage.
 *
 * The grader's re-verification flagged that HIGH#1's ACTUAL new behavior — the guarded
 * MTM UPDATE skipping when it matches 0 rows (position closed concurrently between the
 * open-positions SELECT and the MTM UPDATE) — had ZERO CI coverage; only the mock plumbing
 * was tested. This file closes that gap with a direct, isolated assertion.
 *
 * Why it matters (capital safety): without the `WHERE ... AND closedAt IS NULL` guard, a
 * position closed concurrently (kill-switch L2/L3 force-close, dashboard status poll,
 * /api/paper/execute/close, or the roll-sweep cron) would have its unrealized MTM delta added
 * to session currentEquity ON TOP of the realized netPnl the racing close already booked —
 * double-counting P&L into the Layer-3 trailing-DD gate input (fail-OPEN on a capital-safety
 * gate). The guard: if `.returning({id})` yields 0 rows → `continue` (skip delta + positionsUpdated++).
 *
 * Observable: updatePositionPrices returns { positionsUpdated }. A skipped position never reaches
 * `positionsUpdated++`, and the session-equity update at ~4866 is gated on `positionsUpdated > 0`.
 * So positionsUpdated === 0 on a concurrent-close proves the delta never reached currentEquity.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Controls what the guarded MTM UPDATE's .returning({id}) resolves to.
// []  = the WHERE (closedAt IS NULL) matched 0 rows → position closed concurrently → skip.
// [x] = matched a live row → delta applies (pre-guard-equivalent behavior).
let mtmReturningRows: Array<{ id: string }> = [{ id: "pos-h1" }];
// Captures the session-equity update (db.update(paperSessions)) so we can assert it does NOT
// fire on a pure concurrent-close (positionsUpdated===0 → gate at ~4866 is false).
let sessionEquityUpdates: Array<Record<string, unknown>> = [];

vi.mock("../db/index.js", () => {
  const makeUpdate = () => ({
    set: vi.fn((vals: Record<string, unknown>) => {
      // The session-equity MTM update sets `currentEquity` via a sql`` fragment; the per-position
      // MTM update sets currentPrice/unrealizedPnl/mae/mfe. Distinguish by the presence of currentEquity.
      if ("currentEquity" in vals) {
        sessionEquityUpdates.push({ ...vals });
        return { where: vi.fn().mockResolvedValue(undefined) };
      }
      // Per-position MTM update: expose .where(...).returning() controlled by mtmReturningRows.
      const p: any = Promise.resolve(undefined);
      p.returning = vi.fn(() => Promise.resolve(mtmReturningRows));
      return { where: vi.fn().mockReturnValue(p) };
    }),
  });
  return {
    db: {
      select: vi.fn(),
      update: vi.fn(makeUpdate),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ catch: vi.fn() })) })),
    },
  };
});

vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/tracing.js", () => ({
  tracer: { startSpan: vi.fn().mockReturnValue({ setAttribute: vi.fn(), end: vi.fn() }) },
}));
vi.mock("../scheduler.js", () => ({ onPaperTradeClose: vi.fn() }));
vi.mock("./paper-risk-gate.js", () => ({
  toEasternDateString: vi.fn().mockReturnValue("2026-01-15"),
  toFuturesTradingDayString: vi.fn().mockReturnValue("2026-01-15"),
  invalidateDailyLossCache: vi.fn(),
}));
vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn().mockResolvedValue({ is_economic_event: false }),
}));

import { updatePositionPrices } from "./paper-execution-service.js";
import { db } from "../db/index.js";

// MES CONTRACT_SPECS: pointValue = 5. 1 contract, +10 pts = +$50 unrealized.
function buildLivePosition(overrides: Record<string, unknown> = {}) {
  return {
    id: "pos-h1",
    sessionId: "sess-h1",
    symbol: "MES",
    side: "long",
    entryPrice: "5000",
    currentPrice: "5000",
    contracts: 1,
    unrealizedPnl: "0",
    previousUnrealizedPnl: "0",  // baseline 0 → a +$50 move produces a non-zero delta
    entryTime: new Date("2026-01-15T15:00:00Z"),
    closedAt: null,
    trailHwm: null,
    barsHeld: 0,
    mae: null,
    mfe: null,
    ...overrides,
  };
}

function setupSelect(positions: ReturnType<typeof buildLivePosition>[]) {
  let selectCallCount = 0;
  (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
    selectCallCount++;
    // 1st select = open positions; any later select (session re-read) = [] to keep the harness minimal.
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(selectCallCount === 1 ? positions : []),
      }),
    };
  });
}

beforeEach(() => {
  mtmReturningRows = [{ id: "pos-h1" }];
  sessionEquityUpdates = [];
  vi.clearAllMocks();
});

describe("HIGH#1 — updatePositionPrices concurrent-close guard", () => {
  it("CONTROL: a live position (guard matches 1 row) applies its MTM delta (positionsUpdated=1)", async () => {
    setupSelect([buildLivePosition()]);
    mtmReturningRows = [{ id: "pos-h1" }]; // WHERE closedAt IS NULL matched the live row

    // +10 pts on MES 1 contract = +$50 unrealized, delta = 50 - 0 = 50 (non-zero).
    const result = await updatePositionPrices("sess-h1", {
      MES: { close: 5010, high: 5010, low: 5000 },
    });

    expect(result.positionsUpdated).toBe(1);
    // Session equity update fires because positionsUpdated>0 && delta!==0.
    expect(sessionEquityUpdates.length).toBe(1);
  });

  it("SKIP: a concurrently-closed position (guard matches 0 rows) is skipped — no delta, no equity update", async () => {
    // Same live-looking position row from the open-positions SELECT, but by the time the guarded
    // MTM UPDATE runs, a racing close set closedAt → the WHERE matches 0 rows.
    setupSelect([buildLivePosition()]);
    mtmReturningRows = []; // WHERE (id AND closedAt IS NULL) matched nothing → concurrent close

    const result = await updatePositionPrices("sess-h1", {
      MES: { close: 5010, high: 5010, low: 5000 },
    });

    // The position is skipped: positionsUpdated never incremented for it.
    expect(result.positionsUpdated).toBe(0);
    // And critically, its unrealized delta never reached the session currentEquity update
    // (the ~4866 gate `positionsUpdated > 0` is false) — no double-count into L3 trailing-DD.
    expect(sessionEquityUpdates.length).toBe(0);
  });
});
