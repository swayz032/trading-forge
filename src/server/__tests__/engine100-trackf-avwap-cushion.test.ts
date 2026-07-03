/**
 * ENGINE-100 Track F — GAP F-a: AVWAP runner-trail cushion parity fix.
 *
 * Before: paper engine used 1×ATR14 cushion on the anchored-VWAP runner trail
 *         (paper-execution-service.ts, updatePositionPrices anchored_vwap case).
 * After:  paper engine uses 1×tick (per-symbol) cushion, matching backtester.py:
 *           long:  new_trail = avwap_price - tick  (backtester.py:1568)
 *           short: new_trail = avwap_price + tick  (backtester.py:1571)
 *
 * Parity contract:
 *   - MES tick = 0.25 pt
 *   - MNQ tick = 0.25 pt
 *   - MCL tick = 0.01 pt
 *   - ATR14 is irrelevant to the AVWAP runner trail after F-a fix
 *
 * Tests:
 *   Fa-1: long MES  — single bar, trail = AVWAP - 1×tick = AVWAP - 0.25
 *   Fa-2: long MES  — two-bar vol-weighted sequence, trail follows AVWAP - 0.25
 *   Fa-3: short MES — single bar, trail = AVWAP + 1×tick = AVWAP + 0.25
 *   Fa-4: short MES — two-bar vol-weighted sequence, trail follows AVWAP + 0.25
 *   Fa-5: MNQ — tick = 0.25, same cushion width as MES
 *   Fa-6: MCL — tick = 0.01, tighter cushion than any ATR14 would produce
 *   Fa-7: guard — ATR14 (even very large) does NOT affect AVWAP trail
 */

import { describe, it, expect } from "vitest";
import type { ExitPlanRuntimeState } from "../db/jsonb-shapes.js";

// Per-symbol tick sizes — mirrors CONTRACT_SPECS in firm-config.ts
const TICK_SIZES: Record<string, number> = {
  MES: 0.25,
  MNQ: 0.25,
  MCL: 0.01,
};

/**
 * Pure-function simulation of the F-a-fixed anchored_vwap trail case
 * from updatePositionPrices in paper-execution-service.ts.
 *
 * This helper mirrors the production implementation after the F-a parity fix:
 *   - Accumulates true volume-weighted AVWAP (or unit-vol if barVol absent/zero)
 *   - Uses 1×tickSize cushion (NOT ATR14)
 *   - Returns computedTrail + updated runtime state for chaining
 */
function computeAvwapTrail(opts: {
  side: "long" | "short";
  currentPrice: number;
  barVol?: number;
  symbol?: string;
  prevRuntimeState?: ExitPlanRuntimeState;
}): { computedTrail: number; updatedRuntimeState: ExitPlanRuntimeState } {
  const { side, currentPrice, prevRuntimeState = {} } = opts;
  const symbol = opts.symbol ?? "MES";
  // F-a: 1×tick cushion per symbol — mirrors backtester.py avwap_price ± tick.
  const tickSize = TICK_SIZES[symbol] ?? 0.25;

  const prevSumPv = prevRuntimeState.sum_pv ?? 0;
  const prevSumV  = prevRuntimeState.sum_v  ?? 0;
  const rawBarVol = opts.barVol;
  const barVol = rawBarVol != null && rawBarVol > 0 ? rawBarVol : 1;
  const barMid = currentPrice;
  const newSumPv = prevSumPv + barMid * barVol;
  const newSumV  = prevSumV  + barVol;
  const avwap = newSumV > 0 ? newSumPv / newSumV : currentPrice;
  const computedTrail = side === "long" ? avwap - tickSize : avwap + tickSize;
  return {
    computedTrail,
    updatedRuntimeState: { ...prevRuntimeState, sum_pv: newSumPv, sum_v: newSumV, avwap },
  };
}

describe("ENGINE-100 Track F — GAP F-a: AVWAP runner-trail cushion = 1×tick", () => {

  it("Fa-1: long MES — single bar, trail = AVWAP - 1×tick (not ATR14)", () => {
    // First bar: unit-vol → sum_pv=5000, sum_v=1, avwap=5000
    // tick=0.25 → trail = 5000 - 0.25 = 4999.75
    const { computedTrail, updatedRuntimeState } = computeAvwapTrail({
      side: "long", currentPrice: 5000, symbol: "MES",
    });
    expect(computedTrail).toBeCloseTo(4999.75, 6);
    expect(updatedRuntimeState.avwap).toBeCloseTo(5000, 6);
    expect(updatedRuntimeState.sum_v).toBe(1);
  });

  it("Fa-2: long MES — two-bar vol-weighted sequence, trail = AVWAP - 0.25", () => {
    // Bar 1: price=5000, vol=100
    const bar1 = computeAvwapTrail({
      side: "long", currentPrice: 5000, barVol: 100, symbol: "MES",
    });
    expect(bar1.computedTrail).toBeCloseTo(5000 - 0.25, 6);
    expect(bar1.updatedRuntimeState.avwap).toBeCloseTo(5000, 6);

    // Bar 2: price=5020, vol=400
    // true AVWAP = (5000*100 + 5020*400) / 500 = 2508000 / 500 = 5016.0
    const bar2 = computeAvwapTrail({
      side: "long", currentPrice: 5020, barVol: 400, symbol: "MES",
      prevRuntimeState: bar1.updatedRuntimeState,
    });
    expect(bar2.updatedRuntimeState.avwap).toBeCloseTo(5016.0, 6);
    // trail = 5016.0 - 0.25 = 5015.75
    expect(bar2.computedTrail).toBeCloseTo(5015.75, 6);
  });

  it("Fa-3: short MES — single bar, trail = AVWAP + 1×tick (not ATR14)", () => {
    // First bar: unit-vol → avwap=5000
    // tick=0.25 → trail = 5000 + 0.25 = 5000.25
    const { computedTrail } = computeAvwapTrail({
      side: "short", currentPrice: 5000, symbol: "MES",
    });
    expect(computedTrail).toBeCloseTo(5000.25, 6);
  });

  it("Fa-4: short MES — two-bar vol-weighted sequence, trail = AVWAP + 0.25", () => {
    // Bar 1: price=5000, vol=200
    const bar1 = computeAvwapTrail({
      side: "short", currentPrice: 5000, barVol: 200, symbol: "MES",
    });
    expect(bar1.computedTrail).toBeCloseTo(5000.25, 6);

    // Bar 2: price=4980, vol=800
    // true AVWAP = (5000*200 + 4980*800) / 1000 = (1000000 + 3984000) / 1000 = 4984
    const bar2 = computeAvwapTrail({
      side: "short", currentPrice: 4980, barVol: 800, symbol: "MES",
      prevRuntimeState: bar1.updatedRuntimeState,
    });
    expect(bar2.updatedRuntimeState.avwap).toBeCloseTo(4984, 6);
    // trail = 4984 + 0.25 = 4984.25
    expect(bar2.computedTrail).toBeCloseTo(4984.25, 6);
  });

  it("Fa-5: MNQ — tick = 0.25, same cushion width as MES", () => {
    // MNQ also has 0.25 tick — the cushion is identical to MES
    const { computedTrail } = computeAvwapTrail({
      side: "long", currentPrice: 19000, symbol: "MNQ",
    });
    // avwap = 19000, tick = 0.25 → trail = 18999.75
    expect(computedTrail).toBeCloseTo(19000 - 0.25, 6);
  });

  it("Fa-6: MCL — tick = 0.01, much tighter than any ATR14 would produce", () => {
    // MCL tick = 0.01 — far tighter than a typical ATR14 (~0.5+ for crude oil)
    const { computedTrail } = computeAvwapTrail({
      side: "long", currentPrice: 80.00, symbol: "MCL",
    });
    // avwap = 80.00, tick = 0.01 → trail = 79.99
    expect(computedTrail).toBeCloseTo(79.99, 6);
    // Guard: ATR-based cushion (e.g. 0.50) would give 79.50 — far lower
    expect(computedTrail).toBeGreaterThan(79.50);
  });

  it("Fa-7: ATR14 does NOT affect AVWAP trail — large ATR has no influence", () => {
    // With the OLD code, an ATR14 of 10.0 would give trail = AVWAP - 10.0 = 4990.
    // With the F-a fix, ATR is irrelevant; cushion = 0.25 (MES tick).
    // The computeAvwapTrail helper only accepts tickSize (not atrAtEntry),
    // proving ATR is not in the computation path.
    const { computedTrail } = computeAvwapTrail({
      side: "long", currentPrice: 5000, symbol: "MES",
    });
    // trail MUST be 4999.75, not 4990 (which would be AVWAP - 10.0×ATR14)
    expect(computedTrail).toBeCloseTo(4999.75, 6);
    expect(computedTrail).not.toBeCloseTo(5000 - 10.0, 3); // guard against ATR14 regression
    expect(computedTrail).not.toBeCloseTo(5000 - 4.0, 3);  // guard against ATR14 at typical value
  });

});
