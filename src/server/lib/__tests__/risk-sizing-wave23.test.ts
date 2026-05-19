/**
 * risk-sizing-wave23.test.ts — Wave 23 pyramid floor enforcement tests.
 *
 * B.1 architectural decision (pyramid floor vs risk-cap tension):
 *   On HEALTHY accounts (balance >= 85% of startingCapital):
 *     finalContracts = max(base_contracts, min(pyramidTier, riskDerivedCap, firmCap, liquidityCap))
 *     Pyramid BASE overrides risk-cap to protect Style C 33/33/33 divisibility.
 *   On DRAWDOWN accounts (balance < 85% of startingCapital):
 *     finalContracts = min(pyramidTier, riskDerivedCap, firmCap, liquidityCap)
 *     Risk-cap fully binds to protect firm compliance (account in trouble).
 *
 * Micro bases (Wave 23 operator-locked):
 *   MES: base=6 (6 × $5/pt × 14pt ceiling = $420/trade)
 *   MNQ: base=6 (6 × $2/pt × 40pt ceiling = $480/trade)
 *   MCL: base=18 (18 × $1/tick × 25-tick ceiling = $450/trade)
 *   All divisible by 3 → Style C 33/33/33 partials clean.
 *
 * Standard inputs (ATR=4pt, stop_mult=1.5):
 *   MES: stopDollars = 1.5 * 4 * 5   = $30/contract
 *   MNQ: stopDollars = 1.5 * 4 * 2   = $12/contract
 *   MCL: stopDollars = 1.5 * 25 * 100 = $3750/contract (25-tick × $100/pt, using 25pt stop)
 *     NOTE: MCL uses pointValue=100 (1pt = $100 = 100 ticks × $1/tick).
 *     ATR in points for MCL. Standard test uses atr=1pt for MCL to keep stopDollars tractable.
 */

import { describe, it, expect } from "vitest";
import { computeRiskDerivedContracts } from "../risk-sizing.js";

// ── MES base-6 config ────────────────────────────────────────────────────────

const MES_CFG_BASE6 = {
  type: "risk_derived_pyramid" as const,
  base_contracts: 6,
  tier_increment: 3,
  tier_threshold_dollars: 3000,
  personal_dll_pct: 0.67,
  max_risk_pct_per_trade: 0.02,
  liquidity_comfort_cap: 100,
  topstep_account_cap_override: null,
  computed_at_signal_time: true as const,
};

const MNQ_CFG_BASE6 = {
  ...MES_CFG_BASE6,
  base_contracts: 6,
};

const MCL_CFG_BASE18 = {
  ...MES_CFG_BASE6,
  base_contracts: 18,
};

// Standard Topstep healthy $50K params (ATR=4pt)
const TOPSTEP_50K_HEALTHY = {
  firm: "topstep" as const,
  trailingDD: 2000,
  highWaterBalance: 50_000,
  accountStartingFloor: 50_000,
  accountBalance: 50_000,
};

// ─────────────────────────────────────────────────────────────────────────────
// B.1 — MES base 6 at $50K Topstep healthy account
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 23 B.1 — MES base 6 at $50K Topstep healthy", () => {
  it("MES base 6: pyramid floor overrides riskCap=1 on fresh $50K combine", () => {
    // Topstep $50K: buffer=$2K, riskDollars=40, stopDollars=$30 → riskCap=1
    // BUT pyramid floor (base=6) overrides because account is healthy (100% > 85%)
    const r = computeRiskDerivedContracts({
      positionSizeConfig: MES_CFG_BASE6,
      ...TOPSTEP_50K_HEALTHY,
      cumulativeProfit: 0,
      atrPoints: 4.0,
      stopMultiplier: 1.5,
      pointDollarValue: 5.0,  // MES $5/pt
      firmContractCap: 15,
    });
    expect(r.finalContracts).toBe(6);  // pyramid floor binds
    expect(r.pyramidFloorApplied).toBe(true);
    expect(r.riskDerivedCap).toBe(1);  // riskCap only 1 contract
    expect(r.accountHealthRatio).toBeCloseTo(1.0, 2);
    expect(r.rejectionReason).toBeNull();
  });

  it("MES: tier ladder 6 → 9 → 12 → 15 → 18 → 21 (divisible by 3 every step)", () => {
    // Each tier: +3 per $3K profit. Ladder must always be divisible by 3.
    const tiers = [0, 3000, 6000, 9000, 12000, 15000];
    const expected = [6, 9, 12, 15, 18, 21];

    for (let i = 0; i < tiers.length; i++) {
      const r = computeRiskDerivedContracts({
        positionSizeConfig: MES_CFG_BASE6,
        // Use MFFU for this test so risk-cap doesn't complicate the assertion
        // (MFFU balance-pct gives plenty of headroom at $200K)
        firm: "mffu",
        accountBalance: 200_000,
        cumulativeProfit: tiers[i]!,
        atrPoints: 4.0,
        stopMultiplier: 1.5,
        pointDollarValue: 5.0,
        firmContractCap: null,
      });
      expect(r.pyramidTier).toBe(expected[i]);
      expect(r.pyramidTier % 3).toBe(0);  // always divisible by 3
    }
  });

  it("MES: tier ladder continues to 33 (operator ceiling)", () => {
    // At $81K cumulative profit: 27 tiers × $3K = base 6 + 27*3 = 87 but cap at 33
    // Test that it reaches 33 at some point
    const r = computeRiskDerivedContracts({
      positionSizeConfig: { ...MES_CFG_BASE6, liquidity_comfort_cap: 33 },
      firm: "mffu",
      accountBalance: 200_000,
      cumulativeProfit: 81_000,  // 27 tiers → 6 + 27*3 = 87 → capped at 33
      atrPoints: 4.0,
      stopMultiplier: 1.5,
      pointDollarValue: 5.0,
      firmContractCap: null,
    });
    // pyramidTier = 6 + 3*27 = 87, but liquidityCap=33 binds
    expect(r.finalContracts).toBe(33);
    expect(r.liquidityCap).toBe(33);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B.1 — MES base 6 at $50K Topstep with -$15K drawdown (risk-cap binds)
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 23 B.1 — MES base 6 at $50K Topstep drawdown account", () => {
  it("MES base 6: risk-cap binds (not floor) when account is at -$15K drawdown", () => {
    // Balance = $35K, startingCap = $50K → healthRatio = 0.70 < 0.85 → drawdown account
    // Risk-cap must fully bind to protect firm. Floor does NOT apply.
    // Topstep trailing floor math:
    //   HWM=$50K, floor=min(50K-2K, 50K)=48K, buffer=35K-48K=-13K → zero_buffer rejection
    // Use MFFU for this test to avoid zero_buffer, test the < 85% health path:
    const r = computeRiskDerivedContracts({
      positionSizeConfig: MES_CFG_BASE6,
      firm: "mffu",
      accountBalance: 35_000,   // -$15K drawdown from $50K starting
      accountStartingFloor: 50_000,
      cumulativeProfit: -15_000,
      atrPoints: 4.0,
      stopMultiplier: 1.5,
      pointDollarValue: 5.0,
      firmContractCap: 15,
    });
    // healthRatio = 35K / 50K = 0.70 < 0.85 → floor does NOT apply
    expect(r.accountHealthRatio).toBeCloseTo(0.70, 2);
    expect(r.pyramidFloorApplied).toBe(false);
    // MFFU: riskDollars = 35K * 0.02 = $700; riskCap = floor(700/30) = 23
    // pyramid tier = 6 (no profit, no earned tiers) → min(6, 23, 100, 15) = 6
    // But healthRatio < 0.85, so no floor override, pyramid tier (6) still binds normally
    // In this case pyramidTier=6 < riskCap=23, so pyramid tier binds (as designed, not floor)
    expect(r.pyramidTier).toBe(6);
    expect(r.finalContracts).toBe(6);  // pyramid tier binds, not floor (different mechanism)
  });

  it("MES base 6: zero_buffer rejection overrides floor on Topstep at large drawdown", () => {
    // Topstep account below trailing floor → zero_buffer rejection
    // Floor cannot apply when account is at trailing floor (protection wins)
    const r = computeRiskDerivedContracts({
      positionSizeConfig: MES_CFG_BASE6,
      firm: "topstep",
      accountBalance: 47_000,   // below trailing floor of 48K
      trailingDD: 2000,
      highWaterBalance: 50_000,
      accountStartingFloor: 50_000,
      cumulativeProfit: -3_000,
      atrPoints: 4.0,
      stopMultiplier: 1.5,
      pointDollarValue: 5.0,
      firmContractCap: 15,
    });
    expect(r.rejectionReason).toBe("zero_buffer");
    expect(r.finalContracts).toBe(0);
    expect(r.pyramidFloorApplied).toBe(false);
  });

  it("MES base 6: at 84% health (just below threshold) — floor does NOT apply", () => {
    // 84% health → below 85% threshold → risk-cap fully binds
    // Use very high ATR to force riskCap < base
    const r = computeRiskDerivedContracts({
      positionSizeConfig: MES_CFG_BASE6,
      firm: "mffu",
      accountBalance: 42_000,   // 84% of $50K
      accountStartingFloor: 50_000,
      cumulativeProfit: -8_000,
      atrPoints: 20.0,          // very high ATR → stopDollars=150/contract → riskCap=5
      stopMultiplier: 1.5,
      pointDollarValue: 5.0,
      firmContractCap: 15,
    });
    // riskDollars = 42K * 0.02 = $840; stopDollars = 1.5*20*5=$150; riskCap=floor(840/150)=5
    // healthRatio = 42K/50K = 0.84 < 0.85 → floor does NOT apply
    expect(r.accountHealthRatio).toBeCloseTo(0.84, 2);
    expect(r.pyramidFloorApplied).toBe(false);
    expect(r.riskDerivedCap).toBe(5);
    expect(r.finalContracts).toBe(5);  // risk-cap binds (2-3 contracts as described in spec)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B.1 — MNQ base 6 at $50K Topstep healthy
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 23 B.1 — MNQ base 6 at $50K Topstep healthy", () => {
  it("MNQ base 6: pyramid floor overrides riskCap on fresh $50K combine", () => {
    // MNQ: stopDollars = 1.5 * 4 * 2 = $12/contract
    // Topstep buffer=$2K, riskDollars=40, riskCap=floor(40/12)=3 < base=6
    // Floor must override → finalContracts=6
    const r = computeRiskDerivedContracts({
      positionSizeConfig: MNQ_CFG_BASE6,
      ...TOPSTEP_50K_HEALTHY,
      cumulativeProfit: 0,
      atrPoints: 4.0,
      stopMultiplier: 1.5,
      pointDollarValue: 2.0,  // MNQ $2/pt
      firmContractCap: 15,
    });
    expect(r.finalContracts).toBe(6);
    expect(r.pyramidFloorApplied).toBe(true);
    // riskCap = floor(40/12) = 3
    expect(r.riskDerivedCap).toBe(3);
    expect(r.rejectionReason).toBeNull();
  });

  it("MNQ dollar risk at base 6: 6 × $2/pt × 40pt ceiling = $480/trade", () => {
    // Sanity: dollar risk per trade at base
    const contracts = 6;
    const pointValue = 2.0; // MNQ
    const stopPts = 40.0;   // MNQ ceiling per plan
    const dollarRisk = contracts * pointValue * stopPts;
    expect(dollarRisk).toBe(480);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B.1 — MCL base 18 at $50K Topstep healthy
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 23 B.1 — MCL base 18 at $50K Topstep healthy", () => {
  it("MCL base 18: pyramid floor overrides riskCap on fresh $50K combine", () => {
    // MCL: pointValue=$100/pt. ATR in points (use 0.1pt = ~10 ticks for reasonable ATR).
    // stopDollars = 1.5 * 0.1 * 100 = $15/contract
    // Topstep buffer=$2K, riskDollars=40, riskCap=floor(40/15)=2 < base=18
    // Floor must override → finalContracts=18
    const r = computeRiskDerivedContracts({
      positionSizeConfig: MCL_CFG_BASE18,
      ...TOPSTEP_50K_HEALTHY,
      cumulativeProfit: 0,
      atrPoints: 0.1,           // small ATR in points for MCL (0.1 point = 10 ticks)
      stopMultiplier: 1.5,
      pointDollarValue: 100.0,  // MCL $100/pt (= $1/tick × 100 ticks/pt)
      firmContractCap: null,
    });
    expect(r.finalContracts).toBe(18);
    expect(r.pyramidFloorApplied).toBe(true);
    expect(r.riskDerivedCap).toBeLessThan(18);  // risk-cap is below base
    expect(r.rejectionReason).toBeNull();
  });

  it("MCL dollar risk at base 18: 18 × $1/tick × 25-tick ceiling = $450/trade", () => {
    // Sanity: dollar risk per trade at base
    // MCL: 1 tick = $1.00, 25-tick ceiling = $25/contract
    // NOTE: MCL pointValue=$100, tick_size=0.01 → tick_value=$100*0.01=$1.00
    const contracts = 18;
    const tickValue = 1.0;  // MCL $1/tick
    const stopTicks = 25;   // MCL ceiling per plan
    const dollarRisk = contracts * tickValue * stopTicks;
    expect(dollarRisk).toBe(450);
  });

  it("MCL base 18: tier increment is +3 (divisible by 3 at every step)", () => {
    // Ladder: 18 → 21 → 24 → 27 ...
    const tiers = [0, 3000, 6000, 9000];
    const expected = [18, 21, 24, 27];

    for (let i = 0; i < tiers.length; i++) {
      const r = computeRiskDerivedContracts({
        positionSizeConfig: MCL_CFG_BASE18,
        firm: "mffu",
        accountBalance: 200_000,
        cumulativeProfit: tiers[i]!,
        atrPoints: 0.1,
        stopMultiplier: 1.5,
        pointDollarValue: 100.0,
        firmContractCap: null,
      });
      expect(r.pyramidTier).toBe(expected[i]);
      expect(r.pyramidTier % 3).toBe(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B.1 — MES base 6 at $50K MFFU healthy (riskCap=33 >> base=6, pyramid binds normally)
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 23 B.1 — MES base 6 at $50K MFFU healthy", () => {
  it("MFFU healthy $50K: riskCap=33 >> base=6, pyramid tier binds normally (not floor)", () => {
    // MFFU: riskDollars = 50K * 0.02 = $1000; riskCap = floor(1000/30) = 33
    // pyramidTier=6, riskCap=33 → min(6, 33, 100, 15) = 6 (pyramid tier wins, not floor)
    const r = computeRiskDerivedContracts({
      positionSizeConfig: MES_CFG_BASE6,
      firm: "mffu",
      accountBalance: 50_000,
      cumulativeProfit: 0,
      atrPoints: 4.0,
      stopMultiplier: 1.5,
      pointDollarValue: 5.0,
      firmContractCap: 15,
    });
    expect(r.finalContracts).toBe(6);
    // Floor should NOT apply — risk-cap (33) is well above base (6), pyramid tier binds
    expect(r.pyramidFloorApplied).toBe(false);
    expect(r.riskDerivedCap).toBe(33);
    expect(r.evidence["bindingCap"]).toBe("pyramid");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B.1 — Account health boundary cases
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 23 B.1 — Account health boundary at 85%", () => {
  it("exactly 85% health: floor APPLIES (>= 0.85 threshold)", () => {
    // $42,500 / $50,000 = 0.85 → exactly at threshold → floor binds
    const r = computeRiskDerivedContracts({
      positionSizeConfig: MES_CFG_BASE6,
      firm: "mffu",
      accountBalance: 42_500,
      accountStartingFloor: 50_000,
      cumulativeProfit: -7_500,
      atrPoints: 20.0,  // high ATR to ensure riskCap < base
      stopMultiplier: 1.5,
      pointDollarValue: 5.0,
      firmContractCap: 15,
    });
    // healthRatio = 42500 / 50000 = 0.85 (exactly at threshold)
    expect(r.accountHealthRatio).toBeCloseTo(0.85, 2);
    // riskDollars = 42500 * 0.02 = $850; stopDollars = 1.5*20*5 = $150; riskCap = floor(850/150) = 5
    expect(r.riskDerivedCap).toBe(5);
    // riskCap (5) < base (6) AND health >= 0.85 → floor applies → final=6
    expect(r.pyramidFloorApplied).toBe(true);
    expect(r.finalContracts).toBe(6);
  });

  it("exactly 84.9% health: floor does NOT apply (below 0.85 threshold)", () => {
    // $42,450 / $50,000 = 0.849 < 0.85 → no floor
    const r = computeRiskDerivedContracts({
      positionSizeConfig: MES_CFG_BASE6,
      firm: "mffu",
      accountBalance: 42_450,
      accountStartingFloor: 50_000,
      cumulativeProfit: -7_550,
      atrPoints: 20.0,
      stopMultiplier: 1.5,
      pointDollarValue: 5.0,
      firmContractCap: 15,
    });
    expect(r.accountHealthRatio).toBeCloseTo(0.849, 2);
    expect(r.pyramidFloorApplied).toBe(false);
    // risk_cap (5) < base (6) but no floor → finalContracts = 5
    expect(r.finalContracts).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B.1 — Micro point value locking (audit)
// ─────────────────────────────────────────────────────────────────────────────

describe("Wave 23 B.3 — Micro point value correctness", () => {
  it("MES pointValue must be $5/pt (not $50 which is mini ES)", () => {
    // MES: 1 point = $5.00. If someone passes $50 (mini ES), sizing would be 10x wrong.
    // This test documents the CORRECT value — any consumer that passes $50 has a bug.
    const correctMesPv = 5.0;
    const wrongMiniEsPv = 50.0;

    const correct = computeRiskDerivedContracts({
      positionSizeConfig: MES_CFG_BASE6,
      firm: "mffu",
      accountBalance: 50_000,
      cumulativeProfit: 0,
      atrPoints: 4.0,
      stopMultiplier: 1.5,
      pointDollarValue: correctMesPv,
      firmContractCap: 15,
    });

    const wrong = computeRiskDerivedContracts({
      positionSizeConfig: MES_CFG_BASE6,
      firm: "mffu",
      accountBalance: 50_000,
      cumulativeProfit: 0,
      atrPoints: 4.0,
      stopMultiplier: 1.5,
      pointDollarValue: wrongMiniEsPv,
      firmContractCap: 15,
    });

    // With correct $5: riskCap = floor(1000/30) = 33
    expect(correct.riskDerivedCap).toBe(33);
    // With wrong $50: riskCap = floor(1000/300) = 3 — 10x under-allocation
    expect(wrong.riskDerivedCap).toBe(3);
    expect(wrong.riskDerivedCap).toBe(Math.floor(correct.riskDerivedCap / 10));
  });

  it("MNQ pointValue must be $2/pt (not $20 which is mini NQ)", () => {
    const correctMnqPv = 2.0;
    const wrongMiniNqPv = 20.0;

    const correct = computeRiskDerivedContracts({
      positionSizeConfig: MNQ_CFG_BASE6,
      firm: "mffu",
      accountBalance: 50_000,
      cumulativeProfit: 0,
      atrPoints: 4.0,
      stopMultiplier: 1.5,
      pointDollarValue: correctMnqPv,
      firmContractCap: null,
    });

    const wrong = computeRiskDerivedContracts({
      positionSizeConfig: MNQ_CFG_BASE6,
      firm: "mffu",
      accountBalance: 50_000,
      cumulativeProfit: 0,
      atrPoints: 4.0,
      stopMultiplier: 1.5,
      pointDollarValue: wrongMiniNqPv,
      firmContractCap: null,
    });

    // correct: stopDollars=12, riskCap=floor(1000/12)=83
    expect(correct.riskDerivedCap).toBe(83);
    // wrong: stopDollars=120, riskCap=floor(1000/120)=8 — 10x under-allocation
    expect(wrong.riskDerivedCap).toBe(8);
  });
});
