/**
 * pine-broker-reconcile.test.ts
 *
 * Tests for the pure-function Pine Strategy Tester ↔ Broker reconciliation library.
 * All functions are deterministic — no DB, no IO, no Date.now().
 *
 * Coverage:
 *   parseStrategyTesterCsv — classic + 2025+ CSV shapes, edge cases
 *   matchTrades            — exact match, window miss, unmatched sides
 *   reconcile              — within tolerance, out-of-tolerance slip, qty mismatch surface
 *   getTickSpec            — symbol normalization
 */

import { describe, it, expect } from "vitest";
import {
  parseStrategyTesterCsv,
  matchTrades,
  reconcile,
  getTickSpec,
  type TesterTrade,
  type BrokerTrade,
  type MatchResult,
} from "../pine-broker-reconcile.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/**
 * Classic TradingView Strategy Tester CSV (Trade #, Type, Signal, Date/Time, Price, Contracts, Profit)
 * Two completed trades: 1 long, 1 short.
 */
const CLASSIC_CSV = `Trade #,Type,Signal,Date/Time,Price,Contracts,Profit
1,Entry long,Open Long,2024-01-15 09:30:00 +0000,4500.25,1,
1,Exit long,Close Long,2024-01-15 10:30:00 +0000,4504.75,1,22.50
2,Entry short,Open Short,2024-01-15 11:00:00 +0000,4503.00,1,
2,Exit short,Close Short,2024-01-15 12:00:00 +0000,4495.50,1,37.50
`;

/**
 * 2025+ TradingView format with extra columns (Run-up, Drawdown, Cum. Profit).
 * Unknown columns must be tolerated.
 */
const MODERN_CSV = `Trade #,Type,Signal,Date/Time,Price,Contracts,Profit,Run-up,Drawdown,Cum. Profit
1,Entry long,Open Long,2024-03-10 14:00:00 +0000,18500.00,2,,,,-
1,Exit long,Close Long,2024-03-10 14:45:00 +0000,18512.50,2,50.00,62.50,6.25,50.00
2,Entry short,Open Short,2024-03-10 15:00:00 +0000,18510.00,1,,,,
2,Exit short,Close Short,2024-03-10 15:30:00 +0000,18500.00,1,20.00,25.00,2.50,70.00
`;

/**
 * CSV with no-timezone timestamps (treated as UTC).
 */
const NO_TZ_CSV = `Trade #,Type,Signal,Date/Time,Price,Contracts,Profit
1,Entry long,Open Long,2024-05-01 09:30,4580.00,1,
1,Exit long,Close Long,2024-05-01 09:55,4581.00,1,5.00
`;

/**
 * Helper: build a BrokerTrade from minimal fields with sensible defaults.
 */
function mkBroker(overrides: Partial<BrokerTrade> & {
  entryTime: Date;
  exitTime: Date;
  direction: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  pnl: number;
}): BrokerTrade {
  return {
    qty: 1,
    ...overrides,
  };
}

// ─── parseStrategyTesterCsv ──────────────────────────────────────────────────

describe("parseStrategyTesterCsv", () => {
  it("parses classic CSV into two trades with correct fields", () => {
    const trades = parseStrategyTesterCsv(CLASSIC_CSV);
    expect(trades).toHaveLength(2);

    const t1 = trades[0];
    expect(t1.tradeNum).toBe(1);
    expect(t1.direction).toBe("long");
    expect(t1.entryPrice).toBe(4500.25);
    expect(t1.exitPrice).toBe(4504.75);
    expect(t1.qty).toBe(1);
    expect(t1.pnl).toBe(22.50);

    const t2 = trades[1];
    expect(t2.tradeNum).toBe(2);
    expect(t2.direction).toBe("short");
    expect(t2.entryPrice).toBe(4503.00);
    expect(t2.exitPrice).toBe(4495.50);
    expect(t2.pnl).toBe(37.50);
  });

  it("parses 2025+ CSV with extra columns, tolerating unknown columns", () => {
    const trades = parseStrategyTesterCsv(MODERN_CSV);
    expect(trades).toHaveLength(2);

    const t1 = trades[0];
    expect(t1.direction).toBe("long");
    expect(t1.qty).toBe(2);
    expect(t1.pnl).toBe(50.00);

    const t2 = trades[1];
    expect(t2.direction).toBe("short");
    expect(t2.qty).toBe(1);
    expect(t2.pnl).toBe(20.00);
  });

  it("parses timestamps without timezone as UTC", () => {
    const trades = parseStrategyTesterCsv(NO_TZ_CSV);
    expect(trades).toHaveLength(1);
    expect(trades[0].entryTime.toISOString()).toBe("2024-05-01T09:30:00.000Z");
    expect(trades[0].exitTime.toISOString()).toBe("2024-05-01T09:55:00.000Z");
  });

  it("returns empty array for empty input", () => {
    expect(parseStrategyTesterCsv("")).toEqual([]);
    expect(parseStrategyTesterCsv("   \n  ")).toEqual([]);
  });

  it("throws when header row is absent", () => {
    expect(() => parseStrategyTesterCsv("foo,bar,baz\n1,2,3")).toThrow(
      /header/i
    );
  });

  it("throws when required columns are missing", () => {
    const bad = `Trade #,Signal\n1,Open Long`;
    expect(() => parseStrategyTesterCsv(bad)).toThrow(/missing required columns/i);
  });

  it("skips incomplete trade pairs (entry without exit)", () => {
    const csv = `Trade #,Type,Signal,Date/Time,Price,Contracts,Profit
1,Entry long,Open Long,2024-01-15 09:30:00 +0000,4500.25,1,
2,Entry long,Open Long,2024-01-15 10:00:00 +0000,4502.00,1,
2,Exit long,Close Long,2024-01-15 10:30:00 +0000,4506.00,1,20.00
`;
    const trades = parseStrategyTesterCsv(csv);
    // Trade 1 incomplete (entry only) → skipped; Trade 2 complete → included
    expect(trades).toHaveLength(1);
    expect(trades[0].tradeNum).toBe(2);
  });

  it("returns trades sorted ascending by entryTime", () => {
    // Trade 2 comes first in the CSV but has a later entry time — verify sort order
    const csv = `Trade #,Type,Signal,Date/Time,Price,Contracts,Profit
2,Entry long,Open Long,2024-01-15 11:00:00 +0000,4502.00,1,
2,Exit long,Close Long,2024-01-15 12:00:00 +0000,4506.00,1,20.00
1,Entry long,Open Long,2024-01-15 09:30:00 +0000,4500.25,1,
1,Exit long,Close Long,2024-01-15 10:30:00 +0000,4504.75,1,22.50
`;
    const trades = parseStrategyTesterCsv(csv);
    expect(trades[0].tradeNum).toBe(1);
    expect(trades[1].tradeNum).toBe(2);
  });
});

// ─── matchTrades ─────────────────────────────────────────────────────────────

describe("matchTrades", () => {
  const t0 = new Date("2024-01-15T09:30:00Z");
  const t1 = new Date("2024-01-15T10:00:00Z");
  const t2 = new Date("2024-01-15T11:00:00Z");
  const t3 = new Date("2024-01-15T11:05:00Z"); // 5 min after t2 — boundary
  const t4 = new Date("2024-01-15T11:06:00Z"); // 6 min after t2 — outside default window

  const longTester: TesterTrade = {
    tradeNum: 1,
    direction: "long",
    entryTime: t0,
    exitTime: t1,
    entryPrice: 4500.25,
    exitPrice: 4504.75,
    qty: 1,
    pnl: 22.50,
  };

  const shortTester: TesterTrade = {
    tradeNum: 2,
    direction: "short",
    entryTime: t2,
    exitTime: new Date("2024-01-15T12:00:00Z"),
    entryPrice: 4503.00,
    exitPrice: 4495.50,
    qty: 1,
    pnl: 37.50,
  };

  it("matches two trades exactly by direction and entry time", () => {
    const longBroker = mkBroker({
      entryTime: t0, exitTime: t1,
      direction: "long", entryPrice: 4500.25, exitPrice: 4504.75, pnl: 22.50,
    });
    const shortBroker = mkBroker({
      entryTime: t2, exitTime: new Date("2024-01-15T12:00:00Z"),
      direction: "short", entryPrice: 4503.00, exitPrice: 4495.50, pnl: 37.50,
    });

    const result = matchTrades([longTester, shortTester], [longBroker, shortBroker]);
    expect(result.matched).toHaveLength(2);
    expect(result.unmatchedTester).toHaveLength(0);
    expect(result.unmatchedBroker).toHaveLength(0);
  });

  it("does not match trades where direction differs", () => {
    const wrongDir = mkBroker({
      entryTime: t0, exitTime: t1,
      direction: "short",  // wrong direction for longTester
      entryPrice: 4500.25, exitPrice: 4504.75, pnl: 22.50,
    });
    const result = matchTrades([longTester], [wrongDir]);
    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedTester).toHaveLength(1);
    expect(result.unmatchedBroker).toHaveLength(1);
  });

  it("matches when broker entry is within default 5-min window", () => {
    // t3 is exactly 5 minutes after t2 — within boundary
    const broker = mkBroker({
      entryTime: t3, exitTime: new Date("2024-01-15T12:00:00Z"),
      direction: "short", entryPrice: 4503.00, exitPrice: 4495.50, pnl: 37.50,
    });
    const result = matchTrades([shortTester], [broker]);
    expect(result.matched).toHaveLength(1);
  });

  it("does not match when broker entry is outside window (6 min)", () => {
    const broker = mkBroker({
      entryTime: t4, exitTime: new Date("2024-01-15T12:00:00Z"),
      direction: "short", entryPrice: 4503.00, exitPrice: 4495.50, pnl: 37.50,
    });
    const result = matchTrades([shortTester], [broker]);
    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedTester).toHaveLength(1);
    expect(result.unmatchedBroker).toHaveLength(1);
  });

  it("surfaces unmatched tester trade", () => {
    const result = matchTrades([longTester], []);
    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedTester).toHaveLength(1);
    expect(result.unmatchedBroker).toHaveLength(0);
  });

  it("surfaces unmatched broker trade", () => {
    const extra = mkBroker({
      entryTime: t2, exitTime: new Date("2024-01-15T12:00:00Z"),
      direction: "long", entryPrice: 4503.00, exitPrice: 4510.00, pnl: 35.00,
    });
    const result = matchTrades([], [extra]);
    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedTester).toHaveLength(0);
    expect(result.unmatchedBroker).toHaveLength(1);
  });

  it("returns empty result for empty inputs", () => {
    const result = matchTrades([], []);
    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedTester).toHaveLength(0);
    expect(result.unmatchedBroker).toHaveLength(0);
  });

  it("respects custom windowMs override", () => {
    // 1 minute window — t3 (5 min away) should not match
    const broker = mkBroker({
      entryTime: t3, exitTime: new Date("2024-01-15T12:00:00Z"),
      direction: "short", entryPrice: 4503.00, exitPrice: 4495.50, pnl: 37.50,
    });
    const result = matchTrades([shortTester], [broker], { windowMs: 60_000 });
    expect(result.matched).toHaveLength(0);
  });
});

// ─── reconcile ───────────────────────────────────────────────────────────────

describe("reconcile", () => {
  const MES = { tickSize: 0.25, tickValue: 1.25 };

  const entryTime = new Date("2024-01-15T09:30:00Z");
  const exitTime  = new Date("2024-01-15T10:30:00Z");

  function makeMatchResult(
    tester: TesterTrade,
    broker: BrokerTrade
  ): MatchResult {
    return {
      matched: [{ tester, broker }],
      unmatchedTester: [],
      unmatchedBroker: [],
    };
  }

  const baseTester: TesterTrade = {
    tradeNum: 1,
    direction: "long",
    entryTime,
    exitTime,
    entryPrice: 4500.00,
    exitPrice: 4504.00,
    qty: 1,
    pnl: 20.00,  // 4 ticks × $1.25 × 4 = $20
  };

  const baseBroker = mkBroker({
    entryTime,
    exitTime,
    direction: "long",
    entryPrice: 4500.00,
    exitPrice: 4504.00,
    pnl: 20.00,
  });

  it("reports within_tolerance=true for exact match (0 tick slip)", () => {
    const report = reconcile(makeMatchResult(baseTester, baseBroker), MES);
    expect(report.matched_count).toBe(1);
    expect(report.unmatched_tester).toBe(0);
    expect(report.unmatched_broker).toBe(0);
    expect(report.within_tolerance).toBe(true);
    expect(report.per_trade[0].entrySlipTicks).toBe(0);
    expect(report.per_trade[0].exitSlipTicks).toBe(0);
    expect(report.per_trade[0].pnlDelta).toBe(0);
    expect(report.per_trade[0].withinTolerance).toBe(true);
  });

  it("reports within_tolerance=true for 2-tick entry slip (at boundary)", () => {
    const broker = mkBroker({
      ...baseBroker,
      // 2 ticks worse entry for a long: 0.50 above tester entry
      entryPrice: 4500.50,
      pnl: 17.50, // 2 fewer ticks × $1.25
    });
    const report = reconcile(makeMatchResult(baseTester, broker), MES);
    expect(report.per_trade[0].entrySlipTicks).toBe(2);
    expect(report.per_trade[0].withinTolerance).toBe(true);
    expect(report.within_tolerance).toBe(true);
  });

  it("reports within_tolerance=false for 3-tick entry slip (over boundary)", () => {
    const broker = mkBroker({
      ...baseBroker,
      entryPrice: 4500.75, // 3 ticks worse
      pnl: 16.25,
    });
    const report = reconcile(makeMatchResult(baseTester, broker), MES);
    expect(report.per_trade[0].entrySlipTicks).toBe(3);
    expect(report.per_trade[0].withinTolerance).toBe(false);
    expect(report.within_tolerance).toBe(false);
    expect(report.max_abs_price_delta_ticks).toBe(3);
  });

  it("surfaced P&L delta when broker P&L differs from tester P&L", () => {
    const broker = mkBroker({ ...baseBroker, pnl: 18.75 });
    const report = reconcile(makeMatchResult(baseTester, broker), MES);
    expect(report.per_trade[0].pnlDelta).toBeCloseTo(-1.25, 2);
    expect(report.cum_pnl_delta).toBeCloseTo(-1.25, 2);
  });

  it("estimates tester P&L from prices when pnl column is null", () => {
    const testerNoPnl: TesterTrade = { ...baseTester, pnl: null };
    // tester: (4504 - 4500) / 0.25 * 1.25 * 1 = 16 ticks → $20
    const broker = mkBroker({ ...baseBroker, pnl: 20.00 });
    const report = reconcile(makeMatchResult(testerNoPnl, broker), MES);
    expect(report.per_trade[0].pnlDelta).toBeCloseTo(0, 2);
  });

  it("handles short trade slip correctly (convention: positive = worse fill)", () => {
    const shortTester: TesterTrade = {
      tradeNum: 1,
      direction: "short",
      entryTime,
      exitTime,
      entryPrice: 4503.00,
      exitPrice: 4499.00,  // 16 ticks profit
      qty: 1,
      pnl: 20.00,
    };
    // Broker got worse short entry: 4502.75 (below tester = worse for short)
    const broker = mkBroker({
      entryTime,
      exitTime,
      direction: "short",
      entryPrice: 4502.75, // 1 tick worse entry
      exitPrice: 4499.00,
      pnl: 18.75,
    });
    const report = reconcile(
      { matched: [{ tester: shortTester, broker }], unmatchedTester: [], unmatchedBroker: [] },
      MES
    );
    expect(report.per_trade[0].entrySlipTicks).toBe(1);
    expect(report.per_trade[0].exitSlipTicks).toBe(0);
    expect(report.per_trade[0].withinTolerance).toBe(true);
  });

  it("surfaces qty mismatch via pnlDelta (different qty → different P&L)", () => {
    // Tester: 1 contract; broker: 2 contracts (different fill amount)
    // The lib does not block on qty mismatch but the pnlDelta will differ
    const broker = mkBroker({
      ...baseBroker,
      qty: 2,
      pnl: 40.00, // 2× the tester P&L
    });
    const report = reconcile(makeMatchResult(baseTester, broker), MES);
    // pnlDelta = 40 - 20 = 20
    expect(report.per_trade[0].pnlDelta).toBeCloseTo(20, 2);
    // Price slip is 0 regardless of qty
    expect(report.per_trade[0].entrySlipTicks).toBe(0);
    expect(report.per_trade[0].exitSlipTicks).toBe(0);
  });

  it("flags within_tolerance=false when unmatched tester exists", () => {
    const orphanTester: TesterTrade = { ...baseTester, tradeNum: 99 };
    const report = reconcile(
      { matched: [], unmatchedTester: [orphanTester], unmatchedBroker: [] },
      MES
    );
    expect(report.within_tolerance).toBe(false);
    expect(report.unmatched_tester).toBe(1);
  });

  it("flags within_tolerance=false when unmatched broker exists", () => {
    const orphanBroker = mkBroker({ ...baseBroker });
    const report = reconcile(
      { matched: [], unmatchedTester: [], unmatchedBroker: [orphanBroker] },
      MES
    );
    expect(report.within_tolerance).toBe(false);
    expect(report.unmatched_broker).toBe(1);
  });

  it("returns zero-filled report for empty inputs", () => {
    const report = reconcile(
      { matched: [], unmatchedTester: [], unmatchedBroker: [] },
      MES
    );
    expect(report.matched_count).toBe(0);
    expect(report.max_abs_price_delta_ticks).toBe(0);
    expect(report.cum_pnl_delta).toBe(0);
    expect(report.within_tolerance).toBe(true); // vacuously true
    expect(report.per_trade).toHaveLength(0);
  });

  it("accumulates cum_pnl_delta across multiple matched trades", () => {
    const t1e = new Date("2024-01-15T09:30:00Z");
    const t1x = new Date("2024-01-15T10:00:00Z");
    const t2e = new Date("2024-01-15T11:00:00Z");
    const t2x = new Date("2024-01-15T12:00:00Z");

    const tester1: TesterTrade = { tradeNum: 1, direction: "long", entryTime: t1e, exitTime: t1x, entryPrice: 4500.00, exitPrice: 4504.00, qty: 1, pnl: 20.00 };
    const broker1 = mkBroker({ entryTime: t1e, exitTime: t1x, direction: "long", entryPrice: 4500.00, exitPrice: 4504.00, pnl: 20.00 });
    const tester2: TesterTrade = { tradeNum: 2, direction: "short", entryTime: t2e, exitTime: t2x, entryPrice: 4503.00, exitPrice: 4499.00, qty: 1, pnl: 20.00 };
    const broker2 = mkBroker({ entryTime: t2e, exitTime: t2x, direction: "short", entryPrice: 4503.00, exitPrice: 4499.00, pnl: 22.50 });

    const report = reconcile(
      {
        matched: [{ tester: tester1, broker: broker1 }, { tester: tester2, broker: broker2 }],
        unmatchedTester: [],
        unmatchedBroker: [],
      },
      MES
    );

    expect(report.matched_count).toBe(2);
    expect(report.cum_pnl_delta).toBeCloseTo(2.50, 2); // trade2 pnl +$2.50 better
    expect(report.within_tolerance).toBe(true);
  });

  it("respects custom tolerance_ticks override", () => {
    // 3-tick entry slip — passes at tolerance=3, fails at tolerance=2
    const broker = mkBroker({
      ...baseBroker,
      entryPrice: 4500.75, // 3 ticks worse
      pnl: 16.25,
    });
    const reportStrict = reconcile(makeMatchResult(baseTester, broker), { ...MES, tolerance_ticks: 2 });
    expect(reportStrict.within_tolerance).toBe(false);

    const reportLoose = reconcile(makeMatchResult(baseTester, broker), { ...MES, tolerance_ticks: 3 });
    expect(reportLoose.within_tolerance).toBe(true);
  });
});

// ─── getTickSpec ─────────────────────────────────────────────────────────────

describe("getTickSpec", () => {
  it("returns MES spec for MES", () => {
    expect(getTickSpec("MES")).toEqual({ tickSize: 0.25, tickValue: 1.25 });
  });

  it("returns MNQ spec for MNQ", () => {
    expect(getTickSpec("MNQ")).toEqual({ tickSize: 0.25, tickValue: 0.50 });
  });

  it("returns MCL spec for MCL", () => {
    expect(getTickSpec("MCL")).toEqual({ tickSize: 0.01, tickValue: 1.00 });
  });

  it("strips trailing expiry suffix (MES1!, ES2024H)", () => {
    expect(getTickSpec("MES1!")).toEqual({ tickSize: 0.25, tickValue: 1.25 });
    expect(getTickSpec("MNQ2025M")).toEqual({ tickSize: 0.25, tickValue: 0.50 });
  });

  it("is case-insensitive", () => {
    expect(getTickSpec("mes")).toEqual({ tickSize: 0.25, tickValue: 1.25 });
  });

  it("falls back to MES spec for unknown symbol", () => {
    const fallback = getTickSpec("UNKNOWN");
    expect(fallback).toEqual({ tickSize: 0.25, tickValue: 1.25 });
  });
});

// ─── End-to-end fixture: parse → match → reconcile ───────────────────────────

describe("end-to-end: parse CSV → match → reconcile", () => {
  it("reconciles classic CSV fixture against matching broker fills within tolerance", () => {
    const testerTrades = parseStrategyTesterCsv(CLASSIC_CSV);
    expect(testerTrades).toHaveLength(2);

    const brokerTrades: BrokerTrade[] = [
      mkBroker({
        entryTime: new Date("2024-01-15T09:30:00Z"),
        exitTime:  new Date("2024-01-15T10:30:00Z"),
        direction: "long",
        entryPrice: 4500.25,   // exact match
        exitPrice:  4504.50,   // 1 tick worse than tester 4504.75 → 1 tick slip
        pnl: 21.25,
      }),
      mkBroker({
        entryTime: new Date("2024-01-15T11:00:00Z"),
        exitTime:  new Date("2024-01-15T12:00:00Z"),
        direction: "short",
        entryPrice: 4503.00,   // exact
        exitPrice:  4495.50,   // exact
        pnl: 37.50,
      }),
    ];

    const matchResult = matchTrades(testerTrades, brokerTrades);
    expect(matchResult.matched).toHaveLength(2);
    expect(matchResult.unmatchedTester).toHaveLength(0);
    expect(matchResult.unmatchedBroker).toHaveLength(0);

    const spec = getTickSpec("MES");
    const report = reconcile(matchResult, { ...spec, tolerance_ticks: 2 });

    expect(report.matched_count).toBe(2);
    expect(report.within_tolerance).toBe(true);

    // Trade 1: exit slip = (4504.75 - 4504.50) / 0.25 = 1 tick
    const t1 = report.per_trade.find((t) => t.testerTradeNum === 1)!;
    expect(t1.exitSlipTicks).toBe(1);
    expect(t1.entrySlipTicks).toBe(0);

    // Trade 2: zero slip
    const t2 = report.per_trade.find((t) => t.testerTradeNum === 2)!;
    expect(t2.entrySlipTicks).toBe(0);
    expect(t2.exitSlipTicks).toBe(0);
  });

  it("flags out-of-tolerance when entry slip is 3 ticks", () => {
    const testerTrades = parseStrategyTesterCsv(CLASSIC_CSV);

    const brokerTrades: BrokerTrade[] = [
      mkBroker({
        entryTime: new Date("2024-01-15T09:30:00Z"),
        exitTime:  new Date("2024-01-15T10:30:00Z"),
        direction: "long",
        entryPrice: 4501.00, // 3 ticks worse than tester 4500.25 → (4501.00 - 4500.25) / 0.25 = 3 ticks
        exitPrice:  4504.75,
        pnl: 15.00,
      }),
      mkBroker({
        entryTime: new Date("2024-01-15T11:00:00Z"),
        exitTime:  new Date("2024-01-15T12:00:00Z"),
        direction: "short",
        entryPrice: 4503.00,
        exitPrice:  4495.50,
        pnl: 37.50,
      }),
    ];

    const spec = getTickSpec("MES");
    const matchResult = matchTrades(testerTrades, brokerTrades);
    const report = reconcile(matchResult, { ...spec, tolerance_ticks: 2 });

    expect(report.within_tolerance).toBe(false);
    const t1 = report.per_trade.find((t) => t.testerTradeNum === 1)!;
    expect(t1.entrySlipTicks).toBe(3);
    expect(t1.withinTolerance).toBe(false);
    expect(report.max_abs_price_delta_ticks).toBe(3);
  });
});
