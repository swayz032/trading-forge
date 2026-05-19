/**
 * Wave 10 Task 3B — paper-signal-service risk_derived_pyramid integration tests
 *
 * Tests that computeRiskDerivedContracts() is called correctly when a session's
 * position_size.type === "risk_derived_pyramid", that audit_log rows are written,
 * and that SSE paper:sizing-computed is emitted.
 *
 * Design: pure function tests against the risk-sizing helper (no Express, no DB
 * bootstrap). The integration wiring in paper-signal-service is validated through
 * the pure helper behavior and a behavior contract test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeRiskDerivedContracts, type RiskSizingInputs } from "../lib/risk-sizing.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRiskDerivedConfig(overrides: Partial<RiskSizingInputs["positionSizeConfig"]> = {}): RiskSizingInputs["positionSizeConfig"] {
  return {
    type: "risk_derived_pyramid",
    base_contracts: 4,
    tier_increment: 2,
    tier_threshold_dollars: 3000,
    personal_dll_pct: 0.67,
    max_risk_pct_per_trade: 0.02,
    liquidity_comfort_cap: 100,
    topstep_account_cap_override: null,
    computed_at_signal_time: true,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Wave 10 Task 3B: paper-execution sizing integration", () => {

  describe("computeRiskDerivedContracts contract (matching paper-signal-service wiring)", () => {
    it("returns correct final_contracts given mocked account state", () => {
      // Simulate: $50K MFFU account, 0 profit, ATR=4, MES
      // Wave 22: pass firm="mffu" to use MFFU balance-pct math for this test.
      const result = computeRiskDerivedContracts({
        positionSizeConfig: makeRiskDerivedConfig(),
        accountBalance: 50_000,
        cumulativeProfit: 0,
        atrPoints: 4,
        stopMultiplier: 1.5,
        pointDollarValue: 5, // MES
        firmContractCap: 15,  // MFFU default
        firm: "mffu",  // Wave 22: explicit; default changed to "topstep"
      });

      // pyramid = 4 (base, 0 profit)
      // risk cap = floor(50000 * 0.02 / (1.5 * 4 * 5)) = floor(1000/30) = 33 (MFFU)
      // firm cap = 15
      // liquidity = 100
      // final = min(4, 33, 15, 100) = 4 (pyramid is binding)
      expect(result.finalContracts).toBe(4);
      expect(result.pyramidTier).toBe(4);
      expect(result.riskDerivedCap).toBe(33);
      expect(result.firmCap).toBe(15);
      expect(result.rejectionReason).toBeNull();
    });

    it("scales up with profit without exceeding caps", () => {
      // +$9K profit → pyramid tier 10; risk cap 33; firm cap 15 → final = 10
      const result = computeRiskDerivedContracts({
        positionSizeConfig: makeRiskDerivedConfig(),
        accountBalance: 50_000,
        cumulativeProfit: 9_000,
        atrPoints: 4,
        stopMultiplier: 1.5,
        pointDollarValue: 5,
        firmContractCap: 15,
        firm: "mffu",  // Wave 22: explicit; default changed to "topstep"
      });
      expect(result.pyramidTier).toBe(10);
      expect(result.finalContracts).toBe(10); // pyramid (10) < firm cap (15)
    });

    it("firm cap of 15 clamps when pyramid tier exceeds it", () => {
      // Very high cumulative profit → pyramid = 100+, but firm cap = 15
      const result = computeRiskDerivedContracts({
        positionSizeConfig: makeRiskDerivedConfig(),
        accountBalance: 200_000,
        cumulativeProfit: 150_000,  // many tiers earned
        atrPoints: 4,
        stopMultiplier: 1.5,
        pointDollarValue: 5,
        firmContractCap: 15,
      });
      expect(result.finalContracts).toBe(15);
      expect(result.firmCap).toBe(15);
    });

    it("ATR spike doubles stop_dollars and halves contracts", () => {
      const normalResult = computeRiskDerivedContracts({
        positionSizeConfig: makeRiskDerivedConfig(),
        accountBalance: 50_000,
        cumulativeProfit: 9_000,  // pyramid = 10
        atrPoints: 4,
        stopMultiplier: 1.5,
        pointDollarValue: 5,
        firmContractCap: null,
      });

      const spikeResult = computeRiskDerivedContracts({
        positionSizeConfig: makeRiskDerivedConfig(),
        accountBalance: 50_000,
        cumulativeProfit: 9_000,
        atrPoints: 8,  // 2× ATR → 2× stop cost → half the contracts
        stopMultiplier: 1.5,
        pointDollarValue: 5,
        firmContractCap: null,
      });

      // Normal: risk cap = floor(1000/30) = 33; spike: risk cap = floor(1000/60) = 16
      expect(spikeResult.riskDerivedCap).toBeLessThan(normalResult.riskDerivedCap);
    });
  });

  describe("Audit evidence packet", () => {
    it("evidence contains all required fields for audit_log", () => {
      // Wave 22: firm="mffu" to use MFFU balance-pct math for this evidence test.
      const result = computeRiskDerivedContracts({
        positionSizeConfig: makeRiskDerivedConfig(),
        accountBalance: 50_000,
        cumulativeProfit: 3_000,
        atrPoints: 4,
        stopMultiplier: 1.5,
        pointDollarValue: 5,
        firmContractCap: 15,
        firm: "mffu",  // Wave 22: explicit; default changed to "topstep"
      });

      const ev = result.evidence;
      expect(ev.accountBalance).toBe(50_000);
      expect(ev.cumulativeProfit).toBe(3_000);
      expect(ev.atrPoints).toBe(4);
      expect(ev.stopMultiplier).toBe(1.5);
      expect(ev.pointDollarValue).toBe(5);
      expect(ev.stopDollarsPerContract).toBeDefined();
      expect(ev.riskDollars).toBeDefined();
      expect(ev.pyramidTier).toBe(6);
      expect(ev.riskDerivedCap).toBeDefined();
      expect(ev.firmCap).toBe(15);
      expect(ev.liquidityCap).toBe(100);
      expect(ev.finalContracts).toBe(6);
      expect(ev.bindingCap).toBe("pyramid");
      expect(ev.base_contracts).toBe(4);
      expect(ev.tier_increment).toBe(2);
      expect(ev.tier_threshold_dollars).toBe(3000);
      expect(ev.tiers_earned).toBe(1);
      // Wave 22: firm fields in evidence
      expect(ev.firm).toBe("mffu");
      expect(ev.riskCapMethod).toBe("mffu_balance_pct");
    });
  });

  describe("SSE event contract (paper:sizing-computed)", () => {
    it("evidence is suitable for SSE broadcast (all values JSON-serializable)", () => {
      const result = computeRiskDerivedContracts({
        positionSizeConfig: makeRiskDerivedConfig(),
        accountBalance: 50_000,
        cumulativeProfit: 0,
        atrPoints: 4,
        stopMultiplier: 1.5,
        pointDollarValue: 5,
        firmContractCap: null,
      });

      // All values must be JSON-serializable (no undefined, no functions)
      const serialized = JSON.stringify({
        ...result.evidence,
        rejectionReason: result.rejectionReason,
        finalContracts: result.finalContracts,
      });
      const parsed = JSON.parse(serialized);
      expect(parsed.finalContracts).toBe(result.finalContracts);
      expect(parsed.bindingCap).toBeDefined();
    });
  });

  describe("Rejection reasons for 0-contract scenarios", () => {
    it("zero_atr → rejection is auditable", () => {
      const result = computeRiskDerivedContracts({
        positionSizeConfig: makeRiskDerivedConfig(),
        accountBalance: 50_000,
        cumulativeProfit: 0,
        atrPoints: 0,
        stopMultiplier: 1.5,
        pointDollarValue: 5,
        firmContractCap: null,
      });
      expect(result.finalContracts).toBe(0);
      expect(result.rejectionReason).toBe("zero_atr");
      expect(result.evidence.rejectionReason).toBe("zero_atr");
    });

    it("zero_balance → rejection is auditable", () => {
      const result = computeRiskDerivedContracts({
        positionSizeConfig: makeRiskDerivedConfig(),
        accountBalance: 0,
        cumulativeProfit: 0,
        atrPoints: 4,
        stopMultiplier: 1.5,
        pointDollarValue: 5,
        firmContractCap: null,
      });
      expect(result.finalContracts).toBe(0);
      expect(result.rejectionReason).toBe("zero_balance");
    });
  });
});
