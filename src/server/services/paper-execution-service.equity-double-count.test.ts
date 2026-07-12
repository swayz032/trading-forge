/**
 * paper-execution-service.equity-double-count.test.ts
 *
 * MED (freshscan6 2026-07-12, capital-safety equity-accounting fix) — regression coverage
 * for the closePosition equity double-count bug.
 *
 * THE BUG: updatePositionPrices credits a position's per-bar unrealized MTM into
 * session.currentEquity every bar (`currentEquity += totalUnrealizedDelta`), and advances
 * the position row's `previousUnrealizedPnl` to match. Over a multi-bar hold, currentEquity
 * accumulates the position's FULL unrealized — previousUnrealizedPnl IS the amount already
 * baked into currentEquity for that position. closePosition then did
 * `currentEquity = currentEquity + netPnl` — adding the FULL realized P&L WITHOUT backing out
 * the already-credited unrealized, so every close stranded its pre-close unrealized in
 * currentEquity permanently. This inflates currentEquity AND realizedPeakEquity (the
 * authoritative Topstep/Apex trailing-DD high-water-mark that kill-switch.ts reads), masking
 * real drawdown room and overstating session P&L / promotion-gate finalPnl.
 *
 * THE FIX: closePosition now applies `netPnl - bakedInUnrealizedPnl` to currentEquity /
 * peakEquity / realizedPeakEquity instead of bare `netPnl`. `bakedInUnrealizedPnl` comes from
 * two different sources depending on the caller shape (see the doc comment on
 * `precedingUnrealizedPnlOverride` at the top of closePosition in paper-execution-service.ts):
 *   - DIRECT callers (forceCloseAllPositions / checkRollAndFlatten / manual-close route /
 *     feed-silence auto-close / paper-signal-service management exits) never advance
 *     previousUnrealizedPnl before calling closePosition, so the row-locked value read
 *     atomically inside the closedAt claim is correct — no override needed.
 *   - IN-LOOP callers (updatePositionPrices' own stop-breach block + applyExitDecision, both
 *     invoked from WITHIN the same per-position bar iteration) already advanced the row's
 *     previousUnrealizedPnl to THIS bar's fresh value via the unconditional per-position MTM
 *     UPDATE that runs before these call sites — but the AGGREGATE currentEquity write for
 *     that fresh delta is deferred to the end of the whole updatePositionPrices call. A fresh
 *     row-read at close time would therefore return the WRONG (already-advanced) value, so
 *     these callers pass `precedingUnrealizedPnl` explicitly (their pre-bar in-memory value).
 *
 * These tests exercise the genuinely-uncovered scenario the finding called out: a position
 * that ACCUMULATES cross-bar MTM (previousUnrealizedPnl advances to a non-zero value across
 * multiple bars) and THEN closes — via both a direct-caller close and an in-loop
 * updatePositionPrices exit (stop-breach) — asserting the equity delta actually applied to
 * currentEquity/peakEquity/realizedPeakEquity equals (realized netPnl - baked-in unrealized),
 * not the stranded-unrealized-inflated bare netPnl. Every pre-existing equity test in this repo
 * seeds previousUnrealizedPnl=0 and never accumulates, so this gap was real.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Shared capture state ───────────────────────────────────────────────────
let tradeInserts: Array<Record<string, unknown>> = [];
let sessionEquityUpdates: Array<Record<string, unknown>> = [];
// Controls what the closedAt claim's `.returning()` resolves to (row-locked read).
let claimReturnRows: Array<{ id: string; contracts: number; previousUnrealizedPnl: string }> = [];
// Controls what the per-position MTM UPDATE's `.returning({id})` resolves to (HIGH#1 guard).
let mtmReturningRows: Array<{ id: string }> = [];

/**
 * Extracts the raw numeric ${} interpolations from a drizzle-orm `sql` template fragment.
 * drizzle's SQL.queryChunks is an array alternating StringChunk objects, column refs, and
 * the raw JS values passed to each ${}. Our equityDelta interpolations are always `number`,
 * and no other interpolation type in these fragments is a bare number (column refs are
 * objects), so filtering by typeof reliably extracts them in template order.
 */
function extractNumberParams(sqlFrag: unknown): number[] {
  const chunks = (sqlFrag as { queryChunks?: unknown[] } | undefined)?.queryChunks;
  if (!Array.isArray(chunks)) return [];
  return chunks.filter((c): c is number => typeof c === "number");
}

function buildPosition(overrides: Record<string, unknown> = {}) {
  return {
    id: "pos-1",
    sessionId: "sess-1",
    symbol: "MES",
    side: "long",
    entryPrice: "5000",
    currentPrice: "5000",
    contracts: 1,
    unrealizedPnl: "0",
    previousUnrealizedPnl: "0",
    entryTime: new Date("2026-01-15T15:00:00Z"),
    closedAt: null,
    correlationId: "corr-1",
    fillProbability: null,
    mae: null,
    mfe: null,
    trailHwm: null,
    initialStopPrice: null,
    highSinceEntryPrice: null,
    lowSinceEntryPrice: null,
    exitPlan: null,
    tp1Filled: false,
    tp2Filled: false,
    currentExitStyle: "C",
    ...overrides,
  };
}

vi.mock("../db/index.js", () => {
  const makeSelectChain = (rows: unknown[]) => ({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  });

  // Positions returned by every `db.select` call (outer, non-tx). Set per-test via
  // the module-level `__selectRows` array (mutated by tests before invoking).
  const tx = {
    update: vi.fn((_table?: unknown) => ({
      set: vi.fn((vals: Record<string, unknown>) => {
        if ("currentEquity" in vals) {
          sessionEquityUpdates.push({ ...vals });
          return { where: vi.fn().mockResolvedValue(undefined) };
        }
        if ("dailyPnlBreakdown" in vals) {
          return { where: vi.fn().mockResolvedValue(undefined) };
        }
        // The closedAt idempotency claim on paperPositions.
        const p: any = Promise.resolve(undefined);
        p.returning = vi.fn().mockImplementation(() => Promise.resolve(claimReturnRows));
        return { where: vi.fn().mockReturnValue(p) };
      }),
    })),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((row: Record<string, unknown>) => {
        if ("pnl" in row || "holdDurationMs" in row) tradeInserts.push(row);
        return { returning: vi.fn().mockResolvedValue([{ id: "trade-1", ...row }]), catch: vi.fn() };
      }),
    }),
    select: vi.fn().mockImplementation(() => makeSelectChain(__selectRows)),
  };

  return {
    __esModule: true,
    db: {
      select: vi.fn().mockImplementation(() => makeSelectChain(__selectRows)),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ catch: vi.fn(), returning: vi.fn().mockResolvedValue([]) }) }),
      update: vi.fn((_table?: unknown) => ({
        set: vi.fn((vals: Record<string, unknown>) => {
          if ("currentEquity" in vals) {
            sessionEquityUpdates.push({ ...vals });
            return { where: vi.fn().mockResolvedValue(undefined) };
          }
          // Per-position MTM UPDATE (updatePositionPrices, HIGH#1-guarded).
          const p: any = Promise.resolve(undefined);
          p.returning = vi.fn().mockImplementation(() => Promise.resolve(mtmReturningRows));
          return { where: vi.fn().mockReturnValue(p) };
        }),
      })),
      transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    },
  };
});

// Module-level rows array the mock factory closes over — mutated by tests via setSelectRows().
// (Declared with `var` so the vi.mock factory's hoisted closure sees the same binding.)
// eslint-disable-next-line no-var
var __selectRows: unknown[] = [];
function setSelectRows(rows: unknown[]) {
  __selectRows = rows;
}

vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn(), PAPER_EXIT_EVENTS: {
  TP1_FILLED: "tp1", TP2_FILLED: "tp2", TRAIL_TIGHTENED: "trail",
} }));
vi.mock("../index.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/tracing.js", () => ({ tracer: { startSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn() })) } }));
vi.mock("../scheduler.js", () => ({ onPaperTradeClose: vi.fn() }));
vi.mock("./paper-risk-gate.js", () => ({
  toEasternDateString: vi.fn(() => "2026-01-15"),
  toFuturesTradingDayString: vi.fn(() => "2026-01-15"),
  invalidateDailyLossCache: vi.fn(),
}));
vi.mock("../lib/python-runner.js", () => ({ runPythonModule: vi.fn().mockResolvedValue({ is_economic_event: false }) }));
// computeRollSpreadCost is SYNCHRONOUS in the real module (called without `await` in
// closePosition) — an async mock would return a Promise, silently poisoning netPnl to NaN.
vi.mock("../lib/roll-calendar-loader.js", () => ({ computeRollSpreadCost: vi.fn(() => ({ estimatedSpreadCost: 0, rollDates: [] })) }));
vi.mock("./pipeline-control-service.js", () => ({ isActive: vi.fn().mockResolvedValue(false) }));

import { closePosition, updatePositionPrices } from "./paper-execution-service.js";

beforeEach(() => {
  tradeInserts = [];
  sessionEquityUpdates = [];
  claimReturnRows = [];
  mtmReturningRows = [];
  setSelectRows([]);
  vi.clearAllMocks();
});

describe("closePosition — direct-caller equity double-count fix (forceCloseAllPositions/checkRollAndFlatten shape)", () => {
  it("backs out the row-locked accumulated unrealized when the position held across multiple prior bars", async () => {
    // previousUnrealizedPnl="80" simulates a position that accumulated +$80 of MTM unrealized
    // across several prior updatePositionPrices bars, already credited into session.currentEquity
    // via the aggregate delta write each of those bars. No caller-supplied override — this is the
    // direct-caller shape (forceCloseAllPositions / checkRollAndFlatten never advance
    // previousUnrealizedPnl themselves), so closePosition must self-derive from the row.
    const pos = buildPosition({ previousUnrealizedPnl: "80" });
    setSelectRows([pos]);
    claimReturnRows = [{ id: "pos-1", contracts: 1, previousUnrealizedPnl: "80" }];

    const result = await closePosition("pos-1", 5010); // no context.precedingUnrealizedPnl

    expect(tradeInserts).toHaveLength(1);
    const netPnl = Number(tradeInserts[0].pnl);
    // Sanity: this is a real, non-degenerate close (favorable exit).
    expect(netPnl).toBeGreaterThan(0);

    expect(sessionEquityUpdates).toHaveLength(1);
    const currentEquityDelta = extractNumberParams(sessionEquityUpdates[0].currentEquity)[0];
    const peakEquityDelta = extractNumberParams(sessionEquityUpdates[0].peakEquity)[0];
    const realizedPeakEquityDelta = extractNumberParams(sessionEquityUpdates[0].realizedPeakEquity)[0];

    // THE FIX: applied delta = netPnl - bakedInUnrealizedPnl(80), NOT bare netPnl.
    expect(currentEquityDelta).toBeCloseTo(netPnl - 80, 6);
    expect(peakEquityDelta).toBeCloseTo(netPnl - 80, 6);
    expect(realizedPeakEquityDelta).toBeCloseTo(netPnl - 80, 6);

    // Pre-fix regression guard: the bug applied the FULL netPnl (stranding the $80). Prove
    // we are NOT doing that (would double-count the already-credited unrealized).
    expect(currentEquityDelta).not.toBeCloseTo(netPnl, 6);

    // The result's reported trade pnl must stay the REAL realized P&L (unaffected by the
    // equity-delta correction — only the session-equity write changes, not trade accounting).
    expect(result.pnl).toBeCloseTo(netPnl, 6);
  });

  it("baseline: previousUnrealizedPnl=0 (no prior-bar accumulation) applies the full netPnl unchanged", async () => {
    // Backward-compat / non-regression: a position that never had an MTM tick before closing
    // (first-bar close, or a fresh open+close) has nothing baked into currentEquity to back out.
    const pos = buildPosition({ previousUnrealizedPnl: "0" });
    setSelectRows([pos]);
    claimReturnRows = [{ id: "pos-1", contracts: 1, previousUnrealizedPnl: "0" }];

    await closePosition("pos-1", 5010);

    expect(tradeInserts).toHaveLength(1);
    const netPnl = Number(tradeInserts[0].pnl);
    expect(sessionEquityUpdates).toHaveLength(1);
    const currentEquityDelta = extractNumberParams(sessionEquityUpdates[0].currentEquity)[0];
    expect(currentEquityDelta).toBeCloseTo(netPnl, 6);
  });
});

describe("updatePositionPrices — in-loop stop-breach close equity double-count fix", () => {
  it("backs out the PRE-BAR baked-in unrealized (not the just-recomputed this-bar value) on an intrabar stop breach after cross-bar accumulation", async () => {
    // Simulates: position held across prior bars, accumulating previousUnrealizedPnl=40 (already
    // credited into currentEquity via those prior bars' aggregate delta writes). THIS bar the price
    // whipsaws down through the stop (low breaches initialStopPrice) intrabar — closePosition is
    // invoked from WITHIN the same per-position loop iteration, AFTER the unconditional per-position
    // MTM UPDATE has already advanced the row's previousUnrealizedPnl to this bar's fresh value. The
    // fix must back out the PRE-bar value (40) — captured in-memory as `prevUnrealized` before the
    // MTM write — not a stale row re-read (which would see the already-advanced this-bar value) and
    // not zero (the original bug's net effect: prevBakedUnrealized never backed out at all).
    const pos = buildPosition({
      previousUnrealizedPnl: "40", // pre-bar baked-in unrealized (+8pts * $5 * 1 contract)
      initialStopPrice: "4990",    // 10pt structural stop below entry
      entryPrice: "5000",
    });
    setSelectRows([pos]);
    // HIGH#1 guard: the per-position MTM UPDATE matches this live row.
    mtmReturningRows = [{ id: "pos-1" }];
    // closePosition's own closedAt claim (row-locked read) — its previousUnrealizedPnl here would
    // be the ALREADY-ADVANCED this-bar value (post-MTM-write) in real DB semantics; we set it to a
    // DIFFERENT sentinel value (999) specifically to prove the fix does NOT use this row-read for
    // the in-loop path — it must use the caller-supplied precedingUnrealizedPnl (40) instead.
    claimReturnRows = [{ id: "pos-1", contracts: 1, previousUnrealizedPnl: "999" }];

    // Bar: high=5010 (never reached before the breach), low=4985 (breaches the 4990 stop),
    // close=4995. adversePrice (long) = low = 4985 <= stopLevel(4990) → stop breached.
    const result = await updatePositionPrices("sess-1", {
      MES: { close: 4995, high: 5010, low: 4985 },
    });

    // Position closed via the stop-breach path (not the normal MTM accrual path).
    expect(tradeInserts).toHaveLength(1);
    const netPnl = Number(tradeInserts[0].pnl);

    // Exactly ONE session-equity update fires — from closePosition's own tx. The aggregate
    // updatePositionPrices-level write (~line 4903, gated on positionsUpdated>0 &&
    // totalUnrealizedDelta!==0) must NOT ALSO fire: the existing `totalUnrealizedDelta -=
    // unrealizedDelta` back-out (line ~4573) cancels this position's contribution to the
    // aggregate total for a single-position session, leaving totalUnrealizedDelta===0.
    expect(sessionEquityUpdates).toHaveLength(1);

    const currentEquityDelta = extractNumberParams(sessionEquityUpdates[0].currentEquity)[0];

    // THE FIX (in-loop path): back out the PRE-bar value (40), not the row-read sentinel (999)
    // and not bare netPnl.
    expect(currentEquityDelta).toBeCloseTo(netPnl - 40, 6);
    expect(currentEquityDelta).not.toBeCloseTo(netPnl - 999, 6); // proves it ignored the stale row-read
    expect(currentEquityDelta).not.toBeCloseTo(netPnl, 6);        // proves it isn't the original bug

    // Note: the stop-breach path does not decrement positionsUpdated (unlike the exit-handler
    // dispatch closed-path at ~line 4937) — pre-existing behavior, unrelated to this fix. The
    // capital-safety-relevant assertion is totalUnrealizedDelta canceling to 0 (proven above via
    // sessionEquityUpdates.length===1, i.e. the aggregate write's gate did not also fire).
    expect(result.positionsUpdated).toBe(1);
  });
});
