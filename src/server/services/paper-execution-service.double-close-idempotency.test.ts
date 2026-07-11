/**
 * paper-execution-service.double-close-idempotency.test.ts
 *
 * CRIT-1 (deep-scan 2026-07-09, operator-ratified) — failure injection for the
 * double-close P&L race. Two independent async paths (a per-symbol stop/trail/
 * time-exit and a cross-symbol 95%-DLL forceCloseAllPositions) can both call
 * closePosition(sameId) in the same tick window. Before the fix, both inserted a
 * paper_trades row and both credited equity → duplicate trade + doubled P&L.
 *
 * The fix: closePosition atomically CLAIMS the close via
 *   update(paperPositions).set(...).where(and(eq(id), isNull(closedAt))).returning({id})
 * BEFORE inserting the trade. The loser's claim matches 0 rows → returns
 * { trade: null, alreadyClosed: true } and inserts NOTHING.
 *
 * This test simulates the race by making the FIRST close's claim match a row
 * (winner) and a SECOND close's claim match 0 rows (loser, position already
 * closed by the winner). It asserts exactly ONE trade insert + the loser is a
 * benign no-op. It RED-fails against the pre-fix code (which had no claim guard,
 * so both closes would insert).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Captured trade inserts (the thing that must NOT duplicate) ────────────────
let tradeInserts: Array<Record<string, unknown>> = [];
// Controls whether the guarded CLAIM matches a row (winner) or 0 rows (loser).
let claimMatchesRow = true;

vi.mock("../db/index.js", () => {
  const makeSelectChain = (rows: unknown[]) => ({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  });

  const pos = {
    id: "pos-1",
    sessionId: "sess-1",
    symbol: "MES",
    side: "long",
    entryPrice: "5000",
    currentPrice: "5010",
    contracts: 1,
    unrealizedPnl: "50",
    entryTime: new Date("2026-01-15T15:00:00Z"),
    closedAt: null,
    correlationId: "corr-1",
    fillProbability: null,
    mae: null,
    mfe: null,
  };

  const tx = {
    // Guarded idempotency CLAIM: returns [{id}] for the winner, [] for the loser.
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          const p: any = Promise.resolve(undefined);
          p.returning = vi.fn().mockImplementation(() =>
            Promise.resolve(claimMatchesRow ? [{ id: "pos-1" }] : []),
          );
          return p;
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((row: Record<string, unknown>) => {
        // Only the trade insert carries pnl/holdDurationMs; audit rows don't.
        if ("pnl" in row || "holdDurationMs" in row) tradeInserts.push(row);
        return { returning: vi.fn().mockResolvedValue([{ id: "trade-1", ...row }]), catch: vi.fn() };
      }),
    }),
    select: vi.fn().mockImplementation(() => makeSelectChain([])),
  };

  return {
    db: {
      select: vi.fn().mockImplementation(() => makeSelectChain([pos])),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
      transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    },
  };
});

vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn(), PAPER_EXIT_EVENTS: {} }));
vi.mock("../index.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/tracing.js", () => ({ tracer: { startSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn() })) } }));
vi.mock("../scheduler.js", () => ({ onPaperTradeClose: vi.fn() }));
vi.mock("./paper-risk-gate.js", () => ({
  toEasternDateString: vi.fn(() => "2026-01-15"),
  toFuturesTradingDayString: vi.fn(() => "2026-01-15"),
  invalidateDailyLossCache: vi.fn(),
}));
vi.mock("../lib/python-runner.js", () => ({ runPythonModule: vi.fn().mockResolvedValue({ is_economic_event: false }) }));
vi.mock("../lib/roll-calendar-loader.js", () => ({ computeRollSpreadCost: vi.fn(async () => ({ estimatedSpreadCost: 0, rollDates: [] })) }));

import { closePosition } from "./paper-execution-service.js";

describe("closePosition — CRIT-1 double-close idempotency", () => {
  beforeEach(() => {
    tradeInserts = [];
    claimMatchesRow = true;
    vi.clearAllMocks();
  });

  it("WINNER: claim matches a row → inserts exactly one trade, returns a real trade", async () => {
    claimMatchesRow = true;
    const r = await closePosition("pos-1", 5010);
    expect(tradeInserts).toHaveLength(1);
    expect((r as any).alreadyClosed ?? false).toBe(false);
    expect((r as any).trade).not.toBeNull();
  });

  it("LOSER: claim matches 0 rows (already closed by concurrent path) → NO trade insert, benign no-op", async () => {
    claimMatchesRow = false;
    const r = await closePosition("pos-1", 5010);
    // The critical assertion: the losing close must insert NOTHING (no duplicate).
    expect(tradeInserts).toHaveLength(0);
    expect((r as any).alreadyClosed).toBe(true);
    expect((r as any).trade).toBeNull();
    expect((r as any).pnl).toBe(0);
  });
});
