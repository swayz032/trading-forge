/**
 * Tests for roll spread cost integration in closePosition().
 *
 * Verifies that:
 *  1. netPnl in the trade row includes roll spread cost deduction.
 *  2. rollSpreadCost is persisted on the trade row.
 *  3. paper:roll-spread-applied SSE event fires when cost > 0.
 *  4. No SSE roll event fires when no roll was crossed.
 *  5. closePosition return value includes rollSpreadCost.
 *
 * Mock pattern notes:
 *   - closePosition calls db.select(...).from(...).where(...) and awaits the
 *     result directly (no .limit() on most paths). The where() mock must
 *     resolve to an array.
 *   - Some paths call .orderBy().limit() for macroRegime and skipDecisions.
 *   - paper-risk-gate mock must include invalidateDailyLossCache (see
 *     mock_pattern_paper_risk_gate.md memory).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Infrastructure mocks (must precede SUT imports) ─────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    insert:  vi.fn().mockReturnThis(),
    select:  vi.fn().mockReturnThis(),
    update:  vi.fn().mockReturnThis(),
    values:  vi.fn().mockReturnThis(),
    set:     vi.fn().mockReturnThis(),
    from:    vi.fn().mockReturnThis(),
    where:   vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    limit:   vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockReturnThis(),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      // CRIT-1 (2026-07-09): closePosition now does a guarded idempotency-CLAIM
      // `update(paperPositions).set(...).where(isNull(closedAt)).returning({id})`
      // BEFORE inserting the trade. `.where()` must therefore be BOTH awaitable
      // (equity/dailyPnl updates await it directly) AND expose `.returning()`
      // (the claim reads the affected row). A thenable-with-returning satisfies both.
      const _whereThenable = () => {
        const p: any = Promise.resolve([{ id: "pos-claimed", contracts: 1 }]);
        p.returning = vi.fn().mockResolvedValue([{ id: "pos-claimed", contracts: 1 }]);
        return p;
      };
      const tx = {
        insert:    vi.fn().mockReturnThis(),
        update:    vi.fn().mockReturnThis(),
        values:    vi.fn().mockReturnThis(),
        set:       vi.fn().mockReturnThis(),
        from:      vi.fn().mockReturnThis(),
        where:     vi.fn().mockImplementation(_whereThenable),
        returning: vi.fn().mockResolvedValue([{ id: "trade-1", pnl: "0" }]),
        limit:     vi.fn().mockResolvedValue([]),
        orderBy:   vi.fn().mockReturnThis(),
      };
      return cb(tx);
    }),
  },
}));

vi.mock("../routes/sse.js",   () => ({ broadcastSSE: vi.fn() }));
vi.mock("../index.js",        () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/tracing.js",  () => ({
  tracer: { startSpan: vi.fn().mockReturnValue({ setAttribute: vi.fn(), end: vi.fn() }) },
}));
vi.mock("../scheduler.js",    () => ({ onPaperTradeClose: vi.fn() }));
vi.mock("./paper-risk-gate.js", () => ({
  toEasternDateString:          vi.fn().mockReturnValue("2026-03-15"),
  toFuturesTradingDayString:    vi.fn().mockReturnValue("2026-03-15"),
  invalidateDailyLossCache:     vi.fn(),
}));
vi.mock("./pipeline-control-service.js", () => ({ isActive: vi.fn().mockResolvedValue(true) }));
vi.mock("../lib/db-locks.js", () => ({
  // withSessionLock passes dbConn = db (same object) so we can keep using the
  // same mock across the entire close path.
  withSessionLock: vi.fn(async (_id: string, fn: (conn: unknown) => unknown) => {
    const { db } = await import("../db/index.js");
    return fn(db);
  }),
}));
vi.mock("./alert-service.js", () => ({ AlertFactory: vi.fn() }));
vi.mock("./metrics-aggregator.js", () => ({
  metricsAggregator: { recordTrade: vi.fn().mockReturnValue({ sessionId: "sess-1" }) },
}));
vi.mock("./paper-signal-service.js", () => ({ updateGovernorOnTrade: vi.fn() }));

// Python runner — calendar_filter for journal enrichment
vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn().mockResolvedValue({ is_economic_event: false }),
}));

vi.mock("../../shared/firm-config.js", () => ({
  CONTRACT_SPECS: {
    MES: { tickSize: 0.25, pointValue: 5,  name: "Micro E-mini S&P 500" },
    ES:  { tickSize: 0.25, pointValue: 50, name: "E-mini S&P 500" },
    CL:  { tickSize: 0.01, pointValue: 1000, name: "Crude Oil" },
    NQ:  { tickSize: 0.25, pointValue: 20, name: "E-mini Nasdaq-100" },
  },
  getFirmAccount:       vi.fn().mockReturnValue(null),
  // Zero commission so netPnl arithmetic is clean in tests
  getCommissionPerSide: vi.fn().mockReturnValue(0),
}));

import { closePosition }  from "./paper-execution-service.js";
import { broadcastSSE }   from "../routes/sse.js";
import { db }             from "../db/index.js";

// ─── Position factory ─────────────────────────────────────────────────────────

function makePosition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "pos-roll-1",
    sessionId: "sess-1",
    symbol: "MES",
    side: "long",
    entryPrice: "5000.00",
    currentPrice: "5010.00",
    contracts: 1,
    unrealizedPnl: "50.00",
    entryTime: new Date("2026-03-10T14:00:00Z"),  // before MES 2026-03-12 roll by default
    closedAt: null,
    mae: null,
    mfe: null,
    fillProbability: null,
    ...overrides,
  };
}

// ─── DB mock wiring ───────────────────────────────────────────────────────────
// closePosition db call sequence (both the outer call and the calls inside the lock):
//  1. db.select({sessionId}).from(paperPositions).where(eq(...))   → [{sessionId:"sess-1"}]
//  2. dbConn.select().from(paperPositions).where(eq(...))          → [fullPosRow]
//  3. dbConn.select({firmId}).from(paperSessions).where(eq(...))   → [{firmId:null}]
//  4. dbConn.select({macroRegime}).from(macroSnapshots).orderBy().limit() → []
//  5. dbConn.select({decision}).from(skipDecisions).where().orderBy().limit() → []
//  6. dbConn.select().from(paperSessions).where(eq(...))           → [sessionRow]
//
// All calls use `where: fn().mockResolvedValue([...])` for direct await patterns.
// Calls 4 and 5 use `orderBy: fn().mockReturnValue({limit: fn().mockResolvedValue([])})`.

function wireDbMocks(posRow: Record<string, unknown>) {
  const posLockChain = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ sessionId: "sess-1" }]),
    }),
  };

  const fullPosChain = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([posRow]),
    }),
  };

  const firmChain = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ firmId: null }]),
    }),
  };

  const macroChain = {
    from: vi.fn().mockReturnValue({
      orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
    }),
  };

  const skipChain = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    }),
  };

  const sessionReReadChain = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{
        id: "sess-1",
        firmId: null,
        strategyId: null,
        currentEquity: "50000",
        config: {},
      }]),
    }),
  };

  (db.select as ReturnType<typeof vi.fn>)
    .mockReturnValueOnce(posLockChain)       // 1. posForLock
    .mockReturnValueOnce(fullPosChain)       // 2. full position row inside lock
    .mockReturnValueOnce(firmChain)          // 3. firmId lookup
    .mockReturnValueOnce(macroChain)         // 4. macroRegime
    .mockReturnValueOnce(skipChain)          // 5. skipDecisions
    .mockReturnValue(sessionReReadChain);    // 6. session re-read + any extras

  (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  });

  (db.update as ReturnType<typeof vi.fn>).mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Wave hardening 2026-06-22: closePosition uses `new Date()` for closedAt, so these
  // roll-window tests are time-dependent. Pin the clock to 2026-03-15 (the close date
  // the suite already mocks via toEasternDateString) so a 2026-03-10 entry crosses
  // exactly the 2026-03-12 roll (cost 2), not every roll up to the real current date.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-15T16:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Test 1: roll cost deducted from netPnl ───────────────────────────────────

describe("closePosition — roll spread cost applied", () => {
  it("persists rollSpreadCost and reduces netPnl when a roll is crossed", async () => {
    const pos = makePosition({ entryTime: new Date("2026-03-10T14:00:00Z") });
    wireDbMocks(pos);

    // Capture the values passed to tx.insert(paperTrades).values(...)
    // deepscan14-cf: tx.insert() is called TWICE inside the transaction since the
    // H5 fix (2026-06-23) moved the audit-log insert inside the tx for atomicity
    // (see paper-execution-service.ts closePosition, call 1 = paperTrades, call 4 =
    // auditLog). A single shared `.mockReturnValue({...})` object made the auditLog
    // insert's values() overwrite capturedTradeValues, so this only captures the
    // FIRST insert's values (paperTrades) and leaves later inserts (auditLog) alone.
    let capturedTradeValues: Record<string, unknown> | null = null;
    (db as any).transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        insert: vi.fn(function () {
          return {
            values: vi.fn(function(vals: Record<string, unknown>) {
              if (capturedTradeValues === null) {
                capturedTradeValues = vals;
              }
              return { returning: vi.fn().mockResolvedValue([{ id: "trade-1", pnl: "0" }]) };
            }),
          };
        }),
        update: vi.fn().mockReturnValue({
          // CRIT-1 (2026-07-09): closePosition's guarded idempotency CLAIM does
          // update(paperPositions).set(...).where(isNull(closedAt)).returning({id})
          // BEFORE the trade insert. `.where()` must be awaitable AND expose
          // `.returning()`. Thenable-with-returning satisfies both.
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => {
              const p: any = Promise.resolve(undefined);
              p.returning = vi.fn().mockResolvedValue([{ id: "pos-claimed", contracts: 1 }]);
              return p;
            }),
          }),
        }),
      };
      return cb(tx);
    });

    // exitSignalPrice = 5010, entryPrice = 5000
    // grossPnl = (actualExit - 5000) × 5 × 1 (after exit slippage deduction)
    // commission = 0 (mocked), MES roll 2026-03-12 crossed: rollSpreadCost = $3.75
    // (deep-scan14-cf FIX 2: roll-calendar-data.ts canonically mirrors
    // roll_spread_cost.py's Wave 27.5 Pass D recalibration — MES = 3 ticks ×
    // $1.25/tick = $3.75/contract per roll side, not the pre-recalibration $2.
    // Test was stale against the code; code matches the cited 2025-2026 CME
    // institutional-standard roll spread table. See roll_spread_cost.py header.)
    // netPnl = grossPnl - commission - rollSpreadCost
    // We verify rollSpreadCost is persisted as "3.75" and that pnl = grossPnl - 3.75
    // (slippage affects grossPnl but the roll cost is always exactly $3.75 for 1 MES contract).
    await closePosition("pos-roll-1", 5010);

    expect(capturedTradeValues).not.toBeNull();
    expect(capturedTradeValues!["rollSpreadCost"]).toBe("3.75");
    // pnl = grossPnl - 0 commission - 3.75 rollSpreadCost
    // grossPnl is whatever slippage produces; we only care that the roll deduction is applied.
    // Wave hardening 2026-06-22: netPnl = grossPnl - commission - rollSpreadCost.
    // Read the real per-trade commission (MES default $0.62/side => $1.24 RT) from the
    // captured row rather than assuming commission=0.
    const grossPnlFromTrade = Number(capturedTradeValues!["grossPnl"]);
    const commissionFromTrade = Number(capturedTradeValues!["commission"]);
    expect(Number(capturedTradeValues!["pnl"])).toBeCloseTo(grossPnlFromTrade - commissionFromTrade - 3.75, 2);
  });
});

// ─── HIGH#1 (freshscan4): concurrent-partial TOCTOU — recompute P&L on the row-locked count ──

describe("closePosition — HIGH#1 contract-count TOCTOU", () => {
  it("recomputes grossPnl/commission/contracts on the LOCKED count when a partial reduced it before the claim", async () => {
    // Pre-tx read sees a 3-contract position; a concurrent bookPartialClose commits first (decrements
    // 3→1, sets tp1Filled but NOT closedAt), so the closedAt-guarded claim still matches and returns the
    // ACTUAL row-locked count of 1. Without the fix, closePosition would book a full-close on the STALE
    // 3 → triple-counting 2 phantom contracts into currentEquity + realizedPeakEquity (a false trailing-DD
    // breach). With the fix, the trade + equity use the locked count of 1.
    const pos = makePosition({ contracts: 3, entryTime: new Date("2026-12-15T14:00:00Z") }); // no roll → clean netPnl
    wireDbMocks(pos);

    let capturedTradeValues: Record<string, unknown> | null = null;
    (db as any).transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        insert: vi.fn(function () {
          return {
            values: vi.fn(function (vals: Record<string, unknown>) {
              if (capturedTradeValues === null) capturedTradeValues = vals;
              return { returning: vi.fn().mockResolvedValue([{ id: "trade-toctou", pnl: "0" }]) };
            }),
          };
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => {
              const p: any = Promise.resolve(undefined);
              // The claim returns the row-locked count = 1 (the partial already reduced it), NOT 3.
              p.returning = vi.fn().mockResolvedValue([{ id: "pos-claimed", contracts: 1 }]);
              return p;
            }),
          }),
        }),
      };
      return cb(tx);
    });

    // exit 5010 vs entry 5000, MES pointValue 5, commission mocked to 0, no roll.
    // 1-contract grossPnl ≈ (actualExit - 5000) × 5 × 1; the STALE 3-contract value would be 3× larger.
    await closePosition("pos-roll-1", 5010);

    expect(capturedTradeValues).not.toBeNull();
    // The booked contract count must be the LOCKED 1, not the stale pre-tx 3.
    expect(capturedTradeValues!["contracts"]).toBe(1);
    // grossPnl must be the 1-contract magnitude. Upper-bound it well below the 3-contract value:
    // 1-contract gross ≈ (5010 - slip - 5000)×5 ≈ ~48–50; 3-contract would be ~144–150.
    const gross = Number(capturedTradeValues!["grossPnl"]);
    expect(gross).toBeGreaterThan(0);
    expect(gross).toBeLessThan(90); // decisively excludes the 3-contract (~144) stale value
  });
});

// ─── Test 2: no roll in window → rollSpreadCost = "0" ────────────────────────

describe("closePosition — no roll in hold window", () => {
  it("persists rollSpreadCost='0' when entryTime is after the last 2026 MES roll", async () => {
    // Entry after 2026-12-10 (last 2026 MES roll) — no roll will be crossed
    // regardless of when closedAt falls in tests
    const pos = makePosition({ entryTime: new Date("2026-12-15T14:00:00Z") });
    wireDbMocks(pos);

    // deepscan14-cf: see Test 1 comment — only capture the FIRST tx.insert() call
    // (paperTrades) so the later in-tx auditLog insert doesn't clobber it.
    let capturedTradeValues: Record<string, unknown> | null = null;
    (db as any).transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        insert: vi.fn(function () {
          return {
            values: vi.fn(function(vals: Record<string, unknown>) {
              if (capturedTradeValues === null) {
                capturedTradeValues = vals;
              }
              return { returning: vi.fn().mockResolvedValue([{ id: "trade-2", pnl: "0" }]) };
            }),
          };
        }),
        update: vi.fn().mockReturnValue({
          // CRIT-1 (2026-07-09): closePosition's guarded idempotency CLAIM does
          // update(paperPositions).set(...).where(isNull(closedAt)).returning({id})
          // BEFORE the trade insert. `.where()` must be awaitable AND expose
          // `.returning()`. Thenable-with-returning satisfies both.
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => {
              const p: any = Promise.resolve(undefined);
              p.returning = vi.fn().mockResolvedValue([{ id: "pos-claimed", contracts: 1 }]);
              return p;
            }),
          }),
        }),
      };
      return cb(tx);
    });

    await closePosition("pos-roll-1", 5010);

    expect(capturedTradeValues).not.toBeNull();
    expect(capturedTradeValues!["rollSpreadCost"]).toBe("0");
    // netPnl = grossPnl - commission - 0 roll cost (no roll deduction this window).
    const grossPnlFromTrade = Number(capturedTradeValues!["grossPnl"]);
    const commissionFromTrade = Number(capturedTradeValues!["commission"]);
    expect(Number(capturedTradeValues!["pnl"])).toBeCloseTo(grossPnlFromTrade - commissionFromTrade, 2);
  });
});

// ─── Test 3: SSE paper:roll-spread-applied fires when cost > 0 ───────────────

describe("closePosition — SSE paper:roll-spread-applied", () => {
  it("broadcasts paper:roll-spread-applied when a roll is crossed", async () => {
    const pos = makePosition({ entryTime: new Date("2026-03-10T14:00:00Z") });
    wireDbMocks(pos);

    (db as any).transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: "trade-sse-1", pnl: "0" }]),
          }),
        }),
        update: vi.fn().mockReturnValue({
          // CRIT-1 (2026-07-09): closePosition's guarded idempotency CLAIM does
          // update(paperPositions).set(...).where(isNull(closedAt)).returning({id})
          // BEFORE the trade insert. `.where()` must be awaitable AND expose
          // `.returning()`. Thenable-with-returning satisfies both.
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => {
              const p: any = Promise.resolve(undefined);
              p.returning = vi.fn().mockResolvedValue([{ id: "pos-claimed", contracts: 1 }]);
              return p;
            }),
          }),
        }),
      };
      return cb(tx);
    });

    await closePosition("pos-roll-1", 5010);

    expect(broadcastSSE).toHaveBeenCalledWith(
      "paper:roll-spread-applied",
      expect.objectContaining({
        symbol: "MES",
        contracts: 1,
        costUsd: 3.75,
        rollDates: expect.arrayContaining(["2026-03-12"]),
      }),
    );
  });

  it("does NOT broadcast paper:roll-spread-applied when cost is 0", async () => {
    const pos = makePosition({ entryTime: new Date("2026-12-15T14:00:00Z") });
    wireDbMocks(pos);

    (db as any).transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: "trade-nosse-1", pnl: "0" }]),
          }),
        }),
        update: vi.fn().mockReturnValue({
          // CRIT-1 (2026-07-09): closePosition's guarded idempotency CLAIM does
          // update(paperPositions).set(...).where(isNull(closedAt)).returning({id})
          // BEFORE the trade insert. `.where()` must be awaitable AND expose
          // `.returning()`. Thenable-with-returning satisfies both.
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => {
              const p: any = Promise.resolve(undefined);
              p.returning = vi.fn().mockResolvedValue([{ id: "pos-claimed", contracts: 1 }]);
              return p;
            }),
          }),
        }),
      };
      return cb(tx);
    });

    await closePosition("pos-roll-1", 5010);

    expect(broadcastSSE).not.toHaveBeenCalledWith(
      "paper:roll-spread-applied",
      expect.anything(),
    );
  });
});

// ─── Test 4: return value includes rollSpreadCost ─────────────────────────────

describe("closePosition — return value rollSpreadCost", () => {
  it("returns rollSpreadCost = 2 for MES position crossing the 2026-03-12 roll", async () => {
    const pos = makePosition({ entryTime: new Date("2026-03-10T14:00:00Z") });
    wireDbMocks(pos);

    (db as any).transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: "trade-ret-1", pnl: "0" }]),
          }),
        }),
        update: vi.fn().mockReturnValue({
          // CRIT-1 (2026-07-09): closePosition's guarded idempotency CLAIM does
          // update(paperPositions).set(...).where(isNull(closedAt)).returning({id})
          // BEFORE the trade insert. `.where()` must be awaitable AND expose
          // `.returning()`. Thenable-with-returning satisfies both.
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => {
              const p: any = Promise.resolve(undefined);
              p.returning = vi.fn().mockResolvedValue([{ id: "pos-claimed", contracts: 1 }]);
              return p;
            }),
          }),
        }),
      };
      return cb(tx);
    });

    const result = await closePosition("pos-roll-1", 5010);

    expect(result).not.toBeNull();
    expect(result!.rollSpreadCost).toBe(3.75);
  });
});
