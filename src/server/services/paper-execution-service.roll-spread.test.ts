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

import { describe, it, expect, vi, beforeEach } from "vitest";

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
      const tx = {
        insert:    vi.fn().mockReturnThis(),
        update:    vi.fn().mockReturnThis(),
        values:    vi.fn().mockReturnThis(),
        set:       vi.fn().mockReturnThis(),
        from:      vi.fn().mockReturnThis(),
        where:     vi.fn().mockReturnThis(),
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
  toEasternDateString:     vi.fn().mockReturnValue("2026-03-15"),
  invalidateDailyLossCache: vi.fn(),
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
});

// ─── Test 1: roll cost deducted from netPnl ───────────────────────────────────

describe("closePosition — roll spread cost applied", () => {
  it("persists rollSpreadCost and reduces netPnl when a roll is crossed", async () => {
    const pos = makePosition({ entryTime: new Date("2026-03-10T14:00:00Z") });
    wireDbMocks(pos);

    // Capture the values passed to tx.insert(paperTrades).values(...)
    let capturedTradeValues: Record<string, unknown> | null = null;
    (db as any).transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn(function(vals: Record<string, unknown>) {
            capturedTradeValues = vals;
            return { returning: vi.fn().mockResolvedValue([{ id: "trade-1", pnl: "0" }]) };
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
        }),
      };
      return cb(tx);
    });

    // exitSignalPrice = 5010, entryPrice = 5000
    // grossPnl = (actualExit - 5000) × 5 × 1 (after exit slippage deduction)
    // commission = 0 (mocked), MES roll 2026-03-12 crossed: rollSpreadCost = $2
    // netPnl = grossPnl - commission - rollSpreadCost
    // We verify rollSpreadCost is persisted as "2" and that pnl = grossPnl - 2
    // (slippage affects grossPnl but the roll cost is always exactly $2 for 1 MES contract).
    await closePosition("pos-roll-1", 5010);

    expect(capturedTradeValues).not.toBeNull();
    expect(capturedTradeValues!["rollSpreadCost"]).toBe("2");
    // pnl = grossPnl - 0 commission - 2 rollSpreadCost
    // grossPnl is whatever slippage produces; we only care that the roll deduction is applied.
    const grossPnlFromTrade = Number(capturedTradeValues!["grossPnl"]);
    expect(Number(capturedTradeValues!["pnl"])).toBeCloseTo(grossPnlFromTrade - 2, 2);
  });
});

// ─── Test 2: no roll in window → rollSpreadCost = "0" ────────────────────────

describe("closePosition — no roll in hold window", () => {
  it("persists rollSpreadCost='0' when entryTime is after the last 2026 MES roll", async () => {
    // Entry after 2026-12-10 (last 2026 MES roll) — no roll will be crossed
    // regardless of when closedAt falls in tests
    const pos = makePosition({ entryTime: new Date("2026-12-15T14:00:00Z") });
    wireDbMocks(pos);

    let capturedTradeValues: Record<string, unknown> | null = null;
    (db as any).transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn(function(vals: Record<string, unknown>) {
            capturedTradeValues = vals;
            return { returning: vi.fn().mockResolvedValue([{ id: "trade-2", pnl: "0" }]) };
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
        }),
      };
      return cb(tx);
    });

    await closePosition("pos-roll-1", 5010);

    expect(capturedTradeValues).not.toBeNull();
    expect(capturedTradeValues!["rollSpreadCost"]).toBe("0");
    // netPnl = grossPnl - 0 commission - 0 roll cost = gross (no roll deduction)
    const grossPnlFromTrade = Number(capturedTradeValues!["grossPnl"]);
    expect(Number(capturedTradeValues!["pnl"])).toBeCloseTo(grossPnlFromTrade, 2);
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
          set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
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
        costUsd: 2,
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
          set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
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
          set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
        }),
      };
      return cb(tx);
    });

    const result = await closePosition("pos-roll-1", 5010);

    expect(result).not.toBeNull();
    expect(result!.rollSpreadCost).toBe(2);
  });
});
