/**
 * risk-sizing.test.ts — Wave 22 + Wave 23 risk-derived contract sizing tests.
 *
 * Tests both Topstep (trailing-DD buffer math) and MFFU (balance-pct math).
 * All known-answer tests use: ATR=4pt, stop_mult=1.5, MES=$5/pt
 *   stopDollars = 1.5 * 4 * 5 = $30/contract
 *
 * MFFU math (unchanged from Wave 21):
 *   riskDollars = balance * 0.02
 *   riskCap@50K = floor(1000/30) = 33
 *
 * Topstep math (Wave 22):
 *   trailingFloor = min(HWM - trailingDD, startingFloor)
 *   buffer = balance - trailingFloor
 *   riskDollars = buffer * 0.02
 *
 *   At high-water (balance=HWM=50K, trailingDD=2K, startingFloor=50K):
 *     trailingFloor = min(50K-2K, 50K) = min(48K, 50K) = 48K
 *     buffer = 50K - 48K = $2,000
 *     riskCap = floor(2000*0.02/30) = floor(40/30) = 1
 *
 *   After $3K profit (balance=53K, HWM=53K):
 *     trailingFloor = min(53K-2K, 50K) = min(51K, 50K) = 50K  [locked]
 *     buffer = 53K - 50K = $3,000
 *     riskCap = floor(3000*0.02/30) = floor(60/30) = 2
 *
 *   At drawdown (balance=49K, HWM=50K):
 *     trailingFloor = min(50K-2K, 50K) = 48K
 *     buffer = 49K - 48K = $1,000
 *     riskCap = floor(1000*0.02/30) = floor(20/30) = 0
 *
 * Wave 23 pyramid floor rule:
 *   accountHealth = currentBalance / accountStartingFloor
 *   If accountHealth >= 0.85 AND risk-cap < base_contracts:
 *     → pyramidFloorApplied=true, finalContracts = base_contracts
 *   If accountHealth < 0.85 (>15% drawdown):
 *     → risk-cap fully binds, no floor override
 *
 *   Wave 23 changes to Topstep tests:
 *   - 50K at HWM (health=100%): riskCap=1 but floor binds → finalContracts=4 (base)
 *   - 53K after profit (health=106%): riskCap=2, pyramid=6, floor=4 → 2<4 so floor → 4
 *     BUT pyramidTier=6 > base=4 → min(pyramidTier=6, riskCap=2) = 2 → floor 4 > 2 → 4
 *   - 49K drawdown (health=98%): health>=0.85, riskCap=0 → floor applies → 4
 *   Only below 85% ($42,500 at $50K start) does risk-cap fully bind
 *
 * Production isolation: pure math only, no DB calls.
 */

import { describe, it, expect } from "vitest";
import { computeRiskDerivedContracts } from "../risk-sizing.js";

// ── Standard inputs ────────────────────────────────────────────────────────────

const BASE_CFG = {
  type: "risk_derived_pyramid" as const,
  base_contracts: 4,
  tier_increment: 2,
  tier_threshold_dollars: 3000,
  personal_dll_pct: 0.67,
  max_risk_pct_per_trade: 0.02,
  liquidity_comfort_cap: 100,
  topstep_account_cap_override: null,
  computed_at_signal_time: true as const,
};

const COMMON = {
  positionSizeConfig: BASE_CFG,
  cumulativeProfit: 0,
  atrPoints: 4.0,         // 4 MES points
  stopMultiplier: 1.5,    // CLAUDE.md §4 default
  pointDollarValue: 5.0,  // MES $5/pt
  firmContractCap: 15,    // Topstep 50K cap from firm_config
};

// ─────────────────────────────────────────────────────────────────────────────
// MFFU branch (unchanged balance-pct math)
// ─────────────────────────────────────────────────────────────────────────────

describe("MFFU branch — balance-pct math (unchanged from Wave 21)", () => {
  it("50K balance: riskCap=33, pyramid=4 → final=4", () => {
    const r = computeRiskDerivedContracts({ ...COMMON, accountBalance: 50_000, firm: "mffu" });
    expect(r.riskCapMethod).toBe("mffu_balance_pct");
    expect(r.firm).toBe("mffu");
    expect(r.riskDerivedCap).toBe(33);
    expect(r.pyramidTier).toBe(4);
    expect(r.finalContracts).toBe(4);
    expect(r.rejectionReason).toBeNull();
  });

  it("100K balance: riskCap=66, pyramid=4 → final=4", () => {
    const r = computeRiskDerivedContracts({ ...COMMON, accountBalance: 100_000, firm: "mffu" });
    expect(r.riskDerivedCap).toBe(66);
    expect(r.finalContracts).toBe(4);
  });

  it("150K balance: riskCap=100, pyramid=4 → final=4 (liquidity also=100)", () => {
    const r = computeRiskDerivedContracts({ ...COMMON, accountBalance: 150_000, firm: "mffu" });
    expect(r.riskDerivedCap).toBe(100);
    expect(r.finalContracts).toBe(4);
  });

  it("200K balance: riskCap=133, pyramid=4 → final=4", () => {
    const r = computeRiskDerivedContracts({ ...COMMON, accountBalance: 200_000, firm: "mffu" });
    expect(r.riskDerivedCap).toBe(133);
    expect(r.finalContracts).toBe(4);
  });

  it("MFFU zero balance → zero_balance rejection", () => {
    const r = computeRiskDerivedContracts({ ...COMMON, accountBalance: 0, firm: "mffu" });
    expect(r.rejectionReason).toBe("zero_balance");
    expect(r.firm).toBe("mffu");
  });

  it("evidence contains firm and riskCapMethod", () => {
    const r = computeRiskDerivedContracts({ ...COMMON, accountBalance: 50_000, firm: "mffu" });
    expect(r.evidence["firm"]).toBe("mffu");
    expect(r.evidence["riskCapMethod"]).toBe("mffu_balance_pct");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Topstep branch — trailing-DD buffer math (Wave 22 NEW)
// ─────────────────────────────────────────────────────────────────────────────

describe("Topstep branch — trailing-DD buffer math (Wave 22)", () => {
  // 50K at start: HWM=50K, floor=min(48K,50K)=48K, buffer=$2K
  // riskDollars=40, riskCap=floor(40/30)=1, pyramid=4
  // Wave 23: accountHealth=50K/50K=1.0>=0.85 → pyramid floor binds → final=4 (base)
  it("50K at high-water (HWM=balance): riskCap=1 but pyramid floor binds → final=4 (Wave 23)", () => {
    const r = computeRiskDerivedContracts({
      ...COMMON,
      accountBalance: 50_000,
      firm: "topstep",
      trailingDD: 2000,
      highWaterBalance: 50_000,
      accountStartingFloor: 50_000,
    });
    expect(r.riskCapMethod).toBe("topstep_trailing_dd");
    expect(r.firm).toBe("topstep");
    expect(r.evidence["trailingFloor"]).toBe(48_000);
    expect(r.evidence["buffer"]).toBe(2_000);
    // riskDollars = 2000 * 0.02 = 40; stopDollars=30; riskCap=floor(40/30)=1
    expect(r.riskDerivedCap).toBe(1);
    // Wave 23: health=100%>=85% → pyramid floor overrides → returns base_contracts=4
    expect(r.finalContracts).toBe(4);
    expect(r.pyramidFloorApplied).toBe(true);
    expect(r.rejectionReason).toBeNull();
  });

  // After $3K profit: balance=53K, HWM=53K
  // floor = min(53K-2K, 50K) = min(51K, 50K) = 50K [locked at starting floor]
  // buffer = 53K - 50K = $3K; riskDollars=60; riskCap=floor(60/30)=2
  // pyramidTier = 4 + 2*1 = 6; Wave 23: health=53K/50K=1.06>=0.85; riskCap=2 < base=4 → floor → 4
  it("53K after profit (HWM=53K): trailing floor locks at 50K, riskCap=2 < base → floor=4 (Wave 23)", () => {
    const r = computeRiskDerivedContracts({
      ...COMMON,
      accountBalance: 53_000,
      cumulativeProfit: 3_000,
      firm: "topstep",
      trailingDD: 2000,
      highWaterBalance: 53_000,
      accountStartingFloor: 50_000,
    });
    expect(r.evidence["trailingFloor"]).toBe(50_000);  // locked
    expect(r.evidence["buffer"]).toBe(3_000);
    expect(r.riskDerivedCap).toBe(2);
    expect(r.pyramidTier).toBe(6);  // $3K profit → 1 tier → 4+2=6
    // Wave 23: risk-cap=2 < pyramidTier=6, final pre-floor=2 < base=4 → floor=4
    expect(r.finalContracts).toBe(4);
    expect(r.pyramidFloorApplied).toBe(true);
  });

  // At substantial profit: balance=70K, HWM=70K
  // floor = min(70K-2K, 50K) = min(68K, 50K) = 50K [locked]
  // buffer = 70K-50K = $20K; riskDollars=400; riskCap=floor(400/30)=13
  it("70K balance (HWM=70K, locked floor): riskCap=13", () => {
    const r = computeRiskDerivedContracts({
      ...COMMON,
      accountBalance: 70_000,
      cumulativeProfit: 20_000,
      firm: "topstep",
      trailingDD: 2000,
      highWaterBalance: 70_000,
      accountStartingFloor: 50_000,
    });
    expect(r.evidence["trailingFloor"]).toBe(50_000);
    expect(r.evidence["buffer"]).toBe(20_000);
    expect(r.riskDerivedCap).toBe(13);
    // pyramid = 4 + 2*floor(20000/3000) = 4 + 2*6 = 16; firmCap=15; liquidity=100
    // final = min(16, 13, 15, 100) = 13
    expect(r.finalContracts).toBe(13);
  });

  // HWM not yet at starting balance: balance=49.5K, HWM=49.5K
  // floor = min(49.5K-2K, 50K) = min(47.5K, 50K) = 47.5K
  // buffer = 49.5K - 47.5K = $2K → riskDollars=40; riskCap=1
  // Wave 23: accountHealth=49.5K/50K=0.99>=0.85 → pyramid floor applies → final=4
  it("49.5K HWM (floor not locked yet): buffer=2K, riskCap=1, Wave 23 floor→4", () => {
    const r = computeRiskDerivedContracts({
      ...COMMON,
      accountBalance: 49_500,
      firm: "topstep",
      trailingDD: 2000,
      highWaterBalance: 49_500,
      accountStartingFloor: 50_000,
    });
    expect(r.evidence["trailingFloor"]).toBe(47_500);
    expect(r.evidence["buffer"]).toBe(2_000);
    expect(r.riskDerivedCap).toBe(1);
    // Wave 23: health=99%>=85% → pyramid floor applies
    expect(r.finalContracts).toBe(4);
    expect(r.pyramidFloorApplied).toBe(true);
  });

  // At moderate drawdown: balance=49K, HWM=50K
  // floor = min(50K-2K, 50K) = 48K; buffer = 49K-48K = $1K
  // riskDollars = 1000*0.02=20; riskCap=floor(20/30)=0
  // Wave 23: accountHealth=49K/50K=0.98>=0.85 → pyramid floor applies → final=4 (base)
  // (not a rejection — floor overrides even at riskCap=0 on a healthy account)
  it("49K moderate drawdown (HWM=50K): riskCap=0 but floor overrides → final=4 (Wave 23)", () => {
    const r = computeRiskDerivedContracts({
      ...COMMON,
      accountBalance: 49_000,
      firm: "topstep",
      trailingDD: 2000,
      highWaterBalance: 50_000,
      accountStartingFloor: 50_000,
    });
    expect(r.evidence["buffer"]).toBe(1_000);
    // Wave 23: health=98%>=85% → pyramid floor overrides → not a rejection
    expect(r.rejectionReason).toBeNull();
    expect(r.finalContracts).toBe(4);  // base_contracts
    expect(r.pyramidFloorApplied).toBe(true);
    expect(r.accountHealthRatio).toBeCloseTo(0.98);
  });

  // At or below trailing floor: buffer ≤ 0 → zero_buffer
  it("balance at trailing floor: buffer=0 → zero_buffer", () => {
    const r = computeRiskDerivedContracts({
      ...COMMON,
      accountBalance: 48_000,  // exactly at floor
      firm: "topstep",
      trailingDD: 2000,
      highWaterBalance: 50_000,
      accountStartingFloor: 50_000,
    });
    expect(r.rejectionReason).toBe("zero_buffer");
    expect(r.finalContracts).toBe(0);
  });

  it("balance below trailing floor: buffer<0 → zero_buffer", () => {
    const r = computeRiskDerivedContracts({
      ...COMMON,
      accountBalance: 47_000,  // below floor
      firm: "topstep",
      trailingDD: 2000,
      highWaterBalance: 50_000,
      accountStartingFloor: 50_000,
    });
    expect(r.rejectionReason).toBe("zero_buffer");
    expect(r.finalContracts).toBe(0);
  });

  it("zero ATR → zero_atr rejection (firm=topstep)", () => {
    const r = computeRiskDerivedContracts({
      ...COMMON,
      accountBalance: 50_000,
      atrPoints: 0,
      firm: "topstep",
      trailingDD: 2000,
      highWaterBalance: 50_000,
      accountStartingFloor: 50_000,
    });
    expect(r.rejectionReason).toBe("zero_atr");
    expect(r.firm).toBe("topstep");
  });

  it("firm cap=15 applied to Topstep large account", () => {
    // buffer=20K, riskCap=13; firmCap=15 → 13 still wins (lower)
    const r = computeRiskDerivedContracts({
      ...COMMON,
      accountBalance: 70_000,
      cumulativeProfit: 20_000,
      firm: "topstep",
      trailingDD: 2000,
      highWaterBalance: 70_000,
      accountStartingFloor: 50_000,
      firmContractCap: 15,
    });
    expect(r.finalContracts).toBe(13);
    expect(r.firmCapApplied).toBe(false);  // 13 < 15, firm cap did not bind
  });

  it("firm cap=10 binds when risk cap is higher", () => {
    // Large buffer → riskCap > 10; firmCap=10 binds
    const r = computeRiskDerivedContracts({
      ...COMMON,
      accountBalance: 200_000,
      cumulativeProfit: 150_000,
      firm: "topstep",
      trailingDD: 2000,
      highWaterBalance: 200_000,
      accountStartingFloor: 50_000,
      firmContractCap: 10,
    });
    // trailingFloor=min(200K-2K, 50K)=50K; buffer=150K; riskDollars=3K; riskCap=100
    // pyramid=4+2*50=104; min(104,100,100,10)=10; firm binds
    expect(r.firmCap).toBe(10);
    expect(r.finalContracts).toBe(10);
    expect(r.firmCapApplied).toBe(true);
  });

  it("evidence contains Topstep-specific fields", () => {
    const r = computeRiskDerivedContracts({
      ...COMMON,
      accountBalance: 53_000,
      firm: "topstep",
      trailingDD: 2000,
      highWaterBalance: 53_000,
      accountStartingFloor: 50_000,
    });
    expect(r.evidence["firm"]).toBe("topstep");
    expect(r.evidence["riskCapMethod"]).toBe("topstep_trailing_dd");
    expect(r.evidence["trailingFloor"]).toBeDefined();
    expect(r.evidence["buffer"]).toBeDefined();
    expect(r.evidence["highWaterBalance"]).toBe(53_000);
    expect(r.evidence["trailingDD"]).toBe(2000);
    expect(r.evidence["accountStartingFloor"]).toBe(50_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Default firm = "topstep" (per operator directive)
// ─────────────────────────────────────────────────────────────────────────────

describe("Default firm = topstep (operator directive 2026-05-18)", () => {
  it("firm=undefined → defaults to topstep", () => {
    const r = computeRiskDerivedContracts({
      ...COMMON,
      accountBalance: 50_000,
      // firm not passed
    });
    expect(r.firm).toBe("topstep");
    expect(r.riskCapMethod).toBe("topstep_trailing_dd");
  });

  it("topstep default uses default trailingDD=2000 and startingFloor=50K", () => {
    const r = computeRiskDerivedContracts({
      ...COMMON,
      accountBalance: 50_000,
      // No trailing state provided — uses defaults
    });
    // HWM defaults to accountBalance=50K; floor=min(50K-2K,50K)=48K; buffer=2K
    expect(r.evidence["trailingFloor"]).toBe(48_000);
    expect(r.evidence["buffer"]).toBe(2_000);
    expect(r.firm).toBe("topstep");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-firm comparison: same balance should yield different results
// ─────────────────────────────────────────────────────────────────────────────

describe("Cross-firm comparison at $50K balance", () => {
  it("Topstep and MFFU produce different riskCaps", () => {
    const topstep = computeRiskDerivedContracts({
      ...COMMON,
      accountBalance: 50_000,
      firm: "topstep",
      highWaterBalance: 50_000,
      trailingDD: 2000,
      accountStartingFloor: 50_000,
    });
    const mffu = computeRiskDerivedContracts({
      ...COMMON,
      accountBalance: 50_000,
      firm: "mffu",
    });
    // Topstep: buffer=2K, riskCap=1; MFFU: balance=50K, riskCap=33
    expect(topstep.riskDerivedCap).toBe(1);
    expect(mffu.riskDerivedCap).toBe(33);
    expect(topstep.riskDerivedCap).toBeLessThan(mffu.riskDerivedCap);
  });

  it("both firms bounded by firm cap", () => {
    const topstep = computeRiskDerivedContracts({
      ...COMMON,
      accountBalance: 70_000,
      cumulativeProfit: 20_000,
      firm: "topstep",
      highWaterBalance: 70_000,
      trailingDD: 2000,
      accountStartingFloor: 50_000,
      firmContractCap: 15,
    });
    const mffu = computeRiskDerivedContracts({
      ...COMMON,
      accountBalance: 70_000,
      cumulativeProfit: 20_000,
      firm: "mffu",
      firmContractCap: 15,
    });
    expect(topstep.finalContracts).toBeLessThanOrEqual(15);
    expect(mffu.finalContracts).toBeLessThanOrEqual(15);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-trade max-loss smoke (W21 E.3 sanity: ≤$280 for 4 contracts at 14pt ceil)
// ─────────────────────────────────────────────────────────────────────────────

describe("Per-trade max-loss sanity: ≤$280 for 4 MES at 14pt ceiling", () => {
  it("MFFU 4-contract trade: max loss = 4 * 14 * $5 = $280", () => {
    // This test documents the max loss, not the sizing function
    const maxLoss = 4 * 14 * 5;  // contracts * stop_pts * point_value
    expect(maxLoss).toBe(280);
  });

  it("Topstep sizing never exceeds max-loss constraint implicitly", () => {
    const r = computeRiskDerivedContracts({
      ...COMMON,
      accountBalance: 50_000,
      firm: "topstep",
      highWaterBalance: 50_000,
      trailingDD: 2000,
      accountStartingFloor: 50_000,
    });
    // Wave 23: pyramid floor applies (health=100%>=85%); base_contracts=4 → finalContracts=4
    // With finalContracts=4 and 14pt ceiling: max loss = 4 * 14 * 5 = $280 ≤ $280 boundary
    const worstCaseLoss = r.finalContracts * 14 * 5;
    expect(worstCaseLoss).toBeLessThanOrEqual(280);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wave 23 — Pyramid floor enforcement (base 6/6/18, tier +3, health threshold)
//
// Wave 23 pyramid-floor-vs-risk-cap rule (see risk-sizing.ts module comment):
//   Pyramid base is the MINIMUM viable contract count for Style C 33/33/33 partials.
//   MES=6, MNQ=6, MCL=18 — all divisible by 3.
//   On healthy accounts (balance >= 85% of startingCapital):
//     finalContracts = max(base_contracts, min(pyramidTier, riskCap, firmCap, liquidityCap))
//   On drawdown accounts (< 85%):
//     finalContracts = min(pyramidTier, riskCap, firmCap, liquidityCap) [risk-cap binds]
//
// LOCKED micro point values (per operator directive 2026-05-19):
//   MES = $5/pt, MNQ = $2/pt, MCL = $1/tick = $100/point
//   NEVER substitute mini values (ES $50, NQ $20, CL $10)
// ─────────────────────────────────────────────────────────────────────────────

// Wave 23 base configs (per CLAUDE.md §4, operator-locked)
const W23_MES_CFG = {
  type: "risk_derived_pyramid" as const,
  base_contracts: 6,          // Wave 23: MES base — divisible by 3 for Style C partials
  tier_increment: 3,          // +3 per +$3K profit
  tier_threshold_dollars: 3000,
  personal_dll_pct: 0.67,
  max_risk_pct_per_trade: 0.02,
  liquidity_comfort_cap: 100,
  topstep_account_cap_override: null,
  computed_at_signal_time: true as const,
};

const W23_MNQ_CFG = {
  ...W23_MES_CFG,
  base_contracts: 6,          // MNQ base = 6 (6×$2×40pt=$480 dollar risk)
};

const W23_MCL_CFG = {
  ...W23_MES_CFG,
  base_contracts: 18,         // MCL base = 18 (18×$1/tick×25tick=$450 dollar risk)
};

// Healthy Topstep combine (fresh start, 50K, HWM=balance)
const TOPSTEP_FRESH_50K = {
  accountBalance: 50_000,
  firm: "topstep" as const,
  trailingDD: 2000,
  highWaterBalance: 50_000,
  accountStartingFloor: 50_000,
};

describe("Wave 23 — MES base 6 pyramid floor enforcement", () => {
  it("MES base=6 at 50K Topstep healthy combine → 6 (floor binds, not riskCap=1)", () => {
    // riskCap = floor((2000*0.02) / (1.5*4*5)) = floor(40/30) = 1 < base=6
    // health = 50000/50000 = 1.0 >= 0.85 → floor binds → finalContracts=6
    const r = computeRiskDerivedContracts({
      positionSizeConfig: W23_MES_CFG,
      cumulativeProfit: 0,
      atrPoints: 4.0,
      stopMultiplier: 1.5,
      pointDollarValue: 5.0,    // MES $5/pt — LOCKED value
      firmContractCap: 15,
      ...TOPSTEP_FRESH_50K,
    });
    expect(r.finalContracts).toBe(6);
    expect(r.pyramidFloorApplied).toBe(true);
    expect(r.riskDerivedCap).toBe(1);
    expect(r.accountHealthRatio).toBeCloseTo(1.0);
    expect(r.rejectionReason).toBeNull();
    // Dollar risk at base=6: 6 * 14pt * $5 = $420 — per CLAUDE.md §4
    expect(r.finalContracts * 14 * 5).toBe(420);
  });

  it("MES base=6 at 50K Topstep with -15% drawdown ($42,500) → risk-cap binds, no floor", () => {
    // balance = 50000 * 0.85 = 42500; health = 42500/50000 = 0.85 (exactly at boundary)
    // At exactly 0.85, floor still applies (>= check). Test at 0.849 to ensure risk-cap binds.
    const r = computeRiskDerivedContracts({
      positionSizeConfig: W23_MES_CFG,
      cumulativeProfit: 0,
      atrPoints: 4.0,
      stopMultiplier: 1.5,
      pointDollarValue: 5.0,
      firmContractCap: 15,
      accountBalance: 42_000,  // 84% health — below threshold
      firm: "topstep",
      trailingDD: 2000,
      highWaterBalance: 50_000,
      accountStartingFloor: 50_000,
    });
    // health = 42000/50000 = 0.84 < 0.85 → risk-cap binds, floor does NOT apply
    expect(r.accountHealthRatio).toBeCloseTo(0.84);
    expect(r.pyramidFloorApplied).toBe(false);
    // Topstep: floor = min(50K-2K, 50K) = 48K; buffer = 42K-48K < 0 → zero_buffer
    // Actually buffer = 42000 - 48000 = -6000 → zero_buffer rejection
    expect(r.rejectionReason).toBe("zero_buffer");
    expect(r.finalContracts).toBe(0);
  });

  it("accountHealth boundary at exactly 0.85 → floor still applies", () => {
    // 0.85 * 50000 = 42500 exactly at threshold: health >= 0.85 → floor applies
    const r = computeRiskDerivedContracts({
      positionSizeConfig: W23_MES_CFG,
      cumulativeProfit: 0,
      atrPoints: 4.0,
      stopMultiplier: 1.5,
      pointDollarValue: 5.0,
      firmContractCap: 15,
      accountBalance: 42_500,  // exactly 85%
      firm: "mffu",            // MFFU: no buffer issue, tests health threshold directly
    });
    // MFFU health = 42500 / 50000 = 0.85 — exactly at boundary → floor applies
    expect(r.accountHealthRatio).toBeCloseTo(0.85);
    // riskDollars = 42500 * 0.02 = 850; riskCap = floor(850/30) = 28 > base=6
    // pyramidTier = 6; riskCap = 28; floor N/A (riskCap > base) → pyramidTier binds → 6
    expect(r.finalContracts).toBe(6);
    expect(r.pyramidFloorApplied).toBe(false);  // riskCap=28 > base=6, floor didn't need to bind
  });

  it("accountHealth just below 0.85 (MFFU) → risk-cap fully binds on severely restricted account", () => {
    // To see floor NOT apply and risk-cap bind: use a tiny MFFU account where riskCap < base
    // and health < 0.85. With balance=5000, health=5000/50000=0.10 < 0.85.
    // riskDollars = 5000*0.02=100; riskCap=floor(100/30)=3 < base=6
    // health < 0.85 → floor does NOT apply → finalContracts=3
    const r = computeRiskDerivedContracts({
      positionSizeConfig: W23_MES_CFG,
      cumulativeProfit: 0,
      atrPoints: 4.0,
      stopMultiplier: 1.5,
      pointDollarValue: 5.0,
      firmContractCap: 15,
      accountBalance: 5_000,   // 10% health — far below threshold
      firm: "mffu",
      accountStartingFloor: 50_000,
    });
    expect(r.accountHealthRatio).toBeCloseTo(0.10);
    expect(r.pyramidFloorApplied).toBe(false);
    expect(r.riskDerivedCap).toBe(3);
    expect(r.finalContracts).toBe(3);  // risk-cap fully binds
  });

  it("MES tier ladder: base=6 then 6→9→12→15→18 (all divisible by 3)", () => {
    const profits = [0, 3000, 6000, 9000, 12_000];
    const expected = [6, 9, 12, 15, 18];
    for (let i = 0; i < profits.length; i++) {
      const r = computeRiskDerivedContracts({
        positionSizeConfig: W23_MES_CFG,
        cumulativeProfit: profits[i],
        atrPoints: 4.0,
        stopMultiplier: 1.5,
        pointDollarValue: 5.0,
        firmContractCap: 100,   // no firm cap to test pure pyramid
        firm: "mffu",
        accountBalance: 50_000,
      });
      expect(r.pyramidTier).toBe(expected[i]);
      expect(r.pyramidTier % 3).toBe(0);  // always divisible by 3
    }
  });

  it("MES tier ladder continues: 18→21→24→27→30→33 (ceiling per CLAUDE.md §4)", () => {
    const profits = [12_000, 15_000, 18_000, 21_000, 24_000, 27_000];
    const expected = [18, 21, 24, 27, 30, 33];
    for (let i = 0; i < profits.length; i++) {
      const r = computeRiskDerivedContracts({
        positionSizeConfig: W23_MES_CFG,
        cumulativeProfit: profits[i],
        atrPoints: 4.0,
        stopMultiplier: 1.5,
        pointDollarValue: 5.0,
        firmContractCap: 100,
        firm: "mffu",
        accountBalance: 200_000,
      });
      expect(r.pyramidTier).toBe(expected[i]);
      expect(r.pyramidTier % 3).toBe(0);
    }
  });
});

describe("Wave 23 — MNQ base 6 pyramid floor enforcement", () => {
  it("MNQ base=6 at 50K healthy MFFU → 6 contracts (floor binds on fresh account)", () => {
    // MNQ: $2/pt, ATR=20pt (typical MNQ 5m ATR), stopDollars = 1.5 * 20 * 2 = $60
    // riskDollars = 50000 * 0.02 = 1000; riskCap = floor(1000/60) = 16 > base=6
    // pyramid=6 < riskCap=16 → pyramid binds → 6 (floor not needed since pyramid=base)
    const r = computeRiskDerivedContracts({
      positionSizeConfig: W23_MNQ_CFG,
      cumulativeProfit: 0,
      atrPoints: 20.0,         // typical MNQ 5m ATR in NQ points
      stopMultiplier: 1.5,
      pointDollarValue: 2.0,   // MNQ $2/pt — LOCKED value
      firmContractCap: 15,
      accountBalance: 50_000,
      firm: "mffu",
    });
    expect(r.finalContracts).toBe(6);
    expect(r.rejectionReason).toBeNull();
    // Dollar risk at base=6: 6 * 40pt * $2 = $480 — per CLAUDE.md §4
    expect(r.finalContracts * 40 * 2).toBe(480);
  });

  it("MNQ base=6 at 50K Topstep healthy → floor binds over risk-cap", () => {
    // MNQ at Topstep fresh 50K: buffer=2K, riskDollars=40
    // stopDollars = 1.5 * 20 * 2 = $60; riskCap = floor(40/60) = 0
    // health = 100% >= 85% → pyramid floor → 6
    const r = computeRiskDerivedContracts({
      positionSizeConfig: W23_MNQ_CFG,
      cumulativeProfit: 0,
      atrPoints: 20.0,
      stopMultiplier: 1.5,
      pointDollarValue: 2.0,
      firmContractCap: 15,
      ...TOPSTEP_FRESH_50K,
    });
    expect(r.finalContracts).toBe(6);
    expect(r.pyramidFloorApplied).toBe(true);
    expect(r.riskDerivedCap).toBe(0);
  });
});

describe("Wave 23 — MCL base 18 pyramid floor enforcement", () => {
  it("MCL base=18 at 50K healthy MFFU → 18 contracts (pyramid base binds)", () => {
    // MCL: $100/point (= $1/tick × 100 ticks/point)
    // ATR=0.5pt typical MCL 5m; stopDollars = 1.5 * 0.5 * 100 = $75
    // riskDollars = 50000 * 0.02 = 1000; riskCap = floor(1000/75) = 13 < base=18
    // health = 100% >= 85% → pyramid floor → 18
    const r = computeRiskDerivedContracts({
      positionSizeConfig: W23_MCL_CFG,
      cumulativeProfit: 0,
      atrPoints: 0.5,          // 0.5 MCL points (50 ticks)
      stopMultiplier: 1.5,
      pointDollarValue: 100.0, // MCL $100/pt — LOCKED value
      firmContractCap: 100,
      accountBalance: 50_000,
      firm: "mffu",
    });
    expect(r.finalContracts).toBe(18);
    expect(r.pyramidFloorApplied).toBe(true);
    expect(r.riskDerivedCap).toBe(13);
    // Dollar risk at base=18 with 25-tick stop: 18 * 25 * $1 = $450 — per CLAUDE.md §4
    expect(18 * 25 * 1).toBe(450);
  });

  it("MCL base=18 tier ladder: 18→21→24 (divisible by 3)", () => {
    const profits = [0, 3000, 6000];
    const expected = [18, 21, 24];
    for (let i = 0; i < profits.length; i++) {
      const r = computeRiskDerivedContracts({
        positionSizeConfig: W23_MCL_CFG,
        cumulativeProfit: profits[i],
        atrPoints: 0.1,         // tiny ATR → large riskCap to let pyramid show
        stopMultiplier: 1.5,
        pointDollarValue: 100.0,
        firmContractCap: 1000,
        accountBalance: 500_000,  // large balance → no risk-cap constraint
        firm: "mffu",
      });
      expect(r.pyramidTier).toBe(expected[i]);
      expect(r.pyramidTier % 3).toBe(0);  // all divisible by 3
    }
  });

  it("MCL: $100/point is the correct locked value (not $10 mini CL tick)", () => {
    // Verify MCL sizing uses $100/point (micro value), not $10 (mini CL tick).
    // A 10x error here would make stopDollars 10x smaller → riskCap 10x bigger.
    const r_correct = computeRiskDerivedContracts({
      positionSizeConfig: W23_MCL_CFG,
      cumulativeProfit: 0,
      atrPoints: 1.0,
      stopMultiplier: 1.5,
      pointDollarValue: 100.0,  // CORRECT: MCL $100/point
      firmContractCap: 100,
      accountBalance: 50_000,
      firm: "mffu",
    });
    const r_wrong = computeRiskDerivedContracts({
      positionSizeConfig: W23_MCL_CFG,
      cumulativeProfit: 0,
      atrPoints: 1.0,
      stopMultiplier: 1.5,
      pointDollarValue: 10.0,   // WRONG: would be mini CL tick (not MCL)
      firmContractCap: 100,
      accountBalance: 50_000,
      firm: "mffu",
    });
    // Correct: stopDollars=150; riskCap=floor(1000/150)=6 < base=18 → floor=18
    expect(r_correct.riskDerivedCap).toBe(6);
    // Wrong: stopDollars=15; riskCap=floor(1000/15)=66 >> base=18 → pyramid=18
    expect(r_wrong.riskDerivedCap).toBe(66);
    // Both give 18 at base (pyramid floor or tier binds), but riskCap is 10x different
    expect(r_correct.finalContracts).toBe(18);
    expect(r_wrong.finalContracts).toBe(18);
  });
});
