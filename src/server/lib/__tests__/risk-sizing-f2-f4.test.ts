/**
 * risk-sizing-f2-f4.test.ts
 *
 * TDD tests for two production-hardening findings:
 *
 * F-2: Topstep buffer overstated when highWaterBalance is omitted.
 *   When `highWaterBalance` is NOT provided and firm="topstep", the code
 *   previously defaulted HWM to accountBalance. On a LOSING day this produces
 *   a buffer of trailingDD ($2,000) regardless of actual realized-peak equity —
 *   potentially up to 4× the real room. The fix must default conservatively:
 *   HWM = max(accountBalance, accountStartingFloor) so the buffer never exceeds
 *   the room available, and must set hwm_defaulted=true in evidence.
 *
 * F-4: Early-return floor path (riskDerivedCap <= 0, healthy account) omits
 *   drawdownRoomCap from its min(). The main path (line ~705) includes it;
 *   the early-return path (line ~582) does not — allowing base_contracts to be
 *   returned even when DD room is too tight to support that many contracts.
 *   Fix: include drawdownRoomCap in the early-return floor min() when non-null.
 */

import { describe, it, expect } from "vitest";
import { computeRiskDerivedContracts } from "../risk-sizing.js";

// ── Shared base config ───────────────────────────────────────────────────────

const MES_CFG: Parameters<typeof computeRiskDerivedContracts>[0]["positionSizeConfig"] = {
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

// ── F-2: Topstep conservative HWM default ───────────────────────────────────

describe("F-2: Topstep HWM default is conservative when highWaterBalance is omitted", () => {
  /**
   * Scenario: Topstep account with startingFloor=$50K, accountBalance=$48K.
   * - trailingDD = $2,000
   * - If we naively default HWM = accountBalance ($48K):
   *     trailingFloor = min(48K - 2K, 50K) = $46K
   *     buffer = $48K - $46K = $2,000  ← OVERSTATED (up to 4× real room)
   * - Conservative fix: HWM = max(accountBalance, startingFloor) = $50K:
   *     trailingFloor = min(50K - 2K, 50K) = $48K
   *     buffer = $48K - $48K = $0  ← buffer ≈ 0, correct for losing day
   *
   * The conservative default must produce buffer <= real buffer when account
   * is below startingFloor. Specifically: buffer must be <= trailingDD,
   * and for balance=48500 (small winning day above combine floor), the old
   * code would compute buffer=$2500 but correct code computes buffer=$500.
   */
  it("topstep: accountBalance=48500, no HWM provided → buffer ≤ $500 (not $2000)", () => {
    // With no HWM, the conservative default is max(48500, 50000) = 50000
    // trailingFloor = min(50000 - 2000, 50000) = 48000
    // buffer = 48500 - 48000 = 500
    // riskDollars = 500 * 0.02 = $10
    // stopDollarsPerContract = 1.5 * 4 * 5 = $30
    // riskDerivedCap = floor(10/30) = 0 → healthy account → base_contracts = 6
    const result = computeRiskDerivedContracts({
      positionSizeConfig: MES_CFG,
      accountBalance: 48_500,
      cumulativeProfit: 0,
      atrPoints: 4,
      stopMultiplier: 1.5,
      pointDollarValue: 5,
      firmContractCap: null,
      firm: "topstep",
      trailingDD: 2_000,
      accountStartingFloor: 50_000,
      // highWaterBalance intentionally OMITTED to trigger the default logic
    });

    // The buffer with conservative default is $500, not $2000.
    // riskDollars = 500 * 0.02 = $10 → riskDerivedCap = 0 (floor(10/30) = 0)
    // Healthy account (48500/50000 = 0.97 >= 0.85) → pyramid floor = base_contracts = 6
    // But importantly: the OLD code would compute buffer=$2000 → riskDerivedCap=1
    // The NEW code must compute buffer≤$500 → riskDerivedCap≤0
    expect(result.evidence).toBeDefined();
    expect(result.evidence.hwm_defaulted).toBe(true);

    // Verify the buffer is conservative: with balance=48500, startingFloor=50000,
    // the buffer must be 48500 - 48000 = 500 (not 2000).
    // We verify indirectly: riskDerivedCap must be 0 (floor(500*0.02/30) = 0)
    expect(result.riskDerivedCap).toBe(0);
  });

  it("topstep: explicit highWaterBalance provided → hwm_defaulted is false or absent", () => {
    const result = computeRiskDerivedContracts({
      positionSizeConfig: MES_CFG,
      accountBalance: 48_500,
      cumulativeProfit: 0,
      atrPoints: 4,
      stopMultiplier: 1.5,
      pointDollarValue: 5,
      firmContractCap: null,
      firm: "topstep",
      trailingDD: 2_000,
      highWaterBalance: 52_000,  // explicit HWM provided
      accountStartingFloor: 50_000,
    });

    expect(result.evidence.hwm_defaulted).toBeFalsy();
  });

  it("topstep: accountBalance=48500, no HWM → buffer must not be $2000", () => {
    // This is the specific scenario from the finding:
    // Old code: HWM=48500, buffer=48500-(48500-2000)=2000 (WRONG — overstated)
    // New code: HWM=50000, buffer=48500-48000=500 (CORRECT — conservative)
    const result = computeRiskDerivedContracts({
      positionSizeConfig: MES_CFG,
      accountBalance: 48_500,
      cumulativeProfit: 0,
      atrPoints: 4,
      stopMultiplier: 1.5,
      pointDollarValue: 5,
      firmContractCap: null,
      firm: "topstep",
      trailingDD: 2_000,
      accountStartingFloor: 50_000,
    });

    // Old code produced buffer=$2000; new must be strictly less.
    const buffer = result.evidence.buffer as number;
    expect(buffer).toBeLessThan(2_000);
    expect(buffer).toBeCloseTo(500, 0);
  });

  it("mffu: HWM default does not apply (no topstep trailing logic)", () => {
    // MFFU uses balance-pct, no HWM, so evidence should never have hwm_defaulted=true
    const result = computeRiskDerivedContracts({
      positionSizeConfig: MES_CFG,
      accountBalance: 50_000,
      cumulativeProfit: 0,
      atrPoints: 4,
      stopMultiplier: 1.5,
      pointDollarValue: 5,
      firmContractCap: null,
      firm: "mffu",
    });

    expect(result.evidence.hwm_defaulted).toBeFalsy();
  });
});

// ── F-4: Early-return floor includes drawdownRoomCap ────────────────────────

describe("F-4: early-return pyramid floor path respects drawdownRoomCap", () => {
  /**
   * The early-return path fires when riskDerivedCap <= 0 AND account is healthy.
   * Before the fix: flooredCandidates = [base_contracts, liquidityCap, firmCap?]
   * After the fix:  flooredCandidates adds drawdownRoomCap when non-null.
   *
   * Failure scenario from the finding:
   *   accountBalance=$50100, HWM=$52000, trailingDD=$2000
   *   trailingFloor = min(52000-2000, 50000) = 50000
   *   buffer = 50100 - 50000 = $100
   *   riskDollars = 100 * 0.02 = $2
   *   stopDollarsPerContract = 1.5 * 4 * 5 = $30
   *   riskDerivedCap = floor(2/30) = 0
   *
   *   drawdownRoom = $100 (input passed in)
   *   DRAWDOWN_ROOM_RISK_PCT = 0.01
   *   drawdownRoomCap = floor(100 * 0.01 / 30) = floor(0.033) = 0
   *
   *   Old code: hits early-return, ignores drawdownRoomCap → returns base_contracts=6
   *   New code: flooredCandidates includes drawdownRoomCap=0 → finalContracts=0
   *
   *   We use a slightly larger DD room ($200) to get drawdownRoomCap=0 still,
   *   but we use a larger currentDrawdownRoom ($1500) to get cap=0 with the
   *   default DRAWDOWN_ROOM_RISK_PCT=0.01.
   *   With currentDrawdownRoom=$1500 and stopDollars=$30:
   *     drawdownRoomCap = floor(1500 * 0.01 / 30) = floor(0.5) = 0
   *
   *   With riskDerivedCap=0 (narrow buffer) AND drawdownRoomCap=0:
   *   - Old early-return returns base_contracts=6
   *   - New early-return returns min(6, 100_liq, 0) = 0
   *
   * But wait: if drawdownRoomCap=0, account is also at its floor and
   * returning 0 contracts is correct (nothing fits in the room).
   *
   * Let's use a scenario where drawdownRoomCap > 0 but < base_contracts:
   *   currentDrawdownRoom=$4500, stopDollars=$30
   *   drawdownRoomCap = floor(4500 * 0.01 / 30) = floor(1.5) = 1
   *   base_contracts = 6
   *
   *   Old: returns 6 (ignores cap)
   *   New: returns min(6, 100_liq, 1) = 1
   *
   * The test verifies that the returned contracts <= drawdownRoomCap when DD room is tight.
   */
  it("$50100 balance, HWM=$52000, currentDrawdownRoom=$4500 → finalContracts <= 1 (was 6)", () => {
    // riskDerivedCap = 0 (tiny buffer of $100)
    // drawdownRoomCap = floor(4500 * 0.01 / 30) = 1
    // healthy account → old code returns base=6; new code returns min(6, 100, 1) = 1
    const result = computeRiskDerivedContracts({
      positionSizeConfig: MES_CFG,
      accountBalance: 50_100,
      cumulativeProfit: 0,
      atrPoints: 4,
      stopMultiplier: 1.5,
      pointDollarValue: 5,
      firmContractCap: null,
      firm: "topstep",
      trailingDD: 2_000,
      highWaterBalance: 52_000,
      accountStartingFloor: 50_000,
      currentDrawdownRoom: 4_500,
    });

    // drawdownRoomCap = floor(4500 * 0.01 / 30) = 1
    expect(result.drawdownRoomCap).toBe(1);

    // Old code would return 6 (early-return ignores drawdownRoomCap)
    // New code must return <= 1 (drawdownRoomCap binds even in early-return path)
    expect(result.finalContracts).toBeLessThanOrEqual(1);
  });

  it("worst-case: $100 DD room → drawdownRoomCap=0 → finalContracts=0 (was 6)", () => {
    // riskDerivedCap=0 (same buffer=$100)
    // drawdownRoomCap = floor(100 * 0.01 / 30) = 0
    // Old: returns base=6; New: returns min(6, 100, 0) = 0
    const result = computeRiskDerivedContracts({
      positionSizeConfig: MES_CFG,
      accountBalance: 50_100,
      cumulativeProfit: 0,
      atrPoints: 4,
      stopMultiplier: 1.5,
      pointDollarValue: 5,
      firmContractCap: null,
      firm: "topstep",
      trailingDD: 2_000,
      highWaterBalance: 52_000,
      accountStartingFloor: 50_000,
      currentDrawdownRoom: 100,
    });

    expect(result.drawdownRoomCap).toBe(0);
    // Must return 0, not 6
    expect(result.finalContracts).toBe(0);
  });

  it("healthy account, no currentDrawdownRoom provided → early-return still returns base_contracts", () => {
    // When currentDrawdownRoom is absent, drawdownRoomCap is null (MFFU-style or no input).
    // The early-return path should still apply the pyramid floor as before.
    const result = computeRiskDerivedContracts({
      positionSizeConfig: MES_CFG,
      accountBalance: 50_100,
      cumulativeProfit: 0,
      atrPoints: 4,
      stopMultiplier: 1.5,
      pointDollarValue: 5,
      firmContractCap: null,
      firm: "topstep",
      trailingDD: 2_000,
      highWaterBalance: 52_000,
      accountStartingFloor: 50_000,
      // currentDrawdownRoom intentionally absent
    });

    // drawdownRoomCap should be null when no input provided
    expect(result.drawdownRoomCap).toBeNull();
    // Pyramid floor applies: base_contracts=6 returned
    expect(result.finalContracts).toBe(6);
    expect(result.pyramidFloorApplied).toBe(true);
  });
});

// ── MED C-2: main-path pyramid floor must re-clamp against firmCap/liquidityCap ──
// (deep-scan #16 wave-1 track-3, 2026-07-04)

describe("C-2: main-path pyramid floor respects firmCap and liquidityCap (untested before this fix)", () => {
  /**
   * Bug: the MAIN path's pyramid-floor override (riskDerivedCap > 0, so it does NOT
   * hit the early-return branch covered by the F-4 tests above) force-set
   * `finalContracts = cfg.base_contracts` UNCLAMPED — unlike the early-return branch,
   * which F-4/F-7 patched to `min([base, liquidityCap, firmCap?, drawdownRoomCap?])`.
   *
   * Scenario: MFFU account, healthy, large risk-derived cap (66) and pyramidTier (6),
   * but firmContractCap=3 (a strict per-firm/DSL override). The min() correctly binds
   * to 3 BEFORE the floor check. Then, because 3 < base_contracts (6), the OLD floor
   * code bumped finalContracts back UP to 6 — silently exceeding the firm cap it had
   * just enforced. The fix must keep finalContracts <= firmCap.
   */
  it("firmContractCap=3 < base_contracts=6 on the main (non-zero riskDerivedCap) path → finalContracts stays <= 3", () => {
    const result = computeRiskDerivedContracts({
      positionSizeConfig: MES_CFG, // base_contracts=6, liquidity_comfort_cap=100
      accountBalance: 100_000,
      cumulativeProfit: 0,
      atrPoints: 4,
      stopMultiplier: 1.5,
      pointDollarValue: 5,
      firmContractCap: 3,
      firm: "mffu",
    });

    // riskDollars = 100000 * 0.02 = 2000; stopDollarsPerContract = 1.5*4*5 = 30
    // riskDerivedCap = floor(2000/30) = 66 → main path (NOT the riskDerivedCap<=0 early return)
    expect(result.riskDerivedCap).toBeGreaterThan(0);
    // Pre-floor min(pyramidTier=6, riskDerivedCap=66, liquidityCap=100) = 6,
    // then firmCap=3 clamps it to 3 — that's firmCapApplied, verified below.
    expect(result.firmCapApplied).toBe(true);
    // THE BUG: without the fix, the pyramid floor below would force finalContracts
    // back up to base_contracts=6, exceeding firmCap=3.
    expect(result.finalContracts).toBeLessThanOrEqual(3);
    expect(result.firmCap).toBe(3);
  });

  it("firmContractCap=3, liquidityCap tighter than firmCap (2) → floor respects the tightest of both", () => {
    const tightLiquidityCfg = { ...MES_CFG, liquidity_comfort_cap: 2 };
    const result = computeRiskDerivedContracts({
      positionSizeConfig: tightLiquidityCfg,
      accountBalance: 100_000,
      cumulativeProfit: 0,
      atrPoints: 4,
      stopMultiplier: 1.5,
      pointDollarValue: 5,
      firmContractCap: 3,
      firm: "mffu",
    });

    expect(result.riskDerivedCap).toBeGreaterThan(0);
    // liquidityCap=2 binds tighter than firmCap=3 and tighter than base_contracts=6.
    expect(result.finalContracts).toBeLessThanOrEqual(2);
  });
});
