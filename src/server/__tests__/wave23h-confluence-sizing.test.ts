/**
 * wave23h-confluence-sizing.test.ts — W23H.4 Confluence-weighted sizing
 *
 * Tests that:
 *   1. confluence_count=1 (or omitted) → multiplier 1.0 → no behavior change
 *   2. confluence_count=2             → multiplier 1.0 → no behavior change
 *   3. confluence_count=3             → multiplier 1.5 → upsize 50%
 *   4. confluence_count=4             → multiplier 2.0 → upsize 100%
 *   5. confluence_count=5+            → clamps to multiplier for 4 (2.0)
 *   6. confluence_count=0/-ve         → clamps to multiplier for 1 (1.0)
 *   7. Liquidity cap binds when multiplied size exceeds it
 *   8. Wave 23 pyramid floor preserved on healthy account with 1 confluence factor
 *   9. firmCap binds when multiplied size exceeds it
 *  10. Audit shape: confluenceAudit has all required fields with correct values
 *  11. Operator map override: per-strategy map replaces canonical defaults
 *  12. MFFU path: confluence multiplier applies correctly for MFFU firm
 *
 * No DB, no mocks, no service imports.
 * Architecture: risk-sizing.ts is a pure helper — audit payload is in the result struct;
 * callers emit it via insertAuditRow(). Tests verify the payload shape is correct.
 */

import { describe, it, expect } from "vitest";
import {
  computeRiskDerivedContracts,
  resolveConfluenceMultiplier,
  DEFAULT_CONFLUENCE_MULTIPLIER,
  type RiskSizingInputs,
} from "../lib/risk-sizing.js";

// ── Standard MES base-6 config (Wave 23 canonical) ──────────────────────────
const MES_CFG_BASE6: RiskSizingInputs["positionSizeConfig"] = {
  type: "risk_derived_pyramid",
  base_contracts: 6,
  tier_increment: 3,
  tier_threshold_dollars: 3000,
  personal_dll_pct: 0.67,
  max_risk_pct_per_trade: 0.02,
  liquidity_comfort_cap: 100, // MES operator-canonical cap
  topstep_account_cap_override: null,
  computed_at_signal_time: true,
};

// ── Standard healthy Topstep $50K params ────────────────────────────────────
// ATR=4pt, stop_mult=1.5 → stopDollars = 1.5 × 4 × $5 = $30/contract
// buffer = $50K - ($50K - $2K) = $50K - $48K = $2K (HWM=starting, trailing floor = $48K)
// riskDollars = $2K × 0.02 = $40
// riskDerivedCap = floor($40/$30) = 1
// BUT accountIsHealthy (50K/50K = 1.0 >= 0.85) → pyramidFloor applies → base 6
const TOPSTEP_50K_HEALTHY: Partial<RiskSizingInputs> = {
  firm: "topstep",
  trailingDD: 2000,
  highWaterBalance: 50_000,
  accountStartingFloor: 50_000,
  accountBalance: 50_000,
  cumulativeProfit: 0,
  atrPoints: 4,
  stopMultiplier: 1.5,
  pointDollarValue: 5, // MES = $5/point
  firmContractCap: null,
  positionSizeConfig: MES_CFG_BASE6,
};

// ── MFFU $50K healthy: balance-pct math ─────────────────────────────────────
// riskDollars = $50K × 0.02 = $1,000
// stopDollars = 1.5 × 4 × $5 = $30
// riskDerivedCap = floor($1,000/$30) = 33
// pyramidTier = 6 (base, no profit)
// final (no multiplier) = min(6, 33, 100) = 6
const MFFU_50K_HEALTHY: Partial<RiskSizingInputs> = {
  firm: "mffu",
  accountBalance: 50_000,
  accountStartingFloor: 50_000,
  cumulativeProfit: 0,
  atrPoints: 4,
  stopMultiplier: 1.5,
  pointDollarValue: 5,
  firmContractCap: null,
  positionSizeConfig: MES_CFG_BASE6,
};

// ── Large MFFU account: pyramid tier well above base ────────────────────────
// cumulativeProfit = $60K → tiers = floor(60000/3000) = 20 → pyramidTier = 6 + 3×20 = 66
// riskDollars = $500K × 0.02 = $10,000 / $30 = 333 riskDerivedCap
// final (no multiplier) = min(66, 333, 100) = 66 (pyramidTier binds vs liquidityCap)
const MFFU_LARGE_ACCOUNT: Partial<RiskSizingInputs> = {
  firm: "mffu",
  accountBalance: 500_000,
  accountStartingFloor: 50_000,
  cumulativeProfit: 60_000,
  atrPoints: 4,
  stopMultiplier: 1.5,
  pointDollarValue: 5,
  firmContractCap: null,
  positionSizeConfig: MES_CFG_BASE6,
};

// ── Huge MFFU account: liquidity cap test ────────────────────────────────────
// cumulativeProfit = $150K → tiers = 50 → pyramidTier = 6 + 150 = 156
// riskDollars = $2M × 0.02 = $40K / $30 = 1333 riskDerivedCap
// final (no multiplier) = min(156, 1333, 100) = 100 (liquidity cap binds)
// With 4-factor multiplier (2.0×): min(312, 2666, 100) = 100 (liquidity cap still binds)
const MFFU_HUGE_ACCOUNT_LIQUIDITY_TEST: Partial<RiskSizingInputs> = {
  firm: "mffu",
  accountBalance: 2_000_000,
  accountStartingFloor: 50_000,
  cumulativeProfit: 150_000,
  atrPoints: 4,
  stopMultiplier: 1.5,
  pointDollarValue: 5,
  firmContractCap: null,
  positionSizeConfig: MES_CFG_BASE6,
};

// ────────────────────────────────────────────────────────────────────────────

describe("W23H.4: resolveConfluenceMultiplier", () => {
  it("count=1 → 1.0 (primary only)", () => {
    expect(resolveConfluenceMultiplier(1)).toBe(1.0);
  });

  it("count=2 → 1.0 (one confirming, not enough to upsize)", () => {
    expect(resolveConfluenceMultiplier(2)).toBe(1.0);
  });

  it("count=3 → 1.5 (true confluence)", () => {
    expect(resolveConfluenceMultiplier(3)).toBe(1.5);
  });

  it("count=4 → 2.0 (extreme A+ setup)", () => {
    expect(resolveConfluenceMultiplier(4)).toBe(2.0);
  });

  it("count=5 clamps to 2.0 (ceiling at 4)", () => {
    expect(resolveConfluenceMultiplier(5)).toBe(2.0);
  });

  it("count=10 clamps to 2.0 (ceiling at 4)", () => {
    expect(resolveConfluenceMultiplier(10)).toBe(2.0);
  });

  it("count=0 clamps to 1.0 (floor at 1)", () => {
    expect(resolveConfluenceMultiplier(0)).toBe(1.0);
  });

  it("count=-5 clamps to 1.0 (floor at 1)", () => {
    expect(resolveConfluenceMultiplier(-5)).toBe(1.0);
  });

  it("operator override map: count=3 → 1.25 (custom map)", () => {
    const customMap = { 1: 1.0, 2: 1.0, 3: 1.25, 4: 1.75 };
    expect(resolveConfluenceMultiplier(3, customMap)).toBe(1.25);
  });
});

describe("W23H.4: DEFAULT_CONFLUENCE_MULTIPLIER canonical shape", () => {
  it("has exactly 4 keys: 1, 2, 3, 4", () => {
    expect(Object.keys(DEFAULT_CONFLUENCE_MULTIPLIER).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it("1→1.0, 2→1.0, 3→1.5, 4→2.0", () => {
    expect(DEFAULT_CONFLUENCE_MULTIPLIER[1]).toBe(1.0);
    expect(DEFAULT_CONFLUENCE_MULTIPLIER[2]).toBe(1.0);
    expect(DEFAULT_CONFLUENCE_MULTIPLIER[3]).toBe(1.5);
    expect(DEFAULT_CONFLUENCE_MULTIPLIER[4]).toBe(2.0);
  });
});

describe("W23H.4: computeRiskDerivedContracts — confluence multiplier integration", () => {

  describe("Backward compat: callers without confluence_count get 1.0× (no behavior change)", () => {
    it("Topstep healthy $50K, no confluence_count → pyramid floor applies, finalContracts=6", () => {
      const r = computeRiskDerivedContracts(TOPSTEP_50K_HEALTHY as RiskSizingInputs);
      expect(r.finalContracts).toBe(6);
      expect(r.pyramidFloorApplied).toBe(true);
    });

    it("MFFU $50K, no confluence_count → pyramidTier=6, finalContracts=6", () => {
      const r = computeRiskDerivedContracts(MFFU_50K_HEALTHY as RiskSizingInputs);
      expect(r.finalContracts).toBe(6);
    });
  });

  describe("1 factor (primary only) → 1.0× → base 6 MES unchanged", () => {
    it("Topstep healthy, confluence_count=1 → finalContracts=6 (pyramid floor, no upsize)", () => {
      const r = computeRiskDerivedContracts({
        ...(TOPSTEP_50K_HEALTHY as RiskSizingInputs),
        confluence_count: 1,
      });
      expect(r.finalContracts).toBe(6);
      expect(r.confluenceAudit.multiplier).toBe(1.0);
      expect(r.confluenceAudit.confluence_count).toBe(1);
    });

    it("MFFU $50K, confluence_count=1 → finalContracts=6 (pyramidTier=6, no upsize)", () => {
      const r = computeRiskDerivedContracts({
        ...(MFFU_50K_HEALTHY as RiskSizingInputs),
        confluence_count: 1,
      });
      expect(r.finalContracts).toBe(6);
      expect(r.confluenceAudit.multiplier).toBe(1.0);
    });
  });

  describe("2 factors → 1.0× → no upsize", () => {
    it("MFFU large account, confluence_count=2 → pyramidTier=66, multiplied=66, final=66", () => {
      const r = computeRiskDerivedContracts({
        ...(MFFU_LARGE_ACCOUNT as RiskSizingInputs),
        confluence_count: 2,
      });
      // pyramidTier = 66, riskDerivedCap = 333, liquidityCap = 100
      // multiplied: 66×1.0=66, 333×1.0=333, min(66,333,100)=66
      expect(r.finalContracts).toBe(66);
      expect(r.confluenceAudit.multiplier).toBe(1.0);
    });
  });

  describe("3 factors (true confluence) → 1.5× upsize 50%", () => {
    it("MFFU $50K, confluence_count=3 → pyramidTier=6 × 1.5 = 9", () => {
      const r = computeRiskDerivedContracts({
        ...(MFFU_50K_HEALTHY as RiskSizingInputs),
        confluence_count: 3,
      });
      // pyramidTierMultiplied = floor(6*1.5)=9, riskDerivedCapMultiplied = floor(33*1.5)=49
      // min(9, 49, 100) = 9
      expect(r.finalContracts).toBe(9);
      expect(r.confluenceAudit.multiplier).toBe(1.5);
      expect(r.confluenceAudit.confluence_count).toBe(3);
      expect(r.confluenceAudit.contracts_before).toBe(6); // unmultiplied pyramidTier
      expect(r.confluenceAudit.contracts_after).toBe(9);
      expect(r.confluenceAudit.binding_constraint).toBe("pyramidTier");
    });

    it("MFFU large account, confluence_count=3 → pyramidTier=66 × 1.5 = 99, capped by liquidityCap=100", () => {
      const r = computeRiskDerivedContracts({
        ...(MFFU_LARGE_ACCOUNT as RiskSizingInputs),
        confluence_count: 3,
      });
      // pyramidTierMultiplied = floor(66*1.5)=99, riskDerivedCapMultiplied = floor(333*1.5)=499
      // min(99, 499, 100) = 99 (pyramidTier is binding vs liquidity cap)
      expect(r.finalContracts).toBe(99);
      expect(r.confluenceAudit.multiplier).toBe(1.5);
    });
  });

  describe("4 factors (extreme A+ setup) → 2.0× upsize 100%", () => {
    it("MFFU $50K, confluence_count=4 → pyramidTier=6 × 2.0 = 12", () => {
      const r = computeRiskDerivedContracts({
        ...(MFFU_50K_HEALTHY as RiskSizingInputs),
        confluence_count: 4,
      });
      // pyramidTierMultiplied = 12, riskDerivedCapMultiplied = 66, min(12,66,100)=12
      expect(r.finalContracts).toBe(12);
      expect(r.confluenceAudit.multiplier).toBe(2.0);
      expect(r.confluenceAudit.contracts_before).toBe(6);
      expect(r.confluenceAudit.contracts_after).toBe(12);
    });

    it("MFFU large account, confluence_count=4 → pyramidTier=66 × 2.0 = 132 → liquidity cap 100 binds", () => {
      const r = computeRiskDerivedContracts({
        ...(MFFU_LARGE_ACCOUNT as RiskSizingInputs),
        confluence_count: 4,
      });
      // pyramidTierMultiplied = 132, riskDerivedCapMultiplied = 666, liquidityCap = 100
      // min(132, 666, 100) = 100 (liquidity cap binds)
      expect(r.finalContracts).toBe(100);
      expect(r.confluenceAudit.multiplier).toBe(2.0);
      expect(r.confluenceAudit.contracts_after).toBe(100);
      expect(r.confluenceAudit.binding_constraint).toBe("liquidityCap");
    });
  });

  describe("5+ factors → clamps to 2.0× (same as 4 factors)", () => {
    it("confluence_count=5 → same result as count=4", () => {
      const r4 = computeRiskDerivedContracts({
        ...(MFFU_50K_HEALTHY as RiskSizingInputs),
        confluence_count: 4,
      });
      const r5 = computeRiskDerivedContracts({
        ...(MFFU_50K_HEALTHY as RiskSizingInputs),
        confluence_count: 5,
      });
      expect(r5.finalContracts).toBe(r4.finalContracts);
      expect(r5.confluenceAudit.multiplier).toBe(2.0);
    });

    it("confluence_count=10 → same result as count=4", () => {
      const r10 = computeRiskDerivedContracts({
        ...(MFFU_50K_HEALTHY as RiskSizingInputs),
        confluence_count: 10,
      });
      expect(r10.confluenceAudit.multiplier).toBe(2.0);
    });
  });

  describe("0 or negative factors → clamps to 1.0× (same as 1 factor)", () => {
    it("confluence_count=0 → multiplier 1.0, same as omitting confluence_count", () => {
      const r0 = computeRiskDerivedContracts({
        ...(MFFU_50K_HEALTHY as RiskSizingInputs),
        confluence_count: 0,
      });
      const rNone = computeRiskDerivedContracts(MFFU_50K_HEALTHY as RiskSizingInputs);
      expect(r0.finalContracts).toBe(rNone.finalContracts);
      expect(r0.confluenceAudit.multiplier).toBe(1.0);
    });

    it("confluence_count=-3 → multiplier 1.0", () => {
      const r = computeRiskDerivedContracts({
        ...(MFFU_50K_HEALTHY as RiskSizingInputs),
        confluence_count: -3,
      });
      expect(r.confluenceAudit.multiplier).toBe(1.0);
    });
  });

  describe("Liquidity cap binds on huge account with 4-factor multiplier", () => {
    it("$2M MFFU, pyramid=156, riskCap=1333, 4-factor → 312 and 2666 both exceed liquidityCap=100 → final=100", () => {
      const r = computeRiskDerivedContracts({
        ...(MFFU_HUGE_ACCOUNT_LIQUIDITY_TEST as RiskSizingInputs),
        confluence_count: 4,
      });
      expect(r.finalContracts).toBe(100);
      expect(r.confluenceAudit.binding_constraint).toBe("liquidityCap");
      expect(r.confluenceAudit.multiplier).toBe(2.0);
      expect(r.confluenceAudit.contracts_after).toBe(100);
    });

    it("Liquidity cap binds even at 1-factor on huge account", () => {
      const r = computeRiskDerivedContracts({
        ...(MFFU_HUGE_ACCOUNT_LIQUIDITY_TEST as RiskSizingInputs),
        confluence_count: 1,
      });
      // pyramidTier = 156 (without multiplier), capped by liquidityCap=100
      expect(r.finalContracts).toBe(100);
      expect(r.confluenceAudit.binding_constraint).toBe("liquidityCap");
    });
  });

  describe("Wave 23 pyramid floor preserved on healthy account", () => {
    it("Topstep $50K (healthy), 1 confluence factor → floor applies → finalContracts=6, not 0", () => {
      // Fresh $50K Topstep combine: riskDerivedCap = 1, but accountIsHealthy → floor = 6
      const r = computeRiskDerivedContracts({
        ...(TOPSTEP_50K_HEALTHY as RiskSizingInputs),
        confluence_count: 1,
      });
      expect(r.finalContracts).toBe(6);
      expect(r.pyramidFloorApplied).toBe(true);
      expect(r.confluenceAudit.binding_constraint).toBe("pyramid_floor_override");
    });

    it("Topstep $50K (healthy), 3 confluence factors → pyramid floor override path → still uses base_contracts (not multiplied base)", () => {
      // riskDerivedCap is very low on fresh Topstep → pyramid floor override fires.
      // Floor uses base_contracts (6), not multiplied base — floor is safety minimum.
      const r = computeRiskDerivedContracts({
        ...(TOPSTEP_50K_HEALTHY as RiskSizingInputs),
        confluence_count: 3,
      });
      // pyramidTierMultiplied = floor(6*1.5)=9, riskDerivedCapMultiplied = floor(1*1.5)=1
      // min(9, 1, 100) = 1, then pyramidFloor: 1 < 6 → floor → 6
      expect(r.finalContracts).toBe(6);
      expect(r.pyramidFloorApplied).toBe(true);
    });
  });

  describe("firmCap binds when multiplied size exceeds it", () => {
    it("MFFU $50K, 4-factor, firmCap=8 → final=8, binding=firmCap", () => {
      const r = computeRiskDerivedContracts({
        ...(MFFU_50K_HEALTHY as RiskSizingInputs),
        confluence_count: 4,
        firmContractCap: 8,
      });
      // pyramidTierMultiplied = 12, riskDerivedCapMultiplied = 66, firmCap = 8, liquidityCap = 100
      // min(12, 66, 100) = 12, then min(12, 8) = 8
      expect(r.finalContracts).toBe(8);
      expect(r.firmCapApplied).toBe(true);
      expect(r.confluenceAudit.binding_constraint).toBe("firmCap");
      expect(r.confluenceAudit.contracts_after).toBe(8);
    });
  });

  describe("Audit shape: confluenceAudit has all required fields", () => {
    it("successful sizing: all 5 audit fields present with correct types", () => {
      const r = computeRiskDerivedContracts({
        ...(MFFU_50K_HEALTHY as RiskSizingInputs),
        confluence_count: 3,
      });
      expect(typeof r.confluenceAudit.confluence_count).toBe("number");
      expect(typeof r.confluenceAudit.multiplier).toBe("number");
      expect(typeof r.confluenceAudit.contracts_before).toBe("number");
      expect(typeof r.confluenceAudit.contracts_after).toBe("number");
      expect(typeof r.confluenceAudit.binding_constraint).toBe("string");
    });

    it("rejection path (zero_balance): confluenceAudit present with rejection constraint", () => {
      const r = computeRiskDerivedContracts({
        ...(MFFU_50K_HEALTHY as RiskSizingInputs),
        accountBalance: 0,
        confluence_count: 3,
      });
      expect(r.rejectionReason).toBe("zero_balance");
      expect(r.confluenceAudit.binding_constraint).toBe("rejection");
      expect(r.confluenceAudit.contracts_before).toBe(0);
      expect(r.confluenceAudit.contracts_after).toBe(0);
    });

    it("rejection path (zero_atr): confluenceAudit present with rejection constraint", () => {
      const r = computeRiskDerivedContracts({
        ...(MFFU_50K_HEALTHY as RiskSizingInputs),
        atrPoints: 0,
        confluence_count: 4,
      });
      expect(r.rejectionReason).toBe("zero_atr");
      expect(r.confluenceAudit.binding_constraint).toBe("rejection");
    });

    it("contracts_before is the unmultiplied pyramidTier, not base_contracts", () => {
      // pyramidTier with +$9K profit = 6 + 3*3 = 15
      const r = computeRiskDerivedContracts({
        ...(MFFU_50K_HEALTHY as RiskSizingInputs),
        cumulativeProfit: 9000,
        confluence_count: 3,
      });
      expect(r.pyramidTier).toBe(15);
      expect(r.confluenceAudit.contracts_before).toBe(15);
      // pyramidTierMultiplied = floor(15*1.5)=22, riskDerivedCapMultiplied = floor(33*1.5)=49
      // min(22, 49, 100) = 22
      expect(r.confluenceAudit.contracts_after).toBe(22);
    });
  });

  describe("Operator per-strategy map override", () => {
    it("custom map 3→1.25 used instead of canonical 1.5 when provided", () => {
      const customMap = { 1: 1.0, 2: 1.0, 3: 1.25, 4: 1.75 };
      const r = computeRiskDerivedContracts({
        ...(MFFU_50K_HEALTHY as RiskSizingInputs),
        confluence_count: 3,
        confluence_size_multiplier_map: customMap,
      });
      // pyramidTierMultiplied = floor(6*1.25) = 7
      expect(r.confluenceAudit.multiplier).toBe(1.25);
      expect(r.finalContracts).toBe(7);
    });

    it("canonical map used when override not provided", () => {
      const r = computeRiskDerivedContracts({
        ...(MFFU_50K_HEALTHY as RiskSizingInputs),
        confluence_count: 3,
      });
      expect(r.confluenceAudit.multiplier).toBe(1.5);
    });
  });

  describe("MFFU firm path: multiplier applies correctly", () => {
    it("MFFU $50K, 4-factor, riskDerivedCap path (not pyramid floor) binds correctly", () => {
      // High ATR makes riskDerivedCap very low
      // stopDollars = 1.5 × 50pt × $5 = $375/contract
      // riskDollars = $50K × 0.02 = $1,000
      // riskDerivedCap = floor(1000/375) = 2
      // pyramidTier = 6, 4-factor multiplied: pyramid=12, risk=4
      // accountIsHealthy: 50K/50K=1.0 >= 0.85 → pyramidFloor with 4 < 6 → floor = 6
      const r = computeRiskDerivedContracts({
        ...(MFFU_50K_HEALTHY as RiskSizingInputs),
        atrPoints: 50,
        confluence_count: 4,
      });
      // With 4-factor: pyramidTierMultiplied=12, riskDerivedCapMultiplied=4, min(12,4,100)=4
      // accountIsHealthy: 4 < 6 → floor → 6
      expect(r.finalContracts).toBe(6);
      expect(r.pyramidFloorApplied).toBe(true);
    });
  });

  describe("Existing risk-sizing behavior unchanged when confluence omitted", () => {
    it("Topstep healthy $50K: same result with and without explicit confluence_count=1", () => {
      const rBase = computeRiskDerivedContracts(TOPSTEP_50K_HEALTHY as RiskSizingInputs);
      const rExplicit = computeRiskDerivedContracts({
        ...(TOPSTEP_50K_HEALTHY as RiskSizingInputs),
        confluence_count: 1,
      });
      expect(rBase.finalContracts).toBe(rExplicit.finalContracts);
      expect(rBase.pyramidFloorApplied).toBe(rExplicit.pyramidFloorApplied);
    });
  });
});
