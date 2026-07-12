import { describe, it, expect } from "vitest";
import { avwapTypicalPrice, shouldAdvanceRunnerTrail } from "./runner-trail-ratchet.js";

/**
 * F1/F2 regression (deep-scan 2026-07-11). These pin the two adaptive runner-trail formulas that
 * paper-execution-service.ts::updatePositionPrices depends on for backtest<->paper parity. The pre-fix
 * behavior (close-only AVWAP basis; first computedTrail accepted unconditionally / advance before TP2)
 * must fail here.
 */
describe("avwapTypicalPrice (F2 anchored-VWAP basis)", () => {
  it("is the typical price (high+low+close)/3, matching backtester.py typical_price", () => {
    expect(avwapTypicalPrice(102, 98, 100)).toBe(100);
    expect(avwapTypicalPrice(110, 90, 106)).toBeCloseTo((110 + 90 + 106) / 3, 10);
  });

  it("differs from the pre-fix close-only basis when the close skews to a bar extreme", () => {
    // Close pinned at the high of a wide bar: typical price sits BELOW the close.
    const high = 120, low = 100, close = 120;
    const typical = avwapTypicalPrice(high, low, close);
    expect(typical).toBeCloseTo(113.3333, 3);
    expect(typical).toBeLessThan(close); // the pre-fix (close) would have over-stated the AVWAP basis
  });
});

describe("shouldAdvanceRunnerTrail (F1 TP2-gate + initialStop floor)", () => {
  const base = { computedTrail: 100, currentTrailHwm: null as number | null, initialStop: 90, tp1Filled: true, tp2Filled: true };

  it("does NOT advance before TP2 fills (mirror backtester `if tp2_filled`)", () => {
    expect(shouldAdvanceRunnerTrail({ ...base, side: "long", tp2Filled: false })).toBe(false);
    expect(shouldAdvanceRunnerTrail({ ...base, side: "long", tp1Filled: false })).toBe(false);
  });

  it("advances a long only when the new stop is HIGHER than the floor", () => {
    // First write (trailHwm null) floors at initialStop=90. computedTrail 100 > 90 -> advance.
    expect(shouldAdvanceRunnerTrail({ ...base, side: "long", currentTrailHwm: null, computedTrail: 100 })).toBe(true);
    // computedTrail 85 is BELOW the structural stop -> must NOT loosen below the sized stop (the pre-fix bug).
    expect(shouldAdvanceRunnerTrail({ ...base, side: "long", currentTrailHwm: null, computedTrail: 85 })).toBe(false);
    // Established trail 105: only a still-higher stop advances.
    expect(shouldAdvanceRunnerTrail({ ...base, side: "long", currentTrailHwm: 105, computedTrail: 108 })).toBe(true);
    expect(shouldAdvanceRunnerTrail({ ...base, side: "long", currentTrailHwm: 105, computedTrail: 104 })).toBe(false);
  });

  it("advances a short only when the new stop is LOWER than the floor (mirror-image)", () => {
    // Short: initialStop above entry; a tighter stop is a LOWER number.
    expect(shouldAdvanceRunnerTrail({ side: "short", computedTrail: 90, currentTrailHwm: null, initialStop: 100, tp1Filled: true, tp2Filled: true })).toBe(true);
    expect(shouldAdvanceRunnerTrail({ side: "short", computedTrail: 105, currentTrailHwm: null, initialStop: 100, tp1Filled: true, tp2Filled: true })).toBe(false);
    expect(shouldAdvanceRunnerTrail({ side: "short", computedTrail: 92, currentTrailHwm: 95, initialStop: 100, tp1Filled: true, tp2Filled: true })).toBe(true);
    expect(shouldAdvanceRunnerTrail({ side: "short", computedTrail: 96, currentTrailHwm: 95, initialStop: 100, tp1Filled: true, tp2Filled: true })).toBe(false);
  });

  it("cannot advance when there is no floor at all (no trailHwm and no initialStop)", () => {
    expect(shouldAdvanceRunnerTrail({ ...base, side: "long", currentTrailHwm: null, initialStop: null })).toBe(false);
  });

  it("prefers the live trailHwm over initialStop as the floor once a trail exists", () => {
    // trailHwm 110 present -> floor is 110 (not initialStop 90); computedTrail 100 < 110 -> no advance.
    expect(shouldAdvanceRunnerTrail({ ...base, side: "long", currentTrailHwm: 110, computedTrail: 100 })).toBe(false);
  });
});
