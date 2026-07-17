/**
 * Wave 10 Task 3A — computeRiskDerivedContracts() pure unit tests
 *
 * No DB, no mocks, no imports from production services.
 * Tests the math in src/server/lib/risk-sizing.ts directly.
 */

import { describe, it, expect } from "vitest";
import { computeRiskDerivedContracts, type RiskSizingInputs } from "../lib/risk-sizing.js";

// Shared base config that mirrors the framework defaults
const BASE_CONFIG: RiskSizingInputs["positionSizeConfig"] = {
  type: "risk_derived_pyramid",
  base_contracts: 4,
  tier_increment: 2,
  tier_threshold_dollars: 3000,
  personal_dll_pct: 0.67,
  max_risk_pct_per_trade: 0.02,
  liquidity_comfort_cap: 100,
  topstep_account_cap_override: null,
  computed_at_signal_time: true,
};

function makeInput(overrides: Partial<RiskSizingInputs> = {}): RiskSizingInputs {
  return {
    positionSizeConfig: BASE_CONFIG,
    accountBalance: 50_000,
    cumulativeProfit: 0,
    atrPoints: 4,
    stopMultiplier: 1.5,
    pointDollarValue: 5, // MES
    firmContractCap: null,
    // Wave 22: explicit MFFU for Wave 10 known-answer tests (balance-pct math).
    // Default changed to "topstep" per operator directive 2026-05-18.
    // New Topstep tests live in risk-sizing.test.ts.
    firm: "mffu",
    ...overrides,
  };
}

describe("Wave 10 Task 3A: computeRiskDerivedContracts", () => {

  describe("Risk-derived cap math", () => {
    // stop_dollars = 1.5 × 4 × $5 = $30/contract
    // risk_dollars  = $50K × 0.02 = $1,000
    // cap = floor($1,000 / $30) = 33
    it("$50K balance, ATR=4, 1.5× stop, MES → riskDerivedCap ≈ 33", () => {
      const result = computeRiskDerivedContracts(makeInput({ accountBalance: 50_000 }));
      expect(result.riskDerivedCap).toBe(33);
    });

    // $100K × 0.02 = $2,000 / $30 = 66
    it("$100K balance → riskDerivedCap ≈ 66", () => {
      const result = computeRiskDerivedContracts(makeInput({ accountBalance: 100_000 }));
      expect(result.riskDerivedCap).toBe(66);
    });

    // $150K × 0.02 = $3,000 / $30 = 100
    it("$150K balance → riskDerivedCap = 100", () => {
      const result = computeRiskDerivedContracts(makeInput({ accountBalance: 150_000 }));
      expect(result.riskDerivedCap).toBe(100);
    });

    // $200K × 0.02 = $4,000 / $30 = 133
    it("$200K balance → riskDerivedCap = 133", () => {
      const result = computeRiskDerivedContracts(makeInput({ accountBalance: 200_000 }));
      expect(result.riskDerivedCap).toBe(133);
    });
  });

  describe("Pyramid tier progression", () => {
    it("cumulativeProfit=0 → tier 0 → pyramidTier = base = 4", () => {
      const r = computeRiskDerivedContracts(makeInput({ cumulativeProfit: 0 }));
      expect(r.pyramidTier).toBe(4);
    });

    it("+$3K profit → 1 tier → pyramidTier = 4 + 2 = 6", () => {
      const r = computeRiskDerivedContracts(makeInput({ cumulativeProfit: 3000 }));
      expect(r.pyramidTier).toBe(6);
    });

    it("+$6K profit → 2 tiers → pyramidTier = 4 + 4 = 8", () => {
      const r = computeRiskDerivedContracts(makeInput({ cumulativeProfit: 6000 }));
      expect(r.pyramidTier).toBe(8);
    });

    it("+$9K profit → 3 tiers → pyramidTier = 4 + 6 = 10", () => {
      const r = computeRiskDerivedContracts(makeInput({ cumulativeProfit: 9000 }));
      expect(r.pyramidTier).toBe(10);
    });

    it("negative cumulativeProfit is treated as 0 (no negative tiers)", () => {
      const r = computeRiskDerivedContracts(makeInput({ cumulativeProfit: -5000 }));
      expect(r.pyramidTier).toBe(4);
    });
  });

  describe("Final = min(pyramid, risk, firm, liquidity)", () => {
    it("pyramid is binding when it is the smallest", () => {
      // Small balance → high risk cap; firm cap = null; liquidity = 100
      // pyramidTier = 4; risk cap = 33 → final = 4
      const r = computeRiskDerivedContracts(makeInput({
        accountBalance: 50_000,
        cumulativeProfit: 0,  // base = 4
      }));
      expect(r.finalContracts).toBe(4); // pyramid (4) < risk (33)
      expect(r.evidence.bindingCap).toBe("pyramid");
    });

    it("risk_derived_cap is binding when balance is tiny", () => {
      // $5K × 0.02 = $100 / $30 = 3 → risk cap = 3 < pyramid = 4
      const r = computeRiskDerivedContracts(makeInput({
        accountBalance: 5_000,
        cumulativeProfit: 3000, // pyramid = 6
      }));
      expect(r.riskDerivedCap).toBe(3);
      expect(r.finalContracts).toBe(3); // risk (3) < pyramid (6)
      expect(r.evidence.bindingCap).toBe("risk_derived");
    });

    it("firm cap is binding when set lower than risk and pyramid", () => {
      // pyramid = 6 (after $3K profit); risk cap = 33; firm cap = 5
      const r = computeRiskDerivedContracts(makeInput({
        accountBalance: 50_000,
        cumulativeProfit: 3000,
        firmContractCap: 5,
      }));
      expect(r.finalContracts).toBe(5);
      expect(r.evidence.bindingCap).toBe("firm_cap");
    });

    it("liquidity cap is binding when set lower than all others", () => {
      // Artificially low liquidity cap
      const r = computeRiskDerivedContracts(makeInput({
        accountBalance: 200_000,
        cumulativeProfit: 100_000,  // very high pyramid
        positionSizeConfig: { ...BASE_CONFIG, liquidity_comfort_cap: 10 },
      }));
      expect(r.finalContracts).toBe(10);
      expect(r.evidence.bindingCap).toBe("liquidity_cap");
    });
  });

  describe("Edge cases", () => {
    it("ATR=0 → finalContracts=0, rejectionReason='zero_atr'", () => {
      const r = computeRiskDerivedContracts(makeInput({ atrPoints: 0 }));
      expect(r.finalContracts).toBe(0);
      expect(r.rejectionReason).toBe("zero_atr");
    });

    it("ATR negative → finalContracts=0, rejectionReason='zero_atr'", () => {
      const r = computeRiskDerivedContracts(makeInput({ atrPoints: -1 }));
      expect(r.finalContracts).toBe(0);
      expect(r.rejectionReason).toBe("zero_atr");
    });

    it("balance=0 → finalContracts=0, rejectionReason='zero_balance'", () => {
      const r = computeRiskDerivedContracts(makeInput({ accountBalance: 0 }));
      expect(r.finalContracts).toBe(0);
      expect(r.rejectionReason).toBe("zero_balance");
    });

    it("negative balance → finalContracts=0, rejectionReason='zero_balance'", () => {
      const r = computeRiskDerivedContracts(makeInput({ accountBalance: -1000 }));
      expect(r.finalContracts).toBe(0);
      expect(r.rejectionReason).toBe("zero_balance");
    });

    it("extreme ATR (100 pts) — Wave 23: pyramid floor overrides riskCap on healthy account", () => {
      // stop = 1.5 × 100 × $5 = $750; MFFU riskDollars = 50K*0.02 = $1K → riskCap=1
      // C-05/D9 (2026-07-16): floor override REMOVED → risk cap (1) binds (lowest wins),
      // regardless of account health. Not base 4.
      const r = computeRiskDerivedContracts(makeInput({ atrPoints: 100, accountBalance: 50_000 }));
      expect(r.finalContracts).toBe(1);   // risk cap binds — no floor override
      expect(r.pyramidFloorApplied).toBe(false);
      expect(r.riskDerivedCap).toBe(1);
      expect(r.rejectionReason).toBeNull();
    });

    it("extreme ATR (100 pts) on drawdown account → risk-cap binds (floor does not apply)", () => {
      // At 80% health (drawdown), pyramid floor is sacrificed to protect the account.
      // Wave 23 rule: floor only applies when accountHealthRatio >= 0.85.
      // stop = 1.5 × 100 × $5 = $750; riskDollars = 40K*0.02 = $800 → riskCap=1
      const r = computeRiskDerivedContracts(makeInput({
        atrPoints: 100,
        accountBalance: 40_000,     // 80% of $50K → below 85% threshold
        accountStartingFloor: 50_000,
      }));
      expect(r.accountHealthRatio).toBeCloseTo(0.80, 2);
      expect(r.pyramidFloorApplied).toBe(false);   // risk-cap binds (account in trouble)
      expect(r.riskDerivedCap).toBe(1);
      expect(r.finalContracts).toBe(1);             // only 1 contract (risk-cap controls)
      expect(r.rejectionReason).toBeNull();
    });
  });

  describe("topstep_account_cap_override", () => {
    it("override=5 → final=5 regardless of pyramid and risk math", () => {
      // pyramid would be 10 (after $9K profit); risk cap = 33; override clamps to 5
      const r = computeRiskDerivedContracts(makeInput({
        accountBalance: 50_000,
        cumulativeProfit: 9000,
        positionSizeConfig: { ...BASE_CONFIG, topstep_account_cap_override: 5 },
      }));
      expect(r.finalContracts).toBe(5);
      expect(r.firmCap).toBe(5);
    });

    it("override=null + firmContractCap=15 → firmCap=15", () => {
      const r = computeRiskDerivedContracts(makeInput({
        accountBalance: 200_000,
        cumulativeProfit: 100_000,
        firmContractCap: 15,
      }));
      // pyramid might be huge, risk cap might be 133, but firm cap = 15
      expect(r.firmCap).toBe(15);
      expect(r.finalContracts).toBeLessThanOrEqual(15);
    });

    it("override=null + firmContractCap=null → no firm cap clamp", () => {
      const r = computeRiskDerivedContracts(makeInput({
        accountBalance: 50_000,
        cumulativeProfit: 0,
        firmContractCap: null,
      }));
      expect(r.firmCap).toBeNull();
      // final = min(pyramid=4, risk=33, liquidity=100) = 4
      expect(r.finalContracts).toBe(4);
    });
  });

  describe("liquidity_comfort_cap=100 ceiling", () => {
    it("caps at 100 when risk math would otherwise exceed", () => {
      // $5M account: risk_cap = 5M*0.02/$30 = 3333; liquidity cap = 100 wins
      const r = computeRiskDerivedContracts(makeInput({
        accountBalance: 5_000_000,
        cumulativeProfit: 1_000_000, // pyramid tier is huge
      }));
      expect(r.finalContracts).toBe(100);
      expect(r.liquidityCap).toBe(100);
    });
  });

  describe("Evidence packet", () => {
    it("evidence contains all required fields", () => {
      const r = computeRiskDerivedContracts(makeInput());
      expect(r.evidence.accountBalance).toBeDefined();
      expect(r.evidence.atrPoints).toBeDefined();
      expect(r.evidence.pyramidTier).toBeDefined();
      expect(r.evidence.riskDerivedCap).toBeDefined();
      expect(r.evidence.finalContracts).toBeDefined();
      expect(r.evidence.bindingCap).toBeDefined();
      expect(r.evidence.stopDollarsPerContract).toBeDefined();
    });
  });
});

// deep-scan 2026-07-11 HIGH regression: the PM-session / news-caution size taper (pmSizeFactor < 1)
// must NOT be silently re-inflated back to full base_contracts by either pyramid-floor site on a
// healthy account. Pre-fix both floors reset a tapered size to base_contracts; the fix tapers the
// floor base by pmFactor. base_contracts=4, healthy MFFU ($50K == starting floor).
describe("PM/news taper is respected by both pyramid floors", () => {
  it("pmSizeFactor=1 (no taper) → floor stays at full base_contracts (original behavior)", () => {
    const r = computeRiskDerivedContracts(makeInput({ pmSizeFactor: 1, accountStartingFloor: 50_000 }));
    expect(r.finalContracts).toBe(4);
  });

  it("healthy-account floor: pmSizeFactor=0.5 → floor(4*0.5)=2, NOT re-inflated to base 4", () => {
    // pyramidTier tapers to floor(4*0.5)=2 < base(4) → healthy floor fires; must yield 2, not 4.
    const r = computeRiskDerivedContracts(makeInput({ pmSizeFactor: 0.5, accountStartingFloor: 50_000 }));
    expect(r.pyramidTier).toBe(2);
    expect(r.finalContracts).toBe(2);
  });

  it("early-return floor (riskCap≤0): pmSizeFactor=0.5 → floor(4*0.5)=2, NOT re-inflated to base 4", () => {
    // atrPoints=200 → stop_dollars=1.5*200*5=1500 > risk_dollars($1000) → riskDerivedCap=0.
    // C-05/D9 (2026-07-16): floor override REMOVED → riskCap<=0 ALWAYS rejects (negative_cap), honest
    // skip. There is no early-return floor left to taper — the honest result is 0, not 2.
    const r = computeRiskDerivedContracts(makeInput({
      pmSizeFactor: 0.5,
      accountStartingFloor: 50_000,
      atrPoints: 200,
    }));
    expect(r.riskDerivedCap).toBe(0);
    expect(r.finalContracts).toBe(0);
    expect(r.rejectionReason).toBe("negative_cap");
  });
});
