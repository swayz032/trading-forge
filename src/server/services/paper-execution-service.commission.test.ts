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
  it("returns 0.62 for Topstep (MES/MNQ $1.24 RT ÷ 2 — doc ★CORRECTION 2026-06-23, was stale 0.37)", () => {
    // fresh-scan-3 (2026-07-12): this assertion had been RED since the 2026-06-23 Topstep
    // commission correction. docs/prop-firm-rules-2026-topstep.md:359-374 is authoritative
    // (operator-provided TopstepX Commissions & Fees): micros MES/MNQ = $1.24 RT = $0.62/side.
    // The old $0.37 UNDER-COSTED every Topstep backtest; firm_config.py + shared/firm-config.ts
    // were corrected up to 0.62 but this test was never propagated. Code is correct; test was stale.
    expect(getCommissionPerSide("topstep")).toBe(0.62);
  });

  // Alpha Futures + Tradeify removed per migration 0097 (CLAUDE.md §6 — Topstep + MFFU only).
  // Both now return the 0.62 fallback; dedicated test cases removed to prevent misleading failures.

  it("returns 0.95 for MFFU (MES/MNQ $1.90 RT ÷ 2 — verified myfundedfutures.com 2026 + firm-config.ts:109)", () => {
    // 2026-06-29: corrected from stale 0.62. MFFU MES/MNQ round-trip is $1.90 = $0.95/side
    // (MCL $1.16 RT = $0.58/side; single firm value is $0.95). The old 0.62 was the generic
    // micro fallback wrongly applied to MFFU — see docs/prop-firm-rules-2026-mffu.md:243.
    expect(getCommissionPerSide("mffu")).toBe(0.95);
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
    expect(getCommissionPerSide("TOPSTEP")).toBe(0.62);
  });
});

describe("Round-trip commission arithmetic", () => {
  /**
   * Mirrors the formula in closePosition():
   *   commission = commissionPerSide * 2 * contracts
   *   netPnl = grossPnl - commission
   */

  it("computes correct round-trip for Topstep 1-contract trade", () => {
    const perSide = getCommissionPerSide("topstep"); // 0.62 ($1.24 RT ÷ 2)
    const contracts = 1;
    const grossPnl = 100.00;
    const commission = perSide * 2 * contracts; // 1.24
    const netPnl = grossPnl - commission;        // 98.76
    expect(commission).toBeCloseTo(1.24, 4);
    expect(netPnl).toBeCloseTo(98.76, 4);
  });

  // Tradeify + Alpha Futures round-trip tests removed (migration 0097 — firms removed).

  it("commission reduces a winning trade correctly", () => {
    // MES: 1 contract, $50 gross win on Topstep
    const grossPnl = 50.00;
    const commission = getCommissionPerSide("topstep") * 2 * 1; // 1.24 ($0.62/side × 2)
    expect(grossPnl - commission).toBeCloseTo(48.76, 4);
  });

  it("commission makes a break-even gross trade a net loser", () => {
    // A $0 gross trade still costs commission (expected behaviour — models real trading)
    const grossPnl = 0.00;
    const commission = getCommissionPerSide("mffu") * 2 * 1; // 1.90 ($0.95/side × 2, MFFU MES/MNQ $1.90 RT)
    const netPnl = grossPnl - commission;
    expect(netPnl).toBeCloseTo(-1.90, 4);
  });
});
