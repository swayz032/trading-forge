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

  // Alpha Futures + Tradeify removed per migration 0097 (CLAUDE.md §6 — Topstep + MFFU only).
  // Both now return the 0.62 fallback; dedicated test cases removed to prevent misleading failures.

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

  // Tradeify + Alpha Futures round-trip tests removed (migration 0097 — firms removed).

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
