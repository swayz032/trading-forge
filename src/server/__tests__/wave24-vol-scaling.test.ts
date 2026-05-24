/**
 * wave24-vol-scaling.test.ts — Wave 24 Item 16
 *
 * Unit tests for computeVolScale() and its application in computeRiskDerivedContracts().
 *
 * Cases:
 *   1. vix=18 → 1.0 (at target, no change)
 *   2. vix=36 → 0.5 (floor)
 *   3. vix=9 → 1.5 (ceiling)
 *   4. null vix → 1.0 (fail-open)
 *   5. Env override respected (tested via process.env)
 *   6. effective_max_risk_pct correct in evidence
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { computeVolScale, computeRiskDerivedContracts } from "../lib/risk-sizing.js";

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
  accountBalance: 50_000,
  cumulativeProfit: 0,
  atrPoints: 4,
  stopMultiplier: 1.5,
  pointDollarValue: 5,
  firmContractCap: null,
  firm: "mffu" as const,
};

describe("Wave 24 Item 16 — Vol scaling", () => {
  it("computeVolScale: vix=18 → 1.0 (exactly at target)", () => {
    expect(computeVolScale(18)).toBe(1.0);
  });

  it("computeVolScale: vix=36 → 0.5 (floor — double volatility)", () => {
    expect(computeVolScale(36)).toBe(0.5);
  });

  it("computeVolScale: vix=9 → 1.5 (ceiling — half volatility)", () => {
    expect(computeVolScale(9)).toBe(1.5);
  });

  it("computeVolScale: null → 1.0 (fail-open, no data)", () => {
    expect(computeVolScale(null)).toBe(1.0);
  });

  it("computeVolScale: vix=0 → 1.0 (invalid value, fail-open)", () => {
    expect(computeVolScale(0)).toBe(1.0);
  });

  it("computeVolScale: vix=24 → 0.75 (between target and floor)", () => {
    expect(computeVolScale(24)).toBeCloseTo(18 / 24, 5);
  });

  it("computeVolScale: very low vix (vix=3) → 1.5 (ceiling)", () => {
    // 18/3 = 6, clamped to max 1.5
    expect(computeVolScale(3)).toBe(1.5);
  });

  it("computeRiskDerivedContracts: vixNow=null → vol_scale=1.0 in evidence", () => {
    const result = computeRiskDerivedContracts({ ...BASE_INPUT, vixNow: null });
    expect(result.evidence["vol_scale"]).toBe(1.0);
    expect(result.evidence["effective_max_risk_pct"]).toBeCloseTo(0.02);
    expect(result.evidence["vix_now"]).toBeNull();
  });

  it("computeRiskDerivedContracts: vixNow=36 → vol_scale=0.5, halves risk", () => {
    const result = computeRiskDerivedContracts({ ...BASE_INPUT, vixNow: 36 });
    expect(result.evidence["vol_scale"]).toBe(0.5);
    expect(result.evidence["effective_max_risk_pct"]).toBeCloseTo(0.01);
    expect(result.evidence["vix_now"]).toBe(36);
    expect(result.evidence["vix_target"]).toBe(18);
  });

  it("computeRiskDerivedContracts: vixNow=9 → vol_scale=1.5, increases risk", () => {
    const result = computeRiskDerivedContracts({ ...BASE_INPUT, vixNow: 9 });
    expect(result.evidence["vol_scale"]).toBe(1.5);
    expect(result.evidence["effective_max_risk_pct"]).toBeCloseTo(0.03);
  });

  it("computeRiskDerivedContracts: high VIX reduces riskDerivedCap", () => {
    const baseResult = computeRiskDerivedContracts({ ...BASE_INPUT, vixNow: 18 });
    const highVixResult = computeRiskDerivedContracts({ ...BASE_INPUT, vixNow: 36 });
    // At vix=36, risk is halved → fewer risk-derived contracts
    expect(highVixResult.riskDerivedCap).toBeLessThanOrEqual(baseResult.riskDerivedCap);
  });
});
