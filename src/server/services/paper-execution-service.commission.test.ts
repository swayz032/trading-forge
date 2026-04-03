/**
 * Unit tests for commission deduction in the paper execution service.
 *
 * These tests cover:
 *   1. getCommissionPerSide() — firm lookup correctness
 *   2. Round-trip commission arithmetic (per-side × 2 × contracts)
 *   3. Net P&L deduction (grossPnl - commission)
 *   4. Fallback behaviour for null/unknown firmId
 *
 * No database required — getCommissionPerSide is a pure function.
 */

import { describe, it, expect } from "vitest";
import { getCommissionPerSide } from "../../shared/firm-config.js";

describe("getCommissionPerSide", () => {
  it("returns 0.37 for Topstep", () => {
    expect(getCommissionPerSide("topstep")).toBe(0.37);
  });

  it("returns 0.00 for Alpha Futures (no commission)", () => {
    expect(getCommissionPerSide("alpha")).toBe(0.00);
  });

  it("returns 1.29 for Tradeify", () => {
    expect(getCommissionPerSide("tradeify")).toBe(1.29);
  });

  it("returns 0.62 for MFFU", () => {
    expect(getCommissionPerSide("mffu")).toBe(0.62);
  });

  it("returns 0.62 for TPT", () => {
    expect(getCommissionPerSide("tpt")).toBe(0.62);
  });

  it("returns 0.62 for Apex", () => {
    expect(getCommissionPerSide("apex")).toBe(0.62);
  });

  it("returns 0.62 for FFN", () => {
    expect(getCommissionPerSide("ffn")).toBe(0.62);
  });

  it("returns 0.62 for Earn2Trade", () => {
    expect(getCommissionPerSide("earn2trade")).toBe(0.62);
  });

  it("falls back to 0.62 for null firmId (conservative default)", () => {
    expect(getCommissionPerSide(null)).toBe(0.62);
  });

  it("falls back to 0.62 for undefined firmId", () => {
    expect(getCommissionPerSide(undefined)).toBe(0.62);
  });

  it("falls back to 0.62 for unknown firmId", () => {
    expect(getCommissionPerSide("some_unknown_firm")).toBe(0.62);
  });

  it("is case-insensitive (TOPSTEP matches topstep)", () => {
    expect(getCommissionPerSide("TOPSTEP")).toBe(0.37);
  });
});

describe("Round-trip commission arithmetic", () => {
  /**
   * Mirrors the formula in closePosition():
   *   commission = commissionPerSide * 2 * contracts
   *   netPnl = grossPnl - commission
   */

  it("computes correct round-trip for Topstep 1-contract trade", () => {
    const perSide = getCommissionPerSide("topstep"); // 0.37
    const contracts = 1;
    const grossPnl = 100.00;
    const commission = perSide * 2 * contracts; // 0.74
    const netPnl = grossPnl - commission;        // 99.26
    expect(commission).toBeCloseTo(0.74, 4);
    expect(netPnl).toBeCloseTo(99.26, 4);
  });

  it("computes correct round-trip for Tradeify 3-contract trade", () => {
    const perSide = getCommissionPerSide("tradeify"); // 1.29
    const contracts = 3;
    const grossPnl = 387.50;
    const commission = perSide * 2 * contracts; // 7.74
    const netPnl = grossPnl - commission;        // 379.76
    expect(commission).toBeCloseTo(7.74, 4);
    expect(netPnl).toBeCloseTo(379.76, 4);
  });

  it("Alpha Futures has zero commission — netPnl equals grossPnl", () => {
    const perSide = getCommissionPerSide("alpha"); // 0.00
    const contracts = 5;
    const grossPnl = 250.00;
    const commission = perSide * 2 * contracts; // 0.00
    const netPnl = grossPnl - commission;        // 250.00
    expect(commission).toBe(0);
    expect(netPnl).toBe(grossPnl);
  });

  it("commission reduces a winning trade correctly", () => {
    // MES: 1 contract, $50 gross win on Topstep
    const grossPnl = 50.00;
    const commission = getCommissionPerSide("topstep") * 2 * 1; // 0.74
    expect(grossPnl - commission).toBeCloseTo(49.26, 4);
  });

  it("commission makes a break-even gross trade a net loser", () => {
    // A $0 gross trade still costs commission (expected behaviour — models real trading)
    const grossPnl = 0.00;
    const commission = getCommissionPerSide("mffu") * 2 * 1; // 1.24
    const netPnl = grossPnl - commission;
    expect(netPnl).toBeCloseTo(-1.24, 4);
  });
});
