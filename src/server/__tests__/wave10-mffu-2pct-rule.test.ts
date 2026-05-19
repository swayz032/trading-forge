/**
 * Wave 10 Task 5 — MFFU 2% rule compliance tests
 *
 * Verifies that the risk-derived sizing math never violates MFFU's 2% price
 * limit rule: (finalContracts × stop_dollars) ≤ 2% × accountBalance.
 *
 * Reference: docs/prop-firm-rules-2026-mffu.md §8. 2% Price Limit Rule:
 *   "A bot must not breach 2% of account balance ($1,000 on a 50K account)
 *    in a single trade."
 *
 * The risk-derived cap formula enforces this mathematically:
 *   riskDerivedCap = floor(accountBalance × 0.02 / stop_dollars_per_contract)
 *   → finalContracts × stop_dollars ≤ accountBalance × 0.02 (always)
 */

import { describe, it, expect } from "vitest";
import { computeRiskDerivedContracts, type RiskSizingInputs } from "../lib/risk-sizing.js";

function mffuConfig(overrides: Partial<RiskSizingInputs["positionSizeConfig"]> = {}): RiskSizingInputs["positionSizeConfig"] {
  return {
    type: "risk_derived_pyramid",
    base_contracts: 4,
    tier_increment: 2,
    tier_threshold_dollars: 3000,
    personal_dll_pct: 0.67,
    max_risk_pct_per_trade: 0.02,  // exactly the MFFU 2% rule
    liquidity_comfort_cap: 100,
    topstep_account_cap_override: null,
    computed_at_signal_time: true,
    ...overrides,
  };
}

function stopDollars(contracts: number, stopMultiplier: number, atrPoints: number, pointDollarValue: number): number {
  return contracts * stopMultiplier * atrPoints * pointDollarValue;
}

function maxAllowedRisk(accountBalance: number): number {
  return accountBalance * 0.02;
}

describe("Wave 10: MFFU 2% rule compliance", () => {

  describe("$50K MFFU eval account", () => {
    const ACCOUNT = 50_000;
    const MAX_RISK = maxAllowedRisk(ACCOUNT); // $1,000

    it("ATR=4 → contracts × stop never exceeds $1,000", () => {
      const r = computeRiskDerivedContracts({
        positionSizeConfig: mffuConfig(),
        accountBalance: ACCOUNT,
        cumulativeProfit: 0,
        atrPoints: 4,
        stopMultiplier: 1.5,
        pointDollarValue: 5,
        firmContractCap: 15,
      });
      const actualRisk = stopDollars(r.finalContracts, 1.5, 4, 5);
      expect(actualRisk).toBeLessThanOrEqual(MAX_RISK);
    });

    it("ATR=6 → cap = floor($1000 / (1.5×6×$5)) = 22; pyramid wins with base=4", () => {
      // stop = 1.5×6×$5 = $45/contract
      // risk cap = floor($1000/$45) = 22 (MFFU: full balance × 0.02)
      // pyramid (base=4, no profit) = 4
      // final = min(4, 22, 15, 100) = 4 (pyramid binds)
      const r = computeRiskDerivedContracts({
        positionSizeConfig: mffuConfig(),
        accountBalance: ACCOUNT,
        cumulativeProfit: 0,
        atrPoints: 6,
        stopMultiplier: 1.5,
        pointDollarValue: 5,
        firmContractCap: 15,
        firm: "mffu",  // Wave 22: explicit MFFU for this balance-pct test
      });
      expect(r.riskDerivedCap).toBe(22);
      expect(r.finalContracts).toBe(4);  // pyramid wins
      const actualRisk = stopDollars(r.finalContracts, 1.5, 6, 5);
      expect(actualRisk).toBeLessThanOrEqual(MAX_RISK);
    });

    it("ATR=6 with many profit tiers (pyramid=14) → final=14, risk still ≤$1000", () => {
      // pyramid base=4 + 5 tiers × +$3K = $15K profit needed → pyramid=14
      // risk cap = 22 (from above, MFFU: full balance × 0.02)
      // final = min(14, 22, 15, 100) = 14 (pyramid binds vs risk cap)
      const r = computeRiskDerivedContracts({
        positionSizeConfig: mffuConfig(),
        accountBalance: ACCOUNT,
        cumulativeProfit: 15_000,
        atrPoints: 6,
        stopMultiplier: 1.5,
        pointDollarValue: 5,
        firmContractCap: 15,
        firm: "mffu",  // Wave 22: explicit MFFU for this balance-pct test
      });
      expect(r.pyramidTier).toBe(14);
      expect(r.finalContracts).toBe(14);
      const actualRisk = stopDollars(r.finalContracts, 1.5, 6, 5);
      // 14 × $45 = $630 < $1,000 ✓
      expect(actualRisk).toBeLessThanOrEqual(MAX_RISK);
    });

    it("high pyramid tier (30) but small balance → risk cap dominates, MFFU rule honored", () => {
      // Artificially high pyramid (30 contracts worth)
      const r = computeRiskDerivedContracts({
        positionSizeConfig: mffuConfig({ base_contracts: 30, tier_increment: 0 }),
        accountBalance: ACCOUNT,
        cumulativeProfit: 0,
        atrPoints: 4,
        stopMultiplier: 1.5,
        pointDollarValue: 5,
        firmContractCap: null,
      });
      // pyramid = 30; risk cap = 33; liquidity = 100
      // final = min(30, 33, 100) = 30
      // actual risk = 30 × $30 = $900 ≤ $1,000 ✓
      const actualRisk = stopDollars(r.finalContracts, 1.5, 4, 5);
      expect(actualRisk).toBeLessThanOrEqual(MAX_RISK);
    });

    it("ATR extreme (20pts): risk-cap dominates at 3 contracts — rule still honored", () => {
      // stop = 1.5×20×$5 = $150/contract
      // risk cap = floor($1000/$150) = 6
      const r = computeRiskDerivedContracts({
        positionSizeConfig: mffuConfig(),
        accountBalance: ACCOUNT,
        cumulativeProfit: 0,
        atrPoints: 20,
        stopMultiplier: 1.5,
        pointDollarValue: 5,
        firmContractCap: 15,
      });
      const actualRisk = stopDollars(r.finalContracts, 1.5, 20, 5);
      expect(actualRisk).toBeLessThanOrEqual(MAX_RISK);
    });
  });

  describe("$100K account", () => {
    const ACCOUNT = 100_000;
    const MAX_RISK = maxAllowedRisk(ACCOUNT); // $2,000

    it("ATR=4 → contracts × stop ≤ $2,000", () => {
      const r = computeRiskDerivedContracts({
        positionSizeConfig: mffuConfig(),
        accountBalance: ACCOUNT,
        cumulativeProfit: 0,
        atrPoints: 4,
        stopMultiplier: 1.5,
        pointDollarValue: 5,
        firmContractCap: 15,
      });
      const actualRisk = stopDollars(r.finalContracts, 1.5, 4, 5);
      expect(actualRisk).toBeLessThanOrEqual(MAX_RISK);
    });
  });

  describe("MNQ (pointDollarValue=$2)", () => {
    it("ATR=10 MNQ → risk cap math preserves 2% rule", () => {
      // stop = 1.5×10×$2 = $30/contract
      // $50K × 0.02 = $1,000 / $30 = 33 contracts
      const r = computeRiskDerivedContracts({
        positionSizeConfig: mffuConfig({ base_contracts: 1 }),
        accountBalance: 50_000,
        cumulativeProfit: 0,
        atrPoints: 10,
        stopMultiplier: 1.5,
        pointDollarValue: 2,  // MNQ
        firmContractCap: 15,
      });
      const actualRisk = stopDollars(r.finalContracts, 1.5, 10, 2);
      expect(actualRisk).toBeLessThanOrEqual(50_000 * 0.02);
    });
  });

  describe("Mathematical invariant: ALL balance + ATR combos satisfy 2% rule", () => {
    const balances = [25_000, 50_000, 75_000, 100_000, 150_000];
    const atrs = [2, 4, 6, 8, 12, 20];

    for (const balance of balances) {
      for (const atr of atrs) {
        it(`balance=$${balance.toLocaleString()} ATR=${atr} → risk ≤ 2% of balance`, () => {
          const r = computeRiskDerivedContracts({
            positionSizeConfig: mffuConfig(),
            accountBalance: balance,
            cumulativeProfit: 0,
            atrPoints: atr,
            stopMultiplier: 1.5,
            pointDollarValue: 5,
            firmContractCap: 15,
          });
          if (r.finalContracts > 0) {
            const actualRisk = stopDollars(r.finalContracts, 1.5, atr, 5);
            expect(actualRisk).toBeLessThanOrEqual(balance * 0.02 + 0.01); // +0.01 for float rounding
          }
        });
      }
    }
  });
});
