/**
 * wave24-liquidity-haircut.test.ts — Wave 24 Item 11
 *
 * Unit tests for computeLiquidityHaircut().
 *
 * Cases:
 *   1. haircut=1.0 (equal depths) → no-op
 *   2. haircut=0.5 (50% depth) → halves cap
 *   3. missing data → fail-open with 1.0
 *   4. liquidityCap in computeRiskDerivedContracts correctly reflects haircut
 */

import { describe, it, expect } from "vitest";
import { computeLiquidityHaircut, computeRiskDerivedContracts } from "../lib/risk-sizing.js";

const BASE_INPUT = {
  positionSizeConfig: {
    type: "risk_derived_pyramid" as const,
    base_contracts: 6,
    tier_increment: 3,
    tier_threshold_dollars: 3000,
    personal_dll_pct: 0.67,
    max_risk_pct_per_trade: 0.02,
    liquidity_comfort_cap: 100,
    topstep_account_cap_override: null,
    computed_at_signal_time: true as const,
  },
  accountBalance: 200_000,  // large enough so risk cap isn't binding
  cumulativeProfit: 0,
  atrPoints: 2,
  stopMultiplier: 1.5,
  pointDollarValue: 5,
  firmContractCap: null,
  firm: "mffu" as const,
};

describe("Wave 24 Item 11 — Liquidity haircut", () => {
  it("computeLiquidityHaircut: equal depths → 1.0 (no-op)", () => {
    expect(computeLiquidityHaircut(200, 200)).toBe(1.0);
  });

  it("computeLiquidityHaircut: 50% depth → 0.5", () => {
    expect(computeLiquidityHaircut(100, 200)).toBe(0.5);
  });

  it("computeLiquidityHaircut: depth > baseline (liquidity improved) → capped at 1.0", () => {
    expect(computeLiquidityHaircut(250, 200)).toBe(1.0);
  });

  it("computeLiquidityHaircut: null currentTop3Depth → 1.0 (fail-open)", () => {
    expect(computeLiquidityHaircut(null, 200)).toBe(1.0);
  });

  it("computeLiquidityHaircut: null baseline → 1.0 (fail-open)", () => {
    expect(computeLiquidityHaircut(100, null)).toBe(1.0);
  });

  it("computeLiquidityHaircut: both null → 1.0 (fail-open)", () => {
    expect(computeLiquidityHaircut(null, null)).toBe(1.0);
  });

  it("computeLiquidityHaircut: zero baseline → 1.0 (avoid div-by-zero)", () => {
    expect(computeLiquidityHaircut(100, 0)).toBe(1.0);
  });

  it("computeRiskDerivedContracts: no depth data → liquidityCap=100 (unchanged)", () => {
    const result = computeRiskDerivedContracts(BASE_INPUT);
    expect(result.liquidityCap).toBe(100);
    expect(result.evidence["liquidity_haircut"]).toBe(1.0);
  });

  it("computeRiskDerivedContracts: 50% depth collapse → liquidityCap=50", () => {
    const result = computeRiskDerivedContracts({
      ...BASE_INPUT,
      currentTop3Depth: 50,
      baseline20dMedianTop3Depth: 100,
    });
    expect(result.liquidityCap).toBe(50);
    expect(result.evidence["liquidity_haircut"]).toBe(0.5);
    expect(result.evidence["liquidity_cap_raw"]).toBe(100);
  });

  it("computeRiskDerivedContracts: 27% depth collapse (Liberation Day) → liquidityCap=73", () => {
    // CME paper -27% top-3 depth collapse
    const result = computeRiskDerivedContracts({
      ...BASE_INPUT,
      currentTop3Depth: 73,
      baseline20dMedianTop3Depth: 100,
    });
    expect(result.liquidityCap).toBe(73);
    expect(result.evidence["liquidity_haircut"]).toBeCloseTo(0.73);
  });

  it("computeRiskDerivedContracts: liquidityCap correctly computed from haircut (stored in evidence)", () => {
    // Verify the haircut is applied to the liquidityCap field in the result.
    // Note: on a healthy account (balance >> starting capital), the pyramid floor
    // (base_contracts=6) may override a very tight liquidityCap — that's correct behavior
    // (the floor ensures at least 6 contracts for Style C 33/33/33 partials on healthy accounts).
    // We test the haircut computation is correct in evidence, not that it overrides the floor.
    const result = computeRiskDerivedContracts({
      ...BASE_INPUT,
      currentTop3Depth: 50,      // 50% haircut → liquidityCap = floor(100 * 0.5) = 50
      baseline20dMedianTop3Depth: 100,
    });
    expect(result.liquidityCap).toBe(50);
    expect(result.evidence["liquidity_haircut"]).toBe(0.5);
    // finalContracts must be bounded by liquidityCap
    expect(result.finalContracts).toBeLessThanOrEqual(50);
  });
});
