/**
 * Wave 2 (2026-07-16) — unified stop-geometry contract (TS helpers).
 *
 * Behavioral unit for src/server/lib/stop-geometry.ts. No mocks — uses the REAL
 * contract-class ceiling table so these assertions reflect production geometry.
 */
import { describe, it, expect } from "vitest";
import { managedStopPts, sizingStopPts, getStopFloorPts } from "../stop-geometry.js";

describe("Wave 2 stop-geometry contract", () => {
  it("managed stop is floor-free: MES ATR=4 mult 1.5 → 6 (initialStopPrice = entry − 6)", () => {
    const stopPts = managedStopPts("MES", 4, 1.5); // min(14, 6) = 6, NO floor
    expect(stopPts).toBe(6);
    const entry = 5000;
    expect(entry - stopPts).toBe(4994);
  });

  it("managed stop ceiling binds: MES ATR=14 mult 1.5 → 14 (not 21)", () => {
    expect(managedStopPts("MES", 14, 1.5)).toBe(14);
  });

  it("managed stop ceiling binds: MNQ ATR=50 mult 1.5 → 62", () => {
    expect(managedStopPts("MNQ", 50, 1.5)).toBe(62);
  });

  it("sizing stop floor WIDENS: MES ATR=3 mult 1.5 → 6 (not 4.5)", () => {
    expect(sizingStopPts("MES", 3, 1.5)).toBe(6);
  });

  it("sizing stop ceiling binds: MNQ ATR=50 mult 1.5 → 62 (distance ceilinged)", () => {
    expect(sizingStopPts("MNQ", 50, 1.5)).toBe(62);
  });

  it("MNQ has no default floor; MES floor = 6", () => {
    expect(getStopFloorPts("MES")).toBe(6);
    expect(getStopFloorPts("MNQ")).toBeNull();
  });

  it("INVARIANT: sizingStopPts >= managedStopPts for the full grid", () => {
    for (const sym of ["MES", "MNQ", "MCL", "ZZZ"]) {
      for (const atr of [0.5, 3, 4, 8, 9.34, 50]) {
        for (const mult of [1.5, 2.0, 5.0]) {
          expect(sizingStopPts(sym, atr, mult)).toBeGreaterThanOrEqual(managedStopPts(sym, atr, mult) - 1e-9);
        }
      }
    }
  });
});
