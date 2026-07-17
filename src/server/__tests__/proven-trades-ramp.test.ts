/**
 * Scaling-plan-baby-mode (2026-06-23): Proven-trades ramp — TypeScript unit tests.
 *
 * Covers:
 *   (a) Correct tier at N=0/10/20/55 proven trades (PROVEN_TRADES_PER_TIER=10)
 *   (b) Backward-compat: provenTrades absent → identical to dollar mode
 *   (c) Withdrawal-safety: drop in cumulativeProfit does NOT lower size when proven_trades drives tier
 *   (d) 8%-buffer cap allows base 9 on fresh $50K / $2K-buffer Topstep
 *   (e) TS↔Python parity verification (formula level)
 *   (f) scalingMode and scalingTier present in all return paths
 *
 * No DB, no mocks. Pure math on computeRiskDerivedContracts().
 */

import { describe, it, expect } from "vitest";
import { computeRiskDerivedContracts, type RiskSizingInputs } from "../lib/risk-sizing.js";

// ── Shared fixture ─────────────────────────────────────────────────────────────

const BASE_CONTRACTS = 9;   // scaling-plan-baby-mode base
const TIER_INC = 3;
const TIER_THRESH = 3_000;

const BASE_CONFIG: RiskSizingInputs["positionSizeConfig"] = {
  type: "risk_derived_pyramid",
  base_contracts: BASE_CONTRACTS,
  tier_increment: TIER_INC,
  tier_threshold_dollars: TIER_THRESH,
  personal_dll_pct: 0.67,
  max_risk_pct_per_trade: 0.02,
  liquidity_comfort_cap: 500,   // high cap — let sizing breathe
  topstep_account_cap_override: null,
  computed_at_signal_time: true,
};

function makeInput(overrides: Partial<RiskSizingInputs> = {}): RiskSizingInputs {
  return {
    positionSizeConfig: BASE_CONFIG,
    accountBalance: 52_000,
    cumulativeProfit: 0,
    atrPoints: 4,
    stopMultiplier: 1.5,
    pointDollarValue: 5,          // MES $5/pt
    firmContractCap: 500,          // intentionally high
    firm: "topstep",
    trailingDD: 2_000,
    highWaterBalance: 52_000,
    accountStartingFloor: 50_000,
    ...overrides,
  };
}

// ── (a) Correct tiers at N = 0, 10, 20, 55 ─────────────────────────────────

describe("Proven-trades tier formula", () => {

  it.each([
    [0,  0],
    [9,  0],   // < 10 → tier 0
    [10, 1],
    [19, 1],
    [20, 2],
    [55, 5],
  ])("proven_trades=%i → tier %i", (provenTrades, expectedTier) => {
    const expectedPyramid = BASE_CONTRACTS + TIER_INC * expectedTier;
    const result = computeRiskDerivedContracts(makeInput({ provenTrades }));
    expect(result.scalingMode).toBe("proven_trades");
    expect(result.scalingTier).toBe(expectedTier);
    // pyramidTier (uncapped) must match formula (pyramid floor may apply if risk-cap < pyramid)
    expect(result.pyramidTier).toBe(expectedPyramid);
  });

  it("N=0 → tier 0 → pyramidTier == base_contracts", () => {
    const result = computeRiskDerivedContracts(makeInput({ provenTrades: 0 }));
    expect(result.scalingTier).toBe(0);
    expect(result.pyramidTier).toBe(BASE_CONTRACTS);
  });

  it("N=10 → tier 1 → pyramidTier == base+3 = 12", () => {
    const result = computeRiskDerivedContracts(makeInput({ provenTrades: 10 }));
    expect(result.scalingTier).toBe(1);
    expect(result.pyramidTier).toBe(BASE_CONTRACTS + TIER_INC);
  });

  it("N=20 → tier 2 → pyramidTier == base+6 = 15", () => {
    const result = computeRiskDerivedContracts(makeInput({ provenTrades: 20 }));
    expect(result.scalingTier).toBe(2);
    expect(result.pyramidTier).toBe(BASE_CONTRACTS + 2 * TIER_INC);
  });

  it("N=55 → tier 5 → pyramidTier == base+15 = 24", () => {
    const result = computeRiskDerivedContracts(makeInput({ provenTrades: 55 }));
    expect(result.scalingTier).toBe(5);
    expect(result.pyramidTier).toBe(BASE_CONTRACTS + 5 * TIER_INC);
  });
});

// ── (b) Backward-compat: absent provenTrades = dollar mode ──────────────────

describe("Backward compatibility — no provenTrades → dollar fallback", () => {

  it("provenTrades absent → scalingMode='dollar_fallback'", () => {
    const result = computeRiskDerivedContracts(makeInput({ cumulativeProfit: 0 }));
    expect(result.scalingMode).toBe("dollar_fallback");
    expect(result.scalingTier).toBe(0);
    expect(result.pyramidTier).toBe(BASE_CONTRACTS);
  });

  it("provenTrades=null → dollar fallback, byte-identical", () => {
    const resultAbsent = computeRiskDerivedContracts(makeInput({ cumulativeProfit: 2_000 }));
    const resultNull = computeRiskDerivedContracts(makeInput({ cumulativeProfit: 2_000, provenTrades: null }));
    expect(resultAbsent.finalContracts).toBe(resultNull.finalContracts);
    expect(resultAbsent.scalingMode).toBe("dollar_fallback");
    expect(resultNull.scalingMode).toBe("dollar_fallback");
    expect(resultAbsent.scalingTier).toBe(resultNull.scalingTier);
  });

  it("$3K profit → dollar-mode tier 1 → pyramidTier = base+3 = 12", () => {
    const result = computeRiskDerivedContracts(makeInput({ cumulativeProfit: 3_000 }));
    expect(result.scalingMode).toBe("dollar_fallback");
    expect(result.scalingTier).toBe(1);
    expect(result.pyramidTier).toBe(BASE_CONTRACTS + TIER_INC);
  });

  it("provenTrades=0 and dollar mode with $0 produce same pyramidTier", () => {
    const resultPt = computeRiskDerivedContracts(makeInput({ provenTrades: 0, cumulativeProfit: 0 }));
    const resultDollar = computeRiskDerivedContracts(makeInput({ cumulativeProfit: 0 }));
    expect(resultPt.pyramidTier).toBe(resultDollar.pyramidTier);
    expect(resultPt.finalContracts).toBe(resultDollar.finalContracts);
    expect(resultPt.scalingMode).toBe("proven_trades");
    expect(resultDollar.scalingMode).toBe("dollar_fallback");
  });
});

// ── (c) Withdrawal-safety: proven_trades monotonic ───────────────────────────

describe("Withdrawal safety — proven_trades mode does not lower tier on profit drop", () => {

  it("same proven_trades count before/after loss → same tier and pyramidTier", () => {
    const provenTrades = 20;   // tier 2
    const before = computeRiskDerivedContracts(makeInput({ provenTrades, cumulativeProfit: 3_000 }));
    const after = computeRiskDerivedContracts(makeInput({ provenTrades, cumulativeProfit: -500 }));
    expect(after.scalingTier).toBe(before.scalingTier);
    expect(after.pyramidTier).toBe(before.pyramidTier);
    expect(after.scalingMode).toBe("proven_trades");
  });

  it("dollar mode IS sensitive to profit drop (contrast — verifies modes differ)", () => {
    const high = computeRiskDerivedContracts(makeInput({ cumulativeProfit: 3_000 }));  // tier 1
    const low = computeRiskDerivedContracts(makeInput({ cumulativeProfit: -500 }));    // tier 0
    expect(high.scalingTier).toBe(1);
    expect(low.scalingTier).toBe(0);
  });
});

// ── (d) 8%-buffer allows base 9 on fresh Topstep account ────────────────────

describe("8% drawdown-room cap — base 9 on fresh $50K Topstep", () => {

  it("no current_drawdown_room → pyramid floor override → 9 contracts", () => {
    // C-05/D9: floor override REMOVED. buffer=$2K → riskDollars=$40 → cap=floor(40/30)=1 now BINDS.
    const result = computeRiskDerivedContracts(makeInput({ firmContractCap: 50 }));
    expect(result.riskDerivedCap).toBe(1);
    expect(result.pyramidFloorApplied).toBe(false);
    expect(result.finalContracts).toBe(1);  // risk cap wins (lowest wins), not base 9
    expect(result.drawdownRoomCap).toBeNull();
  });

  it("drawdownRoom=$3375 → cap=floor(3375×0.08/30)=9 — exactly at base, no conflict", () => {
    // C-05/D9: floor override REMOVED. DD cap=9, but the small-buffer risk cap (1) is lower and
    // now binds (lowest wins) → final = 1.
    const result = computeRiskDerivedContracts(makeInput({
      firmContractCap: 50,
      currentDrawdownRoom: 3_375,
    }));
    expect(result.drawdownRoomCap).toBe(9);
    expect(result.riskDerivedCap).toBe(1);
    expect(result.finalContracts).toBe(1);
  });

  it("very small DD room ($300) → cap=0 → 0 contracts even on healthy account", () => {
    // 300 × 0.08 / 30 = 0.8 → floor = 0
    const result = computeRiskDerivedContracts(makeInput({
      firmContractCap: 50,
      currentDrawdownRoom: 300,
    }));
    expect(result.drawdownRoomCap).toBe(0);
    expect(result.drawdownRoomCapBinding).toBe(true);
    expect(result.finalContracts).toBe(0);
  });
});

// ── (e) TS↔Python parity verification (formula level) ───────────────────────

describe("TS↔Python formula parity", () => {

  it.each([
    [0,  0,  BASE_CONTRACTS],
    [10, 1,  BASE_CONTRACTS + TIER_INC],
    [20, 2,  BASE_CONTRACTS + 2 * TIER_INC],
    [55, 5,  BASE_CONTRACTS + 5 * TIER_INC],
  ] as [number, number, number][])(
    "proven_trades=%i → tier=%i, pyramidTier=%i",
    (provenTrades, expectedTier, expectedPyramid) => {
      const result = computeRiskDerivedContracts(makeInput({ provenTrades }));
      // These must match what Python returns for the same inputs
      expect(result.scalingTier).toBe(expectedTier);
      expect(result.pyramidTier).toBe(expectedPyramid);
      expect(result.scalingMode).toBe("proven_trades");
    }
  );

  it.each([
    [0,      0],
    [3_000,  1],
    [6_000,  2],
    [16_500, 5],
  ] as [number, number][])(
    "dollar fallback: cumulativeProfit=%i → tier=%i",
    (cumulativeProfit, expectedTier) => {
      const result = computeRiskDerivedContracts(makeInput({ cumulativeProfit }));
      expect(result.scalingTier).toBe(expectedTier);
      expect(result.scalingMode).toBe("dollar_fallback");
    }
  );
});

// ── (f) scalingMode and scalingTier in all return paths ─────────────────────

describe("scalingMode/scalingTier present in every return path", () => {

  it("zero_balance path emits scalingMode and scalingTier", () => {
    const result = computeRiskDerivedContracts(makeInput({ accountBalance: 0 }));
    expect(result.rejectionReason).toBe("zero_balance");
    expect(["proven_trades", "dollar_fallback"]).toContain(result.scalingMode);
    expect(typeof result.scalingTier).toBe("number");
  });

  it("zero_atr path emits scalingMode and scalingTier", () => {
    const result = computeRiskDerivedContracts(makeInput({ atrPoints: 0 }));
    expect(result.rejectionReason).toBe("zero_atr");
    expect(["proven_trades", "dollar_fallback"]).toContain(result.scalingMode);
    expect(typeof result.scalingTier).toBe("number");
  });

  it("zero_buffer path (Topstep, buffer<=0) emits scalingMode and scalingTier", () => {
    // account_balance=49500, HWM=52000, DD=2000 → floor=50000, buffer=-500
    const result = computeRiskDerivedContracts(makeInput({
      accountBalance: 49_500,
      highWaterBalance: 52_000,
      accountStartingFloor: 50_000,
      trailingDD: 2_000,
    }));
    expect(result.rejectionReason).toBe("zero_buffer");
    expect(["proven_trades", "dollar_fallback"]).toContain(result.scalingMode);
    expect(typeof result.scalingTier).toBe("number");
  });

  it("pyramid_floor_override path emits scalingMode and scalingTier", () => {
    // C-05/D9: floor override REMOVED — the risk-cap-binds path (riskCap=1 < base) emits scalingMode.
    const result = computeRiskDerivedContracts(makeInput({ firmContractCap: 50 }));
    expect(result.pyramidFloorApplied).toBe(false);
    expect(["proven_trades", "dollar_fallback"]).toContain(result.scalingMode);
    expect(typeof result.scalingTier).toBe("number");
  });

  it("happy-path return emits scalingMode and scalingTier", () => {
    // MFFU with large balance — risk-derived cap > pyramid tier — full happy path
    const result = computeRiskDerivedContracts({
      positionSizeConfig: BASE_CONFIG,
      accountBalance: 50_000,
      cumulativeProfit: 0,
      atrPoints: 4,
      stopMultiplier: 1.5,
      pointDollarValue: 5,
      firmContractCap: 500,
      firm: "mffu",
      provenTrades: 10,
    });
    expect(result.rejectionReason).toBeNull();
    expect(result.scalingMode).toBe("proven_trades");
    expect(result.scalingTier).toBe(1);
    expect(typeof result.scalingTier).toBe("number");
  });
});

// ── Extra edge cases ──────────────────────────────────────────────────────────

describe("Edge cases", () => {

  it("negative provenTrades clamped to tier 0", () => {
    const result = computeRiskDerivedContracts(makeInput({ provenTrades: -5 }));
    expect(result.scalingTier).toBe(0);
    expect(result.scalingMode).toBe("proven_trades");
  });

  it("large provenTrades (1000) produces correct tier without overflow", () => {
    const result = computeRiskDerivedContracts(makeInput({ provenTrades: 1_000 }));
    expect(result.scalingTier).toBe(100);   // 1000 / 10 = 100
    expect(result.scalingMode).toBe("proven_trades");
  });

  it("proven_trades wins over cumulativeProfit when both supplied", () => {
    // provenTrades=5 → tier 0; dollar would give tier 3 at $9K profit
    const result = computeRiskDerivedContracts(makeInput({
      provenTrades: 5,
      cumulativeProfit: 9_000,
    }));
    expect(result.scalingMode).toBe("proven_trades");
    expect(result.scalingTier).toBe(0);
    expect(result.pyramidTier).toBe(BASE_CONTRACTS);
  });
});
